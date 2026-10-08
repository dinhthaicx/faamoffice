import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailDeliveryError } from "@/lib/mail";
import { POST } from "@/app/api/auth/register/route";

const users = vi.hoisted(() => ({ register: vi.fn(), sendVerification: vi.fn() }));
const sessions = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
const limits = vi.hoisted(() => ({ register: vi.fn() }));

// Keep the real validation schemas and request guards, but never touch a real
// database, session cookie, provider or network connection.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/brevo-settings", () => ({ getBrevoMailRuntime: async () => null }));
vi.mock("@/lib/users", async () => ({
  ...(await vi.importActual<typeof import("@/lib/users")>("@/lib/users")),
  registerUser: users.register,
  sendVerificationEmail: users.sendVerification,
}));
vi.mock("@/lib/session", () => ({ createSession: sessions.create, getSession: sessions.get }));
vi.mock("@/lib/rate-limit", () => ({ limiters: () => ({ register: { check: limits.register } }) }));

const SITE = "https://faamoffice.example.test";
const INPUT = {
  name: "Test User",
  email: "unit-register@example.test",
  password: "registration-unit-password",
  locale: "vi",
};
const USER = { id: "registered-unit-user", name: INPUT.name, email: INPUT.email };
const UNSAFE_NEXT = [
  "https://foreign.example.test",
  "//foreign.example.test",
  "/\\foreign.example.test",
  "/vi/account\r\nLocation: https://foreign.example.test",
  "/\t/foreign.example.test",
];

beforeEach(() => {
  vi.stubEnv("SITE_URL", SITE);
  vi.clearAllMocks();
  users.register.mockReset().mockResolvedValue(USER);
  users.sendVerification.mockReset().mockResolvedValue(undefined);
  sessions.create.mockReset().mockResolvedValue(undefined);
  sessions.get.mockReset().mockResolvedValue(null);
  limits.register.mockReset().mockReturnValue({ ok: true, retryAfter: 0 });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No network calls are allowed in registration tests")));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function register(body: unknown = INPUT, origin: string | null = SITE) {
  return POST(new Request(`${SITE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

function expectNoAccountActions() {
  expect(users.register).not.toHaveBeenCalled();
  expect(users.sendVerification).not.toHaveBeenCalled();
  expect(sessions.create).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

describe("registration and verification email delivery", () => {
  it.each(["vi", "en"])("registers an anonymous visitor and establishes a session with a %s redirect", async (locale) => {
    const response = await register({ ...INPUT, locale });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      verificationEmailSent: true,
      redirect: `/${locale}/account?welcome=1`,
    });
    expect(users.register).toHaveBeenCalledWith({ ...INPUT, locale });
    expect(users.register).toHaveBeenCalledTimes(1);
    expect(users.sendVerification).toHaveBeenCalledWith(USER, locale);
    expect(users.sendVerification).toHaveBeenCalledTimes(1);
    expect(sessions.create).toHaveBeenCalledWith(USER.id, expect.any(Request));
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(sessions.get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["vi", "en"])("keeps the new account and session when its %s verification email is unavailable", async (locale) => {
    users.sendVerification.mockRejectedValue(new MailDeliveryError());
    const response = await register({ ...INPUT, locale });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      verificationEmailSent: false,
      redirect: `/${locale}/account?welcome=1&verificationEmail=failed`,
    });
    expect(users.register).toHaveBeenCalledTimes(1);
    expect(users.sendVerification).toHaveBeenCalledTimes(1);
    expect(sessions.create).toHaveBeenCalledWith(USER.id, expect.any(Request));
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not turn an unknown registration database failure into successful registration", async () => {
    users.register.mockRejectedValue(new Error("Synthetic registration database failure"));
    const response = await register();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error", message: "Something went wrong. Please try again." });
    expect(users.register).toHaveBeenCalledTimes(1);
    expect(users.sendVerification).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("preserves an unknown verification-token database failure as a server error", async () => {
    users.sendVerification.mockRejectedValue(new Error("Synthetic verification-token database failure"));
    const response = await register();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("server_error");
    expect(users.register).toHaveBeenCalledTimes(1);
    expect(users.sendVerification).toHaveBeenCalledTimes(1);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("does not retry registration or verification when session creation fails", async () => {
    sessions.create.mockRejectedValue(new Error("Synthetic session database failure"));
    const response = await register();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("server_error");
    expect(users.register).toHaveBeenCalledTimes(1);
    expect(users.sendVerification).toHaveBeenCalledTimes(1);
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });

  it.each([null, "https://foreign.example.test"])("rejects Origin %s before parsing, rate limiting or creating an account", async (origin) => {
    const response = await register("{invalid", origin);
    expect([response.status, (await response.json()).error]).toEqual([403, "invalid_origin"]);
    expectNoAccountActions();
    expect(limits.register).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before creating an account", async () => {
    const response = await register("{invalid");
    expect([response.status, (await response.json()).error]).toEqual([400, "invalid_json"]);
    expectNoAccountActions();
  });

  it.each([
    { ...INPUT, email: "invalid-address" },
    { ...INPUT, password: "short" },
    { ...INPUT, name: "" },
    { ...INPUT, locale: "unknown" },
  ])("rejects invalid account input without creating or sending anything", async (body) => {
    const response = await register(body);
    expect([response.status, (await response.json()).error]).toEqual([400, "invalid_request"]);
    expectNoAccountActions();
  });

  it.each(UNSAFE_NEXT)("falls back to the account page for unsafe next path %s", async (next) => {
    const response = await register({ ...INPUT, next });
    expect(response.status).toBe(201);
    expect((await response.json()).redirect).toBe("/vi/account?welcome=1");
  });

  it.each(UNSAFE_NEXT)("retains the email warning and drops unsafe next path %s after delivery failure", async (next) => {
    users.sendVerification.mockRejectedValue(new MailDeliveryError());
    const response = await register({ ...INPUT, next });
    expect(response.status).toBe(201);
    expect((await response.json()).redirect).toBe("/vi/account?welcome=1&verificationEmail=failed");
  });

  it.each(["vi", "en"])("shows the %s email warning before continuing to a safe device destination", async (locale) => {
    users.sendVerification.mockRejectedValue(new MailDeliveryError());
    const next = `/${locale}/device?code=BCDF-GHJK&source=app#allow`;
    const response = await register({ ...INPUT, locale, next });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      verificationEmailSent: false,
      redirect: `/${locale}/account?welcome=1&verificationEmail=failed&next=${encodeURIComponent(next)}`,
    });
    const destination = new URL(body.redirect, SITE);
    expect(destination.pathname).toBe(`/${locale}/account`);
    expect(destination.searchParams.get("next")).toBe(next);
    expect(destination.hash).toBe("");
    expect(users.register).toHaveBeenCalledTimes(1);
    expect(users.sendVerification).toHaveBeenCalledTimes(1);
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });

  it("does not append a redundant continuation when next already points to the warning page", async () => {
    users.sendVerification.mockRejectedValue(new MailDeliveryError());
    const next = "/vi/account?welcome=1&verificationEmail=failed";
    const response = await register({ ...INPUT, next });
    expect(response.status).toBe(201);
    expect((await response.json()).redirect).toBe(next);
  });

  it("retains a legitimate same-site device authorization destination", async () => {
    const next = "/en/device?code=BCDF-GHJK";
    const response = await register({ ...INPUT, locale: "en", next });
    expect(response.status).toBe(201);
    expect((await response.json()).redirect).toBe(next);
    expect(users.register).toHaveBeenCalledTimes(1);
    expect(users.sendVerification).toHaveBeenCalledTimes(1);
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });
});
