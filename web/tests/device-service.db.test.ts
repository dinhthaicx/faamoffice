// Integration tests against a throwaway SQLite database (migrations applied
// directly): device flow, bearer authentication and credit ledger.

import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Db = typeof import("@/lib/db");
type DeviceService = typeof import("@/lib/device-service");
type ApiToken = typeof import("@/lib/api-token");
type Credits = typeof import("@/lib/credits");

let dir = "";
let prisma: Db["prisma"];
let svc: DeviceService;
let tokens: ApiToken;
let credits: Credits;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "faam-web-test-"));
  const file = join(dir, "test.db");
  const db = new Database(file);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((n) => !n.endsWith(".toml")).sort()) {
    db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  process.env.DATABASE_URL = `file:${file}`;
  process.env.SITE_URL = "https://faam.test";
  ({ prisma } = await import("@/lib/db"));
  svc = await import("@/lib/device-service");
  tokens = await import("@/lib/api-token");
  credits = await import("@/lib/credits");
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

let n = 0;
async function makeUser(overrides: { disabledAt?: Date; credits?: number } = {}) {
  n += 1;
  return prisma.user.create({
    data: { email: `user${n}@faam.test`, name: `User ${n}`, passwordHash: "x", credits: overrides.credits ?? 100, disabledAt: overrides.disabledAt },
  });
}

function bearer(token: string) {
  return new Request("https://faam.test/api/v1/me", { headers: { Authorization: `Bearer ${token}` } });
}

describe("device authorization (database)", () => {
  it("creates a request with the documented response shape and stores only a hash", async () => {
    const res = await svc.createDeviceAuthorization({ clientId: "faamoffice-desktop", deviceName: "MacBook" });
    expect(res).toMatchObject({
      verification_uri: "https://faam.test/device",
      verification_uri_complete: `https://faam.test/device?code=${res.user_code}`,
      expires_in: 600,
      interval: 5,
    });
    expect(res.device_code.length).toBeGreaterThanOrEqual(43);
    const row = await prisma.deviceCode.findUnique({ where: { userCode: res.user_code } });
    expect(row?.deviceCodeHash).not.toEqual(res.device_code);
    expect(row?.deviceCodeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pending → slow_down → approved → token exactly once → consumed", async () => {
    const user = await makeUser();
    const res = await svc.createDeviceAuthorization({ clientId: "faamoffice-desktop", deviceName: "Work laptop" });

    expect(await svc.pollDeviceToken("faamoffice-desktop", res.device_code)).toMatchObject({ ok: false, error: "authorization_pending" });
    expect(await svc.pollDeviceToken("faamoffice-desktop", res.device_code)).toMatchObject({ ok: false, error: "slow_down", interval: 10 });

    // Users may type the code in any format.
    expect(await svc.decideDeviceRequest(user.id, res.user_code.toLowerCase().replace("-", ""), true)).toBe("approved");
    expect(await svc.decideDeviceRequest(user.id, res.user_code, false)).toBe("already_used");

    const issued = await svc.pollDeviceToken("faamoffice-desktop", res.device_code);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.accessToken).toMatch(/^fo_[A-Za-z0-9_-]{43}$/);
    expect(issued.user).toEqual({ id: user.id, email: user.email, name: user.name });

    const stored = await prisma.apiToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.name).toBe("Work laptop");
    expect(stored.tokenHash).toBe(tokens.hashApiToken(issued.accessToken));
    const row = await prisma.deviceCode.findUniqueOrThrow({ where: { userCode: res.user_code } });
    expect(row.status).toBe("consumed");
    expect(row.tokenId).toBe(stored.id);

    expect(await svc.pollDeviceToken("faamoffice-desktop", res.device_code)).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("denied requests return access_denied", async () => {
    const user = await makeUser();
    const res = await svc.createDeviceAuthorization({ clientId: "faamoffice-desktop", deviceName: "PC" });
    expect(await svc.decideDeviceRequest(user.id, res.user_code, false)).toBe("denied");
    expect(await svc.pollDeviceToken("faamoffice-desktop", res.device_code)).toMatchObject({ ok: false, error: "access_denied" });
  });

  it("expired requests cannot be approved and poll as expired_token", async () => {
    const user = await makeUser();
    const res = await svc.createDeviceAuthorization({ clientId: "faamoffice-desktop", deviceName: "PC" });
    await prisma.deviceCode.update({ where: { userCode: res.user_code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await svc.decideDeviceRequest(user.id, res.user_code, true)).toBe("expired");
    expect(await svc.pollDeviceToken("faamoffice-desktop", res.device_code)).toMatchObject({ ok: false, error: "expired_token" });
  });

  it("rejects unknown codes and mismatched client ids", async () => {
    const res = await svc.createDeviceAuthorization({ clientId: "faamoffice-desktop", deviceName: "PC" });
    expect(await svc.pollDeviceToken("faamoffice-desktop", "not-a-real-device-code")).toMatchObject({ error: "invalid_grant" });
    expect(await svc.pollDeviceToken("someone-else", res.device_code)).toMatchObject({ error: "invalid_client" });
    expect(await svc.decideDeviceRequest("nobody", "BCDF-GHJK", true)).toBe("not_found");
  });

  it("does not issue a token to a user disabled after approving", async () => {
    const user = await makeUser();
    const res = await svc.createDeviceAuthorization({ clientId: "faamoffice-desktop", deviceName: "PC" });
    await svc.decideDeviceRequest(user.id, res.user_code, true);
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect(await svc.pollDeviceToken("faamoffice-desktop", res.device_code)).toMatchObject({ ok: false, error: "access_denied" });
  });
});

describe("bearer authentication (database)", () => {
  async function issue(userId: string) {
    const raw = tokens.generateApiToken();
    const row = await prisma.apiToken.create({ data: { userId, name: "Test", tokenHash: tokens.hashApiToken(raw) } });
    return { raw, row };
  }

  it("authenticates a valid token and records lastUsedAt", async () => {
    const user = await makeUser();
    const { raw, row } = await issue(user.id);
    const auth = await tokens.authenticateBearer(bearer(raw));
    expect(auth.user.id).toBe(user.id);
    const after = await prisma.apiToken.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lastUsedAt).not.toBeNull();
  });

  it("rejects missing, unknown, revoked and disabled-user tokens with invalid_token", async () => {
    const user = await makeUser();
    const { raw, row } = await issue(user.id);
    await expect(tokens.authenticateBearer(new Request("https://faam.test/"))).rejects.toMatchObject({ status: 401, code: "invalid_token" });
    await expect(tokens.authenticateBearer(bearer(tokens.generateApiToken()))).rejects.toMatchObject({ status: 401 });

    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    await expect(tokens.authenticateBearer(bearer(raw))).rejects.toMatchObject({ code: "invalid_token" });
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: null } });
    await expect(tokens.authenticateBearer(bearer(raw))).resolves.toBeTruthy();

    await prisma.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await expect(tokens.authenticateBearer(bearer(raw))).rejects.toMatchObject({ code: "invalid_token" });
  });
});

