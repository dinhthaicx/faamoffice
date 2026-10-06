import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { json, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { destroySession } from "@/lib/session";
import { deleteAccount, localeSchema } from "@/lib/users";

const schema = z.object({ password: z.string().min(1).max(200), locale: localeSchema });

export const POST = route(async (req) => {
  const session = await requireApiSession(req);
  const limit = limiters().sensitiveAccount.check(`del|${session.userId}`);
  if (!limit.ok) throw rateLimited(limit.retryAfter);
  const input = await parseJson(req, schema);
  await deleteAccount(session.userId, input.password);
  await destroySession();
  return json({ ok: true, redirect: `/${input.locale}?deleted=1` });
});
