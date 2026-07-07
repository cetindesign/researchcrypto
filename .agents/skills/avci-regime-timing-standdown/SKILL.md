---
name: avci-regime-timing-standdown
description: The mandatory pre-filter before ANY Avcı (Hunter) momentum/breakout entry — a pure regimeGate(state) => { decision: ALLOW | REDUCE | STANDDOWN, sizeMultiplier, reason } mapping regime to coin_count (STANDDOWN = coin_count 0). Its irreplaceable job: VETO the trade the volume/ATR/RVOL confluence gate wrongly PASSES — the violent bear-market dead-cat bounce that looks identical to a high-momentum breakout (Daniel-Moskowitz momentum crash). Consumes Bulucu's 4h compass (regime-detection) and ADDS Avcı per-symbol volatility-EXPANSION-vs-PANIC separation (ATR% 2-8 rising, ADX>25 rising, Choppiness<61.8), a chop/no-trade block (Choppiness>61.8 or ADX<20), session gating (13-21 UTC), and a funding+OI veto (extreme funding unconfirmed by rising OI = squeeze fakeout). Pure functions in packages/, bun test; dirty-shell polls Bybit V5 kline/funding/OI. Invoke for Avcı regime, momentum crash, standdown, dead-cat bounce, coin_count 0, expansion vs panic, chop/no-trade, Choppiness, ADX gate, session gate, funding veto.
---

# Avcı Regime & Timing Standdown (SkyPower V3 momentum pre-filter)

## When to use this skill
- Deciding, **before any Avcı breakout entry**, whether the current regime even permits hunting momentum — and if so, at what size and how many slots.
- Encoding the **momentum-crash standdown**: refusing to buy the explosive rally off a market decline (the Daniel-Moskowitz crash regime) that the RVOL/ATR gate cannot tell apart from a genuine breakout.
- Separating the **two "high-vol" regimes**: volatility *expansion* inside an intact trend (ideal) vs. *panic* volatility near a reversal (deadly for a long-breakout system).
- Adding a **chop / no-trade** block (Choppiness Index, ADX) so Avcı's HIGH-selectivity mandate is actually enforced, not just claimed.
- **Session gating** breakout entries to the liquid US-overlap window and tightening confirmation in the Asian dead zone.
- Vetoing on **funding/OI context** (extreme funding not confirmed by rising OI = squeeze/fakeout).
- Mapping the regime verdict to **coin_count** so STANDDOWN literally zeroes Avcı's slots while other roles continue.

## Core concepts
- **regimeGate is the mandatory gate-0 for Avcı.** It runs *before* `avci-breakout-confluence` and `avci-volume-volatility-confirmation`, and its STANDDOWN verdict cannot be overridden by a strong signal. A single pure function `regimeGate(state) => { decision, sizeMultiplier, coinCount, reason }`, where `decision ∈ { ALLOW, REDUCE, STANDDOWN }`. No I/O, no clock inside — the shell assembles the numeric `state` and hands it in.
- **The one trade it must veto.** The volume+ATR+RVOL confluence gate is regime-blind: a violent bear-market **dead-cat bounce** produces exactly the RVOL 3× spike, ATR expansion, and ROC≥5% that a real breakout does. That bounce is the single highest-cost long the fleet can take (Daniel-Moskowitz *Momentum Crashes*: the beaten-down leg rips, breakout longs give back weeks in days). If this skill only did ONE thing, it would be refusing that trade. Everything else is secondary.
- **Consume Bulucu's compass, don't recompute it.** The 4h **direction compass** (BTC-vs-EMA50/200, breadth, funding/OI positioning, 2-of-3 rule) is computed once by Bulucu — see `regime-detection`. This skill *reads* that verdict and **layers Avcı-specific vetoes on top**; it never re-derives market direction per tick.
- **Regime → coin_count mapping (the enforcement).**
  - **RISK-ON** (BTC above 4h trend, market realized-vol NOT extreme, breadth long) → `ALLOW`, `coin_count 2` (up to 3 in the strongest tape), `sizeMultiplier 1.0`.
  - **CAUTION** (BTC below trend **OR** market vol top-quartile) → `REDUCE`, `coin_count 1`, longs only *with* HTF trend alignment, **no counter-trend bounce breakouts**, `sizeMultiplier ~0.5`.
  - **CRASH** (BTC below trend **AND** vol top-decile near a reversal) → `STANDDOWN`, `coin_count 0`, `sizeMultiplier 0`. This is `standdown_coin_count = 0` wired into `fleet-coordination`.
