import { describe, expect, it } from 'vitest';
import { getClientIp } from '../src/clientIp';

describe('getClientIp', () => {
  const socketAddress = '10.0.0.8';
  const forwardedFor = 'spoofed-client, trusted-proxy-one, trusted-proxy-two';

  it('uses the socket address when no proxy hops are trusted', () => {
    expect(getClientIp(forwardedFor, socketAddress, 0)).toBe(socketAddress);
  });

  it('uses the rightmost forwarded entry for one trusted hop', () => {
    expect(getClientIp(forwardedFor, socketAddress, 1)).toBe('trusted-proxy-two');
  });

  it('selects the Nth entry from the right for two trusted hops', () => {
    expect(getClientIp(forwardedFor, socketAddress, 2)).toBe('trusted-proxy-one');
  });

  it('does not trust a spoofed leftmost entry', () => {
    expect(getClientIp('attacker, proxy-a, proxy-b', socketAddress, 1)).toBe('proxy-b');
  });

  it('falls back to the socket address when the forwarded header is missing or too short', () => {
    expect(getClientIp(undefined, socketAddress, 1)).toBe(socketAddress);
    expect(getClientIp('only-one-proxy', socketAddress, 2)).toBe(socketAddress);
  });
});
