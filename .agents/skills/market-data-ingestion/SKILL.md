---
name: market-data-ingestion
description: How to fetch and normalize Bybit V5 market data via POLLING REST in TypeScript/Bun for this platform — kline/OHLCV (positional arrays, newest-first, 1000-row limit, ms timestamps, start/end backward pagination), tickers, orderbook snapshots, funding-rate history, and open interest — plus the `collector` loop that takes periodic price snapshots, normalizing string numerics, deduping on candle close/open time, detecting and backfilling gaps, and upserting rows into MySQL with Drizzle (`onDuplicateKeyUpdate`). There is NO WebSocket — everything is periodic `fetch`. Invoke when the user mentions kline, OHLCV, candles, backfill, funding rate, open interest, orderbook snapshot, tickers, pagination, candle gaps, ms timestamps, the collector/price snapshot loop, or normalizing/storing Bybit market data via Drizzle.
---

# Market Data Ingestion (Bybit V5, TypeScript / Bun, polling)

## When to use this skill
- Backfilling historical OHLCV/kline candles for indicators, the coin-selector, or the optimizer.
- Pulling tickers, funding rate, open interest, or an orderbook snapshot over REST.
- Paginating past the 1000-row per-request kline limit across a long time range.
- Working on the `collector` loop that takes periodic price snapshots.
- Converting Bybit millisecond timestamps and detecting/backfilling missing candles.
- Normalizing raw string payloads and upserting them into MySQL through Drizzle.

## Core concepts
Bybit market-data endpoints are **public** (no signing) under `/v5/market/*`. Every endpoint takes `category` (`linear`/`spot`; this platform is linear-first) and returns the standard `{ retCode, retMsg, result, time }` envelope. **All timestamps are Unix milliseconds** (13 digits) — never seconds. Numeric fields come back as **strings** — cast explicitly.

Two data shapes:
1. **Kline (OHLCV)** — positional arrays, **newest-first**.
2. **Everything else** (tickers, funding, OI, orderbook) — arrays/objects of string fields.

**There is no WebSocket in this codebase.** Live data is obtained by *polling* on interval loops (see the `rest-polling-and-rate-limits` skill). Ingestion = poll REST → normalize → upsert into MySQL, idempotently, with gap detection and backfill.

