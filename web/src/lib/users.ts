// Account lifecycle: registration, login, email verification, password reset,
// profile changes and deletion.

import { z } from "zod";
import { prisma } from "./db";
import { randomToken, sha256Hex } from "./crypto";
import { getConfig } from "./env";
import { HttpError } from "./http";
import { MailDeliveryError, sendMail, type MailMessage } from "./mail";
import { resetPasswordMessage, verifyEmailMessage } from "./email-templates";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyDummyPassword, verifyPassword } from "./password";
import type { EmailTokenKind, Prisma, User } from "@/generated/prisma/client";
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

/** Promote verified users listed in ADMIN_EMAILS, preserving existing admins. */
export async function ensureAdminFromEnv(user: User): Promise<User> {
  if (user.role !== "ADMIN" && user.emailVerifiedAt && isAdminEmail(user.email)) {
    return prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  }
  return user;
}

// ---------------------------------------------------------------- email tokens

type PendingEmailToken = {
  token: string;
  id: string;
  userId: string;
  kind: EmailTokenKind;
  ttlMs: number;
  previousIds: string[];
};

async function createEmailToken(userId: string, kind: EmailTokenKind, ttlMs: number): Promise<PendingEmailToken> {
  const token = randomToken(32);
  return prisma.$transaction(async (tx) => {
    // Snapshot older IDs, rather than revoking every unused token after mail
    // delivery: an older request finishing late must not revoke a newer link.
    const previous = await tx.emailToken.findMany({ where: { userId, kind, usedAt: null }, select: { id: true } });
    const created = await tx.emailToken.create({
      // Pending links cannot be consumed, even if failed-delivery cleanup fails.
      data: { userId, kind, tokenHash: sha256Hex(token), expiresAt: new Date(0) },
    });
    return { token, id: created.id, userId, kind, ttlMs, previousIds: previous.map((row) => row.id) };
  });
}

async function deliverEmailToken(pending: PendingEmailToken, message: MailMessage): Promise<void> {
  try {
    await sendMail(message);
  } catch (err) {
    // Retain the original delivery error; a leftover pending row is expired and
    // unusable if the database is temporarily unavailable during cleanup.
    await prisma.emailToken.deleteMany({ where: { id: pending.id } }).catch(() => {});
    throw err;
  }
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const activated = await tx.emailToken.updateMany({
      where: { id: pending.id, usedAt: null, expiresAt: new Date(0) },
      data: { expiresAt: new Date(now.getTime() + pending.ttlMs) },
    });
    // A newer successful request may already have superseded this pending link.
    // Never reactivate it, and never invalidate links created after its snapshot.
    if (activated.count === 1 && pending.previousIds.length) {
      await tx.emailToken.updateMany({
        where: { id: { in: pending.previousIds }, userId: pending.userId, kind: pending.kind, usedAt: null },
        data: { usedAt: now },
      });
    }
  });
}

/** Consume in the same transaction as the action, so failed actions keep their link valid. */
async function consumeEmailToken(tx: Prisma.TransactionClient, token: string, kind: EmailTokenKind): Promise<string | null> {
  if (!token || token.length > 128) return null;
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const row = await tx.emailToken.findUnique({ where: { tokenHash } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt <= now) return null;
  const res = await tx.emailToken.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return res.count === 1 ? row.userId : null;
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "name">, locale: Locale): Promise<void> {
  const pending = await createEmailToken(user.id, "verify", VERIFY_TOKEN_TTL_MS);
  const url = `${getConfig().siteUrl}/${locale}/verify-email?token=${encodeURIComponent(pending.token)}`;
  await deliverEmailToken(pending, { to: user.email, ...verifyEmailMessage(locale, user.name, url) });
}

/**
 * Verify an email link. Idempotent: opening the same (already used) link again
 * still reports success once the address is verified.
 */
export async function verifyEmailToken(token: string): Promise<boolean> {
  if (!token || token.length > 128) return false;
  return prisma.$transaction(async (tx) => {
    const row = await tx.emailToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
    if (!row || row.kind !== "verify") return false;
    if (row.expiresAt.getTime() === 0) return false;
    if (row.usedAt) return row.user.emailVerifiedAt !== null;
    const userId = await consumeEmailToken(tx, token, "verify");
    if (!userId) return false;
    await tx.user.update({
      where: { id: userId },
      data: {
        emailVerifiedAt: row.user.emailVerifiedAt ?? new Date(),
        ...(row.user.role !== "ADMIN" && isAdminEmail(row.user.email) ? { role: "ADMIN" } : {}),
      },
    });
    return true;
  });
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
          role: "USER",
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
  const pending = await createEmailToken(user.id, "reset", RESET_TOKEN_TTL_MS);
  const url = `${getConfig().siteUrl}/${locale}/reset-password?token=${encodeURIComponent(pending.token)}`;
  try {
    await deliverEmailToken(pending, { to: user.email, ...resetPasswordMessage(locale, user.name, url) });
  } catch (err) {
    // Keep the same response for unknown accounts and unavailable mail delivery.
    if (!(err instanceof MailDeliveryError)) throw err;
  }
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    const userId = await consumeEmailToken(tx, token, "reset");
    if (!userId) throw new HttpError(400, "invalid_token", "This reset link is invalid or has expired.");
    // Receiving the reset email also proves ownership of the address.
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await tx.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId } });
  });
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
