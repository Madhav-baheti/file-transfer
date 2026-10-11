// Pinned exact version @noble/hashes@1.4.0 (audited, zero dependencies, released > 2 weeks ago)
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import {
  CHUNK_SIZE,
  encodeChunk,
  decodeChunk,
  normalizeFileId,
  PlaintextTransportCodec,
  type TransportCodec,
  type FileOfferMsg,
  type FileEndMsg,
} from './protocol';

/**
 * Sanitizes untrusted filenames from peer:
 * - Strips path separators (\ and /) and control characters
 * - Trims whitespace and caps length at 255 characters
 * - Never auto-opens files
 */
export function sanitizeFilename(raw: string): string {
  // Replace slashes, colons, null bytes and other control chars
  // eslint-disable-next-line no-control-regex
  let cleaned = raw.replace(/[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/g, '_').trim();
  if (!cleaned) {
    cleaned = 'download';
  }
  if (cleaned.length > 255) {
    const extIdx = cleaned.lastIndexOf('.');
    if (extIdx > 0 && cleaned.length - extIdx <= 10) {
      const ext = cleaned.slice(extIdx);
      cleaned = cleaned.slice(0, 255 - ext.length) + ext;
    } else {
      cleaned = cleaned.slice(0, 255);
    }
  }
  return cleaned;
}

export interface TransferProgress {
  fileId: string;
  filename: string;
  totalBytes: number;
  transferredBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  etaSeconds: number;
}

export interface SenderTransferOptions {
  file: File;
  fileId?: string;
  dataChannel: RTCDataChannel;
  codec?: TransportCodec;
  onProgress?: (progress: TransferProgress) => void;
  onError?: (err: Error) => void;
  onCompleted?: () => void;
}

/**
 * Handles sending a file using slice-based chunk streaming and backpressure.
 * Constant memory usage regardless of file size.
 */
export class FileSender {
  private file: File;
  private fileId: string;
  private channel: RTCDataChannel;
  private codec: TransportCodec;
  private onProgress?: (progress: TransferProgress) => void;
  private onError?: (err: Error) => void;
  private onCompleted?: () => void;

  private cancelled = false;
  private active = false;

  constructor(options: SenderTransferOptions) {
    this.file = options.file;
    this.fileId = options.fileId ? normalizeFileId(options.fileId) : normalizeFileId(crypto.randomUUID());
    this.channel = options.dataChannel;
    this.codec = options.codec ?? PlaintextTransportCodec;
    this.onProgress = options.onProgress;
    this.onError = options.onError;
    this.onCompleted = options.onCompleted;
  }

  public getOffer(): FileOfferMsg {
    return {
      type: 'file-offer',
      id: this.fileId,
      name: sanitizeFilename(this.file.name),
      size: this.file.size,
      mime: this.file.type || 'application/octet-stream',
    };
  }

  public cancel(reason = 'Sender cancelled'): void {
    if (this.cancelled) return;
    this.cancelled = true;
    try {
      if (this.channel.readyState === 'open') {
        const cancelMsg = this.codec.encodeControl({
          type: 'file-cancel',
          id: this.fileId,
          reason,
        });
        if (typeof cancelMsg === 'string') {
          this.channel.send(cancelMsg);
        } else {
          this.channel.send(cancelMsg.buffer as ArrayBuffer);
        }
      }
    } catch {
      // ignore send error on cancel
    }
  }

  public async start(): Promise<void> {
    if (this.active || this.cancelled) return;
    this.active = true;

    // Set backpressure threshold: 1 MB per TECH_STACK.md Section 6
    this.channel.bufferedAmountLowThreshold = 1024 * 1024; // 1 MB
    const HIGH_WATER_MARK = 2 * 1024 * 1024; // 2 MB

    const hasher = sha256.create();
    let transferredBytes = 0;
    let chunkIndex = 0;
    const startTime = Date.now();
    let lastProgressTime = startTime;
    let lastProgressBytes = 0;

    const SLICE_SIZE = 256 * 1024; // Read in 256 KB slices from File.slice()

    try {
      let offset = 0;
      while (offset < this.file.size) {
        if (this.cancelled) {
          throw new Error('Transfer cancelled');
        }

        // Read a 256 KB slice
        const sliceEnd = Math.min(offset + SLICE_SIZE, this.file.size);
        const fileSlice = this.file.slice(offset, sliceEnd);
        const sliceBuffer = await fileSlice.arrayBuffer();
        const sliceBytes = new Uint8Array(sliceBuffer);

        // Subdivide the slice into 16 KB chunks for the data channel
        let sliceOffset = 0;
        while (sliceOffset < sliceBytes.byteLength) {
          if (this.cancelled) {
            throw new Error('Transfer cancelled');
          }

          const chunkEnd = Math.min(sliceOffset + CHUNK_SIZE, sliceBytes.byteLength);
          const chunkPayload = sliceBytes.subarray(sliceOffset, chunkEnd);

          // Incremental hash calculation
          hasher.update(chunkPayload);

          // Build wire chunk
          const wireChunk = encodeChunk(this.fileId, chunkIndex, chunkPayload);
          const processedChunk = this.codec.encodeBinary(wireChunk);

          // Backpressure check
          if (this.channel.bufferedAmount > HIGH_WATER_MARK) {
            await this.waitForDrain();
          }

          if (this.channel.readyState !== 'open') {
            throw new Error('DataChannel closed during transfer');
          }

          this.channel.send(processedChunk.buffer as ArrayBuffer);

          transferredBytes += chunkPayload.byteLength;
          chunkIndex++;
          sliceOffset = chunkEnd;

          // Emit progress throttling (at most once every 100ms or on completion)
          const now = Date.now();
          if (now - lastProgressTime >= 100 || transferredBytes === this.file.size) {
            const timeDiff = (now - lastProgressTime) / 1000;
            const bytesDiff = transferredBytes - lastProgressBytes;
            const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
            const remaining = this.file.size - transferredBytes;
            const eta = speed > 0 ? Math.ceil(remaining / speed) : 0;

            this.onProgress?.({
              fileId: this.fileId,
              filename: this.file.name,
              totalBytes: this.file.size,
              transferredBytes,
              percentage: Math.min(100, Math.round((transferredBytes / this.file.size) * 100)),
              speedBytesPerSec: speed,
              etaSeconds: eta,
            });

            lastProgressTime = now;
            lastProgressBytes = transferredBytes;
          }
        }

        offset = sliceEnd;
      }

      // Finish incremental hash
      const finalDigest = bytesToHex(hasher.digest());

      // Send file-end message
      const endMsg: FileEndMsg = {
        type: 'file-end',
        id: this.fileId,
        sha256: finalDigest,
        chunkCount: chunkIndex,
        totalBytes: transferredBytes,
      };

      const encodedEnd = this.codec.encodeControl(endMsg);
      if (typeof encodedEnd === 'string') {
        this.channel.send(encodedEnd);
      } else {
        this.channel.send(encodedEnd.buffer as ArrayBuffer);
      }

      this.onCompleted?.();
    } catch (err) {
      if (!this.cancelled) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.active = false;
    }
  }

  private waitForDrain(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.channel.bufferedAmount <= (this.channel.bufferedAmountLowThreshold || 1024 * 1024)) {
        resolve();
        return;
      }

      const onLow = () => {
        this.channel.removeEventListener('bufferedamountlow', onLow);
        this.channel.removeEventListener('close', onClose);
        resolve();
      };

      const onClose = () => {
        this.channel.removeEventListener('bufferedamountlow', onLow);
        this.channel.removeEventListener('close', onClose);
        reject(new Error('DataChannel closed while waiting for buffer drain'));
      };

      this.channel.addEventListener('bufferedamountlow', onLow);
      this.channel.addEventListener('close', onClose);
    });
  }
}

