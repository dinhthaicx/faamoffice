// The Faam AI Cloud proxy against a throwaway SQLite database with a stubbed
// upstream (global fetch): billing with credits on, the credits-off path (no
// 402, usage recorded with 0 credits, no ledger), the daily request limit
// (Asia/Ho_Chi_Minh days, Retry-After until midnight, 0 = unlimited) and the
// per-user burst limiter in both modes.

import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Db = typeof import("@/lib/db");
type Settings = typeof import("@/lib/site-settings");
type Quota = typeof import("@/lib/ai-quota");
type Tokens = typeof import("@/lib/api-token");

const SITE = "https://faam.test";
const UPSTREAM = "https://upstream.test/v1";
// faam-fast (default catalog): 1 credit / 1K prompt + 4 credits / 1K completion → ceil(1.2 + 3.2) = 5.
const USAGE = { prompt_tokens: 1200, completion_tokens: 800 };
const COST = 5;

let dir = "";
let prisma: Db["prisma"];
let settings: Settings;
let quota: Quota;
let tokens: Tokens;
let chat: (req: Request) => Promise<Response>;
const upstreamCalls: { url: string; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "faam-web-proxy-"));
  const file = join(dir, "test.db");
  const db = new Database(file);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((n) => !n.endsWith(".toml")).sort()) {
    db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  process.env.DATABASE_URL = `file:${file}`;
  process.env.SITE_URL = SITE;
  process.env.FAAM_AI_UPSTREAM_BASE_URL = UPSTREAM;
  process.env.FAAM_AI_UPSTREAM_API_KEY = "upstream-key";
  delete process.env.FAAM_AI_MODELS;
  delete (globalThis as { __faamPrisma?: unknown }).__faamPrisma;
  ({ prisma } = await import("@/lib/db"));
  settings = await import("@/lib/site-settings");
  quota = await import("@/lib/ai-quota");
  tokens = await import("@/lib/api-token");
  chat = (await import("@/app/api/v1/ai/chat/completions/route")).POST as (req: Request) => Promise<Response>;
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  settings.clearSiteSettingsCache();
  upstreamCalls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    upstreamCalls.push({ url, body });
    if (body.stream) {
      const sse =
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Xin chào" } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [], usage: USAGE })}\n\n` +
        "data: [DONE]\n\n";
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ id: "c1", choices: [{ index: 0, message: { role: "assistant", content: "Hi" } }], usage: USAGE });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

let n = 0;
async function makeUser(credits: number) {
  n += 1;
  const user = await prisma.user.create({ data: { email: `p${n}@faam.test`, name: `P${n}`, passwordHash: "x", credits } });
  const raw = tokens.generateApiToken();
  await prisma.apiToken.create({ data: { userId: user.id, name: "Mac", tokenHash: tokens.hashApiToken(raw) } });
  return { user, token: raw };
}

