import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

type Session = { userId: string; user: { id: string; role: "USER" | "ADMIN"; disabledAt: Date | null } };
const auth = vi.hoisted(() => ({ session: null as Session | null }));
const service = vi.hoisted(() => ({ get: vi.fn(), test: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: async () => auth.session }));
vi.mock("@/lib/brevo-settings", () => ({
  getBrevoSettingsForAdmin: service.get,
  testBrevoSettings: service.test,
  saveBrevoSettings: service.save,
}));

type Handler = (req: Request) => Promise<Response>;
const SITE = "https://faamoffice.example.test";
const SECRET = "xsmtpsib-unit-test-private-key-xxxxxxxxxxxxxxxx";
const INPUT = {
  enabled: true,
  senderEmail: "no-reply@example.test",
  senderName: "FaamOffice",
  smtpLogin: "123456@smtp-brevo.com",
  smtpPort: 587,
  smtpKey: SECRET,
};
const PUBLIC_SETTINGS = {
  enabled: true,
  senderEmail: INPUT.senderEmail,
  senderName: INPUT.senderName,
  smtpLogin: INPUT.smtpLogin,
  smtpPort: INPUT.smtpPort,
  hasSmtpKey: true,
  source: "stored",
};
let get: Handler;
let patch: Handler;
let probe: Handler;

beforeAll(async () => {
  const settings = await import("@/app/api/admin/email-settings/route");
  get = settings.GET;
  patch = settings.PATCH;
  probe = (await import("@/app/api/admin/email-settings/test/route")).POST;
});

beforeEach(() => {
  auth.session = null;
  vi.stubEnv("SITE_URL", SITE);
  vi.clearAllMocks();
  service.get.mockReset().mockResolvedValue(PUBLIC_SETTINGS);
  service.test.mockReset().mockResolvedValue(undefined);
  service.save.mockReset().mockResolvedValue(PUBLIC_SETTINGS);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No network calls are allowed in admin email tests")));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function asRole(role: "USER" | "ADMIN") {
  auth.session = { userId: "admin-or-user-id", user: { id: "admin-or-user-id", role, disabledAt: null } };
}

function read() {
  return get(new Request(`${SITE}/api/admin/email-settings`));
}

function mutate(method: "PATCH" | "POST", body: unknown = INPUT, origin: string | null = SITE) {
  const path = method === "PATCH" ? "/api/admin/email-settings" : "/api/admin/email-settings/test";
  return (method === "PATCH" ? patch : probe)(new Request(`${SITE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

function expectNoServiceCalls() {
  expect(service.get).not.toHaveBeenCalled();
  expect(service.save).not.toHaveBeenCalled();
  expect(service.test).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

describe("admin email settings read", () => {
  it("requires a signed-in administrator while allowing safe reads without an Origin", async () => {
    let response = await read();
    expect([response.status, (await response.json()).error]).toEqual([401, "unauthorized"]);
    expectNoServiceCalls();

    asRole("USER");
    response = await read();
    expect([response.status, (await response.json()).error]).toEqual([403, "forbidden"]);
    expectNoServiceCalls();

    asRole("ADMIN");
    response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings: PUBLIC_SETTINGS });
    expect(service.get).toHaveBeenCalledTimes(1);
    expect(service.save).not.toHaveBeenCalled();
    expect(service.test).not.toHaveBeenCalled();
  });

  it("exposes only the public settings supplied by the store, never the SMTP key", async () => {
    asRole("ADMIN");
    const response = await read();
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text).settings).not.toHaveProperty("smtpKey");
  });
});

describe.each(["PATCH", "POST"] as const)("%s admin email settings", (method) => {
  it("checks authentication and administrator role before reading a malformed body", async () => {
    let response = await mutate(method, "{invalid");
    expect([response.status, (await response.json()).error]).toEqual([401, "unauthorized"]);
    expectNoServiceCalls();

    asRole("USER");
    response = await mutate(method, "{invalid");
    expect([response.status, (await response.json()).error]).toEqual([403, "forbidden"]);
    expectNoServiceCalls();
  });

  it.each([null, "https://foreign.example.test"])("rejects Origin %s before parsing or testing SMTP", async (origin) => {
    asRole("ADMIN");
    const response = await mutate(method, "{invalid", origin);
    expect([response.status, (await response.json()).error]).toEqual([403, "invalid_origin"]);
    expectNoServiceCalls();
  });

  it("rejects malformed JSON without testing or storing anything", async () => {
    asRole("ADMIN");
    const response = await mutate(method, "{invalid");
    expect([response.status, (await response.json()).error]).toEqual([400, "invalid_json"]);
    expectNoServiceCalls();
  });

  it.each([
    ["invalid sender", { ...INPUT, senderEmail: "invalid-address" }],
    ["invalid port", { ...INPUT, smtpPort: 25 }],
    ["boolean injection", { ...INPUT, enabled: "true" }],
    ["custom SMTP host", { ...INPUT, smtpHost: "smtp.attacker.example.test" }],
    ["custom host alias", { ...INPUT, host: "smtp.attacker.example.test" }],
    ["security override", { ...INPUT, security: "none" }],
    ["TLS override", { ...INPUT, secure: false, requireTLS: false }],
    ["sender header injection", { ...INPUT, senderName: "FaamOffice\r\nBcc:other@example.test" }],
    ["login header injection", { ...INPUT, smtpLogin: "login\nother" }],
  ])("rejects %s before testing or saving", async (_label, input) => {
    asRole("ADMIN");
    const response = await mutate(method, input);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(SECRET);
    expectNoServiceCalls();
  });
});

describe("save and test operations", () => {
  it("saves validated input with the release administrator's ID and replies without the secret", async () => {
    asRole("ADMIN");
    const response = await mutate("PATCH");
    expect(response.status).toBe(200);
    expect(service.save).toHaveBeenCalledWith(INPUT, auth.session!.userId);
    expect(service.save).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ ok: true, settings: PUBLIC_SETTINGS });
    expect(service.test).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tests the submitted SMTP settings without persisting them", async () => {
    asRole("ADMIN");
    const response = await mutate("POST");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(service.test).toHaveBeenCalledWith(INPUT);
    expect(service.test).toHaveBeenCalledTimes(1);
    expect(service.save).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
  });

  it.each(["PATCH", "POST"] as const)("returns a safe service connection error for %s", async (method) => {
    asRole("ADMIN");
    const failure = new HttpError(503, "brevo_connection_failed", "Could not connect to the email provider.");
    (method === "PATCH" ? service.save : service.test).mockRejectedValue(failure);
    const response = await mutate(method);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "brevo_connection_failed", message: failure.message });
    expect(fetch).not.toHaveBeenCalled();
    if (method === "POST") expect(service.save).not.toHaveBeenCalled();
  });
});