// ─── Receiver Logic ───────────────────────────────────────────────────────────

export interface ReceiverTransferOptions {
  offer: FileOfferMsg;
  codec?: TransportCodec;
  writableStream?: WritableStreamDefaultWriter<Uint8Array> | null;
  onProgress?: (progress: TransferProgress) => void;
  onCompleted?: (blob?: Blob) => void;
  onError?: (err: Error) => void;
}

/**
 * Handles receiving a file with incremental SHA-256 verification, ordering checks,
 * and chunk count verification.
 * Supports direct FileSystemWritableFileStream writing (Chromium) or Blob accumulation.
 */
export class FileReceiver {
  public readonly offer: FileOfferMsg;
  private codec: TransportCodec;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private onProgress?: (progress: TransferProgress) => void;
  private onCompleted?: (blob?: Blob) => void;
  private onError?: (err: Error) => void;

  private hasher = sha256.create();
  private expectedIndex = 0;
  private receivedBytes = 0;
  private chunks: Uint8Array[] = []; // In-memory fallback if not streaming to disk
  private completed = false;
  private cancelled = false;

  private startTime = Date.now();
  private lastProgressTime = this.startTime;
  private lastProgressBytes = 0;

  constructor(options: ReceiverTransferOptions) {
    this.offer = options.offer;
    this.codec = options.codec ?? PlaintextTransportCodec;
    this.writer = options.writableStream ?? null;
    this.onProgress = options.onProgress;
    this.onCompleted = options.onCompleted;
    this.onError = options.onError;
  }

