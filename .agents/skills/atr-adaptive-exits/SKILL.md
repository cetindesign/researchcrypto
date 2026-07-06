---
name: atr-adaptive-exits
description: The SkyPower V3 3-layer hybrid adaptive-exit stack for the Bybit v3 engine, written as pure TypeScript ATR/Chandelier functions in packages/ and unit-tested with bun test. Layer 1 = exchange-side disaster stop (Bybit stopLoss on create-order or /v5/position/trading-stop, ~3xATR, survives an engine crash / tick delay); Layer 2 = software initial stop 1.5-2xATR(14) from entry (below 1x -> 65%+ noise stop-outs); Layer 3 = Chandelier trailing (long = HH(22) - 3xATR(22), short = LL(22) + 3xATR(22), ATR recomputed each bar). Also covers the time-stop (8x15min with no 0.5xATR progress -> exit), regime-scaling (ATR > 90th percentile -> halve position, BTC Shock Shield tightens trailing), and post-exit cooldown. Use whenever the task mentions ATR stop, Chandelier exit, trailing stop, disaster stop, stop_loss_order_id, adaptive/volatility exit, time-stop, why static stop_loss_pct is not enough, or building the ATR-stop calculator [KOD].
---

# ATR Adaptive Exits (3-Layer Hybrid, Bybit Perpetuals, TypeScript)

## When to use this skill
- Replacing the static `stop_loss_pct` / `trailing_callback_pct` config with **volatility-adaptive** ATR-based exits.
- Building the missing **ATR-stop calculator** [KOD] and Chandelier trailing engine in the pure core.
- Wiring an **exchange-side disaster stop** (Bybit `stopLoss`) so a position survives an engine crash / polling gap.
- Adding a **time-stop** (no progress after N bars), **regime-scaling** (halve size in high-ATR percentile), or the **BTC Shock Shield** trailing-tightener.
- Reasoning about why a fixed 1.5% stop over-fits one coin and noise-stops another, and how ATR normalizes it.
- Setting up post-exit **cooldown** after a stop / trail-out (see also entry-guards-cooldown, risk-management).

## Core concepts

**Why static `stop_loss_pct` is insufficient.** A fixed percentage stop is a constant applied to non-constant volatility. On a 1% ATR Tier-A coin a 1.5% stop is ~1.5x ATR (reasonable); on an 8% ATR Tier-B coin the same 1.5% stop is **inside the bar's own noise** and gets swept on random ticks. The fleet spans ATR% 1-8% across Tier-A/B, so **one number cannot fit all**. The fix is to express every exit as a **multiple of current ATR**, recomputed per bar — this is the ATR-stop calculator the engine is missing [KOD]. Below **1x ATR you get 65%+ noise stop-outs**; the initial stop lives at **1.5-2x ATR(14)**.

**The 3-layer hybrid.** Exits are defense-in-depth, not one stop:

1. **Exchange-side disaster stop (~3x ATR).** A `stopLoss` attached to the order at create-time (`POST /v5/order/create` with `stopLoss`) or set afterward via `POST /v5/position/trading-stop`. This is **not the normal exit** — it is a wide catastrophe backstop that survives an **engine crash, a deploy restart, or a multi-second polling gap** when software stops can't fire. Set it once, far from the software stop. **Honest caveat:** exchange stops are conditional orders, not guaranteed fills — on a gap / thin book they trigger at a worse price (or, for a stop-limit, may not fill at all). Treat it as *survival insurance*, never as your primary risk number, and treat maintenance margin as the true hard floor beneath it.

2. **Software initial stop (1.5-2x ATR(14)).** The real invalidation. `stop = entry - k*ATR14` (long), `entry + k*ATR14` (short), `k` in **[1.5, 2.0]**. Checked on the engine tick against **mark price**; on breach, close with a reduce-only MARKET order. This is what sizing is computed against (`qty = equity*risk% / (k*ATR)`, see risk-management) so the dollar loss at the stop is constant regardless of the coin's ATR.

