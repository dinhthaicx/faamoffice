import { z } from "zod";
import { requireApiAdmin } from "@/lib/auth";
import { adjustCredits, MAX_ADJUSTMENT } from "@/lib/credits";
import { prisma } from "@/lib/db";
import { HttpError, json, parseJson, route } from "@/lib/http";

const schema = z.object({
  delta: z.coerce
    .number()
    .int({ error: "Amount must be a whole number." })
    .refine((n) => n !== 0, { error: "Amount must not be zero." })
    .refine((n) => Math.abs(n) <= MAX_ADJUSTMENT, { error: "Amount is too large." }),
  note: z.string().trim().min(3, { error: "Enter a reason (at least 3 characters)." }).max(300),
});

export const POST = route(async (req, ctx: RouteContext<"/api/admin/users/[id]/credits">) => {
  const session = await requireApiAdmin(req);
  const { id } = await ctx.params;
  const input = await parseJson(req, schema);
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) throw new HttpError(404, "not_found", "User not found.");
  const entry = await adjustCredits({ userId: id, delta: input.delta, note: input.note, actorId: session.userId });
  return json({ ok: true, balance: entry.balanceAfter });
});
