// Site settings against a throwaway SQLite database (migrations applied
// directly): the settings store (defaults, round trip, cache, fallbacks), the
// admin route (auth, Origin, validation), the public app config endpoint, and
// the /api/v1/me and /api/v1/usage shapes with credits on and off.

import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSiteSettings, SETTING_KEYS } from "@/lib/site-settings-shared";

type Session = { userId: string; user: { id: string; role: "USER" | "ADMIN"; disabledAt: Date | null } };
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/lib/session", () => ({ getSession: async () => auth.session }));

type Db = typeof import("@/lib/db");
type Settings = typeof import("@/lib/site-settings");
type Quota = typeof import("@/lib/ai-quota");
type Handler = (req: Request, ctx?: unknown) => Promise<Response>;

const SITE = "https://faam.test";

let dir = "";
let prisma: Db["prisma"];
let settings: Settings;
let quota: Quota;
let routes: { patch: Handler; put: Handler; config: Handler; me: Handler; usage: Handler; adsTxt: Handler };
let adminId = "";
let userId = "";
let token = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "faam-web-settings-"));
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
  settings = await import("@/lib/site-settings");
  quota = await import("@/lib/ai-quota");
  const admin = await import("@/app/api/admin/settings/route");
  routes = {
    patch: admin.PATCH as Handler,
    put: admin.PUT as Handler,
    config: (await import("@/app/api/v1/app/config/route")).GET as Handler,
    me: (await import("@/app/api/v1/me/route")).GET as Handler,
    usage: (await import("@/app/api/v1/usage/route")).GET as Handler,
    adsTxt: (await import("@/app/ads.txt/route")).GET as Handler,
  };
  const tokens = await import("@/lib/api-token");
  adminId = (await prisma.user.create({ data: { email: "admin@faam.test", name: "Admin", passwordHash: "x", role: "ADMIN" } })).id;
  userId = (await prisma.user.create({ data: { email: "user@faam.test", name: "User", passwordHash: "x", credits: 42 } })).id;
  token = tokens.generateApiToken();
  await prisma.apiToken.create({ data: { userId, name: "Mac", tokenHash: tokens.hashApiToken(token) } });
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  auth.session = null;
  await prisma.siteSetting.deleteMany();
  await prisma.usageRecord.deleteMany();
  settings.clearSiteSettingsCache();
});

const asAdmin = () => {
  auth.session = { userId: adminId, user: { id: adminId, role: "ADMIN", disabledAt: null } };
};

