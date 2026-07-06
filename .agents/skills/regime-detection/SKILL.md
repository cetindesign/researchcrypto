---
name: regime-detection
description: How Bulucu (Finder) computes the SkyPower V3 regime/direction compass on LONGER bars (4h, not the 3s execution cadence) and serves a long/short/neutral bias to the fleet — especially Kayıkçı, which only opens in the regime direction. Covers the three signals: (1) BTC anchor vs 4h EMA50/EMA200; (2) breadth = % of Tier-A above 4h EMA50 (>60% long, <40% short); (3) positioning = funding sign + 24h OI change — plus the 2-of-3 majority rule, the neutral-means-no-new-Kayıkçı-entries rule, and the bias via bias_enabled / max_long_pct / max_short_pct (70-80% bias side, 20-30% counter). The BTC Shock Shield is an emergency brake, NOT a regime input. Pure functions unit-tested with bun test, dirty-shell REST polling; documentation-only. Invoke when the user mentions regime, direction compass, bias, long/short/neutral, BTC anchor, EMA50/EMA200, market breadth, % above EMA, funding sign, OI change, 2-of-3 rule, Kayıkçı direction, bias_enabled/max_long_pct/max_short_pct, or BTC Shock Shield vs regime.
---

# Regime Detection (SkyPower V3 direction compass, Bybit USDⓈ-M, TypeScript / Bun)

## When to use this skill
- Deciding the fleet's **direction**: are we long-biased, short-biased, or neutral right now?
- Implementing **Bulucu's regime compass** — the signal Kayıkçı reads to know which way (and whether) to open.
- Computing the three inputs — **BTC anchor**, **breadth**, **positioning** — on 4h bars and combining them with the **2-of-3 rule**.
- Wiring the bias into config (`bias_enabled`, `max_long_pct`, `max_short_pct`) so the fleet leans the right way without going fully one-sided.
- Separating **slow regime** (this skill) from the **fast BTC Shock Shield** emergency brake (a different concern).

## Core concepts
The regime compass answers a strategic question — *which direction should Kayıkçı be diversifying into?* — and it is computed on **longer bars (4h)**. The 3-second engine loop is an **execution cadence**, not a signal horizon: recomputing direction every tick just samples noise. Bulucu computes the compass on a slow schedule and publishes one verdict the whole fleet reads.

**Three independent signals:**

1. **BTC anchor.** BTC is the market's beta. Compare BTC's **4h close** to its **EMA50 and EMA200**. Above both → long; below both → short; mixed → neutral. EMA (smoothing `α = 2/(N+1)`) reacts faster than SMA to regime turns.
2. **Breadth.** The share of **Tier-A** symbols trading above their **own 4h EMA50**. **> 60% → long, < 40% → short**, in-between → neutral. Breadth catches a broad move the BTC line alone can miss, and warns when a BTC rally is thin/unconfirmed.
3. **Positioning.** The **universe funding sign** (aggregate funding rate: persistently positive = crowded longs) plus the **24h OI change** (rising OI + rising price confirms trend; rising OI + falling price confirms a down-leg). This is the derivatives-crowd tie-breaker.

**The 2-of-3 rule.** Take the direction agreed by **at least two of the three** signals. If no direction has a majority (a 1/1/1 split or two neutrals), the regime is **neutral**. **Neutral → Kayıkçı opens no new positions** (existing positions still manage their own exits). This is the single most important output: it is a permission gate, not just a lean.

**Applying the bias.** When the regime is directional, the fleet does not go 100% one-sided — it leans. `bias_enabled: 1` turns leaning on; `max_long_pct` / `max_short_pct` cap the split so the **bias side gets ~70–80%** of exposure and the **counter side keeps ~20–30%**. This preserves some hedge and avoids catastrophic one-way positioning into a reversal.

**BTC Shock Shield ≠ regime.** The Shock Shield is a **fast emergency brake**: on a sudden violent BTC move it tightens trailing stops, blocks new entries, and can flatten risk — reacting in seconds, off short bars. The regime compass is the **slow strategic bias** off 4h bars. Keep them separate: the Shield can override the regime (halt everything) but is never one of the three regime votes. Conflating them makes the compass jittery and the brake sluggish.

