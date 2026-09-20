import { SQL } from "bun"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sql"

import { env } from "@/lib/env"
import * as schema from "@/lib/db/schema"

export * from "@/lib/db/schema"

export type Db = ReturnType<typeof create>
type G = typeof globalThis & { __synraDb?: Db }

function create() {
  if (!env.databaseUrl) throw new Error("DATABASE_URL is not set")
  const client = new SQL(env.databaseUrl, {
    max: 8,
    connectionTimeout: 10,
    idleTimeout: 60,
  })
  return drizzle({ client, schema, casing: "snake_case" })
}

/** Drizzle over Bun's built-in Postgres client (synradb). One pool per process, survives Next dev reloads. */
export function getDb(): Db {
  const g = globalThis as G
  if (!g.__synraDb) g.__synraDb = create()
  return g.__synraDb
}

export async function kvGet(key: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ value: schema.kv.value })
    .from(schema.kv)
    .where(eq(schema.kv.key, key))
  return row?.value ?? null
}

export async function kvSet(key: string, value: string): Promise<void> {
  await getDb()
    .insert(schema.kv)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.kv.key, set: { value } })
}

export async function kvDelete(key: string): Promise<void> {
  await getDb().delete(schema.kv).where(eq(schema.kv.key, key))
}

/** `now()` for `updated_at` columns in upserts. */
export const now = sql`now()`
