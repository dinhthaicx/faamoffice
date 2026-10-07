// Announcements against a throwaway SQLite database (migrations applied
// directly), exercising the real route handlers: public list/item/image/frame
// endpoints and the admin mutations (session mocked; Origin checks are real).

import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

type Session = { userId: string; user: { id: string; role: "USER" | "ADMIN"; disabledAt: Date | null } };
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/lib/session", () => ({ getSession: async () => auth.session }));

type Db = typeof import("@/lib/db");
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const SITE = "https://faam.test";
const PNG_1X1 = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);

let dir = "";
let prisma: Db["prisma"];
let routes: {
  list: Handler;
  item: Handler;
  image: Handler;
  frame: Handler;
  create: Handler;
  update: Handler;
  status: Handler;
  remove: Handler;
  upload: Handler;
  adminImage: Handler;
};
let adminId = "";
let userId = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "faam-web-ann-"));
  const file = join(dir, "test.db");
  const db = new Database(file);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((n) => !n.endsWith(".toml")).sort()) {
    db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  process.env.DATABASE_URL = `file:${file}`;
  process.env.SITE_URL = SITE;
  delete (globalThis as { __faamPrisma?: unknown }).__faamPrisma;
  ({ prisma } = await import("@/lib/db"));
  const h = (m: { GET?: unknown; POST?: unknown }) => (m.GET ?? m.POST) as Handler;
  routes = {
    list: h(await import("@/app/api/v1/announcements/route")),
    item: h(await import("@/app/api/v1/announcements/[id]/route")),
    image: h(await import("@/app/api/v1/announcements/[id]/image/route")),
    frame: h(await import("@/app/announcement-frame/[id]/route")),
    create: h(await import("@/app/api/admin/announcements/route")),
    update: h(await import("@/app/api/admin/announcements/[id]/route")),
    status: h(await import("@/app/api/admin/announcements/[id]/status/route")),
    remove: h(await import("@/app/api/admin/announcements/[id]/delete/route")),
    upload: h(await import("@/app/api/admin/announcements/images/route")),
    adminImage: h(await import("@/app/api/admin/announcements/images/[id]/route")),
  };
  adminId = (await prisma.user.create({ data: { email: "admin@faam.test", name: "Admin", passwordHash: "x", role: "ADMIN" } })).id;
  userId = (await prisma.user.create({ data: { email: "user@faam.test", name: "User", passwordHash: "x" } })).id;
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  auth.session = null;
  await prisma.announcement.deleteMany();
  await prisma.announcementImage.deleteMany();
});

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

function seed(data: Partial<Prisma.AnnouncementUncheckedCreateInput> = {}) {
  return prisma.announcement.create({
    data: { titleVi: "Thông báo", status: "published", startsAt: ago(HOUR), ...data },
  });
}

async function getList(query: string) {
  const res = await routes.list(new Request(`${SITE}/api/v1/announcements${query}`), ctx());
  return { res, body: (await res.json()) as { announcements: Record<string, unknown>[]; error?: string } };
}

const titles = (body: { announcements: Record<string, unknown>[] }) => body.announcements.map((a) => a.title);

