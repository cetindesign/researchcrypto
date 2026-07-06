---
name: parameter-optimizer
description: Build and safely operate the `optimizer` loop of this Bybit/Bun trading platform — the background job that runs every 2h to tune strategy PARAMETERS (TP/SL/trailing, layering thresholds, coin-selector cutoffs, cooldowns) against recently stored market data by replaying the pure-core decision functions, then writes the chosen params back to per-user config in MySQL via Drizzle. Covers walk-forward / out-of-sample evaluation, avoiding overfitting and look-ahead / data-leakage, objective functions, parameter search (grid / random / Bayesian) in TypeScript, and guardrails so the optimizer can never push reckless params live. Framed as parameter optimization (not ML training), noting where ML could slot in. Invoke for "optimizer loop", "tune parameters", "parameter search", "grid search", "walk-forward", "out-of-sample", "overfitting", "look-ahead", "data leakage", "objective function", "backtest overfitting", "write params to config", or "auto-tune TP/SL".
---

# Parameter Optimizer (2h loop)

## When to use this skill
- Implementing or changing the `optimizer` loop that re-tunes strategy parameters every 2 hours.
- Choosing an objective function and search method (grid / random / Bayesian) to evaluate candidate params.
- Replaying stored price data through the **pure-core** decision functions to score a parameter set.
- Guarding against overfitting, look-ahead bias, and data leakage in the tuning process.
- Writing accepted parameters back to per-user config (Drizzle) — and blocking reckless ones from going live.

## Core concepts

**This is parameter optimization, not ML training.** The strategy logic is fixed, deterministic code. The optimizer only searches over a small set of **numeric knobs** — take-profit / stop-loss distances, trailing-stop offset, layering (katman) add thresholds, coin-selector score cutoffs, cooldown length — to find values that would have performed well on **recent stored data**. There is no model to fit; the "model" is the strategy, and we tune its config. (Where ML *could* slot in later: replacing the coin-selector score with a learned ranker, or predicting regime — but that is a separate, heavier discipline with its own leakage rules.)

**Score by replaying the pure core.** Each candidate parameter set is evaluated by running the platform's **pure, TDD'd decision functions** (the same ones the engine should use to decide entries/exits) over a window of stored snapshots — no exchange calls, no DB writes, deterministic. Because the core is pure, the same inputs+params always yield the same simulated trades, which makes the search reproducible. (Known deviation: the Bybit engine partly inlines logic instead of calling the pure core — the optimizer must score against the *same* logic the engine runs, or its "improvement" is fiction.)

**Walk-forward / out-of-sample is mandatory.** Optimizing and scoring on the same data reports a fantasy. Split the stored window into an **in-sample** (tune) segment and a later **out-of-sample** (validate) segment; only accept params that also hold up out-of-sample. Better: rolling walk-forward — tune on window N, test on the immediately-following window, roll forward — because it mirrors how the 2h loop actually redeploys params into the near future.

**Overfitting is the default failure.** Try enough parameter combinations and one will look great by luck. Bailey & López de Prado showed high in-sample Sharpe is trivially achievable after only a few configurations, and such strategies systematically underperform live. Defenses: keep the search space small and sensible, penalize by the number of trials (deflated Sharpe intuition), require robustness (neighbors of the best params should also be good — a lone spike is noise), and validate out-of-sample.

**Look-ahead / data leakage.** Every decision at simulated time *t* must use only data available at *t*. Common leaks: computing an indicator with the current (still-forming) candle, joining a slower series (news/funding) on event time instead of its availability time, or filling a simulated entry at the same bar's close that generated the signal. Align all features to bar **close** and fill on the *next* bar.

**Objective function encodes what "good" means.** Raw total PnL over-rewards a few lucky trades and ignores risk. Prefer risk-adjusted objectives: Sharpe/Sortino on the trade returns, or PnL penalized by max drawdown, with a **minimum trade count** so a 2-trade fluke can't win. Include realistic costs — Bybit taker fees (the engine uses MARKET orders), slippage, and funding — or the optimizer will chase over-trading.

