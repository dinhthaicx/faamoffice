import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadDay, downloadRange, type DownloadClick } from "@/lib/downloads-shared";

const auth = vi.hoisted(() => ({ role: null as "USER" | "ADMIN" | null }));
vi.mock("@/lib/session", () => ({ getSession: async () => auth.role ? { user: { id: "test", role: auth.role } } : null }));

const SITE = "https://faam.test";
const click: DownloadClick = { asset: "winExe", version: "0.11.2", locale: "vi", source: "platform" };
let dir: string;
let prisma: typeof import("@/lib/db")["prisma"];
let downloads: typeof import("@/lib/downloads");
let post: typeof import("@/app/api/downloads/route")["POST"];
let get: typeof import("@/app/api/admin/downloads/route")["GET"];
let limiter: typeof import("@/lib/rate-limit")["limiters"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "faam-downloads-"));
  const file = join(dir, "test.db");
  const db = new Database(file);
  for (const name of readdirSync("prisma/migrations").filter((name) => !name.endsWith(".toml")).sort()) {
    db.exec(readFileSync(join("prisma/migrations", name, "migration.sql"), "utf8"));
  }
  db.close();
  process.env.DATABASE_URL = `file:${file}`;
  process.env.SITE_URL = SITE;
  delete (globalThis as { __faamPrisma?: unknown }).__faamPrisma;
  ({ prisma } = await import("@/lib/db"));
  downloads = await import("@/lib/downloads");
  ({ POST: post } = await import("@/app/api/downloads/route"));
  ({ GET: get } = await import("@/app/api/admin/downloads/route"));
  ({ limiters: limiter } = await import("@/lib/rate-limit"));
});

beforeEach(async () => {
  await prisma.downloadDailyStat.deleteMany();
  auth.role = null;
  limiter().downloadClicks.reset("test-ip");
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function send(body: unknown = click, origin: string | null = SITE, userAgent = "Mozilla/5.0") {
  return post(new Request(`${SITE}/api/downloads`, {
    method: "POST", headers: { "content-type": "application/json", "user-agent": userAgent,
      "x-real-ip": "test-ip", ...(origin ? { origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

describe("anonymous download clicks", () => {
  it("aggregates concurrent clicks without retaining visitor data", async () => {
    await Promise.all(Array.from({ length: 20 }, () => downloads.recordDownload(click, new Date("2026-10-08T12:00:00Z"))));
    expect(await prisma.downloadDailyStat.findMany()).toEqual([{ day: "2026-10-08", ...click, count: 20 }]);
  });

  it("counts days in Vietnam across midnight and inclusive 7/30-day boundaries", async () => {
    expect(downloadDay(new Date("2026-10-07T16:59:59Z"))).toBe("2026-10-07");
    expect(downloadDay(new Date("2026-10-07T17:00:00Z"))).toBe("2026-10-08");
    for (const day of ["2026-09-08", "2026-09-09", "2026-10-01", "2026-10-02", "2026-10-08"]) {
      await downloads.recordDownload(click, new Date(`${day}T12:00:00Z`));
    }
    const report = await downloads.downloadReport(7, new Date("2026-10-08T12:00:00Z"));
    expect(report).toMatchObject({ total: 5, today: 1, last7: 2, last30: 4, firstDay: "2026-09-08", timeZone: "Asia/Ho_Chi_Minh" });
    expect(report.series).toHaveLength(7);
    expect(report.series[0]).toEqual({ day: "2026-10-02", count: 1 });
    expect(report.series[1]).toEqual({ day: "2026-10-03", count: 0 });
    expect(report.assets.find((row) => row.asset === "winExe")?.count).toBe(2);
    expect(report.versions).toEqual([{ version: "0.11.2", count: 2 }]);
    expect((await downloads.downloadReport(90)).series).toHaveLength(90);
    expect([downloadRange("7"), downloadRange("90"), downloadRange("-1"), downloadRange(["7"])]).toEqual([7, 90, 30, 30]);
  });

  it("accepts a bounded anonymous same-origin POST and keeps dimensions separate", async () => {
    expect((await send()).status).toBe(204);
    expect((await send({ ...click, locale: "en", source: "recommended", asset: "macArm" })).status).toBe(204);
    const report = await downloads.downloadReport();
    expect(report.total).toBe(2);
    expect(report.locales).toEqual([{ locale: "vi", count: 1 }, { locale: "en", count: 1 }]);
    expect(report.sources).toEqual([{ source: "recommended", count: 1 }, { source: "platform", count: 1 }]);
  });

  it("rejects missing/foreign origins, unknown fields, invalid installers and oversized requests", async () => {
    expect((await send(click, null)).status).toBe(403);
    expect((await send(click, "https://evil.test")).status).toBe(403);
    expect((await send({ ...click, email: "someone@test.example" })).status).toBe(400);
    expect((await send({ ...click, asset: "other" })).status).toBe(400);
    expect((await send({ ...click, version: "<script>" })).status).toBe(400);
    expect((await send("x".repeat(1025))).status).toBe(413);
    expect(await prisma.downloadDailyStat.count()).toBe(0);
  });

  it("does not count preview bots or expose a GET tracking handler", async () => {
    expect((await send(click, SITE, "facebookexternalhit/1.1")).status).toBe(204);
    expect((await send(click, SITE, "Googlebot")).status).toBe(204);
    expect((await import("@/app/api/downloads/route"))).not.toHaveProperty("GET");
    expect(await prisma.downloadDailyStat.count()).toBe(0);
  });

  it("rate-limits repeated posts without increasing the recorded count", async () => {
    for (let i = 0; i < 60; i++) expect((await send()).status).toBe(204);
    const response = await send();
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await downloads.downloadReport()).total).toBe(60);
  });
});

describe("download report authorization", () => {
  it("denies anonymous and ordinary users and returns a non-cacheable report for ADMIN", async () => {
    const request = () => new Request(`${SITE}/api/admin/downloads?days=7`);
    expect((await get(request())).status).toBe(401);
    auth.role = "USER";
    expect((await get(request())).status).toBe(403);
    auth.role = "ADMIN";
    const response = await get(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ days: 7, total: 0 });
  });
});
