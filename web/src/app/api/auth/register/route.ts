import { z } from "zod";
import { assertSameOrigin, safeNextPath } from "@/lib/auth";
import { clientIp, json, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";
import { emailSchema, localeSchema, nameSchema, passwordSchema, registerUser } from "@/lib/users";

const schema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  locale: localeSchema,
  next: z.string().max(500).optional(),
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const limit = limiters().register.check(clientIp(req));
  if (!limit.ok) throw rateLimited(limit.retryAfter);

  const input = await parseJson(req, schema);
  const user = await registerUser(input);
  await createSession(user.id, req);
  const redirect = input.next ? safeNextPath(input.next, `/${input.locale}/account?welcome=1`) : `/${input.locale}/account?welcome=1`;
  return json({ ok: true, redirect }, { status: 201 });
});
