// Admin form contract only. SMTP credentials are never part of the public
// website settings or returned to the browser after they have been saved.

import { z } from "zod";

export const BREVO_SMTP_HOST = "smtp-relay.brevo.com";
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function text(max: number) {
  return z.string().max(max).refine((value) => !CONTROL_RE.test(value), { error: "invalid" }).transform((value) => value.trim());
}

export const brevoSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  senderEmail: text(254).refine((value) => !value || z.email().safeParse(value).success, { error: "invalid" }),
  senderName: text(100),
  smtpLogin: text(254),
  smtpPort: z.union([z.literal(587), z.literal(465)]),
  // An omitted or blank key keeps the stored key. Preserve nonblank key bytes.
  smtpKey: z.string().max(2048).refine((value) => !CONTROL_RE.test(value), { error: "invalid" })
    .transform((value) => value.trim() ? value : undefined).optional(),
}).superRefine((settings, ctx) => {
  if (settings.enabled) {
    for (const field of ["senderEmail", "senderName", "smtpLogin"] as const) {
      if (!settings[field]) ctx.addIssue({ code: "custom", path: [field], message: "required" });
    }
  }
});

export type BrevoSettingsInput = z.infer<typeof brevoSettingsSchema>;
export type BrevoSettingsForAdmin = {
  enabled: boolean;
  senderEmail: string;
  senderName: string;
  smtpLogin: string;
  smtpPort: 587 | 465;
  hasSmtpKey: boolean;
  source: "stored" | "environment" | "none";
};
