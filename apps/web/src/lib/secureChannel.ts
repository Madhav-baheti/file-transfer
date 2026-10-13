/**
 * QuickDrop secure channel (Phase 5).
 *
 * End-to-end encryption between two browsers over the WebRTC data channel, using only
 * the platform's Web Crypto API (no third-party crypto library).
 *
 * HANDSHAKE (commit-reveal ECDH, then key confirmation)
 *   initiator -> responder : hs-commit  (SHA-256 of its public key + nonce)
 *   responder -> initiator : hs-hello   (responder's ephemeral P-256 public key)
 *   initiator -> responder : hs-reveal  (public key + nonce; responder checks the commit)
 *   both      -> both      : hs-confirm (HMAC over the transcript, proves equal keys)
 *
 * KEY DERIVATION
 *   shared = ECDH(P-256)
 *   transcript = SHA-256(label, pubI, pubR, nonceI, fingerprintI, fingerprintR)
 *   HKDF-SHA-256(ikm = shared + optional pairing secret, salt = transcript) produces
 *   separate keys per direction, confirmation keys and the short authentication string.
 *
 * WHAT EACH PART DEFENDS AGAINST
 *   - Eavesdropper / passive server: ECDH with ephemeral keys, AES-256-GCM.
 *   - Active attacker who controls signaling AND the network path: can run two separate
 *     handshakes and relay. Key confirmation does NOT detect that. Two things do:
 *       1) the pairing secret from the QR code (never sent to a server): without it the
 *          attacker cannot derive the keys, so confirmation fails;
 *       2) for code-only pairing (no secret), the short authentication string (SAS) that
 *          both users must compare. The commit-reveal step stops the attacker from
 *          grinding keys until both SAS values match.
 *   - Replay, reordering, truncation, tampering: strict per-direction counters, AES-GCM
 *     authentication, and fail-closed behaviour on any error.
 *
 * LIMITS (be honest in the README)
 *   - Hides content, not metadata: IP addresses, sizes and timing are visible.
 *   - Code-only pairing is only as strong as the user's SAS comparison.
 *   - No long-term identity keys: each session is fresh (forward secrecy by design).
 */

type Bytes = Uint8Array<ArrayBuffer>;

export class SecureChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecureChannelError';
  }
}

export type Role = 'initiator' | 'responder';

export type HandshakeMessage =
  | { type: 'hs-commit'; commit: string }
  | { type: 'hs-hello'; pub: string }
  | { type: 'hs-reveal'; pub: string; nonce: string }
  | { type: 'hs-confirm'; mac: string };

export type SessionState =
  | 'idle'
  | 'awaiting-hello'
  | 'awaiting-commit'
  | 'awaiting-reveal'
  | 'awaiting-confirm'
  | 'ready'
  | 'failed'
  | 'closed';

export interface SecureSessionParams {
  role: Role;
  /** DTLS certificate fingerprint from OUR SDP, e.g. "sha-256 AB:CD:..." */
  localFingerprint: string;
  /** DTLS certificate fingerprint from the PEER's SDP */
  remoteFingerprint: string;
  /** Pairing secret from the QR code (at least 16 random bytes). Omit for code-only pairing. */
  psk?: Uint8Array;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PUBLIC_KEY_BYTES = 65; // uncompressed P-256 point
const NONCE_BYTES = 32;
const HASH_BYTES = 32;
const MAC_BYTES = 32;
const COUNTER_BYTES = 8;
const TAG_BYTES = 16;
const MIN_PSK_BYTES = 16;
const FRAME_VERSION = 1;

const encoder = new TextEncoder();
const EMPTY: Bytes = new Uint8Array(0);

// ─── Small helpers ────────────────────────────────────────────────────────────

function subtleCrypto(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new SecureChannelError('Web Crypto is not available (a secure context is required)');
  }
  return c.subtle;
}

function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function asBytes(input: ArrayBuffer | Uint8Array): Bytes {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function concat(...parts: Uint8Array[]): Bytes {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** Unambiguous encoding: each part is preceded by its 4-byte big-endian length. */
function lengthPrefixed(...parts: Uint8Array[]): Bytes {
  const pieces: Uint8Array[] = [];
  for (const p of parts) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, p.byteLength);
    pieces.push(len, p);
  }
  return concat(...pieces);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtleCrypto().digest('SHA-256', data));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Bytes {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new SecureChannelError('Invalid base64url value');
  }
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new SecureChannelError('Invalid base64url value');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function counterToBytes(counter: number): Bytes {
  const out = new Uint8Array(COUNTER_BYTES);
  new DataView(out.buffer).setBigUint64(0, BigInt(counter));
  return out;
}

