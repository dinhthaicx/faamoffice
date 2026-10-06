import { z } from "zod";
import { requireApiAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, json, parseJson, route } from "@/lib/http";

const schema = z.object({ disabled: z.boolean() });

export const POST = route(async (req, ctx: RouteContext<"/api/admin/users/[id]/status">) => {
  const session = await requireApiAdmin(req);
  const { id } = await ctx.params;
  const { disabled } = await parseJson(req, schema);
  if (id === session.userId) throw new HttpError(400, "cannot_disable_self", "You cannot disable your own account.");
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) throw new HttpError(404, "not_found", "User not found.");

  if (disabled) {
    // Disabled users cannot sign in; their sessions are dropped and their API
    // tokens are rejected by the bearer check while the account stays disabled.
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { disabledAt: new Date() } }),
      prisma.session.deleteMany({ where: { userId: id } }),
    ]);
  } else {
    await prisma.user.update({ where: { id }, data: { disabledAt: null } });
  }
  return json({ ok: true, disabled });
});
