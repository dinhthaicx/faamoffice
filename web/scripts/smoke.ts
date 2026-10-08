// End-to-end smoke test against a RUNNING server (dev or production).
//
//   1. Start the site with Faam AI Cloud pointed at the mock upstream this
//      script starts on MOCK_UPSTREAM_PORT (default 4555):
//        FAAM_AI_UPSTREAM_BASE_URL=http://127.0.0.1:4555/v1 \
//        FAAM_AI_UPSTREAM_API_KEY=mock-upstream-key \
//        ADMIN_EMAILS=smoke-admin@faamoffice.test npm run dev
//   2. npm run smoke            (SMOKE_BASE_URL overrides SITE_URL)
//
// The script registers a user, signs in, runs the device flow (approving with
// the web session cookie), calls /api/v1/me, streams and non-streams through
// the AI proxy, and checks that usage is recorded — and charged when Faam
// credits are on, free (0 credits, daily quota) when an admin turned them off;
// it adapts to the mode the server is in. Admin checks (credit adjustment, 402,
// the Settings page and API, both credit modes, the daily limit, the public
// app config, disable/enable) run when SMOKE_ADMIN_EMAIL has ADMIN access
// (verified and allowlisted, or explicitly promoted); settings are restored afterwards.

import "./load-env";
import assert from "node:assert/strict";
import { findModel, parseModels } from "../src/lib/ai-models";
import { computeCredits } from "../src/lib/billing";
import { MOCK_TEXT, MOCK_USAGE, startMockUpstream, type MockUpstream } from "./mock-upstream";

const BASE = (process.env.SMOKE_BASE_URL || process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
const ORIGIN = new URL(BASE).origin;
const MOCK_PORT = Number(process.env.MOCK_UPSTREAM_PORT || 4555);
const ADMIN_EMAIL = (process.env.SMOKE_ADMIN_EMAIL || "smoke-admin@faamoffice.test").toLowerCase();
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || "smoke-admin-password-123";
const CLIENT_ID = "faamoffice-desktop";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
function ok(message: string) {
  passed += 1;
  console.log(`  ok ${String(passed).padStart(2, " ")}  ${message}`);
}
function section(title: string) {
  console.log(`\n${title}`);
}

// Responses are checked field by field with assertions; a loose type keeps the script readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type ApiResult = { status: number; json: Json; text: string; res: Response };

async function call(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; bearer?: string; origin?: string | null; signal?: AbortSignal } = {},
): Promise<ApiResult> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin && method !== "GET") headers.Origin = origin;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: "manual",
    signal: opts.signal,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, res };
}

function sessionCookie(res: Response): string {
  for (const raw of res.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";").map((s) => s.trim());
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (/fo_session$/.test(name) && value) {
      const lower = attrs.map((a) => a.toLowerCase());
      assert.ok(lower.includes("httponly"), "session cookie must be HttpOnly");
      assert.ok(lower.includes("samesite=lax"), "session cookie must be SameSite=Lax");
      assert.ok(lower.includes("path=/"), "session cookie must have Path=/");
      if (BASE.startsWith("https://")) assert.ok(lower.includes("secure"), "session cookie must be Secure over https");
      return `${name}=${value}`;
    }
  }
  throw new Error("no session cookie in response");
}

/** /api/v1/me fields that depend on the Faam credits mode. */
function assertCreditsShape(me: Json, creditsOn: boolean) {
  assert.equal(me.creditsEnabled, creditsOn, `expected creditsEnabled ${creditsOn}`);
  if (creditsOn) {
    assert.equal(typeof me.credits, "number");
    assert.equal(me.aiQuota, undefined, "no aiQuota while credits are on");
  } else {
    assert.ok(!("credits" in me), "credits must be hidden while credits are off");
    if (me.aiQuota !== undefined) {
      assert.equal(typeof me.aiQuota.limit, "number");
      assert.equal(typeof me.aiQuota.used, "number");
      assert.ok(Date.parse(me.aiQuota.resetsAt) > Date.now(), "aiQuota.resetsAt must be in the future");
    }
  }
}