function bytesToCounter(bytes: Uint8Array): number {
  const value = new DataView(bytes.buffer, bytes.byteOffset, COUNTER_BYTES).getBigUint64(0);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SecureChannelError('Message counter out of range');
  }
  return Number(value);
}

/** Random pairing secret for the QR code (put it in the URL fragment, never send it to a server). */
export function generatePairingSecret(): Bytes {
  return randomBytes(MIN_PSK_BYTES);
}

// ─── DTLS fingerprints ────────────────────────────────────────────────────────

const FINGERPRINT_PATTERN = /^sha-(256|384|512) [0-9A-F]{2}(?::[0-9A-F]{2})+$/;

/** Canonical form: lowercase algorithm, uppercase hex, e.g. "sha-256 AB:CD:...". */
export function normalizeFingerprint(raw: string): string {
  const trimmed = String(raw).trim();
  const space = trimmed.indexOf(' ');
  if (space < 0) throw new SecureChannelError('Invalid DTLS fingerprint');
  const normalized = `${trimmed.slice(0, space).toLowerCase()} ${trimmed.slice(space + 1).trim().toUpperCase()}`;
  if (!FINGERPRINT_PATTERN.test(normalized)) {
    throw new SecureChannelError('Invalid DTLS fingerprint');
  }
  return normalized;
}

/** Reads the first a=fingerprint line of an SDP. Returns null when there is none. */
export function extractFingerprint(sdp: string): string | null {
  const match = /^a=fingerprint:([A-Za-z0-9-]+)[ \t]+([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2})+)[ \t]*\r?$/m.exec(sdp);
  if (!match) return null;
  try {
    return normalizeFingerprint(`${match[1]} ${match[2]}`);
  } catch {
    return null;
  }
}

// ─── Handshake message validation ─────────────────────────────────────────────

export function isHandshakeMessage(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { type?: unknown }).type === 'string' &&
    (raw as { type: string }).type.startsWith('hs-')
  );
}

export function parseHandshakeMessage(raw: unknown): HandshakeMessage {
  if (typeof raw !== 'object' || raw === null) {
    throw new SecureChannelError('Malformed handshake message');
  }
  const m = raw as Record<string, unknown>;
  const str = (key: string): string => {
    const v = m[key];
    if (typeof v !== 'string' || v.length === 0 || v.length > 200) {
      throw new SecureChannelError('Malformed handshake message');
    }
    return v;
  };
  switch (m.type) {
    case 'hs-commit':
      return { type: 'hs-commit', commit: str('commit') };
    case 'hs-hello':
      return { type: 'hs-hello', pub: str('pub') };
    case 'hs-reveal':
      return { type: 'hs-reveal', pub: str('pub'), nonce: str('nonce') };
    case 'hs-confirm':
      return { type: 'hs-confirm', mac: str('mac') };
    default:
      throw new SecureChannelError('Unknown handshake message');
  }
}

function decodeExact(text: string, length: number): Bytes {
  const bytes = fromBase64Url(text);
  if (bytes.byteLength !== length) throw new SecureChannelError('Handshake value has the wrong size');
  return bytes;
}

function decodePublicKey(text: string): Bytes {
  const bytes = decodeExact(text, PUBLIC_KEY_BYTES);
  if (bytes[0] !== 4) throw new SecureChannelError('Invalid public key');
  return bytes;
}

// ─── Session ──────────────────────────────────────────────────────────────────

interface DerivedKeys {
  sendKey: CryptoKey;
  recvKey: CryptoKey;
  sendIvPrefix: Bytes;
  recvIvPrefix: Bytes;
  ownMacKey: CryptoKey;
  peerMacKey: CryptoKey;
  transcript: Bytes;
}

