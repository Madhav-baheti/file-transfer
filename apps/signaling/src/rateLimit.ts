/**
 * Token bucket rate limiter per client IP.
 * Enforces limits on session creation and join attempts.
 */
export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRatePerSec: number;
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  /**
   * @param capacity Maximum tokens allowed at any moment (burst size)
   * @param refillRatePerSec Tokens added back every second
   */
  constructor(capacity = 10, refillRatePerSec = 0.5) {
    this.capacity = capacity;
    this.refillRatePerSec = refillRatePerSec;

    // Periodically clean up stale IP entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  /**
   * Consume a token for the given key/IP.
   * Returns true if allowed, false if rate limited.
   */
  public consume(key: string, tokens = 1): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsedSec = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillRatePerSec);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return true;
    }

    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      // Remove buckets that have been inactive and full for over 10 minutes
      if (now - bucket.lastRefill > 10 * 60 * 1000) {
        this.buckets.delete(key);
      }
    }
  }
}
