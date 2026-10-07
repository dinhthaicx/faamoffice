// Reading the site settings (SiteSetting table, one JSON row per key), with a
// short per-process cache. Kept apart from the write path in site-settings.ts
// (no next/cache import) so the proxy can read the ads setting too: it decides
// the Content-Security-Policy of the ad pages (src/proxy.ts).
//
// Reads are cached per process for SITE_SETTINGS_TTL_MS and never fail: a
// missing table (not migrated yet, e.g. during `next build`), a database error
// or an invalid stored value falls back to the defaults, key by key (social
// links link by link). readSiteSettings() also says which keys fell back that
// way, for callers that must not present the defaults as the real values.

import { prisma } from "./db";
import {
  defaultSiteSettings,
  parseStoredSocialLinks,
  SETTING_KEYS,
  settingValueSchemas,
  type SettingKey,
  type SiteSettings,
} from "./site-settings-shared";

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
