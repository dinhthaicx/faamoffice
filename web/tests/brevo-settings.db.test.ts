// Internal SMTP settings against a throwaway SQLite database. SMTP verify is
// mocked and no test sends mail, reads a user key, or contacts Brevo.

import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BREVO_SMTP_HOST, brevoSettingsSchema, type BrevoSettingsInput } from "@/lib/brevo-settings-shared";

const smtp = vi.hoisted(() => ({
  verify: vi.fn<() => Promise<boolean>>(),
  close: vi.fn(),
  sendMail: vi.fn(),
  createTransport: vi.fn<(settings: Record<string, unknown>) => unknown>(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: smtp.createTransport } }));

type Db = typeof import("@/lib/db");
type Settings = typeof import("@/lib/brevo-settings");
const MASTER_KEY = Buffer.alloc(32, 41).toString("base64");
const SMTP_KEY = "test-only-brevo-smtp-key";
let dir = "";
let prisma: Db["prisma"];
let settings: Settings;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "faam-web-brevo-settings-"));
  const file = join(dir, "test.db");
  const db = new Database(file);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((n) => !n.endsWith(".toml")).sort()) {
    db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  vi.stubEnv("DATABASE_URL", `file:${file}`);
  delete (globalThis as { __faamPrisma?: unknown }).__faamPrisma;
  ({ prisma } = await import("@/lib/db"));
  settings = await import("@/lib/brevo-settings");
});

beforeEach(async () => {
  vi.stubEnv("SITE_URL", "https://faam.test");
  vi.stubEnv("FAAMOFFICE_MAIL_SETTINGS_KEY", MASTER_KEY);
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("SMTP_PORT", "587");
  vi.stubEnv("SMTP_USER", "");
  vi.stubEnv("SMTP_PASS", "");
  vi.stubEnv("MAIL_FROM", "FaamOffice <noreply@faam.test>");
  vi.stubEnv("BREVO_API_KEY", "");
  smtp.verify.mockReset().mockResolvedValue(true);
  smtp.close.mockReset();
  smtp.sendMail.mockReset();
  smtp.createTransport.mockReset().mockImplementation(() => ({ verify: smtp.verify, close: smtp.close, sendMail: smtp.sendMail }));
  await prisma.siteSetting.deleteMany();
  settings.clearBrevoSettingsCache();
});

afterEach(() => { vi.restoreAllMocks(); });

