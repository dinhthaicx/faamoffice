import { z } from "zod";
import { assertSameOrigin } from "@/lib/auth";
import { clientIp, json, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { localeSchema, passwordSchema, resetPasswordWithToken } from "@/lib/users";

const schema = z.object({
  token: z.string().min(1).max(128),
  password: passwordSchema,
  locale: localeSchema,
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const limit = limiters().resetPassword.check(clientIp(req));
  if (!limit.ok) throw rateLimited(limit.retryAfter);

  const input = await parseJson(req, schema);
  await resetPasswordWithToken(input.token, input.password);
  return json({ ok: true, redirect: `/${input.locale}/login?reset=1` });
});
