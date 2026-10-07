// POST /api/admin/announcements/{id}/status — publish or unpublish (ADMIN, same-origin).

import { z } from "zod";
import { ANNOUNCEMENT_STATUSES } from "@/lib/announcement-shared";
import { setAnnouncementStatus } from "@/lib/announcements";
import { requireApiAdmin } from "@/lib/auth";
import { json, parseJson, route } from "@/lib/http";

const schema = z.object({ status: z.enum(ANNOUNCEMENT_STATUSES) });

export const POST = route(async (req, ctx: RouteContext<"/api/admin/announcements/[id]/status">) => {
  const session = await requireApiAdmin(req);
  const { id } = await ctx.params;
  const { status } = await parseJson(req, schema);
  const announcement = await setAnnouncementStatus(id, status, session.userId);
  return json({ ok: true, status: announcement.status });
});
