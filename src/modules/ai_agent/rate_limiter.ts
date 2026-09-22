/**
 * Tiny in-memory per-store rate limiter for the Merchant AI Agent.
 *
 * The agent endpoints are LLM-backed (each call costs money), so we cap
 * requests per store per window. In-memory is sufficient: limits are a
 * cost guard, not a security boundary (auth still enforced upstream).
 */
export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, opts: RateLimitOptions): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < opts.windowMs);
  if (bucket.timestamps.length >= opts.maxRequests) {
    const oldest = bucket.timestamps[0];
    return { allowed: false, retryAfterMs: Math.max(0, opts.windowMs - (now - oldest)) };
  }
  bucket.timestamps.push(now);
  return { allowed: true, retryAfterMs: 0 };
}

/** Test-only: reset all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

export const CHAT_RATE_LIMIT: RateLimitOptions = { maxRequests: 20, windowMs: 10 * 60 * 1000 };
export const UPLOAD_RATE_LIMIT: RateLimitOptions = { maxRequests: 5, windowMs: 10 * 60 * 1000 };
