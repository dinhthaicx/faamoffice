// GET /api/v1/announcements?platform=mac|win|linux&version=0.11.1&locale=vi
// Active announcements for the desktop app (no auth; drafts are never exposed).

import { checkPublicRateLimit, listActiveAnnouncements, parsePublicQuery, PUBLIC_JSON_HEADERS, publicRoute } from "@/lib/announcements";
import { json } from "@/lib/http";

export const GET = publicRoute(async (req) => {
  checkPublicRateLimit(req);
  const query = parsePublicQuery(new URL(req.url).searchParams);
  const announcements = await listActiveAnnouncements(query);
  return json({ announcements }, { headers: PUBLIC_JSON_HEADERS });
});
