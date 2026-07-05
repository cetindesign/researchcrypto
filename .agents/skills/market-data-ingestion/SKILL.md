---
name: market-data-ingestion
description: How to fetch and normalize Bybit V5 market data in Python — OHLCV/kline (intervals, response array order, reverse-chronological sort, 1000-row limit, start/end pagination), orderbook snapshots, recent public trades, funding-rate history, open interest, and tickers — plus timestamp handling in milliseconds, detecting and backfilling missing candles/gaps, deduplicating on close time, storing normalized records, and choosing REST vs WebSocket. Invoke when the user mentions kline, OHLCV, candles, historical data backfill, funding rate, open interest, orderbook snapshot, recent trades, pagination of market data, candle gaps, timestamp/ms conversion, or normalizing/storing market data for backtests or indicators.
---

# Market Data Ingestion (Bybit V5, Python)

## When to use this skill
- Backfilling historical OHLCV/kline candles for indicators or backtests.
- Pulling funding rate, open interest, orderbook snapshots, or recent trades.
- Paginating past the 1000-row per-request limit over a long time range.
- Converting Bybit millisecond timestamps and detecting missing candles/gaps.
- Deciding REST (batch/history) vs WebSocket (live) for a data source.
- Normalizing raw exchange payloads into a consistent stored schema.

## Core concepts
Bybit market-data endpoints are **public** (no signing) under `/v5/market/*`. Every endpoint takes `category` (`spot`/`linear`/`inverse`/`option`) and returns the standard `{retCode, retMsg, result, time}` envelope. **All timestamps are Unix milliseconds** (13 digits) — never seconds.

Two data-shape families:
1. **Kline (OHLCV)** — returned as arrays (positional), newest-first.
2. **Everything else** (trades, funding, OI, tickers) — arrays of JSON objects.

Ingestion generally means: **backfill history over REST**, then **switch to WebSocket for the live tail** (see the `realtime-websocket-streaming` skill), stitching the two so no candle is dropped or double-counted.

## Bybit / Python specifics

### Kline — `GET /v5/market/kline`
Params: `category`, `symbol`, `interval`, `start` (ms), `end` (ms), `limit` (max **1000**, default 200).
Interval values: `1, 3, 5, 15, 30, 60, 120, 240, 360, 720` (minutes), `D`, `W`, `M`.
Response `result.list` is an array of arrays, **sorted in reverse by start time (newest first)**:
```
[ startTime, openPrice, highPrice, lowPrice, closePrice, volume, turnover ]
```
- `startTime` is the candle's **open** time in ms.
- All numeric fields are **strings** — cast explicitly.
- The most recent candle is usually **still forming** (not closed); drop or flag it unless you want partial data.
- Related variants: `/v5/market/mark-price-kline`, `/v5/market/index-price-kline`, `/v5/market/premium-index-price-kline` (same shape).

**Pagination:** the window is bounded by count (≤1000) AND by `start`/`end`. To walk a long range, iterate: request a window, take the oldest `startTime` returned, set the next request's `end = oldestStart - 1`, and repeat until you pass your target `start` or get an empty list. Reverse each batch to ascending before appending. Note: **spot has no time-based pagination cursor** the way you might expect — rely on `start`/`end`/`limit` windowing for all categories.

### Recent public trades — `GET /v5/market/recent-trade`
Params `category`, `symbol`, `limit` (spot ≤60, others ≤1000). Returns recent prints only (not deep history): `execId`, `price`, `size`, `side`, `time` (ms), `isBlockTrade`. For full trade history use the private execution endpoint or a WS `publicTrade` capture.

### Funding rate history — `GET /v5/market/funding/history`
Params `category` (linear/inverse), `symbol`, `startTime`, `endTime`, `limit` (≤200). Returns `fundingRate` and `fundingRateTimestamp` (ms) per settlement. Funding **interval varies per symbol** (commonly 8h, some 1h/4h) — do not assume 8h. The current/next funding rate is on the ticker, not here.

### Open interest — `GET /v5/market/open-interest`
Params `category` (linear/inverse), `symbol`, `intervalTime` (`5min`,`15min`,`30min`,`1h`,`4h`,`1d`), `startTime`, `endTime`, `limit` (≤200), plus a `cursor` for pagination. Returns `openInterest` + `timestamp` (ms).

### Tickers — `GET /v5/market/tickers`
Params `category`, optional `symbol`. One call returns a snapshot per symbol: `lastPrice`, `bid1Price`/`ask1Price`, `volume24h`, `turnover24h`, and for derivatives `fundingRate`, `nextFundingTime`, `openInterest`, `markPrice`, `indexPrice`. Cheapest way to get current funding & OI for many symbols at once.

### Orderbook snapshot — `GET /v5/market/orderbook`
Params `category`, `symbol`, `limit` (depth; e.g. spot ≤200, linear/inverse ≤500). Returns `b` (bids) and `a` (asks) as `[price, size]` string pairs, plus `u` (update id) and `seq`. This is a one-shot REST snapshot; for a maintained live book use the WebSocket delta stream.

