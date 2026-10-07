// HTTP regression check against a copy of the production build and a throwaway
// database. Never records test clicks or test accounts in the deployed website.
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import Database from "better-sqlite3";

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const source = join(root, process.env.FAAMOFFICE_WEB_BUILD_DIR || ".next");
  assert(existsSync(join(source, "BUILD_ID")), "Build the website before smoke:downloads.");
  const preview = process.argv.includes("--preview");
  const dir = mkdtempSync(join(tmpdir(), "faamoffice-download-smoke-"));
  const buildDir = `.next-download-smoke-${process.pid}`;
  const output = join(root, buildDir);
  const log = join(dir, "server.log");
  const database = join(dir, "test.db");
  const password = preview ? "Faam-download-preview-2026" : randomBytes(20).toString("hex");
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 67108864 });
  const passwordHash = ["scrypt", 32768, 8, 1, salt.toString("base64"), hash.toString("base64")].join("$");
  const db = new Database(database);
  for (const name of readdirSync(join(root, "prisma/migrations")).filter((name) => !name.endsWith(".toml")).sort()) {
    db.exec(readFileSync(join(root, "prisma/migrations", name, "migration.sql"), "utf8"));
  }
  const insert = db.prepare('INSERT INTO "User" (id, email, name, passwordHash, emailVerifiedAt, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const role of ["ADMIN", "USER"]) insert.run(role.toLowerCase(), `${role.toLowerCase()}@smoke.test`, `Test ${role}`, passwordHash, Date.now(), role, Date.now(), Date.now());
  db.close();
  cpSync(source, output, { recursive: true });

  const reserve = createServer();
  await new Promise<void>((resolve, reject) => { reserve.once("error", reject); reserve.listen(0, "127.0.0.1", resolve); });
  const port = (reserve.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => reserve.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: root, env: { ...process.env, DATABASE_URL: `file:${database}`, SITE_URL: base,
      FAAMOFFICE_WEB_BUILD_DIR: buildDir, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", COOKIE_SECURE: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeFileSync(log, "");
  server.stdout.on("data", (chunk) => appendFileSync(log, chunk));
  server.stderr.on("data", (chunk) => appendFileSync(log, chunk));
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + "/api/health")).status === 200) { ready = true; break; } } catch {}
      await wait(200);
    }
    assert(ready, "production server did not become ready");
    for (const locale of ["vi", "en"]) {
      const response = await fetch(base + `/${locale}/download`);
      assert.equal(response.status, 200);
      const html = await response.text();
      const anchors = [...html.matchAll(/<a\b[^>]*data-download-asset="([^"]+)"[^>]*>/g)];
      assert.equal(anchors.length, 6, "six direct installer buttons in server HTML");
      for (const [anchor] of anchors) {
        assert.match(anchor, /href="https:\/\/github\.com\/dinhthaicx\/faamoffice\/releases\/download\/[^\"]+"/);
        assert.match(anchor, /download="[^"]+\.(dmg|exe|AppImage|deb|rpm)"/);
      }
    }
    const anonymous = await fetch(base + "/vi/admin/downloads", { redirect: "manual" });
    assert.equal(anonymous.status, 307);
    assert.match(anonymous.headers.get("location")!, /\/vi\/login\?next=/);
    assert.equal((await fetch(base + "/api/admin/downloads")).status, 401);
    assert.equal((await fetch(base + "/api/downloads")).status, 405);
    const click = { asset: "winExe", version: "0.11.2", locale: "vi", source: "platform" };
    const post = (body: unknown, origin = base, agent = "Mozilla/5.0") => fetch(base + "/api/downloads", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "User-Agent": agent }, body: JSON.stringify(body),
    });
    assert.equal((await post(click)).status, 204);
    assert.equal((await post({ ...click, asset: "macArm", source: "recommended", locale: "en" })).status, 204);
    assert.equal((await post(click, base, "facebookexternalhit/1.1")).status, 204);
    assert.equal((await post(click, "https://foreign.test")).status, 403);
    assert.equal((await post({ ...click, visitorId: "not-stored" })).status, 400);
    const login = async (role: "admin" | "user") => {
      const response = await fetch(base + "/api/auth/login", {
        method: "POST", headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ email: `${role}@smoke.test`, password, locale: "vi" }),
      });
      assert.equal(response.status, 200, `${role} login`);
      return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    };
    const userCookie = await login("user");
    assert.equal((await fetch(base + "/api/admin/downloads", { headers: { Cookie: userCookie } })).status, 403);
    assert.equal((await fetch(base + "/en/admin/downloads", { headers: { Cookie: userCookie } })).status, 404);
    const adminCookie = await login("admin");
    const response = await fetch(base + "/api/admin/downloads?days=7", { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const report = await response.json();
    assert.equal(report.total, 2, "only valid user link activations count");
    assert.equal(report.series.length, 7);
    assert.deepEqual(report.locales, [{ locale: "vi", count: 1 }, { locale: "en", count: 1 }]);
    for (const locale of ["vi", "en"]) {
      const page = await fetch(base + `/${locale}/admin/downloads?days=7`, { headers: { Cookie: adminCookie } });
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /noindex/);
      assert.match(html, /GitHub/);
      assert.match(html, new RegExp(`href="/${locale}/admin/downloads\\?days=90"`));
      assert.match(html, /<details/);
      assert.match(html, /0\.11\.2/);
    }
    const stored = new Database(database, { readonly: true });
    const columns = stored.prepare('PRAGMA table_info("DownloadDailyStat")').all() as { name: string }[];
    assert.deepEqual(columns.map((column) => column.name), ["day", "asset", "version", "locale", "source", "count"]);
    stored.close();
    console.log("Downloads smoke passed: direct links vi/en, anonymous POST, bot/Origin validation, ADMIN-only page/API, daily aggregation and privacy.");
    if (preview) {
      console.log(`Preview with isolated test data: ${base}/vi/login (admin@smoke.test / ${password})`);
      await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
    }
  } catch (error) {
    console.error(readFileSync(log, "utf8"));
    throw error;
  } finally {
    const stopped = new Promise<void>((resolve) => { if (server.exitCode !== null || server.signalCode !== null) resolve(); else server.once("exit", () => resolve()); });
    server.kill("SIGTERM");
    await stopped;
    rmSync(output, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
