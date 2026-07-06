---
name: backtesting-engine
description: Validate Bybit-perp strategies in TypeScript (Bun) by replaying stored candles and v3_decision_log through the SAME pure-core decision functions the live engine uses. Covers SkyPower V3 cost modeling (maker 0.02% / taker 0.055% fees, Tier-A 5–10 bps / Tier-B 20–50 bps slippage — never slippage=0, 8h funding), both maker/post-only-limit and taker/MARKET fills (not MARKET-only), avoiding look-ahead and survivorship, next-bar fills, walk-forward and in-sample/out-of-sample splits, overfitting control, and metrics (Sharpe, Sortino, max drawdown, profit factor). For the full go-live gate — hold-out, Deflated Sharpe / PBO, ≥300-trade PF≥1.3 PASS BAR, micro-pilot, kill-criteria — see strategy-validation-protocol. Pure bun:test TS; if none exists, build one AROUND the pure core, not a Python engine. Invoke for "backtest", "replay decision log", "walk-forward", "out-of-sample", "look-ahead", "survivorship", "fees/slippage/funding modeling", "maker vs taker cost", "overfitting", "Sharpe/max drawdown/profit factor".
---

# Backtesting Engine

## When to use this skill
- "Backtest the v3 strategy on BTCUSDT perps over the last 2 years" using the pure core, not a rewrite.
- Replaying stored klines (and optionally `v3_decision_log`) through `decide()` to reproduce past behavior.
- Making simulated fills realistic: Bybit taker/maker fees, slippage on MARKET orders, 8h funding.
- Setting up in-sample/out-of-sample splits or walk-forward before trusting an optimizer result.
- Interpreting metrics and catching overfitting ("Sharpe 4 in backtest — is it real?").
- Debugging suspiciously good results: look-ahead on the forming candle, survivorship, data gaps.

## Core concepts
- **Reuse the pure core.** The live v3 engine's decisions come from pure functions (`decide()`, `guardEntry()` — see `strategy-development`). The backtester's only job is to feed those functions historical bars **one closed candle at a time** and simulate the MARKET fills the engine would have sent. If backtest and live share the core, a passing backtest actually means something.
- **SkyPower V3 is no longer MARKET-only — model both fill types.** The legacy engine sent only taker MARKET orders; V3 adds **post-only limit entry** (Kayıkçı chases 2–3 ticks then aborts) and **exchange-side TP/SL** on create-order / `/v5/position/trading-stop`. So the backtester needs two fill paths: (1) *taker MARKET* (Avcı breakouts, forced exits) — cross the spread + slippage, pay the **taker 0.055%** fee; (2) *maker post-only* (Kayıkçı entries) — fill only if price trades through the limit, pay the **maker 0.02%** fee, and model a **maker-fill rate** (some post-onlys never fill and abort). Charging taker on a maker entry silently kills Kayıkçı's whole cost thesis.
- **Slippage is Tier-dependent and never zero.** Size the buffer by liquidity tier: **Tier-A 5–10 bps, Tier-B 20–50 bps** (worse for thin ince-coins). A backtest with `slippage = 0` overstates every edge — on $100 notional the fee+slippage can be double-digit percent of a $1 cut threshold.
- **Replay two ways.** (1) *Signal replay*: run `decide()` over historical candles and simulate fills — tests the strategy end-to-end. (2) *Decision replay*: read the actual `v3_decision_log` rows and re-price them under the cost model — tests "what did our real decisions cost/earn" and validates the engine matches the core.
- **Look-ahead bias.** #1 source of fake profit. Decide on candle *i* (closed), fill at candle *i+1*'s open — never same-bar close. The core already drops the forming bar; the backtester must not hand it future bars either.
- **Survivorship bias.** Crypto alts get delisted / go to zero. If the coin-selector scans many symbols, backtest a point-in-time universe that includes delisted symbols, or you overstate returns.
- **In-sample vs out-of-sample & walk-forward.** Optimize on IS, judge on untouched OOS. Walk-forward rolls the windows (optimize N, test N+1, advance) and stitches OOS results — the honest test of whether the optimizer generalizes rather than curve-fits one lucky split.
- **Overfitting.** Great IS / poor OOS, a sharp parameter peak, too many knobs, unrealistic Sharpe. Prefer a broad plateau of decent params over a spike.

## Codebase specifics
- **Language/runtime.** TypeScript + Bun. The backtester is plain TS the same monorepo package(s) can import; assertions and fixtures run under `bun test`. No Python, pandas, vectorbt, or Freqtrade.
- **If no backtester exists yet.** Per the repo, the live system is a polling engine with a decision log; a formal backtester may be absent. Build a small event loop AROUND the pure core rather than porting a Python framework — a for-loop over candles, a cost-modeled fill, an equity array, and a metrics function.
- **Data source.** Historical klines come from the same Bybit V5 REST (`/v5/market/kline`, newest-first string arrays, max 1000/req — page by time and de-dup) that the collector polls, and/or the `collector` price snapshots already stored in MySQL (read via Drizzle). Normalize to oldest-first numeric candles once.
- **Costs to pull, not guess.** Fetch live fees from `/v5/account/fee-rate` and historical funding from `/v5/market/history-fund-rate`; respect `qtyStep`/`tickSize`/`minOrderQty` from `/v5/market/instruments-info` so simulated sizes match what live orders would round to.
- **Bybit linear perps, one-way mode.** Model funding every 8h (00:00/08:00/16:00 UTC), sign by side; a backtest ignoring funding on held positions overstates PnL.
- **Bybit-only.** No Binance data or examples.

