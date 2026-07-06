---
name: mysql-drizzle-data-layer
description: Design and evolve the data layer for this Bun + TypeScript multi-bot Bybit platform — MySQL accessed through Drizzle ORM. Covers Drizzle schema for candles/price snapshots, orders/fills, per-user bot config, and the audit tables v3_decision_log and v3_position_event; indexing on (symbol, time); using DECIMAL columns / strings for price and quantity precision (never float); idempotent upserts; and the DB-as-ledger principle. Crucially there are NO migration files — schema is guaranteed by an idempotent ensure-schema.ts that runs ALTER TABLE ... IF NOT EXISTS style guards on boot. Invoke when the user mentions Drizzle schema, mysqlTable, DECIMAL vs float, price precision, (symbol,time) index, candle/snapshot storage, order/fill tables, decision log, position event, audit ledger, ensure-schema, no migrations, onDuplicateKeyUpdate, or when to use TimescaleDB. This codebase uses plain MySQL, not TimescaleDB/Influx/Postgres.
---

# MySQL + Drizzle Data Layer

## When to use this skill
- Defining or extending a Drizzle table (candles, snapshots, orders, fills, config, audit) in the shared DB package.
- Deciding column types for money — `decimal` vs `float` — and how prices/qtys are stored and read.
- Adding an index on `(symbol, time)` (or `(symbol, orderLinkId)`) for fast engine reads.
- Writing or extending `ensure-schema.ts` guards instead of adding a migration file.
- Recording an audit row in `v3_decision_log` (why the engine did X) or `v3_position_event` (what happened).
- Answering "should we move to TimescaleDB?" — know the trade-off, but this platform stays on plain MySQL.

## Core concepts
- **DB as accounting ledger.** The DB is not the source of truth for live positions — the exchange is (see `reconcile-source-of-truth`). The DB records what we *believe* and, in the audit tables, *why we acted*. It must be append-friendly and reconstructable.
- **Idempotent schema, no migrations.** There are no versioned migration files. On boot, `ensure-schema.ts` runs `CREATE TABLE IF NOT EXISTS` and column/index guards (`ADD COLUMN` wrapped so re-runs are safe). Deploy = push to `main` → Dokploy rebuilds one container → boot re-runs ensure-schema. Schema changes are additive and backward-compatible.
- **Exact decimals, never float.** Prices, quantities, and PnL use MySQL `DECIMAL` (fixed-point, exact) — `float`/`double` are approximate and break equality/accumulation. In Drizzle, `decimal()` reads back as a **string** by default; keep money as strings end-to-end and only convert at math boundaries.
- **`(symbol, time)` indexing.** Time-series tables (candles, snapshots, events) are almost always queried "latest rows for this symbol" — a composite index on `(symbol, time)` makes those range scans cheap.
- **Idempotent writes.** Because the loop retries and polls, inserts must tolerate replays. Use `insert().onDuplicateKeyUpdate()` keyed on a natural unique key (e.g. `(symbol, interval, bucketStart)` for candles, `orderLinkId` for orders) so a re-run updates instead of duplicating.
- **Audit tables are immutable.** `v3_decision_log` and `v3_position_event` are append-only. Never `UPDATE`/`DELETE` them; they are the forensic trail when a bot misbehaves.

## Codebase specifics (Drizzle / MySQL / this platform)
- **Schema in a shared package**, imported by the engine, the collector, the tRPC API, and `ensure-schema.ts`. Types flow from Drizzle inference — no hand-written row interfaces.
- **`ensure-schema.ts` runs first** in the boot sequence, before the collector and the v3 Bybit engine start. It guarantees every column the current code references exists.
- **Candles/snapshots** come from the collector polling Bybit REST (`GET /v5/market/kline`), which returns arrays of **strings** — store them straight into `decimal`/`varchar` without a `parseFloat`.
- **Orders/fills** mirror Bybit `GET /v5/order/realtime` and `GET /v5/execution/list`; key orders by `orderLinkId` (our idempotency key) so reconcile can match DB rows to exchange orders.
- **`v3_decision_log`**: one row per engine decision (symbol, action, chosen candidate, guard results, snapshot of inputs) — written every tick.
- **`v3_position_event`**: one row per state transition (opened, closed, TP/SL hit, partial fill, drift detected during reconcile). This is where discrepancies from reconcile land.
- **Timestamps**: Bybit sends epoch milliseconds. Store as `bigint` (raw ms) and/or `timestamp`; be consistent and keep everything UTC.

