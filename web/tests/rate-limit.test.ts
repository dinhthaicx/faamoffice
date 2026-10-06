import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

describe("rate limiter", () => {
  it("allows `limit` requests per window, then blocks with retryAfter", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const t = 1_000_000;
    expect(rl.check("ip", t)).toEqual({ ok: true, remaining: 2, retryAfter: 60 });
    expect(rl.check("ip", t + 1).ok).toBe(true);
    expect(rl.check("ip", t + 2).ok).toBe(true);
    const blocked = rl.check("ip", t + 30_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(30);
  });

  it("resets after the window and keeps keys independent", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.check("a", 0).ok).toBe(true);
    expect(rl.check("a", 10).ok).toBe(false);
    expect(rl.check("b", 10).ok).toBe(true);
    expect(rl.check("a", 1000).ok).toBe(true);
  });

  it("can reset a key (e.g. after a successful login)", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    rl.check("k", 0);
    expect(rl.check("k", 1).ok).toBe(false);
    rl.reset("k");
    expect(rl.check("k", 2).ok).toBe(true);
  });

  it("bounds memory by sweeping expired and oldest keys", () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) rl.check(`key-${i}`, i);
    expect(rl.size()).toBeLessThanOrEqual(101);
  });
});
