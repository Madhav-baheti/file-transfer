import { describe, it, expect, vi } from 'vitest';
import {
  FileSender,
  FileReceiver,
  sanitizeFilename,
} from '../src/lib/transfer';
import {
  ControlMessageSchema,
  encodeChunk,
  decodeChunk,
  type FileEndMsg,
  type FileOfferMsg,
} from '../src/lib/protocol';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

// ─── Mock RTCDataChannel for Sender ───────────────────────────────────────────

type MockDataChannel = RTCDataChannel & {
  emit: (event: string) => void;
  close: () => void;
  send: ReturnType<typeof vi.fn>;
};

function createMockDataChannel(initialBufferedAmount = 0): MockDataChannel {
  const listeners: Record<string, (() => void)[]> = {};
  let readyState: RTCDataChannelState = 'open';

  return {
    get readyState() {
      return readyState;
    },
    bufferedAmount: initialBufferedAmount,
    bufferedAmountLowThreshold: 0,
    send: vi.fn(),
    addEventListener: vi.fn((event: string, fn: () => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    }),
    removeEventListener: vi.fn((event: string, fn: () => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((cb) => cb !== fn);
      }
    }),
    emit: (event: string) => {
      if (listeners[event]) {
        for (const cb of [...listeners[event]]) {
          cb();
        }
      }
    },
    close: () => {
      readyState = 'closed';
      if (listeners.close) {
        for (const cb of [...listeners.close]) {
          cb();
        }
      }
    },
  } as unknown as MockDataChannel;
}

describe('File acknowledgement control message', () => {
  it('accepts valid acknowledgements and rejects invalid byte counts', () => {
    expect(
      ControlMessageSchema.safeParse({ type: 'file-ack', id: 'file-1', bytes: 4 * 1024 * 1024 })
        .success,
    ).toBe(true);
    expect(ControlMessageSchema.safeParse({ type: 'file-ack', id: 'file-1', bytes: -1 }).success)
      .toBe(false);
    expect(ControlMessageSchema.safeParse({ type: 'file-ack', id: 'file-1', bytes: 1.5 }).success)
      .toBe(false);
  });
});

describe('Filename Sanitization', () => {
  it('strips path separators, colons, and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFilename('C:\\Windows\\System32\\cmd.exe')).toBe('C__Windows_System32_cmd.exe');
    expect(sanitizeFilename('my:file*with?quotes"and<pipes>|')).toBe('my_file_with_quotes_and_pipes__');
    expect(sanitizeFilename('hello\x00\x1fworld.txt')).toBe('hello__world.txt');
  });

  it('provides a fallback for empty or whitespace-only names', () => {
    expect(sanitizeFilename('')).toBe('download');
    expect(sanitizeFilename('   ')).toBe('download');
    expect(sanitizeFilename('///')).toBe('___');
  });

  it('caps length at 255 characters while preserving short extensions', () => {
    const longName = 'a'.repeat(300) + '.pdf';
    const sanitized = sanitizeFilename(longName);
    expect(sanitized.length).toBeLessThanOrEqual(255);
    expect(sanitized.endsWith('.pdf')).toBe(true);
  });
});

describe('Chunk Encoding & Decoding', () => {
  it('round-trips binary chunks with 20-byte header', () => {
    const fileId = 'file1234567890ab';
    const chunkIndex = 42;
    const payload = new Uint8Array([10, 20, 30, 40, 50]);

    const encoded = encodeChunk(fileId, chunkIndex, payload);
    expect(encoded.byteLength).toBe(20 + 5);

    const decoded = decodeChunk(encoded);
    expect(decoded.fileId).toBe('file1234567890ab');
    expect(decoded.index).toBe(42);
    expect(Array.from(decoded.data)).toEqual([10, 20, 30, 40, 50]);
  });

  it('throws on chunk buffers smaller than 20 bytes', () => {
    const invalid = new Uint8Array([1, 2, 3]);
    expect(() => decodeChunk(invalid)).toThrow('Invalid chunk length');
  });
});

