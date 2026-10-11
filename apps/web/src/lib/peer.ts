import { z } from 'zod';
import type { SignalingClient } from './signaling';

// ─── Zod Schemas for SDP and ICE Payloads (Item 4 & 6) ────────────────────────

export const SdpPayloadSchema = z.object({
  type: z.enum(['offer', 'answer']),
  sdp: z.string(),
});

export type SdpPayload = z.infer<typeof SdpPayloadSchema>;

export const IcePayloadSchema = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});

export type IcePayload = z.infer<typeof IcePayloadSchema>;

export interface PeerManagerOptions {
  signaling: SignalingClient;
  isInitiator: boolean;
  iceServers?: RTCIceServer[];
  onDataChannelOpen?: () => void;
  onDataChannelClose?: () => void;
  onMessage?: (data: string | ArrayBuffer) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onError?: (err: unknown) => void;
}

function parseIceServers(): RTCIceServer[] {
  const envServers = import.meta.env.VITE_ICE_SERVERS;
  if (envServers) {
    const urls = envServers.split(',').map((s) => s.trim()).filter(Boolean);
    if (urls.length > 0) {
      return [{ urls }];
    }
  }

  // Default to public STUN servers per Section 6
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
}

/**
 * Manages RTCPeerConnection and an ordered reliable RTCDataChannel for transfer.
 * Negotiates WebRTC signaling over the SignalingClient.
 *
 * Guarantees:
 * 1. Sequential processing of signaling messages via a Promise chain.
 * 2. Buffering of early ICE candidates until setRemoteDescription completes.
 * 3. Strict Zod validation of incoming SDP and ICE payloads.
 * 4. Safe close() lifecycle: detaches all callbacks and ignores post-close messages/events.
 */
export class PeerManager {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private options: PeerManagerOptions;
  private unsubscribeSignaling: (() => void) | null = null;
  private closed = false;

  // Sequential queue for incoming signaling messages
  private messageQueue: Promise<void> = Promise.resolve();
  // Buffer for ICE candidates that arrive before setRemoteDescription completes
  private iceCandidateBuffer: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

  constructor(options: PeerManagerOptions) {
    this.options = options;
    const iceServers = options.iceServers ?? parseIceServers();

    this.pc = new RTCPeerConnection({
      iceServers,
    });

    this.setupPeerConnection();
    this.setupSignaling();

    if (this.options.isInitiator) {
      this.createDataChannel();
    }
  }

  private setupPeerConnection(): void {
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      this.options.onConnectionStateChange?.(this.pc.connectionState);
    };

    this.pc.onicecandidate = (event) => {
      if (this.closed) return;
      if (event.candidate) {
        this.options.signaling.send({
          type: 'signal',
          kind: 'ice',
          data: event.candidate.toJSON(),
        });
      }
    };

