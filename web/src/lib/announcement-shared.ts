// Announcement rules shared by the server and the admin editor (client-safe:
// no database or Node-only imports). Covers input validation, version and
// platform matching, localization, image framing and the sandboxed frame document.

import { z } from "zod";

export const ANNOUNCEMENT_STATUSES = ["draft", "published"] as const;
export const ANNOUNCEMENT_KINDS = ["rich", "html"] as const;
export const ANNOUNCEMENT_LEVELS = ["info", "warning", "critical"] as const;
export const ANNOUNCEMENT_DISPLAY_MODES = ["once", "every_launch", "until_dismissed"] as const;
export const PLATFORMS = ["mac", "win", "linux"] as const;

export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];
export type AnnouncementDisplayMode = (typeof ANNOUNCEMENT_DISPLAY_MODES)[number];
export type Platform = (typeof PLATFORMS)[number];
export type ContentLocale = "vi" | "en";

/** Field length limits (characters). */
export const ANNOUNCEMENT_LIMITS = {
  title: 200,
  body: 5_000,
  html: 100_000,
  url: 2_000,
  label: 60,
  version: 32,
  priority: 1_000,
} as const;

/** Uploaded images: at most 2 MB. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** The desktop app receives at most this many announcements. */
export const PUBLIC_ANNOUNCEMENT_LIMIT = 5;

/** Button label used when an announcement has a link but no label. */
export const DEFAULT_LINK_LABEL: Record<ContentLocale, string> = { vi: "Xem chi tiết", en: "Learn more" };

// ---------------------------------------------------------------- image fit

// How the app's announcement dialog frames its image, whatever its size or
// shape: the frame takes the image's own aspect ratio within 16:10…3:1; an
// image that (nearly) matches fills the frame, any other one is shown whole
// over a blurred copy of itself and never upscaled.
// Keep in sync with apps/shell/src/renderer/src/announcement-media.ts (the
// dialog itself); the editor's preview uses this copy to frame it the same way.

/** The tallest frame (16:10): a square or portrait image is shown whole. */
const MIN_FRAME_RATIO = 1.6;
/** The widest frame (3:1, a common banner shape): a wider panorama is shown whole. */
const MAX_FRAME_RATIO = 3;
/** An image whose ratio differs from the frame's by at most this factor fills it (losing at most ~11% of one side). */
const COVER_TOLERANCE = 1.12;
/** CSS px; a narrower image would visibly upscale when filling the frame. */
const SMALL_IMAGE_WIDTH = 280;
/** The frame before the image is measured, and for an unmeasurable one. */
export const DEFAULT_FRAME_RATIO = 16 / 9;

export type MediaFit = {
  /** Width / height of the frame. */
  frameRatio: number;
  /** "cover": the image fills the frame; "contain": shown whole over a blurred backdrop. */
  mode: "cover" | "contain";
};

export function computeMediaFit(width: number, height: number): MediaFit {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { frameRatio: DEFAULT_FRAME_RATIO, mode: "contain" };
  }
  const ratio = width / height;
  const frameRatio = Math.min(MAX_FRAME_RATIO, Math.max(MIN_FRAME_RATIO, ratio));
  const mismatch = Math.max(ratio / frameRatio, frameRatio / ratio);
  return { frameRatio, mode: mismatch <= COVER_TOLERANCE && width >= SMALL_IMAGE_WIDTH ? "cover" : "contain" };
}

// ---------------------------------------------------------------- versions

export type Version = readonly [number, number, number];

const STORED_VERSION_RE = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;
// The suffix separator may also be whitespace: an unencoded "+" in a query string
// ("?version=1.0.0+build.7") reaches the server as a space.
const VERSION_RE = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:[-+\s].*)?$/;

/** Admin-entered bounds must be plain "x.y.z". */
export function isStoredVersion(value: string): boolean {
  return STORED_VERSION_RE.test(value);
}

/**
 * Parse an app version "x.y.z" (optional leading "v"; pre-release and build
 * suffixes such as "-beta.2", "+abc" or " abc" — a "+" decoded from a query
 * string — are ignored). Null when missing or invalid.
 */
