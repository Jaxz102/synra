import { defineConfig } from "drizzle-kit"

import { env } from "./lib/env"

// `drizzle-kit generate` diffs lib/db/schema.ts against drizzle/ and writes a new SQL migration.
// Migrations are applied by `bun run db:migrate` (scripts/migrate.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  // Same URL as db:migrate: NODE_ENV=production → DIRECT_URL (PlanetScale, DDL role), else DATABASE_URL.
  dbCredentials: { url: env.migrationDatabaseUrl },
  casing: "snake_case",
  strict: true,
  verbose: true,
})
