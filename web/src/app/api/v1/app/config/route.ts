// GET /api/v1/app/config — public configuration for the desktop app (no auth,
// no cookies, CORS-readable). Today: the enabled social links, in display
// order. Clients must ignore keys they do not know; more may be added.

import { publicRoute, PUBLIC_CORS_HEADERS } from "@/lib/announcements";
import { clientIp, HttpError, json, rateLimited } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { publicSocialLinks, readSiteSettings } from "@/lib/site-settings";

// The app fetches it once per session; five minutes of shared caching is plenty.
const CACHE_CONTROL = "public, max-age=300";

export const GET = publicRoute(async (req) => {
  const limit = limiters().appConfig.check(`cfg|${clientIp(req)}`);
  if (!limit.ok) throw rateLimited(limit.retryAfter);
  const { settings, degraded } = await readSiteSettings();
  // The app replaces its cached list with any 200 answer, so never pass off the
  // fallback (an empty list) as the real one: a non-200 makes it keep its cache.
  if (degraded.includes("socialLinks")) {
    throw new HttpError(503, "unavailable", "The app configuration is temporarily unavailable.", undefined, {
      "Retry-After": "60",
    });
  }
  return json(
    { socials: publicSocialLinks(settings.socialLinks) },
    { headers: { "Cache-Control": CACHE_CONTROL, ...PUBLIC_CORS_HEADERS } },
  );
});
