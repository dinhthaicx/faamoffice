// `npm run db:seed` (or `npx prisma db seed`): create or promote the admin
// account given by SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, and optionally set
// the Faam credits mode (SEED_CREDITS_ENABLED=true|false, SEED_AI_DAILY_LIMIT=<n>,
// as on the admin Settings page). Safe to run repeatedly.

import "../scripts/load-env";
import { prisma } from "../src/lib/db";
import { getConfig } from "../src/lib/env";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../src/lib/password";
import { getSiteSettings, parseSettingsPatch, updateSiteSettings, type SiteSettingsPatch } from "../src/lib/site-settings";

function parseBool(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (/^(1|true|yes|on)$/.test(raw)) return true;
  if (/^(0|false|no|off)$/.test(raw)) return false;
  throw new Error(`${name} must be true or false.`);
}

/** SEED_CREDITS_ENABLED / SEED_AI_DAILY_LIMIT as a settings patch (empty when unset). */
function settingsFromEnv(): SiteSettingsPatch {
  const patch: SiteSettingsPatch = {};
  const creditsEnabled = parseBool("SEED_CREDITS_ENABLED");
  if (creditsEnabled !== undefined) patch.creditsEnabled = creditsEnabled;
  const limit = process.env.SEED_AI_DAILY_LIMIT?.trim();
  if (limit) {
    try {
      Object.assign(patch, parseSettingsPatch({ aiDailyRequestLimit: limit }));
    } catch {
      throw new Error("SEED_AI_DAILY_LIMIT must be a whole number from 0 to 1000000 (0 = unlimited).");
    }
  }
  return patch;
}

/** Apply the patch when it is not empty; leave the stored settings alone otherwise. */
async function seedSettings(patch: SiteSettingsPatch, actorId: string | null) {
  const s = Object.keys(patch).length ? await updateSiteSettings(patch, actorId) : await getSiteSettings();
  const quota = s.aiDailyRequestLimit > 0 ? `${s.aiDailyRequestLimit} Faam AI requests per user per day` : "no daily limit";
  console.log(`Faam credits: ${s.creditsEnabled ? "on" : `off (${quota})`}.`);
}

async function seedAdmin(): Promise<string | null> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!email) {
    console.log("SEED_ADMIN_EMAIL is not set: no admin to seed.");
    return null;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "ADMIN", disabledAt: null, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
    });
    console.log(`Promoted existing user ${email} to ADMIN (password unchanged).`);
    return existing.id;
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  // Like registration, the bonus is granted in both credit modes (it only shows while credits are on).
  const bonus = getConfig().signupBonusCredits;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Administrator",
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      emailVerifiedAt: new Date(),
      credits: bonus,
      ...(bonus > 0
        ? { creditTransactions: { create: { delta: bonus, balanceAfter: bonus, reason: "signup_bonus", note: "Seed admin" } } }
        : {}),
    },
  });
  console.log(`Created admin ${user.email}.`);
  return user.id;
}

async function main() {
  // Validate everything before writing anything.
  const patch = settingsFromEnv();
  const adminId = await seedAdmin();
  await seedSettings(patch, adminId);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
