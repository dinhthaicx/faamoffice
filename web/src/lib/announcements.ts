// Announcements: public queries for the desktop app and admin mutations.

import { prisma } from "./db";
import { getSiteUrl } from "./env";
import { clientIp, HttpError, rateLimited, route } from "./http";
import { limiters } from "./rate-limit";
import {
  announcementInputSchema,
  contentLocale,
  fieldErrorsFromIssues,
  localizeAnnouncement,
  parsePlatform,
  parseVersion,
  platformMatches,
  PUBLIC_ANNOUNCEMENT_LIMIT,
  serializePlatforms,
  versionInRange,
  type AnnouncementInput,
  type AnnouncementStatus,
  type ContentLocale,
  type Platform,
  type Version,
} from "./announcement-shared";
import type { Announcement, Prisma } from "@/generated/prisma/client";

/** Shared caches may keep the public list / items / frame for a minute. */
export const PUBLIC_CACHE_CONTROL = "public, max-age=60";

/**
 * CORS headers of every public announcement response, errors included: no cookies
 * are involved, so any origin (e.g. the app's renderer) may read bodies and Retry-After.
 */
export const PUBLIC_CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Retry-After" };

/** Headers of successful public JSON responses. */
export const PUBLIC_JSON_HEADERS = { "Cache-Control": PUBLIC_CACHE_CONTROL, ...PUBLIC_CORS_HEADERS };

/** `route()` for the public endpoints: 400/404/429/500 replies carry the CORS headers too. */
export function publicRoute<Args extends unknown[]>(handler: (req: Request, ...args: Args) => Promise<Response>) {
  const wrapped = route(handler);
  return async (req: Request, ...args: Args): Promise<Response> => {
    const res = await wrapped(req, ...args);
    for (const [key, value] of Object.entries(PUBLIC_CORS_HEADERS)) res.headers.set(key, value);
    return res;
  };
}

/** Admin JSON payload limit: two HTML bodies of up to 100,000 characters each fit comfortably. */
export const ANNOUNCEMENT_JSON_LIMIT = 2 * 1024 * 1024;

/** Uploads never attached to an announcement are removed on the next upload after this long. */
const ORPHAN_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;

export type PublicAnnouncement = {
  id: string;
  kind: Announcement["kind"];
  level: Announcement["level"];
  displayMode: Announcement["displayMode"];
  title: string;
  body?: string;
  imageUrl?: string;
  htmlUrl?: string;
  link?: { url: string; label: string };
  startsAt: string;
  endsAt?: string;
  updatedAt: string;
};

export type PublicQuery = { platform: Platform | null; version: Version | null; locale: ContentLocale };

/** Per-IP limit shared by the public announcement endpoints (429 rate_limited). */
export function checkPublicRateLimit(req: Request): void {
  const limit = limiters().announcements.check(`ann|${clientIp(req)}`);
  if (!limit.ok) throw rateLimited(limit.retryAfter);
}

const LOCALE_PARAM_RE = /^[A-Za-z0-9_.@-]{1,35}$/;

/**
 * Query of GET /api/v1/announcements. An unknown platform or a malformed locale
 * is a 400; a missing or invalid version disables version filtering.
 */
export function parsePublicQuery(params: URLSearchParams): PublicQuery {
  const platformRaw = params.get("platform");
  let platform: Platform | null = null;
  if (platformRaw) {
    platform = parsePlatform(platformRaw);
    if (!platform) {
      throw new HttpError(400, "invalid_request", "platform must be one of: mac, win, linux.", { field: "platform" });
    }
  }
  const localeRaw = params.get("locale");
  if (localeRaw && !LOCALE_PARAM_RE.test(localeRaw)) {
    throw new HttpError(400, "invalid_request", "locale is not a valid language tag.", { field: "locale" });
  }
  return { platform, version: parseVersion(params.get("version")), locale: contentLocale(localeRaw) };
}

/** Published and inside its display window at `now`. */
export function activeWhere(now: Date): Prisma.AnnouncementWhereInput {
  return { status: "published", startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] };
}

/** Published and started: single items, images and frames stay reachable after endsAt. */
function visibleWhere(id: string, now: Date): Prisma.AnnouncementWhereInput {
  return { id, status: "published", startsAt: { lte: now } };
}

const isPlausibleId = (id: string) => id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_-]+$/.test(id);

