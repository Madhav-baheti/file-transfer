import { describe, it, expect } from 'vitest';
import {
  ClientMessageSchema,
  ServerMessageSchema,
  ShortCodeRegex,
} from '@quickdrop/protocol';

describe('Protocol Message Validation', () => {
  it('validates short code format', () => {
    expect(ShortCodeRegex.test('100000')).toBe(true);
    expect(ShortCodeRegex.test('482193')).toBe(true);
    expect(ShortCodeRegex.test('999999')).toBe(true);

    expect(ShortCodeRegex.test('000001')).toBe(false);
    expect(ShortCodeRegex.test('99999')).toBe(false);
    expect(ShortCodeRegex.test('1000000')).toBe(false);
    expect(ShortCodeRegex.test('12a456')).toBe(false);
  });

  it('validates client messages', () => {
    expect(ClientMessageSchema.safeParse({ type: 'create' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'join', code: '482193' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'join', code: '7-kiwi-lamp' }).success).toBe(false);
    expect(
      ClientMessageSchema.safeParse({
        type: 'signal',
        kind: 'offer',
        data: { sdp: 'dummy-sdp-data' },
      }).success
    ).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'close', reason: 'User exited' }).success).toBe(true);

    // Malformed messages
    expect(ClientMessageSchema.safeParse({ type: 'unknown' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'join' }).success).toBe(false);
  });

  it('validates server messages', () => {
    expect(
      ServerMessageSchema.safeParse({
        type: 'created',
        sessionId: 'test-session-id',
        code: '482193',
      }).success
    ).toBe(true);

    expect(ServerMessageSchema.safeParse({ type: 'joined', role: 'responder' }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ type: 'peer-joined' }).success).toBe(true);
    expect(
      ServerMessageSchema.safeParse({
        type: 'error',
        reason: 'Session expired',
        code: 'EXPIRED',
      }).success
    ).toBe(true);
  });
});
