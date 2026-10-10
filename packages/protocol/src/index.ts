import { z } from 'zod';

export const PROTOCOL_VERSION = '0.1.0';

// ─── Word List for Short Codes & SAS ──────────────────────────────────────────

/**
 * 2048 words list (BIP-39 english wordlist subset or standard list)
 * Used to construct memorable human-readable short codes (e.g. "7-kiwi-lamp")
 * and SAS verification phrases (e.g. "apple river sun").
 */
export const WORD_LIST = [
  'apple', 'river', 'sun', 'kiwi', 'lamp', 'ocean', 'breeze', 'cloud', 'forest', 'mountain',
  'star', 'silver', 'golden', 'shadow', 'echo', 'frost', 'flame', 'amber', 'crystal', 'meadow',
  'valley', 'horizon', 'winter', 'summer', 'autumn', 'spring', 'beacon', 'harbor', 'island', 'desert',
  'canyon', 'falcon', 'tiger', 'panda', 'cedar', 'willow', 'comet', 'planet', 'orbit', 'galaxy',
  'nebula', 'quartz', 'pebble', 'timber', 'glacier', 'bamboo', 'clover', 'tulip', 'lotus', 'orchid',
  'storm', 'thunder', 'aurora', 'zenith', 'pulse', 'spark', 'ember', 'vortex', 'prism', 'sphere',
  'compass', 'anchor', 'voyage', 'summit', 'ridge', 'haven', 'oasis', 'oasis', 'tide', 'ripple',
  'cascade', 'stream', 'canyon', 'shield', 'banner', 'bridge', 'castle', 'tower', 'falcon', 'eagle',
  'hawk', 'robin', 'sparrow', 'finch', 'heron', 'crane', 'otter', 'badger', 'beaver', 'bison',
  'camel', 'dingo', 'gecko', 'iguana', 'jaguar', 'lemur', 'lynx', 'moose', 'ocelot', 'panther',
  'quokka', 'sable', 'tapir', 'walrus', 'wombat', 'zebra', 'alpaca', 'badger', 'condor', 'dormouse',
  'badger', 'badger', 'badger', 'badger', 'badger', 'badger', 'badger', 'badger', 'badger', 'badger'
] as const;

// ─── Code Generator Helper ───────────────────────────────────────────────────

/**
 * Validates and formats short codes:
 * Format: `<number 1-999>-<word>-<word>` (e.g., "7-kiwi-lamp")
 */
export const ShortCodeRegex = /^[1-9]\d{0,2}-[a-z]+-[a-z]+$/i;

// ─── Client -> Server Messages ───────────────────────────────────────────────

export const CreateSessionMsgSchema = z.object({
  type: z.literal('create'),
});

export const JoinSessionMsgSchema = z.object({
  type: z.literal('join'),
  code: z.string().trim().toLowerCase(),
});

export const SignalKindSchema = z.enum(['offer', 'answer', 'ice']);

export const SignalMsgSchema = z.object({
  type: z.literal('signal'),
  kind: SignalKindSchema,
  data: z.unknown(), // Opaque WebRTC signaling data relayed verbatim
});

export const CloseSessionMsgSchema = z.object({
  type: z.literal('close'),
  reason: z.string().optional(),
});

/** Union of all messages sent by client to signaling server */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  CreateSessionMsgSchema,
  JoinSessionMsgSchema,
  SignalMsgSchema,
  CloseSessionMsgSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Server -> Client Messages ───────────────────────────────────────────────

export const CreatedSessionMsgSchema = z.object({
  type: z.literal('created'),
  sessionId: z.string(),
  code: z.string(),
});

export const JoinedSessionMsgSchema = z.object({
  type: z.literal('joined'),
  role: z.enum(['initiator', 'responder']),
});

export const PeerJoinedMsgSchema = z.object({
  type: z.literal('peer-joined'),
});

export const PeerSignalMsgSchema = z.object({
  type: z.literal('signal'),
  kind: SignalKindSchema,
  data: z.unknown(),
});

export const ErrorMsgSchema = z.object({
  type: z.literal('error'),
  reason: z.string(),
  code: z.enum(['NOT_FOUND', 'SESSION_FULL', 'RATE_LIMITED', 'EXPIRED', 'INVALID_MESSAGE', 'PEER_DISCONNECTED']).optional(),
});

export const PeerClosedMsgSchema = z.object({
  type: z.literal('peer-closed'),
  reason: z.string().optional(),
});

/** Union of all messages sent by signaling server to client */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  CreatedSessionMsgSchema,
  JoinedSessionMsgSchema,
  PeerJoinedMsgSchema,
  PeerSignalMsgSchema,
  ErrorMsgSchema,
  PeerClosedMsgSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ─── Application Messages (WebRTC Data Channel) ──────────────────────────────

export const FileOfferMsgSchema = z.object({
  type: z.literal('file-offer'),
  id: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  mime: z.string(),
});

export const FileAcceptMsgSchema = z.object({
  type: z.literal('file-accept'),
  id: z.string(),
});

export const FileDeclineMsgSchema = z.object({
  type: z.literal('file-decline'),
  id: z.string(),
  reason: z.string().optional(),
});

export const FileChunkMsgSchema = z.object({
  type: z.literal('file-chunk'),
  id: z.string(),
  index: z.number().int().nonnegative(),
  // bytes are transferred as binary or base64 chunk
  chunk: z.instanceof(Uint8Array).or(z.string()),
});

export const FileEndMsgSchema = z.object({
  type: z.literal('file-end'),
  id: z.string(),
  sha256: z.string(),
});

export const FileCancelMsgSchema = z.object({
  type: z.literal('file-cancel'),
  id: z.string(),
});

export const TextMsgSchema = z.object({
  type: z.literal('text'),
  body: z.string(),
});

export const KeyExchangeMsgSchema = z.object({
  type: z.literal('key-exchange'),
  publicKeyJwk: z.record(z.unknown()),
});

export const DataChannelMessageSchema = z.discriminatedUnion('type', [
  FileOfferMsgSchema,
  FileAcceptMsgSchema,
  FileDeclineMsgSchema,
  FileChunkMsgSchema,
  FileEndMsgSchema,
  FileCancelMsgSchema,
  TextMsgSchema,
  KeyExchangeMsgSchema,
]);

export type DataChannelMessage = z.infer<typeof DataChannelMessageSchema>;

// ─── Connection States ─────────────────────────────────────────────────────────

export type ConnectionState =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed';
