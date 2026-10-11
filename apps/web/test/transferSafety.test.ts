import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeFilename,
  validateFileOffer,
  exactBuffer,
  FileReceiver,
  FileSender,
} from '../src/lib/transfer';
import {
  encodeChunk,
  normalizeFileId,
  PlaintextTransportCodec,
  type FileOfferMsg,
  type TransportCodec,
} from '../src/lib/protocol';

const FILE_ID = normalizeFileId(crypto.randomUUID());

function makeOffer(size: number): FileOfferMsg {
  return { type: 'file-offer', id: FILE_ID, name: 'x.bin', size, mime: 'application/octet-stream' };
}

function wire(index: number, bytes: Uint8Array): Uint8Array {
  return PlaintextTransportCodec.encodeBinary(encodeChunk(FILE_ID, index, bytes));
}

describe('sanitizeFilename', () => {
  it('replaces path separators and forbidden characters', () => {
    expect(sanitizeFilename('a/b\\c.txt')).toBe('a_b_c.txt');
    expect(sanitizeFilename('..\\..\\evil.exe')).toBe('.._.._evil.exe');
  });

  it('removes direction-override characters that disguise extensions', () => {
    expect(sanitizeFilename('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
    expect(sanitizeFilename('a\u200Bb\uFEFFc.txt')).toBe('abc.txt');
  });

  it('strips trailing dots and spaces', () => {
    expect(sanitizeFilename('report.pdf. ')).toBe('report.pdf');
    expect(sanitizeFilename('..')).toBe('download');
    expect(sanitizeFilename('   ')).toBe('download');
  });

  it('prefixes Windows reserved device names', () => {
    expect(sanitizeFilename('con.txt')).toBe('_con.txt');
    expect(sanitizeFilename('NUL')).toBe('_NUL');
    expect(sanitizeFilename('LPT1.log')).toBe('_LPT1.log');
    expect(sanitizeFilename('console.txt')).toBe('console.txt');
  });

  it('caps the length at 255 characters and keeps a short extension', () => {
    const result = sanitizeFilename('a'.repeat(400) + '.pdf');
    expect(result.length).toBeLessThanOrEqual(255);
    expect(result.endsWith('.pdf')).toBe(true);
  });
});

describe('validateFileOffer', () => {
  it('accepts a normal offer', () => {
    expect(validateFileOffer(makeOffer(1234))).toBeNull();
    expect(validateFileOffer(makeOffer(0))).toBeNull();
  });

  it('rejects bad sizes', () => {
    expect(validateFileOffer(makeOffer(-1))).not.toBeNull();
    expect(validateFileOffer(makeOffer(1.5))).not.toBeNull();
    expect(validateFileOffer(makeOffer(Number.NaN))).not.toBeNull();
    expect(validateFileOffer(makeOffer(2 ** 60))).not.toBeNull();
  });

  it('rejects over-long names and mime types', () => {
    expect(validateFileOffer({ ...makeOffer(1), name: 'n'.repeat(1025) })).not.toBeNull();
    expect(validateFileOffer({ ...makeOffer(1), mime: 'm'.repeat(256) })).not.toBeNull();
  });
});

describe('exactBuffer', () => {
  it('returns only the bytes of a view into a larger buffer', () => {
    const big = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = big.subarray(2, 5);
    const out = exactBuffer(view);
    expect(out.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(out))).toEqual([3, 4, 5]);
  });

  it('returns the same buffer when the view covers all of it', () => {
    const whole = new Uint8Array([9, 8, 7]);
    expect(exactBuffer(whole)).toBe(whole.buffer);
  });
});

describe('FileReceiver size bound', () => {
  it('fails as soon as the peer sends more than the offered size', async () => {
    const onError = vi.fn();
    const receiver = new FileReceiver({ offer: makeOffer(10), onError });

    await receiver.receiveChunk(wire(0, new Uint8Array(8)));
    expect(onError).not.toHaveBeenCalled();

    await receiver.receiveChunk(wire(1, new Uint8Array(8)));
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toContain('more data');
  });

  it('rejects an invalid offer on the first chunk', async () => {
    const onError = vi.fn();
    const receiver = new FileReceiver({ offer: makeOffer(-5), onError });
    await receiver.receiveChunk(wire(0, new Uint8Array(1)));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('ignores chunks after a failure', async () => {
    const onError = vi.fn();
    const receiver = new FileReceiver({ offer: makeOffer(4), onError });
    await receiver.receiveChunk(wire(0, new Uint8Array(8))); // too big, fails
    await receiver.receiveChunk(wire(0, new Uint8Array(2)));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('FileSender sends exact bytes', () => {
  it('does not leak extra bytes when the codec returns a view into a larger buffer', async () => {
    const send = vi.fn();
    const channel = {
      readyState: 'open',
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      send,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as RTCDataChannel;

    // Codec that returns a window into a larger buffer (like an encryption layer might)
    const windowedCodec: TransportCodec = {
      encodeControl: (m) => PlaintextTransportCodec.encodeControl(m),
      decodeBinary: (b) => PlaintextTransportCodec.decodeBinary(b),
      encodeBinary: (b) => {
        const big = new Uint8Array(b.byteLength + 12);
        big.set(b, 5);
        return big.subarray(5, 5 + b.byteLength);
      },
    };

    const payload = new Uint8Array([10, 20, 30, 40, 50]);
    const file = new File([payload], 'small.bin');
    const sender = new FileSender({ file, dataChannel: channel, codec: windowedCodec });
    await sender.start();

    const expectedLength = encodeChunk(sender.getOffer().id, 0, payload).byteLength;
    const binaryCalls = send.mock.calls.filter((c) => c[0] instanceof ArrayBuffer);
    expect(binaryCalls.length).toBeGreaterThanOrEqual(1);
    expect((binaryCalls[0][0] as ArrayBuffer).byteLength).toBe(expectedLength);
  });
});