function request(token: string, body: Record<string, unknown> = {}) {
  return new Request(`${SITE}/api/v1/ai/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "faam-fast", messages: [{ role: "user", content: "Hi" }], ...body }),
  });
}

async function seedUsage(userId: string, createdAt: Date, count = 1) {
  for (let i = 0; i < count; i++) {
    await prisma.usageRecord.create({ data: { userId, model: "faam-fast", promptTokens: 1, completionTokens: 1, credits: 0, createdAt } });
  }
}

/** Wait (up to ~0.5 s) for something the background billing of a stream does. */
async function waitFor(done: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 50 && !(await done()); i++) await new Promise((r) => setTimeout(r, 10));
}

/** Wait until the background billing of a stream has written its record. */
async function waitForUsage(userId: string, count: number) {
  for (let i = 0; i < 50; i++) {
    if ((await prisma.usageRecord.count({ where: { userId } })) >= count) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("credits on (default)", () => {
  it("charges the request: usage, ledger entry and balance decrement", async () => {
    const { user, token } = await makeUser(100);
    const res = await chat(request(token));
    expect(res.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    const usage = await prisma.usageRecord.findMany({ where: { userId: user.id } });
    expect(usage.map((u) => u.credits)).toEqual([COST]);
    const ledger = await prisma.creditTransaction.findMany({ where: { userId: user.id } });
    expect(ledger.map((l) => [l.delta, l.reason])).toEqual([[-COST, "ai_usage"]]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(100 - COST);
  });

  it("refuses an empty balance with 402 insufficient_credits, without calling the upstream", async () => {
    const { token } = await makeUser(0);
    const res = await chat(request(token));
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("insufficient_credits");
    expect(upstreamCalls).toHaveLength(0);
  });

  it("ignores the daily limit", async () => {
    await settings.updateSiteSettings({ creditsEnabled: true, aiDailyRequestLimit: 1 }, null);
    const { user, token } = await makeUser(100);
    await seedUsage(user.id, new Date(), 3);
    expect((await chat(request(token))).status).toBe(200);
  });
});

describe("upstream error privacy", () => {
  it.each([401, 403, 500, 503])("keeps an echoed document out of logs and the response for status %s", async (status) => {
    const { user, token } = await makeUser(100);
    const privateContent = "private-document-content-that-must-not-be-logged";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: privateContent }), { status }));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await chat(request(token, { messages: [{ role: "user", content: privateContent }] }));
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain(privateContent);
      expect(logger).toHaveBeenCalledOnce();
      expect(JSON.stringify(logger.mock.calls)).toContain(String(status));
      expect(JSON.stringify(logger.mock.calls)).not.toContain(privateContent);
      expect(await prisma.usageRecord.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      logger.mockRestore();
    }
  });
});

describe("credits off", () => {
  beforeEach(async () => {
    await settings.updateSiteSettings({ creditsEnabled: false, aiDailyRequestLimit: 0 }, null);
  });

  it("serves users without credits: usage recorded with 0 credits, no ledger, balance untouched", async () => {
    const { user, token } = await makeUser(0);
    const res = await chat(request(token));
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("Hi");
    const usage = await prisma.usageRecord.findMany({ where: { userId: user.id } });
    expect(usage.map((u) => [u.credits, u.promptTokens, u.completionTokens, u.estimated])).toEqual([[0, 1200, 800, false]]);
    expect(await prisma.creditTransaction.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(0);
  });

  it("records streamed requests the same way", async () => {
    const { user, token } = await makeUser(-3);
    const res = await chat(request(token, { stream: true }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Xin chào");
    await waitForUsage(user.id, 1);
    const usage = await prisma.usageRecord.findMany({ where: { userId: user.id } });
    expect(usage.map((u) => [u.credits, u.promptTokens, u.completionTokens])).toEqual([[0, 1200, 800]]);
    expect(await prisma.creditTransaction.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(-3);
  });

  it("limit 0 means unlimited", async () => {
    const { user, token } = await makeUser(0);
    await seedUsage(user.id, new Date(), 20);
    expect((await chat(request(token))).status).toBe(200);
  });

  it("refuses with 429 daily_limit_reached and Retry-After until the next local midnight", async () => {
    await settings.updateSiteSettings({ aiDailyRequestLimit: 2 }, null);
    const { user, token } = await makeUser(0);
    const dayStart = quota.quotaDayStart(new Date());
    // Yesterday's requests (one second before local midnight) do not count.
    await seedUsage(user.id, new Date(dayStart.getTime() - 1000), 5);
    await seedUsage(user.id, dayStart, 1);
    expect((await chat(request(token))).status).toBe(200); // 1 → 2 today

    const res = await chat(request(token));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("daily_limit_reached");
    expect(body.error.message).toMatch(/2 Faam AI requests/);
    const retryAfter = Number(res.headers.get("retry-after"));
    const expected = quota.secondsUntilReset(new Date());
    expect(Math.abs(retryAfter - expected)).toBeLessThanOrEqual(2);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
    expect(upstreamCalls).toHaveLength(1);
    // Other users keep their own count.
    const other = await makeUser(0);
    expect((await chat(request(other.token))).status).toBe(200);
  });

  it("counts requests still running, so a burst of long streams cannot get past the limit", async () => {
    await settings.updateSiteSettings({ aiDailyRequestLimit: 2 }, null);
    const { user, token } = await makeUser(0);
    // Two streams left unread: accepted, but recorded only when they end.
    const open = [await chat(request(token, { stream: true })), await chat(request(token, { stream: true }))];
    expect(open.map((r) => r.status)).toEqual([200, 200]);
    expect(quota.aiRequestsInFlight(user.id)).toBe(2);
    expect(await prisma.usageRecord.count({ where: { userId: user.id } })).toBe(0);
    const third = await chat(request(token));
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe("daily_limit_reached");
    expect(upstreamCalls).toHaveLength(2);

    // Read to the end or cancelled after some output: recorded, no longer running, still at the limit.
    expect(await open[0].text()).toContain("Xin chào");
    await open[1].body!.cancel();
    await waitForUsage(user.id, 2);
    await waitFor(() => quota.aiRequestsInFlight(user.id) === 0);
    expect(quota.aiRequestsInFlight(user.id)).toBe(0);
    expect(await prisma.usageRecord.count({ where: { userId: user.id } })).toBe(2);
    expect((await chat(request(token))).status).toBe(429);
    expect(upstreamCalls).toHaveLength(2);
  });

  it("a request that fails upstream stops counting as running and is not recorded", async () => {
    await settings.updateSiteSettings({ aiDailyRequestLimit: 1 }, null);
    const { user, token } = await makeUser(0);
    const upstream = globalThis.fetch;
    let calls = 0;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(new Response("boom", { status: 500 }));
      if (calls === 2) return Promise.reject(new TypeError("fetch failed"));
      return upstream(url, init);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await chat(request(token))).status).toBe(502); // upstream 500
      expect((await chat(request(token))).status).toBe(502); // network error
    } finally {
      vi.mocked(console.error).mockRestore();
    }
    expect(quota.aiRequestsInFlight(user.id)).toBe(0);
    expect(await prisma.usageRecord.count({ where: { userId: user.id } })).toBe(0);
    expect((await chat(request(token))).status).toBe(200);
    expect(quota.aiRequestsInFlight(user.id)).toBe(0);
    expect((await chat(request(token))).status).toBe(429);
  });

  it("raising the limit lets the user continue right away", async () => {
    await settings.updateSiteSettings({ aiDailyRequestLimit: 1 }, null);
    const { user, token } = await makeUser(0);
    await seedUsage(user.id, new Date(), 1);
    expect((await chat(request(token))).status).toBe(429);
    await settings.updateSiteSettings({ aiDailyRequestLimit: 3 }, null);
    expect((await chat(request(token))).status).toBe(200);
  });
});

describe("per-user burst limit", () => {
  async function exhaust(token: string) {
    // Unknown model: 400 before any upstream call, but each request still counts.
    for (let i = 0; i < 60; i++) {
      const res = await chat(request(token, { model: "no-such-model" }));
      expect(res.status).toBe(400);
    }
  }

  it.each([true, false])("allows 60 requests a minute per user (credits on: %s), then 429 rate_limited", async (creditsEnabled) => {
    await settings.updateSiteSettings({ creditsEnabled, aiDailyRequestLimit: 0 }, null);
    const { token } = await makeUser(100);
    await exhaust(token);
    const res = await chat(request(token));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(upstreamCalls).toHaveLength(0);
    const other = await makeUser(100);
    expect((await chat(request(other.token))).status).toBe(200);
  });
});
