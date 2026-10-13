import { describe, expect, it, vi } from 'vitest';
import {
  SecureTransport,
  type SecureTransportOptions,
  type SecureWire,
} from '../src/lib/secureTransport';

type RawMessage = string | ArrayBuffer;
type Deliver = (data?: RawMessage) => void;
type Interceptor = (data: RawMessage, deliver: Deliver) => boolean;

function fingerprint(seed: number): string {
  const pairs = Array.from({ length: 32 }, (_, index) =>
    ((seed * 17 + index * 11) & 0xff).toString(16).padStart(2, '0').toUpperCase(),
  );
  return `sha-256 ${pairs.join(':')}`;
}

const FP_INITIATOR = fingerprint(1);
const FP_RESPONDER = fingerprint(2);

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition was not met within 300 polling attempts');
}

interface PairOptions {
  initiatorToResponder?: Interceptor;
  responderToInitiator?: Interceptor;
  initiatorRemoteFingerprint?: string;
  responderLocalFingerprint?: string;
}

function createPair(options: PairOptions = {}) {
  const endpoints: { initiator: SecureTransport | null; responder: SecureTransport | null } = {
    initiator: null,
    responder: null,
  };

  const makeWire = (from: 'initiator' | 'responder'): SecureWire => ({
    send(data) {
      const target = from === 'initiator' ? endpoints.responder : endpoints.initiator;
      if (!target) throw new Error('Wire target is not initialized');
      const interceptor =
        from === 'initiator'
          ? options.initiatorToResponder
          : options.responderToInitiator;
      const deliver: Deliver = (outgoing = data) => {
        queueMicrotask(() => target.handleRaw(outgoing));
      };
      if (!interceptor || !interceptor(data, deliver)) {
        deliver();
      }
    },
  });

  const callbacks = () => ({
    onMessage: vi.fn<(data: RawMessage) => void>(),
    onReady: vi.fn(),
    onError: vi.fn<(err: Error) => void>(),
  });
  const initiatorCallbacks = callbacks();
  const responderCallbacks = callbacks();

  const makeOptions = (
    role: 'initiator' | 'responder',
    callbackSet: ReturnType<typeof callbacks>,
  ): SecureTransportOptions => ({
    role,
    localFingerprint: role === 'initiator' ? FP_INITIATOR : options.responderLocalFingerprint ?? FP_RESPONDER,
    remoteFingerprint:
      role === 'initiator'
        ? options.initiatorRemoteFingerprint ?? FP_RESPONDER
        : FP_INITIATOR,
    wire: makeWire(role),
    ...callbackSet,
  });

  const initiator = new SecureTransport(makeOptions('initiator', initiatorCallbacks));
  const responder = new SecureTransport(makeOptions('responder', responderCallbacks));
  endpoints.initiator = initiator;
  endpoints.responder = responder;

  return {
    initiator,
    responder,
    initiatorCallbacks,
    responderCallbacks,
    async start() {
      await Promise.all([responder.start(), initiator.start()]);
    },
    async ready() {
      await this.start();
      await waitFor(() => initiator.isReady && responder.isReady);
    },
  };
}

