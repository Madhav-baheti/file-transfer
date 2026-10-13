/**
 * SecureTransport (Phase 5): the ONLY path between the raw WebRTC data channel and the app.
 *
 *   raw channel --handleRaw()--> [handshake | decrypt | reject] --onMessage()--> app
 *   app --send()--> [encrypt] --wire.send()--> raw channel
 *
 * Rules enforced here, so no other code has to remember them:
 *   1. Before and during the handshake, only handshake messages are accepted.
 *   2. After the handshake, only encrypted binary frames are accepted. ANY plaintext
 *      application message is treated as an attack (downgrade) and kills the connection.
 *   3. Nothing can be sent until the channel is ready; everything sent is encrypted.
 *   4. Messages reach the app in the order they were sent.
 *   5. The first error closes the transport for good (fail closed), reported once.
 *
 * Plaintext layout inside every encrypted frame: [kind byte][payload]
 *   kind 1 = UTF-8 text (chat and JSON control messages), kind 2 = binary (file chunks)
 */

import { SecureSession, SecureChannelError, isHandshakeMessage, type HandshakeMessage, type Role } from './secureChannel';

export interface SecureWire {
  send(data: string | ArrayBuffer): void;
}

export interface SecureReadyInfo {
  /** Short authentication string, e.g. "4821 0937" */
  sas: string;
  /** True when pairing used only the short code: the user MUST compare the digits. */
  requiresSasConfirmation: boolean;
}

export interface SecureTransportOptions {
  role: Role;
  localFingerprint: string;
  remoteFingerprint: string;
  psk?: Uint8Array;
  wire: SecureWire;
  /** Decrypted application messages, in order. */
  onMessage: (data: string | ArrayBuffer) => void;
  /** Called once when the handshake has completed. */
  onReady: (info: SecureReadyInfo) => void;
  /** Called at most once; the transport is closed afterwards. */
  onError: (err: Error) => void;
}

const KIND_TEXT = 1;
const KIND_BINARY = 2;
const MAX_QUEUED_FRAMES = 64;

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

export class SecureTransport {
  private readonly session: SecureSession;
  private readonly opts: SecureTransportOptions;
  private started = false;
  private closed = false;
  private readyAnnounced = false;
  private queuedFrames: ArrayBuffer[] = [];

  constructor(opts: SecureTransportOptions) {
    this.opts = opts;
    this.session = new SecureSession({
      role: opts.role,
      localFingerprint: opts.localFingerprint,
      remoteFingerprint: opts.remoteFingerprint,
      psk: opts.psk,
    });
  }

  public get isReady(): boolean {
    return !this.closed && this.session.isReady;
  }

  public get isClosed(): boolean {
    return this.closed;
  }

  /** Begin the handshake (call once the raw channel is open). */
  public async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    try {
      this.sendHandshake(await this.session.start());
    } catch (err) {
      this.fail(err);
    }
  }

  /** Feed EVERY message received on the raw channel into this method. */
  public handleRaw(data: string | ArrayBuffer): void {
    if (this.closed) return;
    if (typeof data === 'string') {
      this.handleText(data);
    } else {
      this.handleFrame(data);
    }
  }

  /** Encrypts and sends. Throws if the channel is not ready (check isReady first). */
  public send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.closed) throw new SecureChannelError('Secure channel is closed');
    if (!this.session.isReady) throw new SecureChannelError('Secure channel is not ready');

    let kind: number;
    let body: Uint8Array;
    if (typeof data === 'string') {
      kind = KIND_TEXT;
      body = encoder.encode(data);
    } else if (ArrayBuffer.isView(data)) {
      kind = KIND_BINARY;
      body = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      kind = KIND_BINARY;
      body = new Uint8Array(data);
    }

    const plain = new Uint8Array(1 + body.byteLength);
    plain[0] = kind;
    plain.set(body, 1);

    this.session
      .encrypt(plain)
      .then((frame) => {
        if (this.closed) return;
        this.opts.wire.send(toArrayBuffer(frame));
      })
      .catch((err) => this.fail(err));
  }

  public close(): void {
    this.closed = true;
    this.queuedFrames = [];
    this.session.close();
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private fail(err: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.queuedFrames = [];
    this.session.close();
    this.opts.onError(err instanceof Error ? err : new SecureChannelError('Secure channel failure'));
  }

  private sendHandshake(messages: HandshakeMessage[]): void {
    for (const message of messages) {
      this.opts.wire.send(JSON.stringify(message));
    }
  }

  private handleText(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.fail(new SecureChannelError('Rejected a message that was not encrypted'));
      return;
    }
    if (!isHandshakeMessage(parsed)) {
      // Downgrade protection: plaintext application messages are never accepted.
      this.fail(new SecureChannelError('Rejected an unencrypted application message'));
      return;
    }
    if (this.session.isReady) {
      this.fail(new SecureChannelError('Unexpected handshake message on an established channel'));
      return;
    }

    this.session
      .receive(parsed)
      .then((outgoing) => {
        if (this.closed) return;
        this.sendHandshake(outgoing);
        this.announceReadyIfNeeded();
      })
      .catch((err) => this.fail(err));
  }

  private handleFrame(frame: ArrayBuffer): void {
    if (this.session.isReady) {
      this.deliverFrame(frame);
      return;
    }
    // The peer can finish the handshake a moment before we do. Hold a few frames for that gap.
    if (this.session.state === 'awaiting-confirm' && this.queuedFrames.length < MAX_QUEUED_FRAMES) {
      this.queuedFrames.push(frame);
      return;
    }
    this.fail(new SecureChannelError('Received an encrypted message before the secure channel was ready'));
  }

  private announceReadyIfNeeded(): void {
    if (this.readyAnnounced || !this.session.isReady) return;
    this.readyAnnounced = true;
    this.opts.onReady({
      sas: this.session.sas ?? '',
      requiresSasConfirmation: this.session.requiresSasConfirmation,
    });

    if (this.queuedFrames.length > 0) {
      const frames = this.queuedFrames;
      this.queuedFrames = [];
      // Deliver on the next tick so the app can finish reacting to onReady first.
      setTimeout(() => {
        for (const frame of frames) {
          if (this.closed) return;
          this.deliverFrame(frame);
        }
      }, 0);
    }
  }

  private deliverFrame(frame: ArrayBuffer): void {
    this.session
      .decrypt(frame)
      .then((plain) => {
        if (this.closed) return;
        if (plain.byteLength < 1) throw new SecureChannelError('Empty message');
        const kind = plain[0];
        if (kind === KIND_TEXT) {
          let text: string;
          try {
            text = strictDecoder.decode(plain.subarray(1));
          } catch {
            throw new SecureChannelError('Invalid text message');
          }
          this.opts.onMessage(text);
        } else if (kind === KIND_BINARY) {
          this.opts.onMessage(toArrayBuffer(plain.slice(1)));
        } else {
          throw new SecureChannelError('Unknown message type');
        }
      })
      .catch((err) => this.fail(err));
  }
}