export function parseVersion(raw: string | null | undefined): Version | null {
  if (!raw) return null;
  const m = VERSION_RE.exec(raw.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Inclusive range check; a null version (unknown app version) matches everything. */
export function versionInRange(version: Version | null, min: string | null, max: string | null): boolean {
  if (!version) return true;
  const lo = parseVersion(min);
  if (lo && compareVersions(version, lo) < 0) return false;
  const hi = parseVersion(max);
  if (hi && compareVersions(version, hi) > 0) return false;
  return true;
}

// ---------------------------------------------------------------- platforms

const PLATFORM_ALIASES: Record<string, Platform> = {
  mac: "mac",
  macos: "mac",
  darwin: "mac",
  win: "win",
  windows: "win",
  win32: "win",
  linux: "linux",
};

/** "mac" | "win" | "linux" (also accepts Node's "darwin" / "win32"); null when unknown. */
export function parsePlatform(raw: string | null | undefined): Platform | null {
  if (!raw) return null;
  return PLATFORM_ALIASES[raw.trim().toLowerCase()] ?? null;
}

/** Platforms stored as a comma-separated string ("" = every platform). */
export function parseStoredPlatforms(value: string | null | undefined): Platform[] {
  const set = new Set((value ?? "").split(",").map((p) => p.trim()));
  return PLATFORMS.filter((p) => set.has(p));
}

export function serializePlatforms(list: readonly Platform[]): string {
  return PLATFORMS.filter((p) => list.includes(p)).join(",");
}

/** A null platform (not sent by the client) matches everything. */
export function platformMatches(stored: string | null | undefined, platform: Platform | null): boolean {
  if (!platform) return true;
  const list = parseStoredPlatforms(stored);
  return list.length === 0 || list.includes(platform);
}

// ---------------------------------------------------------------- localization

/** "vi", "vi-VN", "vi_VN" (and a missing value) → Vietnamese; any other locale → English. */
export function contentLocale(raw: string | null | undefined): ContentLocale {
  if (!raw) return "vi";
  return raw.trim().toLowerCase().split(/[-_.@]/)[0] === "vi" ? "vi" : "en";
}

export type LocalizableAnnouncement = {
  titleVi: string;
  titleEn: string | null;
  bodyVi: string | null;
  bodyEn: string | null;
  htmlVi: string | null;
  htmlEn: string | null;
  linkLabelVi: string | null;
  linkLabelEn: string | null;
};

/** Vietnamese fields for "vi"; English fields falling back to Vietnamese otherwise. */
export function localizeAnnouncement(a: LocalizableAnnouncement, locale: ContentLocale) {
  const pick = (vi: string | null, en: string | null) => (locale === "en" ? en || vi : vi) || null;
  return {
    title: pick(a.titleVi, a.titleEn) ?? "",
    body: pick(a.bodyVi, a.bodyEn),
    html: pick(a.htmlVi, a.htmlEn),
    linkLabel: pick(a.linkLabelVi, a.linkLabelEn) ?? DEFAULT_LINK_LABEL[locale],
  };
}

// ---------------------------------------------------------------- URLs

/** Absolute https URL without embedded credentials. */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- admin input

/** Error codes produced by the schema (mapped to localized messages in the editor). */
export const FIELD_ERROR_CODES = [
  "required",
  "too_long",
  "https_only",
  "version_format",
  "version_range",
  "invalid_date",
  "ends_before_start",
  "image_conflict",
  "image_missing",
  "out_of_range",
  "invalid",
] as const;
export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

function normalizeText(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : value;
}

const text = (max: number) => z.preprocess(normalizeText, z.string({ error: "invalid" }).max(max, { error: "too_long" }));
const optionalText = (max: number) => text(max).transform((v) => (v === "" ? null : v));
/** Text whose rules depend on other fields (checked in a refinement instead). */
const optionalLooseText = () => z.preprocess(normalizeText, z.string({ error: "invalid" })).transform((v) => (v === "" ? null : v));
const optionalHttpsUrl = () =>
  optionalText(ANNOUNCEMENT_LIMITS.url).refine((v) => v === null || isHttpsUrl(v), { error: "https_only" });
const optionalVersion = () =>
  optionalText(ANNOUNCEMENT_LIMITS.version).refine((v) => v === null || isStoredVersion(v), { error: "version_format" });
const optionalDate = () =>
  optionalText(64)
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), { error: "invalid_date" })
    .transform((v) => (v === null ? null : new Date(v)));

const IMAGE_ID_MAX = 64;
const IMAGE_ID_RE = /^[A-Za-z0-9_-]+$/;
const IMAGE_KEYS = new Set(["kind", "imageId", "imageUrl"]);

/**
 * Admin create/update payload. Empty strings become null; content that does not
 * belong to the chosen kind is dropped (rich → no HTML, html → no body/image).
 */
