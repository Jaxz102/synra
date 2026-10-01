# Synra

Synra watches the SEC EDGAR "latest filings" feed for **Form 4** insider filings, screens each one against the criteria in the [SEC Filtering Pipeline](https://linear.app/syrna/document/sec-filtering-pipeline-9c991fe1576a) Linear doc, buys each purchase that passes with an Alpaca paper **market order**, and posts it to a dashboard once the order fills.

## How it works

Every 6 hours (configurable) a poll run:

1. **Cursor-based delta read** of `browse-edgar?action=getcurrent&type=4` (Atom). The cursor is the `updated` timestamp of the newest filing already processed; the run pages newest-to-oldest and stops as soon as it sees an entry at or before the cursor. Filings are processed oldest-first and the cursor advances after each one, so an interrupted run resumes cleanly. Filings that errored are retried up to 3 times on later runs.
2. For each new Form 4 the primary XML is fetched, parsed and screened in the doc's order. The first step that fails becomes the filing's status (in parentheses) and the filing is disregarded:
   1. **Open-market purchase:** at least one non-derivative transaction coded `P`. Sales (`S`) are `skipped_sell`; grants, exercises, tax withholding and gifts are `skipped_not_purchase`.
   2. **No 10b5-1 plan:** the Rule 10b5-1 checkbox (`aff10b5One`) is unchecked (`skipped_10b5_1`).
   3. **NYSE or Nasdaq stock:** the security bought is common equity (not preferred, notes, warrants, units or rights), and the issuer's ticker is an Alpaca `us_equity` listed on `NYSE` or `NASDAQ` (`skipped_listing`).
   4. **Opportunistic insider** (Cohen, Malloy & Pomorski, "Decoding Inside Information"): the insider's Form 4s for the three calendar years before the trade are loaded from `data.sec.gov/submissions`, across every issuer. They need at least one open-market trade (`P` or `S`) in each of those years (`skipped_history`). If they traded in the same calendar month in all three years they are routine (`skipped_routine`).
   5. **Market cap of at least $100M**, from Finnhub's company profile (`skipped_market_cap`).
   6. **Price hasn't run:** the latest Alpaca trade is at most 2% above the filing's share-weighted purchase price (`skipped_price`). Steps 6-7 only run while the market is open (Alpaca's clock); a filing that passes steps 1-5 while it is closed stays `queued` for a later run without using up a retry (counted as *deferred*).
   7. **Buy:** a day market buy of `$ALPACA_ORDER_NOTIONAL` (whole shares for stocks Alpaca can't trade fractionally), keyed by the accession number so a filing is never bought twice. The run waits up to 30s for the fill and cancels the order if it hasn't filled. Only a filled buy is posted to `trades`, with the fill quantity and price; an order Alpaca refuses or that doesn't fill is `skipped_order`. If an earlier attempt already placed an order for the filing, that order is picked up instead of re-checking the price.
3. Everything is stored in **PostgreSQL (`synradb`)** through [Drizzle ORM](https://orm.drizzle.team) on postgres.js. Bought trades go to `stocks` / `insiders` / `trades` (the Eraser ERD "Insider Trade Tracking", extended with the insider-criteria evidence, market cap, screening price and the Alpaca order and fill). Alongside them: `filings` (every screened filing and its reason), `insider_analyses` (every step-4 evaluation), `poll_runs`, a `kv` table for the feed cursor, and the `form4_cache` / `issuer_cache` SEC response caches. Trades posted before the rule replaced Grok keep Grok's verdict, with `classifier` set to the model name; trades posted before market orders replaced limit orders keep their (possibly unfilled) limit order.

## Running

```bash
cp .env.example .env   # then fill in SEC_USER_AGENT, ALPACA_KEY / ALPACA_SECRET and FINNHUB_API_KEY
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

Open http://localhost:3000. The dashboard shows signal tiles, the posted trades (click a row for the insider's month-by-year trading grid and the trades behind it), the full pipeline log, and run history. The page is read-only: runs come from the in-process scheduler, `bun run poll`, or the cron endpoint below.

Other commands:

```bash
bun run poll                  # one-off delta run from the CLI
bun run poll --limit 25       # process at most 25 filings
bun run poll --reset --lookback 24   # clear the cursor and re-scan the last 24h
bun run build && bun run start
```

## Production (Vercel + Neon)

- **Trigger:** set `SYNRA_SCHEDULER=0` and `CRON_SECRET` on Vercel, and have an external scheduler call `GET https://<app>/api/cron/poll` with `Authorization: Bearer $CRON_SECRET`. It answers `202 {"started":true}` right away and runs the poll in `after()`; `409` while a run is active in that instance, `401` without the secret. A run stops starting new filings after ~220s so it finishes inside the function's 300s limit; the rest stay queued for the next call. Since buys only happen while the market is open, schedule at least one call during market hours (9:30-16:00 ET) on weekdays.
- **Database:** Neon via `PRODUCTION_DATABASE_URL`. Apply the schema with `scripts/neon-schema.sql` (Neon SQL editor or `psql "$PRODUCTION_DATABASE_URL" -f scripts/neon-schema.sql`) or `NODE_ENV=production bun run db:migrate`; both apply only the migrations the database's drizzle journal doesn't list yet. After `bun run db:generate`, run `bun run db:neon-schema` to regenerate the SQL file. Deploy the code and migrate together: a migration that renames columns breaks the previously deployed code.