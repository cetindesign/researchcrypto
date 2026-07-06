---
name: strategy-validation-protocol
description: The per-role proof discipline deciding whether a SkyPower V3 fleet role (Avcı hunter, Kayıkçı boatman, Safra ballast) may trade real capital. The full evidence pipeline — cost-aware backtest on 15min–4h bars (Bybit maker 0.02% / taker 0.055% + Tier-A 5–10 bps / Tier-B 20–50 bps slippage + 8h funding, never slippage=0), walk-forward tuning, a one-time untouched hold-out (20–30%), Deflated Sharpe counting every trial, Probability of Backtest Overfitting (PBO), the PASS BAR (≥300 trades, cost-adjusted profit factor ≥1.3, positive EV, no crash in ≥2 regimes incl. trend + range), a mainnet micro-pilot ($100–300/role, 2–4 weeks measuring real fill/slippage/funding + maker-fill rate), then staged scale with −10%-of-role-budget kill-criteria. REPLACES the live 2h frequency optimizer (optimizer_enabled: 0). Invoke for "validate a role before going live", "is this strategy proven", "hold-out", "deflated Sharpe", "PBO", "pass bar", "micro-pilot", "kill criteria", "cost-adjusted profit factor", "is it overfit".
---

# Strategy Validation Protocol (per-role proof gate)

## When to use this skill
- Deciding whether a fleet role (Avcı, Kayıkçı, Safra) may graduate from paper to real Bybit capital.
- Building the TypeScript backtest → walk-forward → hold-out → micro-pilot pipeline that produces that proof.
- Answering "is this edge real or curve-fit?" — computing Deflated Sharpe / PBO and reading the PASS BAR.
- Setting kill-criteria and staged scale-up limits before a role touches size.
- Replacing the old live 2h frequency-optimizer with offline, evidence-based tuning (`optimizer_enabled: 0`).
- Ordering role rollout: Kayıkçı first (config-only), then Avcı, then Safra (engine change) — each must pass the same gate.

## Core concepts
- **A role trades only after it clears one fixed gate.** Every role runs the identical pipeline: cost-aware backtest → walk-forward tune → hold-out → DSR/PBO → PASS BAR → mainnet micro-pilot → staged scale. No shortcut, no "it looked good in the last 2h". Bulucu (Finder) never trades (`engine_enabled: 0`, capital $0), so it is validated on universe/regime quality (does its candidate list + compass improve the other roles' pilot metrics), not on PnL.
- **Cost is the thing being proven, not a footnote.** On $100 notional a $1 cut threshold is 1% of notional; a taker round-trip is ≈0.11% = 11% of that threshold, and Tier-B slippage of 20–100 bps can erase the rest. A validation that models `slippage = 0` is fraud against yourself. Model maker 0.02% / taker 0.055%, a slippage buffer (**Tier-A 5–10 bps, Tier-B 20–50 bps**), and 8h funding on every held position. Signal on **15min–4h bars** — the 3s loop is execution cadence, not the horizon you validate.
- **Walk-forward is how you TUNE; hold-out is how you JUDGE.** Roll the window: fit params on in-sample N, score on the immediately-following out-of-sample N+1, advance, stitch the OOS results. That mirrors how config would actually be redeployed. Reserve a final **20–30% slice you never touch during any tuning or model selection** — look at it exactly once, at the very end. If you peek at the hold-out and then change anything, it is burned; re-cut from fresh data.
- **Deflated Sharpe Ratio — count every trial.** The more parameter sets / roles / windows you try, the higher the best Sharpe you'll see by luck alone. DSR deflates the observed Sharpe by the number of independent trials, sample length, skew and kurtosis, and returns the probability the true Sharpe is > 0. **You must log the trial count** (every candidate scored across every walk-forward fold) or DSR is uncomputable — an un-deflated Sharpe from a sweep is meaningless.
- **Probability of Backtest Overfitting (PBO).** Complementary to DSR: via combinatorially-symmetric cross-validation (CSCV), PBO estimates the chance that the configuration ranked best in-sample lands **below the OOS median**. A high PBO (say >0.5) means your selection process is overfitting regardless of how pretty the headline curve is.
- **The PASS BAR (all must hold, per role):** **≥300 trades** (statistical mass — 30 trades of PF 4 is noise), **cost-adjusted profit factor ≥1.3** (gross profit / gross loss AFTER fees + slippage + funding), **positive expectancy** (avg-win × win-rate > avg-loss × loss-rate; with ~34% win rate that demands avg winner ≈2.3–4× avg loser), and **no blow-up across ≥2 regimes including at least one trending and one ranging market**. Miss any one → the role does not go live.
- **Mainnet micro-pilot is the real oracle.** Backtests can't tell you your true fill price, real maker-fill rate, or whether the cooldown actually fires. Run **$100–300 per role for 2–4 weeks** on real Bybit mainnet (tiny, but real) and measure: realized vs. modeled slippage, funding actually paid, **post-only maker-fill rate** (Kayıkçı's whole thesis), exchange-side TP/SL trigger behavior, and cooldown/blacklist effectiveness. If realized slippage exceeds your Tier buffer, the backtest lied — re-validate.
- **Staged scale + kill-criteria.** Only after the pilot confirms modeled costs do you scale in stages (e.g. pilot → 25% → 50% → full role budget), re-checking metrics at each step. Hard rule: **drawdown of −10% of a role's allocated budget auto-pauses that role** (halt new entries, keep managing exits) pending human review. This is a mechanical circuit-breaker, not a judgment call.
- **This replaces the live frequency-optimizer.** SkyPower V3 sets `optimizer_enabled: 0`. Tuning that used to chase a target trade frequency every 2h now happens **offline inside this protocol**, judged on cost-adjusted, overfitting-corrected, out-of-sample evidence — never on live frequency.