describe("GET /api/v1/announcements", () => {
  it("returns only published announcements inside their window, cacheable for a minute", async () => {
    await seed({ titleVi: "live" });
    await seed({ titleVi: "draft", status: "draft" });
    await seed({ titleVi: "scheduled", startsAt: new Date(Date.now() + HOUR) });
    await seed({ titleVi: "expired", startsAt: ago(2 * HOUR), endsAt: ago(60_000) });
    await seed({ titleVi: "ending later", endsAt: new Date(Date.now() + HOUR) });
    const { res, body } = await getList("?platform=mac&version=0.11.1&locale=vi");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(titles(body).sort()).toEqual(["ending later", "live"]);
  });

  it("filters by platform (empty = all) and inclusive version range", async () => {
    await seed({ titleVi: "all" });
    await seed({ titleVi: "win only", platforms: "win" });
    await seed({ titleVi: "mac+linux", platforms: "mac,linux" });
    await seed({ titleVi: ">=0.12.0", minVersion: "0.12.0" });
    await seed({ titleVi: "<=0.11.0", maxVersion: "0.11.0" });
    await seed({ titleVi: "0.11.1 exactly", minVersion: "0.11.1", maxVersion: "0.11.1" });

    expect(titles((await getList("?platform=mac&version=0.11.1")).body).sort()).toEqual(["0.11.1 exactly", "all", "mac+linux"]);
    expect(titles((await getList("?platform=win&version=0.11.1")).body).sort()).toEqual(["0.11.1 exactly", "all", "win only"]);
    // Pre-release suffixes are ignored: 0.12.0-beta.1 counts as 0.12.0.
    expect(titles((await getList("?platform=linux&version=0.12.0-beta.1")).body).sort()).toEqual([">=0.12.0", "all", "mac+linux"]);
    // Build metadata with an unencoded "+" (decoded as a space) still counts as the plain version.
    expect(titles((await getList("?platform=linux&version=0.12.0+build.1")).body).sort()).toEqual([">=0.12.0", "all", "mac+linux"]);
    expect(titles((await getList("?platform=win&version=0.11.0+build.3")).body).sort()).toEqual(["<=0.11.0", "all", "win only"]);
    expect(titles((await getList("?platform=win&version=0.11.0%2Bbuild.3")).body).sort()).toEqual(["<=0.11.0", "all", "win only"]);
    // Missing or invalid version: no version filtering.
    expect(titles((await getList("?platform=win")).body)).toHaveLength(5);
    expect(titles((await getList("?platform=win&version=banana")).body)).toHaveLength(5);
  });

  it("rejects invalid parameters with 400", async () => {
    const bad = await getList("?platform=beos");
    expect(bad.res.status).toBe(400);
    expect(bad.body.error).toBe("invalid_request");
    expect((await getList("?platform=mac&locale=%3Cscript%3E")).res.status).toBe(400);
    expect((await getList("?platform=darwin")).res.status).toBe(200);
  });

  it("sorts by priority, then newest start, and returns at most 5", async () => {
    await seed({ titleVi: "p0 old", priority: 0, startsAt: ago(5 * HOUR) });
    await seed({ titleVi: "p0 new", priority: 0, startsAt: ago(HOUR) });
    await seed({ titleVi: "p10", priority: 10, startsAt: ago(9 * HOUR) });
    await seed({ titleVi: "p-5", priority: -5 });
    await seed({ titleVi: "p3", priority: 3 });
    await seed({ titleVi: "p1", priority: 1 });
    await seed({ titleVi: "p0 mid", priority: 0, startsAt: ago(3 * HOUR) });
    const { body } = await getList("?platform=mac");
    expect(titles(body)).toEqual(["p10", "p3", "p1", "p0 new", "p0 mid"]);
  });

  it("localizes: vi uses Vietnamese, other locales English with Vietnamese fallback", async () => {
    await seed({
      titleVi: "Bản mới",
      titleEn: "New version",
      bodyVi: "Có gì mới",
      linkUrl: "https://faamoffice.net/download",
      linkLabelVi: "Tải về",
      priority: 2,
    });
    await seed({ titleVi: "Chỉ tiếng Việt", linkUrl: "https://faamoffice.net", priority: 1 });

    const vi = (await getList("?platform=mac&locale=vi")).body.announcements;
    expect(vi.map((a) => a.title)).toEqual(["Bản mới", "Chỉ tiếng Việt"]);
    expect(vi[0]).toMatchObject({ body: "Có gì mới", link: { url: "https://faamoffice.net/download", label: "Tải về" } });
    expect(vi[1].link).toEqual({ url: "https://faamoffice.net", label: "Xem chi tiết" });

    const en = (await getList("?platform=mac&locale=en-US")).body.announcements;
    expect(en.map((a) => a.title)).toEqual(["New version", "Chỉ tiếng Việt"]);
    expect(en[0]).toMatchObject({ body: "Có gì mới", link: { label: "Tải về" } });
    expect(en[1].link).toEqual({ url: "https://faamoffice.net", label: "Learn more" });
  });

  it("returns the documented shape with absolute image and frame URLs", async () => {
    const image = await prisma.announcementImage.create({ data: { mime: "image/png", bytes: PNG_1X1, width: 1, height: 1, size: PNG_1X1.length } });
    const ends = new Date(Date.now() + 5 * HOUR);
    const rich = await seed({ titleVi: "Ảnh", imageId: image.id, level: "warning", displayMode: "until_dismissed", endsAt: ends, priority: 3 });
    const external = await seed({ titleVi: "Ảnh ngoài", imageUrl: "https://cdn.example/banner.png", priority: 2 });
    const html = await seed({ titleVi: "HTML", kind: "html", htmlVi: "<p>Xin chào</p>", bodyVi: "ignored", priority: 1 });

    const list = (await getList("?platform=linux&locale=en")).body.announcements;
    expect(list[0]).toEqual({
      id: rich.id,
      kind: "rich",
      level: "warning",
      displayMode: "until_dismissed",
      title: "Ảnh",
      imageUrl: `${SITE}/api/v1/announcements/${rich.id}/image?v=${image.id}`,
      startsAt: rich.startsAt.toISOString(),
      endsAt: ends.toISOString(),
      updatedAt: rich.updatedAt.toISOString(),
    });
    expect(list[1].imageUrl).toBe("https://cdn.example/banner.png");
    expect(list[1]).not.toHaveProperty("endsAt");
    expect(list[1]).not.toHaveProperty("link");
    expect(list[2]).toMatchObject({ id: html.id, kind: "html", htmlUrl: `${SITE}/announcement-frame/${html.id}?locale=en` });
    expect(list[2]).not.toHaveProperty("body");
    expect(list[2]).not.toHaveProperty("imageUrl");
    expect(external.id).toBeTruthy();
  });
});