- **Volatility EXPANSION vs PANIC (per-symbol separator).** Not all high vol is tradable. The *ideal* breakout regime is expansion inside a trend: **ATR% in the 2–8 band AND rising** (ATR > `vol_expansion_min` × its own SMA50, default 1.2×), **ADX > `adx_min` (25) and rising**, **Choppiness < `chop_max` (61.8)**, price above HTF trend. *Panic* is high ATR with ADX falling / price below trend / Choppiness high — that fails the gate even though ATR "expanded".
- **Chop / no-trade block.** `Choppiness > 61.8` (consolidation) **OR** `ADX < 20` (no trend) → no-trade for that symbol. This is how the HIGH threshold is *enforced*: in chop, false breakouts plus the ~0.11% taker round-trip dominate, and this is precisely the tape that produced the L1 34% win rate.
- **Session gating (13–21 UTC).** Crypto volume/volatility concentrate in the EU-afternoon / US-overlap window; the Asian dead zone breaks out thinly and fakes out. In-window → normal RVOL. Off-hours (esp. 00:00–06:00 UTC) → **raise the RVOL requirement** (`session_offhours_hacim_carpan` 4–5 vs 3) or stand down. *Treat the exact window as a to-be-validated prior, not a law (see pitfalls).*
- **Funding + OI context.** **Extreme funding** (|funding| ≥ `funding_extreme_pct`, ~0.05–0.10%/8h) with **OI NOT rising** = an over-crowded, unsupported move → a short-squeeze/long-liquidation fakeout, not a fresh trend. Veto. A supported breakout has funding sane *or* rising OI confirming new participation.

## Codebase specifics
- **Pure core / dirty shell.** `regimeGate`, `volExpansionOk`, `choppiness`, `sessionOk`, `fundingOiVeto`, `regimeToCoinCount` are **pure functions** in `packages/` (e.g. `packages/avci-regime`), unit-tested with `bun test`. The dirty shell polls Bybit V5 `/v5/market/kline` (ATR/ADX/CHOP inputs, per-symbol + BTC), `/v5/market/tickers` (funding, openInterest), `/v5/market/open-interest` (`intervalTime` 5/15/60m for the OI slope), reads Bulucu's `v3_regime` verdict, stamps the UTC hour, assembles `state`, and hands it to `regimeGate`.
- **Relevant `v3_coin_config` keys.** Existing: `cooldown_enabled` (1), `cooldown_loss_trigger` (2), `cooldown_loss_time_min` (1440), `coin_count` (2), `min_hacim_carpan` (3), `max_spread_pct` (0.15). NEW (conservative defaults, offline-swept only inside the validation protocol, never live-optimized while `optimizer_enabled: 0`): `regime_compass_enabled` (1), `btc_trend_len` (200), `vol_expansion_min` (1.2 — ATR-vs-SMA50 ratio), `adx_min` (25; raise to 30 for HIGH selectivity), `chop_max` (61.8), `session_utc_allow` ('13-21'), `session_offhours_hacim_carpan` (4–5), `funding_extreme_pct` (0.05–0.10), `oi_confirm_enabled` (1), `standdown_coin_count` (0). All `*_pct` keys are **percent units**.
- **Reads the slow compass, runs on the fast loop.** The compass is recomputed by Bulucu per 4h close (`regime-detection`); this gate runs every Avcı tick but only *reads* the cached verdict + fresh per-symbol/funding numbers — it never recomputes the 4h direction per 3s tick.
- **Wiring.** STANDDOWN → `coin_count 0` consumed by `fleet-coordination` (`standdown_coin_count`, zeroes Avcı while Kayıkçı/Safra continue). The CAUTION "no counter-trend bounce" and chop/session/funding vetoes are also surfaced to `entry-guards-cooldown` as additional ANDed guards. `sizeMultiplier` feeds `avci-volatility-position-sizing`.
- **Distinct from the BTC Shock Shield.** The Shock Shield (`regime-detection`) is a fast emergency brake reacting in seconds; this gate is the strategic momentum-crash standdown off slow bars + per-symbol context. Both can veto; neither is the other.