## Codebase specifics
- **Language/runtime.** Plain TypeScript under Bun; the harness lives in `packages/` and its assertions run under `bun test`. No Python, pandas, vectorbt, or Freqtrade.
- **Drive the pure core.** The harness replays stored candles (and/or `v3_decision_log` rows) through the **same pure decision functions** the live engine calls (`decide()`, guards, exit math). If the harness forks the strategy math, a passing gate proves nothing. (Known risk: the engine partly inlines logic — reconcile it against the pure core, or the validation scores a different strategy than production runs.)
- **Data.** Historical klines from Bybit `GET /v5/market/kline` (newest-first string arrays, ≤1000/req — page and de-dup) and/or collector snapshots in MySQL (read via Drizzle). Funding from `GET /v5/market/history-fund-rate`; fees from `GET /v5/account/fee-rate`; `qtyStep`/`tickSize`/`minOrderQty` from `GET /v5/market/instruments-info` so simulated sizes round exactly as live orders would. Normalize to oldest-first numeric candles once.
- **Config under test lives in `v3_coin_config`.** The knobs the walk-forward tunes are the real keys — `take_profit_pct`, `stop_loss_pct`, `trailing_activation_pct`, `trailing_callback_pct`, `profit_layer_multiplier`, `profit_max_layers`, `cooldown_time_min`, `cooldown_loss_trigger`, `cooldown_loss_time_min`, `min_atr_pct`, `ema_short`/`ema_long`, `min_volume_usdt`, `max_spread_pct`, etc. `*_pct` values are **percent units** (`1.5` = 1.5%). Note `loss_layer_enabled` is fixed **0** (DCA-on-loss is eliminated — do not tune it back on) and `optimizer_enabled` is **0**. The `add_step_pct` / `layer_trigger_type` UNIT (price-% vs margin-%) is UNVERIFIED — confirm from code before tuning any pyramid threshold.
- **Per-role universe partition (must be honored in backtest).** Kayıkçı = **Tier-A only** (post-only limit entry); Avcı = **Tier-A + Tier-B** with a higher signal threshold (taker OK on breakout); Safra = Tier-A spot+perp funding pairs. Backtesting Avcı on Tier-A liquidity only, then trading Tier-B, invalidates the buffer.
- **[KOD] gaps this protocol depends on.** Point-in-time universe (include delisted symbols → no survivorship), trial-count logging for DSR, a persisted hold-out cut that tooling refuses to read during tuning, and a role-budget drawdown monitor to enforce the −10% kill-switch. These are mostly missing today; build them as part of the gate.