## Codebase specifics (Bun / Drizzle / this platform)
- **Trigger:** the `optimizer` loop fires every ~2h (its own scheduler, started after `ensureSchema`). It reads recent rows from the `collector`'s price-snapshot tables plus the news/calendar signal tables via Drizzle.
- **Data source:** stored snapshots in MySQL (the collector persists them); Bybit `GET /v5/market/kline` is the upstream shape (strings for OHLCV, epoch-ms UTC). Parse numerics carefully; keep timestamps UTC.
- **Evaluation harness:** pure functions in `packages/` — import them, feed the candidate params + a slice of stored data, get back simulated trades and a score. No `fetch`, no writes in the scoring path.
- **Search in TypeScript:** implement grid (nested loops over discrete steps), random (sample the space, cheap for many continuous knobs), or a lightweight Bayesian/Optuna-style loop (maintain best-so-far, propose near promising regions). Keep runs bounded — this shares a process with 5 other loops.
- **Writing results back (Drizzle):** accepted params are written to the per-user strategy config table (`db.update(config).set({...}).where(eq(config.userId, id))`) inside a transaction, with the previous values recorded for rollback/audit. The live engine reads config each turn, so a write takes effect on the next engine cycle — which is exactly why guardrails matter.

## Implementation checklist
- [ ] Define the tunable parameter space explicitly (name, min, max, step, and a hard safe range per knob).
- [ ] Pull a stored data window; split into in-sample and out-of-sample (or set up rolling walk-forward folds).
- [ ] Score candidates by replaying the **same** pure-core decision logic the engine uses — no exchange/DB side effects.
- [ ] Use a risk-adjusted objective (Sharpe/Sortino or PnL/maxDD) with a minimum-trades floor and realistic Bybit costs.
- [ ] Run a bounded grid/random/Bayesian search; track number of trials for the overfitting discount.
- [ ] Require the winner to also pass out-of-sample AND be robust (neighbors score similarly), not a lone spike.
- [ ] Clamp every accepted value to its hard safe range; reject any set that violates risk guardrails.
- [ ] Write accepted params to config via Drizzle in a transaction; record old values + the run's score for audit/rollback.
- [ ] Log the run (candidates tried, chosen set, in/out-of-sample scores) so a human can review why params changed.

## Do / Don't
**Do**
- Validate out-of-sample / walk-forward; only ship params that hold up on unseen data.
- Keep the search space small and the knobs interpretable; prefer robust plateaus over sharp peaks.
- Score with the exact decision logic the live engine runs, including MARKET-order fees and slippage.
- Clamp and gate every parameter before it reaches config; keep a rollback of the previous set.
- Align every simulated feature to bar close and fill on the next bar.

**Don't**
- Don't tune and evaluate on the same data — that's guaranteed overfitting.
- Don't let PnL alone be the objective; a couple of lucky trades will hijack it.
- Don't optimize against different logic than the engine actually executes.
- Don't write unbounded params straight to live config — a 0.1% stop or 50x-equivalent sizing is one grid cell away.
- Don't compute indicators on the forming candle or join news/funding on event time (leakage).

## Common pitfalls
- **In-sample mirage:** the "best" params win only on the tuning window; out-of-sample they're mediocre or negative.
- **Logic drift:** the optimizer scores the pure core, but the engine inlines slightly different logic → tuned params don't behave as simulated.
- **Trial explosion:** a fine grid over many knobs finds a lucky combo; without a trials penalty / robustness check it looks like signal.
- **Cost blindness:** ignoring taker fees/slippage makes high-frequency over-trading params look best; live they bleed.
- **Silent leakage:** filling at the signal bar's close, or using the current unfinished candle, inflates every score.
- **Reckless auto-apply:** writing params live with no clamp; the next engine turn acts on a dangerous stop/threshold.
- **Regime overfit:** the last 2h/day was one regime; params tuned to it invert when the market flips. Validate across regimes.

## Code patterns

Score a candidate by replaying the pure core (deterministic, no side effects):
```ts
import { simulateStrategy } from "@repo/core";   // pure, TDD'd decision functions

type Params = { tpPct: number; slPct: number; trailPct: number; addThreshold: number };

function scoreParams(params: Params, bars: Snapshot[], feeRate = 0.00055): number {
  const trades = simulateStrategy(bars, params, { feeRate });   // pure: same in → same out
  if (trades.length < 20) return -Infinity;                     // min-trades floor
  const rets = trades.map((t) => t.pnlPct);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length) || 1e-9;
  return (mean / sd) * Math.sqrt(rets.length);                  // risk-adjusted (Sharpe-like)
}
```