describe('FileSender Chunker & Backpressure', () => {
  it('chunks file and sends 16 KB frames with correct count', async () => {
    // 40 KB file -> 16 KB + 16 KB + 8 KB = 3 chunks
    const data = new Uint8Array(40 * 1024);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;

    const file = new File([data], 'test.bin', { type: 'application/octet-stream' });
    const channel = createMockDataChannel(0);

    const onProgress = vi.fn();
    const onCompleted = vi.fn();
    const onError = vi.fn();

    const sender = new FileSender({
      file,
      fileId: 'mock-file-12345',
      dataChannel: channel,
      onProgress,
      onCompleted,
      onError,
    });

    await sender.start();

    // 3 chunk sends + 1 file-end control message send = 4 sends total
    expect(channel.send).toHaveBeenCalledTimes(4);
    expect(onCompleted).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('handles backpressure: pauses above high water mark and resumes on bufferedamountlow', async () => {
    const data = new Uint8Array(50 * 1024);
    const file = new File([data], 'heavy.bin');
    // Start channel with bufferedAmount above 2 MB
    const channel = createMockDataChannel(3 * 1024 * 1024);

    const sender = new FileSender({
      file,
      dataChannel: channel,
    });

    let completed = false;
    const transferPromise = sender.start().then(() => {
      completed = true;
    });

    // Transfer should be paused waiting for drain
    await new Promise((r) => setTimeout(r, 10));
    expect(completed).toBe(false);

    // Simulate drain
    channel.bufferedAmount = 500 * 1024; // below 1 MB threshold
    channel.emit('bufferedamountlow');

    await transferPromise;
    expect(completed).toBe(true);
  });

  it('limits in-flight data to 16 MiB and resumes when an acknowledgement opens the window', async () => {
    const totalBytes = 16 * 1024 * 1024 + 16 * 1024;
    const file = new File([new Uint8Array(totalBytes)], 'window.bin');
    const channel = createMockDataChannel();
    const onProgress = vi.fn();
    const sender = new FileSender({ file, dataChannel: channel, onProgress });
    const transferPromise = sender.start();
    const binarySendCount = () =>
      channel.send.mock.calls.filter(([data]) => data instanceof ArrayBuffer).length;

    await vi.waitFor(() => {
      expect(binarySendCount()).toBe(1024);
    });
    expect(binarySendCount()).toBe(1024);

    expect(sender.handleAck(totalBytes + 1)).toBe(false);
    expect(sender.handleAck(-1)).toBe(false);
    expect(sender.handleAck(16 * 1024)).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ transferredBytes: 16 * 1024 }),
    );
    expect(sender.handleAck(0)).toBe(false);

    await transferPromise;
    expect(binarySendCount()).toBe(1025);

    expect(sender.handleAck(totalBytes)).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ transferredBytes: totalBytes, percentage: 100 }),
    );
  });

  it('releases the acknowledgement wait when cancelled', async () => {
    const file = new File([new Uint8Array(16 * 1024 * 1024 + 16 * 1024)], 'cancel.bin');
    const channel = createMockDataChannel();
    const onError = vi.fn();
    const sender = new FileSender({ file, dataChannel: channel, onError });
    const transferPromise = sender.start();

    await vi.waitFor(() => {
      expect(channel.send.mock.calls.filter(([data]) => data instanceof ArrayBuffer)).toHaveLength(1024);
    });
    sender.cancel();
    await transferPromise;

    expect(onError).not.toHaveBeenCalled();
    expect(channel.removeEventListener).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('releases the acknowledgement wait when the channel closes', async () => {
    const file = new File([new Uint8Array(16 * 1024 * 1024 + 16 * 1024)], 'closed.bin');
    const channel = createMockDataChannel();
    const onError = vi.fn();
    const sender = new FileSender({ file, dataChannel: channel, onError });
    const transferPromise = sender.start();

    await vi.waitFor(() => {
      expect(channel.send.mock.calls.filter(([data]) => data instanceof ArrayBuffer)).toHaveLength(1024);
    });
    channel.close();
    await transferPromise;

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'DataChannel closed during transfer',
    }));
  });

  it('fails when an acknowledgement window stays blocked for 30 seconds', async () => {
    const file = new File([new Uint8Array(16 * 1024 * 1024 + 16 * 1024)], 'timeout.bin');
    const channel = createMockDataChannel();
    const onError = vi.fn();
    const sender = new FileSender({ file, dataChannel: channel, onError });
    vi.useFakeTimers();
    try {
      const transferPromise = sender.start();
      await vi.waitFor(() => {
        expect(
          channel.send.mock.calls.filter(([data]) => data instanceof ArrayBuffer),
        ).toHaveLength(1024);
      });
      await vi.advanceTimersByTimeAsync(30000);
      await transferPromise;
    } finally {
      vi.useRealTimers();
    }

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'The other device stopped responding' }),
    );
  });
});

