import { assertSameOrigin } from "@/lib/request-guards";
import { recordDownload } from "@/lib/downloads";
import { downloadClickSchema } from "@/lib/downloads-shared";
import { clientIp, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";

// Only an explicit installer-link activation sends this request. GETs,
// link previews and prefetches never count. No visitor data is stored.
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const click = await parseJson(req, downloadClickSchema, 1024);
  if (/(bot|crawler|spider|preview|facebookexternalhit|headless)/i.test(req.headers.get("user-agent") ?? "")) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  const limit = limiters().downloadClicks.check(clientIp(req));
  if (!limit.ok) throw rateLimited(limit.retryAfter);
  await recordDownload(click);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
