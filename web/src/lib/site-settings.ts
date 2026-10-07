// Site settings stored in the SiteSetting table (one JSON row per key).
//
// Reading (cached per process, never failing, per-key fallback to the
// defaults) lives in site-settings-read.ts and is re-exported here. Saving
// clears the cache and revalidates every page rendered under the [locale]
// layout: the footer shows the social links, the layout carries the AdSense
// verification meta tag, the home and Faam AI pages the ads, the privacy page
// the advertising section and the download page the Microsoft Store badge.

import { revalidatePath } from "next/cache";
import { prisma } from "./db";
import { HttpError } from "./http";
import { clearSiteSettingsCache, getSiteSettings } from "./site-settings-read";
import {
  SETTING_KEYS,
  settingsFieldErrors,
  settingsPatchSchema,
  settingsPutSchema,
  type SiteSettings,
  type SiteSettingsPatch,
} from "./site-settings-shared";

export * from "./site-settings-read";
export * from "./site-settings-shared";

function invalid(issues: Parameters<typeof settingsFieldErrors>[0]): HttpError {
  const fields = settingsFieldErrors(issues);
  const [field, code] = Object.entries(fields)[0] ?? ["form", "invalid"];
  return new HttpError(400, "invalid_request", `${field}: ${code}`, { field, fields });
}

/** Validate a PATCH body (any subset of the settings). 400 invalid_request with `fields` on failure. */
export function parseSettingsPatch(data: unknown): SiteSettingsPatch {
  const result = settingsPatchSchema.safeParse(data);
  if (!result.success) throw invalid(result.error.issues);
  return result.data;
}

/** Validate a PUT body (every setting). */
export function parseSettingsPut(data: unknown): SiteSettings {
  const result = settingsPutSchema.safeParse(data);
  if (!result.success) throw invalid(result.error.issues);
  return result.data;
}

/** Re-render the pages whose output depends on the settings (footer on every localized page). */
function revalidateSettingsPages(): void {
  try {
    // Marks every page under app/[locale]/layout.tsx stale; each is rebuilt on its next visit.
    revalidatePath("/[locale]", "layout");
  } catch (err) {
    // Outside a Next.js request (tests, scripts) there is no page cache to revalidate.
    if (process.env.NEXT_RUNTIME) console.error("[site-settings] revalidation failed:", (err as Error)?.message ?? err);
  }
}

/**
 * Save the given (already validated) settings, leaving the others untouched,
 * and return the full settings as now stored.
 */
export async function updateSiteSettings(patch: SiteSettingsPatch, actorId: string | null): Promise<SiteSettings> {
  const entries = SETTING_KEYS.filter((key) => patch[key] !== undefined).map((key) => [key, JSON.stringify(patch[key])] as const);
  if (entries.length) {
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.siteSetting.upsert({
          where: { key },
          create: { key, value, updatedById: actorId },
          update: { value, updatedById: actorId },
        }),
      ),
    );
  }
  clearSiteSettingsCache();
  revalidateSettingsPages();
  return getSiteSettings();
}

/** When and by whom the settings were last saved (admin page). */
export async function lastSettingsUpdate(): Promise<{ updatedAt: Date; updatedById: string | null } | null> {
  try {
    return await prisma.siteSetting.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true, updatedById: true },
    });
  } catch {
    return null;
  }
}
