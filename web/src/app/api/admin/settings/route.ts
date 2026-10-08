// Site settings (ADMIN, same-origin, JSON):
//   PATCH /api/admin/settings — any subset of the site settings
//   PUT   /api/admin/settings — every setting
// Both reply { ok: true, settings } with the stored (normalized) values;
// validation errors are 400 invalid_request with `fields` keyed by path
// ("socialLinks.2.url": "wrong_host").

import { requireApiAdmin } from "@/lib/auth";
import { checkAiBackend } from "@/lib/ai-backend";
import { json, readJson, route } from "@/lib/http";
import { parseSettingsPatch, parseSettingsPut, updateSiteSettings } from "@/lib/site-settings";

const SETTINGS_JSON_LIMIT = 64 * 1024;

export const PATCH = route(async (req) => {
  const session = await requireApiAdmin(req);
  const patch = parseSettingsPatch(await readJson(req, SETTINGS_JSON_LIMIT));
  if (patch.aiBackend) await checkAiBackend(patch.aiBackend, req.signal);
  const settings = await updateSiteSettings(patch, session.userId);
  return json({ ok: true, settings });
});

export const PUT = route(async (req) => {
  const session = await requireApiAdmin(req);
  const all = parseSettingsPut(await readJson(req, SETTINGS_JSON_LIMIT));
  if (all.aiBackend) await checkAiBackend(all.aiBackend, req.signal);
  const settings = await updateSiteSettings(all, session.userId);
  return json({ ok: true, settings });
});