## Codebase specifics (this platform)
- **Bulucu computes, the fleet consumes.** Bulucu (`engine_enabled: 0`) writes the regime verdict + bias split; Kayıkçı reads it each loop and only opens in the published direction. Avcı is momentum-driven and less regime-gated, but still respects the neutral-halt and the Shock Shield.
- **Config keys.** `bias_enabled`, `max_long_pct`, `max_short_pct` control the lean (percent units). `trend_enabled`, `ema_short`, `ema_long` describe the per-symbol EMA cross used for breadth. Regime itself is Bulucu-side state, not a single existing column — persist it (see below).
- **Pure core / dirty shell.** `ema`, `btcAnchor`, `breadth`, `positioning`, `combineRegime`, `biasSplit` are **pure functions** in `packages/`, unit-tested with `bun test`. The shell polls Bybit 4h klines, tickers (funding/OI), and the OI history endpoint, then calls the pure core.
- **Data source.** 4h klines via `/v5/market/kline` (`interval=240`), funding + OI snapshot via `/v5/market/tickers`, and 24h OI delta via `/v5/market/open-interest` (`intervalTime=4h`). Tier-A membership comes from the `coin-universe-selection` skill's `v3_universe` table. Polling only, no WebSocket.
- **Persist the verdict.** Store `{ regime: "long"|"short"|"neutral", longPct, shortPct, btcVote, breadthVote, posVote, computedAt }` in a small `v3_regime` row so every loop reads a consistent value and you have an audit trail in `v3_decision_log`.
- **[KOD] gaps to fill.** No regime table or compass loop exists yet; breadth needs Tier-A EMA50 per symbol; the funding/OI aggregation is unimplemented; the neutral-halt is not enforced in Kayıkçı entry logic.

## Implementation checklist
- [ ] Pull BTC 4h closes; compute EMA50 & EMA200; derive the **BTC anchor** vote (exclude the forming candle).
- [ ] For each **Tier-A** symbol, pull 4h closes, compute EMA50, test close > EMA50; **breadth = above/total**.
- [ ] Aggregate **funding sign** across the universe and compute **24h OI change**; derive the **positioning** vote.
- [ ] Apply the **2-of-3 majority**; if no majority → **neutral**.
- [ ] If neutral, publish "no new Kayıkçı entries"; existing positions keep managing exits.
- [ ] If directional and `bias_enabled`, compute the split (`max_long_pct` / `max_short_pct`, ~70–80 vs 20–30).
- [ ] Persist the verdict to `v3_regime`; log to `v3_decision_log`.
- [ ] Recompute on a **slow schedule** (per 4h bar close, not per 3s tick).
- [ ] Keep the **BTC Shock Shield** as a separate fast loop that can override but never votes.
- [ ] Unit-test each pure function with fixed candle fixtures.

## Do / Don't
**Do**
- Compute the compass on **4h bars**; treat the 3s loop as execution only.
- Require a **2-of-3 majority**; default to **neutral** when signals disagree.
- Enforce **neutral → no new entries** as a hard gate, not a soft hint.
- Measure breadth on **Tier-A** members against their **own** 4h EMA50.
- Lean, don't flip: keep 20–30% counter-exposure via `max_long_pct`/`max_short_pct`.
- Keep the Shock Shield as an independent, faster emergency brake.
- Drop the forming candle before computing any EMA vote.

**Don't**
- Don't recompute regime every 3s — that samples noise, not trend.
- Don't let a single signal (e.g. BTC alone) set direction; use the majority.
- Don't go 100% one-sided even in a strong regime — keep the counter allocation.
- Don't feed the Shock Shield into the 2-of-3 vote; it's a brake, not a compass.
- Don't compute breadth over the full board — restrict to Tier-A for signal quality.
- Don't assume an 8h funding interval when aggregating the funding sign — read per-symbol cadence.

