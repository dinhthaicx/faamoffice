// Load web/.env into process.env for standalone scripts (Next.js does this for the app).
// Import this module first: later imports may read process.env at load time.

try {
  process.loadEnvFile();
} catch {
  // No .env file: use the real environment.
}

export {};
