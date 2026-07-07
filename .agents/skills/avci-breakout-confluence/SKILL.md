---
name: avci-breakout-confluence
description: The SkyPower V3 Avci (Hunter) breakout/momentum SIGNAL ENGINE as one pure TypeScript function evaluateAvciBreakout(candles1h, candles4h, cfg) in packages/, unit-tested with bun test. MANDATORY trigger is a Donchian(20) CLOSE-beyond the prior N-bar high plus an ATR buffer (never a wick, never the forming bar). Three HARD filters must ALL pass — ADX(14)>=25 (30 for HIGH) with +DI>-DI, ROC(12)>=min_momentum_pct, RVOL>=min_hacim_carpan. MTF 4h-alignment, relative-strength rank, squeeze-release, RSI-50/MACD>0 are WEIGHTED boosters behind flags default OFF (v1 ships ONLY Donchian+ROC+ADX+RVOL). Hosts the shared pure indicator helpers (donchian, roc, adx via Wilder, atr, rsi, macd, ema/sma) reused by every Avci skill, plus a min-expected-move / cost-clearing gate. Confluence cuts trade COUNT (coin_count 2 selectivity), NOT win rate — 34% is normal positive-skew. Use on "Avci", "breakout", "Donchian", "ADX", "ROC", "RVOL", "confluence", "close-beyond level", "N-bar high", "relative strength", "MTF alignment".
---

# Avci Breakout Confluence (Signal Engine, Bybit Perpetuals, TypeScript)

## When to use this skill
- Building or changing the Avci (Hunter) breakout/momentum **entry signal** — the "should we long this perp now?" decision.
- Implementing the **Donchian close-beyond trigger** + the three hard filters (ADX / ROC / RVOL) as one pure function.
- Adding the shared **pure indicator helpers** (donchian, roc, adx-Wilder, atr, rsi, macd, ema/sma) that every other Avci skill imports.
- Deciding whether an optional booster (MTF 4h alignment, relative-strength rank, squeeze, RSI/MACD) is worth turning on — and gating it behind a flag until it earns its keep out-of-sample.
- Reasoning about the **cost-clearing gate**: rejecting a signal whose projected move can't clear round-trip taker + modeled thin-coin slippage.
- Pushing back on "let's stack more filters to lift the 34% win rate" — the wrong instinct for a positive-skew system.

## Core concepts

**The discipline (read first).** A **34% win rate is NORMAL and often optimal** for a breakout/momentum system. These systems profit from **positive skew** — a few large winners pay for many small losers — NOT from win rate. So the confluence stack below exists to **cut trade COUNT** (enforce `coin_count 2` selectivity, skip chop, fire only on the cleanest setups), **NOT to raise the hit rate**. Stacking filters to "beat the L1 baseline win rate," combined with a tight trailing exit, truncates the right tail and can keep expectancy negative even as win rate rises. The real levers live elsewhere — payoff ratio (avg_win/avg_loss) and EXIT slippage on thin Tier-B coins (see avci-taker-entry-slippage-guard, atr-adaptive-exits, avci-signal-validation-rollout). This engine's only job is to be **selective and honest**, not to be right more often.

**Mandatory trigger — Donchian close-beyond + ATR buffer.** The signal fires only when a **closed** bar's CLOSE (never a wick, never the still-forming bar) exceeds the prior `donchian_period`(20)-bar high by at least `breakout_buffer_atr` x ATR(14): `close > donchianHigh(prior 20) + buffer*atr14`. The `donchian_slow`(55) channel is **context** (is this a fresh 55-bar high, i.e. a real regime break, or noise inside a bigger range?). Closing beyond the level filters the intrabar wick-through / liquidity-sweep entries that plausibly drove the L1 34%; the ATR buffer keeps you from acting on a marginal 1-tick poke of the level. This mandatory rule is non-negotiable — every other component is a filter or a booster **on top of** a genuine close-beyond break.

