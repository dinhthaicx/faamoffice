// Bearer tokens ("fo_<random>") used by the FaamOffice desktop app.

import { prisma } from "./db";
import { randomToken, sha256Hex } from "./crypto";
import { HttpError } from "./http";

export const API_TOKEN_PREFIX = "fo_";
/** lastUsedAt is written at most once per this interval. */
export const LAST_USED_RESOLUTION_MS = 60_000;

const BEARER_RE = /^Bearer\s+(fo_[A-Za-z0-9_-]{32,128})\s*$/i;

/** New token: "fo_" + 32 random bytes (base64url). */
export function generateApiToken(): string {
  return API_TOKEN_PREFIX + randomToken(32);
}

export function hashApiToken(token: string): string {
  return sha256Hex(token);
}

export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = BEARER_RE.exec(header);
  return m ? m[1] : null;
}

export function shouldTouchLastUsed(lastUsedAt: Date | null, now: Date): boolean {
  return !lastUsedAt || now.getTime() - lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS;
}

export function invalidToken(): HttpError {
  return new HttpError(401, "invalid_token", "The access token is missing, invalid or revoked.", undefined, {
    "WWW-Authenticate": 'Bearer error="invalid_token"',
  });
}

/**
 * Authenticate `Authorization: Bearer fo_...`. Throws 401 invalid_token when the
 * token is missing, unknown, revoked, or belongs to a disabled user.
 * Cookies are never consulted.
 */
export async function authenticateBearer(req: Request) {
  const raw = parseBearer(req.headers.get("authorization"));
  if (!raw) throw invalidToken();
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(raw) },
    include: { user: true },
  });
  if (!token || token.revokedAt || token.user.disabledAt) throw invalidToken();

  const now = new Date();
  if (shouldTouchLastUsed(token.lastUsedAt, now)) {
    // Conditional update keeps concurrent requests from writing more than once a minute.
    await prisma.apiToken.updateMany({
      where: {
        id: token.id,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_RESOLUTION_MS) } }],
      },
      data: { lastUsedAt: now },
    });
  }
  return { token, user: token.user };
}
