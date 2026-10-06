// `npm run db:seed` (or `npx prisma db seed`): create or promote the admin
// account given by SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Safe to run repeatedly.

import "../scripts/load-env";
import { prisma } from "../src/lib/db";
import { getConfig } from "../src/lib/env";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../src/lib/password";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!email) {
    console.log("SEED_ADMIN_EMAIL is not set: nothing to seed.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "ADMIN", disabledAt: null, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
    });
    console.log(`Promoted existing user ${email} to ADMIN (password unchanged).`);
    return;
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
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
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
