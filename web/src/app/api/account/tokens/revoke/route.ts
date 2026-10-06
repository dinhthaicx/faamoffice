import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, json, parseJson, route } from "@/lib/http";

const schema = z.object({ id: z.string().min(1).max(64) });

export const POST = route(async (req) => {
  const session = await requireApiSession(req);
  const { id } = await parseJson(req, schema);
  const res = await prisma.apiToken.updateMany({
    where: { id, userId: session.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count !== 1) throw new HttpError(404, "not_found", "Device not found or already signed out.");
  return json({ ok: true });
});
