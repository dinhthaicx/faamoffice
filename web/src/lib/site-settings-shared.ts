// Site settings shared by the server and the admin editor (no server-only
// imports): the zod schemas, the social platforms with their allowed hosts,
// and the defaults used whenever a setting is missing or unreadable.

import { z } from "zod";
import { isHttpsUrl } from "./announcement-shared";
import { aiBackendSchema, type AiBackendSettings } from "./ai-backend-shared";

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
  "publisher_id",
  "slot_id",
  "ads_txt_line",
  "ads_txt_lines",
  "store_id",
  "lan_url",
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

// ---------------------------------------------------------------- Google AdSense

/** AdSense publisher id as typed: "ca-pub-" or "pub-" and 16 digits (stored as "ca-pub-…"). */
export const PUBLISHER_ID_RE = /^(?:ca-)?pub-(\d{16})$/i;
/** Ad unit id (data-ad-slot): digits only. */
export const AD_SLOT_RE = /^\d{6,20}$/;
export const ADS_TXT_MAX_LINES = 50;
export const ADS_TXT_LINE_MAX = 300;
/** Whole textarea, blank lines included (generous: 50 lines of up to 300 characters). */
export const ADS_TXT_TEXT_MAX = 20_000;
/** Where an ad unit can be placed (admin "slots"): the home page above the footer, inside the Faam AI page. */
export const AD_SLOT_KEYS = ["homeBottom", "contentInline"] as const;
export type AdSlotKey = (typeof AD_SLOT_KEYS)[number];

export type AdsSettings = {
  /** Load the AdSense script on the ad pages (home, Faam AI). Requires publisherId. */
  enabled: boolean;
  /** "ca-pub-" + 16 digits; drives the verification meta tag and /ads.txt even while ads are off. */
  publisherId: string | null;
  /** Load the script on both ad pages so Auto ads (configured in AdSense) can place ads; off: only where a unit is set. */
  autoAds: boolean;
  /** Manual responsive units (data-ad-slot), each optional. */
  slots: Partial<Record<AdSlotKey, string>>;
  /** Extra ads.txt records, one per line, normalized ("domain, account, DIRECT|RESELLER[, certId]"). */
  adsTxtExtra: string;
};

const ADS_TXT_DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/i;
const ADS_TXT_ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,99}$/;
const ADS_TXT_CERT_RE = /^[A-Za-z0-9]{1,64}$/;

/**
 * One ads.txt data record in its canonical form ("example.com, 123, DIRECT, abc"),
 * or null when the line is not a valid record (comments and variables are not accepted).
 */
export function normalizeAdsTxtLine(line: string): string | null {
  const text = line.trim();
  if (!text || text.length > ADS_TXT_LINE_MAX) return null;
  const fields = text.split(",").map((f) => f.trim());
  if (fields.length < 3 || fields.length > 4) return null;
  const [domain, account, relationship, certId] = fields;
  if (!ADS_TXT_DOMAIN_RE.test(domain) || !ADS_TXT_ACCOUNT_RE.test(account)) return null;
  const rel = relationship.toUpperCase();
  if (rel !== "DIRECT" && rel !== "RESELLER") return null;
  if (certId !== undefined && !ADS_TXT_CERT_RE.test(certId)) return null;
  return [domain.toLowerCase(), account, rel, ...(certId !== undefined ? [certId] : [])].join(", ");
}

const publisherIdSchema = z
  .string({ error: "invalid" })
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const match = PUBLISHER_ID_RE.exec(value);
    if (!match) {
      ctx.addIssue({ code: "custom", message: "publisher_id" });
      return z.NEVER;
    }
    return `ca-pub-${match[1]}`;
  });

const adSlotSchema = z
  .string({ error: "invalid" })
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return undefined;
    if (!AD_SLOT_RE.test(value)) {
      ctx.addIssue({ code: "custom", message: "slot_id" });
      return z.NEVER;
    }
    return value;
  });

const adSlotsSchema = z
  .object({ homeBottom: adSlotSchema, contentInline: adSlotSchema }, { error: "invalid" })
  .transform((slots) => {
    const out: Partial<Record<AdSlotKey, string>> = {};
    for (const key of AD_SLOT_KEYS) if (slots[key]) out[key] = slots[key];
    return out;
  });

