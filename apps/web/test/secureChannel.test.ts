import { describe, it, expect } from 'vitest';
import {
  SecureSession,
  SecureChannelError,
  extractFingerprint,
  normalizeFingerprint,
  generatePairingSecret,
  isHandshakeMessage,
  parseHandshakeMessage,
  toBase64Url,
  fromBase64Url,
  type HandshakeMessage,
  type SecureSessionParams,
} from '../src/lib/secureChannel';

// Builds a valid-looking DTLS fingerprint from a seed byte.
function fp(seed: number): string {
  const pairs: string[] = [];
  for (let i = 0; i < 32; i++) pairs.push(((seed * 7 + i * 13) & 0xff).toString(16).padStart(2, '0').toUpperCase());
  return `sha-256 ${pairs.join(':')}`;
}

const FP_A = fp(1);
const FP_B = fp(2);
const FP_M1 = fp(3);
const FP_M2 = fp(4);

const text = new TextEncoder();
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function makePair(opts: {
  pskA?: Uint8Array;
  pskB?: Uint8Array;
  fpAlocal?: string;
  fpAremote?: string;
  fpBlocal?: string;
  fpBremote?: string;
} = {}) {
  const a: SecureSessionParams = {
    role: 'initiator',
    localFingerprint: opts.fpAlocal ?? FP_A,
    remoteFingerprint: opts.fpAremote ?? FP_B,
    psk: opts.pskA,
  };
  const b: SecureSessionParams = {
    role: 'responder',
    localFingerprint: opts.fpBlocal ?? FP_B,
    remoteFingerprint: opts.fpBremote ?? FP_A,
    psk: opts.pskB,
  };
  return { a: new SecureSession(a), b: new SecureSession(b) };
}

/** Runs the whole handshake by relaying messages between the two sessions. */
async function runHandshake(a: SecureSession, b: SecureSession): Promise<void> {
  let toB: HandshakeMessage[] = await a.start();
  let toA: HandshakeMessage[] = await b.start();
  for (let round = 0; round < 10 && (toA.length > 0 || toB.length > 0); round++) {
    const nextToA: HandshakeMessage[] = [];
    const nextToB: HandshakeMessage[] = [];
    for (const m of toB) nextToA.push(...(await b.receive(m)));
    for (const m of toA) nextToB.push(...(await a.receive(m)));
    toA = nextToA;
    toB = nextToB;
  }
}

async function readyPair(psk?: Uint8Array) {
  const { a, b } = makePair({ pskA: psk, pskB: psk });
  await runHandshake(a, b);
  return { a, b };
}

