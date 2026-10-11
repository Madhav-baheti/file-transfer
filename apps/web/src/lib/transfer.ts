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

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Browsers without the File System Access API must hold the whole file in RAM. */
export const MAX_IN_MEMORY_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const MAX_OFFER_NAME_LENGTH = 1024;
export const MAX_OFFER_MIME_LENGTH = 255;

// ─── Filename sanitizing ──────────────────────────────────────────────────────

// Invisible and direction-override characters that can disguise a file extension
// (for example "invoice<RLO>fdp.exe" displays as "invoiceexe.pdf").
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
// Path separators, characters Windows forbids, and control characters.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/g;
// Windows reserved device names, with or without an extension.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Sanitizes untrusted filenames from the peer:
 * - Removes invisible/direction-override characters
 * - Replaces path separators and control characters
 * - Strips trailing dots and spaces (Windows ignores them)
 * - Prefixes Windows reserved device names with "_"
 * - Caps length at 255 characters, keeping a short extension
 * Never auto-opens files.
 */
export function sanitizeFilename(raw: string): string {
  let cleaned = raw.replace(INVISIBLE_CHARS, '').replace(FORBIDDEN_CHARS, '_').trim();
  cleaned = cleaned.replace(/[. ]+$/, '');

  if (!cleaned || /^\.+$/.test(cleaned)) {
    cleaned = 'download';
  }
  if (WINDOWS_RESERVED.test(cleaned)) {
    cleaned = '_' + cleaned;
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

/**
 * Validates a file offer received from the peer. Returns an error message,
 * or null when the offer is acceptable.
 */
export function validateFileOffer(offer: FileOfferMsg): string | null {
  if (typeof offer.id !== 'string' || offer.id.length === 0 || offer.id.length > 100) {
    return 'Invalid file offer: bad id';
  }
  if (typeof offer.size !== 'number' || !Number.isSafeInteger(offer.size) || offer.size < 0) {
    return 'Invalid file offer: bad size';
  }
  if (typeof offer.name !== 'string' || offer.name.length > MAX_OFFER_NAME_LENGTH) {
    return 'Invalid file offer: bad name';
  }
  if (typeof offer.mime !== 'string' || offer.mime.length > MAX_OFFER_MIME_LENGTH) {
    return 'Invalid file offer: bad type';
  }
  return null;
}

/**
 * Returns an ArrayBuffer holding exactly the bytes of the view.
 * `view.buffer` alone can contain extra bytes when the view is a window into a
 * larger buffer, so it must never be sent directly.
 */
export function exactBuffer(view: Uint8Array): ArrayBuffer {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
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

const MAX_IN_FLIGHT_BYTES = 16 * 1024 * 1024;
const ACK_WAIT_TIMEOUT_MS = 30000;

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
  private sentBytes = 0;
  private ackedBytes = 0;
  private ackWaiters = new Set<() => void>();
  private lastProgressTime = Date.now();
  private lastProgressBytes = 0;

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

  private sendControl(encoded: string | Uint8Array): void {
    if (typeof encoded === 'string') {
      this.channel.send(encoded);
    } else {
      this.channel.send(exactBuffer(encoded));
    }
  }

  public cancel(reason = 'Sender cancelled'): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.releaseAckWaiters();
    try {
      if (this.channel.readyState === 'open') {
        this.sendControl(
          this.codec.encodeControl({
            type: 'file-cancel',
            id: this.fileId,
            reason,
          }),
        );
      }
    } catch {
      // ignore send error on cancel
    }
  }

  public handleAck(bytes: number): boolean {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < this.ackedBytes ||
      bytes > this.sentBytes
    ) {
      return false;
    }

    this.ackedBytes = bytes;
    this.reportProgress(true);
    this.releaseAckWaiters();
    return true;
  }

  public async start(): Promise<void> {
    if (this.active || this.cancelled) return;
    this.active = true;
    this.lastProgressTime = Date.now();
    this.lastProgressBytes = 0;

    // Set backpressure threshold: 1 MB per TECH_STACK.md Section 6
    this.channel.bufferedAmountLowThreshold = 1024 * 1024; // 1 MB
    const HIGH_WATER_MARK = 2 * 1024 * 1024; // 2 MB

    const hasher = sha256.create();
    let chunkIndex = 0;

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

          await this.waitForAckWindow(chunkPayload.byteLength);

          // Backpressure check
          if (this.channel.bufferedAmount > HIGH_WATER_MARK) {
            await this.waitForDrain();
          }

          if (this.channel.readyState !== 'open') {
            throw new Error('DataChannel closed during transfer');
          }

          this.channel.send(exactBuffer(processedChunk));

          this.sentBytes += chunkPayload.byteLength;
          chunkIndex++;
          sliceOffset = chunkEnd;
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
        totalBytes: this.sentBytes,
      };

      this.sendControl(this.codec.encodeControl(endMsg));

      this.onCompleted?.();
    } catch (err) {
      if (!this.cancelled) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.active = false;
    }
  }

  private reportProgress(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastProgressTime < 100 && this.ackedBytes !== this.file.size) {
      return;
    }

    const timeDiff = (now - this.lastProgressTime) / 1000;
    const bytesDiff = this.ackedBytes - this.lastProgressBytes;
    const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
    const remaining = this.file.size - this.ackedBytes;

    this.onProgress?.({
      fileId: this.fileId,
      filename: this.file.name,
      totalBytes: this.file.size,
      transferredBytes: this.ackedBytes,
      percentage:
        this.file.size > 0
          ? Math.min(100, Math.round((this.ackedBytes / this.file.size) * 100))
          : 100,
      speedBytesPerSec: speed,
      etaSeconds: speed > 0 ? Math.ceil(remaining / speed) : 0,
    });

    this.lastProgressTime = now;
    this.lastProgressBytes = this.ackedBytes;
  }

  private async waitForAckWindow(nextChunkBytes: number): Promise<void> {
    while (this.sentBytes + nextChunkBytes - this.ackedBytes > MAX_IN_FLIGHT_BYTES) {
      if (this.cancelled) {
        throw new Error('Transfer cancelled');
      }
      if (this.channel.readyState !== 'open') {
        throw new Error('DataChannel closed during transfer');
      }

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutId);
          this.ackWaiters.delete(onAck);
          this.channel.removeEventListener('close', onClose);
        };

        const onAck = () => {
          cleanup();
          resolve();
        };
        const onClose = () => {
          cleanup();
          reject(new Error('DataChannel closed during transfer'));
        };

        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('The other device stopped responding'));
        }, ACK_WAIT_TIMEOUT_MS);

        this.ackWaiters.add(onAck);
        this.channel.addEventListener('close', onClose);
        if (this.cancelled || this.channel.readyState !== 'open') {
          cleanup();
          resolve();
        }
      });
    }
  }

  private releaseAckWaiters(): void {
    for (const wake of [...this.ackWaiters]) {
      wake();
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
  onAck?: (bytes: number) => void;
}

/**
 * Handles receiving a file with incremental SHA-256 verification, ordering checks,
 * and chunk count verification.
 * Supports direct FileSystemWritableFileStream writing (Chromium) or Blob accumulation.
 *
 * Safety: the receiver never accepts more bytes than the offered size, and refuses to
 * hold more than MAX_IN_MEMORY_BYTES in RAM when it cannot stream to disk.
 */
export class FileReceiver {
  public readonly offer: FileOfferMsg;
  private codec: TransportCodec;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private onProgress?: (progress: TransferProgress) => void;
  private onCompleted?: (blob?: Blob) => void;
  private onError?: (err: Error) => void;
  private onAck?: (bytes: number) => void;

  private hasher = sha256.create();
  private expectedIndex = 0;
  private receivedBytes = 0;
  private writtenBytes = 0;
  private lastAckBytes = 0;
  private chunks: Uint8Array[] = []; // In-memory fallback if not streaming to disk
  private completed = false;
  private cancelled = false;
  private invalidReason: string | null;

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
    this.onAck = options.onAck;
    this.invalidReason = validateFileOffer(options.offer);
  }

  public async receiveChunk(rawBytes: ArrayBuffer | Uint8Array): Promise<void> {
    if (this.completed || this.cancelled) return;

    try {
      if (this.invalidReason) {
        throw new Error(this.invalidReason);
      }

      const decodedRaw = this.codec.decodeBinary(rawBytes);
      const { fileId, index, data } = decodeChunk(decodedRaw);

      if (normalizeFileId(fileId) !== normalizeFileId(this.offer.id)) {
        throw new Error(`Mismatched file ID in chunk: expected ${this.offer.id}, got ${fileId}`);
      }

      // Ordering check per requirement
      if (index !== this.expectedIndex) {
        throw new Error(`Out-of-order chunk received: expected chunk ${this.expectedIndex}, got ${index}`);
      }

      // Never accept more data than the peer offered
      if (this.receivedBytes + data.byteLength > this.offer.size) {
        throw new Error(
          `Peer sent more data than the offered file size (${this.offer.size} bytes)`,
        );
      }

      // Without a disk writer the whole file is held in memory: refuse very large files
      if (!this.writer && this.receivedBytes + data.byteLength > MAX_IN_MEMORY_BYTES) {
        throw new Error(
          'This file is too large to receive in this browser. Use Chrome or Edge, which can save large files directly to disk.',
        );
      }

      this.expectedIndex++;
      this.receivedBytes += data.byteLength;
      this.hasher.update(data);

      if (this.writer) {
        await this.writer.write(data);
      } else {
        this.chunks.push(data);
      }

      this.writtenBytes += data.byteLength;
      if (
        this.writtenBytes - this.lastAckBytes >= 4 * 1024 * 1024 ||
        this.writtenBytes === this.offer.size
      ) {
        this.lastAckBytes = this.writtenBytes;
        this.onAck?.(this.writtenBytes);
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
      if (this.invalidReason) {
        throw new Error(this.invalidReason);
      }

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
