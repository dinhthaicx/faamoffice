import { z } from "zod";
import { assertSameOrigin, safeNextPath } from "@/lib/auth";
import { clientIp, json, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";
import { authenticateUser, emailSchema, localeSchema } from "@/lib/users";

const schema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  locale: localeSchema,
  next: z.string().max(500).optional(),
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  const ipLimit = limiters().loginIp.check(ip);
  if (!ipLimit.ok) throw rateLimited(ipLimit.retryAfter);

  const input = await parseJson(req, schema);
  const accountKey = `${ip}|${input.email}`;
  const accountLimit = limiters().loginAccount.check(accountKey);
  if (!accountLimit.ok) throw rateLimited(accountLimit.retryAfter);

  const user = await authenticateUser(input.email, input.password);
  limiters().loginAccount.reset(accountKey);
  await createSession(user.id, req);
  return json({ ok: true, redirect: safeNextPath(input.next, `/${input.locale}/account`) });
});