## When TimescaleDB would help (and why we don't use it here)
- TimescaleDB (a Postgres extension) auto-partitions a table into time **chunks** (hypertables), adds continuous aggregates and columnar compression — genuinely better for very high-cardinality tick ingest and heavy analytical rollups.
- This platform stays on **plain MySQL**: volume is modest (periodic snapshots every few seconds, not per-trade tick firehose), the team already runs MySQL + Drizzle, and a single container with idempotent ensure-schema is the deploy model. Reach for Timescale only if snapshot volume grows into the "millions of rows/day, need automatic retention + rollups" regime — otherwise a `(symbol, time)` index on MySQL is enough.

## Implementation checklist
- [ ] Define each table in the shared Drizzle schema with `decimal` for price/qty/PnL and a `(symbol, time)` index where relevant.
- [ ] Give every replay-prone table a natural unique key and write via `insert().onDuplicateKeyUpdate()`.
- [ ] Add a guard in `ensure-schema.ts` for every new column/index — never assume a migration ran.
- [ ] Keep `v3_decision_log` and `v3_position_event` append-only; no update/delete paths.
- [ ] Read decimals as strings; only `Number(...)`/`BigInt(...)` at the math boundary, then store back as string.
- [ ] Store Bybit ms timestamps consistently (UTC) and index the time column used for range scans.

## Do / Don't
- **Do** use `decimal(precision, scale)` for anything monetary and keep it as a string.
- **Do** make writes idempotent with `onDuplicateKeyUpdate` on a natural key.
- **Do** guarantee schema through `ensure-schema.ts` guards, additive and re-runnable.
- **Don't** add a `drizzle-kit` migration file or destructive `ALTER` to this repo's flow — deploys re-run ensure-schema.
- **Don't** store prices as `float`/`double` or do `parseFloat` on Bybit strings before persisting.
- **Don't** `UPDATE`/`DELETE` audit rows — they are the ledger.
- **Don't** treat DB rows as authoritative for live positions; the exchange is (reconcile pattern).

## Common pitfalls
- **Float creep.** A single `Number()` round-trip through storage silently corrupts PnL over many trades — keep decimals as strings.
- **Missing unique key.** Without a natural unique key, poll replays insert duplicate candles/orders; add the key and upsert.
- **Forgotten ensure-schema guard.** Code references a column that only exists on your laptop; add the guard so the container has it on boot.
- **Unindexed time scans.** "Latest snapshot per symbol" without `(symbol, time)` turns into full-table scans as data grows.
- **Timezone drift.** Mixing local time and Bybit UTC ms produces off-by-hours bugs in candles/events.

## Code patterns

