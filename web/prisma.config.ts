// Prisma CLI configuration (Prisma 7+). The CLI does not read .env by itself,
// so load it with Node's built-in loader when present.
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment (Docker, CI, ...).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./data/faamoffice.db",
  },
});
