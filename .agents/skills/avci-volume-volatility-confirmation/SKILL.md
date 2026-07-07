---
name: avci-volume-volatility-confirmation
description: The SkyPower V3 Avci (Hunter) v1 SHIP-FIRST anti-fakeout gate — a pure TypeScript confirmBreakout(bars, level, cfg) -> {pass, score, reasons[]} in packages/, unit-tested with bun test, that the signal engine (avci-breakout-confluence) calls before any taker entry. It ANDs (never ORs) a VOLUME surge with a VOLATILITY expansion, on CLOSED bars only. Volume = RVOL on Bybit TURNOVER (USDT, not base volume) with a MEDIAN (not mean) denominator, plus a startup turnover~=volume*price field assertion (pybit #266 reversed-field risk). Volatility = squeeze->expansion: BB(20,2) inside KC(20,1.5xATR) TTM squeeze that just fired, OR a self-normalizing BandWidth-percentile (bottom 10-20th of ~125 bars) for the ATR% 2-8 universe, with ATR(14) expansion ratio >= 1.25 and a close beyond the level. Targets the fakeout / liquidity-sweep loss mode behind the L1 34% win rate on thin Bybit perps. Use on "Avci", "fakeout", "false breakout", "RVOL", "turnover vs volume", "squeeze", "TTM", "BandWidth percentile", "liquidity sweep".
---

# Avci Volume + Volatility Confirmation (Anti-Fakeout Gate, v1 Ship-First, TypeScript)

## When to use this skill
- Adding the **anti-fakeout gate** the L1 signal lacked: confirm a Donchian close-beyond break BEFORE paying taker.
- Implementing **RVOL on turnover (USDT)** with a **median** denominator and the turnover-vs-volume field assertion.
- Implementing **squeeze->expansion** detection — TTM (BB inside KC) or BandWidth-percentile — plus an ATR expansion ratio.
- Deciding what ships in **v1**: this gate (dual confirmation + closed-bar) is one of the three well-evidenced primitives that ship first.
- Debugging "the breakout confirmed but immediately reversed" — usually a manufactured volume spike or an expansion with no prior compression.

## Core concepts

**Why this is v1 ship-first.** Of the whole Avci redesign, dual volume+volatility confirmation and the closed-bar anti-wick rule are among the **most-evidenced, most-portable edges**. They target the correct, well-supported failure mode: breakouts in low-vol chop are fakeouts; breakouts out of compression WITH participation follow through. On thin Bybit perps the dominant loss source is fakeouts / liquidity sweeps — plausibly the bulk of the L1 34%. This gate is cheap, robust, and falsifiable against the existing L1 trade log, so it ships with vol-scaled sizing and the closed-bar rule while everything else stays behind flags.

**AND, never OR.** The gate `pass`es only when **both** confirmations hold on **closed** bars:
1. **Volume surge** — RVOL >= `min_hacim_carpan` (3).
2. **Volatility expansion out of prior compression** — a squeeze that has just fired AND ATR expanding.

ORing them re-admits exactly the trades this gate exists to reject (a volume spike with no compression = a liquidation print; an expansion with no volume = a thin drift). The AND is the whole point.

**RVOL on TURNOVER, with a MEDIAN denominator.** Relative volume = current-bar **turnover (USDT)** / trailing typical turnover over `rvol_lookback_bars` (20-30). Use turnover (quote), not base `volume`, so the gate is $-comparable across the universe and consistent with `min_volume_usdt`. Use the **MEDIAN** (or trimmed mean), not the mean, as the denominator: one prior spike in the window inflates a mean and **suppresses** a genuine current surge, letting fakeouts through and vetoing real breaks. **Field discipline:** Bybit kline field 5 is base volume, field 6 is quote turnover — assert `turnover ~= volume*price` at startup (pybit #266 documents reversed-field bugs); a swap silently corrupts every $-denominated gate.

**Squeeze -> expansion (two interchangeable detectors).**
- **TTM Squeeze:** the market is "in a squeeze" while Bollinger(20, 2) sits **inside** Keltner(20, 1.5xATR); the signal is the **first bar the squeeze FIRES** (BB expands back outside KC). Trade the transition, not the squeeze itself, within `k` = 1-6 bars of the fire.
- **BandWidth percentile (regime-robust default for ATR% 2-8):** Bollinger BandWidth in the **bottom 10-20th percentile** of the last ~125 bars marks compression; the break out of that percentile is the expansion. This **self-normalizes** across the wide ATR% band, so one threshold works for a calm Tier-A and a hot Tier-B coin — prefer it when the universe spans 2-8% ATR%.

**ATR expansion + displacement.** Require **ATR(14) expansion ratio >= `atr_expansion_ratio_min`** (1.25) — current ATR vs its recent baseline — so the break is accompanied by real range expansion, and require the breakout to **close beyond the level** (not wick) by the buffer, ideally traveling **>= ~1 ATR** past the level so the move clears the 1.5xATR stop and round-trip cost. A close-beyond with a rising ATR and a fired squeeze and 3x median RVOL is a genuine break; missing any one is a `pass:false` with a reason.

**Liquidity-sweep rejection.** A common fakeout is a sweep: price spikes through the level (grabbing stops), then closes back inside. Reject when the breakout bar has a large opposing wick or the close returns inside the level within `sweep_window_bars`. This is the closed-bar rule made explicit against stop-hunts.

**Pure core, closed bars only.** `confirmBreakout(bars, level, cfg)` receives **already-closed** bars (the shell dropped the forming one, `confirm=true`) and a typed cfg, and returns `{pass, score, reasons[]}`. No `fetch`, no clock, no exchange calls. It composes small unit-testable helpers (`computeRVOL`, `isSqueezeFired`, `bandwidthPercentile`, `atrExpansionRatio`, `closedBeyond`, `isLiquiditySweep`). The dirty shell fetches ~200 klines + ticker(turnover) + orderbook and enforces the field mapping.

## Codebase specifics (Bybit / Bun / this platform)

**Pure core placement.** Lives in `packages/` (e.g. `packages/signals/avci`), importing the shared indicators (`atr`, `sma`, `ema`, stdev/Bollinger, Keltner) hosted by avci-breakout-confluence — do NOT re-implement ATR/EMA here. Covered by `bun test` against fixed OHLCV fixtures. The dirty shell owns ONLY: polling Bybit V5 `/v5/market/kline` (~200 bars) + `/v5/market/tickers` (turnover24h) + `/v5/market/orderbook`, dropping the forming bar, and asserting `turnover ~= volume*price` on startup.

**`v3_coin_config` keys.**
- **Existing:** `hacim_artisi_enabled=1`, `min_hacim_carpan=3`, `momentum_enabled=1`, `min_momentum_pct=5`, `min_volume_usdt=20000000`, `max_spread_pct=0.15`, `min_atr_pct=2`, `max_atr_pct=8`, `stop_loss_pct=1.5` (an **ATR multiple**, not a raw percent).
- **NEW — conservative defaults, swept ONLY offline, never live-optimized:** `rvol_lookback_bars=20` (20-30), `squeeze_enabled=1`, `squeeze_bb_mult=2`, `kc_atr_mult=1.5`, `squeeze_fire_window=6` (k bars after fire), `bandwidth_pct_lookback=125`, `bandwidth_pct_floor=15` (bottom 10-20th), `atr_expansion_ratio_min=1.25`, `sweep_window_bars=3`, `opposing_wick_reject_pct=50`, `use_bandwidth_percentile=1` (prefer over TTM on the 2-8% ATR universe). Treat `*_pct` as percents and `*_mult` / `*_ratio_min` as **ratios**.

**Decision logging.** The shell writes the `{pass, score, reasons[]}` to `v3_decision_log` alongside the signal; keep reasons machine-readable (`conf:rvol_low`, `conf:no_squeeze`, `conf:atr_flat`, `conf:sweep`, `conf:pass`).

**Bybit-only, one-way mode** (`positionIdx: 0`).

## Implementation checklist
- [ ] Fetch ~200 closed klines + ticker turnover in the shell; drop the forming bar; assert `turnover ~= volume*price`.
- [ ] `computeRVOL(bars, N)` on **turnover** with a **MEDIAN** denominator; gate `>= min_hacim_carpan`.
- [ ] Squeeze detector: `isSqueezeFired` (BB(20,2) inside KC(20,1.5xATR), first bar it fires) OR `bandwidthPercentile` bottom-decile; pick via `use_bandwidth_percentile`.
- [ ] `atrExpansionRatio(bars) >= atr_expansion_ratio_min` (1.25) AND `closedBeyond(bar, level, buffer)`.
- [ ] `isLiquiditySweep` reject: opposing wick > `opposing_wick_reject_pct` or close back inside within `sweep_window_bars`.
- [ ] **AND** all of the above in `confirmBreakout`; never OR. Return `{pass, score, reasons[]}`.
- [ ] Cover each reason branch + a spike-with-no-compression case + a compression-with-no-volume case with `bun test`.

## Do / Don't
**Do**
- Require **both** a volume surge AND a volatility expansion — ANDed, on closed bars.
- Use **turnover (USDT)** and a **median** denominator for RVOL.
- Prefer **BandWidth-percentile** on the 2-8% ATR% universe so one threshold self-normalizes.
- Trade the squeeze **FIRE** (the transition), not the squeeze state.
- Reject sweeps: large opposing wick / close back inside the level.

**Don't**
- Don't OR the two confirmations — that re-admits the exact fakeouts you're filtering.
- Don't use base `volume` or a **mean** denominator — a prior spike then masks the real surge.
- Don't confirm on the forming bar or on a wick through the level.
- Don't treat "in a squeeze" as the signal; a coin can sit squeezed for many bars — you need the fire.
- Don't skip the `turnover ~= volume*price` assertion; a field swap corrupts RVOL silently.

## Common pitfalls
- **Manufactured volume spike passes.** A single liquidation / whale print produces a 3x RVOL on a thin coin with no real participation. The median denominator helps, but pair RVOL with the squeeze-fire AND ATR expansion so one print alone can't clear the gate — this is precisely the tape that generated the L1 34%.
- **Mean denominator suppresses real surges.** If a prior bar in the lookback spiked, a mean-based RVOL denominator is inflated and a genuine 3x surge reads as <3x — you veto the good break and later admit the quiet fakeout. Always median/trimmed.
- **Expansion without compression.** ATR can expand mid-trend with no prior squeeze; that is a continuation, not the compressed-base breakout this gate is tuned for, and it often marks the extended end of a move (buying the top). Require the squeeze-fire precondition, not just rising ATR.
- **Turnover/volume field swap.** Reading base volume where quote turnover is expected (pybit #266) silently corrupts RVOL and `min_volume_usdt`; the startup assertion is non-optional.
- **Wash-traded volume.** On 20M-turnover coins, manipulable/wash volume directly poisons RVOL — a coin can print "participation" that isn't real. Cross-check against orderbook depth and OI where possible; RVOL alone is spoofable.
- **Confirmation lag buys the top.** Waiting for a closed bar + squeeze-fire + ATR expansion adds lag; the move may already be 1-2 ATR extended by the time the gate passes, worsening reward-to-stop. Keep the buffer small and let the cost-clearing gate (avci-breakout-confluence) reject setups with too little room left.
- **This gate confirms; it does not time regime.** It will happily PASS a violent bear-market dead-cat bounce that looks identical to a high-momentum breakout — that veto is avci-regime-timing-standdown's job, ANDed on top. Confirmation is necessary, not sufficient.

## Code patterns

RVOL on turnover with a median denominator (spike-robust):

```ts
export type Bar = { open: number; high: number; low: number; close: number; volume: number; turnover: number };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// RVOL = current-bar turnover / MEDIAN of the prior N bars' turnover (never the mean).
export function computeRVOL(bars: Bar[], n: number): number | undefined {
  if (bars.length < n + 1) return undefined;
  const cur = bars[bars.length - 1].turnover;
  const prior = bars.slice(bars.length - 1 - n, bars.length - 1).map((b) => b.turnover);
  const denom = median(prior) || 1e-12;
  return cur / denom;
}
```

Squeeze-fired (TTM) and the ANDed gate:

```ts
export interface ConfirmCfg {
  rvolLookbackBars: number; minHacimCarpan: number;
  squeezeBbMult: number; kcAtrMult: number; squeezeFireWindow: number;
  useBandwidthPercentile: boolean; bandwidthPctLookback: number; bandwidthPctFloor: number;
  atrExpansionRatioMin: number; breakoutBufferAtr: number;
  sweepWindowBars: number; opposingWickRejectPct: number;
}
export interface ConfirmResult { pass: boolean; score: number; reasons: string[] }

// True on the FIRST closed bar the squeeze fires (BB expands back outside KC). Needs sma/stdev/atr from the shared pkg.
export function isSqueezeFired(bars: Bar[], cfg: ConfirmCfg, atr14: number[], mid: number[], sd: number[]): boolean {
  const i = bars.length - 1;
  const inSqueeze = (j: number) =>
    mid[j] - cfg.squeezeBbMult * sd[j] > mid[j] - cfg.kcAtrMult * atr14[j] &&   // BB lower inside KC lower
    mid[j] + cfg.squeezeBbMult * sd[j] < mid[j] + cfg.kcAtrMult * atr14[j];     // BB upper inside KC upper
  if (inSqueeze(i)) return false;                                              // still squeezed -> not a fire
  for (let k = 1; k <= cfg.squeezeFireWindow; k++) if (inSqueeze(i - k)) return true; // was squeezed within window
  return false;
}

export function confirmBreakout(
  bars: Bar[], level: number, cfg: ConfirmCfg,
  ind: { atr14: number[]; mid: number[]; sd: number[]; atrExpansion: number; bandwidthPct: number },
): ConfirmResult {
  const reasons: string[] = []; let score = 0;
  const rvol = computeRVOL(bars, cfg.rvolLookbackBars) ?? 0;
  const bar = bars[bars.length - 1];

  const volOk = rvol >= cfg.minHacimCarpan; volOk ? score++ : reasons.push("conf:rvol_low");
  const squeezeOk = cfg.useBandwidthPercentile
    ? ind.bandwidthPct <= cfg.bandwidthPctFloor                                // was compressed, now breaking out
    : isSqueezeFired(bars, cfg, ind.atr14, ind.mid, ind.sd);
  squeezeOk ? score++ : reasons.push("conf:no_squeeze");
  const atrOk = ind.atrExpansion >= cfg.atrExpansionRatioMin; atrOk ? score++ : reasons.push("conf:atr_flat");
  const beyond = bar.close > level + cfg.breakoutBufferAtr * ind.atr14[ind.atr14.length - 1];
  beyond ? score++ : reasons.push("conf:no_close_beyond");

  // Liquidity-sweep reject: large opposing (upper) wick relative to body on a long break.
  const range = bar.high - bar.low || 1e-12;
  const upperWick = (bar.high - Math.max(bar.open, bar.close)) / range * 100;
  const swept = upperWick > cfg.opposingWickRejectPct || bar.close < level;
  if (swept) reasons.push("conf:sweep");

  // AND, never OR: all four confirmations AND not swept.
  const pass = volOk && squeezeOk && atrOk && beyond && !swept;
  if (pass) reasons.length = 0, reasons.push("conf:pass");
  return { pass, score, reasons };
}
```

`bun test` — the AND discipline and the median-denominator invariant:

```ts
import { test, expect } from "bun:test";

test("volume surge WITHOUT volatility expansion does not pass (AND, not OR)", () => {
  const r = confirmBreakout(spikeNoCompression, level, cfg, { ...ind, atrExpansion: 1.0, bandwidthPct: 60 });
  expect(r.pass).toBe(false);
  expect(r.reasons).toContain("conf:no_squeeze");
});

test("compression + expansion WITHOUT volume does not pass", () => {
  const r = confirmBreakout(quietExpansion, level, cfg, ind);   // rvol < 3
  expect(r.pass).toBe(false);
  expect(r.reasons).toContain("conf:rvol_low");
});

test("median denominator ignores one prior spike (a mean would suppress the surge)", () => {
  const withPriorSpike = injectOnePriorSpike(cleanSurge);
  expect(computeRVOL(withPriorSpike, cfg.rvolLookbackBars)!).toBeGreaterThanOrEqual(cfg.minHacimCarpan);
});

test("close back inside the level is rejected as a sweep", () => {
  const r = confirmBreakout(sweepThenReclaim, level, cfg, ind);
  expect(r.pass).toBe(false);
  expect(r.reasons).toContain("conf:sweep");
});
```

## References
- [Relative Volume (RVOL) — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-volume-rvol) — RVOL definition; 2.0 norm vs 3.0 "strong interest".
- [Relative Volume (RVOL) Trading Indicator Guide — TradingSim](https://www.tradingsim.com/blog/relative-volume-rvol) — practical RVOL thresholds and denominator choices for surges.
- [TTM Squeeze — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/ttm-squeeze) — Bollinger-inside-Keltner squeeze and the fire signal.
- [Bollinger Band Squeeze — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/bollinger-band-squeeze) — BandWidth compression and expansion mechanics.
- [BB/KC Squeeze: A Powerful Indicator for Trading Range Breakouts — TrendSpider](https://trendspider.com/learning-center/bb-kc-squeeze-a-powerful-indicator-for-trading-range-breakouts/) — the BB-in-KC squeeze->expansion breakout logic.
- [Narrow Range Day (NR7) — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7) — compression-precedes-expansion evidence, a percentile-free cousin.
- [Volume Analysis for Breakout Trading: Basics — LuxAlgo](https://www.luxalgo.com/blog/volume-analysis-for-breakout-trading-basics/) — why participation confirms a break and its absence marks a fakeout.
- [5 False Breakout Strategies for Traders — LuxAlgo](https://www.luxalgo.com/blog/5-false-breakout-strategies-for-traders/) — sweep / reclaim patterns the liquidity-sweep reject targets.
- [How to Use Volume for High-Volatility Breakouts — LuxAlgo](https://www.luxalgo.com/blog/how-to-use-volume-for-high-volatility-breakouts/) — combining volume with volatility for the ATR% 2-8 universe.
- [Structural Limits of OHLCV-Based Intraday Signals: A Systematic Falsification Study — arXiv 2605.04004](https://arxiv.org/pdf/2605.04004) — TO VERIFY (barely-past-cutoff ID): the high raw-breakout failure rate motivating dual confirmation.
- [The Impact of Volatility Targeting — Man Group](https://www.man.com/insights/the-impact-of-volatility-targeting) — why volatility regime, not just level, governs whether a break follows through.
- [Get Tickers — Bybit V5 API Documentation](https://bybit-exchange.github.io/docs/v5/market/tickers) — `turnover24h` vs `volume24h`; the field discipline this gate depends on.
- [Get Kline — Bybit V5 API Documentation](https://bybit-exchange.github.io/docs/v5/market/kline) — `[start,open,high,low,close,volume,turnover]`; field 5 base volume vs field 6 quote turnover.
