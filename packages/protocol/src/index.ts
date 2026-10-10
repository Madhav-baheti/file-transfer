/**
 * @quickdrop/protocol
 *
 * Shared message types and validation schemas for the QuickDrop signaling protocol.
 * Used by both the web client and the signaling server.
 *
 * Full zod schemas will be added in Phase 2 (Signaling Server).
 */

export const PROTOCOL_VERSION = '0.1.0';

// ─── Signaling message types ───────────────────────────────────────────────────

/** All possible signaling message types */
export type SignalingMessageType =
  | 'create'
  | 'created'
  | 'join'
  | 'joined'
  | 'peer-joined'
  | 'signal'
  | 'error'
  | 'close';

/** Signal sub-types for WebRTC negotiation */
export type SignalKind = 'offer' | 'answer' | 'ice';

// ─── Data channel message types ────────────────────────────────────────────────

/** All possible data channel message types (sent over WebRTC) */
export type DataChannelMessageType =
  | 'file-offer'
  | 'file-accept'
  | 'file-decline'
  | 'file-chunk'
  | 'file-end'
  | 'file-cancel'
  | 'text';

// ─── Connection states ─────────────────────────────────────────────────────────

/** Session connection lifecycle states */
export type ConnectionState =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed';
