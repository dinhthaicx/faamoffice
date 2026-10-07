// POST /api/admin/announcements/{id} — replace an announcement's fields (ADMIN, same-origin, JSON).
// Replies with the stored values (normalized: e.g. an html announcement has no
// image) so the editor can continue from what was actually saved.

import { toAnnouncementFormValues } from "@/lib/announcement-shared";
import { ANNOUNCEMENT_JSON_LIMIT, parseAnnouncementInput, updateAnnouncement } from "@/lib/announcements";
import { requireApiAdmin } from "@/lib/auth";
import { json, readJson, route } from "@/lib/http";

export const POST = route(async (req, ctx: RouteContext<"/api/admin/announcements/[id]">) => {
  const session = await requireApiAdmin(req);
  const { id } = await ctx.params;
  const input = parseAnnouncementInput(await readJson(req, ANNOUNCEMENT_JSON_LIMIT));
  const announcement = await updateAnnouncement(id, input, session.userId);
  return json({ ok: true, id: announcement.id, values: toAnnouncementFormValues(announcement), image: announcement.image });
});
