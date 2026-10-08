// Brevo SMTP settings are internal SiteSetting data. Only the SMTP key is
// encrypted; admin readers receive public fields and a presence flag.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import { prisma } from "./db";
import { getConfig } from "./env";
import { HttpError } from "./http";
import { BREVO_SMTP_HOST, brevoSettingsSchema, type BrevoSettingsForAdmin, type BrevoSettingsInput } from "./brevo-settings-shared";

export type BrevoSmtpSettings = {
  enabled: boolean;
  senderEmail: string;
  senderName: string;
  smtpLogin: string;
  smtpPort: 587 | 465;
  smtpKey: string | null;
};

type MailSettingsErrorCode = "brevo_configuration_invalid" | "brevo_connection_failed" | "brevo_secret_unavailable";
export class MailSettingsError extends HttpError {
  constructor(code: MailSettingsErrorCode) {
    const messages: Record<MailSettingsErrorCode, string> = {
      brevo_configuration_invalid: "Enter valid Brevo SMTP settings and an SMTP key.",
      brevo_connection_failed: "Could not verify the Brevo SMTP connection. Check the settings and try again.",
      brevo_secret_unavailable: "The saved SMTP key is unavailable. Restore the server encryption key or enter a new SMTP key.",
    };
    super(code === "brevo_configuration_invalid" ? 400 : 503, code, messages[code]);
    this.name = "MailSettingsError";
  }
}

const SETTING_KEY = "brevoEmail";
const CACHE_TTL_MS = 10_000;
const AAD = Buffer.from("FaamOffice:SiteSetting:brevoEmail:smtpKey:v1", "utf8");
const encryptedKeySchema = z.strictObject({
  iv: z.string().max(32),
  tag: z.string().max(32),
  ciphertext: z.string().min(1).max(12_000),
});
type EncryptedKey = z.infer<typeof encryptedKeySchema>;
type StoredSettings = Omit<BrevoSettingsInput, "smtpKey"> & { version: 1; encryptedSmtpKey: EncryptedKey | null };
const storedSchema = z.strictObject({
  version: z.literal(1),
  enabled: z.boolean(),
  senderEmail: z.string(),
  senderName: z.string(),
  smtpLogin: z.string(),
  smtpPort: z.union([z.literal(587), z.literal(465)]),
  encryptedSmtpKey: encryptedKeySchema.nullable(),
});
let cached: { settings: StoredSettings | null; expiresAt: number } | null = null;

export function clearBrevoSettingsCache(): void {
  cached = null;
}

function parseInput(input: unknown): BrevoSettingsInput {
  const parsed = brevoSettingsSchema.safeParse(input);
  if (!parsed.success) throw new MailSettingsError("brevo_configuration_invalid");
  return parsed.data;
}

function publicFields(settings: Pick<BrevoSettingsInput, "enabled" | "senderEmail" | "senderName" | "smtpLogin" | "smtpPort">) {
  return {
    enabled: settings.enabled,
    senderEmail: settings.senderEmail,
    senderName: settings.senderName,
    smtpLogin: settings.smtpLogin,
    smtpPort: settings.smtpPort,
  };
}

async function loadStored(useCache = true): Promise<StoredSettings | null> {
  if (useCache && cached && cached.expiresAt > Date.now()) return cached.settings;
  const row = await prisma.siteSetting.findUnique({ where: { key: SETTING_KEY } });
  let settings: StoredSettings | null = null;
  if (row) {
    try {
      const stored = storedSchema.parse(JSON.parse(row.value));
      settings = { ...publicFields(parseInput(publicFields(stored))), version: 1, encryptedSmtpKey: stored.encryptedSmtpKey };
    } catch {
      // An unreadable saved configuration must not silently use environment credentials.
      throw new MailSettingsError("brevo_configuration_invalid");
    }
  }
  if (useCache) cached = { settings, expiresAt: Date.now() + CACHE_TTL_MS };
  return settings;
}

function masterKey(): Buffer {
  const encoded = process.env.FAAMOFFICE_MAIL_SETTINGS_KEY?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new MailSettingsError("brevo_secret_unavailable");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new MailSettingsError("brevo_secret_unavailable");
  return key;
}

function encryptKey(key: string): EncryptedKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function decodeBase64(value: string, bytes?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (bytes !== undefined && decoded.length !== bytes)) {
    throw new MailSettingsError("brevo_secret_unavailable");
  }
  return decoded;
}

function decryptKey(encrypted: EncryptedKey): string {
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), decodeBase64(encrypted.iv, 12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(decodeBase64(encrypted.tag, 16));
    const key = Buffer.concat([decipher.update(decodeBase64(encrypted.ciphertext)), decipher.final()]).toString("utf8");
    const parsed = brevoSettingsSchema.shape.smtpKey.safeParse(key);
    if (!parsed.success || !parsed.data) throw new MailSettingsError("brevo_secret_unavailable");
    return parsed.data;
  } catch {
    throw new MailSettingsError("brevo_secret_unavailable");
  }
}

