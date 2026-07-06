---
name: coin-universe-selection
description: How Bulucu (Finder) builds and scores the two-tier tradeable universe on Bybit USDⓈ-M perps for the SkyPower V3 fleet — the "scan wide, open few" candidate list other bots read. Covers exact Tier-A (Kayıkçı) vs Tier-B (Avcı-only) gates (24h turnover 100M/10-20M, spread 0.05%/0.15%, per-side depth ±2% 250k/100k, listing age 30d/7d, ATR%(14,1h) 1-5%/2-8%, OI floor 20M/5M USD), the volume/mcap 5-15% wash-trade filter, Amihud-style dynamic universe refreshed monthly, computing per-side depth and spread from the Bybit orderbook REST snapshot, sizing vs ±1% depth, and storing the scored universe in MySQL/Drizzle. Pure-core scoring plus dirty-shell poller; documentation-only. Invoke when the user mentions coin universe, symbol selection, Bulucu, Finder, coin scanner/scoring, Tier-A/Tier-B, liquidity screen, orderbook depth, spread filter, wash-trade filter, volume/mcap, Amihud illiquidity, listing age, ATR% filter, OI floor, candidate list, or refreshing the tradeable universe.
---

# Coin Universe Selection (Bulucu / Finder, Bybit USDⓈ-M, TypeScript / Bun)

## When to use this skill
- Building the fleet's **candidate list**: which Bybit linear perps are tradeable this month, split into Tier-A and Tier-B.
- Implementing **Bulucu**, the non-trading Finder bot (`engine_enabled: 0`, capital $0) that scores the universe and serves it to Kayıkçı/Avcı.
- Computing per-side **orderbook depth (±1%/±2%)** and **spread** from a REST snapshot and turning them into a liquidity score.
- Applying the **volume/mcap wash-trade filter** and an **Amihud-style illiquidity** ranking.
- Deciding position size relative to available depth, and deciding **which universe partition** a bot may open in.
- Scheduling the **monthly refresh** and persisting the scored universe to MySQL so other loops read a stable snapshot.

## Core concepts
Bulucu turns the whole Bybit USDⓈ-M perp board into a small, ranked, liquidity-vetted **candidate list**. The governing rule is **"scan wide, open few"**: Bulucu evaluates 80–150 symbols, but the trading bots open only a handful (Kayıkçı 10–15, Avcı 1–3). The correct lever when you want more trades is to **widen scanning**, never to lower the entry threshold.

