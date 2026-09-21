/** Applies pending SQL migrations from drizzle/ to synradb: `bun run db:migrate`. */
import { migrate } from "drizzle-orm/postgres-js/migrator"

import { getDb } from "@/lib/db"

const db = getDb()
// A freshly created container restarts Postgres once after initdb, so the first attempts may hit a closing socket.
for (let attempt = 1; ; attempt++) {
  try {
    await migrate(db, { migrationsFolder: "./drizzle" })
    break
  } catch (err) {
    if (attempt >= 10) throw err
    console.log(
      `[synra] database not ready (${(err as Error).message.split("\n")[0]}), retrying…`
    )
    await new Promise((r) => setTimeout(r, 1000))
  }
}
console.log("[synra] migrations applied")
await db.$client.end()
