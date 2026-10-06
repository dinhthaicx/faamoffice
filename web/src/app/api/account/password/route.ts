import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { json, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { changePassword, passwordSchema } from "@/lib/users";

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const POST = route(async (req) => {
  const session = await requireApiSession(req);
  const limit = limiters().sensitiveAccount.check(`pw|${session.userId}`);
  if (!limit.ok) throw rateLimited(limit.retryAfter);
  const input = await parseJson(req, schema);
  await changePassword(session.userId, session.id, input.currentPassword, input.newPassword);
  return json({ ok: true });
});