**Two tiers, one board.** Every symbol is graded against a hard-gate table. Passing the strict gates makes it **Tier-A** (safe for Kayıkçı's many small positions); passing only the looser gates makes it **Tier-B** (Avcı-only, and only with a higher signal threshold). Failing both drops it from the universe.

| Kriter | Tier-A (Kayıkçı) | Tier-B (Avcı only) |
|---|---|---|
| 24h volume (turnover, USD) | ≥ $100M | ≥ $10–20M |
| Spread | ≤ 0.05% | ≤ 0.15% |
| Depth ±2% (per side) | ≥ $250k | ≥ $100k |
| Listing age | ≥ 30d | ≥ 7d |
| ATR% (14, 1h) | 1–5% | 2–8% |
| OI floor (USD) | ≥ $20M | ≥ $5M |

**Why liquidity is the whole game.** SkyPower's #1 problem is cost: taker 0.055% / maker 0.02% commissions plus slippage on thin "ince-coin" books can eat the entire edge. A position must be a **small fraction of the ±1% depth per side** or its own market impact turns a winning signal into a loss. Depth and spread are therefore first-class gates, not nice-to-haves.

**Wash-trade filter.** Reported 24h volume is routinely inflated. Cross-check turnover against market cap: a healthy **volume/mcap ratio is roughly 5–15%**; an extreme ratio combined with a thin book is a wash-trade red flag — drop the symbol regardless of headline volume. (mcap = last price × circulating supply; supply comes from an external source, not Bybit — keep it optional and degrade gracefully.)

**Amihud-style dynamic universe.** Beyond the static gates, rank surviving symbols by an **Amihud illiquidity** estimate — the average of `|daily return| / daily dollar volume` over a lookback. Lower = more liquid = safer for size. This makes the universe *dynamic*: as a coin's real liquidity decays, its Amihud score rises and it slides down (or out of) the ranking. Refresh the whole universe **monthly**, not every tick — the universe is a slow-moving structural view, not an execution signal.

**Bulucu also owns cooldown/blacklist.** A fleet-level blacklist removes a symbol for e.g. **7 days after 4+ losses** across the fleet (see the `entry-guards-cooldown` and `fleet-coordination` skills). Blacklisted symbols are excluded from the scored universe even if they pass every gate.

## Codebase specifics (this platform)
- **Bulucu is a config row, not a trader.** Its `v3_coin_config` row has `engine_enabled: 0`; it never calls create-order. Config keys it *reads* to gate the universe: `likidite_enabled` + `min_volume_usdt`, `spread_enabled` + `max_spread_pct`, `atr_enabled` + `min_atr_pct`; it *writes* the resulting `coin_count` worth of candidates for the fleet. `*_pct` values are percent units (`0.05` = 0.05%).
- **Pure core / dirty shell.** All scoring/gating math lives in `packages/` as **pure functions** (`gradeSymbol`, `depthUsd`, `spreadPct`, `amihud`, `volumeMcapRatio`) unit-tested with `bun test`. The dirty shell is a poller that fetches Bybit REST, normalizes strings → numbers, and calls the pure core.
- **Storage = MySQL + Drizzle**, schema via idempotent `ensure-schema.ts` (no migration files). Persist a `v3_universe` table (`symbol`, `tier`, `score`, `turnover24h`, `spreadPct`, `depthBid2pct`, `depthAsk2pct`, `oiUsd`, `atrPct`, `amihud`, `listingAgeDays`, `refreshedAt`) with a **unique index on `symbol`**; upsert via `.onDuplicateKeyUpdate`. Other loops read this table — they do **not** re-scan the board.
- **Polling, no WebSocket.** Every metric is a periodic REST `fetch` (see `market-data-ingestion` and `rest-polling-and-rate-limits`). Scanning 80–150 symbols means one orderbook call per symbol — throttle hard against a shared rate-limit budget to avoid a 403 IP ban.
- **[KOD] gaps to fill.** There is no `v3_universe` table yet and no Bulucu scan loop; the wash-trade and Amihud screens are not implemented; the fleet blacklist that feeds exclusion is missing (see `fleet-coordination`). Depth±2% is not currently collected — the `market-data-ingestion` update adds it.

## Implementation checklist
- [ ] Enumerate linear perps via `/v5/market/instruments-info` (paginate past 500); keep `USDT` quote, `status: Trading`; read `launchTime` for **listing age**.
- [ ] One `/v5/market/tickers` call for the whole board → `turnover24h`, `lastPrice`, `bid1Price`/`ask1Price`, `fundingRate`, `openInterest`, `markPrice`.
- [ ] Compute **OI in USD** = `openInterest × markPrice` (openInterest is in base-coin units) and gate on the tier floor.
- [ ] For each survivor, one `/v5/market/orderbook` snapshot → compute **spread%** and **per-side depth at ±1% and ±2%** in USD notional.
- [ ] Pull recent 1h klines → **ATR%(14)** for the ATR band gate (see `atr-adaptive-exits`).
- [ ] Pull ~30 daily klines → **Amihud illiquidity** estimate for ranking.
- [ ] Apply the **volume/mcap 5–15%** wash-trade filter where supply is known.
- [ ] Exclude fleet-blacklisted / cooling-down symbols.
- [ ] `gradeSymbol` → assign Tier-A / Tier-B / reject; compute a composite score; sort.
- [ ] Upsert the top `coin_count` per tier into `v3_universe`; stamp `refreshedAt`.
- [ ] Schedule a **monthly** full refresh; keep intra-month reads served from the stored snapshot.

## Do / Don't
**Do**
- Scan wide (80–150), open few — widen the scan, never lower the entry bar.
- Gate on **per-side** depth (bids and asks separately); a book can be deep one side, thin the other.
- Size every position as a **small fraction of ±1% depth per side**; treat depth as a capacity limit.
- Convert OI and depth to **USD notional** before comparing to dollar thresholds.
- Cross-check volume vs mcap; treat volume/mcap ≫ 15% + thin book as wash trading.
- Rank by Amihud; refresh the universe **monthly** and serve a stable snapshot in between.
- Keep all gating math pure and unit-tested; keep fetch/normalize in the shell.

**Don't**
- Don't trust headline 24h volume alone — it is the most-manipulated field.
- Don't compute depth from `bid1`/`ask1` only; walk the book to ±1%/±2%.
- Don't re-scan the whole board on the execution cadence — the universe is monthly.
- Don't let Bulucu place orders (`engine_enabled: 0`, capital $0).
- Don't compare `openInterest` (base units) directly to a USD floor.
- Don't include Tier-B coins in Kayıkçı's partition; Kayıkçı is **Tier-A only**.
- Don't do string math on Bybit numerics — cast first.

## Common pitfalls
- **Unit mismatch:** `openInterest` and orderbook `size` are in **base coin**, thresholds are in **USD** — multiply by price.
- **Spread sign/scale:** spread% = `(ask1 − bid1) / mid × 100`; mixing fraction vs percent silently passes/fails gates.
- **Depth measured at one price level:** `bid1Price` depth is meaningless for sizing; accumulate notional across levels until the price moves ±1%/±2% from mid.
- **Listing age from wrong field:** use `launchTime` (ms), not first-candle time, which can predate the perp listing.
- **Amihud blow-ups:** zero-volume days make `|r|/vol` explode — filter zero/low-volume days from the average.
- **Rate-limit ban:** 80–150 orderbook polls back-to-back trips a 403; throttle and cache within the refresh window.
- **Stale universe served forever:** if the monthly refresh loop dies, bots trade a frozen list — stamp `refreshedAt` and alert if it ages out.
- **mcap unavailable:** Bybit gives no circulating supply — make the wash filter optional, don't hard-fail the whole scan when supply is missing.

## Code patterns (TypeScript)
Pure core — spread and per-side depth from a Bybit orderbook snapshot:
```ts
type Level = [string, string];            // [price, size] strings from Bybit
type Book = { b: Level[]; a: Level[] };   // bids desc, asks asc

export function spreadPct(book: Book): number {
  const bid = +book.b[0][0], ask = +book.a[0][0];
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 100 : Infinity;
}

// USD notional resting within `pct` of mid, per side (walk the book).
export function depthUsd(book: Book, pct: number): { bid: number; ask: number } {
  const bid0 = +book.b[0][0], ask0 = +book.a[0][0];
  const mid = (bid0 + ask0) / 2;
  const lo = mid * (1 - pct / 100), hi = mid * (1 + pct / 100);
  let bid = 0, ask = 0;
  for (const [p, s] of book.b) { const px = +p; if (px < lo) break; bid += px * +s; }
  for (const [p, s] of book.a) { const px = +p; if (px > hi) break; ask += px * +s; }
  return { bid, ask };
}
```

Pure core — Amihud illiquidity, volume/mcap ratio, and tier grading:
```ts
// ILLIQ = mean( |dailyReturn| / dailyDollarVolume ), skipping empty days.
export function amihud(days: { ret: number; dollarVol: number }[]): number {
  const used = days.filter((d) => d.dollarVol > 0);
  if (used.length === 0) return Infinity;
  const sum = used.reduce((a, d) => a + Math.abs(d.ret) / d.dollarVol, 0);
  return sum / used.length;
}

export function volumeMcapRatio(turnover24h: number, mcap?: number): number | null {
  return mcap && mcap > 0 ? turnover24h / mcap : null; // ~0.05–0.15 healthy
}

export type Metrics = {
  turnover24h: number; spreadPct: number; depth2Bid: number; depth2Ask: number;
  listingAgeDays: number; atrPct: number; oiUsd: number; volMcap: number | null;
};
export type Tier = "A" | "B" | "reject";

const A = { vol: 100e6, spread: 0.05, depth: 250e3, age: 30, atr: [1, 5], oi: 20e6 };
const B = { vol: 15e6,  spread: 0.15, depth: 100e3, age: 7,  atr: [2, 8], oi: 5e6  };

function passes(m: Metrics, t: typeof A): boolean {
  const depthOk = Math.min(m.depth2Bid, m.depth2Ask) >= t.depth; // per-side
  const washOk = m.volMcap === null ? true : m.volMcap <= 0.15;   // wash-trade guard
  return (
    m.turnover24h >= t.vol && m.spreadPct <= t.spread && depthOk &&
    m.listingAgeDays >= t.age && m.atrPct >= t.atr[0] && m.atrPct <= t.atr[1] &&
    m.oiUsd >= t.oi && washOk
  );
}

export function gradeSymbol(m: Metrics): Tier {
  if (passes(m, A)) return "A";
  if (passes(m, B)) return "B";
  return "reject";
}
```

Dirty shell — fetch one book and upsert the scored universe:
```ts
import { sql } from "drizzle-orm";

async function fetchBook(base: string, symbol: string): Promise<Book> {
  const qs = new URLSearchParams({ category: "linear", symbol, limit: "200" });
  const res = await fetch(`${base}/v5/market/orderbook?${qs}`, { signal: AbortSignal.timeout(10_000) });
  const j = (await res.json()) as { retCode: number; result: Book };
  if (j.retCode !== 0) throw new Error(`orderbook ${symbol} retCode ${j.retCode}`);
  return j.result;
}

async function persist(db: any, rows: Array<{ symbol: string; tier: Tier; score: number } & Metrics>) {
  await db.insert(v3Universe).values(rows.map((r) => ({ ...r, refreshedAt: Date.now() })))
    .onDuplicateKeyUpdate({
      set: {
        tier: sql`values(${v3Universe.tier})`, score: sql`values(${v3Universe.score})`,
        refreshedAt: sql`values(${v3Universe.refreshedAt})`,
      },
    }); // unique index on symbol → idempotent monthly refresh
}
```

## References
- [Bybit V5 Get Orderbook](https://bybit-exchange.github.io/docs/v5/market/orderbook) — REST snapshot, `b`/`a` `[price,size]` pairs; source for spread and ±1%/±2% depth.
- [Bybit V5 Get Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers) — one-call board snapshot: `turnover24h`, `bid1/ask1`, `openInterest`, `fundingRate`, `markPrice`.
- [Bybit V5 Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — enumerate linear perps, `launchTime` for listing age, tick/lot filters, 500-row pagination.
- [Bybit V5 Get Open Interest](https://bybit-exchange.github.io/docs/v5/market/open-interest) — OI history/units; multiply by mark price for the USD OI floor.
- [Bybit V5 Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — 1h bars for ATR% and daily bars for the Amihud estimate.
- [Bybit V5 Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — throttle 80–150 orderbook polls per refresh to avoid a 403 IP ban.
- [Amihud (2002) illiquidity estimator — Ødegaard lecture notes](https://ba-odegaard.no/teach/notes/liquidity_estimators/amihud_estimator/amihud_lectures.pdf) — `ILLIQ = mean(|R_t| / dollarVol_t)` definition and caveats.
- [Amihud Illiquidity Ratio explained](https://paperswithbacktest.com/course/amihud-illiquidity-ratio) — using ILLIQ as a liquidity screen and cross-sectional ranking.
- [StockCharts — ATR & ATR Percent (ATRP)](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-true-range-atr-and-average-true-range-percent-atrp) — ATR%(14) for the volatility band gate.
- [TradingView — Volume/Market Cap](https://www.tradingview.com/support/solutions/43000703297-volume-market-cap/) — healthy 5–15% band; extreme ratios flag wash trading.
- [QuantPedia — Detecting Wash Trading in Crypto Exchanges](https://quantpedia.com/detecting-wash-trading-in-major-crypto-exchanges/) — thin-book + inflated-volume detection rationale.
- [Coinbase Institutional — Market impact & order-book liquidity](https://www.coinbase.com/institutional/research-insights/research/trading-insights/market-impact-order-book-liquidity) — why order size vs depth drives slippage (capacity sizing).
- [Drizzle ORM — Insert & Upsert](https://orm.drizzle.team/docs/insert) — `.onDuplicateKeyUpdate({ set })` for the idempotent `v3_universe` refresh.
- [Bun fetch / Web APIs](https://bun.com/docs/runtime/web-apis) — global `fetch`, `AbortSignal.timeout` on Bun.
