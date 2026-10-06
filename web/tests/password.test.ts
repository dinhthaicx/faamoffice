import { describe, expect, it } from "vitest";
import { hashPassword, verifyDummyPassword, verifyPassword } from "@/lib/password";

// Cheaper scrypt cost for tests; production uses N = 2^15.
const FAST = { N: 2 ** 10, r: 8, p: 1 };

describe("password hashing", () => {
  it("hashes in the documented format with a random salt", async () => {
    const a = await hashPassword("correct horse battery", FAST);
    const b = await hashPassword("correct horse battery", FAST);
    expect(a).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toEqual(b);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery", FAST);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse battery!", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("uses default production parameters", async () => {
    const hash = await hashPassword("a-long-password-123");
    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("a-long-password-123", hash)).toBe(true);
  });

  it("normalizes Unicode so composed and decomposed input match", async () => {
    const composed = "mật khẩu an toàn"; // NFC
    const decomposed = composed.normalize("NFD");
    const hash = await hashPassword(composed, FAST);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  it("rejects malformed or hostile hashes without throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$foo")).toBe(false);
    expect(await verifyPassword("x", "scrypt$abc$8$1$c2FsdA==$aGFzaA==")).toBe(false);
    // Absurd cost parameters must be refused (DoS protection).
    expect(await verifyPassword("x", "scrypt$1073741824$8$1$c2FsdA==$aGFzaA==")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1024$8$1$c2FsdA==$")).toBe(false);
  });

  it("runs the dummy verification used for unknown emails", async () => {
    await expect(verifyDummyPassword("whatever")).resolves.toBeUndefined();
  });
});