3. **Chandelier trailing.** Once in profit, trail with the **Chandelier Exit** (Le Beau): long `stop = HighestHigh(22) - 3*ATR(22)`, short `stop = LowestLow(22) + 3*ATR(22)`. Default `(22, 3.0)`. The stop **ratchets** — for a long it only moves up (`max(prevStop, newStop)`), never down. **ATR and the rolling extreme are recomputed each closed bar**, so the stop breathes with volatility: it widens when the market gets choppy and tightens as a trend matures, keeping you in the move (trend-following's positive skew: let winners run, cut losers).

**Time-stop (no-progress exit).** A trade that neither hits its target nor its stop is dead capital and correlation risk. If after **N bars (e.g. 8 x 15min = 2h)** the position hasn't made **0.5x ATR of favorable progress** from entry, exit at market. This harvests the opportunity cost the stop / target don't capture.

**Regime-scaling.** When current ATR sits **above its own 90th percentile** (rolling window), the coin is in a volatility spike: **halve the position** at entry (or refuse to add). Separately, the **BTC Shock Shield** — a sharp BTC move — is an *emergency brake* that **tightens the trailing multiplier** (e.g. 3x -> 1.5x) and blocks new entries; it is NOT a regime signal (regime is computed by Bulucu on longer bars — see regime-detection).

**Post-exit cooldown.** After any stop-out / trail-out on a symbol, apply a cooldown before re-entry (normal 60min; a loss streak escalates to 24h). Prevents oscillation and revenge re-entries. Enforced by the entry guards, not by the exit code itself.

## Codebase specifics (Bybit / Bun / this platform)

**Pure core placement.** All exit math is **pure functions** in `packages/` (e.g. `packages/exits`): ATR(14/22) Wilder, rolling HH/LL, Chandelier stop, initial-stop distance, time-stop predicate, ATR-percentile / regime scaler. No `fetch`, no Drizzle, no `Date.now()` — the engine (dirty shell) fetches klines / position and *calls* these. Unit-test everything with `bun test`. **[KOD] gap:** the ATR-stop calculator + Chandelier trailing do not exist yet — the engine uses static `stop_loss_pct` / `trailing_callback_pct`; this skill is how you add them.

**`v3_coin_config` keys.** Today's exits are driven by `stop_loss_pct`, `take_profit_pct`, `trailing_enabled`, `trailing_activation_pct`, `trailing_callback_pct` — all **static percents** (`1.5` = 1.5%). Migration path: keep the columns, but **derive their live values from ATR each bar** in the shell (compute `stop_loss_pct = k*ATR/entry*100` before use), or add ATR-native fields. Regime-scaling reads `atr_enabled` / `min_atr_pct`. Cooldown reads `cooldown_enabled`, `cooldown_time_min`, `cooldown_loss_trigger`, `cooldown_loss_time_min`.

**`stop_loss_order_id` columns exist but are unused.** The schema already has `stop_loss_order_id` — the intended home for the exchange-side disaster stop's order id / link id. Wire it: on create-order-with-`stopLoss` (or `trading-stop`), persist the returned id so the reconcile loop can verify the disaster stop is still live on the exchange (exchange = truth, DB = ledger). Currently nothing populates it.

**Engine loop / cadence.** The engine polls (no WebSocket). Signal / exit levels are computed on **closed** bars (15min-4h horizon); the fast loop (~3s/10s) is **execution cadence, not signal cadence** — do not recompute Chandelier off the still-forming bar (repaint). Recompute the stop only when a new bar closes.

**Audit.** Every exit decision (which layer fired, the ATR and stop level, `reason`) -> `v3_decision_log`; the close event -> `v3_position_event`. Keep `reason` machine-readable: `exit:atr_initial`, `exit:chandelier`, `exit:time_stop`, `exit:disaster_stop`, `scale:atr_p90`.

## Implementation checklist
- [ ] Pure `atrWilder(high, low, close, len)` and `rollingExtreme(values, len, "max"|"min")` in `packages/`.
- [ ] Pure `initialStop(entry, side, atr14, k)` with `k` in [1.5, 2.0]; reject `k < 1`.
- [ ] Pure `chandelier(side, hh22|ll22, atr22, mult=3)` + a **ratchet** that never loosens the stop.
- [ ] Pure `timeStopHit(barsHeld, favorableProgress, atr, {maxBars, minProgressAtr})` predicate.
- [ ] Pure `atrRegimeScale(atrNow, atrHistory, {pctile: 0.9, scale: 0.5})` for position halving.
- [ ] Shell: set the **exchange-side disaster stop** (~3x ATR) at create-order or via `/v5/position/trading-stop`; persist `stop_loss_order_id`.
- [ ] Shell: enforce software initial + Chandelier on each closed bar; close via reduce-only MARKET on breach; trigger on **mark** price.
- [ ] Shell: BTC Shock Shield tightens the trailing multiplier and blocks entries; recompute ATR each closed bar (never the forming bar).
- [ ] Shell: on any exit, start the post-exit cooldown (delegate to entry-guards-cooldown).
- [ ] Reconcile: verify the disaster stop still exists on the exchange; re-arm if the exchange dropped it.
- [ ] `bun test` every pure function: k<1 rejection, ratchet monotonicity, short-side inverse, percentile boundary, no-repaint.

## Do / Don't
**Do**
- Express every stop as a **multiple of current ATR**, recomputed per closed bar.
- Keep the software initial stop at **1.5-2x ATR(14)**; keep the exchange disaster stop **wider** (~3x ATR) so they don't collide.
- Ratchet the Chandelier: for a long, `stop = max(prevStop, HH22 - 3*ATR22)` — monotone up only.
- Persist `stop_loss_order_id` and reconcile that the disaster stop is still armed on the exchange.
- Add the time-stop and regime-scaler — they capture risk the price stops miss.

**Don't**
- Don't trust a static `stop_loss_pct` across the Tier-A/B ATR range — it noise-stops volatile coins and over-risks quiet ones.
- Don't use a stop below **1x ATR** (65%+ whipsaw) or let the disaster stop sit on top of the software stop.
- Don't treat the exchange stop as a guaranteed fill — it can slip badly or (stop-limit) not fill; maintenance margin is the real floor.
- Don't recompute Chandelier from the **forming** bar — it repaints; only on bar close.
- Don't let the ratchet ever move the stop against the position, even when ATR shrinks.

## Common pitfalls
- **Repainting trail.** Recomputing HH(22)/ATR(22) off the in-progress bar makes the stop dance and backtest-vs-live diverge; use closed bars.
- **Sub-1x ATR stop.** Tight stops feel safe but harvest noise: ~65%+ stop-outs are just the bar's own range.
- **Disaster stop == software stop.** If both sit at the same distance the exchange one fires first at a worse price; keep it a wide backstop only.
- **Wilder vs SMA ATR.** ATR uses Wilder smoothing; a simple average shifts every stop level and desyncs from StockCharts/TradingView references.
- **Mark vs last price.** Triggering the software stop on last price gets wicked out; liquidation itself uses mark — trigger on mark.
- **Unpersisted `stop_loss_order_id`.** Set the exchange stop but never store its id -> reconcile can't tell if it's still live after a restart.
- **Tick-gap slippage.** Between polls a fast wick can blow through the software stop; the ~3x disaster stop + margin is the only backstop.
- **Percentile lookahead.** Computing the ATR 90th percentile including the current spike biases the threshold; use the trailing window up to the last closed bar.

## Code patterns

Pure ATR (Wilder) + rolling extreme + Chandelier + initial stop (`packages/exits`):
```ts
export function atrWilder(high: number[], low: number[], close: number[], len = 14): (number | undefined)[] {
  const out: (number | undefined)[] = [undefined];
  let atr: number | undefined, sum = 0;
  for (let i = 1; i < close.length; i++) {
    const tr = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    if (i <= len) {                                   // seed with simple average of first `len` TRs
      sum += tr;
      atr = i === len ? sum / len : undefined;
    } else {
      atr = ((atr as number) * (len - 1) + tr) / len; // Wilder smoothing
    }
    out.push(atr);
  }
  return out;
}

export function rollingExtreme(v: number[], len: number, kind: "max" | "min"): (number | undefined)[] {
  return v.map((_, i) => {
    if (i + 1 < len) return undefined;
    const w = v.slice(i - len + 1, i + 1);
    return kind === "max" ? Math.max(...w) : Math.min(...w);
  });
}

export type Side = "long" | "short";

// Wide software invalidation: k in [1.5, 2.0]; the exchange disaster stop uses k ~= 3.
export function initialStop(entry: number, side: Side, atr14: number, k = 1.75): number {
  if (k < 1) throw new Error("stop multiple < 1x ATR => noise stop-outs");
  return side === "long" ? entry - k * atr14 : entry + k * atr14;
}

// Chandelier level for the latest closed bar. ext = HH22 (long) | LL22 (short).
export function chandelier(side: Side, ext: number, atr22: number, mult = 3): number {
  return side === "long" ? ext - mult * atr22 : ext + mult * atr22;
}

// Ratchet: the stop may only tighten toward price, never loosen.
export function ratchet(side: Side, prev: number, next: number): number {
  return side === "long" ? Math.max(prev, next) : Math.min(prev, next);
}
```

Pure time-stop and ATR-regime position scaler:
```ts
export function timeStopHit(
  barsHeld: number, favorableProgress: number, atr: number,
  cfg: { maxBars: number; minProgressAtr: number },              // e.g. { maxBars: 8, minProgressAtr: 0.5 }
): boolean {
  return barsHeld >= cfg.maxBars && favorableProgress < cfg.minProgressAtr * atr;
}

// Halve size when current ATR is above its trailing percentile (exclude the current bar to avoid lookahead).
export function atrRegimeScale(
  atrNow: number, atrHistory: number[],
  cfg = { pctile: 0.9, scale: 0.5 },
): number {
  if (atrHistory.length === 0) return 1;
  const sorted = [...atrHistory].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(cfg.pctile * sorted.length));
  return atrNow >= sorted[idx] ? cfg.scale : 1;
}
```

Shell: arm the exchange-side disaster stop and persist its id (dirty shell, not core):
```ts
// POST /v5/position/trading-stop — signed HMAC(ts+key+recv+jsonBody), X-BAPI headers.
// body: { category:"linear", symbol, positionIdx:0, tpslMode:"Full",
//         stopLoss: String(round(disasterStop, tickSize)), slTriggerBy:"MarkPrice" }
// The response order id / your orderLinkId -> persist into v3_coin_config.stop_loss_order_id,
// then let the reconcile loop confirm it is still live (exchange = truth, DB = ledger).
```

`bun:test` — ratchet monotonicity, k<1 rejection, no repaint:
```ts
import { test, expect } from "bun:test";

test("initial stop rejects sub-1x ATR", () => {
  expect(() => initialStop(100, "long", 2, 0.8)).toThrow();
});

test("chandelier ratchets up only for a long", () => {
  let stop = chandelier("long", 110, 2);                     // 110 - 6 = 104
  stop = ratchet("long", stop, chandelier("long", 112, 2));  // 106 -> tightens up
  expect(stop).toBe(106);
  stop = ratchet("long", stop, chandelier("long", 108, 3));  // 99 -> must NOT loosen
  expect(stop).toBe(106);
});

test("time-stop fires on no progress after N bars", () => {
  expect(timeStopHit(8, 0.3 * 2, 2, { maxBars: 8, minProgressAtr: 0.5 })).toBe(true);
  expect(timeStopHit(8, 0.9 * 2, 2, { maxBars: 8, minProgressAtr: 0.5 })).toBe(false);
});
```

## References
- [Chandelier Exit — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/chandelier-exit) — Le Beau's formula, default (22, 3.0), HH/LL - ATR*mult, long/short.
- [Chandelier Exit — TradingView](https://www.tradingview.com/support/solutions/43000773013-chandelier-exit/) — reference implementation and multiplier/whipsaw tuning.
- [ATR-based stop (Chandelier) — ChartMill](https://www.chartmill.com/documentation/technical-analysis/indicators/30-ATR-based-stop-chandelier-exit) — ATR trailing-stop mechanics and ratcheting behavior.
- [ATR Based Stop Loss and Sizing — AlphaEx Capital](https://www.alphaexcapital.com/prop-trading/risk-money-management-and-psychology-in-prop-trading/prop-risk-management-framework/atr-based-stop-loss-and-sizing) — 1.5-3x ATR stops, dollar-risk-constant sizing, regime awareness.
- [Average True Range: Dynamic Stop Loss Levels — LuxAlgo](https://www.luxalgo.com/blog/average-true-range-dynamic-stop-loss-levels/) — volatility-adaptive stops vs fixed-percent stops; why static stops noise out.
- [Volatility Stop Indicator — LuxAlgo](https://www.luxalgo.com/blog/volatility-stop-indicator-volatility-based-trailing-stop-strategy/) — ATR trailing-stop that flips with trend; time / no-progress considerations.
- [ATR Trading Strategies Guide — TradersPost](https://blog.traderspost.io/article/atr-trading-strategies-guide) — ATR stop multiples, trailing at 1.5x ATR, volatility regimes.
- [How to Identify Market Regimes and Filter by Trend/Volatility — QuantMonitor](https://quantmonitor.net/how-to-identify-market-regimes-and-filter-strategies-by-trend-and-volatility/) — ATR-percentile regime gating and disabling entries in high-vol regimes.
- [What's Trending: A Different Point of Skew — Man Group](https://www.man.com/insights/trend-following-different-point-skew) — why cutting losers with a stop and letting winners trail produces positive skew.
- [Bybit V5 — Set Trading Stop](https://bybit-exchange.github.io/docs/v5/position/trading-stop) — `/v5/position/trading-stop`: stopLoss, slTriggerBy, tpslMode for the exchange-side disaster stop.
- [Bybit V5 — Create Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — attaching `stopLoss`/`slTriggerBy` at order create-time; reduce-only MARKET closes.
- [Bybit — Introduction to Take Profit and Stop Loss (Perpetual/Futures)](https://www.bybit.com/en/help-center/article/Introduction-to-Take-Profit-Stop-Loss-Perpetual-Futures-Contracts) — how conditional TP/SL triggers behave (and why fills aren't guaranteed).
- [Bun — Test runner (`bun:test`)](https://bun.com/docs/test) — Jest-style `test`/`expect` for the pure exit-function unit tests.
