// Authorization guards for pages (redirect / 404) and cookie-auth API routes (JSON errors).

import { notFound, redirect } from "next/navigation";
import { HttpError } from "./http";
import { assertSameOrigin } from "./request-guards";
import { getSession } from "./session";
import type { Locale } from "@/i18n/config";

export { assertSameOrigin, safeNextPath } from "./request-guards";

export async function requirePageUser(locale: Locale, returnTo: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/login?next=${encodeURIComponent(returnTo)}`);
  return session.user;
}

export async function requirePageAdmin(locale: Locale, returnTo: string) {
  const user = await requirePageUser(locale, returnTo);
  if (user.role !== "ADMIN") notFound();
  return user;
}

/** Cookie-authenticated API guard (Origin check + session). */
export async function requireApiSession(req: Request) {
  assertSameOrigin(req);
  const session = await getSession();
  if (!session) throw new HttpError(401, "unauthorized", "Please sign in.");
  return session;
}

export async function requireApiAdmin(req: Request) {
  const session = await requireApiSession(req);
  if (session.user.role !== "ADMIN") throw new HttpError(403, "forbidden", "Administrator access required.");
  return session;
}
