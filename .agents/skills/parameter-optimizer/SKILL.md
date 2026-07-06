---
name: parameter-optimizer
description: Parameter tuning for this Bybit/Bun platform under SkyPower V3, where the legacy live 2h frequency-targeting optimizer loop is TURNED OFF (optimizer_enabled: 0). Tuning of PARAMETERS (TP/SL/trailing, decreasing profit-pyramid thresholds, coin-selector cutoffs, cooldowns) now happens OFFLINE via walk-forward inside strategy-validation-protocol — replay pure-core decision functions over stored data, tune in-sample, judge out-of-sample, promote only params that clear the hold-out + Deflated Sharpe + PASS BAR gate. Covers walk-forward / out-of-sample evaluation, overfitting and look-ahead / data-leakage, objective functions, parameter search (grid / random / Bayesian) in TypeScript, guardrails, and a warning against live frequency-chasing auto-tuning (over-trading = fee bleed). Invoke for "tune parameters", "parameter search", "grid search", "walk-forward", "out-of-sample", "overfitting", "look-ahead", "data leakage", "objective function", "why is the optimizer disabled", "offline tuning", or "auto-tune TP/SL".
---

# Parameter Optimizer (live loop OFF — tune offline)

> **SkyPower V3: the live 2h optimizer is disabled (`optimizer_enabled: 0`).** The old loop re-tuned params every 2h to hit a target trade *frequency*, which just maximized fee bleed on a maker-starved, taker-heavy book. Parameter tuning now happens **offline, inside strategy-validation-protocol**: walk-forward on stored data, judged out-of-sample against a hold-out + Deflated Sharpe + the ≥300-trade / cost-adjusted PF≥1.3 PASS BAR. This skill is the *tuning mechanics* used inside that gate — not a background job that writes to live config on a timer.

## When to use this skill
- Running an **offline** walk-forward parameter search as part of validating a role before it goes live.
- Choosing an objective function and search method (grid / random / Bayesian) to evaluate candidate params.
- Replaying stored price data through the **pure-core** decision functions to score a parameter set.
- Guarding against overfitting, look-ahead bias, and data leakage in the tuning process.
- Understanding *why* the live 2h loop is off and what a frequency-chasing optimizer does to costs.
- Promoting accepted parameters into `v3_coin_config` (Drizzle) **through the validation gate**, never as an unattended live auto-apply.

## Core concepts

**The live loop is OFF; tuning is offline and gated.** Under SkyPower V3, `optimizer_enabled: 0`. There is no unattended job rewriting live config every 2h. Instead you run this search **offline** over a long stored window, hand the winner to **strategy-validation-protocol** (walk-forward → untouched hold-out → Deflated Sharpe with trial count → PBO → PASS BAR → mainnet micro-pilot), and only *then* promote params — with a human in the loop and a rollback recorded. A parameter change is a config edit that itself must clear the gate, not a side effect of a scheduler.

**Never optimize for trade frequency.** The disabled loop's objective — "trade more / hit a target cadence" — is exactly wrong for this cost structure. More trades = more taker fees + more slippage on ince-coins; on $100 notional a taker round-trip is ~11% of a $1 cut threshold. Optimize for **cost-adjusted, risk-adjusted** outcomes (see the objective bullet), and if anything, prefer *fewer, higher-conviction* trades. Widen the scanning universe, don't lower the entry threshold to manufacture volume.

**This is parameter optimization, not ML training.** The strategy logic is fixed, deterministic code. The search covers a small set of **numeric knobs** — TP/SL distances, trailing offset, decreasing profit-pyramid thresholds (`profit_layer_multiplier` ≤0.7, `profit_max_layers` 2–3, Avcı only), coin-selector cutoffs, cooldown lengths — to find values that would have performed well on stored data. There is no model to fit; the "model" is the strategy and we tune its config. Note DCA-on-loss is eliminated (`loss_layer_enabled: 0`) — never tune it back on. (Where ML *could* slot in later: a learned coin-selector ranker or regime predictor — a separate, heavier discipline with its own leakage rules.)

**Score by replaying the pure core.** Each candidate is evaluated by running the platform's **pure, TDD'd decision functions** over a window of stored snapshots — no exchange calls, no DB writes, deterministic. Same inputs+params always yield the same simulated trades, so the search is reproducible. (Known deviation: the Bybit engine partly inlines logic instead of calling the pure core — score against the *same* logic the engine runs, or the "improvement" is fiction.)

