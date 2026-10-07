// GET /api/v1/announcements/{id}/image — the uploaded image of a published announcement.

import { checkPublicRateLimit, findVisibleAnnouncementImage, publicRoute } from "@/lib/announcements";
import { HttpError } from "@/lib/http";

export const GET = publicRoute(async (req, ctx: RouteContext<"/api/v1/announcements/[id]/image">) => {
  checkPublicRateLimit(req);
  const { id } = await ctx.params;
  const image = await findVisibleAnnouncementImage(id);
  if (!image) throw new HttpError(404, "not_found", "Image not found.");
  return new Response(image.bytes, {
    status: 200,
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.bytes.byteLength),
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
});