describe('handshake', () => {
  it('reaches ready on both sides with identical SAS (code-only pairing)', async () => {
    const { a, b } = await readyPair();
    expect(a.state).toBe('ready');
    expect(b.state).toBe('ready');
    expect(a.sas).toMatch(/^\d{4} \d{4}$/);
    expect(a.sas).toBe(b.sas);
    expect(a.requiresSasConfirmation).toBe(true);
  });

  it('works with a pairing secret and reports that SAS is optional', async () => {
    const psk = generatePairingSecret();
    const { a, b } = await readyPair(psk);
    expect(a.state).toBe('ready');
    expect(b.state).toBe('ready');
    expect(a.sas).toBe(b.sas);
    expect(a.requiresSasConfirmation).toBe(false);
  });

  it('produces a different SAS in every session', async () => {
    const first = await readyPair();
    const second = await readyPair();
    expect(first.a.sas).not.toBe(second.a.sas);
  });

  it('does not expose the SAS before the session is ready', async () => {
    const { a } = makePair();
    expect(a.sas).toBeNull();
    await a.start();
    expect(a.sas).toBeNull();
  });

  it('fails when the two sides disagree about the pairing secret', async () => {
    const { a, b } = makePair({ pskA: generatePairingSecret(), pskB: generatePairingSecret() });
    await expect(runHandshake(a, b)).rejects.toThrow(SecureChannelError);
    expect([a.state, b.state]).toContain('failed');
  });

  it('fails when only one side has a pairing secret', async () => {
    const { a, b } = makePair({ pskA: generatePairingSecret() });
    await expect(runHandshake(a, b)).rejects.toThrow(SecureChannelError);
  });

  it('fails when the DTLS fingerprints do not match (connection-level mismatch)', async () => {
    const { a, b } = makePair({ fpBlocal: FP_M2 });
    await expect(runHandshake(a, b)).rejects.toThrow(SecureChannelError);
  });

  it('rejects a reveal whose nonce does not match the commitment', async () => {
    const { a, b } = makePair();
    const [commit] = await a.start();
    await b.start();
    const [hello] = await b.receive(commit);
    const [reveal] = await a.receive(hello);
    const forged = { ...reveal, nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(32))) };
    await expect(b.receive(forged)).rejects.toThrow(/commitment/);
    expect(b.state).toBe('failed');
  });

  it('rejects messages that arrive in the wrong state', async () => {
    const { b } = makePair();
    await b.start();
    await expect(b.receive({ type: 'hs-reveal', pub: 'AAAA', nonce: 'AAAA' })).rejects.toThrow(SecureChannelError);
    expect(b.state).toBe('failed');
  });

  it('rejects malformed handshake messages and bad public keys', async () => {
    const { b } = makePair();
    await b.start();
    await expect(b.receive({ type: 'hs-commit' })).rejects.toThrow(SecureChannelError);

    const c = makePair().a;
    await c.start();
    const bad = { type: 'hs-hello', pub: toBase64Url(new Uint8Array(65)) }; // not a valid point
    await expect(c.receive(bad)).rejects.toThrow(SecureChannelError);
    expect(c.state).toBe('failed');
  });

  it('refuses to start twice and refuses short pairing secrets', async () => {
    const { a } = makePair();
    await a.start();
    await expect(a.start()).rejects.toThrow(SecureChannelError);
    expect(() => new SecureSession({ role: 'initiator', localFingerprint: FP_A, remoteFingerprint: FP_B, psk: new Uint8Array(8) })).toThrow(
      SecureChannelError,
    );
  });
});

describe('active man-in-the-middle (signaling server swapping fingerprints and relaying)', () => {
  async function mitm(pskA?: Uint8Array, pskB?: Uint8Array, pskM?: Uint8Array) {
    const A = new SecureSession({ role: 'initiator', localFingerprint: FP_A, remoteFingerprint: FP_M1, psk: pskA });
    const M1 = new SecureSession({ role: 'responder', localFingerprint: FP_M1, remoteFingerprint: FP_A, psk: pskM });
    const M2 = new SecureSession({ role: 'initiator', localFingerprint: FP_M2, remoteFingerprint: FP_B, psk: pskM });
    const B = new SecureSession({ role: 'responder', localFingerprint: FP_B, remoteFingerprint: FP_M2, psk: pskB });
    return { A, M1, M2, B };
  }

  it('code-only pairing: both legs succeed, but the SAS values differ so users notice', async () => {
    const { A, M1, M2, B } = await mitm();
    await runHandshake(A, M1);
    await runHandshake(M2, B);
    expect(A.state).toBe('ready');
    expect(B.state).toBe('ready');
    // This is exactly why SAS comparison is mandatory without a QR secret.
    expect(A.sas).not.toBe(B.sas);
  });

  it('QR pairing: an attacker who does not know the secret cannot complete either leg', async () => {
    const secret = generatePairingSecret();
    const { A, M1, M2, B } = await mitm(secret, secret, undefined);
    await expect(runHandshake(A, M1)).rejects.toThrow(SecureChannelError);
    await expect(runHandshake(M2, B)).rejects.toThrow(SecureChannelError);
  });
});