## Implementation checklist
- [ ] Load clean klines (UTC ms, oldest-first, no gaps, no duplicate `start`) at the 15min–4h horizon per role.
- [ ] Feed the pure core **closed bars only**; fill the resulting order on the **next** bar (no same-bar look-ahead).
- [ ] Apply the full cost model every trade: maker 0.02% / taker 0.055%, Tier-A 5–10 bps / Tier-B 20–50 bps slippage, 8h funding on held positions. Never `slippage = 0`.
- [ ] Enforce the role's universe partition and post-only-vs-taker entry model (Kayıkçı maker, Avcı breakout taker).
- [ ] Walk-forward tune (roll IS→OOS); **log every trial** (candidate × fold) for the DSR trial count.
- [ ] Compute DSR (must imply true Sharpe > 0 after deflation) and PBO/CSCV (want low probability of OOS-below-median).
- [ ] Score the untouched hold-out **once**; if you changed anything after peeking, re-cut it.
- [ ] Evaluate the PASS BAR: ≥300 trades, cost-adjusted PF ≥1.3, +EV, survives ≥2 regimes (≥1 trend + ≥1 range).
- [ ] Run a mainnet micro-pilot ($100–300/role, 2–4 weeks); record realized slippage, funding, maker-fill rate, cooldown firing.
- [ ] Reconcile pilot vs. model; only then scale in stages, re-checking metrics at each step.
- [ ] Wire the −10%-of-role-budget auto-pause and the config rollback path before any scale-up.

## Do / Don't
**Do**
- Prove each role separately, in rollout order (Kayıkçı → Avcı → Safra), against the identical gate.
- Model maker/taker fees, a Tier-appropriate slippage buffer, and funding on every simulated trade.
- Tune with walk-forward; judge with a hold-out you look at exactly once.
- Count and log every trial so DSR/PBO are actually computable.
- Confirm modeled costs against a real (tiny) mainnet pilot before scaling.
- Treat the −10% role-budget drawdown as a mechanical auto-pause.

**Don't**
- Don't tune parameters on the live 2h loop — `optimizer_enabled: 0`; tuning is offline in this protocol.
- Don't report an un-deflated Sharpe from a parameter sweep, or hide the trial count.
- Don't set `slippage = 0`, use the maker rate for taker breakout entries, or omit funding on multi-day carries.
- Don't peek at the hold-out and keep tuning; that converts your final judge into another training set.
- Don't ship a role on <300 trades, PF <1.3 after costs, negative EV, or a single-regime backtest.
- Don't scale straight from backtest to full size, skipping the micro-pilot.