**Walk-forward / out-of-sample is mandatory.** Optimizing and scoring on the same data reports a fantasy. Split the stored window into an **in-sample** (tune) segment and a later **out-of-sample** (validate) segment; only accept params that hold up out-of-sample. Better: rolling walk-forward — tune on window N, test on the immediately-following window, roll forward. **Count every trial** (candidate × fold) so the Deflated Sharpe correction in the validation gate is computable — an un-deflated best-of-sweep Sharpe is noise.

**Overfitting is the default failure.** Try enough parameter combinations and one will look great by luck. Bailey & López de Prado showed high in-sample Sharpe is trivially achievable after only a few configurations, and such strategies systematically underperform live. Defenses: keep the search space small and sensible, penalize by the number of trials (deflated Sharpe intuition), require robustness (neighbors of the best params should also be good — a lone spike is noise), and validate out-of-sample.

**Look-ahead / data leakage.** Every decision at simulated time *t* must use only data available at *t*. Common leaks: computing an indicator with the current (still-forming) candle, joining a slower series (news/funding) on event time instead of its availability time, or filling a simulated entry at the same bar's close that generated the signal. Align all features to bar **close** and fill on the *next* bar.

**Objective function encodes what "good" means.** Raw total PnL over-rewards a few lucky trades and ignores risk; a frequency target rewards fee bleed. Prefer risk-adjusted, cost-adjusted objectives: Sharpe/Sortino on trade returns or PnL penalized by max drawdown, with a **minimum trade count** (the gate wants ≥300) so a fluke can't win. Include realistic V3 costs on every simulated fill — **maker 0.02% for post-only entries, taker 0.055% for MARKET, a Tier-A 5–10 bps / Tier-B 20–50 bps slippage buffer (never 0), and 8h funding** — or the search will "discover" over-trading. See backtesting-engine for the exact cost model and strategy-validation-protocol for the cost-adjusted PF≥1.3 bar.

## Codebase specifics (Bun / Drizzle / this platform)
- **No live trigger under V3.** `optimizer_enabled: 0` — the 2h scheduler that used to fire this does not run for SkyPower V3. Treat the search as an **offline tool** you invoke deliberately (a script / test run under Bun), reading a long stored window, not a background loop sharing the live process. If you find the 2h loop still wired, disabling it is part of adopting V3.
- **Data source:** stored snapshots in MySQL (the collector persists them) and/or Bybit `GET /v5/market/kline` (strings for OHLCV, epoch-ms UTC — parse numerics, keep timestamps UTC). Tune on **15min–4h** bars — the signal horizon, not the 3s execution cadence.
- **Evaluation harness:** pure functions in `packages/` — feed candidate params + a slice of stored data, get back simulated trades and a score. No `fetch`, no writes in the scoring path.
- **Config keys under test (real `v3_coin_config` names):** `take_profit_pct`, `stop_loss_pct`, `trailing_activation_pct`, `trailing_callback_pct`, `profit_layer_multiplier`, `profit_max_layers`, `profit_add_step_pct`, `cooldown_time_min`, `cooldown_loss_trigger`, `cooldown_loss_time_min`, `min_atr_pct`, `ema_short`/`ema_long`, `min_volume_usdt`, `max_spread_pct`, `min_momentum_pct`. `*_pct` are **percent units** (`1.5` = 1.5%). The `profit_add_step_pct` / `layer_trigger_type` UNIT (price-% vs margin-%) is UNVERIFIED — confirm from code before tuning pyramid thresholds. Do NOT expose `loss_layer_enabled` or `optimizer_enabled` to the search (both fixed at 0).
- **Search in TypeScript:** grid (nested loops over discrete steps), random (cheap for many continuous knobs), or a lightweight Bayesian/Optuna-style loop (best-so-far, propose near promising regions). Log every trial for the DSR trial count.
- **Promoting results (Drizzle), gated — not auto-applied:** a tuned set is written to `v3_coin_config` only **after it clears strategy-validation-protocol** (hold-out + DSR + PASS BAR) and with human sign-off; wrap the write in a transaction and record the previous values for rollback/audit. Because the live engine reads config each turn, an unbounded or ungated write is dangerous — which is exactly why the timer-driven auto-apply is off.

