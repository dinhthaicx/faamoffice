// Site settings shared by the server and the admin editor (no server-only
// imports): the zod schemas, the social platforms with their allowed hosts,
// and the defaults used whenever a setting is missing or unreadable.

import { z } from "zod";
import { isHttpsUrl } from "./announcement-shared";

// ---------------------------------------------------------------- social links

export const SOCIAL_PLATFORMS = [
  "facebook",
  "youtube",
  "tiktok",
  "zalo",
  "x",
  "instagram",
  "threads",
  "telegram",
  "discord",
  "github",
  "linkedin",
  "website",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Brand names (never translated). "website" is localized by the dictionaries instead. */
export const SOCIAL_PLATFORM_NAMES: Record<Exclude<SocialPlatform, "website">, string> = {
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  zalo: "Zalo",
  x: "X",
  instagram: "Instagram",
  threads: "Threads",
  telegram: "Telegram",
  discord: "Discord",
  github: "GitHub",
  linkedin: "LinkedIn",
};

/** Display name of a platform; `websiteName` is the localized word for "website". */
export function socialPlatformName(platform: SocialPlatform, websiteName: string): string {
  return platform === "website" ? websiteName : SOCIAL_PLATFORM_NAMES[platform];
}

/**
 * Registrable domains each platform's links must live on (the domain itself or
 * any subdomain, e.g. m.facebook.com, vt.tiktok.com). null = any https host.
 */
export const SOCIAL_PLATFORM_HOSTS: Record<SocialPlatform, readonly string[] | null> = {
  facebook: ["facebook.com", "fb.com", "fb.me"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
  zalo: ["zalo.me"],
  x: ["x.com", "twitter.com"],
  instagram: ["instagram.com"],
  threads: ["threads.net", "threads.com"],
  telegram: ["t.me", "telegram.me"],
  discord: ["discord.gg", "discord.com"],
  github: ["github.com"],
  linkedin: ["linkedin.com"],
  website: null,
};

export const MAX_SOCIAL_LINKS = 12;
export const SOCIAL_LABEL_MAX = 40;
export const SOCIAL_URL_MAX = 500;
export const MAX_DAILY_REQUEST_LIMIT = 1_000_000;

const SOCIAL_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** True when `url` may be used for `platform` (https, and on the platform's domains). */
export function socialUrlAllowed(platform: SocialPlatform, url: string): boolean {
  if (!isHttpsUrl(url)) return false;
  const hosts = SOCIAL_PLATFORM_HOSTS[platform];
  if (!hosts) return true;
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  return hosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The form a link is stored in: the WHATWG serialization (punycode host, percent-encoding). */
function canonicalUrl(url: string): string {
  return new URL(url).href;
}

/** Short random id for a new link (stable once saved; the app keys clicks by it). */
export function newSocialId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

/** Error codes produced by the schemas (mapped to localized messages in the editor). */
export const SETTINGS_ERROR_CODES = [
  "required",
  "https_only",
  "wrong_host",
  "too_long",
  "too_many",
  "duplicate",
  "out_of_range",
  "invalid",
] as const;
export type SettingsErrorCode = (typeof SETTINGS_ERROR_CODES)[number];
const KNOWN_CODES = new Set<string>(SETTINGS_ERROR_CODES);

const socialLinkInputSchema = z
  .object({
    // Missing ids are generated on save; present ones are kept as they are.
    id: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || SOCIAL_ID_RE.test(v), { error: "invalid" }),
    platform: z.enum(SOCIAL_PLATFORMS, { error: "invalid" }),
    url: z
      .string({ error: "required" })
      .trim()
      .min(1, { error: "required" })
      .max(SOCIAL_URL_MAX, { error: "too_long" })
      .refine(isHttpsUrl, { error: "https_only" })
      // The stored (canonical) form can be much longer than what was typed, e.g.
      // a Vietnamese path once percent-encoded: check that one too, or the saved
      // link would fail this same schema when it is read back.
      .refine((v) => !isHttpsUrl(v) || canonicalUrl(v).length <= SOCIAL_URL_MAX, { error: "too_long" }),
    label: z
      .string()
      .trim()
      .max(SOCIAL_LABEL_MAX, { error: "too_long" })
      .refine((v) => !CONTROL_RE.test(v), { error: "invalid" })
      .nullish()
      .transform((v) => v || null),
    enabled: z.boolean({ error: "invalid" }),
  })
  .superRefine((link, ctx) => {
    if (isHttpsUrl(link.url) && !socialUrlAllowed(link.platform, link.url)) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "wrong_host" });
    }
  })
  .transform((link) => ({
    id: link.id || newSocialId(),
    platform: link.platform,
    url: canonicalUrl(link.url),
    label: link.label,
    enabled: link.enabled,
  }));

