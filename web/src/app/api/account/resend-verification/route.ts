import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { json, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { localeSchema, sendVerificationEmail } from "@/lib/users";

const schema = z.object({ locale: localeSchema });

export const POST = route(async (req) => {
  const session = await requireApiSession(req);
  const { locale } = await parseJson(req, schema);
  if (session.user.emailVerifiedAt) return json({ ok: true, alreadyVerified: true });
  const limit = limiters().resendVerification.check(session.userId);
  if (!limit.ok) throw rateLimited(limit.retryAfter);
  await sendVerificationEmail(session.user, locale);
  return json({ ok: true });
});