### pybit and CCXT
```python
from pybit.unified_trading import HTTP
s = HTTP(testnet=False)
kl = s.get_kline(category="linear", symbol="BTCUSDT", interval="1", limit=1000)
fr = s.get_funding_rate_history(category="linear", symbol="BTCUSDT", limit=200)
oi = s.get_open_interest(category="linear", symbol="BTCUSDT", intervalTime="1h")

import ccxt
ex = ccxt.bybit()
# CCXT returns ms-normalized ascending OHLCV: [ts, o, h, l, c, v]
rows = ex.fetch_ohlcv('BTC/USDT:USDT', '1m', since=None, limit=1000,
                      params={'category': 'linear'})
```
CCXT's `fetch_ohlcv` normalizes to ascending order and numeric types, which removes the reverse-sort and string-cast chores — but you still handle pagination via `since` looping.

## Implementation checklist
- [ ] Pick interval and category; confirm the symbol exists via `instruments-info`.
- [ ] Fetch in ≤1000-row pages; page backward with `end = oldestStart - 1`.
- [ ] Reverse each raw kline batch to ascending time before storing.
- [ ] Cast OHLCV strings to `Decimal`/float; keep timestamps as int ms (or tz-aware UTC).
- [ ] Drop or flag the newest, unclosed candle (or check `confirm` on the WS feed).
- [ ] Deduplicate on `(symbol, interval, startTime)`; upsert idempotently.
- [ ] Detect gaps: expected next `startTime = prev + interval_ms`; backfill any hole.
- [ ] Store funding with its per-symbol interval; store OI with its `intervalTime`.
- [ ] Stitch REST backfill to the live WS tail with overlap, then dedupe.

## Do / Don't
**Do**
- Treat all timestamps as **milliseconds, UTC**.
- Cast string numerics explicitly; store canonical types.
- Upsert on `(symbol, interval, open_time)` so re-runs are idempotent.
- Verify candle continuity and backfill gaps before computing indicators.
**Don't**
- Don't assume ascending order — raw kline is newest-first.
- Don't include the forming candle in indicator/backtest inputs.
- Don't assume an 8h funding interval — read the symbol's actual cadence.
- Don't paginate by blindly incrementing time; page off the returned edge timestamp.
- Don't double-count the REST/WS overlap when stitching live to history.

## Common pitfalls
- **Off-by-one on candle time**: `startTime` is the open, not the close. A "1m" candle at `startTime=T` covers `[T, T+60000)`.
- **Silent gaps**: exchanges can skip a candle when there are zero trades in illiquid symbols; a naive `prev+interval` walk will then misalign. Detect and either backfill or forward-fill explicitly.
- **String math**: `"0.1" + "0.2"` concatenates; forgetting to cast corrupts volumes/prices.
- **Reverse-sort forgotten**: appending raw batches yields non-monotonic time and breaks TA libraries.
- **Partial last candle** leaks look-ahead-like noise into signals.
- **Timezone drift**: mixing local time with exchange UTC ms shifts every candle.

## Code patterns
Backfill a full range, ascending & deduped:
```python
def backfill_kline(session, category, symbol, interval, start_ms, end_ms):
    interval_ms = {"1":60_000, "3":180_000, "5":300_000, "15":900_000,
                   "60":3_600_000, "240":14_400_000, "D":86_400_000}[interval]
    out, cursor_end = {}, end_ms
    while cursor_end > start_ms:
        r = session.get_kline(category=category, symbol=symbol,
                              interval=interval, end=cursor_end, limit=1000)
        rows = r["result"]["list"]           # newest-first arrays of strings
        if not rows:
            break
        for k in rows:
            t = int(k[0])
            out[t] = (t, float(k[1]), float(k[2]), float(k[3]),
                      float(k[4]), float(k[5]), float(k[6]))
        cursor_end = int(rows[-1][0]) - 1     # page backward off oldest
    return [out[t] for t in sorted(out)]      # ascending, deduped

def find_gaps(candles, interval_ms):
    return [(candles[i-1][0], candles[i][0])
            for i in range(1, len(candles))
            if candles[i][0] - candles[i-1][0] != interval_ms]
```

## References
- [Bybit V5 Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — endpoint, interval values, array field order, 1000 limit, ms timestamps.
- [Bybit V5 Get Recent Public Trades](https://bybit-exchange.github.io/docs/v5/market/recent-trade) — recent prints, per-category limits.
- [Bybit V5 Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — fundingRate/timestamp, per-symbol interval note.
- [Bybit V5 Get Open Interest](https://bybit-exchange.github.io/docs/v5/market/open-interest) — intervalTime options, cursor pagination.
- [Bybit V5 Get Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers) — snapshot with fundingRate, openInterest, markPrice.
- [Bybit V5 Get Orderbook](https://bybit-exchange.github.io/docs/v5/market/orderbook) — REST snapshot, b/a pairs, u/seq fields.
- [Bybit V5 Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — validate symbols, tick/lot filters.
- [Bybit V5 Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — throttle backfill loops to avoid IP bans.
- [pybit (official Python SDK)](https://github.com/bybit-exchange/pybit) — get_kline, get_funding_rate_history, get_open_interest.
- [CCXT documentation](https://docs.ccxt.com/) — fetch_ohlcv normalization (ascending, ms, numeric) and `since` pagination.