/** Issues are keyed by the 0-based line number in the text as typed ("adsTxtExtra.3"). */
const adsTxtExtraSchema = z
  .string({ error: "invalid" })
  .max(ADS_TXT_TEXT_MAX, { error: "too_long" })
  .transform((text, ctx) => {
    const lines = text.split(/\r\n|\r|\n/);
    const out: string[] = [];
    let records = 0;
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      records += 1;
      const normalized = normalizeAdsTxtLine(line);
      if (normalized) out.push(normalized);
      else ctx.addIssue({ code: "custom", path: [i], message: "ads_txt_line" });
    });
    if (records > ADS_TXT_MAX_LINES) ctx.addIssue({ code: "custom", message: "ads_txt_lines" });
    return out.join("\n");
  });

export const adsSettingsSchema = z
  .object(
    {
      enabled: z.boolean({ error: "invalid" }),
      publisherId: publisherIdSchema,
      autoAds: z.boolean({ error: "invalid" }),
      slots: adSlotsSchema.optional().transform((v) => v ?? {}),
      adsTxtExtra: adsTxtExtraSchema.optional().transform((v) => v ?? ""),
    },
    { error: "invalid" },
  )
  .superRefine((ads, ctx) => {
    if (ads.enabled && !ads.publisherId) ctx.addIssue({ code: "custom", path: ["publisherId"], message: "required" });
  });

// ---------------------------------------------------------------- Microsoft Store

/** Microsoft Store product id (Store ID), e.g. 9P0RJ9J87ZNQ. */
export const MS_STORE_ID_RE = /^[0-9A-Z]{12}$/;
export const MS_STORE_DEFAULT_PRODUCT_ID = "9P0RJ9J87ZNQ";

export type MsStoreSettings = {
  /** Show the "Get it from Microsoft" badge on the download page (off until the listing is live). */
  enabled: boolean;
  productId: string;
};

export const msStoreSettingsSchema = z.object(
  {
    enabled: z.boolean({ error: "invalid" }),
    productId: z
      .string({ error: "required" })
      .trim()
      .toUpperCase()
      .min(1, { error: "required" })
      .regex(MS_STORE_ID_RE, { error: "store_id" }),
  },
  { error: "invalid" },
);

// ---------------------------------------------------------------- settings

export const SETTING_KEYS = ["creditsEnabled", "aiDailyRequestLimit", "socialLinks", "ads", "msStore", "aiBackend"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export type SiteSettings = {
  /** Faam credits on: requests are charged; off: account sign-in only, optional daily limit. */
  creditsEnabled: boolean;
  /** Faam AI requests per user per day (Asia/Ho_Chi_Minh) while credits are off; 0 = unlimited. */
  aiDailyRequestLimit: number;
  /** Follow buttons (website footer, desktop app), in display order. */
  socialLinks: SocialLink[];
  /** Google AdSense on the website's home and Faam AI pages (never in the desktop app). */
  ads: AdsSettings;
  /** Microsoft Store badge on the download page. */
  msStore: MsStoreSettings;
  /** null uses the environment; a LAN override applies to the next AI request. */
  aiBackend: AiBackendSettings | null;
};

/** A fresh copy of the defaults (callers may mutate it). */
export function defaultSiteSettings(): SiteSettings {
  return {
    creditsEnabled: true,
    aiDailyRequestLimit: 300,
    socialLinks: [],
    ads: { enabled: false, publisherId: null, autoAds: true, slots: {}, adsTxtExtra: "" },
    msStore: { enabled: false, productId: MS_STORE_DEFAULT_PRODUCT_ID },
    aiBackend: null,
  };
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
  ads: adsSettingsSchema,
  msStore: msStoreSettingsSchema,
  aiBackend: aiBackendSchema.nullable(),
} satisfies Record<SettingKey, z.ZodType>;

/** PATCH body: any subset of the settings; unknown keys are rejected. */
export const settingsPatchSchema = z.strictObject({
  creditsEnabled: settingValueSchemas.creditsEnabled.optional(),
  aiDailyRequestLimit: settingValueSchemas.aiDailyRequestLimit.optional(),
  socialLinks: settingValueSchemas.socialLinks.optional(),
  ads: settingValueSchemas.ads.optional(),
  msStore: settingValueSchemas.msStore.optional(),
  aiBackend: settingValueSchemas.aiBackend.optional(),
});

/** PUT body: every setting. */
export const settingsPutSchema = z.strictObject({
  creditsEnabled: settingValueSchemas.creditsEnabled,
  aiDailyRequestLimit: settingValueSchemas.aiDailyRequestLimit,
  socialLinks: settingValueSchemas.socialLinks,
  ads: settingValueSchemas.ads,
  msStore: settingValueSchemas.msStore,
  aiBackend: settingValueSchemas.aiBackend,
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
