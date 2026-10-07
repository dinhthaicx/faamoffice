// GET /api/admin/announcements/images/{id} — any uploaded image (drafts included)
// for the admin editor's preview. Session + ADMIN role; read-only.

import { requireApiAdminRead } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, route } from "@/lib/http";

export const GET = route(async (_req, ctx: RouteContext<"/api/admin/announcements/images/[id]">) => {
  await requireApiAdminRead();
  const { id } = await ctx.params;
  const image = id.length <= 64 ? await prisma.announcementImage.findUnique({ where: { id } }) : null;
  if (!image) throw new HttpError(404, "not_found", "Image not found.");
  return new Response(image.bytes, {
    status: 200,
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