## Implementation checklist
- [ ] Read Bulucu's `v3_regime` verdict; do NOT recompute 4h direction here.
- [ ] Compute per-symbol **ATR%**, ATR/SMA50 **expansion ratio**, **ADX + slope**, **Choppiness** on CLOSED bars only.
- [ ] Map regime → `{ decision, coinCount, sizeMultiplier }`: RISK-ON→ALLOW/2, CAUTION→REDUCE/1/0.5, CRASH→STANDDOWN/0/0.
- [ ] Enforce **volExpansionOk**: ATR% in 2–8 AND ATR>1.2×SMA50 AND ADX>25 rising AND Choppiness<61.8; else no-trade.
- [ ] Enforce **chop block**: Choppiness>61.8 OR ADX<20 → STANDDOWN for that symbol.
- [ ] Enforce **sessionOk**: outside 13–21 UTC raise the RVOL bar (`session_offhours_hacim_carpan`) or stand down.
- [ ] Enforce **fundingOiVeto**: |funding|≥extreme AND OI not rising → veto.
- [ ] In CAUTION, permit **longs only WITH HTF trend**; reject counter-trend bounce breakouts explicitly.
- [ ] Return the FIRST failing reason as `reason`; write it to `v3_decision_log`.
- [ ] Unit-test each gate at its boundary (exactly at, just below, just above each threshold), with a crash-regime fixture that MUST return STANDDOWN.

## Do / Don't
**Do**
- Run `regimeGate` as an **un-overridable gate-0** before the signal engine; a strong breakout does NOT beat a STANDDOWN.
- Separate **expansion from panic** per symbol — high ATR alone is not permission.
- Enforce the chop/no-trade block so the HIGH threshold cuts trade **count**.
- Map STANDDOWN → `coin_count 0` and surface it to the fleet.
- Read the slow 4h compass; layer Avcı vetoes on top of it.
- Treat session/Choppiness/ADX thresholds as **priors to validate offline**, not laws.

**Don't**
- Don't let the RVOL/ATR gate be the last word — it PASSES the dead-cat bounce; that is the whole reason this skill exists.
- Don't buy counter-trend breakouts in CAUTION/CRASH (the momentum-crash trap).
- Don't recompute the 4h direction per tick (samples noise; that's Bulucu's job).
- Don't stand down on exits — this gate blocks ENTRIES only; stops/trailing/reduce-only always run.
- Don't hard-code the session window as gospel; different alt universes peak at different hours.
- Don't trust ATR expansion when ADX is falling and price is below trend — that's panic, not a trend.

