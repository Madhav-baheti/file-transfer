import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucketRateLimiter } from '../src/rateLimit';

describe('TokenBucketRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('allows requests up to bucket capacity and throttles bursts', () => {
    // 5 capacity, 1 refill per second
    const limiter = new TokenBucketRateLimiter(5, 1);
    const ip = '192.168.1.100';

    // Consume all 5 tokens
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume(ip)).toBe(true);
    }

    // 6th request immediately after must be denied
    expect(limiter.consume(ip)).toBe(false);

    // Advance 1 second -> 1 token refilled
    vi.advanceTimersByTime(1000);
    expect(limiter.consume(ip)).toBe(true);
    expect(limiter.consume(ip)).toBe(false);

    // Advance 5 seconds -> full bucket refilled
    vi.advanceTimersByTime(5000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume(ip)).toBe(true);
    }
    expect(limiter.consume(ip)).toBe(false);
  });

  it('tracks distinct IP addresses independently', () => {
    const limiter = new TokenBucketRateLimiter(2, 0.5);
    const ip1 = '1.1.1.1';
    const ip2 = '2.2.2.2';

    expect(limiter.consume(ip1)).toBe(true);
    expect(limiter.consume(ip1)).toBe(true);
    expect(limiter.consume(ip1)).toBe(false);

    // ip2 should still have full capacity
    expect(limiter.consume(ip2)).toBe(true);
    expect(limiter.consume(ip2)).toBe(true);
    expect(limiter.consume(ip2)).toBe(false);
  });
});