function send(method: "PATCH" | "PUT", body: unknown, origin: string | null = SITE) {
  const req = new Request(`${SITE}/api/admin/settings`, {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return (method === "PATCH" ? routes.patch : routes.put)(req);
}

const fb = (extra: Record<string, unknown> = {}) => ({
  id: "fb",
  platform: "facebook",
  url: "https://www.facebook.com/faamoffice",
  enabled: true,
  ...extra,
});

describe("settings store", () => {
  it("returns the defaults when nothing is stored", async () => {
    expect(await settings.getSiteSettings()).toEqual(defaultSiteSettings());
  });

  it("saves a partial update, keeps the other keys and records who saved it", async () => {
    await settings.updateSiteSettings({ aiDailyRequestLimit: 50 }, adminId);
    const after = await settings.updateSiteSettings({ creditsEnabled: false }, adminId);
    expect(after).toEqual({ ...defaultSiteSettings(), creditsEnabled: false, aiDailyRequestLimit: 50 });
    const rows = await prisma.siteSetting.findMany({ orderBy: { key: "asc" } });
    expect(rows.map((r) => [r.key, r.value, r.updatedById])).toEqual([
      ["aiDailyRequestLimit", "50", adminId],
      ["creditsEnabled", "false", adminId],
    ]);
  });

  it("caches reads for ~10 s; saving (or clearing) invalidates the cache", async () => {
    const t0 = Date.now();
    await settings.updateSiteSettings({ aiDailyRequestLimit: 10 }, adminId);
    // A write behind the cache's back is not seen until the entry expires or is cleared.
    await prisma.siteSetting.update({ where: { key: "aiDailyRequestLimit" }, data: { value: "20" } });
    expect((await settings.getSiteSettings(t0 + 1_000)).aiDailyRequestLimit).toBe(10);
    expect((await settings.getSiteSettings(t0 + settings.SITE_SETTINGS_TTL_MS + 5_000)).aiDailyRequestLimit).toBe(20);
    await prisma.siteSetting.update({ where: { key: "aiDailyRequestLimit" }, data: { value: "30" } });
    settings.clearSiteSettingsCache();
    expect((await settings.getSiteSettings()).aiDailyRequestLimit).toBe(30);
    // updateSiteSettings clears it too.
    expect((await settings.updateSiteSettings({ aiDailyRequestLimit: 40 }, adminId)).aiDailyRequestLimit).toBe(40);
    expect((await settings.getSiteSettings()).aiDailyRequestLimit).toBe(40);
  });

  it("falls back to the default of a key whose stored value is unreadable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await prisma.siteSetting.createMany({
      data: [
        { key: "creditsEnabled", value: '"false"' },
        { key: "aiDailyRequestLimit", value: "{not json" },
        { key: "socialLinks", value: JSON.stringify([fb()]) },
      ],
    });
    const read = await settings.readSiteSettings();
    const s = read.settings;
    expect(s.creditsEnabled).toBe(true);
    expect(s.aiDailyRequestLimit).toBe(300);
    expect(s.socialLinks).toEqual([{ id: "fb", platform: "facebook", url: "https://www.facebook.com/faamoffice", label: null, enabled: true }]);
    // Reported as degraded, unlike a key that is simply not stored.
    expect([...read.degraded].sort()).toEqual(["aiDailyRequestLimit", "creditsEnabled"]);
    expect(read.queryFailed).toBe(false);
    vi.mocked(console.error).mockRestore();
  });

  it("drops a stored link that no longer validates and keeps the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stored = [fb({ id: "bad", url: "https://www.youtube.com/@faam" }), fb({ id: "fb2", label: "Fanpage" })];
    await prisma.siteSetting.create({ data: { key: "socialLinks", value: JSON.stringify(stored) } });
    const read = await settings.readSiteSettings();
    expect(read.degraded).toEqual([]);
    expect(read.settings.socialLinks).toEqual([
      { id: "fb2", platform: "facebook", url: "https://www.facebook.com/faamoffice", label: "Fanpage", enabled: true },
    ]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("social link(s) at index 0"));
    vi.mocked(console.error).mockRestore();
  });

  it("saves a link whose encoded URL is near the limit and reads it back unchanged", async () => {
    const base = `https://www.facebook.com/${"Trường-Đại-Học-".repeat(9)}`;
    const url = base + "a".repeat(settings.SOCIAL_URL_MAX - new URL(base).href.length);
    const saved = await settings.updateSiteSettings(settings.parseSettingsPatch({ socialLinks: [fb({ url }), fb({ id: "fb2" })] }), adminId);
    expect(saved.socialLinks.map((l) => l.url.length)).toEqual([settings.SOCIAL_URL_MAX, 35]);
    settings.clearSiteSettingsCache();
    expect((await settings.readSiteSettings()).settings.socialLinks).toEqual(saved.socialLinks);
  });

  it("falls back to the defaults when the table is missing (e.g. not migrated yet at build time)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await settings.updateSiteSettings({ creditsEnabled: false }, adminId);
    await prisma.$executeRawUnsafe('ALTER TABLE "SiteSetting" RENAME TO "SiteSetting_hidden"');
    const t0 = Date.now();
    try {
      settings.clearSiteSettingsCache();
      const read = await settings.readSiteSettings(t0);
      expect(read.settings).toEqual(defaultSiteSettings());
      expect(read).toMatchObject({ degraded: [...SETTING_KEYS], queryFailed: true });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "SiteSetting_hidden" RENAME TO "SiteSetting"');
      vi.mocked(console.error).mockRestore();
    }
    // The defaults from a failed query are retried after ~1 s, not kept for the whole TTL.
    expect((await settings.getSiteSettings(t0 + settings.SITE_SETTINGS_RETRY_MS / 2)).creditsEnabled).toBe(true);
    const retried = await settings.readSiteSettings(t0 + settings.SITE_SETTINGS_RETRY_MS + 1);
    expect(retried).toMatchObject({ degraded: [], queryFailed: false });
    expect(retried.settings.creditsEnabled).toBe(false);
  });
});

