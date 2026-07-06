---
name: timeseries-data-storage
description: Design storage for Bybit market and trading data — choosing between TimescaleDB (hypertables, continuous aggregates, native compression, retention policies), InfluxDB, plain PostgreSQL, and Parquet; schema design for OHLCV candles, raw trades/ticks, orders and fills; indexing on (symbol, time); downsampling and higher-timeframe rollups; and avoiding float rounding on prices by using NUMERIC/Decimal. Invoke when the user mentions storing candles/OHLCV, tick data, trade history, order/fill logging, TimescaleDB, hypertable, continuous aggregate, compression, retention policy, InfluxDB, Parquet, time-series schema, (symbol,time) index, downsampling, backfill, or price precision / Decimal vs float in the database.
---

# Time-Series Data Storage

## When to use this skill
- Choosing a datastore for OHLCV candles, raw trades/ticks, or order/fill history from Bybit.
- Designing a TimescaleDB hypertable and its chunk interval, indexes, and compression policy.
- Building continuous aggregates to roll 1m candles up to 5m/1h/1d without recomputation.
- Setting retention: keep raw ticks 30 days, keep aggregated candles for years.
- Picking `NUMERIC`/`Decimal` over `float` to avoid price rounding errors.
- Deciding when Parquet (cold storage / backtest datasets) beats a live database.

## Core concepts
- **OHLCV**: open, high, low, close, volume per (symbol, interval, bucket-start-time). The canonical candle row.
- **Ticks/trades**: individual executions (price, size, side, timestamp) — highest cardinality, largest volume.
- **Hypertable**: a Postgres table TimescaleDB auto-partitions by time into **chunks** (child tables). You query one logical table; it prunes chunks by time range for fast reads.
- **Chunk interval**: the time span per chunk. Rule of thumb: size so one chunk (plus its indexes) fits ~25% of RAM. Too small = planning overhead; too large = poor pruning/compression.
- **Continuous aggregate (CAGG)**: an incrementally, automatically refreshed materialized view — the convenience of a view with the speed of a table. Roll 1m→1h candles cheaply; you can layer CAGGs on top of CAGGs (hierarchical rollups).
- **Compression**: TimescaleDB converts old row-oriented chunks to columnar storage (typical 10–20x), set by `segmentby`/`orderby`. Compressed chunks are read-mostly.
- **Retention policy**: a background job that drops chunks older than a threshold — cheap because it drops whole chunks, not row-by-row `DELETE`.
- **Downsampling**: producing lower-resolution series (ticks→1m→1h) so you retain long history without keeping every tick.

## Storage choice (pick per workload)
- **TimescaleDB** (default for this platform): full SQL/ACID on Postgres, joins to your relational bot/order tables, hypertables + CAGGs + compression + retention. Outperforms plain Postgres greatly on complex time queries and high cardinality (many symbols). Best when you already use Postgres and need mixed relational + time-series with exact `NUMERIC`.
- **Plain PostgreSQL**: fine for low volume / MVP; you lose automatic partitioning, CAGGs, and columnar compression — large tables and retention become painful.
- **InfluxDB**: excellent on-disk compression and purpose-built ingest, but its own query model (Flux/line protocol), weaker for relational joins and exact-decimal money math.
- **Parquet** (Arrow/pandas/pyarrow): columnar files with the best compression (10–20:1); ideal for **cold storage**, backtest datasets, and sharing — but it is files, not a live queryable transactional store. Partition by `symbol`/`date`.

## Bybit / Python specifics
- Bybit V5 kline via `GET /v5/market/kline` returns `[startTime, open, high, low, close, volume, turnover]` as **strings** — parse prices with `Decimal`, not `float`. WebSocket `publicTrade` and `kline` topics stream live data to ingest.
- Bybit timestamps are **epoch milliseconds** (UTC). Store as `TIMESTAMPTZ` in UTC; convert ms→timestamp on ingest and keep the raw ms if you need exact reconstruction.
- Kline `confirm` flag on the WS `kline` topic marks a closed candle — only persist confirmed candles to OHLCV, or upsert the forming candle and finalize on `confirm=true`.
- Ingest path in Python: `pybit`/`ccxt` → validate → `psycopg`/`asyncpg` `COPY` or batched inserts. Use `ON CONFLICT (symbol, interval, bucket) DO UPDATE` for idempotent candle upserts (handles reconnect replays).
- Use `numeric(38, 12)` (or per-asset scale) for price/qty; Python `Decimal` maps cleanly, and psycopg returns `Decimal`.

## Implementation checklist
- [ ] Create OHLCV, trades, and orders/fills tables with `TIMESTAMPTZ` time + `NUMERIC` price/qty.
- [ ] `SELECT create_hypertable('trades','time', chunk_time_interval => INTERVAL '1 day');` (candles: larger interval, e.g. 7 days).
- [ ] Composite index `(symbol, time DESC)` — the platform queries "latest N for one symbol".
- [ ] Idempotent candle writes: `UNIQUE (symbol, interval, bucket)` + `ON CONFLICT ... DO UPDATE`.
- [ ] Continuous aggregates for 5m/1h/1d from base candles via `time_bucket`; add refresh policies.
- [ ] Compression policy on chunks older than N days (`segmentby => 'symbol'`, `orderby => 'time DESC'`).
- [ ] Retention policy: drop raw ticks after ~30 days; keep aggregated candles for years.
- [ ] Nightly export of finalized history to partitioned Parquet for backtests / cold storage.

