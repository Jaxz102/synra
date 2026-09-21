import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { env } from "@/lib/env"
import * as schema from "@/lib/db/schema"

export * from "@/lib/db/schema"

export type Db = ReturnType<typeof create>
type G = typeof globalThis & { __synraDb?: Db }

function create() {
  if (!env.databaseUrl) throw new Error("DATABASE_URL is not set")
  // postgres.js runs on both Bun (local) and Node (Vercel); Neon requires sslmode=require in the URL.
  const client = postgres(env.databaseUrl, {
    max: 8,
    connect_timeout: 10,
    idle_timeout: 60,
    prepare: false,
  })
  return drizzle({ client, schema, casing: "snake_case" })
}

/** Drizzle over postgres.js. One pool per process, survives Next dev reloads. */
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
