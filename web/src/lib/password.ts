// Password hashing with node:crypto scrypt (no native dependencies).
// Stored format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 1 };

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize("NFKC"), salt, keylen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

function maxmemFor(N: number, r: number): number {
  // scrypt needs ~128 * N * r bytes; leave headroom.
  return 128 * N * r * 2;
}

export async function hashPassword(password: string, params = DEFAULT_PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p } = params;
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: maxmemFor(N, r) });
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 2 ** 20 || r > 32 || p > 16) {
    return false;
  }
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (expected.length === 0) return false;
  try {
    const actual = await scrypt(password, salt, expected.length, { N, r, p, maxmem: maxmemFor(N, r) });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Burn roughly the same CPU time as a real verification. Called when a login
 * targets an unknown email so response timing does not reveal which accounts exist.
 */
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(password, await dummyHash);
}
