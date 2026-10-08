// Account email lifecycle against a throwaway SQLite database. Mail is mocked:
// no test contacts Brevo, sends a message, or uses the production database.

import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/config";
import type { MailMessage } from "@/lib/mail";
import { sha256Hex } from "@/lib/crypto";

const mail = vi.hoisted(() => ({ send: vi.fn<(message: MailMessage) => Promise<void>>() }));
vi.mock("@/lib/mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mail")>()),
  sendMail: mail.send,
}));

type Db = typeof import("@/lib/db");
type Users = typeof import("@/lib/users");
type Passwords = typeof import("@/lib/password");
type Handler = (req: Request) => Promise<Response>;

const SITE = "https://faam.test";
const PASSWORD = "original-password-123";
const NEW_PASSWORD = "replacement-password-456";
let dir = "";
let prisma: Db["prisma"];
let users: Users;
let passwords: Passwords;
let forgot: Handler;
let DeliveryError: typeof import("@/lib/mail")["MailDeliveryError"];
let nextUser = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "faam-web-auth-email-"));
  const file = join(dir, "test.db");
  const db = new Database(file);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((n) => !n.endsWith(".toml")).sort()) {
    db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  vi.stubEnv("DATABASE_URL", `file:${file}`);
  vi.stubEnv("SITE_URL", SITE);
  vi.stubEnv("SIGNUP_BONUS_CREDITS", "25");
  delete (globalThis as { __faamPrisma?: unknown }).__faamPrisma;
  ({ prisma } = await import("@/lib/db"));
  users = await import("@/lib/users");
  passwords = await import("@/lib/password");
  forgot = (await import("@/app/api/auth/forgot-password/route")).POST;
  ({ MailDeliveryError: DeliveryError } = await import("@/lib/mail"));
});