Walk-forward search with an out-of-sample gate:
```ts
function walkForwardOptimize(bars: Snapshot[], space: Params[]): Params | null {
  const cut = Math.floor(bars.length * 0.7);
  const inSample = bars.slice(0, cut), outSample = bars.slice(cut);
  let best: { p: Params; s: number } | null = null;
  for (const p of space) {                                      // grid/random candidates
    const s = scoreParams(p, inSample);
    if (!best || s > best.s) best = { p, s };
  }
  if (!best) return null;
  const oos = scoreParams(best.p, outSample);                   // must survive unseen data
  return oos > 0 ? best.p : null;
}
```

Clamp + gate, then write to config transactionally (Drizzle):
```ts
const SAFE = { slPct: [0.5, 8], tpPct: [0.5, 20], trailPct: [0.2, 10], addThreshold: [0.3, 5] };
const clamp = (v: number, [lo, hi]: number[]) => Math.min(hi, Math.max(lo, v));

async function applyParams(userId: string, p: Params, score: number) {
  const safe: Params = {
    slPct: clamp(p.slPct, SAFE.slPct), tpPct: clamp(p.tpPct, SAFE.tpPct),
    trailPct: clamp(p.trailPct, SAFE.trailPct), addThreshold: clamp(p.addThreshold, SAFE.addThreshold),
  };
  await db.transaction(async (tx) => {
    const [prev] = await tx.select().from(config).where(eq(config.userId, userId));
    await tx.insert(optimizerRun).values({ userId, params: safe, prev: prev, score });  // audit/rollback
    await tx.update(config).set(safe).where(eq(config.userId, userId));                 // engine reads next turn
  });
}
```

## References
- [Advances in Financial Machine Learning — Marcos López de Prado](https://www.wiley.com/en-us/Advances+in+Financial+Machine+Learning-p-9781119482086) — walk-forward, purged CV, overfitting, and why in-sample tuning fails live.
- [The 10 Reasons Most ML/Quant Backtests Fail — López de Prado (GARP)](https://www.garp.org/hubfs/Whitepapers/a1Z1W0000054x6lUAA.pdf) — selection bias, backtest overfitting, deflated Sharpe intuition.
- [Walk-Forward Analysis — IBKR Quant](https://www.interactivebrokers.com/campus/ibkr-quant-news/the-future-of-backtesting-a-deep-dive-into-walk-forward-analysis/) — rolling re-optimization / out-of-sample validation for trading strategies.
- [The Dangers of Backtesting — Portfolio Optimization Book (§8.3)](https://portfoliooptimizationbook.com/book/8.3-dangers-backtesting.html) — data snooping, multiple testing, and robust evaluation.
- [Purged cross-validation — Wikipedia](https://en.wikipedia.org/wiki/Purged_cross-validation) — purge/embargo to prevent leakage when tuning on overlapping windows.
- [Hyperparameter optimization — Wikipedia](https://en.wikipedia.org/wiki/Hyperparameter_optimization) — grid vs random vs Bayesian search trade-offs (applies to parameter search).
- [Grid Search vs Random Search vs Bayesian Optimization — Towards Data Science](https://towardsdatascience.com/grid-search-vs-random-search-vs-bayesian-optimization-2e68f57c3c46/) — when each search method is worth it.
- [Drizzle ORM — Select](https://orm.drizzle.team/docs/select) — reading stored snapshots/config for the scoring harness.
- [Drizzle ORM — Insert](https://orm.drizzle.team/docs/insert) — recording optimizer runs for audit/rollback.
- [Drizzle ORM — MySQL](https://orm.drizzle.team/docs/get-started/mysql-new) — transactions and `update().set().where()` to write params back to config.
- [Bybit V5 — Get Kline (OHLCV)](https://bybit-exchange.github.io/docs/v5/market/kline) — shape of the stored price data (strings, epoch-ms UTC).
- [Bybit V5 — Fee Rate](https://bybit-exchange.github.io/docs/v5/account/fee-rate) — taker/maker fees to include in the objective (engine uses MARKET orders → taker).