function environmentSettings(): BrevoSmtpSettings | null {
  const { smtp } = getConfig();
  if (!smtp || smtp.host.toLowerCase() !== BREVO_SMTP_HOST) return null;
  const from = smtp.from.trim();
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(from);
  const email = (match?.[2] ?? from).trim();
  const name = (match?.[1] ?? "FaamOffice").trim().replace(/^"(.*)"$/, "$1");
  const text = (value: string, max: number) => value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : "";
  const senderEmail = z.email().safeParse(email).success ? email : "";
  const senderName = text(name, 100);
  const smtpLogin = text(smtp.user ?? "", 254);
  const key = brevoSettingsSchema.shape.smtpKey.safeParse(smtp.pass ?? "");
  const smtpKey = key.success ? key.data ?? null : null;
  return { enabled: Boolean(senderEmail && senderName && smtpLogin && smtpKey), senderEmail, senderName, smtpLogin, smtpPort: smtp.port === 465 ? 465 : 587, smtpKey };
}

export async function getBrevoSettingsForAdmin(): Promise<BrevoSettingsForAdmin> {
  const stored = await loadStored();
  if (stored) return { ...publicFields(stored), hasSmtpKey: stored.encryptedSmtpKey !== null, source: "stored" };
  const environment = environmentSettings();
  if (environment) return { ...publicFields(environment), hasSmtpKey: environment.smtpKey !== null, source: "environment" };
  return { enabled: false, senderEmail: "", senderName: "", smtpLogin: "", smtpPort: 587, hasSmtpKey: false, source: "none" };
}

export async function getBrevoMailRuntime(): Promise<BrevoSmtpSettings | null> {
  const stored = await loadStored();
  if (!stored) return null;
  if (!stored.enabled) return { ...publicFields(stored), smtpKey: null };
  if (!stored.encryptedSmtpKey) throw new MailSettingsError("brevo_secret_unavailable");
  // Cache encrypted data, decrypt per call so a changed/missing master key cannot
  // be masked by a cached plaintext credential.
  return { ...publicFields(stored), smtpKey: decryptKey(stored.encryptedSmtpKey) };
}

function candidateKey(input: BrevoSettingsInput, stored: StoredSettings | null): string | null {
  if (input.smtpKey) return input.smtpKey;
  if (stored?.encryptedSmtpKey) return decryptKey(stored.encryptedSmtpKey);
  return environmentSettings()?.smtpKey ?? null;
}

async function verifyConnection(settings: BrevoSmtpSettings): Promise<void> {
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  try {
    transport = nodemailer.createTransport({
      host: BREVO_SMTP_HOST,
      port: settings.smtpPort,
      secure: settings.smtpPort === 465,
      requireTLS: settings.smtpPort === 587,
      auth: { user: settings.smtpLogin, pass: settings.smtpKey! },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: BREVO_SMTP_HOST },
    });
    if (!(await transport.verify())) throw new MailSettingsError("brevo_connection_failed");
  } catch {
    // Never attach the provider error: it may contain credentials or addresses.
    throw new MailSettingsError("brevo_connection_failed");
  } finally {
    try { transport?.close(); } catch { /* Already closed or unavailable. */ }
  }
}

export async function testBrevoSettings(input: unknown): Promise<{ ok: true }> {
  const settings = parseInput(input);
  if (!settings.enabled) return { ok: true };
  const smtpKey = candidateKey(settings, await loadStored(false));
  if (!smtpKey) throw new MailSettingsError("brevo_configuration_invalid");
  await verifyConnection({ ...publicFields(settings), smtpKey });
  return { ok: true };
}

export async function saveBrevoSettings(input: unknown, actorId: string | null): Promise<BrevoSettingsForAdmin> {
  const settings = parseInput(input);
  const stored = await loadStored(false);
  let encryptedSmtpKey = stored?.encryptedSmtpKey ?? null;
  if (settings.enabled) {
    const smtpKey = candidateKey(settings, stored);
    if (!smtpKey) throw new MailSettingsError("brevo_configuration_invalid");
    encryptedSmtpKey = encryptKey(smtpKey);
    await verifyConnection({ ...publicFields(settings), smtpKey });
  } else if (settings.smtpKey) {
    encryptedSmtpKey = encryptKey(settings.smtpKey);
  } else if (!encryptedSmtpKey) {
    const environmentKey = environmentSettings()?.smtpKey;
    if (environmentKey) encryptedSmtpKey = encryptKey(environmentKey);
  }
  const value = JSON.stringify({ version: 1, ...publicFields(settings), encryptedSmtpKey } satisfies StoredSettings);
  await prisma.siteSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value, updatedById: actorId },
    update: { value, updatedById: actorId },
  });
  clearBrevoSettingsCache();
  return getBrevoSettingsForAdmin();
}
