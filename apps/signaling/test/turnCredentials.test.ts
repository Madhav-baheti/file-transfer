import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createTurnCredentials,
  TURN_CREDENTIAL_TTL_SECONDS,
} from '../src/turnCredentials';

describe('createTurnCredentials', () => {
  it('generates coturn REST credentials with a bounded expiry and server-only HMAC secret', () => {
    const now = 1_900_000_000_000;
    const secret = 'server-only-shared-secret';
    const result = createTurnCredentials(['turn:relay.example:3478'], secret, now);
    expect(result.urls).toEqual(['turn:relay.example:3478']);
    expect(result.expiresAt).toBe(Math.floor(now / 1000) + TURN_CREDENTIAL_TTL_SECONDS);
    expect(result.username).toBe(`${result.expiresAt}:quickdrop`);
    expect(result.credential).toBe(
      createHmac('sha1', secret).update(result.username).digest('base64'),
    );
  });
});
