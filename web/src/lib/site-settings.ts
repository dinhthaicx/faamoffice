// Site settings stored in the SiteSetting table (one JSON row per key).
//
// Reads are cached per process for SITE_SETTINGS_TTL_MS and never fail: a
// missing table (not migrated yet, e.g. during `next build`), a database error
// or an invalid stored value falls back to the defaults, key by key (social
// links link by link). readSiteSettings() also says which keys fell back that
// way, for callers that must not present the defaults as the real values.
// Saving clears the cache and revalidates every page rendered under the
// [locale] layout, whose footer shows the social links.

import { revalidatePath } from "next/cache";
import { prisma } from "./db";
import { HttpError } from "./http";
import {
  defaultSiteSettings,
  parseStoredSocialLinks,
  SETTING_KEYS,
  settingsFieldErrors,
  settingsPatchSchema,
  settingsPutSchema,
  settingValueSchemas,
  type SettingKey,
  type SiteSettings,
  type SiteSettingsPatch,
} from "./site-settings-shared";

export * from "./site-settings-shared";

export const SITE_SETTINGS_TTL_MS = 10_000;
/** How long the defaults from a failed query are cached before the next read retries. */
export const SITE_SETTINGS_RETRY_MS = 1_000;

/** The settings as read, and which of them hold the default only because reading failed. */
export type SiteSettingsRead = {
  settings: SiteSettings;
  /** Keys whose stored value could not be read (every key when the query failed). */
  degraded: SettingKey[];
  /** The query itself failed (database unreachable, table missing). */
  queryFailed: boolean;
};

type CacheEntry = { expiresAt: number; promise: Promise<SiteSettingsRead> };
const globalForSettings = globalThis as unknown as { __faamSiteSettings?: CacheEntry | null };

async function loadSiteSettings(): Promise<SiteSettingsRead> {
  const settings = defaultSiteSettings();
  const degraded: SettingKey[] = [];
  let rows: { key: string; value: string }[];
  try {
    rows = await prisma.siteSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
  } catch (err) {
    // E.g. the table does not exist yet (not migrated) or no database at build time.
    const reason = String((err as Error)?.message ?? err).trim().split("\n").pop();
    console.error(`[site-settings] read failed, using the defaults: ${reason}`);
    return { settings, degraded: [...SETTING_KEYS], queryFailed: true };
  }
  for (const row of rows) {
    const key = row.key as SettingKey;
    let raw: unknown;
    try {
      raw = JSON.parse(row.value);
    } catch {
      console.error(`[site-settings] "${key}" is not valid JSON, using the default`);
      degraded.push(key);
      continue;
    }
    if (key === "socialLinks") {
      // Link by link: one bad entry must not hide every follow button.
      const read = parseStoredSocialLinks(raw);
      if (read) {
        settings.socialLinks = read.links;
        if (read.dropped.length) {
          console.error(`[site-settings] dropped invalid stored social link(s) at index ${read.dropped.join(", ")}`);
        }
        continue;
      }
    } else {
      const parsed = settingValueSchemas[key].safeParse(raw);
      if (parsed.success) {
        (settings as Record<SettingKey, unknown>)[key] = parsed.data;
        continue;
      }
    }
    console.error(`[site-settings] "${key}" is invalid, using the default`);
    degraded.push(key);
  }
  return { settings, degraded, queryFailed: false };
}

/**
 * Current settings with what fell back to the defaults (cached for ~10 s per
 * process, ~1 s after a failed query; never throws).
 */
export function readSiteSettings(now = Date.now()): Promise<SiteSettingsRead> {
  const cached = globalForSettings.__faamSiteSettings;
  if (cached && cached.expiresAt > now) return cached.promise;
  // Concurrent callers share one query.
  const entry: CacheEntry = { expiresAt: now + SITE_SETTINGS_TTL_MS, promise: loadSiteSettings() };
  globalForSettings.__faamSiteSettings = entry;
  void entry.promise.then((read) => {
    if (read.queryFailed) entry.expiresAt = Math.min(entry.expiresAt, now + SITE_SETTINGS_RETRY_MS);
  });
  return entry.promise;
}

/** Current settings (cached for ~10 s per process; defaults on any error). */
export async function getSiteSettings(now = Date.now()): Promise<SiteSettings> {
  return (await readSiteSettings(now)).settings;
}

export function clearSiteSettingsCache(): void {
  globalForSettings.__faamSiteSettings = null;
}

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
