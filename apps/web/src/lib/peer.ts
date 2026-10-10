import type { SignalingClient } from './signaling';

export interface PeerManagerOptions {
  signaling: SignalingClient;
  isInitiator: boolean;
  iceServers?: RTCIceServer[];
  onDataChannelOpen?: () => void;
  onDataChannelClose?: () => void;
  onMessage?: (data: string) => void;
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
 */
export class PeerManager {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private options: PeerManagerOptions;
  private unsubscribeSignaling: (() => void) | null = null;

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
      this.options.onConnectionStateChange?.(this.pc.connectionState);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.options.signaling.send({
          type: 'signal',
          kind: 'ice',
          data: event.candidate.toJSON(),
        });
      }
    };

    this.pc.ondatachannel = (event) => {
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

    this.channel.onopen = () => {
      this.options.onDataChannelOpen?.();
    };

    this.channel.onclose = () => {
      this.options.onDataChannelClose?.();
    };

    this.channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.options.onMessage?.(event.data);
      }
    };

    this.channel.onerror = (err) => {
      this.options.onError?.(err);
    };
  }

  private setupSignaling(): void {
    this.unsubscribeSignaling = this.options.signaling.onMessage(async (msg) => {
      if (msg.type !== 'signal') return;

      try {
        if (msg.kind === 'offer') {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data as RTCSessionDescriptionInit));
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);

          this.options.signaling.send({
            type: 'signal',
            kind: 'answer',
            data: answer,
          });
        } else if (msg.kind === 'answer') {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data as RTCSessionDescriptionInit));
        } else if (msg.kind === 'ice') {
          if (msg.data) {
            await this.pc.addIceCandidate(new RTCIceCandidate(msg.data as RTCIceCandidateInit));
          }
        }
      } catch (err) {
        this.options.onError?.(err);
      }
    });
  }

  /**
   * Called by the initiator to create the initial SDP offer and dispatch it.
   */
  public async startOffer(): Promise<void> {
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.options.signaling.send({
        type: 'signal',
        kind: 'offer',
        data: offer,
      });
    } catch (err) {
      this.options.onError?.(err);
      throw err;
    }
  }

  /**
   * Send plaintext string message over the RTCDataChannel.
   */
  public send(message: string): void {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(message);
    } else {
      throw new Error('DataChannel is not open');
    }
  }

  public close(): void {
    if (this.unsubscribeSignaling) {
      this.unsubscribeSignaling();
      this.unsubscribeSignaling = null;
    }

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    this.pc.close();
  }
}