## Common pitfalls
- **EMA seeding:** an EMA needs a warm-up (seed with an SMA of the first N closes) or the early values are wrong and flip votes.
- **Look-ahead from the forming candle:** including the current, unclosed 4h bar makes the compass repaint — use only closed candles.
- **Breadth denominator drift:** if Tier-A membership changes mid-computation, above/total is inconsistent — snapshot the membership first.
- **Funding aggregation bias:** a few extreme funding symbols can dominate a naive mean — prefer a sign-count or a robust aggregate.
- **OI units:** OI change should be compared in USD or as a percentage, not raw base-coin units across symbols of different price.
- **Neutral treated as flat-everything:** neutral blocks **new** entries; it does not force-close open positions (exits are the exit skills' job).
- **Regime/Shield coupling:** if the Shield writes into regime state, a transient spike freezes the strategic bias — keep the states separate.

## Code patterns (TypeScript)
Pure core — EMA (SMA-seeded) and the three signal votes:
```ts
export type Dir = "long" | "short" | "neutral";

// EMA over closes, seeded with the SMA of the first `n` values.
export function ema(closes: number[], n: number): number[] {
  if (closes.length < n) return [];
  const k = 2 / (n + 1);
  let prev = closes.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const out: number[] = [prev];
  for (let i = n; i < closes.length; i++) { prev = closes[i] * k + prev * (1 - k); out.push(prev); }
  return out; // out[last] aligns with closes[last]
}

// 1. BTC anchor: 4h close vs EMA50 & EMA200 (pass CLOSED candles only).
export function btcAnchor(closes: number[]): Dir {
  const e50 = ema(closes, 50), e200 = ema(closes, 200);
  if (!e50.length || !e200.length) return "neutral";
  const c = closes.at(-1)!, a = e50.at(-1)!, b = e200.at(-1)!;
  if (c > a && c > b) return "long";
  if (c < a && c < b) return "short";
  return "neutral";
}

// 2. Breadth: share of Tier-A above their own 4h EMA50.
export function breadth(perSymbolCloses: number[][]): Dir {
  const eligible = perSymbolCloses.filter((cs) => cs.length >= 51);
  if (eligible.length === 0) return "neutral";
  const above = eligible.filter((cs) => cs.at(-1)! > ema(cs, 50).at(-1)!).length;
  const pct = above / eligible.length;
  if (pct > 0.60) return "long";
  if (pct < 0.40) return "short";
  return "neutral";
}

// 3. Positioning: universe funding sign + 24h OI change.
export function positioning(fundingSignSum: number, oiChangePct: number): Dir {
  const funding: Dir = fundingSignSum > 0 ? "long" : fundingSignSum < 0 ? "short" : "neutral";
  const oi: Dir = oiChangePct > 2 ? "long" : oiChangePct < -2 ? "short" : "neutral";
  if (funding === oi) return funding;
  return "neutral"; // internal disagreement → no positioning vote
}
```

Pure core — 2-of-3 combine and the bias split:
```ts
export function combineRegime(btc: Dir, brd: Dir, pos: Dir): Dir {
  const votes = [btc, brd, pos];
  const longs = votes.filter((v) => v === "long").length;
  const shorts = votes.filter((v) => v === "short").length;
  if (longs >= 2 && longs > shorts) return "long";
  if (shorts >= 2 && shorts > longs) return "short";
  return "neutral"; // no majority → NEUTRAL → no new Kayıkçı entries
}

// Bias side ~70–80%, counter ~20–30%. Percent units, matching config.
export function biasSplit(
  regime: Dir, biasEnabled: boolean, maxLongPct: number, maxShortPct: number,
): { longPct: number; shortPct: number; allowNewEntries: boolean } {
  if (regime === "neutral") return { longPct: 0, shortPct: 0, allowNewEntries: false };
  if (!biasEnabled) return { longPct: 50, shortPct: 50, allowNewEntries: true };
  return regime === "long"
    ? { longPct: maxLongPct, shortPct: 100 - maxLongPct, allowNewEntries: true }
    : { longPct: 100 - maxShortPct, shortPct: maxShortPct, allowNewEntries: true };
}
```

Unit test sketch (`bun test`):
```ts
import { expect, test } from "bun:test";
import { combineRegime, biasSplit } from "./regime";

test("2-of-3 majority long", () => {
  expect(combineRegime("long", "long", "short")).toBe("long");
});
test("no majority is neutral and halts entries", () => {
  expect(combineRegime("long", "short", "neutral")).toBe("neutral");
  expect(biasSplit("neutral", true, 75, 25).allowNewEntries).toBe(false);
});
test("bias leans but keeps counter exposure", () => {
  expect(biasSplit("long", true, 75, 25)).toEqual({ longPct: 75, shortPct: 25, allowNewEntries: true });
});
```

## References
- [TradingView — Exponential Moving Average](https://www.tradingview.com/support/solutions/43000592270-exponential-moving-average/) — EMA definition and `α = 2/(N+1)` smoothing used for the BTC anchor and breadth.
- [StockCharts — Percent Above 50-Day SMA](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/percent-above-50-day-sma) — the "% of members above a moving average" breadth methodology and threshold framing.
- [StockCharts — Percent Above Moving Average](https://chartschool.stockcharts.com/table-of-contents/market-indicators/percent-above-moving-average) — breadth indicator construction and bullish/bearish bands.
- [Bybit V5 Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — 4h bars (`interval=240`) for BTC anchor and per-symbol breadth EMAs.
- [Bybit V5 Get Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers) — `fundingRate` and `openInterest` snapshot for the positioning vote.
- [Bybit V5 Get Open Interest](https://bybit-exchange.github.io/docs/v5/market/open-interest) — `intervalTime=4h` history for the 24h OI change.
- [Bybit V5 Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — funding sign and per-symbol funding cadence for aggregation.
- [StockCharts — ATR & ATR Percent (ATRP)](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-true-range-atr-and-average-true-range-percent-atrp) — volatility context for the ATR>90th-pct regime-scaling / Shock Shield tie-in.
- [Man Group — Gaining Momentum: Where Next for Trend-Following?](https://www.man.com/insights/gaining-momentum-trend) — why time-series trend/regime filters (price vs long MAs) work across cycles.
- [Bun test runner](https://bun.sh/docs/test) — `bun test` for the pure-function unit tests.