describe('encryption', () => {
  it('round-trips messages in both directions', async () => {
    const { a, b } = await readyPair();
    const f1 = await a.encrypt(text.encode('hello from a'));
    expect(decode(await b.decrypt(f1))).toBe('hello from a');
    const f2 = await b.encrypt(text.encode('hello from b'));
    expect(decode(await a.decrypt(f2))).toBe('hello from b');
  });

  it('handles empty and large payloads', async () => {
    const { a, b } = await readyPair();
    expect((await b.decrypt(await a.encrypt(new Uint8Array(0)))).byteLength).toBe(0);
    const big = new Uint8Array(256 * 1024);
    for (let i = 0; i < big.length; i += 65536) crypto.getRandomValues(big.subarray(i, i + 65536));
    const out = await b.decrypt(await a.encrypt(big));
    expect(out.byteLength).toBe(big.byteLength);
    expect(Array.from(out.subarray(0, 64))).toEqual(Array.from(big.subarray(0, 64)));
  });

  it('does not leak the plaintext into the frame', async () => {
    const { a } = await readyPair();
    const secret = text.encode('top secret top secret top secret');
    const frame = await a.encrypt(secret);
    expect(toBase64Url(frame)).not.toContain(toBase64Url(secret).slice(0, 12));
    expect(frame.byteLength).toBe(8 + secret.byteLength + 16);
  });

  it('refuses to encrypt or decrypt before the handshake completes', async () => {
    const { a } = makePair();
    await expect(a.encrypt(text.encode('x'))).rejects.toThrow(/not ready/);
    await expect(a.decrypt(new Uint8Array(40))).rejects.toThrow(/not ready/);
  });

  it('uses a unique counter (and therefore nonce) for every message', async () => {
    const { a } = await readyPair();
    const frames = await Promise.all(Array.from({ length: 200 }, (_, i) => a.encrypt(text.encode(`m${i}`))));
    const counters = new Set(frames.map((f) => toBase64Url(f.slice(0, 8))));
    expect(counters.size).toBe(200);
  });

  it('numbers frames in call order even when called concurrently with different sizes', async () => {
    const { a, b } = await readyPair();
    const big = new Uint8Array(500_000);
    const pending = [a.encrypt(big), a.encrypt(text.encode('small-1')), a.encrypt(text.encode('small-2'))];
    const frames = await Promise.all(pending);
    const counters = frames.map((f) => new DataView(f.buffer, f.byteOffset).getBigUint64(0));
    expect(counters).toEqual([0n, 1n, 2n]);
    // And the receiver can decrypt them in order without awaiting each one.
    const plain = await Promise.all(frames.map((f) => b.decrypt(f)));
    expect(plain[0].byteLength).toBe(500_000);
    expect(decode(plain[1])).toBe('small-1');
    expect(decode(plain[2])).toBe('small-2');
  });

  it('binds optional associated data: wrong data fails', async () => {
    const { a, b } = await readyPair();
    const frame = await a.encrypt(text.encode('x'), text.encode('chat'));
    await expect(b.decrypt(frame, text.encode('file'))).rejects.toThrow(SecureChannelError);
    expect(b.state).toBe('failed');
  });

  it('accepts matching associated data', async () => {
    const { a, b } = await readyPair();
    const frame = await a.encrypt(text.encode('x'), text.encode('chat'));
    expect(decode(await b.decrypt(frame, text.encode('chat')))).toBe('x');
  });
});