beforeEach(async () => {
  mail.send.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("ADMIN_EMAILS", "");
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "fail_user_update"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "fail_token_delete"');
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma?.$disconnect();
  vi.unstubAllEnvs();
  delete (globalThis as { __faamPrisma?: unknown }).__faamPrisma;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function register(email = `account${++nextUser}@faam.test`) {
  return users.registerUser({ name: "Test account", email, password: PASSWORD, locale: "vi" });
}

async function seed(overrides: Partial<Pick<User, "email" | "role" | "emailVerifiedAt" | "disabledAt">> = {}) {
  return prisma.user.create({
    data: {
      email: `account${++nextUser}@faam.test`,
      name: "Test account",
      passwordHash: await passwords.hashPassword(PASSWORD),
      ...overrides,
    },
  });
}

function latestLink() {
  const message = mail.send.mock.calls.at(-1)?.[0];
  expect(message).toBeDefined();
  const match = message!.text.match(/https:\/\/faam\.test\/[^\s]+/);
  expect(match).not.toBeNull();
  const url = new URL(match![0]);
  const token = url.searchParams.get("token")!;
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(message!.html).toContain(url.href);
  return { message: message!, url, token };
}

function tokenRow(token: string) {
  return prisma.emailToken.findUniqueOrThrow({ where: { tokenHash: sha256Hex(token) } });
}

async function session(userId: string) {
  return prisma.session.create({
    data: { userId, tokenHash: sha256Hex(`session-${++nextUser}`), expiresAt: new Date(Date.now() + 60_000) },
  });
}

async function failUserUpdates() {
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "fail_user_update" BEFORE UPDATE ON "User"
    BEGIN SELECT RAISE(ABORT, 'simulated user update failure'); END
  `);
}

function forgotRequest(email: string, ip = `192.0.2.${++nextUser}`) {
  return new Request(`${SITE}/api/auth/forgot-password`, {
    method: "POST",
    headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, locale: "vi" }),
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("registration and verified admin promotion", () => {
  it("creates an unverified account and bonus independently of mail delivery", async () => {
    const user = await register();
    expect(user).toMatchObject({ role: "USER", emailVerifiedAt: null, credits: 25 });
    expect(mail.send).not.toHaveBeenCalled();
    expect(await prisma.emailToken.count()).toBe(0);
    expect(await prisma.creditTransaction.findMany({ where: { userId: user.id } })).toEqual([
      expect.objectContaining({ delta: 25, balanceAfter: 25, reason: "signup_bonus" }),
    ]);
    await expect(register(user.email)).rejects.toMatchObject({ status: 409, code: "email_taken" });
  });

  it("does not promote an allowlisted email until it has been verified", async () => {
    vi.stubEnv("ADMIN_EMAILS", "ADMIN@faam.test");
    const user = await register("admin@faam.test");
    expect(user.role).toBe("USER");
    expect((await users.authenticateUser(user.email, PASSWORD)).role).toBe("USER");
    await users.sendVerificationEmail(user, "vi");
    expect(await users.verifyEmailToken(latestLink().token)).toBe(true);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      role: "ADMIN", emailVerifiedAt: expect.any(Date),
    });
  });

  it("promotes verified allowlisted users at login and preserves existing admins", async () => {
    vi.stubEnv("ADMIN_EMAILS", "verified@faam.test");
    const verified = await seed({ email: "verified@faam.test", emailVerifiedAt: new Date() });
    expect((await users.authenticateUser(verified.email, PASSWORD)).role).toBe("ADMIN");
    const existingAdmin = await seed({ role: "ADMIN" });
    expect((await users.authenticateUser(existingAdmin.email, PASSWORD)).role).toBe("ADMIN");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: existingAdmin.id } })).emailVerifiedAt).toBeNull();
  });
});

describe("email verification", () => {
  it.each<Locale>(["vi", "en"])("sends a localized %s link with a hashed token and a 24-hour lifetime", async (locale) => {
    const user = await seed();
    const before = Date.now();
    await users.sendVerificationEmail(user, locale);
    const { message, url, token } = latestLink();
    expect(message.to).toBe(user.email);
    expect(url.pathname).toBe(`/${locale}/verify-email`);
    expect(message.subject).toBe(locale === "vi" ? "Xác nhận email tài khoản FaamOffice" : "Confirm your FaamOffice email");
    const row = await tokenRow(token);
    expect(row).toMatchObject({ userId: user.id, kind: "verify", tokenHash: sha256Hex(token), usedAt: null });
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + users.VERIFY_TOKEN_TTL_MS);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + users.VERIFY_TOKEN_TTL_MS);
    expect(row.tokenHash).not.toContain(token);
    expect(await users.verifyEmailToken(token)).toBe(true);
    const verifiedAt = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt;
    expect(verifiedAt).toBeInstanceOf(Date);
    expect((await tokenRow(token)).usedAt).toBeInstanceOf(Date);
    expect(await users.verifyEmailToken(token)).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toEqual(verifiedAt);
  });

  it("rejects missing, unknown, oversized, wrong-kind and expired links without verifying", async () => {
    const user = await seed();
    await users.requestPasswordReset(user.email, "vi");
    const reset = latestLink().token;
    for (const token of ["", "unknown-token", "x".repeat(129), reset]) {
      expect(await users.verifyEmailToken(token)).toBe(false);
    }
    expect((await tokenRow(reset)).usedAt).toBeNull();
    await users.sendVerificationEmail(user, "vi");
    const verify = latestLink().token;
    await prisma.emailToken.update({ where: { tokenHash: sha256Hex(verify) }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await users.verifyEmailToken(verify)).toBe(false);
    expect((await tokenRow(verify)).usedAt).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
  });

  it("resending invalidates the old verification link without invalidating reset links", async () => {
    const user = await seed();
    await users.requestPasswordReset(user.email, "vi");
    const reset = latestLink().token;
    await users.sendVerificationEmail(user, "vi");
    const first = latestLink().token;
    await users.sendVerificationEmail(user, "en");
    const second = latestLink().token;
    expect(second).not.toBe(first);
    expect(await users.verifyEmailToken(first)).toBe(false);
    expect((await tokenRow(first)).usedAt).toBeInstanceOf(Date);
    expect((await tokenRow(reset)).usedAt).toBeNull();
    expect(await users.verifyEmailToken(second)).toBe(true);
  });

  it("rolls token consumption back if the user update fails", async () => {
    const user = await seed();
    await users.sendVerificationEmail(user, "vi");
    const token = latestLink().token;
    await failUserUpdates();
    await expect(users.verifyEmailToken(token)).rejects.toThrow();
    expect((await tokenRow(token)).usedAt).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
    await prisma.$executeRawUnsafe('DROP TRIGGER "fail_user_update"');
    expect(await users.verifyEmailToken(token)).toBe(true);
  });

  it("surfaces mail delivery errors for callers to report or retry", async () => {
    const user = await seed();
    mail.send.mockRejectedValueOnce(new DeliveryError());
    await expect(users.sendVerificationEmail(user, "vi")).rejects.toBeInstanceOf(DeliveryError);
  });

  it("keeps a previously delivered verification link valid when resending fails and removes the failed link", async () => {
    const user = await seed();
    await users.sendVerificationEmail(user, "vi");
    const delivered = latestLink().token;
    mail.send.mockRejectedValueOnce(new DeliveryError());
    await expect(users.sendVerificationEmail(user, "en")).rejects.toBeInstanceOf(DeliveryError);
    const failed = latestLink().token;
    expect(failed).not.toBe(delivered);
    expect(await prisma.emailToken.findUnique({ where: { tokenHash: sha256Hex(failed) } })).toBeNull();
    expect(await users.verifyEmailToken(failed)).toBe(false);
    expect((await tokenRow(delivered)).usedAt).toBeNull();
    expect(await users.verifyEmailToken(delivered)).toBe(true);
  });

  it("leaves a failed new link unusable if database cleanup also fails", async () => {
    const user = await seed();
    await users.sendVerificationEmail(user, "vi");
    const delivered = latestLink().token;
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "fail_token_delete" BEFORE DELETE ON "EmailToken"
      BEGIN SELECT RAISE(ABORT, 'simulated token cleanup failure'); END
    `);
    mail.send.mockRejectedValueOnce(new DeliveryError());
    await expect(users.sendVerificationEmail(user, "en")).rejects.toBeInstanceOf(DeliveryError);
    const failed = latestLink().token;
    expect((await tokenRow(failed)).expiresAt.getTime()).toBe(0);
    expect(await users.verifyEmailToken(failed)).toBe(false);
    expect((await tokenRow(delivered)).usedAt).toBeNull();
    expect(await users.verifyEmailToken(delivered)).toBe(true);
  });
});

