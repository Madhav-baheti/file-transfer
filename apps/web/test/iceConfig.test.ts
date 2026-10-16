import { describe, expect, it } from 'vitest';
import {
  defaultStunServers,
  parseTurnConfiguration,
  toTurnIceServer,
} from '../src/lib/iceConfig';

describe('ICE server configuration', () => {
  it('keeps default and configured STUN servers available', () => {
    expect(defaultStunServers()).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]);
    expect(defaultStunServers('stun:stun.example:3478')).toEqual([
      { urls: 'stun:stun.example:3478' },
    ]);
    expect(defaultStunServers('turn:host:3478')).toHaveLength(2);
  });

  it('accepts unexpired dynamic TURN credentials only', () => {
    const valid = {
      urls: ['turn:relay.example:3478?transport=udp', 'turns:relay.example:5349'],
      username: '1900000600:quickdrop',
      credential: 'short-lived-password',
      expiresAt: 1900000600,
    };
    expect(parseTurnConfiguration(valid, 1900000000)).toEqual(valid);
    expect(toTurnIceServer(valid)).toMatchObject({
      urls: valid.urls,
      username: valid.username,
      credential: valid.credential,
    });
    expect(parseTurnConfiguration({ ...valid, expiresAt: 1900000000 }, 1900000000))
      .toBeNull();
    expect(parseTurnConfiguration({ ...valid, urls: ['turn:user:pass@host'] }, 1900000000))
      .toBeNull();
    expect(parseTurnConfiguration({ ...valid, credential: '' }, 1900000000)).toBeNull();
    expect(parseTurnConfiguration(null, 1900000000)).toBeNull();
  });
});