## Codebase specifics (Bybit / Bun / Drizzle / this platform)
- **Runtime is Bun, language is TypeScript (strict); use global `fetch`.** Market calls are public, so skip the HMAC/signing path (that's the `exchange-integration-bybit` skill, for private calls).
- **The `collector` loop** starts on boot and takes **periodic price snapshots** (typically via `/v5/market/tickers`, which returns many symbols in one call — cheapest way to snapshot prices, funding, and OI at once). It normalizes and writes rows via Drizzle.
- **Storage is MySQL + Drizzle**, schema guaranteed by an idempotent `ensure-schema.ts` (idempotent `ALTER TABLE`, **no migration files**). Inserts are **upserts** via `.onDuplicateKeyUpdate(...)` so re-runs/backfills are safe.
- **Dedup key:** kline on `(symbol, interval, startTime)` where `startTime` is the candle **open** time; enforce it as a unique index so `onDuplicateKeyUpdate` no-ops or refreshes cleanly.
- **Timeouts & rate limits** apply to every poll: wrap `fetch` in `AbortSignal.timeout(...)` and share a rate-limit budget across loops (see the `rest-polling-and-rate-limits` skill). Backfill loops especially must throttle to avoid a 403 IP ban.

### Kline — `GET /v5/market/kline`
Params: `category`, `symbol`, `interval`, `start` (ms), `end` (ms), `limit` (max **1000**, default 200). Intervals: `1,3,5,15,30,60,120,240,360,720` (minutes), `D`, `W`, `M`. `result.list` is an array of arrays, **sorted newest-first**:
```
[ startTime, open, high, low, close, volume, turnover ]   // all strings
```
- `startTime` is the candle **open** time (ms). A "1m" candle at `T` covers `[T, T+60000)`.
- The most recent candle is usually **still forming** — drop or flag it for indicator/backtest inputs.
- Same-shape variants: `/v5/market/mark-price-kline`, `/v5/market/index-price-kline`.

**Backward pagination:** to walk a long range, request a window, take the **oldest** `startTime` returned, set the next `end = oldestStart - 1`, repeat until you pass your target `start` or get an empty list. Reverse each batch to ascending before upserting.

### Tickers — `GET /v5/market/tickers`
Params `category`, optional `symbol`. One call returns a snapshot per symbol: `lastPrice`, `bid1Price`/`ask1Price`, `volume24h`, `turnover24h`, and for `linear`: `fundingRate`, `nextFundingTime`, `openInterest`, `markPrice`, `indexPrice`. This is the `collector`'s workhorse.

### Funding rate history — `GET /v5/market/funding/history`
Params `category` (linear/inverse), `symbol`, `startTime`, `endTime`, `limit` (≤200). Returns `fundingRate` + `fundingRateTimestamp` (ms). Funding **interval varies per symbol** (often 8h, some 1h/4h) — don't assume 8h.

### Open interest — `GET /v5/market/open-interest`
Params `category`, `symbol`, `intervalTime` (`5min`,`15min`,`30min`,`1h`,`4h`,`1d`), `startTime`, `endTime`, `limit` (≤200), plus a `cursor`. Returns `openInterest` + `timestamp` (ms).

### Orderbook snapshot — `GET /v5/market/orderbook`
Params `category`, `symbol`, `limit` (depth). Returns `b` (bids) and `a` (asks) as `[price, size]` string pairs plus `u`/`seq`. This is a **one-shot** snapshot — since there is no WebSocket, re-poll it when you need a fresh book; do not try to maintain a delta-applied local book.

## Implementation checklist
- [ ] Pick `category` (`linear`) and interval; confirm the symbol exists via `instruments-info`.
- [ ] Fetch klines in ≤1000-row pages; page backward with `end = oldestStart - 1`.
- [ ] Reverse each raw batch to ascending time before storing.
- [ ] Cast string OHLCV to numbers (or keep as strings for exact decimal columns); keep timestamps as int ms (UTC).
- [ ] Drop or flag the newest, unclosed candle for indicator inputs.
- [ ] Upsert on `(symbol, interval, startTime)` via Drizzle `onDuplicateKeyUpdate` so re-runs are idempotent.
- [ ] Detect gaps: expected next `startTime = prev + intervalMs`; backfill any hole.
- [ ] Store funding with its per-symbol interval; store OI with its `intervalTime`.
- [ ] Throttle backfill loops (timeout + rate-limit budget) to avoid a 403 IP ban.

## Do / Don't
**Do**
- Treat all timestamps as **milliseconds, UTC**.
- Cast string numerics explicitly; pick a stable stored type.
- Upsert on `(symbol, interval, startTime)` so backfills are idempotent.
- Verify candle continuity and backfill gaps before computing indicators.
- Use `/v5/market/tickers` to snapshot many symbols in one poll.

**Don't**
- Don't assume ascending order — raw kline is newest-first.
- Don't include the forming candle in indicator/backtest inputs.
- Don't assume an 8h funding interval — read the symbol's actual cadence.
- Don't paginate by blindly incrementing time; page off the returned edge timestamp.
- Don't try to maintain a live delta orderbook — there is no WebSocket; re-poll snapshots.
- Don't do string math on prices/volumes (`"0.1" + "0.2"` concatenates).

## Common pitfalls
- **Off-by-one on candle time:** `startTime` is the open, not the close.
- **Silent gaps:** illiquid symbols can skip a candle with zero trades; a naive `prev + interval` walk misaligns. Detect and backfill/forward-fill explicitly.
- **String math:** forgetting to cast corrupts volumes/prices.
- **Reverse-sort forgotten:** appending raw batches yields non-monotonic time and breaks TA.
- **Partial last candle** leaks look-ahead-like noise into signals.
- **Timezone drift:** mixing local time with exchange UTC ms shifts every candle.
- **Missing unique index:** without a unique `(symbol, interval, startTime)`, `onDuplicateKeyUpdate` can't dedup.

## Code patterns
Fetch one kline page (public, timed-out):
```ts
type Kline = [string, string, string, string, string, string, string];

async function fetchKline(
  base: string, symbol: string, interval: string, end: number, limit = 1000,
): Promise<Kline[]> {
  const qs = new URLSearchParams({
    category: "linear", symbol, interval, end: String(end), limit: String(limit),
  });
  const res = await fetch(`${base}/v5/market/kline?${qs}`, { signal: AbortSignal.timeout(10_000) });
  const data = (await res.json()) as { retCode: number; retMsg: string; result: { list: Kline[] } };
  if (data.retCode !== 0) throw new Error(`Bybit ${data.retCode}: ${data.retMsg}`);
  return data.result.list; // newest-first
}
```

Backfill a range ascending + deduped, then find gaps:
```ts
const INTERVAL_MS: Record<string, number> = {
  "1": 60_000, "3": 180_000, "5": 300_000, "15": 900_000,
  "60": 3_600_000, "240": 14_400_000, D: 86_400_000,
};

async function backfill(base: string, symbol: string, interval: string, startMs: number, endMs: number) {
  const out = new Map<number, { t: number; o: number; h: number; l: number; c: number; v: number }>();
  let cursorEnd = endMs;
  while (cursorEnd > startMs) {
    const rows = await fetchKline(base, symbol, interval, cursorEnd);
    if (rows.length === 0) break;
    for (const k of rows) {
      const t = Number(k[0]);
      out.set(t, { t, o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] });
    }
    cursorEnd = Number(rows[rows.length - 1][0]) - 1; // page backward off the oldest
  }
  return [...out.values()].sort((a, b) => a.t - b.t); // ascending, deduped
}

function findGaps(candles: { t: number }[], intervalMs: number) {
  const gaps: [number, number][] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].t - candles[i - 1].t !== intervalMs) gaps.push([candles[i - 1].t, candles[i].t]);
  }
  return gaps;
}
```

Idempotent upsert with Drizzle (MySQL):
```ts
import { sql } from "drizzle-orm";
// klines has a UNIQUE index on (symbol, interval, startTime)
await db.insert(klines).values(
  candles.map((c) => ({ symbol, interval, startTime: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v })),
).onDuplicateKeyUpdate({
  set: { high: sql`values(${klines.high})`, low: sql`values(${klines.low})`, close: sql`values(${klines.close})`, volume: sql`values(${klines.volume})` },
});
```

## References
- [Bybit V5 Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — interval values, array field order, 1000 limit, ms timestamps.
- [Bybit V5 Get Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers) — snapshot with lastPrice, fundingRate, openInterest, markPrice (collector).
- [Bybit V5 Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — fundingRate/timestamp, per-symbol interval note.
- [Bybit V5 Get Open Interest](https://bybit-exchange.github.io/docs/v5/market/open-interest) — intervalTime options, cursor pagination.
- [Bybit V5 Get Orderbook](https://bybit-exchange.github.io/docs/v5/market/orderbook) — REST snapshot, b/a pairs, u/seq fields.
- [Bybit V5 Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — validate symbols, tick/lot filters.
- [Bybit V5 Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — throttle backfill polls to avoid IP bans.
- [Drizzle ORM — Insert & Upsert](https://orm.drizzle.team/docs/insert) — `.onDuplicateKeyUpdate({ set })` for idempotent MySQL upserts.
- [Drizzle ORM — Upsert guide](https://orm.drizzle.team/docs/guides/upsert) — multi-row upsert with `sql\`values(...)\``.
- [Bun fetch / Web APIs](https://bun.com/docs/runtime/web-apis) — global `fetch` and Web Standard APIs on Bun.
- [MDN AbortSignal.timeout()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static) — per-poll fetch timeouts.