    this.pc.ondatachannel = (event) => {
      if (this.closed) return;
      this.attachDataChannel(event.channel);
    };
  }

  private createDataChannel(): void {
    // Ordered and reliable RTCDataChannel per TECH_STACK.md Section 6
    const dc = this.pc.createDataChannel('quickdrop-channel', {
      ordered: true,
    });
    this.attachDataChannel(dc);
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    this.channel.binaryType = 'arraybuffer';

    this.channel.onopen = () => {
      if (this.closed) return;
      this.options.onDataChannelOpen?.();
    };

    this.channel.onclose = () => {
      if (this.closed) return;
      this.options.onDataChannelClose?.();
    };

    this.channel.onmessage = (event) => {
      if (this.closed) return;
      if (typeof event.data === 'string') {
        this.options.onMessage?.(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        this.options.onMessage?.(event.data);
      }
    };

    this.channel.onerror = (err) => {
      if (this.closed) return;
      this.options.onError?.(err);
    };
  }

  private setupSignaling(): void {
    this.unsubscribeSignaling = this.options.signaling.onMessage((msg) => {
      if (this.closed) return;
      if (msg.type !== 'signal') return;

      // Queue message processing strictly one-by-one
      this.messageQueue = this.messageQueue
        .then(() => {
          if (this.closed) return;
          return this.processSignalMessage(msg.kind, msg.data);
        })
        .catch((err) => {
          if (this.closed) return;
          this.options.onError?.(err);
        });
    });
  }

  private async processSignalMessage(kind: 'offer' | 'answer' | 'ice', rawData: unknown): Promise<void> {
    if (this.closed) return;

    if (kind === 'offer') {
      const parsedSdp = SdpPayloadSchema.safeParse(rawData);
      if (!parsedSdp.success || parsedSdp.data.type !== 'offer') {
        this.options.onError?.(new Error('Invalid SDP offer payload received'));
        return;
      }

      await this.pc.setRemoteDescription(new RTCSessionDescription(parsedSdp.data as RTCSessionDescriptionInit));
      if (this.closed) return;
      this.remoteDescriptionSet = true;
      await this.flushIceCandidateBuffer();
      if (this.closed) return;

      const answer = await this.pc.createAnswer();
      if (this.closed) return;
      await this.pc.setLocalDescription(answer);
      if (this.closed) return;

      this.options.signaling.send({
        type: 'signal',
        kind: 'answer',
        data: answer,
      });
    } else if (kind === 'answer') {
      const parsedSdp = SdpPayloadSchema.safeParse(rawData);
      if (!parsedSdp.success || parsedSdp.data.type !== 'answer') {
        this.options.onError?.(new Error('Invalid SDP answer payload received'));
        return;
      }

      await this.pc.setRemoteDescription(new RTCSessionDescription(parsedSdp.data as RTCSessionDescriptionInit));
      if (this.closed) return;
      this.remoteDescriptionSet = true;
      await this.flushIceCandidateBuffer();
    } else if (kind === 'ice') {
      if (!rawData) return;
      const parsedIce = IcePayloadSchema.safeParse(rawData);
      if (!parsedIce.success) {
        this.options.onError?.(new Error('Invalid ICE candidate payload received'));
        return;
      }

      const candidateInit = parsedIce.data as RTCIceCandidateInit;
      if (!this.remoteDescriptionSet) {
        this.iceCandidateBuffer.push(candidateInit);
      } else {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      }
    }
  }

  private async flushIceCandidateBuffer(): Promise<void> {
    const candidates = [...this.iceCandidateBuffer];
    this.iceCandidateBuffer = [];
    for (const candidate of candidates) {
      if (this.closed) return;
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        if (!this.closed) {
          this.options.onError?.(err);
        }
      }
    }
  }

  /**
   * Called by the initiator to create the initial SDP offer and dispatch it.
   */
  public async startOffer(): Promise<void> {
    if (this.closed) return;
    try {
      const offer = await this.pc.createOffer();
      if (this.closed) return;
      await this.pc.setLocalDescription(offer);
      if (this.closed) return;

      this.options.signaling.send({
        type: 'signal',
        kind: 'offer',
        data: offer,
      });
    } catch (err) {
      if (!this.closed) {
        this.options.onError?.(err);
      }
      throw err;
    }
  }

  /**
   * Returns the underlying RTCDataChannel for transfer streaming.
   */
  public getDataChannel(): RTCDataChannel | null {
    return this.channel;
  }

  /**
   * Send plaintext string or binary ArrayBuffer/Uint8Array message over the RTCDataChannel.
   */
  public send(message: string): void {
    if (this.closed) {
      throw new Error('PeerManager is closed');
    }
    if (this.channel && this.channel.readyState === 'open') {
      const payload = message.slice(0, 4000);
      this.channel.send(payload);
    } else {
      throw new Error('DataChannel is not open');
    }
  }

  /**
   * Send arbitrary data (string or binary) without message length restrictions (used for control & chunks).
   */
  public sendData(data: string | ArrayBuffer | Uint8Array): void {
    if (this.closed) {
      throw new Error('PeerManager is closed');
    }
    if (this.channel && this.channel.readyState === 'open') {
      if (typeof data === 'string') {
        this.channel.send(data);
      } else if (data instanceof Uint8Array) {
        this.channel.send(data.buffer as ArrayBuffer);
      } else {
        this.channel.send(data);
      }
    } else {
      throw new Error('DataChannel is not open');
    }
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;

    // 1. Unsubscribe from signaling
    if (this.unsubscribeSignaling) {
      this.unsubscribeSignaling();
      this.unsubscribeSignaling = null;
    }

    // 2. Detach channel handlers BEFORE closing channel
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onmessage = null;
      this.channel.onerror = null;
      this.channel.close();
      this.channel = null;
    }

    // 3. Detach pc handlers BEFORE closing pc
    this.pc.onconnectionstatechange = null;
    this.pc.onicecandidate = null;
    this.pc.ondatachannel = null;
    this.pc.close();

    // 4. Clear candidate buffers
    this.iceCandidateBuffer = [];
  }
}