## Common pitfalls (critic's weakest points, encoded)
- **The compass flips too late.** A regime filter is lagging by construction: in a real momentum crash it turns bearish *after* you're already stopped out, and it also keeps you out of the sharpest V-recovery entries. Mitigate with the *fast* per-symbol panic separator (ADX falling + price below trend + vol top-decile) as an early STANDDOWN, not the 4h compass alone; accept that you will miss some recovery longs — that asymmetry is the point (you are protecting positive skew, not maximizing hit-rate).
- **Chop that passes every filter.** A single liquidation or whale print spikes RVOL to 3× on a thin coin, a marginal ADX cross tags 25, ROC tags 5% on one candle — the ANDed confluence fires and reverses. The regime/chop gate is the backstop: require ADX **rising** (not a one-bar cross), Choppiness genuinely low, and OI *confirming*; a manufactured single-print spike fails the "sustained expansion" test even when the instantaneous gate passes.
- **Correlated concurrent slots in a crash.** `coin_count 2` both forced into top-quintile relative strength in a BTC-up regime are ~1.5× ONE beta-to-BTC bet; in a crash / V-recovery both gap through stops together. STANDDOWN → `coin_count 0` and the CAUTION → `coin_count 1` mapping are the fleet-level defense; the correlation cap itself lives in `fleet-coordination` and `avci-volatility-position-sizing`.
- **Win-rate obsession.** Do NOT tune these gates to raise the 34% win rate — 34% is normal positive-skew for breakouts. These gates exist to cut trade **count** and to avoid the crash, i.e. to protect **expectancy/payoff ratio**, never to lift hit-rate. Truncating the right tail to raise win rate keeps expectancy negative.
- **Session window is folklore until validated.** "13–21 UTC" and the Asian-dead-zone claim are priors from equity/BTC intraday studies; the *actual* per-symbol active hours must be confirmed on the Avcı universe offline before the off-hours penalty is trusted (see `avci-signal-validation-rollout`).
- **Choppiness/ADX cutoffs are conventions.** 61.8 / 25 / 20 are trading folklore; verify they actually separate winning from losing Avcı setups on Bybit data rather than accepting the numbers.
- **Funding cadence assumption.** Don't assume a uniform 8h funding at 00/08/16 UTC — read the per-symbol cadence and current live funding distribution before calling a level "extreme".
- **Standing down an exit.** A copy-paste that runs the gate before a close traps a losing position — the gate blocks entries only.

## Code patterns
Pure regime gate + per-symbol separators (`packages/avci-regime`, `bun test`):
```ts
// packages/avci-regime/src/regimeGate.ts — pure, deterministic, no I/O, no clock.
export type Compass = { direction: "long" | "short" | "neutral"; btcAboveTrend: boolean };
export type RegimeState = {
  compass: Compass;                 // from Bulucu's v3_regime (regime-detection)
  marketVolPct: number;             // market realized-vol percentile 0..100
  atrPct: number;                   // per-symbol ATR% (band 2..8)
  atrExpansionRatio: number;        // ATR / SMA50(ATR)  (>= vol_expansion_min => expanding)
  adx: number; adxRising: boolean;  // Wilder ADX(14) + slope sign
  choppiness: number;               // Choppiness Index 0..100
  utcHour: number;                  // 0..23
  fundingAbs: number;               // |funding rate| this interval, percent
  oiRising: boolean;                // OI slope over the last few buckets
  htfTrendUp: boolean;              // price above HTF (4h) trend for this symbol
};
export type Cfg = {
  volExpansionMin: number;          // 1.2
  atrMinPct: number; atrMaxPct: number;   // 2 / 8
  adxMin: number; adxChopFloor: number;   // 25 / 20
  chopMax: number;                  // 61.8
  sessionAllow: [number, number];   // [13, 21]
  fundingExtremePct: number;        // 0.05..0.10
  oiConfirmEnabled: boolean;        // 1
};
export type Decision = "ALLOW" | "REDUCE" | "STANDDOWN";
export type GateResult = { decision: Decision; sizeMultiplier: number; coinCount: number; reason: string };

const stand = (reason: string): GateResult => ({ decision: "STANDDOWN", sizeMultiplier: 0, coinCount: 0, reason });

// Market-level regime -> coin_count (CRASH => 0). This is the momentum-crash standdown.
export function regimeToCoinCount(s: RegimeState): { decision: Decision; sizeMultiplier: number; coinCount: number } {
  const volTopDecile = s.marketVolPct >= 90, volTopQuartile = s.marketVolPct >= 75;
  if (!s.compass.btcAboveTrend && volTopDecile) return { decision: "STANDDOWN", sizeMultiplier: 0, coinCount: 0 }; // CRASH
  if (!s.compass.btcAboveTrend || volTopQuartile) return { decision: "REDUCE", sizeMultiplier: 0.5, coinCount: 1 }; // CAUTION
  return { decision: "ALLOW", sizeMultiplier: 1, coinCount: 2 };                                                    // RISK-ON
}

// Per-symbol volatility EXPANSION vs PANIC separator.
export function volExpansionOk(s: RegimeState, cfg: Cfg): boolean {
  const inBand = s.atrPct >= cfg.atrMinPct && s.atrPct <= cfg.atrMaxPct;
  const expanding = s.atrExpansionRatio >= cfg.volExpansionMin;
  const trending = s.adx > cfg.adxMin && s.adxRising && s.choppiness < cfg.chopMax;
  return inBand && expanding && trending;                        // panic (ADX falling / chop high) fails here
}
export function chopBlocked(s: RegimeState, cfg: Cfg): boolean {
  return s.choppiness > cfg.chopMax || s.adx < cfg.adxChopFloor; // consolidation OR no trend => no-trade
}
export function sessionOk(s: RegimeState, cfg: Cfg): boolean {
  const [lo, hi] = cfg.sessionAllow;
  return s.utcHour >= lo && s.utcHour < hi;                      // off-hours handled by raising RVOL upstream
}
export function fundingOiVeto(s: RegimeState, cfg: Cfg): boolean {
  return cfg.oiConfirmEnabled && s.fundingAbs >= cfg.fundingExtremePct && !s.oiRising; // crowded & unsupported
}

/** Mandatory gate-0. STANDDOWN cannot be overridden by a strong signal. */
export function regimeGate(s: RegimeState, cfg: Cfg): GateResult {
  const market = regimeToCoinCount(s);
  if (market.decision === "STANDDOWN") return stand("momentum_crash_standdown");
  if (chopBlocked(s, cfg)) return stand("chop_no_trade");
  if (!volExpansionOk(s, cfg)) return stand("panic_not_expansion");
  if (fundingOiVeto(s, cfg)) return stand("funding_extreme_oi_unconfirmed");
  // CAUTION: longs only WITH HTF trend — reject counter-trend bounce breakouts (the crash trap).
  if (market.decision === "REDUCE" && s.compass.direction === "long" && !s.htfTrendUp)
    return stand("caution_counter_trend_bounce");
  const sessioned = sessionOk(s, cfg);                           // off-hours: allowed but flagged for stricter RVOL
  return {
    decision: market.decision, sizeMultiplier: market.sizeMultiplier, coinCount: market.coinCount,
    reason: sessioned ? "regime_ok" : "regime_ok_offhours_tighten_rvol",
  };
}
```

