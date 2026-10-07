// Simple fixed-window, in-memory rate limiter.
//
// State lives in the current Node.js process: limits are per process (each
// replica / worker counts separately) and reset on restart. Good enough for a
// single-instance deployment; use a shared store (e.g. Redis) when scaling out.

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Seconds until the current window resets. */
  retryAfter: number;
};

export type RateLimiter = {
  check(key: string, now?: number): RateLimitResult;
  reset(key: string): void;
  size(): number;
};

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function sweep(now: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    // Still too big (many active keys): drop the oldest entries.
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  return {
    check(key, now = Date.now()) {
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        if (buckets.size >= maxKeys) sweep(now);
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      const retryAfter = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
      if (bucket.count > limit) return { ok: false, remaining: 0, retryAfter };
      return { ok: true, remaining: limit - bucket.count, retryAfter };
    },
    reset(key) {
      buckets.delete(key);
    },
    size() {
      return buckets.size;
    },
  };
}

// Shared limiters for the auth endpoints. Kept on globalThis so dev-mode hot
// reloads do not reset them.
type Limiters = ReturnType<typeof buildLimiters>;

function buildLimiters() {
  const minute = 60_000;
  return {
    loginIp: createRateLimiter({ limit: 30, windowMs: 15 * minute }),
    loginAccount: createRateLimiter({ limit: 10, windowMs: 15 * minute }),
    register: createRateLimiter({ limit: 10, windowMs: 60 * minute }),
    forgotIp: createRateLimiter({ limit: 10, windowMs: 60 * minute }),
    forgotEmail: createRateLimiter({ limit: 3, windowMs: 60 * minute }),
    resetPassword: createRateLimiter({ limit: 20, windowMs: 15 * minute }),
    resendVerification: createRateLimiter({ limit: 3, windowMs: 60 * minute }),
    deviceCode: createRateLimiter({ limit: 20, windowMs: 10 * minute }),
    deviceToken: createRateLimiter({ limit: 120, windowMs: minute }),
    deviceApprove: createRateLimiter({ limit: 30, windowMs: 10 * minute }),
    sensitiveAccount: createRateLimiter({ limit: 20, windowMs: 15 * minute }),
    // Public announcement endpoints (list, single, image, frame), per IP.
    announcements: createRateLimiter({ limit: 300, windowMs: minute }),
    // Admin image uploads, per admin.
    announcementUpload: createRateLimiter({ limit: 30, windowMs: 10 * minute }),
  };
}

const globalForLimiters = globalThis as unknown as { __faamLimiters?: Limiters };

export function limiters(): Limiters {
  globalForLimiters.__faamLimiters ??= buildLimiters();
  return globalForLimiters.__faamLimiters;
}