export type SocialLink = { id: string; platform: SocialPlatform; url: string; label: string | null; enabled: boolean };

export const socialLinksSchema = z
  .array(socialLinkInputSchema)
  .max(MAX_SOCIAL_LINKS, { error: "too_many" })
  .superRefine((links, ctx) => {
    const seen = new Set<string>();
    links.forEach((link, i) => {
      if (seen.has(link.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "duplicate" });
      seen.add(link.id);
    });
  });

/**
 * Read a stored socialLinks value link by link: an entry that no longer passes
 * the schema (a hand-edited row, rules tightened since it was saved) is dropped
 * on its own instead of discarding the whole list, and so are repeated ids and
 * links past MAX_SOCIAL_LINKS. null when the value is not a list at all.
 */
export function parseStoredSocialLinks(raw: unknown): { links: SocialLink[]; dropped: number[] } | null {
  if (!Array.isArray(raw)) return null;
  const links: SocialLink[] = [];
  const dropped: number[] = [];
  const ids = new Set<string>();
  raw.forEach((item, i) => {
    const parsed = socialLinkInputSchema.safeParse(item);
    if (!parsed.success || ids.has(parsed.data.id) || links.length >= MAX_SOCIAL_LINKS) {
      dropped.push(i);
      return;
    }
    ids.add(parsed.data.id);
    links.push(parsed.data);
  });
  return { links, dropped };
}

// ---------------------------------------------------------------- settings

export const SETTING_KEYS = ["creditsEnabled", "aiDailyRequestLimit", "socialLinks"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export type SiteSettings = {
  /** Faam credits on: requests are charged; off: account sign-in only, optional daily limit. */
  creditsEnabled: boolean;
  /** Faam AI requests per user per day (Asia/Ho_Chi_Minh) while credits are off; 0 = unlimited. */
  aiDailyRequestLimit: number;
  /** Follow buttons (website footer, desktop app), in display order. */
  socialLinks: SocialLink[];
};

/** A fresh copy of the defaults (callers may mutate it). */
export function defaultSiteSettings(): SiteSettings {
  return { creditsEnabled: true, aiDailyRequestLimit: 300, socialLinks: [] };
}

/** Whole numbers only; numeric strings from form inputs are accepted ("" is not 0). */
const dailyLimitSchema = z.preprocess(
  (v) => (typeof v === "string" && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v),
  z
    .number({ error: "invalid" })
    .int({ error: "invalid" })
    .min(0, { error: "out_of_range" })
    .max(MAX_DAILY_REQUEST_LIMIT, { error: "out_of_range" }),
);

/**
 * One schema per key, for input. Stored rows are read back with the same
 * schemas (per-key fallback), except socialLinks: parseStoredSocialLinks.
 */
export const settingValueSchemas = {
  // Strict boolean on purpose: z.coerce.boolean("false") would be true.
  creditsEnabled: z.boolean({ error: "invalid" }),
  aiDailyRequestLimit: dailyLimitSchema,
  socialLinks: socialLinksSchema,
} satisfies Record<SettingKey, z.ZodType>;

/** PATCH body: any subset of the settings; unknown keys are rejected. */
export const settingsPatchSchema = z.strictObject({
  creditsEnabled: settingValueSchemas.creditsEnabled.optional(),
  aiDailyRequestLimit: settingValueSchemas.aiDailyRequestLimit.optional(),
  socialLinks: settingValueSchemas.socialLinks.optional(),
});

/** PUT body: every setting. */
export const settingsPutSchema = z.strictObject({
  creditsEnabled: settingValueSchemas.creditsEnabled,
  aiDailyRequestLimit: settingValueSchemas.aiDailyRequestLimit,
  socialLinks: settingValueSchemas.socialLinks,
});

export type SiteSettingsPatch = Partial<SiteSettings>;

/**
 * Field errors keyed by dotted path ("socialLinks.2.url", "aiDailyRequestLimit",
 * "socialLinks" for the list itself), first issue per path.
 */
export function settingsFieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  const out: Record<string, SettingsErrorCode> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "form";
    if (!(key in out)) out[key] = KNOWN_CODES.has(issue.message) ? (issue.message as SettingsErrorCode) : "invalid";
  }
  return out;
}

// ---------------------------------------------------------------- public shape

/** What the website footer and GET /api/v1/app/config expose (enabled links, in order). */
export type PublicSocialLink = { id: string; platform: SocialPlatform; url: string; label?: string };

export function publicSocialLinks(links: readonly SocialLink[]): PublicSocialLink[] {
  return links
    .filter((l) => l.enabled)
    .map((l) => ({ id: l.id, platform: l.platform, url: l.url, ...(l.label ? { label: l.label } : {}) }));
}