## Do / Don't
**Do**
- Store prices, quantities, fees, and PnL as `NUMERIC`/`Decimal`.
- Store all timestamps as UTC `TIMESTAMPTZ`; bucket with `time_bucket`.
- Make candle ingestion idempotent so WS reconnect replays don't duplicate rows.
- Set compression + retention policies so tables don't grow unbounded.
- Index on `(symbol, time)` because every query filters by symbol and a time range.

**Don't**
- Don't use `float`/`double precision` for prices — `0.1+0.2` style drift corrupts PnL and triggers.
- Don't run row-by-row `DELETE` for cleanup on huge tables; use a retention policy (drops chunks).
- Don't try to `UPDATE`/back-fill inside already-compressed chunks without decompressing first.
- Don't pick a tiny chunk interval (e.g. 1 hour) for years of data — thousands of chunks slow planning.
- Don't store only aggregated candles if you'll ever need to re-derive finer resolution — keep raw for the retention window.

## Common pitfalls
- **Float rounding**: `real`/`double` round ties to even and store approximations; `numeric` is exact and rounds away from zero. Money = `numeric`, always.
- **Chunk sizing**: too large hurts compression and memory; too small explodes chunk count. Target chunk+indexes ≈ 25% RAM.
- **CAGG real-time gaps**: without a refresh policy (or `materialized_only=false`), recent buckets may lag; understand the refresh window vs your latest data.
- **Timezone drift**: mixing local time and UTC makes `time_bucket` boundaries wrong; normalize to UTC at ingest.
- **Duplicate candles on reconnect**: WS gives overlapping data after a drop — rely on the unique key + upsert.
- **Writing to compressed chunks**: inserts/updates into compressed chunks need decompression (or newer TimescaleDB's limited support) — plan late-arriving data for the uncompressed window.

## Code patterns
```sql
-- OHLCV hypertable with exact numeric prices
CREATE TABLE ohlcv (
  symbol   text        NOT NULL,
  interval text        NOT NULL,          -- '1','5','60','D' (Bybit kline codes)
  bucket   timestamptz NOT NULL,          -- candle start, UTC
  open     numeric(38,12) NOT NULL,
  high     numeric(38,12) NOT NULL,
  low      numeric(38,12) NOT NULL,
  close    numeric(38,12) NOT NULL,
  volume   numeric(38,12) NOT NULL,
  PRIMARY KEY (symbol, interval, bucket)
);
SELECT create_hypertable('ohlcv','bucket', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX ON ohlcv (symbol, bucket DESC);

-- 1h candles as a continuous aggregate from 1m base candles
CREATE MATERIALIZED VIEW ohlcv_1h
WITH (timescaledb.continuous) AS
SELECT symbol,
       time_bucket('1 hour', bucket) AS bucket,
       first(open,  bucket) AS open,
       max(high)            AS high,
       min(low)             AS low,
       last(close, bucket)  AS close,
       sum(volume)          AS volume
FROM ohlcv WHERE interval = '1'
GROUP BY symbol, time_bucket('1 hour', bucket);

SELECT add_continuous_aggregate_policy('ohlcv_1h',
  start_offset => INTERVAL '3 hours', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- compress chunks >7d, drop raw ticks >30d
ALTER TABLE trades SET (timescaledb.compress, timescaledb.compress_segmentby = 'symbol');
SELECT add_compression_policy('trades', INTERVAL '7 days');
SELECT add_retention_policy('trades', INTERVAL '30 days');
```
```python
# idempotent candle upsert (asyncpg), Decimal in -> Decimal out
await conn.execute(
    """INSERT INTO ohlcv(symbol,interval,bucket,open,high,low,close,volume)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (symbol,interval,bucket)
       DO UPDATE SET high=GREATEST(ohlcv.high, EXCLUDED.high),
                     low =LEAST(ohlcv.low,  EXCLUDED.low),
                     close=EXCLUDED.close, volume=EXCLUDED.volume""",
    symbol, "1", bucket, o, h, l, c, v)  # o..v are Decimal
```

## References
- [TimescaleDB (GitHub)](https://github.com/timescale/timescaledb) — Postgres extension for hypertables, compression, continuous aggregates.
- [About continuous aggregates — Tiger Data (TimescaleDB) Docs](https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates) — incremental materialized views, refresh policies, hierarchical rollups.
- [Continuous aggregates reference — Tiger Data Docs](https://www.tigerdata.com/docs/reference/timescaledb/continuous-aggregates) — CAGG syntax, `time_bucket`, real-time aggregation.
- [PostgreSQL: Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html) — why `numeric` is exact and `float` isn't; rounding behavior for money.
- [Working with Money in Postgres — Crunchy Data](https://www.crunchydata.com/blog/working-with-money-in-postgres) — `numeric` vs float/money for currency, precision tradeoffs.
- [InfluxDB vs TimescaleDB — InfluxData](https://www.influxdata.com/comparison/influxdb-vs-timescaledb/) — compression, ingest, and query-model differences.
- [Comparing InfluxDB, TimescaleDB, and QuestDB — QuestDB](https://questdb.com/blog/comparing-influxdb-timescaledb-questdb-time-series-databases/) — cardinality, compression, and query benchmarks.
- [Bybit V5 — Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — OHLCV response fields (strings), interval codes, epoch-ms timestamps.
