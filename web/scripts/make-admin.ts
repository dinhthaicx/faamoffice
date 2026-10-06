// Grant (or with --revoke, remove) the ADMIN role:
//   npm run make-admin -- someone@example.com
//   npm run make-admin -- someone@example.com --revoke

import "./load-env";
import { prisma } from "../src/lib/db";

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run make-admin -- <email> [--revoke]");
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}. The person must register first.`);
    process.exitCode = 1;
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { role: revoke ? "USER" : "ADMIN" } });
  console.log(revoke ? `${email} is no longer an admin.` : `${email} is now an admin.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