Pure Choppiness Index helper (deterministic, unit-tested):
```ts
// CHOP = 100 * log10( sum(TR, n) / (max(High,n) - min(Low,n)) ) / log10(n);  >61.8 chop, <38.2 trend.
export function choppiness(highs: number[], lows: number[], closes: number[], n = 14): number {
  const m = closes.length;
  if (m <= n) return NaN;
  let sumTR = 0;
  for (let i = m - n; i < m; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    sumTR += tr;
  }
  const hi = Math.max(...highs.slice(m - n)), lo = Math.min(...lows.slice(m - n));
  const range = hi - lo;
  return range <= 0 ? 0 : (100 * Math.log10(sumTR / range)) / Math.log10(n);
}
```

Unit test sketch (`bun test`) — the dead-cat bounce MUST stand down:
```ts
import { expect, test } from "bun:test";
import { regimeGate, type RegimeState, type Cfg } from "../src/regimeGate";

const cfg: Cfg = { volExpansionMin: 1.2, atrMinPct: 2, atrMaxPct: 8, adxMin: 25, adxChopFloor: 20,
  chopMax: 61.8, sessionAllow: [13, 21], fundingExtremePct: 0.05, oiConfirmEnabled: true };
const trending: RegimeState = { compass: { direction: "long", btcAboveTrend: true }, marketVolPct: 40,
  atrPct: 4, atrExpansionRatio: 1.4, adx: 30, adxRising: true, choppiness: 40, utcHour: 15,
  fundingAbs: 0.01, oiRising: true, htfTrendUp: true };

test("clean trend expansion => ALLOW coin_count 2", () => {
  expect(regimeGate(trending, cfg)).toMatchObject({ decision: "ALLOW", coinCount: 2 });
});
test("bear-market dead-cat bounce (BTC below trend, vol top-decile) => STANDDOWN coin_count 0", () => {
  // Same RVOL/ATR spike a breakout shows — the confluence gate would PASS this; regimeGate must not.
  const bounce = { ...trending, compass: { direction: "long", btcAboveTrend: false }, marketVolPct: 95 };
  expect(regimeGate(bounce, cfg)).toMatchObject({ decision: "STANDDOWN", coinCount: 0, reason: "momentum_crash_standdown" });
});
test("high ATR but ADX falling => panic, not expansion => STANDDOWN", () => {
  const panic = { ...trending, atrExpansionRatio: 1.6, adxRising: false, choppiness: 70 };
  expect(regimeGate(panic, cfg).decision).toBe("STANDDOWN");
});
test("extreme funding + OI not rising => veto", () => {
  const squeeze = { ...trending, fundingAbs: 0.09, oiRising: false };
  expect(regimeGate(squeeze, cfg).reason).toBe("funding_extreme_oi_unconfirmed");
});
```