## Implementation checklist
- [ ] Load clean klines: UTC ms timestamps, oldest-first, no gaps, no duplicate `start`, monotonic.
- [ ] Feed the pure `decide()` closed candles only; fill the resulting MARKET order at the **next** bar's open.
- [ ] Apply the right fee per fill (maker 0.02% for post-only entries, taker 0.055% for MARKET) + a Tier-A 5–10 bps / Tier-B 20–50 bps slippage buffer on every entry/exit; apply 8h funding to positions open across a stamp.
- [ ] Model post-only maker-fill rate: an entry that never trades through its limit aborts, it does not fill at market.
- [ ] For the go-live decision, hand results to **strategy-validation-protocol** (hold-out, Deflated Sharpe with trial count, PBO, the ≥300-trade / cost-adjusted PF≥1.3 PASS BAR) — this skill measures; that skill gates.
- [ ] Round sizes to `qtyStep`/`minOrderQty` exactly as the OMS will; reject sub-minimum trades.
- [ ] Use a point-in-time universe (include delisted symbols) if the coin-selector scans many coins.
- [ ] Split IS/OOS and run walk-forward — never optimize and report on the same data.
- [ ] Report Sharpe, Sortino, Calmar, max drawdown, profit factor, win rate, trade count, exposure.
- [ ] Add a look-ahead assertion (a future bar must not change a past decision) and a funding-omission check.
- [ ] Compare against buy-and-hold BTC and a shuffled-signal null.

## Do / Don't
**Do**
- Drive the backtest through the exact pure-core functions the live engine calls.
- Fill at next-bar open with the correct fee (maker for post-only, taker for MARKET) + a Tier-A/B slippage buffer.
- Pull real fee tiers and funding history and apply them per trade and per 8h stamp.
- Judge robustness by OOS / walk-forward and parameter-surface flatness, not a single Sharpe.
- Keep enough trades (100+) for metrics to be meaningful.

**Don't**
- Don't fork the strategy math into the backtester — divergence makes the test worthless.
- Don't fill on the same bar you decided on, or use the forming candle's close.
- Don't ignore funding, fees, or slippage — they routinely flip a "winner" negative on perps.
- Don't optimize and evaluate on the same data, or report the best of a thousand sweeps as expected.
- Don't backtest only currently-listed coins if the selector scans a changing universe.

## Common pitfalls
- **Same-bar look-ahead.** Deciding from bar *i*'s close and filling at bar *i*'s close/open. Delay the fill by one bar.
- **Funding omission.** Holding a perp for days without applying 8h funding hides a real cost (or gain).
- **Fee mis-attribution.** Charge taker 0.055% on MARKET fills and maker 0.02% on post-only entries — using taker everywhere buries Kayıkçı's maker edge; using maker everywhere flatters Avcı's breakout taker cost.
- **Data quality.** Forward-filled missing candles create phantom flat periods; duplicate `start` timestamps double-count. Validate before running.
- **Metric misuse.** Crypto trades 24/7/365 — annualize Sharpe with 365 (not 252). Sortino needs a target/MAR; Calmar = CAGR / |maxDD|.
- **p-hacking.** Sweeping thousands of parameter sets and reporting the best inflates Sharpe by luck. Discount with walk-forward/OOS.
- **Backtester-vs-engine drift.** If decision replay of `v3_decision_log` doesn't match a fresh signal replay, the engine has inlined logic that diverges from the pure core — fix the engine.

## Code patterns
Bybit V3 cost model — maker/taker fee + Tier-aware slippage + 8h funding (pure TypeScript):

```ts
const FEE = { maker: 0.0002, taker: 0.00055 };   // confirm via /v5/account/fee-rate
const SLIP_BPS = { A: [5, 10] as const, B: [20, 50] as const }; // Tier-A / Tier-B — NEVER 0

/** Taker MARKET fill (Avcı breakout, forced exit): cross the spread, add tier slippage, pay taker. */
export function marketFill(side: "buy" | "sell", mid: number, qty: number, spread: number, tier: "A" | "B") {
  const slip = spread / 2 + mid * (SLIP_BPS[tier][1] / 10_000); // worst end of the band when unsure
  const price = side === "buy" ? mid + slip : mid - slip;
  return { price, fee: price * qty * FEE.taker, filled: true };
}

/** Post-only maker fill (Kayıkçı entry): fills ONLY if the bar trades through the limit; else it aborts. */
export function makerFill(side: "buy" | "sell", limit: number, qty: number, barLow: number, barHigh: number) {
  const filled = side === "buy" ? barLow <= limit : barHigh >= limit;
  return filled
    ? { price: limit, fee: limit * qty * FEE.maker, filled: true }   // maker rate, no slippage past the limit
    : { price: NaN, fee: 0, filled: false };                          // never filled → chase/abort, don't market in
}

/** Funding is charged every 8h; a long pays when the rate is positive. */
export function fundingCost(notional: number, rate: number, side: "long" | "short") {
  const sign = side === "long" ? 1 : -1;
  return -sign * notional * rate;
}
```