export function toPublicAnnouncement(a: Announcement, locale: ContentLocale, siteUrl = getSiteUrl()): PublicAnnouncement {
  const t = localizeAnnouncement(a, locale);
  const rich = a.kind === "rich";
  // `v` changes when the upload is replaced, so the day-long image cache never serves a stale picture.
  const imageUrl = !rich
    ? null
    : a.imageId
      ? `${siteUrl}/api/v1/announcements/${a.id}/image?v=${a.imageId}`
      : a.imageUrl;
  return {
    id: a.id,
    kind: a.kind,
    level: a.level,
    displayMode: a.displayMode,
    title: t.title,
    ...(rich && t.body ? { body: t.body } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(rich ? {} : { htmlUrl: `${siteUrl}/announcement-frame/${a.id}?locale=${locale}` }),
    ...(a.linkUrl ? { link: { url: a.linkUrl, label: t.linkLabel } } : {}),
    startsAt: a.startsAt.toISOString(),
    ...(a.endsAt ? { endsAt: a.endsAt.toISOString() } : {}),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** Active announcements for one app: priority desc, then newest start; at most 5. */
export async function listActiveAnnouncements(query: PublicQuery, now = new Date()): Promise<PublicAnnouncement[]> {
  const rows = await prisma.announcement.findMany({
    where: activeWhere(now),
    orderBy: [{ priority: "desc" }, { startsAt: "desc" }, { id: "asc" }],
    // Platform and version are matched in memory; active announcements are few.
    take: 500,
  });
  return rows
    .filter((a) => platformMatches(a.platforms, query.platform) && versionInRange(query.version, a.minVersion, a.maxVersion))
    .slice(0, PUBLIC_ANNOUNCEMENT_LIMIT)
    .map((a) => toPublicAnnouncement(a, query.locale));
}

/** A published, started announcement (drafts and unknown ids → null). */
export async function findVisibleAnnouncement(id: string, now = new Date()): Promise<Announcement | null> {
  if (!isPlausibleId(id)) return null;
  return prisma.announcement.findFirst({ where: visibleWhere(id, now) });
}

/** Uploaded image of a published, started announcement. */
export async function findVisibleAnnouncementImage(id: string, now = new Date()) {
  if (!isPlausibleId(id)) return null;
  const row = await prisma.announcement.findFirst({
    where: { ...visibleWhere(id, now), kind: "rich" },
    select: { image: { select: { mime: true, bytes: true, size: true } } },
  });
  return row?.image ?? null;
}

// ---------------------------------------------------------------- admin

/** Validate an admin payload; 400 invalid_request with per-field codes on failure. */
export function parseAnnouncementInput(data: unknown): AnnouncementInput {
  const result = announcementInputSchema.safeParse(data);
  if (result.success) return result.data;
  const fields = fieldErrorsFromIssues(result.error.issues);
  const [field, code] = Object.entries(fields)[0] ?? ["form", "invalid"];
  throw new HttpError(400, "invalid_request", `${field}: ${code}`, { field, fields });
}

function toData(input: AnnouncementInput) {
  return {
    status: input.status,
    kind: input.kind,
    level: input.level,
    displayMode: input.displayMode,
    titleVi: input.titleVi,
    titleEn: input.titleEn,
    bodyVi: input.bodyVi,
    bodyEn: input.bodyEn,
    htmlVi: input.htmlVi,
    htmlEn: input.htmlEn,
    imageId: input.imageId,
    imageUrl: input.imageUrl,
    linkUrl: input.linkUrl,
    linkLabelVi: input.linkLabelVi,
    linkLabelEn: input.linkLabelEn,
    platforms: serializePlatforms(input.platforms),
    minVersion: input.minVersion,
    maxVersion: input.maxVersion,
    startsAt: input.startsAt ?? new Date(),
    endsAt: input.endsAt,
    priority: input.priority,
  };
}

/** Upload details the editor shows next to the thumbnail. */
export const ADMIN_IMAGE_SELECT = { id: true, mime: true, width: true, height: true, size: true } as const;

async function assertImageExists(imageId: string | null) {
  if (!imageId) return;
  const image = await prisma.announcementImage.findUnique({ where: { id: imageId }, select: { id: true } });
  if (!image) {
    throw new HttpError(400, "invalid_request", "imageId: image_missing", {
      field: "imageId",
      fields: { imageId: "image_missing" },
    });
  }
}

/** Delete an uploaded image once no announcement uses it. */
export async function deleteImageIfOrphan(imageId: string | null | undefined) {
  if (!imageId) return;
  await prisma.announcementImage.deleteMany({ where: { id: imageId, announcements: { none: {} } } });
}

/** Remove uploads that were never attached to an announcement (abandoned edits). */
export async function cleanupOrphanImages(now = new Date()) {
  await prisma.announcementImage.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - ORPHAN_IMAGE_TTL_MS) }, announcements: { none: {} } },
  });
}

export async function createAnnouncement(input: AnnouncementInput, actorId: string) {
  await assertImageExists(input.imageId);
  return prisma.announcement.create({ data: { ...toData(input), createdById: actorId, updatedById: actorId } });
}

export async function updateAnnouncement(id: string, input: AnnouncementInput, actorId: string) {
  const existing = await prisma.announcement.findUnique({ where: { id }, select: { imageId: true } });
  if (!existing) throw new HttpError(404, "not_found", "Announcement not found.");
  await assertImageExists(input.imageId);
  const updated = await prisma.announcement.update({
    where: { id },
    data: { ...toData(input), updatedById: actorId },
    include: { image: { select: ADMIN_IMAGE_SELECT } },
  });
  if (existing.imageId !== updated.imageId) await deleteImageIfOrphan(existing.imageId);
  return updated;
}

export async function setAnnouncementStatus(id: string, status: AnnouncementStatus, actorId: string) {
  const existing = await prisma.announcement.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, "not_found", "Announcement not found.");
  return prisma.announcement.update({ where: { id }, data: { status, updatedById: actorId } });
}

export async function deleteAnnouncement(id: string) {
  const existing = await prisma.announcement.findUnique({ where: { id }, select: { imageId: true } });
  if (!existing) throw new HttpError(404, "not_found", "Announcement not found.");
  await prisma.announcement.delete({ where: { id } });
  await deleteImageIfOrphan(existing.imageId);
}