describe("PATCH/PUT /api/admin/settings", () => {
  it("persists normalized ads and Store settings and rejects invalid values without partial writes", async () => {
    asAdmin();
    const ads = { ...defaultSiteSettings().ads, publisherId: " pub-1234567890123456 ",
      slots: { homeBottom: " 1234567890 " }, adsTxtExtra: "Example.COM, account, direct" };
    const response = await send("PATCH", { ads, msStore: { enabled: true, productId: "9p0rj9j87znq" } });
    expect(response.status).toBe(200);
    const stored = (await response.json()).settings;
    expect(stored.ads).toEqual({ ...ads, publisherId: "ca-pub-1234567890123456", slots: { homeBottom: "1234567890" }, adsTxtExtra: "example.com, account, DIRECT" });
    expect(stored.msStore).toEqual({ enabled: true, productId: "9P0RJ9J87ZNQ" });
    settings.clearSiteSettingsCache();
    expect(await settings.getSiteSettings()).toEqual(stored);
    const invalid = await send("PATCH", { creditsEnabled: false, ads: { ...ads, publisherId: "invalid" } });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).fields).toEqual({ "ads.publisherId": "publisher_id" });
    expect((await settings.getSiteSettings()).creditsEnabled).toBe(true);
  });

  it("requires a same-site Origin and an ADMIN session", async () => {
    let res = await send("PATCH", { creditsEnabled: false });
    expect([res.status, (await res.json()).error]).toEqual([401, "unauthorized"]);

    auth.session = { userId, user: { id: userId, role: "USER", disabledAt: null } };
    res = await send("PATCH", { creditsEnabled: false });
    expect([res.status, (await res.json()).error]).toEqual([403, "forbidden"]);

    asAdmin();
    res = await send("PATCH", { creditsEnabled: false }, null);
    expect([res.status, (await res.json()).error]).toEqual([403, "invalid_origin"]);
    res = await send("PUT", { creditsEnabled: false, aiDailyRequestLimit: 1, socialLinks: [] }, "https://evil.example");
    expect([res.status, (await res.json()).error]).toEqual([403, "invalid_origin"]);
    expect(await prisma.siteSetting.count()).toBe(0);
  });

  it("saves and replies with the stored, normalized settings", async () => {
    asAdmin();
    const res = await send("PATCH", {
      creditsEnabled: false,
      aiDailyRequestLimit: "120",
      socialLinks: [fb({ label: "  Fanpage " }), { platform: "website", url: "https://faamoffice.net", enabled: false }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.settings.creditsEnabled).toBe(false);
    expect(body.settings.aiDailyRequestLimit).toBe(120);
    expect(body.settings.socialLinks[0]).toEqual({ id: "fb", platform: "facebook", url: "https://www.facebook.com/faamoffice", label: "Fanpage", enabled: true });
    expect(body.settings.socialLinks[1]).toMatchObject({ platform: "website", url: "https://faamoffice.net/", label: null, enabled: false });
    expect(body.settings.socialLinks[1].id).toMatch(/^[a-z0-9]+$/);
    expect(await settings.getSiteSettings()).toEqual(body.settings);

    // PUT replaces everything.
    const replacement = { ...defaultSiteSettings(), aiDailyRequestLimit: 0 };
    const put = await send("PUT", replacement);
    expect(put.status).toBe(200);
    expect((await put.json()).settings).toEqual(replacement);
  });

  it("rejects invalid values with field errors and stores nothing", async () => {
    asAdmin();
    const cases: [unknown, Record<string, string>][] = [
      [{ creditsEnabled: "false" }, { creditsEnabled: "invalid" }],
      [{ aiDailyRequestLimit: -5 }, { aiDailyRequestLimit: "out_of_range" }],
      [{ socialLinks: [fb({ url: "http://www.facebook.com/faamoffice" })] }, { "socialLinks.0.url": "https_only" }],
      [{ socialLinks: [fb({ url: "https://www.youtube.com/@faam" })] }, { "socialLinks.0.url": "wrong_host" }],
      [{ socialLinks: [fb({ url: "https://facebook.com.evil.example/x" })] }, { "socialLinks.0.url": "wrong_host" }],
      [{ socialLinks: Array.from({ length: 13 }, (_, i) => fb({ id: `fb${i}` })) }, { socialLinks: "too_many" }],
      [{ socialLinks: [fb({ label: "x".repeat(41) })] }, { "socialLinks.0.label": "too_long" }],
    ];
    for (const [body, fields] of cases) {
      const res = await send("PATCH", body);
      const json = await res.json();
      expect([res.status, json.error, json.fields], JSON.stringify(body).slice(0, 80)).toEqual([400, "invalid_request", fields]);
    }
    expect((await send("PATCH", { unknown: 1 })).status).toBe(400);
    expect((await send("PUT", { creditsEnabled: true })).status).toBe(400);
    expect((await send("PATCH", "{nope")).status).toBe(400);
    expect(await prisma.siteSetting.count()).toBe(0);
  });
});

describe("GET /ads.txt", () => {
  const get = () => routes.adsTxt(new Request(`${SITE}/ads.txt`));

  it("is absent by default and publishes verification records while ads are off", async () => {
    expect((await get()).status).toBe(404);
    await settings.updateSiteSettings({ ads: { ...defaultSiteSettings().ads, publisherId: "ca-pub-1234567890123456" } }, adminId);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.text()).toBe("google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
  });

  it("returns a retryable failure rather than a cached absence for corrupt advertising settings", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await prisma.siteSetting.create({ data: { key: "ads", value: "{not json" } });
      const response = await get();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe("60");
    } finally {
      log.mockRestore();
    }
  });
});