describe('attacks on the encrypted stream (all must fail closed)', () => {
  it('detects a flipped ciphertext byte', async () => {
    const { a, b } = await readyPair();
    const frame = await a.encrypt(text.encode('pay 10 dollars'));
    frame[12] ^= 0x01;
    await expect(b.decrypt(frame)).rejects.toThrow(SecureChannelError);
    expect(b.state).toBe('failed');
    // Once failed, nothing else is accepted.
    await expect(b.encrypt(text.encode('x'))).rejects.toThrow(SecureChannelError);
  });

  it('detects a modified counter', async () => {
    const { a, b } = await readyPair();
    const frame = await a.encrypt(text.encode('x'));
    frame[7] = 5;
    await expect(b.decrypt(frame)).rejects.toThrow(SecureChannelError);
  });

  it('detects a truncated frame', async () => {
    const { a, b } = await readyPair();
    const frame = await a.encrypt(text.encode('some longer message here'));
    await expect(b.decrypt(frame.slice(0, frame.length - 3))).rejects.toThrow(SecureChannelError);
  });

  it('rejects frames shorter than counter plus tag', async () => {
    const { b } = await readyPair();
    await expect(b.decrypt(new Uint8Array(10))).rejects.toThrow(/too short/);
  });

  it('rejects a replayed frame', async () => {
    const { a, b } = await readyPair();
    const frame = await a.encrypt(text.encode('once'));
    expect(decode(await b.decrypt(frame))).toBe('once');
    await expect(b.decrypt(frame)).rejects.toThrow(/counter/);
    expect(b.state).toBe('failed');
  });

  it('rejects dropped and reordered frames', async () => {
    const { a, b } = await readyPair();
    const f0 = await a.encrypt(text.encode('0'));
    const f1 = await a.encrypt(text.encode('1'));
    await expect(b.decrypt(f1)).rejects.toThrow(/counter/);
    expect(b.state).toBe('failed');
    void f0;
  });

  it('rejects a frame reflected back to its sender', async () => {
    const { a } = await readyPair();
    const frame = await a.encrypt(text.encode('mine'));
    // The initiator's own first frame has counter 0, which the initiator itself expects next,
    // but it was sealed with the other direction's key, so it must not decrypt.
    await expect(a.decrypt(frame)).rejects.toThrow(SecureChannelError);
  });

  it('rejects frames after close()', async () => {
    const { a } = await readyPair();
    a.close();
    expect(a.state).toBe('closed');
    await expect(a.encrypt(text.encode('x'))).rejects.toThrow(SecureChannelError);
  });

  it('frames from one session cannot be read by another session', async () => {
    const one = await readyPair();
    const two = await readyPair();
    const frame = await one.a.encrypt(text.encode('private'));
    await expect(two.b.decrypt(frame)).rejects.toThrow(SecureChannelError);
  });
});

describe('fingerprints and encoding helpers', () => {
  const sdp = [
    'v=0',
    'o=- 123 2 IN IP4 127.0.0.1',
    'a=ice-ufrag:abcd',
    'a=fingerprint:sha-256 ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89',
    'a=setup:actpass',
  ].join('\r\n');

  it('extracts and normalizes the fingerprint from an SDP', () => {
    const f = extractFingerprint(sdp);
    expect(f).toBe(
      'sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
    );
  });

  it('returns null when there is no usable fingerprint', () => {
    expect(extractFingerprint('v=0\r\na=setup:actpass')).toBeNull();
    expect(extractFingerprint('a=fingerprint:sha-256 zz:zz')).toBeNull();
  });

  it('normalizes case and rejects garbage', () => {
    expect(normalizeFingerprint('SHA-256 aa:bb')).toBe('sha-256 AA:BB');
    expect(() => normalizeFingerprint('nonsense')).toThrow(SecureChannelError);
    expect(() => normalizeFingerprint('md5 AA:BB')).toThrow(SecureChannelError);
  });

  it('recognizes handshake messages', () => {
    expect(isHandshakeMessage({ type: 'hs-hello', pub: 'x' })).toBe(true);
    expect(isHandshakeMessage({ type: 'text', body: 'hi' })).toBe(false);
    expect(isHandshakeMessage(null)).toBe(false);
    expect(() => parseHandshakeMessage({ type: 'hs-unknown' })).toThrow(SecureChannelError);
  });

  it('round-trips base64url and rejects invalid input', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(70));
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
    expect(() => fromBase64Url('not valid!')).toThrow(SecureChannelError);
    expect(() => fromBase64Url('A')).toThrow(SecureChannelError);
  });

  it('generates a 16-byte random pairing secret', () => {
    const a = generatePairingSecret();
    const b = generatePairingSecret();
    expect(a.byteLength).toBe(16);
    expect(toBase64Url(a)).not.toBe(toBase64Url(b));
  });
});