**Three HARD filters (all must pass, ANDed).** A Donchian break alone is not tradable. With it, ALL of:
- **ADX(14) >= `adx_min`** (25 default, **raise to 30** for HIGH-selectivity Avci) **with +DI > -DI** — separates a real directional expansion from noise. ADX below 20-25 is chop; a break there is a fakeout factory.
- **ROC(`roc_period` 12) >= `min_momentum_pct`** (5) — a momentum floor. The move must already be traveling, not just poking a level.
- **RVOL >= `min_hacim_carpan`** (3) on Bybit **turnover (USDT)** — participation confirmation. 3x is the strict end of the RVOL literature (day-trade norm is 2.0, "strong interest" 3.0+), matching Avci's HIGH-selectivity, few-positions mandate. (The full anti-fakeout gate — RVOL surge ANDed with squeeze->expansion on a **median** denominator — lives in avci-volume-volatility-confirmation; this engine calls it.)

**Weighted boosters (behind flags, default OFF).** MTF 4h-trend alignment (`mtf_enabled`), cross-sectional relative-strength rank (`rs_rank_enabled`), squeeze-release booster (`squeeze_booster_enabled`), and RSI-50 / MACD>0 directional confirmation (`rsi_confirm_enabled` / `macd_confirm_enabled`) are **weighted score contributions**, not hard gates. **v1 ships ONLY the hard gate (Donchian + ROC + ADX + RVOL).** Each booster stays OFF until it lifts **cost-adjusted expectancy on untouched out-of-sample data** (see avci-signal-validation-rollout). When enabled, they raise `confluenceScore`; a signal fires only above `confluence_min_score`, making the stack a COUNT reducer. RSI is a **directional** confirm (RSI>50), **never** an RSI-70 exit — a momentum breakout SHOULD be overbought.

**Cost-clearing / min-expected-move gate.** Before emitting, require the **projected edge** (derived from ROC / ATR displacement) to exceed **round-trip taker + modeled thin-coin slippage** by an `edge_margin_multiple`. Round-trip taker on Bybit is ~0.11% (0.055% x2), but that is NOT the real cost — model exit slippage on thin Tier-B stop-outs and 8h funding on an hours-held position (all-in plausibly 0.2-0.4%+). A signal that can't clear its own costs is a `hold`, not a trade. **Honest caveat:** you do NOT capture the full ROC — you enter AFTER it, at close-beyond-level+buffer, so the captured move is smaller than the raw ROC and the "40x cost cushion" framing of a 5% ROC is false. Budget the entry lag explicitly.

**Everything is a pure function of closed bars.** `evaluateAvciBreakout` takes already-normalized, oldest-first, **confirmed** candle arrays (1h trigger, 4h context) plus the pre-computed `universeRanks` and a typed `cfg`, and returns a serializable `BreakoutSignal`. No `fetch`, no `Date.now()`, no DB. The dirty shell polls Bybit V5 `/v5/market/kline` (60 + 240), drops the forming bar, and calls this. Same code runs live and in the backtester.

## Codebase specifics (Bybit / Bun / this platform)

