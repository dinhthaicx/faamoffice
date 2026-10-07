// POST /api/admin/announcements — create an announcement (ADMIN, same-origin, JSON).

import { ANNOUNCEMENT_JSON_LIMIT, createAnnouncement, parseAnnouncementInput } from "@/lib/announcements";
import { requireApiAdmin } from "@/lib/auth";
import { json, readJson, route } from "@/lib/http";

export const POST = route(async (req) => {
  const session = await requireApiAdmin(req);
  const input = parseAnnouncementInput(await readJson(req, ANNOUNCEMENT_JSON_LIMIT));
  const announcement = await createAnnouncement(input, session.userId);
  return json({ ok: true, id: announcement.id }, { status: 201 });
});