describe("password reset", () => {
  it.each<Locale>(["vi", "en"])("sends a localized %s link, resets once and signs out web sessions", async (locale) => {
    const user = await seed();
    await session(user.id);
    await session(user.id);
    const before = Date.now();
    await users.requestPasswordReset(user.email, locale);
    const { message, url, token } = latestLink();
    expect(message.to).toBe(user.email);
    expect(url.pathname).toBe(`/${locale}/reset-password`);
    expect(message.subject).toBe(locale === "vi" ? "Đặt lại mật khẩu FaamOffice" : "Reset your FaamOffice password");
    const row = await tokenRow(token);
    expect(row).toMatchObject({ userId: user.id, kind: "reset", tokenHash: sha256Hex(token), usedAt: null });
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + users.RESET_TOKEN_TTL_MS);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + users.RESET_TOKEN_TTL_MS);
    await users.resetPasswordWithToken(token, NEW_PASSWORD);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await passwords.verifyPassword(NEW_PASSWORD, updated.passwordHash)).toBe(true);
    expect(await passwords.verifyPassword(PASSWORD, updated.passwordHash)).toBe(false);
    expect(updated.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await tokenRow(token)).usedAt).toBeInstanceOf(Date);
    await expect(users.resetPasswordWithToken(token, PASSWORD)).rejects.toMatchObject({ status: 400, code: "invalid_token" });
  });

  it("rejects wrong-kind and expired links without changing credentials or sessions", async () => {
    const user = await seed();
    await session(user.id);
    await users.sendVerificationEmail(user, "vi");
    const verify = latestLink().token;
    await expect(users.resetPasswordWithToken(verify, NEW_PASSWORD)).rejects.toMatchObject({ code: "invalid_token" });
    expect((await tokenRow(verify)).usedAt).toBeNull();
    await users.requestPasswordReset(user.email, "vi");
    const reset = latestLink().token;
    await prisma.emailToken.update({ where: { tokenHash: sha256Hex(reset) }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(users.resetPasswordWithToken(reset, NEW_PASSWORD)).rejects.toMatchObject({ code: "invalid_token" });
    expect((await tokenRow(reset)).usedAt).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it("keeps only the latest reset link and preserves an existing verification date", async () => {
    const verifiedAt = new Date("2026-10-01T00:00:00Z");
    const user = await seed({ emailVerifiedAt: verifiedAt });
    await users.requestPasswordReset(user.email, "vi");
    const first = latestLink().token;
    await users.requestPasswordReset(user.email, "en");
    const second = latestLink().token;
    await expect(users.resetPasswordWithToken(first, NEW_PASSWORD)).rejects.toMatchObject({ code: "invalid_token" });
    await users.resetPasswordWithToken(second, NEW_PASSWORD);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toEqual(verifiedAt);
  });

  it("keeps a previously delivered reset link valid when resending fails and removes the failed link", async () => {
    const user = await seed();
    await users.requestPasswordReset(user.email, "vi");
    const delivered = latestLink().token;
    mail.send.mockRejectedValueOnce(new DeliveryError());
    await expect(users.requestPasswordReset(user.email, "en")).resolves.toBeUndefined();
    const failed = latestLink().token;
    expect(await prisma.emailToken.findUnique({ where: { tokenHash: sha256Hex(failed) } })).toBeNull();
    await expect(users.resetPasswordWithToken(failed, NEW_PASSWORD)).rejects.toMatchObject({ code: "invalid_token" });
    expect((await tokenRow(delivered)).usedAt).toBeNull();
    await users.resetPasswordWithToken(delivered, NEW_PASSWORD);
    expect(await users.authenticateUser(user.email, NEW_PASSWORD)).toMatchObject({ id: user.id });
  });

  it("rolls token consumption, password and session changes back if the user update fails", async () => {
    const user = await seed();
    await session(user.id);
    await users.requestPasswordReset(user.email, "vi");
    const token = latestLink().token;
    await failUserUpdates();
    await expect(users.resetPasswordWithToken(token, NEW_PASSWORD)).rejects.toThrow();
    expect((await tokenRow(token)).usedAt).toBeNull();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      passwordHash: user.passwordHash, emailVerifiedAt: null,
    });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    await prisma.$executeRawUnsafe('DROP TRIGGER "fail_user_update"');
    await users.resetPasswordWithToken(token, NEW_PASSWORD);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("does not consume a reset link when password hashing fails", async () => {
    const user = await seed();
    await users.requestPasswordReset(user.email, "vi");
    const token = latestLink().token;
    const hash = vi.spyOn(passwords, "hashPassword").mockRejectedValueOnce(new Error("simulated hash failure"));
    await expect(users.resetPasswordWithToken(token, NEW_PASSWORD)).rejects.toThrow("simulated hash failure");
    expect((await tokenRow(token)).usedAt).toBeNull();
    hash.mockRestore();
    await users.resetPasswordWithToken(token, NEW_PASSWORD);
  });

  it("keeps forgot responses uniform for existing, unknown, disabled and mail-failure accounts", async () => {
    const user = await seed();
    const disabled = await seed({ disabledAt: new Date() });
    const missingEmail = `missing${++nextUser}@faam.test`;
    const existingResponse = await forgot(forgotRequest(user.email));
    expect(mail.send).toHaveBeenCalledTimes(1);
    const missingResponse = await forgot(forgotRequest(missingEmail));
    const disabledResponse = await forgot(forgotRequest(disabled.email));
    expect(mail.send).toHaveBeenCalledTimes(1);
    mail.send.mockRejectedValueOnce(new DeliveryError());
    const failureResponse = await forgot(forgotRequest(user.email));
    for (const response of [existingResponse, missingResponse, disabledResponse, failureResponse]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("does not hide unexpected programming failures as mail delivery errors", async () => {
    const user = await seed();
    mail.send.mockRejectedValueOnce(new Error("unexpected error"));
    await expect(users.requestPasswordReset(user.email, "vi")).rejects.toThrow("unexpected error");
  });
});

describe("concurrent email delivery", () => {
  it.each(["verify", "reset"] as const)("a late older %s delivery never revokes or replaces a newer successful link", async (kind) => {
    const user = await seed();
    const send = () => kind === "verify" ? users.sendVerificationEmail(user, "vi") : users.requestPasswordReset(user.email, "vi");
    await send();
    const original = latestLink().token;
    const started = deferred();
    const complete = deferred();
    mail.send.mockImplementationOnce(() => { started.resolve(); return complete.promise; });
    const older = send();
    await started.promise;
    const olderToken = latestLink().token;
    expect((await tokenRow(olderToken)).expiresAt.getTime()).toBe(0);
    expect((await tokenRow(original)).usedAt).toBeNull();
    await send();
    const newerToken = latestLink().token;
    complete.resolve();
    await older;
    expect((await tokenRow(original)).usedAt).toBeInstanceOf(Date);
    expect((await tokenRow(olderToken)).usedAt).toBeInstanceOf(Date);
    expect((await tokenRow(newerToken)).usedAt).toBeNull();
    if (kind === "verify") {
      expect(await users.verifyEmailToken(original)).toBe(false);
      expect(await users.verifyEmailToken(olderToken)).toBe(false);
      expect(await users.verifyEmailToken(newerToken)).toBe(true);
      expect(await users.verifyEmailToken(olderToken)).toBe(false);
    } else {
      await expect(users.resetPasswordWithToken(original, NEW_PASSWORD)).rejects.toMatchObject({ code: "invalid_token" });
      await expect(users.resetPasswordWithToken(olderToken, NEW_PASSWORD)).rejects.toMatchObject({ code: "invalid_token" });
      await users.resetPasswordWithToken(newerToken, NEW_PASSWORD);
    }
  });
});