```ts
// packages/db/schema.ts — candles + audit tables, decimals + (symbol,time) index
import { mysqlTable, varchar, decimal, bigint, int, json, index, uniqueIndex } from "drizzle-orm/mysql-core";

export const candles = mysqlTable("v3_candle", {
  symbol:      varchar("symbol", { length: 32 }).notNull(),
  interval:    varchar("interval", { length: 8 }).notNull(),
  bucketStart: bigint("bucket_start", { mode: "number" }).notNull(), // Bybit ms
  open:  decimal("open",  { precision: 38, scale: 12 }).notNull(),
  high:  decimal("high",  { precision: 38, scale: 12 }).notNull(),
  low:   decimal("low",   { precision: 38, scale: 12 }).notNull(),
  close: decimal("close", { precision: 38, scale: 12 }).notNull(),
  volume:decimal("volume",{ precision: 38, scale: 12 }).notNull(),
}, (t) => [
  uniqueIndex("candle_uq").on(t.symbol, t.interval, t.bucketStart), // idempotency key
  index("candle_symbol_time").on(t.symbol, t.bucketStart),
]);

export const positionEvent = mysqlTable("v3_position_event", {
  id:       bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  ts:       bigint("ts", { mode: "number" }).notNull(),
  botId:    varchar("bot_id", { length: 64 }).notNull(),
  symbol:   varchar("symbol", { length: 32 }).notNull(),
  kind:     varchar("kind", { length: 32 }).notNull(),   // opened | closed | tp_hit | drift | ...
  detail:   json("detail").notNull(),                    // snapshot of exchange vs db
}, (t) => [ index("posevt_symbol_time").on(t.symbol, t.ts) ]);
```

```ts
// Idempotent candle upsert — safe under poll replays
await db.insert(candles).values(rows)
  .onDuplicateKeyUpdate({ set: { close: sql`values(${candles.close})`, volume: sql`values(${candles.volume})` } });
```

```ts
// ensure-schema.ts — idempotent guards run on boot; NO migration files
export async function ensureSchema(db: MySql2Database) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS v3_candle ( /* ... */ )`);
  // additive column guard, re-runnable
  await db.execute(sql`
    SET @exists := (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name='v3_candle' AND column_name='turnover');`);
  await db.execute(sql`
    SET @ddl := IF(@exists=0, 'ALTER TABLE v3_candle ADD COLUMN turnover DECIMAL(38,12) NULL', 'SELECT 1');`);
  await db.execute(sql`PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;`);
}
```

```ts
// Read decimals as strings; convert only at the math boundary
const [row] = await db.select().from(candles).where(eq(candles.symbol, "BTCUSDT")).orderBy(desc(candles.bucketStart)).limit(1);
const close = Number(row.close);   // string -> number ONLY for a calculation
// ...store any derived money value back as a string into a decimal column
```

## References
- [Drizzle ORM — MySQL column types](https://orm.drizzle.team/docs/column-types/mysql) — `decimal`, `bigint`, `varchar`, `json`; decimal reads as string.
- [Drizzle ORM — SQL schema declaration](https://orm.drizzle.team/docs/sql-schema-declaration) — `mysqlTable`, typed columns, inference.
- [Drizzle ORM — Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints) — composite `index()` / `uniqueIndex()` on `(symbol, time)`.
- [Drizzle ORM — Insert / upsert](https://orm.drizzle.team/docs/insert) — `onDuplicateKeyUpdate` for idempotent writes.
- [Drizzle ORM — MySQL upsert guide](https://orm.drizzle.team/docs/guides/upsert) — `sql\`values(...)\`` multi-row upsert.
- [MySQL — Fixed-Point Types (DECIMAL, NUMERIC)](https://dev.mysql.com/doc/refman/8.4/en/fixed-point-types.html) — exact numeric for money.
- [MySQL — Floating-Point Types](https://dev.mysql.com/doc/refman/8.0/en/floating-point-types.html) — why FLOAT/DOUBLE are approximate (avoid for prices).
- [Bybit V5 — Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — candle arrays returned as strings.
- [Bybit V5 — Get Trade History (executions)](https://bybit-exchange.github.io/docs/v5/order/execution) — `/v5/execution/list` fills to persist.
- [TimescaleDB (Postgres extension)](https://github.com/timescale/timescaledb) — hypertables/CAGGs; context for when time-series scaling would justify it.
- [Understand hypertables — Tiger Data docs](https://www.tigerdata.com/docs/learn/hypertables/understand-hypertables) — chunking/partitioning trade-offs vs plain MySQL.