## Implementation checklist
- [ ] Define the tunable parameter space explicitly (name, min, max, step, and a hard safe range per knob).
- [ ] Pull a stored data window; split into in-sample and out-of-sample (or set up rolling walk-forward folds).
- [ ] Score candidates by replaying the **same** pure-core decision logic the engine uses — no exchange/DB side effects.
- [ ] Use a risk-adjusted, cost-adjusted objective (Sharpe/Sortino or PnL/maxDD) with a minimum-trades floor — never a trade-frequency target — and full V3 costs (maker/taker + Tier-A/B slippage + funding).
- [ ] Run a bounded grid/random/Bayesian search; **log every trial** (candidate × fold) for the Deflated Sharpe correction.
- [ ] Require the winner to also pass out-of-sample AND be robust (neighbors score similarly), not a lone spike.
- [ ] Clamp every accepted value to its hard safe range; reject any set that violates risk guardrails.
- [ ] Hand the winner to strategy-validation-protocol (hold-out + DSR + PBO + PASS BAR) BEFORE promotion — do not auto-apply.
- [ ] Only on passing the gate, write params to `v3_coin_config` via Drizzle in a transaction (record old values + score for rollback), with human sign-off.
- [ ] Log the run (candidates tried, chosen set, in/out-of-sample scores) so a human can review why params changed.

## Do / Don't
**Do**
- Tune **offline** and promote only through the validation gate; keep the live 2h auto-tune off (`optimizer_enabled: 0`).
- Validate out-of-sample / walk-forward; only ship params that hold up on unseen data and a one-time hold-out.
- Keep the search space small and the knobs interpretable; prefer robust plateaus over sharp peaks.
- Score with the exact decision logic the live engine runs, including the right maker/taker fee + Tier-A/B slippage + funding.
- Clamp and gate every parameter before it reaches config; keep a rollback of the previous set.
- Align every simulated feature to bar close and fill on the next bar.

**Don't**
- Don't re-enable a live timer that rewrites config, and never optimize for trade frequency/turnover — it just buys fee bleed.
- Don't tune and evaluate on the same data — that's guaranteed overfitting.
- Don't let PnL alone be the objective; a couple of lucky trades will hijack it.
- Don't optimize against different logic than the engine actually executes.
- Don't write unbounded or ungated params to live config — a 0.1% stop or 50x-equivalent sizing is one grid cell away.
- Don't compute indicators on the forming candle or join news/funding on event time (leakage).

## Common pitfalls
- **In-sample mirage:** the "best" params win only on the tuning window; out-of-sample they're mediocre or negative.
- **Logic drift:** the optimizer scores the pure core, but the engine inlines slightly different logic → tuned params don't behave as simulated.
- **Trial explosion:** a fine grid over many knobs finds a lucky combo; without a trials penalty / robustness check it looks like signal.
- **Cost blindness / frequency chasing:** ignoring maker/taker fees + Tier-A/B slippage makes high-frequency over-trading params look best; live they bleed. The disabled 2h loop's frequency target was this pitfall institutionalized.
- **Silent leakage:** filling at the signal bar's close, or using the current unfinished candle, inflates every score.
- **Reckless auto-apply:** the reason the live loop is off — a timer writing params with no gate/clamp means the next engine turn acts on a dangerous or overfit stop/threshold.
- **Ungated promotion:** shipping a walk-forward winner without the hold-out + DSR/PBO + PASS BAR + micro-pilot in strategy-validation-protocol — walk-forward alone under-detects overfitting.
- **Regime overfit:** the last window was one regime; params tuned to it invert when the market flips. Validate across ≥2 regimes (trend + range).

## Code patterns

Score a candidate by replaying the pure core (deterministic, no side effects):
```ts
import { simulateStrategy } from "@repo/core";   // pure, TDD'd decision functions

type Params = { tpPct: number; slPct: number; trailPct: number; addThreshold: number };

// Full V3 costs — maker for post-only entries, taker for MARKET, tier slippage, funding. Never fee-free.
const COSTS = { makerFee: 0.0002, takerFee: 0.00055, slipBps: { A: 10, B: 50 }, applyFunding: true };

function scoreParams(params: Params, bars: Snapshot[]): number {
  const trades = simulateStrategy(bars, params, COSTS);         // pure: same in → same out
  if (trades.length < 300) return -Infinity;                    // PASS-BAR min-trades floor
  const rets = trades.map((t) => t.pnlPct);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length) || 1e-9;
  return (mean / sd) * Math.sqrt(rets.length);                  // risk-adjusted (Sharpe-like)
}
```

Walk-forward search with an out-of-sample gate (offline; trial count feeds the DSR in the validation gate):
```ts
function walkForwardOptimize(bars: Snapshot[], space: Params[]): { p: Params; trials: number } | null {
  const cut = Math.floor(bars.length * 0.7);
  const inSample = bars.slice(0, cut), outSample = bars.slice(cut);
  let best: { p: Params; s: number } | null = null;
  let trials = 0;
  for (const p of space) {                                      // grid/random candidates
    trials++;                                                   // count EVERY trial for Deflated Sharpe
    const s = scoreParams(p, inSample);
    if (!best || s > best.s) best = { p, s };
  }
  if (!best) return null;
  const oos = scoreParams(best.p, outSample);                   // must survive unseen data
  // NB: this is a candidate only — it still owes the untouched hold-out + DSR/PBO + PASS BAR + micro-pilot.
  return oos > 0 ? { p: best.p, trials } : null;
}
```

