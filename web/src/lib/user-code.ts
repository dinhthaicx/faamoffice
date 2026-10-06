// Device-flow user codes: 8 letters shown as "ABCD-EFGH".
// The alphabet has no vowels (no accidental words) and no look-alike
// characters such as 0/O or 1/I, as recommended by RFC 8628 §6.1.

import { randomInt } from "node:crypto";

export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const USER_CODE_LENGTH = 8;

export function generateUserCode(): string {
  let raw = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    raw += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * Normalize user input (any case, spaces or dashes) to "ABCD-EFGH".
 * Returns null when the input cannot be a valid user code.
 */
export function normalizeUserCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.toUpperCase().replace(/[\s\-_.]/g, "");
  if (raw.length !== USER_CODE_LENGTH) return null;
  for (const ch of raw) {
    if (!USER_CODE_ALPHABET.includes(ch)) return null;
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
