// Production HTTP regression check for marketing settings and ISR.
// Run `npm run build` first. All accounts and settings live in a temporary SQLite DB.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import Database from "better-sqlite3";

const root = resolve(import.meta.dirname, "..");
if (!existsSync(join(root, ".next/BUILD_ID"))) throw new Error("Run npm run build before smoke:marketing.");
const dir = mkdtempSync(join(tmpdir(), "faamoffice-marketing-smoke-"));
const log = join(dir, "server.log");
const database = join(dir, "test.db");
const db = new Database(database);
for (const name of readdirSync(join(root, "prisma/migrations"))
  .filter((n) => !n.endsWith(".toml"))
  .sort()) {
  db.exec(readFileSync(join(root, "prisma/migrations", name, "migration.sql"), "utf8"));
}
const password = randomBytes(20).toString("hex");
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 67108864 });
const passwordHash = ["scrypt", 32768, 8, 1, salt.toString("base64"), hash.toString("base64")].join("$");
db.prepare('INSERT INTO "User" (id, email, name, passwordHash, emailVerifiedAt, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
  "smoke-admin",
  "admin@smoke.test",
  "Smoke admin",
  passwordHash,
  Date.now(),
  "ADMIN",
  Date.now(),
  Date.now(),
);
db.close();

async function main() {
  const appOutput = join(root, ".next/server/app");
  const appBackup = join(dir, "app-output");
  cpSync(appOutput, appBackup, { recursive: true });
  const reserve = createServer();
  await new Promise<void>((resolve, reject) => {
    reserve.once("error", reject);
    reserve.listen(0, "127.0.0.1", resolve);
  });
  const port = (reserve.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => reserve.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${database}`, SITE_URL: base, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeFileSync(log, "");
  server.stdout.on("data", (chunk) => appendFileSync(log, chunk));
  server.stderr.on("data", (chunk) => appendFileSync(log, chunk));
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const pageAfterRevalidation = async (path: string, predicate: (html: string) => boolean) => {
    for (let i = 0; i < 75; i++) {
      const response = await fetch(base + path);
      const html = await response.text();
      if (predicate(html)) return { response, html };
      await wait(200);
    }
    throw new Error("page did not update after revalidation: " + path);
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/vi/download")).status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await wait(200);
    }
    assert(ready, "production server did not become ready");
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@smoke.test", password, locale: "vi" }),
    });
    assert.equal(login.status, 200, "admin login");
    const cookie = login.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; ");
    const admin = await fetch(base + "/en/admin/settings", { headers: { Cookie: cookie } });
    assert.equal(admin.status, 200, "admin settings page");
    const adminHtml = await admin.text();
    assert(adminHtml.includes('name="ads.publisherId"'));
    assert(adminHtml.includes('name="msStore.productId"'));
    const patch = async (body: Record<string, unknown>) => {
      const response = await fetch(base + "/api/admin/settings", {
        method: "PATCH",
        headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200, "save settings");
      return (await response.json()).settings;
    };
    const ads = { enabled: true, publisherId: "ca-pub-1234567890123456", autoAds: false, slots: { homeBottom: "1234567890" }, adsTxtExtra: "" };
    await patch({ ads, msStore: { enabled: true, productId: "9P0RJ9J87ZNQ" } });
    const { response: home, html: homeHtml } = await pageAfterRevalidation("/vi", (html) => html.includes("adsbygoogle.js?client=ca-pub-1234567890123456"));
    assert(home.headers.get("content-security-policy")?.includes("https:"), "ad CSP");
    assert(homeHtml.includes("adsbygoogle.js?client=ca-pub-1234567890123456"), "ad script");
    assert(homeHtml.includes('data-ad-slot="1234567890"'), "manual ad unit");
    const { response: download, html: downloadHtml } = await pageAfterRevalidation("/vi/download", (html) => html.includes("/badges/microsoft-store-vi-"));
    assert(!downloadHtml.includes("adsbygoogle.js"), "download contains no ads");
    const downloadCsp = download.headers.get("content-security-policy");
    assert(downloadCsp, "download CSP is present");
    assert(!downloadCsp.includes("'unsafe-eval'"), "strict download CSP");
    assert(downloadHtml.includes("/badges/microsoft-store-vi-"), "Store badge");
    const missing = await fetch(base + "/vi/this-page-does-not-exist");
    assert.equal(missing.status, 404, "unknown pages remain 404");
    assert(!(await missing.text()).includes("adsbygoogle.js"), "404 contains no advertising script");
    const txt = await fetch(base + "/ads.txt");
    assert.equal(txt.status, 200);
    assert.equal(await txt.text(), "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
    const { html: privacy } = await pageAfterRevalidation("/en/privacy", (html) => html.includes("5. Advertising"));
    assert(privacy.includes("5. Advertising"), "localized advertising disclosures");
    await patch({ ads: { ...ads, enabled: false }, msStore: { enabled: false, productId: "9P0RJ9J87ZNQ" } });
    await pageAfterRevalidation("/vi", (html) => !html.includes("adsbygoogle.js"));
    await pageAfterRevalidation("/vi/download", (html) => !html.includes("/badges/microsoft-store-vi-"));
    console.log("Production HTTP smoke passed: admin login/forms, save settings, scoped CSP/ads, Store badge, ads.txt, privacy, and disabling both features.");
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await stopped;
    }
    // ISR writes HTML/RSC files; restore the build's output after using test settings.
    cpSync(appBackup, appOutput, { recursive: true, force: true });
  }
}
main()
  .then(() => rmSync(dir, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error.message);
    console.error("Server log: " + log);
    process.exitCode = 1;
  });