describe("GET /api/v1/app/config", () => {
  const get = (ip = "198.51.100.7") =>
    routes.config(new Request(`${SITE}/api/v1/app/config`, { headers: { "x-forwarded-for": ip } }));

  it("lists the enabled social links in order, publicly cacheable and CORS-readable", async () => {
    await settings.updateSiteSettings(
      {
        socialLinks: [
          { id: "yt", platform: "youtube", url: "https://www.youtube.com/@faamoffice", label: "Kênh", enabled: true },
          { id: "off", platform: "x", url: "https://x.com/faamoffice", label: null, enabled: false },
          { id: "zl", platform: "zalo", url: "https://zalo.me/123", label: null, enabled: true },
        ],
      },
      adminId,
    );
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({
      socials: [
        { id: "yt", platform: "youtube", url: "https://www.youtube.com/@faamoffice", label: "Kênh" },
        { id: "zl", platform: "zalo", url: "https://zalo.me/123" },
      ],
    });
  });

  it("answers 503 (no-store, CORS) when the stored list cannot be read, so the app keeps its cache", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await prisma.siteSetting.create({ data: { key: "socialLinks", value: "{not json" } });
      let res = await get("203.0.113.9");
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("unavailable");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("retry-after")).toBe("60");

      // The database itself failing (here: the table is gone) is not an empty list either.
      await prisma.siteSetting.deleteMany();
      await prisma.$executeRawUnsafe('ALTER TABLE "SiteSetting" RENAME TO "SiteSetting_hidden"');
      try {
        settings.clearSiteSettingsCache();
        res = await get("203.0.113.9");
        expect(res.status).toBe(503);
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE "SiteSetting_hidden" RENAME TO "SiteSetting"');
      }

      // Another key being unreadable does not matter here, and neither does one bad link.
      await prisma.siteSetting.createMany({
        data: [
          { key: "creditsEnabled", value: "{not json" },
          { key: "socialLinks", value: JSON.stringify([fb({ id: "bad", url: "http://www.facebook.com/x" }), fb()]) },
        ],
      });
      settings.clearSiteSettingsCache();
      res = await get("203.0.113.9");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ socials: [{ id: "fb", platform: "facebook", url: "https://www.facebook.com/faamoffice" }] });
    } finally {
      vi.mocked(console.error).mockRestore();
    }
  });

  it("returns an empty list by default and rate limits per IP (429 with CORS and Retry-After)", async () => {
    expect(await (await get("192.0.2.1")).json()).toEqual({ socials: [] });
    for (let i = 0; i < 300; i++) expect((await get("192.0.2.50")).status).toBe(200);
    const limited = await get("192.0.2.50");
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("rate_limited");
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(limited.headers.get("access-control-allow-origin")).toBe("*");
    expect((await get("192.0.2.51")).status).toBe(200);
  });
});

describe("/api/v1/me and /api/v1/usage", () => {
  const bearer = (path: string) => new Request(`${SITE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const me = async () => (await routes.me(bearer("/api/v1/me"))).json();

  it("credits on: reports creditsEnabled and the balance, no quota", async () => {
    const body = await me();
    expect(Object.keys(body)).toEqual(["id", "email", "name", "emailVerified", "role", "creditsEnabled", "credits", "createdAt"]);
    expect(body).toMatchObject({ creditsEnabled: true, credits: 42 });
    const usage = await (await routes.usage(bearer("/api/v1/usage"))).json();
    expect(usage).toEqual({ creditsEnabled: true, items: [], nextCursor: null });
  });

  it("credits off: no balance; today's quota when a daily limit is set", async () => {
    await settings.updateSiteSettings({ creditsEnabled: false, aiDailyRequestLimit: 5 }, adminId);
    const now = new Date();
    const dayStart = quota.quotaDayStart(now);
    const record = (createdAt: Date) =>
      prisma.usageRecord.create({ data: { userId, model: "faam-fast", promptTokens: 1, completionTokens: 1, credits: 0, createdAt } });
    await record(dayStart); // today (local midnight counts)
    await record(now);
    await record(new Date(dayStart.getTime() - 1000)); // yesterday

    const body = await me();
    expect(body).not.toHaveProperty("credits");
    expect(body.creditsEnabled).toBe(false);
    expect(body.aiQuota).toEqual({ limit: 5, used: 2, resetsAt: quota.quotaResetsAt(now).toISOString() });
    expect(Date.parse(body.aiQuota.resetsAt) - Date.now()).toBeLessThanOrEqual(86_400_000);

    const usage = await (await routes.usage(bearer("/api/v1/usage"))).json();
    expect(usage.creditsEnabled).toBe(false);
    expect(usage.items).toHaveLength(3);

    await settings.updateSiteSettings({ aiDailyRequestLimit: 0 }, adminId);
    const unlimited = await me();
    expect(unlimited).not.toHaveProperty("credits");
    expect(unlimited).not.toHaveProperty("aiQuota");
    expect(unlimited.creditsEnabled).toBe(false);
  });
});