export const announcementInputSchema = z
  .object({
    status: z.enum(ANNOUNCEMENT_STATUSES, { error: "invalid" }).default("draft"),
    kind: z.enum(ANNOUNCEMENT_KINDS, { error: "invalid" }).default("rich"),
    level: z.enum(ANNOUNCEMENT_LEVELS, { error: "invalid" }).default("info"),
    displayMode: z.enum(ANNOUNCEMENT_DISPLAY_MODES, { error: "invalid" }).default("once"),
    titleVi: text(ANNOUNCEMENT_LIMITS.title).refine((v) => v.length > 0, { error: "required" }),
    titleEn: optionalText(ANNOUNCEMENT_LIMITS.title),
    bodyVi: optionalText(ANNOUNCEMENT_LIMITS.body),
    bodyEn: optionalText(ANNOUNCEMENT_LIMITS.body),
    htmlVi: optionalText(ANNOUNCEMENT_LIMITS.html),
    htmlEn: optionalText(ANNOUNCEMENT_LIMITS.html),
    // Checked only for rich announcements (see below): html drops them, so a value
    // left over from before switching kinds must never block saving.
    imageId: optionalLooseText(),
    imageUrl: optionalLooseText(),
    linkUrl: optionalHttpsUrl(),
    linkLabelVi: optionalText(ANNOUNCEMENT_LIMITS.label),
    linkLabelEn: optionalText(ANNOUNCEMENT_LIMITS.label),
    platforms: z
      .array(z.enum(PLATFORMS, { error: "invalid" }), { error: "invalid" })
      .max(PLATFORMS.length * 2, { error: "invalid" })
      .default([])
      .transform((list) => PLATFORMS.filter((p) => list.includes(p))),
    minVersion: optionalVersion(),
    maxVersion: optionalVersion(),
    startsAt: optionalDate(),
    endsAt: optionalDate(),
    priority: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? 0 : v),
      z.coerce
        .number({ error: "invalid" })
        .int({ error: "invalid" })
        .min(-ANNOUNCEMENT_LIMITS.priority, { error: "out_of_range" })
        .max(ANNOUNCEMENT_LIMITS.priority, { error: "out_of_range" }),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "html" && !v.htmlVi) ctx.addIssue({ code: "custom", path: ["htmlVi"], message: "required" });
    const lo = parseVersion(v.minVersion);
    const hi = parseVersion(v.maxVersion);
    if (lo && hi && compareVersions(lo, hi) > 0) {
      ctx.addIssue({ code: "custom", path: ["maxVersion"], message: "version_range" });
    }
    if (v.endsAt && v.endsAt.getTime() <= (v.startsAt ?? new Date()).getTime()) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "ends_before_start" });
    }
  })
  .superRefine(
    (v, ctx) => {
      if (v.kind !== "rich") return;
      const issue = (path: "imageId" | "imageUrl", message: FieldErrorCode) => ctx.addIssue({ code: "custom", path: [path], message });
      if (v.imageId && (v.imageId.length > IMAGE_ID_MAX || !IMAGE_ID_RE.test(v.imageId))) issue("imageId", "invalid");
      if (v.imageUrl && v.imageUrl.length > ANNOUNCEMENT_LIMITS.url) issue("imageUrl", "too_long");
      else if (v.imageUrl && !isHttpsUrl(v.imageUrl)) issue("imageUrl", "https_only");
      else if (v.imageId && v.imageUrl) issue("imageUrl", "image_conflict");
    },
    // Runs even when unrelated fields are invalid (an invalid enum elsewhere would
    // otherwise skip it), so every image error is reported in the same round; but
    // never on a non-object payload (root issue) or with an invalid image field.
    { when: (payload) => !payload.issues.some((i) => !i.path?.length || IMAGE_KEYS.has(String(i.path[0]))) },
  )
  .transform((v) => ({
    ...v,
    ...(v.kind === "html"
      ? { bodyVi: null, bodyEn: null, imageId: null, imageUrl: null }
      : { htmlVi: null, htmlEn: null }),
    ...(v.linkUrl ? {} : { linkLabelVi: null, linkLabelEn: null }),
  }));

export type AnnouncementInput = z.output<typeof announcementInputSchema>;

// ---------------------------------------------------------------- editor values

/** The admin editor's state: every field as a form control holds it ("" = empty). */
export type AnnouncementFormValues = {
  status: AnnouncementStatus;
  kind: AnnouncementKind;
  level: AnnouncementLevel;
  displayMode: AnnouncementDisplayMode;
  titleVi: string;
  titleEn: string;
  bodyVi: string;
  bodyEn: string;
  htmlVi: string;
  htmlEn: string;
  imageId: string | null;
  imageUrl: string;
  linkUrl: string;
  linkLabelVi: string;
  linkLabelEn: string;
  platforms: Platform[];
  minVersion: string;
  maxVersion: string;
  /** ISO 8601 or "" (start now). */
  startsAt: string;
  /** ISO 8601 or "" (no end). */
  endsAt: string;
  priority: string;
};

/** Stored fields the editor needs (a Prisma `Announcement` row fits). */
export type StoredAnnouncementFields = LocalizableAnnouncement & {
  status: AnnouncementStatus;
  kind: AnnouncementKind;
  level: AnnouncementLevel;
  displayMode: AnnouncementDisplayMode;
  imageId: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  platforms: string;
  minVersion: string | null;
  maxVersion: string | null;
  startsAt: Date;
  endsAt: Date | null;
  priority: number;
};

