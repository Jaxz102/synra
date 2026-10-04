/** Applies pending SQL migrations from drizzle/: `bun run db:migrate` (production: `NODE_ENV=production`, via DIRECT_URL). */
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

import { env } from "@/lib/env"

const db = drizzle({
  client: postgres(env.migrationDatabaseUrl, { max: 1, connect_timeout: 10 }),
})
console.log(`[synra] migrating ${new URL(env.migrationDatabaseUrl).host}`)
// A freshly created container restarts Postgres once after initdb, so the first attempts may hit a closing socket.
for (let attempt = 1; ; attempt++) {
  try {
    await migrate(db, { migrationsFolder: "./drizzle" })
    break
  } catch (err) {
    // Drizzle wraps the Postgres error in `cause`. Permission errors (a role without DDL rights) won't fix themselves.
    const pg = ((err as Error).cause ?? err) as Error & { code?: string }
    if (attempt >= 10 || pg.code === "42501") throw pg
    console.log(
      `[synra] database not ready (${pg.message.split("\n")[0]}), retrying…`
    )
    await new Promise((r) => setTimeout(r, 1000))
  }
}
console.log("[synra] migrations applied")
await db.$client.end()