async function login(email: string, password: string): Promise<{ status: number; cookie?: string; json: Json }> {
  const r = await call("/api/auth/login", { body: { email, password, locale: "en" } });
  return { status: r.status, json: r.json, cookie: r.status === 200 ? sessionCookie(r.res) : undefined };
}

/** Read an SSE response fully; returns the raw text plus arrival times. */
async function readStream(res: Response, abortAfterFirstContent?: AbortController) {
  assert.ok(res.body, "stream body missing");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let firstContentAt = 0;
  const start = Date.now();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (!firstContentAt && /"content":"[^"]+"/.test(text)) {
        firstContentAt = Date.now();
        if (abortAfterFirstContent) {
          abortAfterFirstContent.abort();
          break;
        }
      }
    }
  } catch (err) {
    if (!abortAfterFirstContent) throw err;
  }
  return { text, firstContentAt: firstContentAt - start, endAt: Date.now() - start };
}

async function main() {
  console.log(`FaamOffice smoke test against ${BASE}`);
  let mock: MockUpstream;
  try {
    mock = await startMockUpstream(MOCK_PORT);
  } catch (err) {
    throw new Error(`could not start the mock upstream on port ${MOCK_PORT}: ${(err as Error).message}`);
  }
  console.log(`Mock upstream on http://127.0.0.1:${mock.port}/v1`);

  try {
    // ------------------------------------------------------------------ site
    section("Site");
    const health = await call("/api/health");
    assert.equal(health.status, 200, `server not reachable/healthy at ${BASE} (status ${health.status})`);
    ok("GET /api/health → 200");
    const root = await call("/", { origin: null });
    assert.equal(root.status, 307);
    assert.match(root.res.headers.get("location") ?? "", /\/(vi|en)$/);
    ok(`GET / redirects to a locale (${root.res.headers.get("location")})`);
    const robots = await call("/robots.txt");
    assert.match(robots.text, /Disallow: \/account/);
    ok("robots.txt disallows private paths");

    // ------------------------------------------------------------------ register + login
    section("Accounts");
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const email = `smoke-${stamp}@faamoffice.test`;
    const password = `smoke-password-${stamp}`;
    const reg = await call("/api/auth/register", { body: { name: "Smoke Test", email, password, locale: "en" } });
    assert.equal(reg.status, 201, `register failed: ${reg.text}`);
    sessionCookie(reg.res);
    ok(`registered ${email}`);

    const dup = await call("/api/auth/register", { body: { name: "Again", email, password, locale: "en" } });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error, "email_taken");
    ok("duplicate registration → 409 email_taken");

    const csrf = await call("/api/auth/login", { body: { email, password, locale: "en" }, origin: "https://evil.example" });
    assert.equal(csrf.status, 403);
    assert.equal(csrf.json.error, "invalid_origin");
    ok("cross-site login (foreign Origin) → 403 invalid_origin");

    const bad = await login(email, "wrong-password-123");
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error, "invalid_credentials");
    ok("wrong password → 401 invalid_credentials");

    const session = await login(email, password);
    assert.equal(session.status, 200, `login failed: ${JSON.stringify(session.json)}`);
    const cookie = session.cookie!;
    ok("login → session cookie (HttpOnly, SameSite=Lax)");

    const account = await call("/en/account", { cookie });
    assert.equal(account.status, 200);
    assert.ok(account.text.includes(email), "account page should show the email");
    ok("GET /en/account with session → 200");

    const anon = await call("/en/account");
    assert.equal(anon.status, 307);
    assert.match(anon.res.headers.get("location") ?? "", /\/en\/login\?next=/);
    ok("GET /en/account without session → redirect to login");

    // ------------------------------------------------------------------ device flow
    section("Device flow");
    const code = await call("/api/auth/device/code", { body: { client_id: CLIENT_ID, device_name: "Smoke Test Mac" }, origin: null });
    assert.equal(code.status, 200, code.text);
    const dc = code.json;
    assert.match(dc.user_code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    assert.equal(dc.verification_uri, `${process.env.SITE_URL?.replace(/\/+$/, "") || BASE}/device`);
    assert.equal(dc.verification_uri_complete, `${dc.verification_uri}?code=${dc.user_code}`);
    assert.equal(dc.expires_in, 600);
    assert.equal(dc.interval, 5);
    ok(`POST /api/auth/device/code → user_code ${dc.user_code}`);

    const wrongClient = await call("/api/auth/device/code", { body: { client_id: "other", device_name: "x" }, origin: null });
    assert.equal(wrongClient.status, 400);
    ok("unknown client_id → 400");

    const poll = () => call("/api/auth/device/token", { body: { client_id: CLIENT_ID, device_code: dc.device_code }, origin: null });
    const p1 = await poll();
    assert.equal(p1.status, 400);
    assert.equal(p1.json.error, "authorization_pending");
    ok("poll before approval → authorization_pending");
    const p2 = await poll();
    assert.equal(p2.json.error, "slow_down");
    ok(`immediate re-poll → slow_down (interval now ${p2.json.interval}s)`);

    const devicePage = await call(`/en/device?code=${dc.user_code}`, { cookie });
    assert.equal(devicePage.status, 200);
    assert.ok(devicePage.text.includes("Smoke Test Mac"), "device page should show the device name");
    ok("GET /en/device?code=… shows the request");
    const unprefixed = await call(`/device?code=${dc.user_code}`, { origin: null });
    assert.equal(unprefixed.status, 307);
    assert.match(unprefixed.res.headers.get("location") ?? "", /\/(vi|en)\/device\?code=/);
    ok("verification_uri /device redirects to the localized page");

    const forged = await call("/api/auth/device/approve", {
      body: { user_code: dc.user_code, action: "approve" },
      cookie,
      origin: "https://evil.example",
    });
    assert.equal(forged.status, 403);
    ok("approve with foreign Origin → 403");
    const approve = await call("/api/auth/device/approve", {
      body: { user_code: dc.user_code.toLowerCase().replace("-", " "), action: "approve" },
      cookie,
    });
    assert.equal(approve.status, 200, approve.text);
    ok("approved with the web session (code typed loosely)");

    await sleep(Math.max(0, (p2.json.interval ?? 10) * 1000 - 1000 + 300));
    const p3 = await poll();
    assert.equal(p3.status, 200, p3.text);
    assert.equal(p3.json.token_type, "Bearer");
    assert.match(p3.json.access_token, /^fo_[A-Za-z0-9_-]{43}$/);
    assert.equal(p3.json.user.email, email);
    const token: string = p3.json.access_token;
    ok("poll after approval → access_token fo_…");
    const p4 = await poll();
    assert.equal(p4.json.error, "invalid_grant");
    ok("token is issued exactly once (next poll → invalid_grant)");

    // ------------------------------------------------------------------ bearer API
    section("Desktop API");
    const me = await call("/api/v1/me", { bearer: token });
    assert.equal(me.status, 200, me.text);
    assert.equal(me.json.email, email);
    assert.equal(me.json.emailVerified, false);
    assert.equal(me.json.role, "USER");
    assert.equal(typeof me.json.creditsEnabled, "boolean", "/api/v1/me must report creditsEnabled");
    const creditsOn: boolean = me.json.creditsEnabled;
    assertCreditsShape(me.json, creditsOn);
    if (creditsOn) assert.ok(me.json.credits > 0, "new account should have signup bonus credits (SIGNUP_BONUS_CREDITS > 0)");
    const userId: string = me.json.id;
    let credits: number = creditsOn ? me.json.credits : 0;
    let usedToday: number | null = me.json.aiQuota?.used ?? null;
    ok(
      creditsOn
        ? `GET /api/v1/me → Faam credits on, ${credits} credits`
        : `GET /api/v1/me → Faam credits off, ${me.json.aiQuota ? `quota ${usedToday}/${me.json.aiQuota.limit} today` : "no daily limit"}`,
    );

    /** After an AI request: charged (credits on) or recorded for free, counting toward the quota (credits off). */
    const expectRecorded = async (label: string, cost: number | "estimate") => {
      await sleep(300);
      const now = await call("/api/v1/me", { bearer: token });
      assertCreditsShape(now.json, creditsOn);
      if (creditsOn) {
        if (cost === "estimate") assert.ok(now.json.credits < credits, `${label}: should be billed (estimated)`);
        else assert.equal(now.json.credits, credits - cost, `${label}: expected ${credits} - ${cost}, got ${now.json.credits}`);
        ok(`${label}: credits ${credits} → ${now.json.credits}`);
        credits = now.json.credits;
      } else {
        if (usedToday !== null) {
          assert.equal(now.json.aiQuota.used, usedToday + 1, `${label}: the daily count should grow by one`);
          usedToday = now.json.aiQuota.used;
        }
        ok(`${label}: recorded without charge${usedToday !== null ? ` (${usedToday} today)` : ""}`);
      }
    };
    const noToken = await call("/api/v1/me");
    assert.equal(noToken.status, 401);
    assert.equal(noToken.json.error, "invalid_token");
    ok("GET /api/v1/me without token → 401 invalid_token");
    const cookieOnly = await call("/api/v1/me", { cookie });
    assert.equal(cookieOnly.status, 401);
    ok("bearer endpoints ignore cookies");

    const models = await call("/api/v1/ai/models", { bearer: token });
    assert.equal(models.status, 200, `models: ${models.text} — is FAAM_AI_UPSTREAM_BASE_URL set on the server?`);
    assert.equal(models.json.object, "list");
    const modelId: string = models.json.data[0].id;
    assert.deepEqual(Object.keys(models.json.data[0]).sort(), ["id", "object", "owned_by"]);
    assert.equal(models.json.data[0].owned_by, "faam");
    ok(`GET /api/v1/ai/models → ${models.json.data.map((m: { id: string }) => m.id).join(", ")}`);

    const localModel = findModel(parseModels(process.env.FAAM_AI_MODELS), modelId);
    assert.ok(localModel, `model ${modelId} not in this shell's FAAM_AI_MODELS; run the smoke test with the server's .env`);
    const expected = computeCredits(localModel, { promptTokens: MOCK_USAGE.prompt_tokens, completionTokens: MOCK_USAGE.completion_tokens });

    // ------------------------------------------------------------------ AI proxy (stream)
    section("Faam AI Cloud proxy");
    const tools = [{ type: "function", function: { name: "insert_text", description: "Insert text", parameters: { type: "object", properties: { text: { type: "string" } } } } }];
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const messages = [
      { role: "system", content: "You are Faam AI." },
      { role: "user", content: [{ type: "text", text: "Describe this image." }, { type: "image_url", image_url: { url: image } }] },
    ];
    const before = mock.requests.length;
    const streamRes = await fetch(`${BASE}/api/v1/ai/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages, tools, tool_choice: "auto", stream: true, max_tokens: 99_999_999 }),
    });
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get("content-type") ?? "", /text\/event-stream/);
    const streamed = await readStream(streamRes);
    assert.ok(streamed.text.includes("data: [DONE]"), "stream must end with [DONE]");
    for (const piece of MOCK_TEXT) assert.ok(streamed.text.includes(JSON.stringify(piece).slice(1, -1)), `missing chunk ${piece}`);
    assert.ok(streamed.text.includes('"tool_calls"'), "tool-call deltas must pass through");
    ok("streaming response passes chunks and tool-call deltas through");
    assert.ok(streamed.endAt - streamed.firstContentAt >= 300, `stream looks buffered (first content at ${streamed.firstContentAt}ms, end ${streamed.endAt}ms)`);
    ok(`chunks arrive incrementally (first content ${streamed.firstContentAt}ms, end ${streamed.endAt}ms)`);

    assert.equal(mock.requests.length, before + 1, "the server did not call the mock upstream — check FAAM_AI_UPSTREAM_BASE_URL");
    const sent = mock.requests[mock.requests.length - 1].body;
    assert.equal(sent.model, localModel.upstream);
    assert.deepEqual(sent.stream_options, { include_usage: true });
    assert.deepEqual(sent.tools, tools);
    assert.equal(sent.tool_choice, "auto");
    assert.deepEqual(sent.messages, messages);
    if (localModel.maxOutputTokens) assert.equal(sent.max_tokens, localModel.maxOutputTokens);
    ok(`upstream got model ${localModel.upstream}, include_usage, tools and image untouched, max_tokens capped`);

    await expectRecorded("streamed request", expected);

    const usage = await call("/api/v1/usage?limit=1", { bearer: token });
    assert.equal(usage.status, 200);
    assert.equal(usage.json.creditsEnabled, creditsOn);
    assert.equal(usage.json.items.length, 1);
    assert.equal(usage.json.items[0].model, modelId);
    assert.equal(usage.json.items[0].promptTokens, MOCK_USAGE.prompt_tokens);
    assert.equal(usage.json.items[0].completionTokens, MOCK_USAGE.completion_tokens);
    assert.equal(usage.json.items[0].credits, creditsOn ? expected : 0);
    ok(`GET /api/v1/usage records the request (${creditsOn ? `${expected} credits` : "0 credits"})`);

    // ------------------------------------------------------------------ AI proxy (non-stream)
    const plain = await call("/api/v1/ai/chat/completions", {
      bearer: token,
      origin: null,
      body: { model: modelId, messages: [{ role: "user", content: "Hi" }] },
    });
    assert.equal(plain.status, 200, plain.text);
    assert.equal(plain.json.choices[0].message.content, MOCK_TEXT.join(""));
    const sentPlain = mock.requests[mock.requests.length - 1].body;
    assert.equal(sentPlain.stream_options, undefined, "non-stream requests must not get stream_options");
    await expectRecorded("non-streaming request", expected);

    const first = await call("/api/v1/usage?limit=1", { bearer: token });
    assert.ok(first.json.nextCursor, "nextCursor expected with more items");
    const page2 = await call(`/api/v1/usage?limit=1&cursor=${first.json.nextCursor}`, { bearer: token });
    assert.equal(page2.status, 200);
    assert.equal(page2.json.items.length, 1);
    assert.equal(page2.json.items[0].id, usage.json.items[0].id, "second page should hold the older (streamed) request");
    assert.equal(page2.json.nextCursor, null);
    ok("usage pagination (limit + cursor, newest first)");

    const unknown = await call("/api/v1/ai/chat/completions", {
      bearer: token,
      origin: null,
      body: { model: "no-such-model", messages: [{ role: "user", content: "Hi" }] },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json.error, "model_not_found");
    ok("unknown model → 400 model_not_found");

    // ------------------------------------------------------------------ client disconnect aborts upstream
    const abort = new AbortController();
    const slowRes = await fetch(`${BASE}/api/v1/ai/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "[slow] write a lot" }], stream: true }),
      signal: abort.signal,
    });
    await readStream(slowRes, abort);
    const slowLog = mock.requests[mock.requests.length - 1];
    for (let i = 0; i < 30 && !slowLog.aborted; i++) await sleep(100);
    assert.equal(slowLog.aborted, true, "upstream request should be aborted when the client disconnects");
    assert.equal(slowLog.completed, false);
    ok("client disconnect aborts the upstream request");
    await expectRecorded("partial stream", "estimate");

    const dash = await call("/en/account", { cookie });
    assert.ok(dash.text.includes(modelId), "account dashboard should list usage");
    assert.ok(dash.text.includes("Smoke Test Mac"), "account dashboard should list the device");
    ok("account dashboard shows usage history and the device");

    // ------------------------------------------------------------------ admin (optional)
    section("Admin");
    let admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (admin.status === 401) {
      const r = await call("/api/auth/register", { body: { name: "Smoke Admin", email: ADMIN_EMAIL, password: ADMIN_PASSWORD, locale: "en" } });
      assert.equal(r.status, 201, r.text);
      admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    }
    const adminPage = admin.cookie ? await call(`/en/admin?q=${encodeURIComponent(email)}`, { cookie: admin.cookie }) : null;
    if (!admin.cookie || adminPage?.status !== 200) {
      console.log(`  skip  admin checks: verify and allowlist ${ADMIN_EMAIL}, or promote it with npm run make-admin`);
    } else {
      assert.ok(adminPage.text.includes(email), "admin search should find the smoke user");
      ok("admin dashboard search finds the user");
      const nonAdmin = await call(`/en/admin`, { cookie });
      assert.equal(nonAdmin.status, 404);
      ok("non-admins get 404 on /en/admin");

      const adminCookie = admin.cookie;
      const chatOnce = () =>
        call("/api/v1/ai/chat/completions", {
          bearer: token,
          origin: null,
          body: { model: modelId, messages: [{ role: "user", content: "Hi" }] },
        });
      const adjust = async (delta: number, note: string) => {
        const r = await call(`/api/admin/users/${userId}/credits`, { cookie: adminCookie, body: { delta, note } });
        assert.equal(r.status, 200, r.text);
        return r.json.balance as number;
      };
      const patchSettings = async (body: Json, method: "PATCH" | "PUT" = "PATCH") => {
        const r = await call("/api/admin/settings", { method, cookie: adminCookie, body });
        assert.equal(r.status, 200, r.text);
        return r.json.settings as Json;
      };

      // Settings page and API.
      assert.equal((await call("/en/admin/settings", { cookie: adminCookie })).status, 200);
      assert.equal((await call("/en/admin/settings", { cookie })).status, 404);
      ok("GET /en/admin/settings → 200 for admins, 404 for others");
      const forgedSettings = await call("/api/admin/settings", { method: "PATCH", cookie: adminCookie, body: {}, origin: "https://evil.example" });
      assert.equal(forgedSettings.status, 403);
      const userSettings = await call("/api/admin/settings", { method: "PATCH", cookie, body: { creditsEnabled: false } });
      assert.equal(userSettings.status, 403);
      const badLink = await call("/api/admin/settings", {
        method: "PATCH",
        cookie: adminCookie,
        body: { socialLinks: [{ platform: "facebook", url: "https://www.youtube.com/@x", enabled: true }] },
      });
      assert.equal(badLink.status, 400);
      assert.equal(badLink.json.fields["socialLinks.0.url"], "wrong_host");
      ok("settings API: foreign Origin / non-admin → 403, wrong host → 400 wrong_host");

      const original = await patchSettings({});
      assert.equal(original.creditsEnabled, creditsOn, "admin settings and /api/v1/me disagree on the credits mode");
      try {
        // Credits on: charging, 402 and refills.
        if (!creditsOn) await patchSettings({ creditsEnabled: true });
        const onMe = await call("/api/v1/me", { bearer: token });
        assertCreditsShape(onMe.json, true);
        if (onMe.json.credits !== 0) assert.equal(await adjust(-onMe.json.credits, "smoke: drain"), 0);
        ok("admin credit adjustment (−balance) → 0");
        const noReason = await call(`/api/admin/users/${userId}/credits`, { cookie: adminCookie, body: { delta: 5, note: "" } });
        assert.equal(noReason.status, 400);
        ok("adjustment without a reason → 400");

        const upstreamCalls = mock.requests.length;
        const broke = await chatOnce();
        assert.equal(broke.status, 402);
        assert.deepEqual(broke.json, {
          error: {
            message: "Your Faam AI credits are insufficient. Ask an administrator to add credits.",
            type: "insufficient_credits",
            code: "insufficient_credits",
          },
        });
        assert.equal(mock.requests.length, upstreamCalls, "402 must not call the upstream");
        ok("credits on, balance ≤ 0 → 402 insufficient_credits (no upstream call)");

        const refill = await call(`/api/admin/users/${userId}/credits`, { cookie: adminCookie, body: { delta: "25", note: "smoke: refill" } });
        assert.equal(refill.json.balance, 25);
        ok("admin refill +25");

        // Credits off: no balance check, a daily limit, and the follow links in the public app config.
        const smokeLink = { id: "smoke", platform: "website", url: `${ORIGIN.startsWith("https://") ? ORIGIN : "https://faamoffice.example"}/smoke`, label: "Smoke", enabled: true };
        await patchSettings({ creditsEnabled: false, aiDailyRequestLimit: 1_000_000, socialLinks: [...original.socialLinks, smokeLink] });
        const offMe = await call("/api/v1/me", { bearer: token });
        assertCreditsShape(offMe.json, false);
        const used: number = offMe.json.aiQuota.used;
        await patchSettings({ aiDailyRequestLimit: used + 1 });
        assert.equal(await adjust(-25, "smoke: drain while credits are off"), 0);
        const free = await chatOnce();
        assert.equal(free.status, 200, `credits off must not check the balance: ${free.text}`);
        ok("credits off: a user with 0 credits is served");
        await sleep(300);
        const after = await call("/api/v1/me", { bearer: token });
        assert.deepEqual([after.json.aiQuota.used, after.json.aiQuota.limit], [used + 1, used + 1]);
        const capped = await chatOnce();
        assert.equal(capped.status, 429, capped.text);
        assert.equal(capped.json.error.code, "daily_limit_reached");
        assert.ok(Number(capped.res.headers.get("retry-after")) > 0, "Retry-After until the next local midnight");
        ok(`daily limit reached → 429 daily_limit_reached (Retry-After ${capped.res.headers.get("retry-after")} s)`);
        const config = await call("/api/v1/app/config", { origin: null });
        assert.equal(config.status, 200);
        assert.equal(config.res.headers.get("access-control-allow-origin"), "*");
        assert.ok(
          config.json.socials.some((l: Json) => l.id === "smoke" && l.platform === "website" && l.label === "Smoke"),
          "the saved social link must be listed by /api/v1/app/config",
        );
        ok("GET /api/v1/app/config lists the enabled social links");
        assert.equal(await adjust(25, "smoke: refill"), 25);
      } finally {
        await patchSettings(original, "PUT");
        ok(`settings restored (Faam credits ${original.creditsEnabled ? "on" : "off"})`);
      }

      const disable = await call(`/api/admin/users/${userId}/status`, { cookie: adminCookie, body: { disabled: true } });
      assert.equal(disable.status, 200);
      assert.equal((await call("/api/v1/me", { bearer: token })).status, 401);
      const disabledLogin = await login(email, password);
      assert.equal(disabledLogin.status, 403);
      assert.equal(disabledLogin.json.error, "account_disabled");
      assert.equal((await call("/en/account", { cookie })).status, 307, "disabled user's session must stop working");
      ok("disabled user: tokens → 401, login → 403, sessions dropped");
      const enable = await call(`/api/admin/users/${userId}/status`, { cookie: adminCookie, body: { disabled: false } });
      assert.equal(enable.status, 200);
      assert.equal((await call("/api/v1/me", { bearer: token })).status, 200);
      ok("re-enabled user: token works again");
    }

    // ------------------------------------------------------------------ sign out
    section("Sign out");
    const out = await call("/api/v1/logout", { bearer: token, body: {}, origin: null });
    assert.equal(out.status, 204);
    const after = await call("/api/v1/me", { bearer: token });
    assert.equal(after.status, 401);
    ok("POST /api/v1/logout → 204, token revoked");

    console.log(`\nAll ${passed} smoke checks passed.`);
  } finally {
    await mock.close();
  }
}

main().catch((err) => {
  console.error(`\nSMOKE TEST FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
