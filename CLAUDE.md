# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Synra polls the SEC EDGAR Form 4 feed, filters for unplanned open-market insider purchases, asks xAI Grok whether the purchase is routine or opportunistic, posts opportunistic ones to a Next.js dashboard, and places an Alpaca paper-trading buy for each. `README.md` describes the pipeline steps and every `.env` variable — read it first; this file covers what the README doesn't.

Follow `AGENTS.md`: this is Next.js 16 with breaking changes — check `node_modules/next/dist/docs/` before writing Next-specific code.

## Commands

Runtime is **Bun** (not Node); scripts use `bun --bun next ...`. `make help` lists all targets.

```bash
make start                 # db up → migrate → next dev (http://localhost:3000)
bun run dev                # dev server only (assumes synradb is running)
bun run typecheck          # tsc --noEmit
bun run lint               # eslint (next core-web-vitals + typescript)
bun run format             # prettier (no semicolons, tailwind class sorting)
bun run build && bun run start

# Database (Postgres in OrbStack, container `synradb`, host port 5433)
bun run db:up / make db    # start container
bun run db:migrate         # apply drizzle/ migrations (scripts/migrate.ts, retries while Postgres boots)
bun run db:generate        # diff lib/db/schema.ts → new drizzle/*.sql (commit it)
make db-reset              # drop the volume and re-migrate
bun run db:psql / db:studio

# Pipeline
bun run poll                          # one delta run from the CLI
bun run poll --limit 25               # cap filings processed (smoke test)
bun run poll --reset --lookback 24    # clear cursor, rescan last 24h
curl -X POST localhost:3000/api/poll  # trigger a run in the running server (409 if one is active)
```

There is no test suite. Verify changes with `bun run typecheck`, `bun run lint`, and a `bun run poll --limit N` run.

## Architecture

**Data flow:** `lib/sec/feed.ts` (Atom feed delta by cursor) → `lib/sec/form4.ts` (XML parse, 10b5-1 / sale / non-purchase filters) → `lib/sec/insider.ts` (insider's 24-month Form 4 history) → `lib/ai/classify.ts` + `lib/ai/grok.ts` (routine vs opportunistic verdict, strict JSON schema) → `lib/pipeline/poll.ts` writes `stocks`/`insiders`/`trades` and calls `lib/alpaca/client.ts`. Every screened filing (posted or not) lands in `filings` with a `status` + `reason`; every Grok call lands in `insider_analyses`. `lib/queries.ts` is the only read layer for the dashboard (`app/page.tsx`, `app/api/poll/route.ts`).

**Pipeline orchestration (`lib/pipeline/`):** `runPoll` in `poll.ts` is the single entry point for all triggers (`schedule` | `manual` | `cli`). It holds a process-wide lock (`globalThis.__synraPollLock`), so concurrent runs are rejected rather than queued. The cursor (`kv.feed_cursor_updated`) advances after each filing, oldest-first, so interrupted runs resume; errored filings are retried on later runs up to `MAX_ATTEMPTS = 3`. `scheduler.ts` is an in-process `setTimeout` loop started from `instrumentation.ts` (Node runtime only, disabled by `SYNRA_SCHEDULER=0`); it runs immediately on boot if the last run is older than the interval.

**Process-global singletons:** the DB pool, poll lock, scheduler state, and SEC rate-limit gate all live on `globalThis` (`__synra*`) so they survive Next dev HMR reloads. Follow that pattern for any new long-lived state.

**Database (`lib/db/`):** `schema.ts` is the source of truth; never hand-edit `drizzle/*.sql`. Drizzle uses `casing: "snake_case"` — write camelCase property names and column names are derived. Primary keys are SEC identifiers (`stocks.id` = issuer CIK, `insiders.id` = reporting-owner CIK, `trades.id` = accession number). Use the custom `json<T>()` column helper in `schema.ts` for jsonb, not Drizzle's built-in `jsonb()` — the built-in double-encodes through Bun.SQL. `lib/db/index.ts` exports `getDb()`, `kvGet/kvSet/kvDelete`, and re-exports the schema; import from `@/lib/db`.

**External clients:** `lib/sec/client.ts` `secFetch` serialises all SEC requests through a ~8 req/s gate with backoff — always go through it, never raw `fetch` to sec.gov. `lib/alpaca/client.ts` keys orders by accession number (`client_order_id`) so a filing is never bought twice; orders are skipped with a logged error when keys are unset. Alpaca should stay on the paper endpoint.

**Config:** all env access is centralised in `lib/env.ts` with defaults; add new variables there (and to `.env.example` / README table) rather than reading `process.env` elsewhere.

**UI:** shadcn/ui components in `components/ui/` (radix-ui + Tailwind v4, `cn` from `lib/utils.ts`); dashboard-specific pieces in `components/dashboard/`. `app/page.tsx` is a server component with `dynamic = "force-dynamic"` that fans out to `lib/queries.ts`.

`scripts/import-sqlite.ts` is a one-off legacy importer from the pre-Postgres SQLite file; safe to delete once `data/synra.db` is gone.
