# Synra

Synra watches the SEC EDGAR "latest filings" feed for **Form 4** insider filings, screens each one against the criteria in the [SEC Filtering Pipeline](https://linear.app/syrna/document/sec-filtering-pipeline-9c991fe1576a) Linear doc, buys each purchase that passes with an Alpaca paper **market order**, and posts it to a dashboard once the order fills.

## How it works

Every 6 hours (configurable) a poll run:

1. **Cursor-based delta read** of `browse-edgar?action=getcurrent&type=4` (Atom). The cursor is the `updated` timestamp of the newest filing already processed; the run pages newest-to-oldest and stops as soon as it sees an entry at or before the cursor. Filings are processed oldest-first and the cursor advances after each one, so an interrupted run resumes cleanly. Filings that errored are retried up to 3 times on later runs.
2. For each new Form 4 the primary XML is fetched, parsed and screened in the doc's "Criteria for File Pass" order. The first step that fails becomes the filing's status (in parentheses) and the filing is disregarded:
   1. **Open-market purchase:** at least one non-derivative transaction coded `P`. Sales (`S`) are `skipped_sell`; grants, exercises, tax withholding and gifts are `skipped_not_purchase`.
   2. **No 10b5-1 plan:** the Rule 10b5-1 checkbox (`aff10b5One`) is unchecked (`skipped_10b5_1`).
   3. **Above $1:** both the filing's share-weighted purchase price and the latest Alpaca trade are above $1 (`skipped_penny`). Steps 3-7 screen the stock that was bought, so it is identified first: a purchase of something other than common equity (preferred, notes, warrants, units, rights) or a ticker Alpaca doesn't list fails the step 7 listing check (`skipped_listing`) here.
   4. **Opportunistic insider** ("Decoding Inside Information"): the insider must have made an open-market trade (non-derivative `P` or `S`, any issuer, excluding trades whose footnotes call them private) in each of the three preceding calendar years, or the filing is `skipped_history`. If they also traded in the trade's month in each of those years (for an October 2026 trade: October 2025, 2024 and 2023), they are routine (`skipped_routine`); otherwise opportunistic. Only the Form 4s that can cover those years are downloaded (listed via `data.sec.gov/submissions`): the trade month first, the rest of the year only when the month has no trade, and the lookup stops at the first year without any trade. The label is stored on the insider's `insiders` row (`trader_type`, plus the summary and evidence trades in `trader_evaluation`) and never changes: all their later filings reuse it without another lookup (logged in `insider_analyses` with classifier `rule:3y-active+trade-month:stored`). Labels stored by an older rule are recomputed once.
   5. **Price hasn't run:** the latest Alpaca trade is at most 2% above the filing's purchase price (`skipped_price`). Steps 5-8 only run while the market is open (Alpaca's clock); a filing that passes steps 1-4 while it is closed stays `queued` for a later run without using up a retry (counted as *deferred*).
   6. **Market cap of at least $100M**, from Finnhub's company profile (`skipped_market_cap`).
   7. **NYSE or Nasdaq, normal open-market purchase:** the issuer's ticker is an Alpaca `us_equity` listed on `NYSE` or `NASDAQ` (`skipped_listing`), and the purchases' footnotes and the filing's remarks show an ordinary open-market buy, not a transfer, gift, private deal, offering, plan purchase or conversion (`skipped_footnotes`). Keyword rules flag suspicious wording, and Grok (`XAI_MODEL`) reads the footnotes, transaction data and flags and gives the final verdict. The review is stored on the filing (`filings.footnote_review`) and the trade.
   8. **Buy:** a day market buy of `$ALPACA_ORDER_NOTIONAL` (whole shares for stocks Alpaca can't trade fractionally), keyed by the accession number so a filing is never bought twice. The run waits up to 30s for the fill and cancels the order if it hasn't filled. Outside production (`NODE_ENV` other than `production`, e.g. `bun run dev`) no order is sent: reads (assets, clock, prices, order lookups) still hit Alpaca, but the buy is stubbed to fill at once at the screening price, with an order id starting `stub-`. Only a filled buy is posted to `trades`, with the fill quantity and price; an order Alpaca refuses or that doesn't fill is `skipped_order`. If an earlier attempt already placed an order for the filing, that order is picked up instead of screening steps 5-7 again.
3. Everything is stored in **PostgreSQL (`synradb`)** through [Drizzle ORM](https://orm.drizzle.team) on postgres.js. Bought trades go to `stocks` / `insiders` / `trades`; `insiders` also gets a row, with its stored step-4 verdict, for every insider step 4 classifies (the Eraser ERD "Insider Trade Tracking", extended with the insider-criteria evidence, market cap, screening price and the Alpaca order and fill). Alongside them: `filings` (every screened filing and its reason), `insider_analyses` (every step-4 evaluation), `poll_runs`, a `kv` table for the feed cursor, and the `form4_cache` / `issuer_cache` SEC response caches. Trades posted before the rule replaced Grok keep Grok's verdict, with `classifier` set to the model name; trades posted before market orders replaced limit orders keep their (possibly unfilled) limit order.

## Running

```bash
cp .env.example .env   # then fill in SEC_USER_AGENT, ALPACA_KEY / ALPACA_SECRET, FINNHUB_API_KEY and XAI_API_KEY
bun install
make start             # starts the synradb Postgres container in OrbStack, applies migrations, then runs the dev server
```

`make help` lists the other targets (`make db`, `make migrate`, `make generate`, `make studio`, `make db-reset`, `make stop`, `make psql`, `make build`). Without make: `bun run db:up`, `bun run db:migrate`, then `bun run dev`.

Postgres runs from `docker-compose.yml` as container `synradb` (database `synradb`, user/password `synra`). Connect with `bun run db:psql`, `postgres://synra:synra@localhost:5433/synradb?sslmode=disable`, or via OrbStack's domain `synradb.orb.local:5432`.

### Schema changes

The schema is declared once in `lib/db/schema.ts`. To add or change a table:

1. Edit `lib/db/schema.ts`.
2. `bun run db:generate` — drizzle-kit diffs the schema against `drizzle/` and writes a new numbered `.sql` migration (commit it).
3. `bun run db:migrate` — applies pending migrations (also runs on `make start`).

`bun run db:studio` opens Drizzle Studio to browse the data.

Open http://localhost:3000. The dashboard shows signal tiles, the posted trades (click a row for the insider's month-by-year trading grid and the trades behind it), the full pipeline log, and run history. The page is read-only: runs only start when the cron endpoint below is called. Nothing polls on its own. To run one locally, with the dev server up: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/poll`. To rescan, delete the cursor first: `DELETE FROM kv WHERE key = 'feed_cursor_updated'` (the next run looks back `INITIAL_LOOKBACK_HOURS`).

Other commands:

```bash
bun run build && bun run start
```

## Production (Vercel + PlanetScale)

- **Trigger:** set `CRON_SECRET` on Vercel, and have an external scheduler call `GET https://<app>/api/cron/poll` with `Authorization: Bearer $CRON_SECRET`. It answers `202 {"started":true}` right away and runs the poll in `after()`; `409` while a run is active in that instance, `401` without the secret. A run gets a ~220s budget so it finishes inside the function's 300s limit: no filing starts after it, and SEC/Finnhub requests stop at it, so a filing cut off mid-way goes back to the queue (without using an attempt) along with the rest. A lock left by an instance frozen mid-run expires two minutes past that budget, and every call, even a `409`, closes out runs left `running` for over 15 minutes. Since buys only happen while the market is open, schedule at least one call during market hours (9:30-16:00 ET) on weekdays.
- **Database:** PlanetScale Postgres. The app connects through PgBouncer (port 6432) with `PRODUCTION_DATABASE_URL`, as a role with read/write data access (`pg_read_all_data` + `pg_write_all_data`). Migrations need DDL rights, so they use `DIRECT_URL`: a direct connection (port 5432) as a second role that inherits `postgres` (falls back to `PRODUCTION_DATABASE_URL` when unset). Enable both for the Production environment on Vercel; the build needs them. Production deploys migrate automatically: `buildCommand` in `vercel.json` runs `NODE_ENV=production bun run db:migrate` before `next build` when `VERCEL_ENV=production`, and a failed migration fails the build so nothing deploys. Preview builds skip it. To migrate by hand, run `NODE_ENV=production bun run db:migrate`, or `psql "$DIRECT_URL" -f scripts/planet-schema.sql`; both apply only the migrations the database's drizzle journal doesn't list yet. After `bun run db:generate`, run `bun run db:planet-schema` to regenerate the SQL file. The migration lands before the new code goes live, so the previously deployed code runs briefly against the new schema: keep migrations backward compatible (add first; rename or drop columns only in a later deploy, once no deployed code reads them).