function formatSas(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  const digits = (value % 100000000n).toString().padStart(8, '0');
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

export class SecureSession {
  private readonly role: Role;
  private readonly fpLocal: string;
  private readonly fpRemote: string;
  private readonly psk: Bytes | null;

  private _state: SessionState = 'idle';
  private keyPair: CryptoKeyPair | null = null;
  private ownPub: Bytes | null = null;
  private ownNonce: Bytes | null = null; // initiator
  private peerCommit: Bytes | null = null; // responder
  private keys: DerivedKeys | null = null;
  private _sas: string | null = null;

  private sendCounter = 0;
  private recvCounter = 0;
  private handshakeChain: Promise<unknown> = Promise.resolve();
  private sendChain: Promise<unknown> = Promise.resolve();
  private recvChain: Promise<unknown> = Promise.resolve();

  constructor(params: SecureSessionParams) {
    if (params.role !== 'initiator' && params.role !== 'responder') {
      throw new SecureChannelError('Invalid role');
    }
    if (params.psk !== undefined && params.psk.byteLength < MIN_PSK_BYTES) {
      throw new SecureChannelError('Pairing secret is too short');
    }
    this.role = params.role;
    this.fpLocal = normalizeFingerprint(params.localFingerprint);
    this.fpRemote = normalizeFingerprint(params.remoteFingerprint);
    this.psk = params.psk ? asBytes(params.psk) : null;
  }

  public get state(): SessionState {
    return this._state;
  }

  public get isReady(): boolean {
    return this._state === 'ready';
  }

  /** True when pairing used only the short code, so users MUST compare the SAS. */
  public get requiresSasConfirmation(): boolean {
    return this.psk === null;
  }

  /** Short authentication string like "4821 0937". Only available once the session is ready. */
  public get sas(): string | null {
    return this._state === 'ready' ? this._sas : null;
  }

  /** Initiator: returns the first message to send. Responder: returns nothing. */
  public async start(): Promise<HandshakeMessage[]> {
    if (this._state !== 'idle') throw new SecureChannelError('Handshake already started');
    try {
      if (this.role === 'initiator') {
        await this.generateOwnKey();
        this.ownNonce = randomBytes(NONCE_BYTES);
        const commit = await sha256(concat(this.ownPub as Bytes, this.ownNonce));
        this._state = 'awaiting-hello';
        return [{ type: 'hs-commit', commit: toBase64Url(commit) }];
      }
      this._state = 'awaiting-commit';
      return [];
    } catch (err) {
      throw this.failWith(err);
    }
  }

  /** Feed a handshake message from the peer. Returns the messages to send back (in order). */
  public receive(raw: unknown): Promise<HandshakeMessage[]> {
    const run = this.handshakeChain.then(() => this.handleMessage(raw));
    this.handshakeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Encrypts one message. Frames MUST be sent in the order encrypt() was called. */
  public encrypt(plaintext: Uint8Array, aad: Uint8Array = EMPTY): Promise<Bytes> {
    try {
      this.assertReady();
      if (this.sendCounter >= Number.MAX_SAFE_INTEGER) {
        throw new SecureChannelError('Message limit reached for this session');
      }
      const counter = this.sendCounter++; // allocated synchronously: never reused
      const data = asBytes(plaintext);
      const extra = asBytes(aad);
      const run = this.sendChain.then(() => this.seal(counter, data, extra));
      this.sendChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** Decrypts one frame. Frames must arrive in order; any gap, replay or tamper fails the session. */
  public decrypt(frame: Uint8Array | ArrayBuffer, aad: Uint8Array = EMPTY): Promise<Bytes> {
    try {
      this.assertReady();
      const bytes = asBytes(frame);
      if (bytes.byteLength < COUNTER_BYTES + TAG_BYTES) {
        throw this.failWith(new SecureChannelError('Encrypted frame is too short'));
      }
      const counter = bytesToCounter(bytes);
      if (counter !== this.recvCounter) {
        throw this.failWith(new SecureChannelError('Unexpected message counter (replayed, dropped or reordered frame)'));
      }
      this.recvCounter++; // checked and advanced synchronously, before any await
      const extra = asBytes(aad);
      const run = this.recvChain.then(() => this.open(bytes, extra));
      this.recvChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    } catch (err) {
      return Promise.reject(err);
    }
  }

  public close(): void {
    this._state = 'closed';
    this.keys = null;
    this.keyPair = null;
    this._sas = null;
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private assertReady(): void {
    if (this._state !== 'ready' || !this.keys) {
      throw new SecureChannelError('Secure channel is not ready');
    }
  }

  private failWith(err: unknown): SecureChannelError {
    if (this._state !== 'closed') this._state = 'failed';
    this.keys = null;
    this._sas = null;
    return err instanceof SecureChannelError ? err : new SecureChannelError('Secure channel failure');
  }

  private async generateOwnKey(): Promise<void> {
    const subtle = subtleCrypto();
    this.keyPair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    this.ownPub = new Uint8Array(await subtle.exportKey('raw', this.keyPair.publicKey));
  }

  private async handleMessage(raw: unknown): Promise<HandshakeMessage[]> {
    try {
      const msg = parseHandshakeMessage(raw);
      if (this._state === 'failed' || this._state === 'closed') {
        throw new SecureChannelError('Session is not active');
      }
      return this.role === 'initiator' ? await this.initiatorStep(msg) : await this.responderStep(msg);
    } catch (err) {
      throw this.failWith(err);
    }
  }

  private async initiatorStep(msg: HandshakeMessage): Promise<HandshakeMessage[]> {
    if (this._state === 'awaiting-hello' && msg.type === 'hs-hello') {
      const peerPub = decodePublicKey(msg.pub);
      await this.deriveAll(peerPub, this.ownPub as Bytes, peerPub, this.ownNonce as Bytes);
      this._state = 'awaiting-confirm';
      return [
        { type: 'hs-reveal', pub: toBase64Url(this.ownPub as Bytes), nonce: toBase64Url(this.ownNonce as Bytes) },
        { type: 'hs-confirm', mac: toBase64Url(await this.macFor('own')) },
      ];
    }
    if (this._state === 'awaiting-confirm' && msg.type === 'hs-confirm') {
      await this.verifyPeerConfirm(msg.mac);
      this._state = 'ready';
      return [];
    }
    throw new SecureChannelError('Unexpected handshake message');
  }

  private async responderStep(msg: HandshakeMessage): Promise<HandshakeMessage[]> {
    if (this._state === 'awaiting-commit' && msg.type === 'hs-commit') {
      this.peerCommit = decodeExact(msg.commit, HASH_BYTES);
      await this.generateOwnKey();
      this._state = 'awaiting-reveal';
      return [{ type: 'hs-hello', pub: toBase64Url(this.ownPub as Bytes) }];
    }
    if (this._state === 'awaiting-reveal' && msg.type === 'hs-reveal') {
      const peerPub = decodePublicKey(msg.pub);
      const peerNonce = decodeExact(msg.nonce, NONCE_BYTES);
      const expected = await sha256(concat(peerPub, peerNonce));
      if (!this.peerCommit || !equalBytes(expected, this.peerCommit)) {
        throw new SecureChannelError('Handshake commitment does not match');
      }
      await this.deriveAll(peerPub, peerPub, this.ownPub as Bytes, peerNonce);
      this._state = 'awaiting-confirm';
      return [{ type: 'hs-confirm', mac: toBase64Url(await this.macFor('own')) }];
    }
    if (this._state === 'awaiting-confirm' && msg.type === 'hs-confirm') {
      await this.verifyPeerConfirm(msg.mac);
      this._state = 'ready';
      return [];
    }
    throw new SecureChannelError('Unexpected handshake message');
  }

  /** pubI / pubR / nonceI are in initiator-responder order, whatever our own role is. */
  private async deriveAll(peerPub: Bytes, pubI: Bytes, pubR: Bytes, nonceI: Bytes): Promise<void> {
    const subtle = subtleCrypto();
    if (!this.keyPair) throw new SecureChannelError('Missing key pair');

    const peerKey = await subtle.importKey('raw', peerPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(
      await subtle.deriveBits({ name: 'ECDH', public: peerKey }, this.keyPair.privateKey, 256),
    );

    const fpI = this.role === 'initiator' ? this.fpLocal : this.fpRemote;
    const fpR = this.role === 'initiator' ? this.fpRemote : this.fpLocal;
    const transcript = await sha256(
      lengthPrefixed(encoder.encode('quickdrop/v1/transcript'), pubI, pubR, nonceI, encoder.encode(fpI), encoder.encode(fpR)),
    );

    const ikm = await subtle.importKey('raw', lengthPrefixed(shared, this.psk ?? EMPTY), 'HKDF', false, ['deriveBits']);
    const derive = async (label: string, byteLength: number): Promise<Bytes> =>
      new Uint8Array(
        await subtle.deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt: transcript, info: encoder.encode(label) },
          ikm,
          byteLength * 8,
        ),
      );

    const keyI2R = await derive('quickdrop/v1/key/i2r', 32);
    const keyR2I = await derive('quickdrop/v1/key/r2i', 32);
    const ivI2R = await derive('quickdrop/v1/iv/i2r', 4);
    const ivR2I = await derive('quickdrop/v1/iv/r2i', 4);
    const macI = await derive('quickdrop/v1/confirm/i', MAC_BYTES);
    const macR = await derive('quickdrop/v1/confirm/r', MAC_BYTES);
    const sasBytes = await derive('quickdrop/v1/sas', 8);

    const importAes = (raw: Bytes, usage: 'encrypt' | 'decrypt') =>
      subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
    const importMac = (raw: Bytes) =>
      subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

    const initiator = this.role === 'initiator';
    this.keys = {
      sendKey: await importAes(initiator ? keyI2R : keyR2I, 'encrypt'),
      recvKey: await importAes(initiator ? keyR2I : keyI2R, 'decrypt'),
      sendIvPrefix: initiator ? ivI2R : ivR2I,
      recvIvPrefix: initiator ? ivR2I : ivI2R,
      ownMacKey: await importMac(initiator ? macI : macR),
      peerMacKey: await importMac(initiator ? macR : macI),
      transcript,
    };
    this._sas = formatSas(sasBytes);
    // The ephemeral private key is no longer needed.
    this.keyPair = null;
  }

  private confirmInput(): Bytes {
    if (!this.keys) throw new SecureChannelError('Keys are not derived yet');
    return concat(encoder.encode('quickdrop/v1/confirm'), this.keys.transcript);
  }

  private async macFor(which: 'own'): Promise<Bytes> {
    if (!this.keys) throw new SecureChannelError('Keys are not derived yet');
    const key = which === 'own' ? this.keys.ownMacKey : this.keys.peerMacKey;
    return new Uint8Array(await subtleCrypto().sign('HMAC', key, this.confirmInput()));
  }

  private async verifyPeerConfirm(macText: string): Promise<void> {
    if (!this.keys) throw new SecureChannelError('Keys are not derived yet');
    const mac = decodeExact(macText, MAC_BYTES);
    const ok = await subtleCrypto().verify('HMAC', this.keys.peerMacKey, mac, this.confirmInput());
    if (!ok) throw new SecureChannelError('Key confirmation failed');
  }

  private buildAad(extra: Uint8Array): Bytes {
    return concat(new Uint8Array([FRAME_VERSION]), extra);
  }

  private async seal(counter: number, plaintext: Bytes, aad: Bytes): Promise<Bytes> {
    try {
      this.assertReady();
      const keys = this.keys as DerivedKeys;
      const counterBytes = counterToBytes(counter);
      const iv = concat(keys.sendIvPrefix, counterBytes);
      const sealed = new Uint8Array(
        await subtleCrypto().encrypt(
          { name: 'AES-GCM', iv, additionalData: this.buildAad(aad), tagLength: 128 },
          keys.sendKey,
          plaintext,
        ),
      );
      return concat(counterBytes, sealed);
    } catch (err) {
      throw this.failWith(err);
    }
  }

  private async open(frame: Bytes, aad: Bytes): Promise<Bytes> {
    try {
      this.assertReady();
      const keys = this.keys as DerivedKeys;
      const counterBytes = frame.slice(0, COUNTER_BYTES);
      const iv = concat(keys.recvIvPrefix, counterBytes);
      return new Uint8Array(
        await subtleCrypto().decrypt(
          { name: 'AES-GCM', iv, additionalData: this.buildAad(aad), tagLength: 128 },
          keys.recvKey,
          frame.slice(COUNTER_BYTES),
        ),
      );
    } catch (err) {
      throw this.failWith(new SecureChannelError(err instanceof SecureChannelError ? err.message : 'Decryption failed (message was altered)'));
    }
  }
}
