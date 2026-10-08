import { z } from "zod";
import { assertSameOrigin, safeNextPath } from "@/lib/auth";
import { clientIp, json, parseJson, rateLimited, route } from "@/lib/http";
import { limiters } from "@/lib/rate-limit";
import { createSession } from "@/lib/session";
import { MailDeliveryError } from "@/lib/mail";
import { emailSchema, localeSchema, nameSchema, passwordSchema, registerUser, sendVerificationEmail } from "@/lib/users";

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
  let verificationEmailSent = true;
  try {
    await sendVerificationEmail(user, input.locale);
  } catch (error) {
    if (!(error instanceof MailDeliveryError)) throw error;
    // The account already exists. Let its owner sign in and resend instead of
    // reporting failed registration and then "email taken" on their next try.
    verificationEmailSent = false;
  }
  await createSession(user.id, req);
  const accountPath = `/${input.locale}/account?welcome=1${verificationEmailSent ? "" : "&verificationEmail=failed"}`;
  const nextPath = safeNextPath(input.next, accountPath);
  // Show the delivery warning before resuming a device or other safe flow.
  const redirect = verificationEmailSent
    ? nextPath
    : `${accountPath}${nextPath !== accountPath ? `&next=${encodeURIComponent(nextPath)}` : ""}`;
  return json({ ok: true, redirect, verificationEmailSent }, { status: 201 });
});
