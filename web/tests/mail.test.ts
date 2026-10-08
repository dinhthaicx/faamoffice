import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPasswordMessage, verifyEmailMessage } from "@/lib/email-templates";

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
const storedMail = vi.hoisted(() => ({ getRuntime: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: smtp.createTransport },
}));
vi.mock("@/lib/brevo-settings", () => ({ getBrevoMailRuntime: storedMail.getRuntime }));

const API_KEY = "xkeysib-unit-test-secret-only";
const RECIPIENT = "private-user@example.test";
const TOKEN = "unit-test-single-use-secret";
const LINK = `https://faamoffice.example.test/vi/reset-password?token=${TOKEN}`;
const MESSAGE = { to: RECIPIENT, ...resetPasswordMessage("vi", "Test User", LINK) };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const key of ["BREVO_API_KEY", "BREVO_SENDER_EMAIL", "BREVO_SENDER_NAME", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"]) {
    vi.stubEnv(key, "");
  }
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SITE_URL", "https://faamoffice.example.test");
  smtp.sendMail.mockReset().mockResolvedValue({ messageId: "smtp-unit-test" });
  smtp.createTransport.mockReset().mockReturnValue({ sendMail: smtp.sendMail });
  storedMail.getRuntime.mockReset().mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ messageId: "brevo-unit-test" }, { status: 201 })));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function configureBrevo() {
  vi.stubEnv("BREVO_API_KEY", API_KEY);
  vi.stubEnv("BREVO_SENDER_EMAIL", "no-reply@example.test");
  vi.stubEnv("BREVO_SENDER_NAME", "FaamOffice Test");
}

function configureSmtp() {
  vi.stubEnv("SMTP_HOST", "smtp.example.test");
  vi.stubEnv("SMTP_USER", "smtp-test-user");
  vi.stubEnv("SMTP_PASS", "smtp-unit-test-secret");
  vi.stubEnv("MAIL_FROM", "FaamOffice SMTP <smtp@example.test>");
}

function requestBody() {
  const [, init] = vi.mocked(fetch).mock.calls[0];
  return JSON.parse(String(init?.body));
}

function loggedText() {
  return JSON.stringify([
    ...vi.mocked(console.info).mock.calls,
    ...vi.mocked(console.warn).mock.calls,
    ...vi.mocked(console.error).mock.calls,
  ], (_key, value) => value instanceof Error ? { message: value.message, stack: value.stack } : value);
}

async function expectUnavailable(action: Promise<void>) {
  const settled = action.then(() => null, (failure: unknown) => failure);
  const { MailDeliveryError } = await import("@/lib/mail");
  const { HttpError } = await import("@/lib/http");
  const error = await settled;
  expect(error).toBeInstanceOf(MailDeliveryError);
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status: 503, code: "email_unavailable" });
  for (const secret of [API_KEY, RECIPIENT, TOKEN, LINK, "smtp-unit-test-secret"]) {
    expect(String(error)).not.toContain(secret);
    expect(loggedText()).not.toContain(secret);
  }
}

describe("Brevo transactional mail", () => {
  it("reads credentials from server environment variables and defaults the sender name", async () => {
    configureBrevo();
    vi.stubEnv("BREVO_SENDER_NAME", "");
    const { getConfig } = await import("@/lib/env");
    expect(getConfig().brevo).toEqual({ apiKey: API_KEY, sender: { email: "no-reply@example.test", name: "FaamOffice" } });
    vi.stubEnv("BREVO_API_KEY", "");
    expect(getConfig().brevo).toBeNull();
  });

  it("ignores public environment lookalikes rather than accepting a client-visible API key", async () => {
    vi.stubEnv("NEXT_PUBLIC_BREVO_API_KEY", "client-visible-key");
    vi.stubEnv("NEXT_PUBLIC_BREVO_SENDER_EMAIL", "public@example.test");
    const { getConfig } = await import("@/lib/env");
    expect(getConfig().brevo).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["vi", "en"] as const)("sends verification and reset templates in %s through the same transport", async (locale) => {
    configureBrevo();
    const { sendMail } = await import("@/lib/mail");
    for (const template of [verifyEmailMessage, resetPasswordMessage]) {
      const content = template(locale, "Test <User>", LINK);
      await expect(sendMail({ to: RECIPIENT, ...content })).resolves.toBeUndefined();
      const [, init] = vi.mocked(fetch).mock.calls.at(-1)!;
      expect(JSON.parse(String(init?.body))).toEqual({
        sender: { email: "no-reply@example.test", name: "FaamOffice Test" },
        to: [{ email: RECIPIENT, contactPixelTrackingConsent: false }],
        subject: content.subject,
        textContent: content.text,
        htmlContent: content.html,
      });
      expect(content.html).toContain("Test &lt;User&gt;");
      expect(content.text).toContain(LINK);
    }
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it("uses a fixed HTTPS endpoint, bounded timeout, no caching and no redirects", async () => {
    configureBrevo();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { sendMail } = await import("@/lib/mail");
    await sendMail(MESSAGE);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    const headers = new Headers(init?.headers);
    expect(headers.get("api-key")).toBe(API_KEY);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-sib-sandbox")).toBeNull();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it("validates sandbox requests using the Brevo email body header without sending through SMTP", async () => {
    configureBrevo();
    configureSmtp();
    const { sendMail } = await import("@/lib/mail");
    await sendMail(MESSAGE, { sandbox: true });
    expect(requestBody().headers).toEqual({ "X-Sib-Sandbox": "drop" });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get("x-sib-sandbox")).toBeNull();
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it("prefers configured Brevo over SMTP for ordinary account emails", async () => {
    configureBrevo();
    configureSmtp();
    const { sendMail } = await import("@/lib/mail");
    await sendMail(MESSAGE);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(requestBody()).not.toHaveProperty("headers");
  });

  it("rejects a configured key without a sender instead of silently switching providers", async () => {
    configureSmtp();
    vi.stubEnv("BREVO_API_KEY", API_KEY);
    const { getConfig } = await import("@/lib/env");
    expect(getConfig().brevo).toMatchObject({ apiKey: API_KEY, sender: { email: "" } });
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE));
    expect(fetch).not.toHaveBeenCalled();
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it.each([401, 429])("reports HTTP %i without leaking the provider response or falling back to SMTP", async (status) => {
    configureBrevo();
    configureSmtp();
    const rawMessage = `provider failure ${API_KEY} ${RECIPIENT} ${LINK}`;
    vi.mocked(fetch).mockResolvedValue(Response.json({ code: "provider-private-code", message: rawMessage }, { status }));
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE));
    expect(loggedText()).not.toContain("provider-private-code");
    expect(loggedText()).not.toContain(rawMessage);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it.each([
    ["missing message ID", () => Response.json({}, { status: 201 })],
    ["blank message ID", () => Response.json({ messageId: " " }, { status: 201 })],
    ["non-string message ID", () => Response.json({ messageId: 123 }, { status: 201 })],
    ["unexpected success status", () => Response.json({ messageId: "id" }, { status: 200 })],
    ["malformed JSON", () => new Response(`invalid ${TOKEN}`, { status: 201 })],
  ])("rejects %s rather than claiming that the account email was sent", async (_label, response) => {
    configureBrevo();
    vi.mocked(fetch).mockResolvedValue(response());
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE));
  });

  it("sanitizes network errors and does not retry a possibly accepted email", async () => {
    configureBrevo();
    configureSmtp();
    vi.mocked(fetch).mockRejectedValue(new Error(`network error ${API_KEY} ${LINK}`));
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("sanitizes an aborted request without waiting for a real network timeout", async () => {
    configureBrevo();
    const controller = new AbortController();
    controller.abort(new DOMException(`timeout ${TOKEN}`, "TimeoutError"));
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      init?.signal?.throwIfAborted();
      throw new Error("Expected the timeout signal to abort");
    });
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE));
  });
});

