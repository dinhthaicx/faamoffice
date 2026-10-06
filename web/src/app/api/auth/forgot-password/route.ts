import { z } from "zod";
import { assertSameOrigin } from "@/lib/auth";
import { clientIp, json, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { emailSchema, localeSchema, requestPasswordReset } from "@/lib/users";

const schema = z.object({ email: emailSchema, locale: localeSchema });

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const ipLimit = limiters().forgotIp.check(clientIp(req));
  if (!ipLimit.ok) throw rateLimited(ipLimit.retryAfter);

  const input = await parseJson(req, schema);
  // Per-email limit is silent so it cannot be used to probe for accounts.
  if (limiters().forgotEmail.check(input.email).ok) {
    await requestPasswordReset(input.email, input.locale);
  }
  return json({ ok: true });
});