describe("CORS on the public endpoints", () => {
  const cors = (res: Response) => [res.headers.get("access-control-allow-origin"), res.headers.get("access-control-expose-headers")];

  it("lets any origin read successes and errors alike, Retry-After included", async () => {
    const live = await seed();
    const ok = await getList("?platform=mac");
    expect(cors(ok.res)).toEqual(["*", "Retry-After"]);

    const bad = await getList("?platform=beos");
    expect([bad.res.status, bad.body.error]).toEqual([400, "invalid_request"]);
    expect(cors(bad.res)).toEqual(["*", "Retry-After"]);

    const item = await routes.item(new Request(`${SITE}/api/v1/announcements/${live.id}`), ctx({ id: live.id }));
    expect([item.status, ...cors(item)]).toEqual([200, "*", "Retry-After"]);
    const missing = await routes.item(new Request(`${SITE}/api/v1/announcements/nope`), ctx({ id: "nope" }));
    expect([missing.status, (await missing.json()).error, ...cors(missing)]).toEqual([404, "not_found", "*", "Retry-After"]);
    const badLocale = await routes.item(new Request(`${SITE}/api/v1/announcements/${live.id}?locale=%3Cx%3E`), ctx({ id: live.id }));
    expect([badLocale.status, ...cors(badLocale)]).toEqual([400, "*", "Retry-After"]);
    const noImage = await routes.image(new Request(`${SITE}/api/v1/announcements/${live.id}/image`), ctx({ id: live.id }));
    expect([noImage.status, ...cors(noImage)]).toEqual([404, "*", "Retry-After"]);

    // 429 from the per-IP limit (300/min); a dedicated address keeps other tests unaffected.
    const fromIp = () => new Request(`${SITE}/api/v1/announcements?platform=beos`, { headers: { "x-forwarded-for": "198.51.100.7" } });
    for (let i = 0; i < 300; i++) await routes.list(fromIp(), ctx());
    const limited = await routes.list(fromIp(), ctx());
    expect([limited.status, (await limited.json()).error]).toEqual([429, "rate_limited"]);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(cors(limited)).toEqual(["*", "Retry-After"]);
  });
});