describe("SMTP compatibility and missing mail configuration", () => {
  const runtime = {
    enabled: true,
    senderEmail: "stored-sender@example.test",
    senderName: "FaamOffice Admin",
    smtpLogin: "123456@smtp-brevo.com",
    smtpPort: 587,
    smtpKey: "smtp-unit-test-secret",
  };

  it("uses saved Brevo SMTP settings ahead of both environment API and SMTP configuration", async () => {
    configureBrevo();
    configureSmtp();
    storedMail.getRuntime.mockResolvedValue(runtime);
    const { sendMail } = await import("@/lib/mail");
    await sendMail(MESSAGE);
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: runtime.smtpLogin, pass: runtime.smtpKey },
    }));
    expect(smtp.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: RECIPIENT,
      from: { name: runtime.senderName, address: runtime.senderEmail },
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honors an explicitly disabled saved provider without falling back to environment credentials", async () => {
    configureBrevo();
    configureSmtp();
    storedMail.getRuntime.mockResolvedValue({ ...runtime, enabled: false });
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE));
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when a saved secret cannot be decrypted", async () => {
    configureBrevo();
    configureSmtp();
    const { HttpError } = await import("@/lib/http");
    storedMail.getRuntime.mockRejectedValue(new HttpError(503, "brevo_secret_unavailable", "Email settings are unavailable."));
    const { sendMail } = await import("@/lib/mail");
    await expect(sendMail(MESSAGE)).rejects.toMatchObject({ status: 503 });
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain("smtp-unit-test-secret");
  });

  it("does not substitute an environment key when enabled saved SMTP has no usable secret", async () => {
    configureBrevo();
    configureSmtp();
    storedMail.getRuntime.mockResolvedValue({ ...runtime, smtpKey: null });
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE));
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses sandbox mode for saved SMTP even when an environment API key is available", async () => {
    configureBrevo();
    storedMail.getRuntime.mockResolvedValue(runtime);
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE, { sandbox: true }));
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends through the configured legacy SMTP transport when Brevo is absent", async () => {
    configureSmtp();
    const { sendMail } = await import("@/lib/mail");
    await expect(sendMail(MESSAGE)).resolves.toBeUndefined();
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.example.test" }));
    expect(smtp.sendMail).toHaveBeenCalledWith({ from: "FaamOffice SMTP <smtp@example.test>", ...MESSAGE });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sanitizes SMTP failures instead of reporting successful delivery", async () => {
    configureSmtp();
    smtp.sendMail.mockRejectedValue(new Error(`SMTP failed ${RECIPIENT} ${LINK} smtp-unit-test-secret`));
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses sandbox mode with only SMTP configured, so a test cannot send real mail", async () => {
    configureSmtp();
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE, { sandbox: true }));
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects missing production mail configuration without printing recovery links", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE));
    expect(fetch).not.toHaveBeenCalled();
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it.each(["development", "test"] as const)("keeps the deliberate console-only fallback in %s", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    const { sendMail } = await import("@/lib/mail");
    await expect(sendMail(MESSAGE)).resolves.toBeUndefined();
    expect(loggedText()).toContain(LINK);
    expect(fetch).not.toHaveBeenCalled();
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it("refuses sandbox mode without Brevo even in development", async () => {
    const { sendMail } = await import("@/lib/mail");
    await expectUnavailable(sendMail(MESSAGE, { sandbox: true }));
    expect(fetch).not.toHaveBeenCalled();
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });
});
