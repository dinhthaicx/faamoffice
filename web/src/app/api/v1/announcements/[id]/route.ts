// GET /api/v1/announcements/{id}?locale=vi — one published announcement, same
// shape as the list items. Drafts, unknown ids and not-yet-started ones → 404.

import {
  checkPublicRateLimit,
  findVisibleAnnouncement,
  parsePublicQuery,
  PUBLIC_JSON_HEADERS,
  publicRoute,
  toPublicAnnouncement,
} from "@/lib/announcements";
import { HttpError, json } from "@/lib/http";

export const GET = publicRoute(async (req, ctx: RouteContext<"/api/v1/announcements/[id]">) => {
  checkPublicRateLimit(req);
  const { id } = await ctx.params;
  const { locale } = parsePublicQuery(new URL(req.url).searchParams);
  const announcement = await findVisibleAnnouncement(id);
  if (!announcement) throw new HttpError(404, "not_found", "Announcement not found.");
  return json(toPublicAnnouncement(announcement, locale), { headers: PUBLIC_JSON_HEADERS });
});
