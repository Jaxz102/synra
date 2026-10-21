import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

import { env } from "@/lib/env"

const db = drizzle({
  client: postgres(env.migrationDatabaseUrl, { max: 1, connect_timeout: 10 }),
})
console.log(`[synra] migrating ${new URL(env.migrationDatabaseUrl).host}`)
for (let attempt = 1; ; attempt++) {
  try {
    await migrate(db, { migrationsFolder: "./drizzle" })
    break
  } catch (err) {
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
