// DB-backed web sessions stored in an httpOnly cookie. The cookie carries a
// random 256-bit secret; only its SHA-256 hash is stored in the database.

import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "./db";
import { randomToken, sha256Hex } from "./crypto";
import { getConfig } from "./env";
import { clientIp } from "./http";

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** `__Host-` prefix (requires Secure, Path=/, no Domain) whenever cookies are Secure. */
export function sessionCookieName(): string {
  return getConfig().cookieSecure ? "__Host-fo_session" : "fo_session";
}

export async function createSession(userId: string, req: Request): Promise<void> {
  const token = randomToken(32);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      ip: clientIp(req).slice(0, 64),
    },
  });
  const jar = await cookies();
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: getConfig().cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token || token.length > 128) return null;
  return token;
}

/** The current session with its user, or null (expired, missing, or user disabled). Cached per request. */
export const getSession = cache(async () => {
  const token = await readSessionToken();
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.disabledAt) return null;
  return session;
});

export async function destroySession(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  }
  const jar = await cookies();
  jar.delete({ name: sessionCookieName(), path: "/", secure: getConfig().cookieSecure, httpOnly: true, sameSite: "lax" });
}
