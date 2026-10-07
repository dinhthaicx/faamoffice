// POST /api/admin/announcements/{id}/delete — delete an announcement and its unused image (ADMIN, same-origin).

import { deleteAnnouncement } from "@/lib/announcements";
import { requireApiAdmin } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const POST = route(async (req, ctx: RouteContext<"/api/admin/announcements/[id]/delete">) => {
  await requireApiAdmin(req);
  const { id } = await ctx.params;
  await deleteAnnouncement(id);
  return json({ ok: true });
});