afterAll(async () => {
  await prisma?.$disconnect();
  vi.unstubAllEnvs();
  delete (globalThis as { __faamPrisma?: unknown }).__faamPrisma;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const input = (extra: Partial<BrevoSettingsInput> = {}): BrevoSettingsInput => ({
  enabled: true,
  senderEmail: "noreply@faam.test",
  senderName: "FaamOffice",
  smtpLogin: "test-account@smtp-brevo.com",
  smtpPort: 587,
  smtpKey: SMTP_KEY,
  ...extra,
});

function brevoEnvironment(host = BREVO_SMTP_HOST) {
  vi.stubEnv("SMTP_HOST", host);
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("SMTP_USER", "environment-login@smtp-brevo.com");
  vi.stubEnv("SMTP_PASS", "test-only-environment-key");
  vi.stubEnv("MAIL_FROM", "Configured sender <sender@faam.test>");
}

function row() {
  return prisma.siteSetting.findUniqueOrThrow({ where: { key: "brevoEmail" } });
}

async function stored() {
  return JSON.parse((await row()).value) as {
    version: number; enabled: boolean; senderEmail: string;
    encryptedSmtpKey: { iv: string; tag: string; ciphertext: string } | null;
  };
}

describe("Brevo settings contract", () => {
  it("has empty defaults and leaves runtime fallback to the mailer when no row exists", async () => {
    expect(await settings.getBrevoSettingsForAdmin()).toEqual({
      enabled: false, senderEmail: "", senderName: "", smtpLogin: "", smtpPort: 587, hasSmtpKey: false, source: "none",
    });
    expect(await settings.getBrevoMailRuntime()).toBeNull();
  });

  it("rejects arbitrary hosts, unsafe TLS options, control characters, long keys and incomplete enabled fields", () => {
    for (const candidate of [
      { ...input(), smtpHost: "attacker.example" },
      { ...input(), requireTLS: false },
      { ...input(), rejectUnauthorized: false },
      input({ senderEmail: "" }), input({ senderName: "" }), input({ smtpLogin: "" }),
      input({ senderEmail: "bad-address" }), input({ senderName: "\nFaamOffice" }),
      input({ smtpLogin: "login\r\nAUTH" }), input({ smtpKey: "\ntest-key" }),
      input({ smtpKey: "x".repeat(2049) }), { ...input(), smtpPort: 25 },
    ]) {
      expect(brevoSettingsSchema.safeParse(candidate).success).toBe(false);
    }
    expect(brevoSettingsSchema.parse(input({ smtpKey: "   " })).smtpKey).toBeUndefined();
    expect(brevoSettingsSchema.safeParse(input({ enabled: false, senderEmail: "", senderName: "", smtpLogin: "", smtpKey: "" })).success).toBe(true);
  });

  it("seeds public fields only from the fixed Brevo SMTP environment", async () => {
    brevoEnvironment();
    const publicSettings = await settings.getBrevoSettingsForAdmin();
    expect(publicSettings).toEqual({
      enabled: true, senderEmail: "sender@faam.test", senderName: "Configured sender",
      smtpLogin: "environment-login@smtp-brevo.com", smtpPort: 465, hasSmtpKey: true, source: "environment",
    });
    expect(JSON.stringify(publicSettings)).not.toContain("test-only-environment-key");
    expect(await settings.getBrevoMailRuntime()).toBeNull();
    vi.stubEnv("SMTP_HOST", "smtp.other-provider.example");
    expect(await settings.getBrevoSettingsForAdmin()).toMatchObject({ source: "none", hasSmtpKey: false, smtpLogin: "", senderEmail: "" });
  });
});

describe("SMTP verification", () => {
  it.each([587, 465] as const)("uses the fixed host and secure settings on port %s, without sending mail or saving", async (smtpPort) => {
    expect(await settings.testBrevoSettings(input({ smtpPort }))).toEqual({ ok: true });
    expect(smtp.createTransport).toHaveBeenCalledWith({
      host: BREVO_SMTP_HOST, port: smtpPort, secure: smtpPort === 465, requireTLS: smtpPort === 587,
      auth: { user: input().smtpLogin, pass: SMTP_KEY },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: BREVO_SMTP_HOST },
    });
    expect(smtp.verify).toHaveBeenCalledTimes(1);
    expect(smtp.close).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(await prisma.siteSetting.count()).toBe(0);
  });

  it("does not test SMTP when disabled", async () => {
    await expect(settings.testBrevoSettings(input({ enabled: false, smtpKey: undefined }))).resolves.toEqual({ ok: true });
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it("requires an SMTP key and only reuses environment keys belonging to Brevo", async () => {
    brevoEnvironment("smtp.other-provider.example");
    await expect(settings.testBrevoSettings(input({ smtpKey: "" }))).rejects.toMatchObject({ code: "brevo_configuration_invalid" });
    expect(smtp.createTransport).not.toHaveBeenCalled();
    vi.stubEnv("SMTP_HOST", BREVO_SMTP_HOST);
    await settings.testBrevoSettings(input({ smtpKey: "" }));
    expect(smtp.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({
      auth: { user: input().smtpLogin, pass: "test-only-environment-key" },
    }));
  });

  it("returns sanitized connection errors and leaves settings untouched", async () => {
    await settings.saveBrevoSettings(input(), "admin-id");
    const previous = (await row()).value;
    smtp.verify.mockRejectedValueOnce(new Error(`provider error contains ${SMTP_KEY}`));
    await expect(settings.saveBrevoSettings(input({ senderName: "Changed" }), "another-admin")).rejects.toMatchObject({
      status: 503, code: "brevo_connection_failed",
    });
    expect((await row()).value).toBe(previous);
    expect((await row()).updatedById).toBe("admin-id");
    smtp.verify.mockResolvedValueOnce(false);
    await expect(settings.testBrevoSettings(input())).rejects.toMatchObject({ code: "brevo_connection_failed" });
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });
});

describe("encrypted storage and runtime selection", () => {
  it("encrypts at rest, returns no ciphertext/key and records the saving admin", async () => {
    const publicSettings = await settings.saveBrevoSettings(input(), "admin-id");
    expect(publicSettings).toEqual({
      enabled: true, senderEmail: "noreply@faam.test", senderName: "FaamOffice", smtpLogin: input().smtpLogin,
      smtpPort: 587, hasSmtpKey: true, source: "stored",
    });
    expect(Object.keys(publicSettings)).toEqual(["enabled", "senderEmail", "senderName", "smtpLogin", "smtpPort", "hasSmtpKey", "source"]);
    expect(JSON.stringify(publicSettings)).not.toContain(SMTP_KEY);
    const saved = await row();
    expect(saved.updatedById).toBe("admin-id");
    expect(saved.value).not.toContain(SMTP_KEY);
    expect(saved.value).not.toContain(MASTER_KEY);
    expect((await stored()).encryptedSmtpKey).toEqual({ iv: expect.any(String), tag: expect.any(String), ciphertext: expect.any(String) });
    expect(await settings.getBrevoMailRuntime()).toEqual({ ...input(), smtpKey: SMTP_KEY });
    expect(smtp.verify).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("preserves the encrypted key when disabled, and restores it for blank-key re-enabling", async () => {
    await settings.saveBrevoSettings(input(), "admin-id");
    const encrypted = (await stored()).encryptedSmtpKey;
    await settings.saveBrevoSettings(input({ enabled: false, smtpKey: "" }), "admin-id");
    expect((await stored()).encryptedSmtpKey).toEqual(encrypted);
    expect(await settings.getBrevoMailRuntime()).toMatchObject({ enabled: false, smtpKey: null });
    expect(await settings.getBrevoSettingsForAdmin()).toMatchObject({ enabled: false, hasSmtpKey: true, source: "stored" });
    expect(smtp.verify).toHaveBeenCalledTimes(1);
    await settings.saveBrevoSettings(input({ smtpKey: "" }), "admin-id");
    expect((await settings.getBrevoMailRuntime())?.smtpKey).toBe(SMTP_KEY);
    expect(smtp.verify).toHaveBeenCalledTimes(2);
  });

  it("allows saving a blank disabled configuration without a master key", async () => {
    vi.stubEnv("FAAMOFFICE_MAIL_SETTINGS_KEY", "");
    await settings.saveBrevoSettings(input({ enabled: false, senderEmail: "", senderName: "", smtpLogin: "", smtpKey: "" }), null);
    expect(await settings.getBrevoMailRuntime()).toEqual({ enabled: false, senderEmail: "", senderName: "", smtpLogin: "", smtpPort: 587, smtpKey: null });
    expect((await stored()).encryptedSmtpKey).toBeNull();
    expect(smtp.verify).not.toHaveBeenCalled();
  });

  it("can import a Brevo environment key and never exposes or uses another provider's key", async () => {
    brevoEnvironment();
    await settings.saveBrevoSettings(input({ smtpKey: undefined }), null);
    expect((await settings.getBrevoMailRuntime())?.smtpKey).toBe("test-only-environment-key");
    expect((await row()).value).not.toContain("test-only-environment-key");
    expect(await settings.getBrevoSettingsForAdmin()).toMatchObject({ source: "stored", hasSmtpKey: true });
    await prisma.siteSetting.deleteMany();
    settings.clearBrevoSettingsCache();
    vi.stubEnv("SMTP_HOST", "smtp.other-provider.example");
    await expect(settings.saveBrevoSettings(input({ smtpKey: "" }), null)).rejects.toMatchObject({ code: "brevo_configuration_invalid" });
    expect(await prisma.siteSetting.count()).toBe(0);
  });

  it.each(["", "bad-base64-key", Buffer.alloc(31).toString("base64")])("rejects an unavailable master key before storing or contacting SMTP", async (key) => {
    vi.stubEnv("FAAMOFFICE_MAIL_SETTINGS_KEY", key);
    await expect(settings.saveBrevoSettings(input(), null)).rejects.toMatchObject({ code: "brevo_secret_unavailable" });
    expect(await prisma.siteSetting.count()).toBe(0);
    expect(smtp.verify).not.toHaveBeenCalled();
  });

  it("fails closed when the master key changes, even with cached settings and usable environment credentials", async () => {
    await settings.saveBrevoSettings(input(), null);
    expect((await settings.getBrevoMailRuntime())?.smtpKey).toBe(SMTP_KEY);
    brevoEnvironment();
    vi.stubEnv("FAAMOFFICE_MAIL_SETTINGS_KEY", Buffer.alloc(32, 42).toString("base64"));
    await expect(settings.getBrevoMailRuntime()).rejects.toMatchObject({ code: "brevo_secret_unavailable" });
    await expect(settings.testBrevoSettings(input({ smtpKey: "" }))).rejects.toMatchObject({ code: "brevo_secret_unavailable" });
    expect(await settings.getBrevoSettingsForAdmin()).toMatchObject({ source: "stored", hasSmtpKey: true });
    // Disabling preserves the ciphertext and works without decrypting it.
    await settings.saveBrevoSettings(input({ enabled: false, smtpKey: "" }), null);
    expect(await settings.getBrevoMailRuntime()).toMatchObject({ enabled: false, smtpKey: null });
  });

  it("rejects a tampered encrypted key and permits replacing it explicitly", async () => {
    await settings.saveBrevoSettings(input(), null);
    const saved = await stored();
    saved.encryptedSmtpKey!.tag = Buffer.alloc(16).toString("base64");
    await prisma.siteSetting.update({ where: { key: "brevoEmail" }, data: { value: JSON.stringify(saved) } });
    settings.clearBrevoSettingsCache();
    await expect(settings.getBrevoMailRuntime()).rejects.toMatchObject({ code: "brevo_secret_unavailable" });
    await settings.saveBrevoSettings(input({ smtpKey: "replacement-test-key" }), null);
    expect((await settings.getBrevoMailRuntime())?.smtpKey).toBe("replacement-test-key");
  });

  it("rejects malformed stored data instead of falling back to environment SMTP", async () => {
    brevoEnvironment();
    await prisma.siteSetting.create({ data: { key: "brevoEmail", value: JSON.stringify({ enabled: true, smtpKey: "plaintext-key" }) } });
    await expect(settings.getBrevoMailRuntime()).rejects.toMatchObject({ code: "brevo_configuration_invalid" });
  });

  it("re-verifies enabled saves and clears the runtime cache after a successful switch", async () => {
    expect(await settings.getBrevoMailRuntime()).toBeNull();
    await settings.testBrevoSettings(input());
    await settings.saveBrevoSettings(input(), null);
    expect(smtp.verify).toHaveBeenCalledTimes(2);
    expect((await settings.getBrevoMailRuntime())?.senderEmail).toBe("noreply@faam.test");
    await settings.saveBrevoSettings(input({ senderEmail: "new-sender@faam.test", smtpPort: 465, smtpKey: "second-test-key" }), null);
    expect(await settings.getBrevoMailRuntime()).toMatchObject({ senderEmail: "new-sender@faam.test", smtpPort: 465, smtpKey: "second-test-key" });
    expect(smtp.verify).toHaveBeenCalledTimes(3);
  });

  it("expires encrypted configuration cache after ten seconds", async () => {
    await settings.saveBrevoSettings(input(), null);
    const saved = await stored();
    saved.enabled = false;
    await prisma.siteSetting.update({ where: { key: "brevoEmail" }, data: { value: JSON.stringify(saved) } });
    expect((await settings.getBrevoMailRuntime())?.enabled).toBe(true);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_001);
    expect(await settings.getBrevoMailRuntime()).toMatchObject({ enabled: false, smtpKey: null });
  });
});
