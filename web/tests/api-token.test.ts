import { describe, expect, it } from "vitest";
import { generateApiToken, hashApiToken, LAST_USED_RESOLUTION_MS, parseBearer, shouldTouchLastUsed } from "@/lib/api-token";
import { randomToken, safeEqual, sha256Hex } from "@/lib/crypto";

describe("API tokens", () => {
  it("are fo_ + 32 random bytes (base64url)", () => {
    const token = generateApiToken();
    expect(token).toMatch(/^fo_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token.slice(3), "base64url")).toHaveLength(32);
    expect(generateApiToken()).not.toEqual(token);
  });

  it("are stored as SHA-256 hex hashes", () => {
    const token = generateApiToken();
    expect(hashApiToken(token)).toBe(sha256Hex(token));
    expect(hashApiToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiToken(token)).not.toContain(token.slice(3));
  });

  it("parses Authorization headers strictly", () => {
    const token = generateApiToken();
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    expect(parseBearer(`bearer ${token}`)).toBe(token);
    expect(parseBearer(`Bearer ${token}  `)).toBe(token);
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer(token)).toBeNull();
    expect(parseBearer(`Basic ${token}`)).toBeNull();
    expect(parseBearer("Bearer sk-abc123")).toBeNull();
    expect(parseBearer("Bearer fo_short")).toBeNull();
    expect(parseBearer(`Bearer ${token} extra`)).toBeNull();
  });

  it("touches lastUsedAt at most once per minute", () => {
    const now = new Date("2026-10-06T10:00:00Z");
    expect(shouldTouchLastUsed(null, now)).toBe(true);
    expect(shouldTouchLastUsed(new Date(now.getTime() - 30_000), now)).toBe(false);
    expect(shouldTouchLastUsed(new Date(now.getTime() - LAST_USED_RESOLUTION_MS), now)).toBe(true);
  });
});

describe("crypto helpers", () => {
  it("compares secrets in constant time with correct results", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("generates URL-safe random tokens", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
