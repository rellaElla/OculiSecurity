/**
 * Token-bucket rate limiter (in-memory, per actor:tool key).
 *
 * Each bucket starts at `capacity` tokens and refills at `refillPerMs` tokens/ms.
 * A successful check consumes 1 token; if the bucket is empty the call is denied.
 *
 * NOTE: This is single-process only. For multi-replica deployments, swap to a
 * shared store (Redis INCR + sliding-window, for example).
 */
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    /** Approximate ms until at least one token is available */
    retryAfterMs: number;
}
export declare class RateLimiter {
    private readonly buckets;
    private readonly capacity;
    private readonly refillPerMs;
    constructor(capacity: number, refillPerSecond: number);
    check(key: string): RateLimitResult;
    /** Prune stale buckets (call periodically to avoid unbounded memory growth) */
    cleanup(maxIdleMs?: number): void;
    /** For testing: reset all buckets */
    reset(): void;
}
//# sourceMappingURL=ratelimit.d.ts.map