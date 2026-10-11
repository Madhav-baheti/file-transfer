import { z } from 'zod';

// ─── Control Message Schemas ──────────────────────────────────────────────────

export const FileOfferMsgSchema = z.object({
  type: z.literal('file-offer'),
  id: z.string().min(1),
  name: z.string().max(1024),
  size: z
    .number()
    .int()
    .nonnegative()
    .refine(Number.isFinite, { message: 'size must be a finite integer' }),
  mime: z.string().max(255),
});
export type FileOfferMsg = z.infer<typeof FileOfferMsgSchema>;

export function isValidFileOffer(data: unknown): data is FileOfferMsg {
  return FileOfferMsgSchema.safeParse(data).success;
}

export const FileAcceptMsgSchema = z.object({
  type: z.literal('file-accept'),
  id: z.string(),
});
export type FileAcceptMsg = z.infer<typeof FileAcceptMsgSchema>;

export const FileDeclineMsgSchema = z.object({
  type: z.literal('file-decline'),
  id: z.string(),
  reason: z.string().optional(),
});
export type FileDeclineMsg = z.infer<typeof FileDeclineMsgSchema>;

export const FileEndMsgSchema = z.object({
  type: z.literal('file-end'),
  id: z.string(),
  sha256: z.string(),
  chunkCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});
export type FileEndMsg = z.infer<typeof FileEndMsgSchema>;

export const FileCancelMsgSchema = z.object({
  type: z.literal('file-cancel'),
  id: z.string(),
  reason: z.string().optional(),
});
export type FileCancelMsg = z.infer<typeof FileCancelMsgSchema>;

export const FileResultMsgSchema = z.object({
  type: z.literal('file-result'),
  id: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type FileResultMsg = z.infer<typeof FileResultMsgSchema>;

export const FileAckMsgSchema = z.object({
  type: z.literal('file-ack'),
  id: z.string(),
  bytes: z.number().int().nonnegative().safe(),
});
export type FileAckMsg = z.infer<typeof FileAckMsgSchema>;

export const TextMsgSchema = z.object({
  type: z.literal('text'),
  body: z.string(),
});
export type TextMsg = z.infer<typeof TextMsgSchema>;

export const ControlMessageSchema = z.discriminatedUnion('type', [
  FileOfferMsgSchema,
  FileAcceptMsgSchema,
  FileDeclineMsgSchema,
  FileEndMsgSchema,
  FileCancelMsgSchema,
  FileResultMsgSchema,
  FileAckMsgSchema,
  TextMsgSchema,
]);
export type ControlMessage = z.infer<typeof ControlMessageSchema>;

// ─── Binary Chunk Protocol ───────────────────────────────────────────────────

/**
 * Binary Chunk Wire Format:
 * [0..15]   : File ID (16 bytes UTF-8 ASCII/UUID string)
 * [16..19]  : Chunk Index (4 bytes uint32 Big Endian)
 * [20..end] : Chunk Payload bytes
 */
export const CHUNK_HEADER_FILE_ID_LEN = 16;
export const CHUNK_HEADER_LEN = 20; // 16 bytes ID + 4 bytes index
export const CHUNK_SIZE = 16 * 1024; // 16 KB per TECH_STACK.md Section 6

/**
 * Normalizes or pads a file ID to exactly 16 bytes for wire transport.
 */
export function normalizeFileId(id: string): string {
  // If uuid with hyphens, strip hyphens or take first 16 chars
  const clean = id.replace(/-/g, '');
  if (clean.length >= 16) {
    return clean.slice(0, 16);
  }
  return clean.padEnd(16, '_');
}

/**
 * Encodes a binary chunk with a 20-byte header: 16 bytes fileId + 4 bytes chunkIndex.
 */
export function encodeChunk(fileId: string, index: number, payload: Uint8Array): Uint8Array {
  const normId = normalizeFileId(fileId);
  const out = new Uint8Array(CHUNK_HEADER_LEN + payload.byteLength);
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(normId);

  out.set(idBytes.subarray(0, 16), 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(16, index, false); // Big Endian
  out.set(payload, CHUNK_HEADER_LEN);

  return out;
}

/**
 * Decodes a binary chunk buffer into fileId, chunkIndex, and the payload bytes.
 */
export function decodeChunk(buffer: ArrayBuffer | Uint8Array): {
  fileId: string;
  index: number;
  data: Uint8Array;
} {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < CHUNK_HEADER_LEN) {
    throw new Error(`Invalid chunk length: ${bytes.byteLength} is less than header ${CHUNK_HEADER_LEN}`);
  }

  const decoder = new TextDecoder();
  const fileId = decoder.decode(bytes.subarray(0, 16)).trim();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const index = view.getUint32(16, false); // Big Endian
  const data = bytes.subarray(CHUNK_HEADER_LEN);

  return { fileId, index, data };
}

// ─── Transport Layer Interface (for Phase 5 plug-in) ──────────────────────────

export interface TransportCodec {
  /** Encode control message before transmitting */
  encodeControl(msg: ControlMessage): string | Uint8Array;
  /** Decode received control message */
  decodeControl(raw: string): ControlMessage | null;
  /** Encode binary chunk payload (Phase 5 will encrypt with AES-GCM here) */
  encodeBinary(chunk: Uint8Array): Uint8Array;
  /** Decode received binary chunk payload (Phase 5 will decrypt with AES-GCM here) */
  decodeBinary(raw: ArrayBuffer | Uint8Array): Uint8Array;
}

/**
 * Phase 4 plaintext pass-through transport codec.
 * In Phase 5, this can be swapped with an AES-GCM encrypted codec without rewriting transfer logic.
 */
export const PlaintextTransportCodec: TransportCodec = {
  encodeControl: (msg) => JSON.stringify(msg),
  decodeControl: (raw) => {
    try {
      const parsed = JSON.parse(raw);
      const res = ControlMessageSchema.safeParse(parsed);
      return res.success ? res.data : null;
    } catch {
      return null;
    }
  },
  encodeBinary: (chunk) => chunk,
  decodeBinary: (raw) => (raw instanceof Uint8Array ? raw : new Uint8Array(raw)),
};
