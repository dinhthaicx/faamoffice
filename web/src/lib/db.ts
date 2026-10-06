// Prisma client singleton (SQLite via the better-sqlite3 driver adapter).
//
// To use PostgreSQL instead: `npm install @prisma/adapter-pg`, set the schema
// provider to "postgresql", and replace the adapter below with
// `new PrismaPg({ connectionString: process.env.DATABASE_URL })`.

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { __faamPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL || "file:./data/faamoffice.db";
  // `timeout` is better-sqlite3's busy timeout (ms) when the file is locked.
  const adapter = new PrismaBetterSqlite3({ url, timeout: 10_000 });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.__faamPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__faamPrisma = prisma;
