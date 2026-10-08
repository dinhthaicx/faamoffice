// Request checks with no framework dependencies (unit-tested).

import { getConfig } from "./env";
import { HttpError } from "./http";

/**
 * CSRF defence for cookie-authenticated mutations: the browser-supplied Origin
 * must be this site (SITE_URL) or the host the request was sent to. Cross-site
 * forms and fetches carry a foreign Origin and are rejected.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) throw new HttpError(403, "invalid_origin", "Missing Origin header.");
  if (origin === getConfig().siteOrigin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return;
  } catch {
    // fall through
  }
  throw new HttpError(403, "invalid_origin", "Cross-site request rejected.");
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) {
    return fallback;
  }
  return next.length > 500 ? fallback : next;
}
