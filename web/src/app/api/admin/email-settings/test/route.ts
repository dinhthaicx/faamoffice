import { requireApiAdmin } from "@/lib/auth";
import { testBrevoSettings } from "@/lib/brevo-settings";
import { brevoSettingsSchema } from "@/lib/brevo-settings-shared";
import { json, parseJson, route } from "@/lib/http";

export const POST = route(async (req) => {
  await requireApiAdmin(req);
  const input = await parseJson(req, brevoSettingsSchema, 16 * 1024);
  await testBrevoSettings(input);
  return json({ ok: true });
});