describe("credit ledger (database)", () => {
  it("bills usage atomically and lets the last request go slightly negative", async () => {
    const user = await makeUser({ credits: 3 });
    const res = await credits.recordAiUsage({
      userId: user.id,
      tokenId: null,
      model: "faam-fast",
      promptTokens: 1200,
      completionTokens: 800,
      credits: 5,
      estimated: false,
    });
    expect(res.balance).toBe(-2);
    const ledger = await prisma.creditTransaction.findMany({ where: { userId: user.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: -5, balanceAfter: -2, reason: "ai_usage", usageRecordId: res.usage.id });
  });

  it("records admin adjustments with actor and reason", async () => {
    const admin = await makeUser();
    const user = await makeUser({ credits: 10 });
    const entry = await credits.adjustCredits({ userId: user.id, delta: -4, note: "refund correction", actorId: admin.id });
    expect(entry).toMatchObject({ delta: -4, balanceAfter: 6, reason: "admin_adjust", actorId: admin.id, note: "refund correction" });
    await expect(credits.adjustCredits({ userId: user.id, delta: 0, note: "noop", actorId: admin.id })).rejects.toMatchObject({ status: 400 });
    await expect(credits.adjustCredits({ userId: user.id, delta: 1.5, note: "frac", actorId: admin.id })).rejects.toMatchObject({ status: 400 });
  });
});