/** Editor state for a stored announcement (the edit page, and the update API's reply). */
export function toAnnouncementFormValues(a: StoredAnnouncementFields): AnnouncementFormValues {
  return {
    status: a.status,
    kind: a.kind,
    level: a.level,
    displayMode: a.displayMode,
    titleVi: a.titleVi,
    titleEn: a.titleEn ?? "",
    bodyVi: a.bodyVi ?? "",
    bodyEn: a.bodyEn ?? "",
    htmlVi: a.htmlVi ?? "",
    htmlEn: a.htmlEn ?? "",
    imageId: a.imageId,
    imageUrl: a.imageUrl ?? "",
    linkUrl: a.linkUrl ?? "",
    linkLabelVi: a.linkLabelVi ?? "",
    linkLabelEn: a.linkLabelEn ?? "",
    platforms: parseStoredPlatforms(a.platforms),
    minVersion: a.minVersion ?? "",
    maxVersion: a.maxVersion ?? "",
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt?.toISOString() ?? "",
    priority: String(a.priority),
  };
}

const KNOWN_CODES = new Set<string>(FIELD_ERROR_CODES);

/** First error code per top-level field, e.g. { titleVi: "required", linkUrl: "https_only" }. */
export function fieldErrorsFromIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  const out: Record<string, FieldErrorCode> = {};
  for (const issue of issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (!(key in out)) out[key] = KNOWN_CODES.has(issue.message) ? (issue.message as FieldErrorCode) : "invalid";
  }
  return out;
}

// ---------------------------------------------------------------- sandboxed frame

/** Sandbox flags of the frame (CSP `sandbox` directive and the editor's iframe attribute). */
export const FRAME_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

/**
 * Policy of /announcement-frame/{id}: an opaque origin (sandbox without
 * allow-scripts / allow-same-origin), no script-src at all, https media only.
 * No frame-ancestors: the packaged app's window is a file:// page (http://localhost
 * in dev), which "*" never matches, and a page without scripts or state has
 * nothing to clickjack.
 */
export const FRAME_CSP = [
  `sandbox ${FRAME_SANDBOX}`,
  "default-src 'none'",
  "img-src https: data:",
  "style-src 'unsafe-inline' https:",
  "font-src https: data:",
  "media-src https:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Response headers of the frame route (and of next.config.ts for that path). No X-Frame-Options: apps embed it. */
export const FRAME_RESPONSE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": FRAME_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

/** The same policy as a <meta> tag can carry it (no sandbox), for the editor's srcdoc preview. */
export const FRAME_META_CSP = FRAME_CSP.split("; ")
  .filter((d) => !d.startsWith("sandbox"))
  .join("; ");

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const FRAME_STYLES = `
:root{color-scheme:light dark}
html{-webkit-text-size-adjust:100%}
body{margin:0;padding:16px 20px;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#1f2328;background:#ffffff;overflow-wrap:anywhere}
img,video,svg{max-width:100%;height:auto}
a{color:#0b63ce}
h1,h2,h3,h4{line-height:1.3;margin:1.1em 0 .5em}
h1:first-child,h2:first-child,h3:first-child,p:first-child{margin-top:0}
p,ul,ol{margin:0 0 .9em}
table{border-collapse:collapse;margin:0 0 1em}
th,td{border:1px solid #d0d7de;padding:4px 8px;text-align:left}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
pre{overflow:auto;padding:12px;border-radius:6px;background:#f6f8fa}
blockquote{margin:0 0 1em;padding-left:12px;border-left:3px solid #d0d7de;color:#57606a}
hr{border:0;border-top:1px solid #d0d7de;margin:1.2em 0}
@media (prefers-color-scheme:dark){
body{color:#e6edf3;background:#0d1117}
a{color:#58a6ff}
th,td{border-color:#30363d}
pre{background:#161b22}
blockquote{border-color:#30363d;color:#9da7b3}
hr{border-top-color:#30363d}
}`.trim();

/**
 * Complete HTML document around admin-authored HTML. Links open outside the
 * frame (<base target="_blank">). `metaCsp` adds a <meta> policy (srcdoc preview).
 */
export function buildFrameDocument(input: { html: string; title: string; lang: ContentLocale; metaCsp?: string }): string {
  return [
    "<!doctype html>",
    `<html lang="${input.lang}">`,
    "<head>",
    '<meta charset="utf-8">',
    input.metaCsp ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(input.metaCsp)}">` : "",
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="referrer" content="no-referrer">',
    '<base target="_blank">',
    `<title>${escapeHtml(input.title)}</title>`,
    `<style>${FRAME_STYLES}</style>`,
    "</head>",
    "<body>",
    input.html,
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("\n");
}