## References
- [Momentum Crashes — Daniel & Moskowitz (NBER w20439, PDF)](https://www.nber.org/system/files/working_papers/w20439/w20439.pdf) — the crash regime this skill exists to veto: momentum's worst losses cluster in panic/rebound states.
- [AQR — Momentum Crashes (Daniel & Moskowitz)](https://www.aqr.com/Insights/Research/Journal-Article/Momentum-Crashes) — same result, practitioner framing; dynamic scaling / standdown as the fix.
- [Avoiding Momentum Crashes — Alpha Architect](https://alphaarchitect.com/avoiding-momentum-crashes/) — regime/vol-based standdown reduces crash severity.
- [ScienceDirect — Avoiding Momentum Crashes: Dynamic Momentum and Contrarian Trading](https://www.sciencedirect.com/science/article/abs/pii/S1042443118303093) — dynamic regime scaling of momentum exposure.
- [Momentum Has Its Moments — Barroso & Santa-Clara (SSRN 2041429)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2041429) — realized-vol scaling nearly eliminates crashes; feeds the `sizeMultiplier`.
- [The Impact of Volatility Targeting — Man Group](https://www.man.com/insights/the-impact-of-volatility-targeting) — vol-percentile regime context behind CAUTION/CRASH thresholds.
- [Average Directional Index (ADX) — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx) — ADX>25 trend / <20 no-trend, and the +DI/-DI directional read used in the chop block.
- [Bitcoin Intraday Time-Series Momentum (Univ. of Reading, PDF)](https://centaur.reading.ac.uk/100181/3/21Sep2021Bitcoin%20Intraday%20Time-Series%20Momentum.R2.pdf) — intraday momentum is time-of-day dependent (session-gate rationale).
- [The crypto world trades at tea time: intraday evidence across global exchanges](https://link.springer.com/article/10.1007/s11156-024-01304-1) — volume/vol concentrate in specific UTC windows.
- [Trading Between Hours — Volatility Dispersion Across Regions (Amberdata)](https://blog.amberdata.io/trading-between-hours-volatility-dispersion-across-multiple-regions) — the EU/US-overlap vs Asian-dead-zone dispersion behind 13–21 UTC.
- [84% of altcoins remain below 200-day average (CryptoQuant)](https://crypto.news/84-of-altcoins-remain-below-200-day-average-cryptoquant-says/) — breadth/breadth-collapse as a crash-regime tell.
- [Bybit V5 — Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — funding sign/cadence for the funding-extreme veto (read per-symbol cadence, don't assume 8h).
- [Bybit V5 — Get Open Interest](https://bybit-exchange.github.io/docs/v5/market/open-interest) — OI slope (`intervalTime` 5/15/60m) that must CONFIRM a funding extreme.
- [Understanding Funding Rates in Perpetual Futures — Coinbase Learn](https://www.coinbase.com/learn/perpetual-futures/understanding-funding-rates-in-perpetual-futures) — funding mechanics behind the crowded-vs-supported read.
- [Bybit V5 — Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — closed 4h/1h bars feeding ATR%, ADX, and Choppiness in the dirty shell.