describe("GET /api/v1/announcements/{id}", () => {
  it("returns one published announcement in the list shape, 404 for drafts", async () => {
    const live = await seed({ titleVi: "Một", titleEn: "One" });
    const draft = await seed({ status: "draft" });
    const res = await routes.item(new Request(`${SITE}/api/v1/announcements/${live.id}?locale=en`), ctx({ id: live.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await res.json()).toMatchObject({ id: live.id, title: "One", kind: "rich" });
    expect((await routes.item(new Request(`${SITE}/api/v1/announcements/${draft.id}`), ctx({ id: draft.id }))).status).toBe(404);
    expect((await routes.item(new Request(`${SITE}/api/v1/announcements/nope`), ctx({ id: "nope" }))).status).toBe(404);
  });
});

describe("GET /api/v1/announcements/{id}/image", () => {
  it("serves the stored bytes with their type, length and a day-long cache", async () => {
    const image = await prisma.announcementImage.create({ data: { mime: "image/png", bytes: PNG_1X1, size: PNG_1X1.length } });
    const a = await seed({ imageId: image.id });
    const res = await routes.image(new Request(`${SITE}/api/v1/announcements/${a.id}/image`), ctx({ id: a.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(PNG_1X1.length));
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_1X1);
  });

  it("404s for drafts, missing images and unknown ids", async () => {
    const image = await prisma.announcementImage.create({ data: { mime: "image/png", bytes: PNG_1X1, size: PNG_1X1.length } });
    const draft = await seed({ status: "draft", imageId: image.id });
    const noImage = await seed();
    for (const id of [draft.id, noImage.id, "missing"]) {
      expect((await routes.image(new Request(`${SITE}/api/v1/announcements/${id}/image`), ctx({ id }))).status).toBe(404);
    }
  });
});

describe("GET /announcement-frame/{id}", () => {
  it("serves a sandboxed, embeddable document without scripts", async () => {
    const a = await seed({ kind: "html", titleVi: "Tin", htmlVi: "<p>Xin chào</p>", htmlEn: "<p>Hello</p>" });
    const res = await routes.frame(new Request(`${SITE}/announcement-frame/${a.id}?locale=en`), ctx({ id: a.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp.startsWith("sandbox allow-popups allow-popups-to-escape-sandbox;")).toBe(true);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("frame-ancestors");
    expect(csp).not.toMatch(/script-src|allow-scripts|allow-same-origin/);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const doc = await res.text();
    expect(doc).toContain('<html lang="en">');
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain("<p>Hello</p>");

    const vi = await routes.frame(new Request(`${SITE}/announcement-frame/${a.id}?locale=vi`), ctx({ id: a.id }));
    expect(await vi.text()).toContain("<p>Xin chào</p>");
  });

  it("falls back to Vietnamese HTML and 404s for drafts and rich announcements", async () => {
    const viOnly = await seed({ kind: "html", htmlVi: "<p>Chỉ tiếng Việt</p>" });
    const fallback = await routes.frame(new Request(`${SITE}/announcement-frame/${viOnly.id}?locale=fr`), ctx({ id: viOnly.id }));
    expect(await fallback.text()).toContain("<p>Chỉ tiếng Việt</p>");

    const draft = await seed({ kind: "html", status: "draft", htmlVi: "<p>secret</p>" });
    const rich = await seed();
    for (const id of [draft.id, rich.id, "missing"]) {
      const res = await routes.frame(new Request(`${SITE}/announcement-frame/${id}`), ctx({ id }));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-security-policy")).toContain("sandbox");
      expect(await res.text()).not.toContain("secret");
    }
  });
});

describe("admin mutations", () => {
  const asAdmin = () => (auth.session = { userId: adminId, user: { id: adminId, role: "ADMIN", disabledAt: null } });
  const asUser = () => (auth.session = { userId, user: { id: userId, role: "USER", disabledAt: null } });
  const post = (path: string, body: unknown, origin: string | null = SITE) =>
    new Request(`${SITE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    });
  const upload = (bytes: Uint8Array, name = "a.png", type = "image/png", origin: string | null = SITE) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(bytes)], name, { type }));
    return new Request(`${SITE}/api/admin/announcements/images`, { method: "POST", headers: origin ? { origin } : {}, body: form });
  };
  const valid = { titleVi: "Bản 0.12", kind: "rich", status: "published", bodyVi: "Có gì mới" };

  it("requires a same-site Origin and an ADMIN session", async () => {
    asAdmin();
    let res = await routes.create(post("/api/admin/announcements", valid, null), ctx());
    expect([res.status, (await res.json()).error]).toEqual([403, "invalid_origin"]);
    res = await routes.create(post("/api/admin/announcements", valid, "https://evil.example"), ctx());
    expect([res.status, (await res.json()).error]).toEqual([403, "invalid_origin"]);

    auth.session = null;
    res = await routes.create(post("/api/admin/announcements", valid), ctx());
    expect([res.status, (await res.json()).error]).toEqual([401, "unauthorized"]);

    asUser();
    res = await routes.create(post("/api/admin/announcements", valid), ctx());
    expect([res.status, (await res.json()).error]).toEqual([403, "forbidden"]);
    const existing = await seed();
    for (const [handler, path, body] of [
      [routes.update, `/api/admin/announcements/${existing.id}`, valid],
      [routes.status, `/api/admin/announcements/${existing.id}/status`, { status: "draft" }],
      [routes.remove, `/api/admin/announcements/${existing.id}/delete`, {}],
    ] as const) {
      expect((await handler(post(path, body), ctx({ id: existing.id }))).status).toBe(403);
    }
    expect((await routes.upload(upload(PNG_1X1), ctx())).status).toBe(403);
    expect(await prisma.announcement.count()).toBe(1);
  });

  it("creates, validates, publishes, updates and deletes", async () => {
    asAdmin();
    const invalid = await routes.create(post("/api/admin/announcements", { titleVi: "", linkUrl: "http://x.example" }), ctx());
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_request", fields: { titleVi: "required", linkUrl: "https_only" } });
    const noHtml = await routes.create(post("/api/admin/announcements", { titleVi: "x", kind: "html" }), ctx());
    expect((await noHtml.json()).fields).toEqual({ htmlVi: "required" });

    const created = await routes.create(post("/api/admin/announcements", { ...valid, platforms: ["win", "mac"], minVersion: "0.11.0" }), ctx());
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "published", platforms: "mac,win", minVersion: "0.11.0", createdById: adminId, updatedById: adminId });

    const unpublished = await routes.status(post(`/api/admin/announcements/${id}/status`, { status: "draft" }), ctx({ id }));
    expect(await unpublished.json()).toEqual({ ok: true, status: "draft" });
    expect((await getList("?platform=mac")).body.announcements).toHaveLength(0);

    const updated = await routes.update(post(`/api/admin/announcements/${id}`, { ...valid, titleVi: "Đổi tên", kind: "html", htmlVi: "<b>x</b>" }), ctx({ id }));
    expect(updated.status).toBe(200);
    expect(await prisma.announcement.findUniqueOrThrow({ where: { id } })).toMatchObject({ titleVi: "Đổi tên", kind: "html", bodyVi: null });

    expect((await routes.update(post("/api/admin/announcements/nope", valid), ctx({ id: "nope" }))).status).toBe(404);
    const removed = await routes.remove(post(`/api/admin/announcements/${id}/delete`, {}), ctx({ id }));
    expect(removed.status).toBe(200);
    expect(await prisma.announcement.count()).toBe(0);
  });

  it("accepts images by magic bytes only, caps them at 2 MB and cleans up replaced uploads", async () => {
    asAdmin();
    expect((await routes.upload(upload(PNG_1X1, "a.png", "image/png", null), ctx())).status).toBe(403);

    const fake = await routes.upload(upload(new TextEncoder().encode("<svg onload=alert(1)>"), "x.png", "image/png"), ctx());
    expect([fake.status, (await fake.json()).error]).toEqual([415, "unsupported_image"]);

    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG_1X1);
    const tooBig = await routes.upload(upload(big), ctx());
    expect([tooBig.status, (await tooBig.json()).error]).toEqual([413, "image_too_large"]);
    // A body over the multipart allowance is cut off while streaming, with the same image-specific code.
    // (Serialized up front: cancelling undici's own FormData stream mid-way rejects in the background.)
    const huge = new Uint8Array(2 * 1024 * 1024 + 256 * 1024);
    huge.set(PNG_1X1);
    const multipart = upload(huge);
    const hugeReq = new Request(multipart.url, {
      method: "POST",
      headers: multipart.headers,
      body: new Uint8Array(await multipart.arrayBuffer()),
    });
    const tooHuge = await routes.upload(hugeReq, ctx());
    expect([tooHuge.status, (await tooHuge.json()).error]).toEqual([413, "image_too_large"]);
    expect(await prisma.announcementImage.count()).toBe(0);

    // The client's Content-Type is ignored: a PNG sent as text/plain is stored as image/png.
    const ok = await routes.upload(upload(PNG_1X1, "photo.txt", "text/plain"), ctx());
    expect(ok.status).toBe(201);
    const first = (await ok.json()) as { id: string; mime: string; width: number; height: number; size: number };
    expect(first).toMatchObject({ mime: "image/png", width: 1, height: 1, size: PNG_1X1.length });

    const preview = await routes.adminImage(new Request(`${SITE}/api/admin/announcements/images/${first.id}`), ctx({ id: first.id }));
    expect(preview.headers.get("content-type")).toBe("image/png");
    asUser();
    expect((await routes.adminImage(new Request(`${SITE}/api/admin/announcements/images/${first.id}`), ctx({ id: first.id }))).status).toBe(403);
    asAdmin();

    const created = await routes.create(post("/api/admin/announcements", { ...valid, imageId: first.id }), ctx());
    const { id } = (await created.json()) as { id: string };
    const second = (await (await routes.upload(upload(PNG_1X1), ctx())).json()) as { id: string };
    await routes.update(post(`/api/admin/announcements/${id}`, { ...valid, imageId: second.id }), ctx({ id }));
    expect(await prisma.announcementImage.findUnique({ where: { id: first.id } })).toBeNull();

    const missing = await routes.update(post(`/api/admin/announcements/${id}`, { ...valid, imageId: "gone" }), ctx({ id }));
    expect((await missing.json()).fields).toEqual({ imageId: "image_missing" });

    await routes.remove(post(`/api/admin/announcements/${id}/delete`, {}), ctx({ id }));
    expect(await prisma.announcementImage.count()).toBe(0);
  });

  it("stores uploads cleaned up: upright, at most 1600 px, without metadata", async () => {
    asAdmin();
    // A 3200×1800 camera photo stored sideways (EXIF orientation 6): upright it is 1800×3200.
    const photo = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: "#3366cc" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const res = await routes.upload(upload(new Uint8Array(photo), "photo.jpg", "image/jpeg"), ctx());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; mime: string; width: number; height: number; size: number };
    expect(body).toMatchObject({ mime: "image/jpeg", width: 900, height: 1600 });
    const row = await prisma.announcementImage.findUniqueOrThrow({ where: { id: body.id } });
    expect(body.size).toBe(row.bytes.byteLength);
    const meta = await sharp(row.bytes).metadata();
    expect([meta.width, meta.height, meta.orientation, meta.exif]).toEqual([900, 1600, undefined, undefined]);
  });

  it("saves an html page despite leftover image fields and replies with what it stored", async () => {
    asAdmin();
    const uploaded = (await (await routes.upload(upload(PNG_1X1), ctx())).json()) as { id: string };
    const created = await routes.create(post("/api/admin/announcements", { ...valid, imageId: uploaded.id }), ctx());
    const { id } = (await created.json()) as { id: string };

    const rich = await routes.update(post(`/api/admin/announcements/${id}`, { ...valid, titleVi: "Có ảnh", imageId: uploaded.id }), ctx({ id }));
    const richBody = await rich.json();
    expect(rich.status).toBe(200);
    expect(richBody.values).toMatchObject({ kind: "rich", titleVi: "Có ảnh", imageId: uploaded.id, imageUrl: "", bodyVi: "Có gì mới" });
    expect(richBody.image).toEqual({ id: uploaded.id, mime: "image/png", width: 1, height: 1, size: PNG_1X1.length });

    // Switched to "HTML page" in the editor: the hidden image fields still hold the upload and an http URL.
    const html = await routes.update(
      post(`/api/admin/announcements/${id}`, {
        ...valid,
        kind: "html",
        htmlVi: "<p>Xin chào</p>",
        imageId: uploaded.id,
        imageUrl: "http://example.com/a.png",
        startsAt: "",
      }),
      ctx({ id }),
    );
    expect(html.status).toBe(200);
    const htmlBody = await html.json();
    const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    expect(htmlBody.values).toMatchObject({ kind: "html", htmlVi: "<p>Xin chào</p>", imageId: null, imageUrl: "", bodyVi: "" });
    // The editor gets the start time the server filled in, not the empty field it sent.
    expect(htmlBody.values.startsAt).toBe(row.startsAt.toISOString());
    expect(htmlBody.image).toBeNull();
    expect(row.imageId).toBeNull();
    expect(await prisma.announcementImage.findUnique({ where: { id: uploaded.id } })).toBeNull();

    // Back to "Image and text" from the stored values: saving works, with no stale upload.
    const back = await routes.update(post(`/api/admin/announcements/${id}`, { ...htmlBody.values, kind: "rich", bodyVi: "Lại có chữ" }), ctx({ id }));
    expect(back.status).toBe(200);
    expect((await back.json()).values).toMatchObject({ kind: "rich", imageId: null, bodyVi: "Lại có chữ", htmlVi: "" });
  });
});