Event loop that replays candles through the pure core (no look-ahead: fill next bar):

```ts
import { decide, type Candle, type StrategyConfig, type GuardState } from "@repo/strategy-core";

export function backtest(candles: Candle[], cfg: StrategyConfig, guardAt: (t: number) => GuardState) {
  let cash = 10_000, pos: { size: number; avgPrice: number; layers: number } | null = null;
  const equity: number[] = [];
  for (let i = 0; i < candles.length - 1; i++) {
    const window = candles.slice(0, i + 1);            // closed bars up to i
    const d = decide(window, cfg, guardAt(candles[i].start), pos);
    const nextOpen = candles[i + 1].open;              // fill on the NEXT bar's open
    const tier = d.tier ?? "A";                        // role/universe partition: Kayıkçı = A, Avcı = A|B
    if (d.action === "enterLong") {
      const qty = (cash * (d.sizeWeight ?? 1)) / nextOpen;
      const { price, fee } = marketFill("buy", nextOpen, qty, /*spread*/ nextOpen * 0.0002, tier);
      pos = { size: qty, avgPrice: price, layers: 1 }; cash -= fee;
    } else if (d.action === "close" && pos) {
      const { price, fee } = marketFill("sell", nextOpen, pos.size, nextOpen * 0.0002, tier);
      cash += pos.size * (price - pos.avgPrice) - fee; pos = null;
    }
    equity.push(cash + (pos ? pos.size * (nextOpen - pos.avgPrice) : 0));
  }
  return equity;
}
```

Metrics (crypto = 365d) and a walk-forward skeleton:

```ts
export function sharpe(returns: number[], periodsPerYear = 365) {
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
  return sd === 0 ? 0 : (mean / sd) * Math.sqrt(periodsPerYear);
}
export function maxDrawdown(equity: number[]) {
  let peak = equity[0], mdd = 0;
  for (const e of equity) { peak = Math.max(peak, e); mdd = Math.min(mdd, e / peak - 1); }
  return mdd; // negative
}

export function walkForward<T>(
  data: T[], isLen: number, oosLen: number, step: number,
  optimize: (s: T[]) => StrategyConfig, evaluate: (s: T[], c: StrategyConfig) => number,
) {
  const oos: number[] = [];
  for (let start = 0; start + isLen + oosLen <= data.length; start += step) {
    const best = optimize(data.slice(start, start + isLen));                    // fit on IS only
    oos.push(evaluate(data.slice(start + isLen, start + isLen + oosLen), best)); // judge on OOS only
  }
  return oos;
}
```

Look-ahead assertion with `bun:test`:

```ts
import { test, expect } from "bun:test";
test("a future bar never changes a past decision", () => {
  const upto = candles.slice(0, 500);
  const a = decide(upto, cfg, guard, null);
  const b = decide([...upto, candles[500]], cfg, guard, null); // append a FUTURE bar
  expect(a).toEqual(b); // the pure core decides on closed bars up to the same point
});
```

## References
- [Bun — Test runner (`bun:test`)](https://bun.com/docs/test) — assertions and fixtures for deterministic backtest checks.
- [Bun — Documentation](https://bun.com/docs) — running TS backtest scripts and packages under Bun.
- [Turborepo — Introduction](https://turborepo.dev/docs) — importing the shared pure-core package into the backtester.
- [Drizzle ORM — MySQL get started](https://orm.drizzle.team/docs/mysql/get-started-mysql) — reading stored klines / `v3_decision_log` for replay.
- [Bybit V5 — Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — historical candles, 1000-row limit, newest-first ordering, pagination.
- [Bybit V5 — Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — 8h funding stamps to charge held positions.
- [Bybit V5 — Get Fee Rate](https://bybit-exchange.github.io/docs/v5/account/fee-rate) — live maker/taker fees to feed the cost model.
- [Bybit Trading Fee Structure — Help Center](https://www.bybit.com/en/help-center/article/Trading-Fee-Structure) — USDⓈ-M perp base rates: maker 0.02% / taker 0.055%.
- [Bybit V5 — Set Trading Stop](https://bybit-exchange.github.io/docs/v5/position/trading-stop) — exchange-side TP/SL the V3 engine now uses (no longer MARKET-only).
- [Deflated Sharpe ratio — Wikipedia](https://en.wikipedia.org/wiki/Deflated_Sharpe_ratio) — deflating a swept Sharpe by the trial count; the go-live gate lives in strategy-validation-protocol.
- [Bybit V5 — Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — `qtyStep`/`tickSize`/`minOrderQty` for realistic rounding.
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position) — fields to reconcile decision-replay results against real positions.
- [Bybit V5 — Introduction](https://bybit-exchange.github.io/docs/v5/intro) — linear perps, categories, one-way mode assumptions for the simulator.
