import { describe, expect, it } from "vitest";
import { generateUserCode, normalizeUserCode, USER_CODE_ALPHABET } from "@/lib/user-code";

describe("user codes", () => {
  it("generates ABCD-EFGH codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateUserCode();
      expect(code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
      for (const ch of code.replace("-", "")) expect(USER_CODE_ALPHABET).toContain(ch);
    }
  });

  it("alphabet has no vowels or look-alike characters", () => {
    for (const ch of "AEIOUY01") expect(USER_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(USER_CODE_ALPHABET).size).toBe(USER_CODE_ALPHABET.length);
  });

  it("is reasonably random", () => {
    const seen = new Set(Array.from({ length: 2000 }, generateUserCode));
    expect(seen.size).toBeGreaterThan(1990);
  });

  it("normalizes user input", () => {
    expect(normalizeUserCode("BCDF-GHJK")).toBe("BCDF-GHJK");
    expect(normalizeUserCode("bcdfghjk")).toBe("BCDF-GHJK");
    expect(normalizeUserCode(" bcdf ghjk ")).toBe("BCDF-GHJK");
    expect(normalizeUserCode("bc-df_gh.jk")).toBe("BCDF-GHJK");
  });

  it("rejects invalid input", () => {
    expect(normalizeUserCode("")).toBeNull();
    expect(normalizeUserCode(null)).toBeNull();
    expect(normalizeUserCode(undefined)).toBeNull();
    expect(normalizeUserCode("BCDF-GHJ")).toBeNull();
    expect(normalizeUserCode("BCDF-GHJKL")).toBeNull();
    expect(normalizeUserCode("ABCD-EFGH")).toBeNull(); // vowels are never issued
    expect(normalizeUserCode("BCDF-GHJ1")).toBeNull();
  });
});
