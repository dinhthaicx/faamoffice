import { requireApiAdmin, requireApiAdminRead } from "@/lib/auth";
import { getBrevoSettingsForAdmin, saveBrevoSettings } from "@/lib/brevo-settings";
import { brevoSettingsSchema } from "@/lib/brevo-settings-shared";
import { json, parseJson, route } from "@/lib/http";

export const GET = route(async () => {
  await requireApiAdminRead();
  return json({ settings: await getBrevoSettingsForAdmin() });
});

export const PATCH = route(async (req) => {
  const session = await requireApiAdmin(req);
  const input = await parseJson(req, brevoSettingsSchema, 16 * 1024);
  return json({ ok: true, settings: await saveBrevoSettings(input, session.userId) });
});
