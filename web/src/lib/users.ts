// Account lifecycle: registration, login, email verification, password reset,
// profile changes and deletion.

import { z } from "zod";
import { prisma } from "./db";
import { randomToken, sha256Hex } from "./crypto";
import { getConfig } from "./env";
import { HttpError } from "./http";
import { sendMail } from "./mail";
import { resetPasswordMessage, verifyEmailMessage } from "./email-templates";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyDummyPassword, verifyPassword } from "./password";
import type { EmailTokenKind, User } from "@/generated/prisma/client";
import { locales, type Locale } from "@/i18n/config";

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ error: "Enter a valid email address." }))
  .transform(normalizeEmail);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` })
  .max(PASSWORD_MAX_LENGTH, { error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` });

export const nameSchema = z
  .string()
  .trim()
  .min(1, { error: "Enter your name." })
  .max(80, { error: "Name must be at most 80 characters." })
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), { error: "Name contains invalid characters." });

export const localeSchema = z.enum(locales).optional().default("vi");

/** Public shape of a user (never includes the password hash). */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    role: user.role,
    credits: user.credits,
    createdAt: user.createdAt.toISOString(),
  };
}

function isAdminEmail(email: string): boolean {
  return getConfig().adminEmails.has(normalizeEmail(email));
}

/** Promote users listed in ADMIN_EMAILS (called at registration and login). */
export async function ensureAdminFromEnv(user: User): Promise<User> {
  if (user.role !== "ADMIN" && isAdminEmail(user.email)) {
    return prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  }
  return user;
}

// ---------------------------------------------------------------- email tokens

async function createEmailToken(userId: string, kind: EmailTokenKind, ttlMs: number): Promise<string> {
  const token = randomToken(32);
  const now = new Date();
  await prisma.$transaction([
    // Only the newest link of each kind stays valid.
    prisma.emailToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: now } }),
    prisma.emailToken.create({
      data: { userId, kind, tokenHash: sha256Hex(token), expiresAt: new Date(now.getTime() + ttlMs) },
    }),
  ]);
  return token;
}

/** Atomically mark a token as used. Returns the owning user id, or null if invalid/expired/used. */
async function consumeEmailToken(token: string, kind: EmailTokenKind): Promise<string | null> {
  if (!token || token.length > 128) return null;
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const row = await prisma.emailToken.findUnique({ where: { tokenHash } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt <= now) return null;
  const res = await prisma.emailToken.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return res.count === 1 ? row.userId : null;
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "name">, locale: Locale): Promise<void> {
  const token = await createEmailToken(user.id, "verify", VERIFY_TOKEN_TTL_MS);
  const url = `${getConfig().siteUrl}/${locale}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({ to: user.email, ...verifyEmailMessage(locale, user.name, url) });
}

/**
 * Verify an email link. Idempotent: opening the same (already used) link again
 * still reports success once the address is verified.
 */
export async function verifyEmailToken(token: string): Promise<boolean> {
  if (!token || token.length > 128) return false;
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
  if (!row || row.kind !== "verify") return false;
  if (row.usedAt) return row.user.emailVerifiedAt !== null;
  const userId = await consumeEmailToken(token, "verify");
  if (!userId) return false;
  await prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  return true;
}

// ---------------------------------------------------------------- registration / login

export async function registerUser(input: { name: string; email: string; password: string; locale: Locale }): Promise<User> {
  const cfg = getConfig();
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new HttpError(409, "email_taken", "An account with this email already exists.");

  const passwordHash = await hashPassword(input.password);
  const bonus = cfg.signupBonusCredits;
  let user: User;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          role: isAdminEmail(input.email) ? "ADMIN" : "USER",
          credits: bonus,
        },
      });
      if (bonus > 0) {
        await tx.creditTransaction.create({
          data: { userId: created.id, delta: bonus, balanceAfter: bonus, reason: "signup_bonus", note: "Welcome bonus" },
        });
      }
      return created;
    });
  } catch (err) {
    // Unique constraint race between the check above and the insert.
    if ((err as { code?: string })?.code === "P2002") {
      throw new HttpError(409, "email_taken", "An account with this email already exists.");
    }
    throw err;
  }
  await sendVerificationEmail(user, input.locale);
  return user;
}

export async function authenticateUser(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await verifyDummyPassword(password);
    throw new HttpError(401, "invalid_credentials", "Incorrect email or password.");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new HttpError(401, "invalid_credentials", "Incorrect email or password.");
  if (user.disabledAt) throw new HttpError(403, "account_disabled", "This account has been disabled.");
  return ensureAdminFromEnv(user);
}

// ---------------------------------------------------------------- password reset

export async function requestPasswordReset(email: string, locale: Locale): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Same response whether or not the account exists (no account enumeration).
  if (!user || user.disabledAt) return;
  const token = await createEmailToken(user.id, "reset", RESET_TOKEN_TTL_MS);
  const url = `${getConfig().siteUrl}/${locale}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({ to: user.email, ...resetPasswordMessage(locale, user.name, url) });
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
  const userId = await consumeEmailToken(token, "reset");
  if (!userId) throw new HttpError(400, "invalid_token", "This reset link is invalid or has expired.");
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    // Receiving the reset email also proves ownership of the address.
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    }),
    prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

// ---------------------------------------------------------------- profile

export async function changePassword(userId: string, currentSessionId: string, current: string, next: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) {
    throw new HttpError(400, "wrong_password", "Your current password is incorrect.");
  }
  const passwordHash = await hashPassword(next);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    // Sign out every other browser session.
    prisma.session.deleteMany({ where: { userId, id: { not: currentSessionId } } }),
  ]);
}

export async function deleteAccount(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(400, "wrong_password", "Your password is incorrect.");
  }
  // Sessions, tokens, ledger and usage rows cascade.
  await prisma.user.delete({ where: { id: userId } });
}