  public async receiveChunk(rawBytes: ArrayBuffer | Uint8Array): Promise<void> {
    if (this.completed || this.cancelled) return;

    try {
      const decodedRaw = this.codec.decodeBinary(rawBytes);
      const { fileId, index, data } = decodeChunk(decodedRaw);

      if (normalizeFileId(fileId) !== normalizeFileId(this.offer.id)) {
        throw new Error(`Mismatched file ID in chunk: expected ${this.offer.id}, got ${fileId}`);
      }

      // Ordering check per requirement
      if (index !== this.expectedIndex) {
        throw new Error(`Out-of-order chunk received: expected chunk ${this.expectedIndex}, got ${index}`);
      }

      this.expectedIndex++;
      this.receivedBytes += data.byteLength;
      this.hasher.update(data);

      if (this.writer) {
        await this.writer.write(data);
      } else {
        this.chunks.push(data);
      }

      const now = Date.now();
      if (now - this.lastProgressTime >= 100 || this.receivedBytes === this.offer.size) {
        const timeDiff = (now - this.lastProgressTime) / 1000;
        const bytesDiff = this.receivedBytes - this.lastProgressBytes;
        const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
        const remaining = this.offer.size - this.receivedBytes;
        const eta = speed > 0 ? Math.ceil(remaining / speed) : 0;

        this.onProgress?.({
          fileId: this.offer.id,
          filename: this.offer.name,
          totalBytes: this.offer.size,
          transferredBytes: this.receivedBytes,
          percentage: this.offer.size > 0 ? Math.min(100, Math.round((this.receivedBytes / this.offer.size) * 100)) : 100,
          speedBytesPerSec: speed,
          etaSeconds: eta,
        });

        this.lastProgressTime = now;
        this.lastProgressBytes = this.receivedBytes;
      }
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  public async finish(endMsg: FileEndMsg): Promise<void> {
    if (this.completed || this.cancelled) return;

    try {
      // 1. Verify file ID
      if (normalizeFileId(endMsg.id) !== normalizeFileId(this.offer.id)) {
        throw new Error(`FileEnd message ID mismatch`);
      }

      // 2. Verify total chunk count
      if (this.expectedIndex !== endMsg.chunkCount) {
        throw new Error(`Chunk count mismatch: expected ${endMsg.chunkCount}, received ${this.expectedIndex}`);
      }

      // 3. Verify total bytes
      if (this.receivedBytes !== endMsg.totalBytes || this.receivedBytes !== this.offer.size) {
        throw new Error(`Total byte size mismatch: expected ${this.offer.size}, received ${this.receivedBytes}`);
      }

      // 4. Verify incremental SHA-256 integrity
      const computedHash = bytesToHex(this.hasher.digest());
      if (computedHash.toLowerCase() !== endMsg.sha256.toLowerCase()) {
        throw new Error(`SHA-256 integrity check failed! Expected ${endMsg.sha256}, got ${computedHash}`);
      }

      this.completed = true;

      if (this.writer) {
        await this.writer.close();
        this.writer = null;
        this.onCompleted?.();
      } else {
        const blob = new Blob(this.chunks as unknown as BlobPart[], {
          type: this.offer.mime || 'application/octet-stream',
        });
        this.chunks = [];
        this.onCompleted?.(blob);
      }
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  public cancel(reason = 'Receiver cancelled'): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.writer) {
      this.writer.abort(reason).catch(() => {});
      this.writer = null;
    }
    this.chunks = [];
  }

  private fail(err: Error): void {
    this.cancelled = true;
    if (this.writer) {
      this.writer.abort(err.message).catch(() => {});
      this.writer = null;
    }
    this.chunks = [];
    this.onError?.(err);
  }
}
