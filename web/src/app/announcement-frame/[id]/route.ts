// GET /announcement-frame/{id}?locale=vi — the admin-authored HTML of a published
// "html" announcement as a complete document, for the desktop app's iframe.
//
// The CSP `sandbox` directive (no allow-scripts, no allow-same-origin) puts the
// document in an opaque origin, so it can never read faamoffice.net cookies or
// storage; there is no script-src, so scripts never run. This path is excluded
// from the site-wide headers (X-Frame-Options: DENY, frame-ancestors 'none') in
// next.config.ts and from the locale proxy.

import { checkPublicRateLimit, findVisibleAnnouncement, PUBLIC_CACHE_CONTROL } from "@/lib/announcements";
import { buildFrameDocument, contentLocale, FRAME_RESPONSE_HEADERS, localizeAnnouncement } from "@/lib/announcement-shared";
import { HttpError } from "@/lib/http";

function frameResponse(body: string, status: number, extra?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { ...FRAME_RESPONSE_HEADERS, "Cache-Control": status === 200 ? PUBLIC_CACHE_CONTROL : "no-store", ...extra },
  });
}

const NOT_FOUND = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><p>Not found</p></body></html>';

export async function GET(req: Request, ctx: RouteContext<"/announcement-frame/[id]">): Promise<Response> {
  try {
    checkPublicRateLimit(req);
    const { id } = await ctx.params;
    const locale = contentLocale(new URL(req.url).searchParams.get("locale"));
    const announcement = await findVisibleAnnouncement(id);
    if (!announcement || announcement.kind !== "html") return frameResponse(NOT_FOUND, 404);
    const { title, html } = localizeAnnouncement(announcement, locale);
    if (!html) return frameResponse(NOT_FOUND, 404);
    return frameResponse(buildFrameDocument({ html, title, lang: locale }), 200);
  } catch (err) {
    if (err instanceof HttpError) return frameResponse(err.message, err.status, err.headers);
    console.error("[announcement-frame] unhandled error", err);
    return frameResponse("Something went wrong.", 500);
  }
}
