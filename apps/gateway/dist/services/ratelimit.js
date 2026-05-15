"use strict";
/**
 * Token-bucket rate limiter (in-memory, per actor:tool key).
 *
 * Each bucket starts at `capacity` tokens and refills at `refillPerMs` tokens/ms.
 * A successful check consumes 1 token; if the bucket is empty the call is denied.
 *
 * NOTE: This is single-process only. For multi-replica deployments, swap to a
 * shared store (Redis INCR + sliding-window, for example).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
class RateLimiter {
    buckets = new Map();
    capacity;
    refillPerMs;
    constructor(capacity, refillPerSecond) {
        this.capacity = capacity;
        this.refillPerMs = refillPerSecond / 1000;
    }
    check(key) {
        // capacity === 0 disables rate limiting (every request allowed). Used by
        // `oculi serve` on localhost so IDE hook bursts don't trip 429s.
        if (this.capacity === 0) {
            return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterMs: 0 };
        }
        const now = Date.now();
        let bucket = this.buckets.get(key);
        if (!bucket) {
            bucket = { tokens: this.capacity, lastRefillMs: now };
            this.buckets.set(key, bucket);
        }
        // Refill based on elapsed time
        const elapsedMs = now - bucket.lastRefillMs;
        bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedMs * this.refillPerMs);
        bucket.lastRefillMs = now;
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
        }
        // Denied: calculate wait time
        const tokensNeeded = 1 - bucket.tokens;
        const retryAfterMs = Math.ceil(tokensNeeded / this.refillPerMs);
        return { allowed: false, remaining: 0, retryAfterMs };
    }
    /** Prune stale buckets (call periodically to avoid unbounded memory growth) */
    cleanup(maxIdleMs = 3_600_000 /* 1 hour */) {
        const cutoff = Date.now() - maxIdleMs;
        for (const [key, bucket] of this.buckets) {
            if (bucket.lastRefillMs < cutoff) {
                this.buckets.delete(key);
            }
        }
    }
    /** For testing: reset all buckets */
    reset() {
        this.buckets.clear();
    }
}
exports.RateLimiter = RateLimiter;
