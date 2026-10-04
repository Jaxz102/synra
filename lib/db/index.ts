import { eq, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { env } from "@/lib/env"
import * as schema from "@/lib/db/schema"

export * from "@/lib/db/schema"

export type Db = ReturnType<typeof create>

declare global {
  var __synraDb: Db | undefined
}

function create() {
  if (!env.databaseUrl) throw new Error("DATABASE_URL is not set")

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
  return (globalThis.__synraDb ??= create())
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

/** `COALESCE(new, existing)` for upserts — only overwrite a column when we learned something. */
export const keep = (col: AnyPgColumn, v: unknown) =>
  sql`COALESCE(${v ?? null}, ${col})`