describe('SecureTransport', () => {
  it('completes the handshake with the same SAS on both peers exactly once', async () => {
    const pair = createPair();
    await pair.ready();

    expect(pair.initiatorCallbacks.onReady).toHaveBeenCalledOnce();
    expect(pair.responderCallbacks.onReady).toHaveBeenCalledOnce();

    const initiatorInfo = pair.initiatorCallbacks.onReady.mock.calls[0][0];
    const responderInfo = pair.responderCallbacks.onReady.mock.calls[0][0];
    expect(initiatorInfo.sas).toMatch(/^\d{4} \d{4}$/);
    expect(responderInfo.sas).toBe(initiatorInfo.sas);
    expect(initiatorInfo.requiresSasConfirmation).toBe(true);
    expect(responderInfo.requiresSasConfirmation).toBe(true);
  });

  it('round-trips unicode text and exact binary subarray bytes in both directions', async () => {
    const pair = createPair();
    await pair.ready();
    const initiatorReceived: RawMessage[] = [];
    const responderReceived: RawMessage[] = [];
    pair.initiatorCallbacks.onMessage.mockImplementation((data) => initiatorReceived.push(data));
    pair.responderCallbacks.onMessage.mockImplementation((data) => responderReceived.push(data));

    pair.initiator.send('こんにちは 🌍 — привет');
    const backingFromInitiator = new Uint8Array([9, 10, 11, 12, 13]);
    pair.initiator.send(backingFromInitiator.subarray(1, 4));
    pair.responder.send('café 🧪 — مرحبا');
    const backingFromResponder = new Uint8Array([21, 22, 23, 24, 25]);
    pair.responder.send(backingFromResponder.subarray(2, 4));

    await waitFor(() => initiatorReceived.length === 2 && responderReceived.length === 2);
    expect(responderReceived[0]).toBe('こんにちは 🌍 — привет');
    expect(responderReceived[1]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(responderReceived[1] as ArrayBuffer))).toEqual([10, 11, 12]);
    expect(initiatorReceived[0]).toBe('café 🧪 — مرحبا');
    expect(initiatorReceived[1]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(initiatorReceived[1] as ArrayBuffer))).toEqual([23, 24]);
  });

  it('delivers 50 mixed text and binary messages in send order', async () => {
    const pair = createPair();
    await pair.ready();
    const received: string[] = [];
    pair.responderCallbacks.onMessage.mockImplementation((data) => {
      received.push(
        typeof data === 'string'
          ? data
          : `b:${Array.from(new Uint8Array(data)).join(',')}`,
      );
    });

    const expected: string[] = [];
    for (let index = 0; index < 50; index++) {
      if (index % 2 === 0) {
        const message = `text-${index}`;
        expected.push(message);
        pair.initiator.send(message);
      } else {
        const bytes = new Uint8Array([index, 255 - index]);
        expected.push(`b:${Array.from(bytes).join(',')}`);
        pair.initiator.send(bytes);
      }
    }

    await waitFor(() => received.length === expected.length);
    expect(received).toEqual(expected);
  });

  it('rejects plaintext after ready and fails closed on further input', async () => {
    const pair = createPair();
    await pair.ready();

    pair.responder.handleRaw('{"type":"text","body":"hi"}');
    expect(pair.responderCallbacks.onError).toHaveBeenCalledOnce();
    expect(pair.responderCallbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Rejected an unencrypted application message' }),
    );
    expect(pair.responder.isClosed).toBe(true);
    expect(pair.responderCallbacks.onMessage).not.toHaveBeenCalled();

    pair.responder.handleRaw('not json');
    expect(pair.responderCallbacks.onError).toHaveBeenCalledOnce();
    expect(() => pair.responder.send('after close')).toThrow();
  });

  it('rejects plaintext JSON before the handshake finishes', async () => {
    const pair = createPair();
    await pair.responder.start();

    pair.responder.handleRaw('{"type":"text","body":"early"}');

    expect(pair.responderCallbacks.onError).toHaveBeenCalledOnce();
    expect(pair.responder.isClosed).toBe(true);
  });

  it('rejects non-JSON text', async () => {
    const pair = createPair();
    await pair.responder.start();

    pair.responder.handleRaw('plain text');

    expect(pair.responderCallbacks.onError).toHaveBeenCalledOnce();
    expect(pair.responder.isClosed).toBe(true);
  });

  it('rejects a tampered encrypted frame without delivering it', async () => {
    const pair = createPair({
      initiatorToResponder: (data, deliver) => {
        if (!(data instanceof ArrayBuffer)) return false;
        const tampered = data.slice(0);
        new Uint8Array(tampered)[tampered.byteLength - 1] ^= 1;
        deliver(tampered);
        return true;
      },
    });
    await pair.ready();

    pair.initiator.send('tamper me');
    await waitFor(() => pair.responderCallbacks.onError.mock.calls.length > 0);

    expect(pair.responderCallbacks.onError).toHaveBeenCalledOnce();
    expect(pair.responderCallbacks.onMessage).not.toHaveBeenCalled();
  });

  it('rejects a replayed encrypted frame', async () => {
    let capturedFrame: ArrayBuffer | null = null;
    const pair = createPair({
      initiatorToResponder: (data, deliver) => {
        if (!(data instanceof ArrayBuffer)) return false;
        capturedFrame = data.slice(0);
        deliver(data);
        return true;
      },
    });
    await pair.ready();

    pair.initiator.send('once');
    await waitFor(() => pair.responderCallbacks.onMessage.mock.calls.length > 0);
    expect(capturedFrame).toBeInstanceOf(ArrayBuffer);

    pair.responder.handleRaw(capturedFrame as ArrayBuffer);
    await waitFor(() => pair.responderCallbacks.onError.mock.calls.length > 0);

    expect(pair.responderCallbacks.onError).toHaveBeenCalledOnce();
    expect(pair.responder.isClosed).toBe(true);
  });

  it('queues early encrypted frames until the held initiator confirmation arrives', async () => {
    let releaseConfirmation: (() => void) | null = null;
    const pair = createPair({
      initiatorToResponder: (data, deliver) => {
        if (typeof data !== 'string') return false;
        const parsed = JSON.parse(data) as { type?: string };
        if (parsed.type !== 'hs-confirm') return false;
        releaseConfirmation = () => deliver();
        return true;
      },
    });

    await pair.start();
    await waitFor(() => pair.initiator.isReady && releaseConfirmation !== null);
    pair.initiator.send('early');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(pair.responder.isReady).toBe(false);
    expect(pair.responderCallbacks.onMessage).not.toHaveBeenCalled();
    (releaseConfirmation as () => void)();
    await waitFor(() => pair.responder.isReady && pair.responderCallbacks.onMessage.mock.calls.length === 1);

    expect(pair.responderCallbacks.onMessage).toHaveBeenCalledWith('early');
  });

  it('fails when more than 64 encrypted frames arrive before ready', async () => {
    let releaseConfirmation: (() => void) | null = null;
    const pair = createPair({
      initiatorToResponder: (data, deliver) => {
        if (typeof data !== 'string') return false;
        const parsed = JSON.parse(data) as { type?: string };
        if (parsed.type !== 'hs-confirm') return false;
        releaseConfirmation = () => deliver();
        return true;
      },
    });

    await pair.start();
    await waitFor(() => pair.initiator.isReady && releaseConfirmation !== null);
    for (let index = 0; index < 65; index++) {
      pair.initiator.send(`queued-${index}`);
    }

    await waitFor(() => pair.responderCallbacks.onError.mock.calls.length > 0);
    expect(pair.responderCallbacks.onError).toHaveBeenCalledOnce();
    expect(pair.responder.isClosed).toBe(true);
    expect(pair.responderCallbacks.onMessage).not.toHaveBeenCalled();
  });

  it('rejects a handshake message after ready', async () => {
    const pair = createPair();
    await pair.ready();

    pair.responder.handleRaw(JSON.stringify({ type: 'hs-commit', commit: 'valid-shape' }));
    expect(pair.responderCallbacks.onError).toHaveBeenCalledOnce();
    expect(pair.responder.isClosed).toBe(true);
  });

  it('throws when sending before ready or after close', async () => {
    const pair = createPair();
    expect(() => pair.initiator.send('too soon')).toThrow();

    await pair.ready();
    pair.initiator.close();
    expect(() => pair.initiator.send('after close')).toThrow();
  });

  it('reports a wire send exception during the handshake exactly once', async () => {
    const onError = vi.fn();
    const transport = new SecureTransport({
      role: 'initiator',
      localFingerprint: FP_INITIATOR,
      remoteFingerprint: FP_RESPONDER,
      wire: {
        send() {
          throw new Error('wire failed');
        },
      },
      onMessage: vi.fn(),
      onReady: vi.fn(),
      onError,
    });

    await transport.start();

    expect(onError).toHaveBeenCalledOnce();
    expect(transport.isClosed).toBe(true);
  });

  it('throws during construction for an invalid fingerprint', () => {
    expect(
      () =>
        new SecureTransport({
          role: 'initiator',
          localFingerprint: 'not a fingerprint',
          remoteFingerprint: FP_RESPONDER,
          wire: { send: vi.fn() },
          onMessage: vi.fn(),
          onReady: vi.fn(),
          onError: vi.fn(),
        }),
    ).toThrow();
  });

  it('rejects a fingerprint mismatch without delivering application messages', async () => {
    const pair = createPair({
      initiatorRemoteFingerprint: FP_RESPONDER,
      responderLocalFingerprint: fingerprint(3),
    });
    await pair.start();
    await waitFor(
      () =>
        pair.initiatorCallbacks.onError.mock.calls.length > 0 ||
        pair.responderCallbacks.onError.mock.calls.length > 0,
    );

    expect(
      pair.initiatorCallbacks.onError.mock.calls.length +
        pair.responderCallbacks.onError.mock.calls.length,
    ).toBeGreaterThan(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(pair.initiatorCallbacks.onMessage).not.toHaveBeenCalled();
    expect(pair.responderCallbacks.onMessage).not.toHaveBeenCalled();
  });
});
