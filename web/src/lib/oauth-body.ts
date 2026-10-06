// Body parsing for the device-flow endpoints called by the desktop app.

import { HttpError, readBodyText } from "./http";

/** Accept JSON (documented) and form-encoded bodies (RFC 8628 style). */
export async function readOAuthBody(req: Request): Promise<unknown> {
  const text = await readBodyText(req, 16 * 1024);
  if ((req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_request", "Request body must be valid JSON.");
  }
}

/** Device names are shown to the user: strip control characters, collapse spaces, max 80 chars. */
export function cleanDeviceName(value: string | undefined): string {
  const cleaned = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "FaamOffice desktop").slice(0, 80);
}
