import { defineConfig } from "drizzle-kit"

// `drizzle-kit generate` diffs lib/db/schema.ts against drizzle/ and writes a new SQL migration.
// Migrations are applied by `bun run db:migrate` (scripts/migrate.ts) using Bun's built-in Postgres client.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  // Same selection as lib/env.ts: NODE_ENV=production → PRODUCTION_DATABASE_URL (Neon), else DATABASE_URL.
  dbCredentials: {
    url:
      (process.env.NODE_ENV === "production"
        ? process.env.PRODUCTION_DATABASE_URL
        : process.env.DATABASE_URL) ?? "",
  },
  casing: "snake_case",
  strict: true,
  verbose: true,
})
