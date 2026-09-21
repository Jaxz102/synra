# Synra

Synra watches the SEC EDGAR "latest filings" feed for **Form 4** insider filings, drops anything planned or sold, asks Grok whether the insider's buying history makes the purchase routine, and posts the remaining **unplanned open-market insider purchases** to a dashboard.

## How it works

Every 6 hours (configurable) a poll run:

1. **Cursor-based delta read** of `browse-edgar?action=getcurrent&type=4` (Atom). The cursor is the `updated` timestamp of the newest filing already processed; the run pages newest-to-oldest and stops as soon as it sees an entry at or before the cursor. Filings are processed oldest-first and the cursor advances after each one, so an interrupted run resumes cleanly. Filings that errored are retried up to 3 times on later runs.
2. For each new Form 4 the primary XML is fetched and parsed:
   - **Skip** if the Rule 10b5-1 checkbox (`aff10b5One`) is set, or a footnote states the trade was made under a 10b5-1 plan.
   - **Skip** if the filing is a sale/disposition, or has no open-market purchase (transaction code `P`, acquired). Grants, option exercises, tax withholding and gifts are logged as "not a purchase".
3. For every surviving purchase, the insider's own Form 4 history (last 24 months, up to 20 filings, from `data.sec.gov/submissions`) is loaded, summarised with cadence and size statistics, and sent to **xAI Grok** (`grok-4.6` by default) with a strict JSON schema. A **routine** verdict (regular cadence, ESPP/DRIP style, similar sizes) skips the filing; an **opportunistic** verdict posts it. Insiders with no prior filings are posted without a model call.
4. Everything is stored in **PostgreSQL (`synradb`)** through [Drizzle ORM](https://orm.drizzle.team) on Bun's built-in `Bun.SQL` client: posted trades as `stocks` / `insiders` / `trades` (the Eraser ERD "Insider Trade Tracking", extended with the AI verdict and transaction detail), plus `filings` (every screened filing and its reason), `insider_analyses` (every Grok verdict), `poll_runs`, a `kv` table for the feed cursor, and the `form4_cache` / `issuer_cache` SEC response caches. Exchange and sector come from the issuer's SEC submissions profile.

## Running

```bash
cp .env.example .env   # then fill in XAI_API_KEY and SEC_USER_AGENT
bun install
make start             # starts the synradb Postgres container in OrbStack, applies migrations, then runs the dev server
```

`make help` lists the other targets (`make db`, `make migrate`, `make generate`, `make studio`, `make db-reset`, `make stop`, `make psql`, `make poll ARGS="--limit 25"`, `make serve` for a production build). Without make: `bun run db:up`, `bun run db:migrate`, then `bun run dev`.

Postgres runs from `docker-compose.yml` as container `synradb` (database `synradb`, user/password `synra`). Connect with `bun run db:psql`, `postgres://synra:synra@localhost:5433/synradb?sslmode=disable`, or via OrbStack's domain `synradb.orb.local:5432`.

### Schema changes

The schema is declared once in `lib/db/schema.ts`. To add or change a table:

1. Edit `lib/db/schema.ts`.
2. `bun run db:generate` — drizzle-kit diffs the schema against `drizzle/` and writes a new numbered `.sql` migration (commit it).
3. `bun run db:migrate` — applies pending migrations (also runs on `make start` / `make serve`).

`bun run db:studio` opens Drizzle Studio to browse the data.

Open http://localhost:3000. The dashboard shows signal tiles, the posted trades (click a row for Grok's reasoning and the history it reviewed), the full pipeline log, and run history. **Poll now** triggers a run immediately.

Other commands:

```bash
bun run poll                  # one-off delta run from the CLI
bun run poll --limit 25       # process at most 25 filings
bun run poll --reset --lookback 24   # clear the cursor and re-scan the last 24h
bun run build && bun run start
```

### Deploying to Vercel

`vercel.json` opts functions into Vercel's Bun runtime (`bunVersion: "1.x"` — Bun 1.3; `1.4.x` was ignored by the Next 16 Vercel adapter, see vercel/next.js#91720) and registers a Vercel Cron that hits `GET /api/cron/poll` every 6 hours. Leave the build/install/output settings on their defaults and set these environment variables: `PRODUCTION_DATABASE_URL` (Neon), `XAI_API_KEY`, `SEC_USER_AGENT`, `ALPACA_KEY`, `ALPACA_SECRET`, `CRON_SECRET` (any random string; Vercel sends it as a bearer token), and `SYNRA_SCHEDULER=0` — the in-process `setTimeout` scheduler cannot survive serverless invocations, so the cron replaces it. The database driver is postgres.js, so the app also works if a deployment falls back to the Node runtime.

## Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `XAI_API_KEY` | — | xAI API key (required for classification) |
| `XAI_MODEL` | `grok-4.6` | Model used for the routine/opportunistic verdict |
| `SEC_USER_AGENT` | placeholder | SEC requires `"AppName contact@email"`; requests without it are blocked |
| `POLL_INTERVAL_HOURS` | `6` | Scheduler cadence |
| `INITIAL_LOOKBACK_HOURS` | `12` | Window scanned on the very first run (no cursor yet) |
| `MAX_FEED_PAGES` | `20` | Cap on 100-entry feed pages per run |
| `HISTORY_MONTHS` / `HISTORY_MAX_FILINGS` | `24` / `20` | Insider history sent to Grok |
| `SYNRA_SCHEDULER` | `1` | Set `0` to disable the in-process scheduler (use `bun run poll` from cron, or Vercel Cron, instead) |
| `CRON_SECRET` | — | Vercel only: bearer token Vercel Cron sends to `GET /api/cron/poll` (`vercel.json`, every 6h). Set `SYNRA_SCHEDULER=0` alongside it |
| `DATABASE_URL` | `postgres://synra:synra@localhost:5433/synradb?sslmode=disable` | Postgres connection string for development (all state lives here) |
| `PRODUCTION_DATABASE_URL` | — | Used **instead of** `DATABASE_URL` when `NODE_ENV=production` (`bun run build && bun run start`). Point it at Neon with `?sslmode=require`; required in production. Bootstrap the schema by running `scripts/neon-schema.sql` in the Neon SQL editor (or `NODE_ENV=production bun run db:migrate`) |
| `ALPACA_KEY` / `ALPACA_SECRET` | — | Alpaca paper-trading keys; every posted trade places a market buy of the ticker (skipped with a logged error when unset) |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` | Alpaca endpoint (leave on paper) |
| `ALPACA_ORDER_NOTIONAL` | `150` | Dollars bought per posted trade; non-fractionable tickers fall back to whole shares |

## Layout

- `lib/sec/` – rate-limited EDGAR client, Atom feed cursor, Form 4 XML parser, insider history
- `lib/ai/` – Grok client and the classification prompt
- `lib/alpaca/` – Alpaca paper-trading client; orders are keyed by accession number so a filing is never bought twice
- `lib/pipeline/` – poll run and 6-hour scheduler (started from `instrumentation.ts`)
- `lib/db/schema.ts` – Drizzle schema (source of truth for the database), `lib/db/index.ts` – client + `kv` helpers, `drizzle/` – generated SQL migrations
- `lib/queries.ts` – read models for the dashboard
- `app/` – Next.js App Router dashboard (`/`) and `POST /api/poll`
- `components/dashboard/` – tiles, tables, trade detail dialog, poll controls