**Pure core placement.** All of it lives in `packages/` (e.g. `packages/signals/avci`), exported as plain functions and covered by `bun test`. This package **hosts the shared indicator helpers** — `donchian`, `roc`, `adx` (Wilder TR/+DM/-DM/DX/ADX), `atr`, `rsi`, `macd`, `ema`, `sma` — that avci-volume-volatility-confirmation, avci-regime-timing-standdown, avci-volatility-position-sizing and atr-adaptive-exits all import. Do not re-implement indicators per skill; import them from here so backtest and live share one definition. The dirty shell owns ONLY: polling klines (60 + 240), normalizing (reverse to oldest-first, parse numbers, **drop the unconfirmed last bar**), and enforcing the turnover(USDT)-vs-volume(base) field mapping with a startup assertion `turnover ~= volume*price` (pybit #266 reversed-field risk).

**`v3_coin_config` keys.**
- **Existing (drive the v1 hard gate):** `momentum_enabled=1`, `min_momentum_pct=5`, `hacim_artisi_enabled=1`, `min_hacim_carpan=3`, `coin_count=2`, `min_volume_usdt=20000000`, `max_spread_pct=0.15`.
- **NEW — conservative defaults, swept ONLY offline inside the validation protocol, never live-optimized (`optimizer_enabled` stays 0):** `donchian_period=20`, `donchian_slow=55`, `adx_period=14`, `adx_min=25` (30 for HIGH), `roc_period=12`, `rvol_period=20`, `breakout_buffer_atr=0.25` (0.25-0.5), `confluence_min_score` (only meaningful once boosters are on), `edge_margin_multiple` (cost-clearing), and the booster flags **`mtf_enabled=0`, `rs_rank_enabled=0`, `squeeze_booster_enabled=0`, `rsi_confirm_enabled=0`, `macd_confirm_enabled=0`** (all default OFF for v1). Treat every `*_pct` as a percent; treat `breakout_buffer_atr` and multipliers as **ratios**, not percents — confirm against engine code before trusting a threshold.

**Decision logging.** The shell writes each `BreakoutSignal` (including `triggered:false` with a `reason`) to `v3_decision_log` and any position change to `v3_position_event`. Keep `reason` machine-readable (`avci:no_close_beyond`, `avci:adx_below_min`, `avci:cost_gate`, `avci:fired`).

**Bybit-only, one-way mode** (`positionIdx: 0`). No Binance examples here.

## Implementation checklist
- [ ] Add/confirm the shared pure helpers `donchian`, `roc`, `adx` (Wilder), `atr`, `rsi`, `macd`, `ema`, `sma` with `bun test` fixtures.
- [ ] Normalize klines in the shell: oldest-first, numeric, **drop the forming bar**; assert `turnover ~= volume*price` at startup.
- [ ] Implement the **mandatory** Donchian close-beyond + `breakout_buffer_atr` trigger on closed bars.
- [ ] AND the three hard filters: ADX(14) >= `adx_min` with +DI > -DI, ROC(12) >= `min_momentum_pct`, RVOL >= `min_hacim_carpan`.
- [ ] Ship v1 with **only** the hard gate; wire boosters (MTF/RS/RSI/MACD/squeeze) as weighted score contributions **behind flags defaulting OFF**.
- [ ] Add the **cost-clearing gate**: reject unless projected captured move (post entry-lag) > `edge_margin_multiple` x (round-trip taker + modeled slippage + funding).
- [ ] Return a typed `BreakoutSignal{ side, triggered, confluenceScore, components, entryType:'taker', stopAtr, meta, reason }`.
- [ ] Enforce `coin_count 2` selectivity at the caller — the confluence CUTS COUNT, never chases win rate.
- [ ] Cover every gate branch + a determinism test + a repaint (shift-by-one-bar) test with `bun test`.

## Do / Don't
**Do**
- Require a **closed-bar CLOSE beyond the level + ATR buffer** — the single most defensible, falsifiable anti-wick fix.
- Keep the v1 gate to Donchian + ROC + ADX + RVOL; treat every other filter as OFF until it earns OOS keep.
- Frame and document the confluence as a **trade-COUNT reducer** (selectivity), not a win-rate lever.
- Import indicators from this package everywhere so live and backtest share one Wilder/EMA definition.
- Run the cost-clearing gate on **captured** move (after entry lag), not the raw ROC.

**Don't**
- Don't fire on a wick, a marginal 1-tick poke, or the still-forming bar.
- Don't stack boosters to raise the 34% hit rate — that truncates the right tail momentum depends on.
- Don't use RSI-70 as an exit inside this engine; a real breakout is supposed to be overbought.
- Don't trust RVOL / RS on a coin without the turnover-field assertion — wash-traded volume poisons both gates.
- Don't let a single ADX cross of 25 or a one-candle ROC=5 tag on a liquidation print count as confirmation — that is exactly the tape that made 34%.

## Common pitfalls
- **Chop that passes the filters.** A single liquidation/whale print spikes RVOL to 3x on a thin coin, a marginal ADX crosses 25, and ROC tags 5% on one candle — the ANDed gate fires a taker entry that reverses. Require the **median** RVOL denominator (avci-volume-volatility-confirmation), ADX **rising** (not a marginal cross), and squeeze->expansion context; each alone is defeatable by a manufactured spike.
- **Late entry into an already-extended break.** Closed 1h bar + (optional) closed 4h MTF + 0.25-0.5 ATR buffer is 1-2 hours of lag; by the time you qualify, the move is often 1-2 ATR extended, giving poor reward-to-stop and a high chance of being stopped on the first pullback. Keep the buffer small, prefer fresh 55-bar breaks (not extended runs), and let the cost-clearing gate reject setups with too little room left.
- **Win-rate obsession destroys positive skew.** Adding boosters to lift the hit rate, combined with a 0.8% trailing callback, systematically cuts winners short while losers stay a full 1.5xATR+slippage. Optimize payoff ratio and expectancy, not win rate.
- **Cross-sectional RS is weaker net of cost in crypto.** Han/Kang/Ryu show raw cross-sectional ranks decay to near-zero after realistic costs, and "strongest" = most-extended = highest reversal risk. Over a tiny (~10-20 coin) universe the top-quintile boundary is 2-4 noisy names. Keep `rs_rank_enabled` OFF for v1; if used, prefer it as a mild booster, not a hard selector, and prefer the more-robust time-series momentum framing.
- **Two top-RS longs are ~1.5x ONE bet.** `coin_count 2` both forced into top relative strength in a BTC-up regime are highly correlated beta-to-BTC, not two independent bets; in a momentum crash both gap through stops together. Enforce a correlation cap at the fleet layer (fleet-coordination, avci-volatility-position-sizing).
- **Turnover-vs-volume field swap.** Reading base `volume` where USDT `turnover` is expected silently corrupts RVOL and every $-denominated gate. Assert `turnover ~= volume*price` at startup.
- **Suspicious/barely-past-cutoff citations.** The arXiv falsification study (`2605.04004`, load-bearing for "breakouts mostly fail" framing) and `2503.08692` have IDs at/after the knowledge cutoff — verify they exist and say what's claimed before any threshold leans on them.

## Code patterns

Shared pure indicators — Donchian, ROC, and Wilder ADX (EMA/RSI/ATR live in the same package; see strategy-development for EMA/RSI):

```ts
export type Candle = { start: number; open: number; high: number; low: number; close: number; volume: number; turnover: number };

// Prior-N-bar Donchian high/low, EXCLUDING the current bar (so a close can break it).
export function donchianPrior(candles: Candle[], n: number, i: number): { high: number; low: number } | undefined {
  if (i < n) return undefined;                       // need n prior bars
  let hi = -Infinity, lo = Infinity;
  for (let j = i - n; j < i; j++) { hi = Math.max(hi, candles[j].high); lo = Math.min(lo, candles[j].low); }
  return { high: hi, low: lo };
}

export function roc(close: number[], n: number): (number | undefined)[] {
  return close.map((c, i) => (i < n ? undefined : ((c - close[i - n]) / close[i - n]) * 100));
}

// Wilder ADX(14): TR / +DM / -DM -> smoothed +DI/-DI -> DX -> ADX. Returns per-bar {adx,plusDI,minusDI}.
export function adxWilder(c: Candle[], len = 14): ({ adx: number; plusDI: number; minusDI: number } | undefined)[] {
  const out: ({ adx: number; plusDI: number; minusDI: number } | undefined)[] = c.map(() => undefined);
  if (c.length <= len * 2) return out;
  let trS = 0, pS = 0, mS = 0;                        // Wilder-smoothed TR, +DM, -DM
  const dx: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high, dn = c[i - 1].low - c[i].low;
    const plusDM = up > dn && up > 0 ? up : 0, minusDM = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    if (i <= len) { trS += tr; pS += plusDM; mS += minusDM; if (i < len) continue; }
    else { trS = trS - trS / len + tr; pS = pS - pS / len + plusDM; mS = mS - mS / len + minusDM; }
    const plusDI = 100 * (pS / trS), minusDI = 100 * (mS / trS);
    const dxi = 100 * (Math.abs(plusDI - minusDI) / ((plusDI + minusDI) || 1e-12));
    dx.push(dxi);
    if (dx.length >= len) {
      const adx = dx.length === len
        ? dx.reduce((a, b) => a + b, 0) / len                    // first ADX = simple mean of DX
        : (out[i - 1]!.adx * (len - 1) + dxi) / len;             // then Wilder-smoothed
      out[i] = { adx, plusDI, minusDI };
    }
  }
  return out;
}
```

The signal engine — mandatory trigger + hard gate; boosters gated OFF:

```ts
export interface AvciCfg {
  donchianPeriod: number; donchianSlow: number; breakoutBufferAtr: number;
  adxPeriod: number; adxMin: number; rocPeriod: number; minMomentumPct: number;
  rvolPeriod: number; minHacimCarpan: number;
  mtfEnabled: boolean; rsRankEnabled: boolean; squeezeBoosterEnabled: boolean;
  rsiConfirmEnabled: boolean; macdConfirmEnabled: boolean;
  confluenceMinScore: number; edgeMarginMultiple: number; roundTripCostPct: number;
}
export interface BreakoutSignal {
  side: "long"; triggered: boolean; confluenceScore: number;
  components: Record<string, boolean>; entryType: "taker"; stopAtr: number;
  meta: Record<string, number>; reason: string;
}

export function evaluateAvciBreakout(
  c1h: Candle[], c4h: Candle[], universeRank: number | null, cfg: AvciCfg,
  ind: { atr14: number; adx: { adx: number; plusDI: number; minusDI: number }; roc: number; rvol: number },
): BreakoutSignal {
  const base = (reason: string): BreakoutSignal =>
    ({ side: "long", triggered: false, confluenceScore: 0, components: {}, entryType: "taker", stopAtr: 1.5 * ind.atr14, meta: {}, reason });

  const i = c1h.length - 1;                                       // last CLOSED bar (shell already dropped forming)
  const ch = donchianPrior(c1h, cfg.donchianPeriod, i);
  if (!ch) return base("avci:warmup");
  const close = c1h[i].close;

  // MANDATORY: closed CLOSE beyond prior 20-bar high + ATR buffer (never a wick).
  const closeBeyond = close > ch.high + cfg.breakoutBufferAtr * ind.atr14;
  if (!closeBeyond) return base("avci:no_close_beyond");

  // THREE HARD FILTERS (all must pass).
  const adxOk = ind.adx.adx >= cfg.adxMin && ind.adx.plusDI > ind.adx.minusDI;
  const rocOk = ind.roc >= cfg.minMomentumPct;
  const rvolOk = ind.rvol >= cfg.minHacimCarpan;
  if (!adxOk) return base("avci:adx_below_min");
  if (!rocOk) return base("avci:roc_below_floor");
  if (!rvolOk) return base("avci:rvol_below_floor");

  // COST-CLEARING gate: room left (rough proxy) must beat costs by margin. Enter AFTER the move, so budget lag.
  const roomLeftPct = ((close - ch.high) / ch.high) * 100 + (ind.atr14 / close) * 100;
  if (roomLeftPct < cfg.edgeMarginMultiple * cfg.roundTripCostPct) return base("avci:cost_gate");

  // WEIGHTED boosters — default OFF (v1). Each only ADDS score; never a hard gate.
  const components: Record<string, boolean> = { donchian: true, adx: true, roc: true, rvol: true };
  let score = 4;                                                  // 4 hard gates all passed
  if (cfg.mtfEnabled)    { const ok = c4h.length > 1 && c4h[c4h.length - 1].close > c4h[c4h.length - 2].close; components.mtf = ok; if (ok) score++; }
  if (cfg.rsRankEnabled) { const ok = universeRank !== null && universeRank <= 2; components.rs = ok; if (ok) score++; }
  // rsiConfirm / macdConfirm / squeeze boosters wire in the same shape, all default off.

  if (score < cfg.confluenceMinScore) return base("avci:below_confluence_min");
  return { side: "long", triggered: true, confluenceScore: score, components, entryType: "taker", stopAtr: 1.5 * ind.atr14, meta: { roomLeftPct }, reason: "avci:fired" };
}
```

`bun test` — the mandatory trigger and no-repaint invariant:

```ts
import { test, expect } from "bun:test";

test("no signal without a close beyond the level (wick pokes are ignored)", () => {
  const sig = evaluateAvciBreakout(wickThroughButCloseInside, [], null, cfg, ind);
  expect(sig.triggered).toBe(false);
  expect(sig.reason).toBe("avci:no_close_beyond");
});

test("a marginal ADX cross alone does not fire (needs all hard gates)", () => {
  const sig = evaluateAvciBreakout(cleanCloseBeyond, [], null, cfg, { ...ind, adx: { adx: 24, plusDI: 20, minusDI: 18 }, roc: 6, rvol: 4 });
  expect(sig.reason).toBe("avci:adx_below_min");
});

test("adding a future bar never changes a past decision (no repaint)", () => {
  const full = evaluateAvciBreakout(bars, [], null, cfg, ind);
  const past = evaluateAvciBreakout(bars.slice(0, -1), [], null, cfg, ind);
  expect(past.reason).toBe(full.reason);
});
```

## References
- [Donchian Channels: Breakout and Trend-Following Strategy — LuxAlgo](https://www.luxalgo.com/blog/donchian-channels-breakout-and-trend-following-strategy/) — the N-bar high/low channel that is Avci's mandatory trigger.
- [Turtle System Rules — Trading Blox](https://www.tradingblox.com/Manuals/UsersGuideHTML/turtlesystem.htm) — the canonical 20/55 Donchian breakout with a slow context channel.
- [Average Directional Index (ADX) — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx) — Wilder TR/+DM/-DM/DX/ADX; the real-vs-noise trend-strength gate.
- [Rate of Change (ROC) — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/rate-of-change-roc) — the momentum floor mapped to `min_momentum_pct`.
- [Relative Volume (RVOL) — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-volume-rvol) — the participation gate (`min_hacim_carpan` 3 = strict end).
- [BB/KC Squeeze: Trading Range Breakouts — TrendSpider](https://trendspider.com/learning-center/bb-kc-squeeze-a-powerful-indicator-for-trading-range-breakouts/) — the squeeze->expansion booster context (full gate in avci-volume-volatility-confirmation).
- [How to Design a Simple Multi-Timeframe Trend Strategy on Bitcoin — QuantPedia](https://quantpedia.com/how-to-design-a-simple-multi-timeframe-trend-strategy-on-bitcoin/) — the optional 4h MTF-alignment booster.
- [Time-Series and Cross-Sectional Momentum in the Cryptocurrency Market under Realistic Assumptions — Han/Kang/Ryu (SSRN)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4675565) — why cross-sectional RS is WEAKER net of cost; keep `rs_rank_enabled` off for v1.
- [Cross-sectional Momentum in Cryptocurrency Markets — Starkiller Capital](https://www.starkiller.capital/post/cross-sectional-momentum-in-cryptocurrency-markets) — RS-ranking context and its noise over small universes.
- [Stop Being the Liquidity: 7 False-Breakout Filters — FXNX](https://fxnx.com/en/blog/7-ways-avoid-false-breakouts-stop-being-market-liquidity) — close-beyond + buffer + confirmation as anti-fakeout rules.
- [Structural Limits of OHLCV-Based Intraday Signals: A Systematic Falsification Study — arXiv 2605.04004](https://arxiv.org/pdf/2605.04004) — TO VERIFY (barely-past-cutoff ID): the "most raw breakouts fail" framing; confirm before leaning on it.
- [Win Rate and Risk/Reward: Connection Explained — LuxAlgo](https://www.luxalgo.com/blog/win-rate-and-riskreward-connection-explained/) — why 34% with a healthy payoff ratio is fine, and filters shouldn't chase win rate.
- [Get Kline — Bybit V5 API Documentation](https://bybit-exchange.github.io/docs/v5/market/kline) — the `[start,open,high,low,close,volume,turnover]` polling source (60 + 240) the shell normalizes.