Clamp + gate, then write to config transactionally (Drizzle) — ONLY after the validation gate + human sign-off:
```ts
const SAFE = { slPct: [0.5, 8], tpPct: [0.5, 20], trailPct: [0.2, 10], addThreshold: [0.3, 5] };
const clamp = (v: number, [lo, hi]: number[]) => Math.min(hi, Math.max(lo, v));

// gatePassed proves the winner cleared strategy-validation-protocol (hold-out + DSR + PASS BAR + micro-pilot).
async function promoteParams(userId: string, p: Params, score: number, gatePassed: boolean) {
  if (!gatePassed) throw new Error("refusing to write config: validation gate not passed");
  const safe: Params = {
    slPct: clamp(p.slPct, SAFE.slPct), tpPct: clamp(p.tpPct, SAFE.tpPct),
    trailPct: clamp(p.trailPct, SAFE.trailPct), addThreshold: clamp(p.addThreshold, SAFE.addThreshold),
  };
  await db.transaction(async (tx) => {
    const [prev] = await tx.select().from(config).where(eq(config.userId, userId));
    await tx.insert(optimizerRun).values({ userId, params: safe, prev, score });   // audit/rollback
    await tx.update(config).set(safe).where(eq(config.userId, userId));            // engine reads next turn
  });
}
```

## References
- [Advances in Financial Machine Learning — Marcos López de Prado](https://www.wiley.com/en-us/Advances+in+Financial+Machine+Learning-p-9781119482086) — walk-forward, purged CV, overfitting, and why in-sample tuning fails live.
- [The 10 Reasons Most ML/Quant Backtests Fail — López de Prado (GARP)](https://www.garp.org/hubfs/Whitepapers/a1Z1W0000054x6lUAA.pdf) — selection bias, backtest overfitting, deflated Sharpe intuition.
- [Deflated Sharpe ratio — Wikipedia](https://en.wikipedia.org/wiki/Deflated_Sharpe_ratio) — why you must count trials; the offline winner's Sharpe is deflated in the validation gate.
- [The Probability of Backtest Overfitting — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253) — PBO/CSCV: probability the in-sample best ranks below the OOS median.
- [Walk-Forward Analysis — IBKR Quant](https://www.interactivebrokers.com/campus/ibkr-quant-news/the-future-of-backtesting-a-deep-dive-into-walk-forward-analysis/) — rolling re-optimization / out-of-sample validation for trading strategies.
- [The Dangers of Backtesting — Portfolio Optimization Book (§8.3)](https://portfoliooptimizationbook.com/book/8.3-dangers-backtesting.html) — data snooping, multiple testing, and robust evaluation.
- [Purged cross-validation — Wikipedia](https://en.wikipedia.org/wiki/Purged_cross-validation) — purge/embargo to prevent leakage when tuning on overlapping windows.
- [Hyperparameter optimization — Wikipedia](https://en.wikipedia.org/wiki/Hyperparameter_optimization) — grid vs random vs Bayesian search trade-offs (applies to parameter search).
- [Drizzle ORM — Select](https://orm.drizzle.team/docs/select) — reading stored snapshots/config for the scoring harness.
- [Drizzle ORM — Insert](https://orm.drizzle.team/docs/insert) — recording optimizer runs for audit/rollback.
- [Drizzle ORM — MySQL](https://orm.drizzle.team/docs/get-started/mysql-new) — transactions and `update().set().where()` to write params back to config.
- [Bybit V5 — Get Kline (OHLCV)](https://bybit-exchange.github.io/docs/v5/market/kline) — shape of the stored price data (strings, epoch-ms UTC).
- [Bybit V5 — Fee Rate](https://bybit-exchange.github.io/docs/v5/account/fee-rate) — maker/taker fees to include in the cost-adjusted objective.
- [Bybit Trading Fee Structure — Help Center](https://www.bybit.com/en/help-center/article/Trading-Fee-Structure) — USDⓈ-M perp base rates: maker 0.02% / taker 0.055%.
- [Profit Factor in Trading — QuantifiedStrategies](https://www.quantifiedstrategies.com/profit-factor/) — the cost-adjusted PF≥1.3 objective the promoted params must clear.
