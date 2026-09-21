/**
 * ThreadMax — Token Bucket Rate Limiter
 * Simple, dependency-free token bucket for API pacing and download guards.
 */

export interface RateLimitConfig {
  /** Maximum tokens in bucket (burst capacity) */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
  /** Optional minimum delay between operations (ms) */
  minIntervalMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  waitMs: number;
  tokensRemaining: number;
}

/**
 * Token bucket rate limiter with optional minimum interval guard.
 * Thread-safe for single-threaded JS (async/await).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly minIntervalMs: number;
  private lastOpTime: number = 0;

  constructor(config: RateLimitConfig) {
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.tokens = config.capacity;
    this.lastRefill = Date.now();
    this.minIntervalMs = config.minIntervalMs ?? 0;
  }

  /** Refill tokens based on elapsed time */
  private refill(): void {
    const now = Date.now();
    const elapsedSec = Math.max(0, (now - this.lastRefill) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillRate);
    this.lastRefill = now;
  }

  /** Try to consume tokens; returns wait time if not available */
  tryConsume(tokens: number = 1): RateLimitResult {
    this.refill();

    // Enforce minimum interval between operations
    const now = Date.now();
    const sinceLastOp = now - this.lastOpTime;
    if (this.minIntervalMs > 0 && sinceLastOp < this.minIntervalMs) {
      const wait = this.minIntervalMs - sinceLastOp;
      return { allowed: false, waitMs: wait, tokensRemaining: this.tokens };
    }

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      this.lastOpTime = Date.now();
      return { allowed: true, waitMs: 0, tokensRemaining: this.tokens };
    }

    const deficit = tokens - this.tokens;
    const waitMs = Math.ceil((deficit / this.refillRate) * 1000);
    return { allowed: false, waitMs, tokensRemaining: this.tokens };
  }

  /** Consume tokens, waiting if necessary (async) */
  async consume(tokens: number = 1): Promise<void> {
    const result = this.tryConsume(tokens);
    if (result.allowed) return;
    await new Promise(resolve => setTimeout(resolve, result.waitMs));
    // Retry once after waiting
    const retry = this.tryConsume(tokens);
    if (!retry.allowed) {
      await new Promise(resolve => setTimeout(resolve, retry.waitMs));
    }
  }

  /** Get current state without consuming */
  getState(): { tokens: number; capacity: number; refillRate: number } {
    this.refill();
    return { tokens: this.tokens, capacity: this.capacity, refillRate: this.refillRate };
  }

  /** Reset to full capacity */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
    this.lastOpTime = 0;
  }
}

/** Pre-configured limiters for common ThreadMax operations */
export const RateLimiters = {
  /** GraphQL API calls - conservative to avoid rate limits */
  graphql: new TokenBucket({ capacity: 10, refillRate: 2, minIntervalMs: 300 }),

  /** Media downloads - moderate pace */
  download: new TokenBucket({ capacity: 5, refillRate: 1, minIntervalMs: 500 }),

  /** Live capture (followers/following) - very conservative */
  liveCapture: new TokenBucket({ capacity: 3, refillRate: 0.5, minIntervalMs: 2000 }),

  /** General DOM mutations / scans */
  scan: new TokenBucket({ capacity: 20, refillRate: 10, minIntervalMs: 50 }),
};

/** Helper to wrap an async function with rate limiting */
export async function withRateLimit<T>(
  limiter: TokenBucket,
  fn: () => Promise<T>,
  tokens: number = 1
): Promise<T> {
  await limiter.consume(tokens);
  return fn();
}