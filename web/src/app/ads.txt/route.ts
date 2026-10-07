// GET /ads.txt — authorized digital sellers (IAB ads.txt) for Google AdSense.
// Outside the locale routing (the proxy matcher skips paths with an extension).
// Google's record comes from the publisher id in the admin Settings (served as
// soon as it is saved, even while ads are off, so the site can be verified),
// followed by the extra records entered there. Nothing configured → 404 with an
// empty body. Short cache, so an admin change shows up within minutes.

import { adsTxtBody } from "@/lib/ads";
import { readSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

const TEXT = "text/plain; charset=utf-8";

export async function GET() {
  const { settings, degraded } = await readSiteSettings();
  // A database hiccup must not look like "no ads.txt" (which crawlers cache).
  if (degraded.includes("ads")) {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
  const body = adsTxtBody(settings.ads);
  if (!body) return new Response(null, { status: 404, headers: { "Content-Type": TEXT, "Cache-Control": "public, max-age=60" } });
  return new Response(body, { headers: { "Content-Type": TEXT, "Cache-Control": "public, max-age=300" } });
}