describe('FileReceiver Integrity, Ordering, and Reassembly', () => {
  const fileBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const expectedSha256 = bytesToHex(sha256(fileBytes));
  const fileId = 'testfile12345678';

  const mockOffer: FileOfferMsg = {
    type: 'file-offer',
    id: fileId,
    name: 'numbers.bin',
    size: 10,
    mime: 'application/octet-stream',
  };

  function createDelayedWriter(delayMs: number) {
    const pendingWrites: Promise<void>[] = [];
    let writtenBytes = 0;

    const writer = {
      write: vi.fn((data: Uint8Array) => {
        const writePromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            writtenBytes += data.byteLength;
            resolve();
          }, delayMs);
        });
        pendingWrites.push(writePromise);
        return writePromise;
      }),
      close: vi.fn(async () => {
        await Promise.all(pendingWrites);
      }),
      abort: vi.fn(async () => {}),
    } as unknown as WritableStreamDefaultWriter<Uint8Array>;

    return {
      writer,
      getWrittenBytes: () => writtenBytes,
    };
  }

  it('successfully receives chunks and verifies valid SHA-256 hash', async () => {
    const onCompleted = vi.fn();
    const onError = vi.fn();

    const receiver = new FileReceiver({
      offer: mockOffer,
      onCompleted,
      onError,
    });

    // Chunk 0 (first 5 bytes)
    const chunk0 = encodeChunk(fileId, 0, fileBytes.subarray(0, 5));
    await receiver.receiveChunk(chunk0);

    // Chunk 1 (second 5 bytes)
    const chunk1 = encodeChunk(fileId, 1, fileBytes.subarray(5, 10));
    await receiver.receiveChunk(chunk1);

    // File End
    const endMsg: FileEndMsg = {
      type: 'file-end',
      id: fileId,
      sha256: expectedSha256,
      chunkCount: 2,
      totalBytes: 10,
    };

    await receiver.finish(endMsg);

    expect(onCompleted).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('finishes after all concurrently received chunks are written', async () => {
    const data = new Uint8Array([11, 12, 13, 14, 15, 16]);
    const offer = { ...mockOffer, size: data.byteLength };
    const delayedWriter = createDelayedWriter(10);
    const onCompleted = vi.fn();
    const onError = vi.fn();
    const receiver = new FileReceiver({
      offer,
      writableStream: delayedWriter.writer,
      onCompleted,
      onError,
    });

    const receivePromises = [
      receiver.receiveChunk(encodeChunk(fileId, 0, data.subarray(0, 3))),
      receiver.receiveChunk(encodeChunk(fileId, 1, data.subarray(3, 6))),
    ];
    await receiver.finish({
      type: 'file-end',
      id: fileId,
      sha256: bytesToHex(sha256(data)),
      chunkCount: 2,
      totalBytes: data.byteLength,
    });
    await Promise.all(receivePromises);

    expect(delayedWriter.writer.close).toHaveBeenCalledOnce();
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('acknowledges only bytes whose writes have completed', async () => {
    const data = new Uint8Array(4 * 1024 * 1024);
    const offer = { ...mockOffer, size: data.byteLength };
    const delayedWriter = createDelayedWriter(1);
    const onAck = vi.fn();
    const receiver = new FileReceiver({
      offer,
      writableStream: delayedWriter.writer,
      onAck,
    });

    const receives: Promise<void>[] = [];
    for (let offset = 0, index = 0; offset < data.byteLength; offset += 16 * 1024, index++) {
      receives.push(
        receiver.receiveChunk(
          encodeChunk(fileId, index, data.subarray(offset, offset + 16 * 1024)),
        ),
      );
    }

    expect(onAck).not.toHaveBeenCalled();
    await Promise.all(receives);

    expect(onAck).toHaveBeenCalledOnce();
    expect(onAck).toHaveBeenCalledWith(data.byteLength);
    expect(onAck.mock.calls.every(([bytes]) => bytes <= delayedWriter.getWrittenBytes())).toBe(true);
  });

  it('rejects bytes exceeding the offer while earlier writes are pending', async () => {
    const offer = { ...mockOffer, size: 5 };
    const delayedWriter = createDelayedWriter(10);
    const onError = vi.fn();
    const receiver = new FileReceiver({
      offer,
      writableStream: delayedWriter.writer,
      onError,
    });

    const firstReceive = receiver.receiveChunk(
      encodeChunk(fileId, 0, new Uint8Array([1, 2, 3, 4, 5])),
    );
    await receiver.receiveChunk(encodeChunk(fileId, 1, new Uint8Array([6])));
    await firstReceive;

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('more data') }),
    );
  });

  it('acknowledges every 4 MiB and the final chunk after it is processed', async () => {
    const ackedBytes: number[] = [];
    const size = 4 * 1024 * 1024 + 16 * 1024;
    const offer: FileOfferMsg = { ...mockOffer, size };
    const receiver = new FileReceiver({
      offer,
      onAck: (bytes) => ackedBytes.push(bytes),
    });
    const chunkCount = size / (16 * 1024);

    for (let index = 0; index < chunkCount; index++) {
      await receiver.receiveChunk(
        encodeChunk(fileId, index, new Uint8Array(16 * 1024)),
      );
    }

    expect(ackedBytes).toEqual([4 * 1024 * 1024, size]);
  });

  it('fails transfer on SHA-256 hash mismatch', async () => {
    const onCompleted = vi.fn();
    const onError = vi.fn();

    const receiver = new FileReceiver({
      offer: mockOffer,
      onCompleted,
      onError,
    });

    const chunk0 = encodeChunk(fileId, 0, fileBytes);
    await receiver.receiveChunk(chunk0);

    const corruptEndMsg: FileEndMsg = {
      type: 'file-end',
      id: fileId,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000', // corrupt
      chunkCount: 1,
      totalBytes: 10,
    };

    await receiver.finish(corruptEndMsg);

    expect(onCompleted).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('SHA-256 integrity check failed'),
      }),
    );
  });

  it('fails transfer if chunks arrive out of order', async () => {
    const onError = vi.fn();
    const receiver = new FileReceiver({
      offer: mockOffer,
      onError,
    });

    // Send chunk index 1 first before 0
    const chunk1 = encodeChunk(fileId, 1, fileBytes.subarray(5, 10));
    await receiver.receiveChunk(chunk1);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Out-of-order chunk received: expected chunk 0, got 1'),
      }),
    );
  });

  it('fails transfer if chunk count does not match on finish', async () => {
    const onError = vi.fn();
    const receiver = new FileReceiver({
      offer: mockOffer,
      onError,
    });

    const chunk0 = encodeChunk(fileId, 0, fileBytes);
    await receiver.receiveChunk(chunk0);

    const endMsgWithWrongCount: FileEndMsg = {
      type: 'file-end',
      id: fileId,
      sha256: expectedSha256,
      chunkCount: 99, // wrong count
      totalBytes: 10,
    };

    await receiver.finish(endMsgWithWrongCount);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Chunk count mismatch: expected 99, received 1'),
      }),
    );
  });
});