## Common pitfalls
- **Slippage=0 / maker-rate-for-taker.** The most common way a losing edge looks profitable; both understate the #1 cost problem.
- **Trial amnesia.** Sweeping thousands of configs and reporting the best without deflating — DSR exists precisely to punish this.
- **Hold-out leakage.** Any model choice made after seeing the hold-out (even "I'll just retune the stop") burns it.
- **Regime overfit.** A role tuned to the last trending month inverts in a range; require ≥1 trend + ≥1 range regime.
- **Frequency chasing.** Optimizing for more trades/day (the old loop's goal) maximizes fee bleed; validate on cost-adjusted PF/EV, not turnover.
- **Backtest-vs-engine drift.** If decision-replay of `v3_decision_log` doesn't match a fresh signal replay, the engine diverges from the pure core — the gate scored the wrong strategy.
- **Pilot skipped.** Real maker-fill rate and true slippage only show up on mainnet; a backtest cannot certify Kayıkçı's post-only thesis.
- **Survivorship.** Backtesting only currently-listed coins on a scanning universe overstates every metric.

## Code patterns

Full cost model — maker/taker fee + Tier-aware slippage buffer + 8h funding (pure TypeScript):
```ts
const FEE = { maker: 0.0002, taker: 0.00055 }; // confirm via /v5/account/fee-rate

// Tier-A: 5–10 bps, Tier-B: 20–50 bps. NEVER 0.
const SLIP_BPS = { A: [5, 10] as const, B: [20, 50] as const };

/** Effective fill: cross half-spread, add a conservative (upper-bound) tier slippage, pay the right fee. */
export function fill(
  side: "buy" | "sell", mid: number, qty: number, spread: number,
  tier: "A" | "B", liquidity: "maker" | "taker",
) {
  const slipBps = SLIP_BPS[tier][1];                 // use the worst end of the band when in doubt
  const slip = spread / 2 + mid * (slipBps / 10_000);
  const price = side === "buy" ? mid + slip : mid - slip;
  const fee = price * qty * FEE[liquidity];          // Kayıkçı post-only → maker; Avcı breakout → taker
  return { price, fee };
}

/** Funding charged every 8h (00/08/16 UTC); a long pays when the rate is positive. */
export function funding(notional: number, rate: number, side: "long" | "short") {
  return (side === "long" ? -1 : 1) * notional * rate;
}
```

The PASS BAR as an explicit, all-or-nothing predicate:
```ts
export interface RoleResult {
  trades: number;
  grossProfit: number; grossLoss: number;   // AFTER fees + slippage + funding
  avgWin: number; winRate: number; avgLoss: number; lossRate: number;
  regimes: { name: string; trending: boolean; maxDrawdownPct: number }[];
}

export function passesBar(r: RoleResult) {
  const costAdjustedPF = r.grossLoss > 0 ? r.grossProfit / r.grossLoss : Infinity;
  const expectancy = r.avgWin * r.winRate - r.avgLoss * r.lossRate;   // >0 required
  const survived = r.regimes.filter((g) => g.maxDrawdownPct > -0.5);  // no >50% intra-regime blowup
  const hasTrend = survived.some((g) => g.trending);
  const hasRange = survived.some((g) => !g.trending);
  return {
    ok:
      r.trades >= 300 &&
      costAdjustedPF >= 1.3 &&
      expectancy > 0 &&
      survived.length >= 2 && hasTrend && hasRange,
    costAdjustedPF, expectancy,
  };
}
```

Deflated Sharpe Ratio — deflate by the trial count (log every candidate × fold):
```ts
// Normal CDF (Abramowitz–Stegun) and its inverse — no external stats dependency.
const Phi = (z: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
};
const invPhi = (p: number) => {                        // rational approx of the normal quantile
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const q = p - 0.5, r = q * q;
  return (q * (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])) /
             (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
};

/**
 * Probability the TRUE Sharpe > 0 after correcting for N independent trials, skew and kurtosis
 * (López de Prado & Bailey, 2014). sr = observed per-trade Sharpe, n = trade count, trials = # configs scored.
 * Want the result ~>0.95 before trusting the edge.
 */
export function deflatedSharpe(sr: number, n: number, trials: number, skew = 0, kurt = 3) {
  const emc = 0.5772156649;                            // Euler–Mascheroni
  // Expected maximum Sharpe of `trials` draws from an N(0,1) family → the bar chance alone would clear:
  const maxZ = (1 - emc) * invPhi(1 - 1 / trials) + emc * invPhi(1 - 1 / (trials * Math.E));
  const sr0 = maxZ / Math.sqrt(n);
  const denom = Math.sqrt(1 - skew * sr + ((kurt - 1) / 4) * sr * sr);
  return Phi(((sr - sr0) * Math.sqrt(n - 1)) / denom);
}
```

Walk-forward tuning with trial logging, then a one-time hold-out gate:
```ts
import { simulate, type Config, type Bar } from "@repo/strategy-core";

export function validateRole(all: Bar[], space: Config[]) {
  const holdCut = Math.floor(all.length * 0.75);      // reserve final 25% — untouched
  const tunable = all.slice(0, holdCut);
  const holdOut = all.slice(holdCut);                 // looked at EXACTLY once, at the end

  let trials = 0;
  let best: { c: Config; oos: number } | null = null;
  const isLen = Math.floor(tunable.length * 0.6);
  const oosLen = Math.floor(tunable.length * 0.2);
  const step = oosLen;
  for (let s = 0; s + isLen + oosLen <= tunable.length; s += step) {
    for (const c of space) {
      trials++;                                        // <-- feeds deflatedSharpe(); never lose this count
      simulate(tunable.slice(s, s + isLen), c);        // fit on IS
      const oos = simulate(tunable.slice(s + isLen, s + isLen + oosLen), c).sharpe; // judge on OOS
      if (!best || oos > best.oos) best = { c, oos };
    }
  }
  if (!best) return { ok: false as const };

  const finalRun = simulate(holdOut, best.c);          // the ONE hold-out read
  const bar = passesBar(finalRun as unknown as RoleResult);
  const dsr = deflatedSharpe(finalRun.sharpePerTrade, finalRun.trades, trials);
  return { ok: bar.ok && dsr > 0.95, best: best.c, trials, dsr, ...bar };
}
```

Role-budget kill-switch (mechanical −10% auto-pause; enforced in the shell, config via Drizzle):
```ts
/** Halt NEW entries for a role once its realized drawdown breaches 10% of allocated budget. */
export function roleKillSwitch(roleBudgetUsdt: number, roleEquityUsdt: number) {
  const drawdown = roleEquityUsdt / roleBudgetUsdt - 1;    // negative when underwater
  return { pauseNewEntries: drawdown <= -0.1, keepManagingExits: true, drawdown };
}
// On trip: set engine_enabled: 0 for the role's rows (stop opening), leave exit logic running, alert via Telegram.
```

## References
- [Deflated Sharpe ratio — Wikipedia](https://en.wikipedia.org/wiki/Deflated_Sharpe_ratio) — what DSR corrects for and how the trial count deflates an observed Sharpe.
- [The Deflated Sharpe Ratio (Bailey & López de Prado, 2014) — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) — original derivation with the expected-maximum-Sharpe formula used above; selection bias, sample length, non-normality.
- [The Probability of Backtest Overfitting (Bailey, Borwein, López de Prado, Zhu) — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253) — PBO via combinatorially-symmetric cross-validation (CSCV).
- [8.3 The Dangers of Backtesting — Portfolio Optimization Book](https://portfoliooptimizationbook.com/book/8.3-dangers-backtesting.html) — data snooping, multiple testing, why hold-out alone is fragile.
- [Walk-Forward Analysis: Strategy Validation Guide — StratBase](https://stratbase.ai/en/blog/walk-forward-analysis-guide) — rolling IS/OOS windows, walk-forward efficiency, regime robustness.
- [Walk-Forward Optimization — QuantInsti](https://blog.quantinsti.com/walk-forward-optimization-introduction/) — anchored vs. rolling windows, minimum trades per OOS fold, limitations.
- [Profit Factor in Trading — QuantifiedStrategies](https://www.quantifiedstrategies.com/profit-factor/) — gross-profit/gross-loss definition, why sample size matters and PF>4 is suspicious.
- [Purged cross-validation — Wikipedia](https://en.wikipedia.org/wiki/Purged_cross-validation) — purge/embargo to stop leakage across overlapping tuning windows.
- [Bybit Trading Fee Structure — Help Center](https://www.bybit.com/en/help-center/article/Trading-Fee-Structure) — maker 0.02% / taker 0.055% USDⓈ-M perp base rates driving the cost model.
- [Bybit V5 — Get Fee Rate](https://bybit-exchange.github.io/docs/v5/account/fee-rate) — pull live maker/taker fees instead of hard-coding.
- [Bybit V5 — Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — 8h funding stamps to charge held positions in the backtest.
- [Bybit V5 — Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — historical candles (newest-first, 1000-row limit, pagination) for the replay harness.
- [Bybit V5 — Set Trading Stop](https://bybit-exchange.github.io/docs/v5/position/trading-stop) — exchange-side TP/SL whose real trigger behavior the micro-pilot verifies.
- [Execution Quality in Crypto: Measuring Slippage — CoinAPI](https://www.coinapi.io/blog/execution-quality-in-crypto) — estimating slippage in bps from order-book depth to size the Tier-A/B buffers.
- [Bun — Test runner](https://bun.com/docs/test) — running the pure-core validation harness and assertions.
