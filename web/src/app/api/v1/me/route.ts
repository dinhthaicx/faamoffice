// GET /api/v1/me — the signed-in desktop user (Bearer token).
// `credits` is only present while Faam credits are on; with credits off and a
// daily limit set, `aiQuota` reports today's usage instead.

import { getAiQuota } from "@/lib/ai-quota";
import { authenticateBearer } from "@/lib/api-token";
import { json, route } from "@/lib/http";
import { getSiteSettings } from "@/lib/site-settings";
import { publicUser } from "@/lib/users";

export const GET = route(async (req) => {
  const { user } = await authenticateBearer(req);
  const settings = await getSiteSettings();
  const { credits, createdAt, ...profile } = publicUser(user);
  const aiQuota = await getAiQuota(user.id, settings);
  return json({
    ...profile,
    creditsEnabled: settings.creditsEnabled,
    ...(settings.creditsEnabled ? { credits } : {}),
    ...(aiQuota ? { aiQuota } : {}),
    createdAt,
  });
});
