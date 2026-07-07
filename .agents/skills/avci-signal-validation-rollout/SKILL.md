---
name: avci-signal-validation-rollout
description: The Avcı (Hunter) breakout role's SAFETY SPINE — do NOT deploy Avcı live until it earns it; the Avcı pre-flight strategy-validation-protocol does not own. Gate-0 (BLOCKING): decompose the L1 34%-win baseline into avg_win / avg_loss / expectancy / payoff ratio from v3_position_event / v3_decision_log BEFORE any redesign — 34% is NORMAL positive skew for breakouts, so a healthy payoff ratio means the signal is fine and the tight 0.8% trailing exit clipping winners is likelier. Encodes the v1-vs-staged feature-flag ladder (v1 ships ONLY vol-scaled sizing + closed-bar anti-wick + RVOL/vol-expansion; MTF, relative-strength rank, MACD/RSI, ORB stay flag-OFF until each earns its keep on OOS) and sample-size reality (coin_count 2, 10–15% capital ≈ 5–20 trades/month → significance takes months → paper/micro-pilot). Cross-refs strategy-validation-protocol PASS BAR (≥300 trades, PF≥1.3, +EV) and Deflated Sharpe. Invoke for "should Avcı go live", "decompose the 34% baseline", "payoff ratio", "Gate-0", "kill-switch".
---

# Avcı Signal Validation & Rollout (safety spine)

## When to use this skill
- Anyone proposes shipping the Avcı breakout redesign (confluence, MTF, RS rank, pyramiding) to live capital.
- BEFORE writing a single new filter: run **Gate-0** — decompose the L1 34% baseline's payoff ratio.
- Deciding what ships in v1 versus what stays behind a config flag until it earns its keep out-of-sample.
- Estimating how long Avcı must paper/micro-pilot before its trade count can prove anything.
- Wiring the −10%-of-role-budget kill-switch and the staged capital ladder before Avcı touches size.
- Pushing back on "we stacked 10 filters to raise the win rate" — that is the wrong statistic (see pitfalls).

## Core concepts
- **34% win rate is NORMAL and often optimal for breakout/trend systems.** They profit from POSITIVE SKEW — a few big winners pay for many small losers — not from win rate. Stacking confluence to "raise 34%" truncates the right tail the edge depends on and can leave expectancy negative even as win rate rises. Confluence exists to cut trade **COUNT** (enforce coin_count 2 selectivity, skip chop), never to chase win rate.
- **Gate-0 is BLOCKING and comes FIRST.** The single most important number — the baseline's **expectancy** and **payoff ratio** (avg_win / avg_loss) — was never measured. Until you decompose it you do not know whether L1 lost because of *signal quality*, the *tight 0.8% trailing exit clipping winners*, or *sizing*. If the payoff ratio is already healthy, the L1 signal may be fine and the whole confluence redesign is solving the wrong problem — fix the exit instead (see `atr-adaptive-exits` Avcı profile). You do not need the operator to hand you these numbers; this skill tells you how to compute them from the audit trail.
- **The real levers are payoff ratio and EXIT slippage — not more entry filters.** Realized avg_loss on thin Tier-B coins is materially larger than the 1.5×ATR stop implies because a stop-market during a liquidity sweep blows through the cushion (see `avci-taker-entry-slippage-guard`). Model exit slippage or the whole expectancy is fiction.
- **v1-vs-staged feature-flag ladder.** SHIP FIRST only the well-evidenced primitives: (1) **volatility-scaled position sizing** (`avci-volatility-position-sizing`), (2) **closed-bar (`confirm=true`) anti-wick entry**, (3) **dual volume+volatility confirmation** — RVOL AND squeeze-expansion, ANDed (`avci-volume-volatility-confirmation`). EVERYTHING else — MTF alignment, cross-sectional relative-strength rank, MACD/RSI boosters, ORB sleeve — ships with its config flag **defaulting OFF** and must lift **cost-adjusted expectancy on untouched OOS data** before turning on. One flag at a time; never flip several and credit the bundle.
- **Sample-size reality.** At coin_count 2, heavy filtering, and 10–15% of fleet capital, Avcı fires roughly **5–20 trades/month**. Distinguishing 34% from 45% at significance needs *hundreds* of trades = many months to years. So the near-term oracle is **paper / mainnet micro-pilot**, not a headline backtest Sharpe. The `strategy-validation-protocol` PASS BAR (**≥300 trades**, cost-adjusted **PF ≥ 1.3**, positive EV, no blow-up across **≥2 regimes** incl. ≥1 trend + ≥1 range) may be **unreachable for many months** — that is a reason to stay small, not a reason to lower the bar.
- **Every new knob is manual optimization.** ~18 proposed new keys hand-tuned to fit the narrative constitute data-snooping even with `optimizer_enabled: 0`. Sweep them **offline only**, inside `strategy-validation-protocol`, and deflate the observed Sharpe by the **trial count** (Deflated Sharpe / PBO). Separate in-sample tuning from the one-time hold-out judge.
- **Honest caveats are load-bearing, not decoration.** Cross-sectional momentum is WEAKER net of cost in crypto (Han/Kang/Ryu) — so an RS-rank SELECTOR over a 10–20-coin universe is fragile; 2 top-RS longs in a BTC-up regime are ~1.5× ONE beta-to-BTC bet; a taker IOC slippage cap can adverse-select (rejects the best fast breaks, fills chop). Flag arXiv `2605.04004` and `2503.08692` as **to-verify** (barely-past-cutoff IDs) before any figure from them anchors a decision.

## Codebase specifics
- **Gate-0 data source.** Reconstruct closed Avcı trades from the audit trail: pair open/close rows in **`v3_position_event`** (or read realized PnL from **`v3_pnl_ledger`**), joined to **`v3_decision_log`** for the entry reason/role tag. Bucket per-trade net PnL into wins (>0) and losses (≤0); compute `avg_win`, `avg_loss`, `winRate`, `expectancy`, `payoffRatio` — **after** the real fees + Tier slippage + funding the `backtesting-engine` cost model applies. Win rate alone is a trap.
- **Language/runtime.** Plain TypeScript under Bun; decomposition + gate math are pure functions in `packages/`, unit-tested with `bun test`. The dirty shell only reads MySQL (Drizzle) and Bybit history. No Python.
- **Config in `v3_coin_config`; `*_pct` are percent units** (`1.5` = 1.5%). Existing keys this skill governs: `optimizer_enabled: 0` (stays off — never live-optimize), `coin_count: 2`, `entry_usdt: 15`.
- **NEW governance flags (conservative defaults, offline-swept only, never live-optimized):**
  - `avci_stage: 'v1'` — `'v1' | 'staged'`; gates which filters may run.
  - Per-filter enable flags, all **default 0** until each earns OOS keep: `mtf_enabled: 0`, `rs_rank_enabled: 0`, `rsi_macd_boost_enabled: 0`, `squeeze_booster_enabled: 0`, `orb_enabled: 0`.
  - `avci_kill_drawdown_pct: 10` — auto-pause Avcı at −10% of its role budget.
  - `avci_max_capital_pct` — staged 5 → 10 → 15 as evidence accrues (role = 10–15% of fleet).
- **Pure-core vs shell.** Pure core: `decomposeBaseline`, `expectancy`, `payoffRatio`, `requiredBreakEvenPayoff`, `costAdjustedExpectancy`, `filtersAllowed`, `tradesToDistinguish`, `roleKillSwitch`. Shell: MySQL reads, Bybit funding/fee history, and flipping a `v3_coin_config` flag after (and only after) the OOS lift is signed off.

## Implementation checklist
- [ ] **Gate-0 (BLOCKING):** decompose the L1 34% baseline → `avg_win`, `avg_loss`, `winRate`, `expectancy`, `payoffRatio`, all net of costs. Do this before touching the redesign.
- [ ] Compare `payoffRatio` to `requiredBreakEvenPayoff(winRate)` (≈1.94R at 34%). If already ≥ break-even, STOP: the signal is not the problem — investigate the 0.8% trailing exit / sizing first.
- [ ] Attribute the loss: re-run the SAME trades with the tight trail relaxed (Chandelier) to see if truncated winners, not entries, explain the gap (see `atr-adaptive-exits`).
- [ ] Freeze the v1 set: vol-scaled sizing + closed-bar anti-wick + RVOL/vol-expansion. Set every other filter flag to 0.
- [ ] For each held-back filter, prove a **cost-adjusted-expectancy lift on untouched OOS** before flipping its flag — one filter at a time; log the trial for DSR.
- [ ] Estimate `tradesToDistinguish(pBase, pTarget)`; if it exceeds what Avcı will generate in the pilot window, plan for **paper/micro-pilot**, not a live scale-up.
- [ ] Hand the full go-live decision to `strategy-validation-protocol` (hold-out, DSR/PBO, PASS BAR, micro-pilot). This skill is the Avcı pre-flight; that skill is the gate.
- [ ] Wire `roleKillSwitch` (−10% of role budget → pause new entries, keep managing exits) and the staged 5→10→15% capital ladder before any real size.

## Do / Don't
**Do**
- Decompose the baseline (payoff ratio + expectancy) BEFORE designing anything.
- Treat 34% as normal positive skew; judge redesigns on expectancy, never on win rate.
- Ship only the three evidenced primitives in v1; hold the rest behind OFF flags.
- Make each held-back filter earn its keep on untouched OOS, one at a time.
- Stay on paper/micro-pilot while the trade count is too small to be significant.
- Enforce the −10% kill-switch mechanically.

**Don't**
- Don't build the confluence redesign before you know why L1 actually lost.
- Don't stack filters to "raise the win rate" — that truncates the right tail and can keep EV negative.
- Don't flip several feature flags at once and credit the bundle.
- Don't report an un-deflated Sharpe from a sweep of ~18 new keys; `optimizer_enabled` stays 0.
- Don't scale to full role budget on <300 trades / PF <1.3 after costs / negative EV / one regime.
- Don't anchor a design on arXiv `2605.04004` / `2503.08692` before verifying they exist and generalize.

## Common pitfalls (the critic's weakest-points, encoded)
- **Win-rate obsession destroys the skew.** Raising 34% while a 0.8% trailing callback cuts winners short and losers stay a full 1.5×ATR+slippage keeps expectancy negative. Optimizing the wrong statistic is the central failure mode.
- **Baseline never decomposed.** Redesigning "entry filtering" without knowing avg_win/avg_loss risks fixing a signal that was fine and ignoring the exit that was not. Gate-0 exists to kill this.
- **Under-costed hours-held trades.** "Round-trip 0.11% taker" ignores 8h funding on hours-held positions, taker on every pyramid layer, and exit slippage — all-in is plausibly **0.2–0.4%+**, which flips marginal setups to negative EV. Decompose net of the honest cost, not 0.11%.
- **Exit slippage on thin Tier-B stop-outs is the real blow-up path**, not entry slippage on $45 notional; realized avg_loss > 1.5×ATR. If avg_loss is measured against the *intended* stop it understates the loss tail.
- **Sample-size self-deception.** 5–20 trades/month means 34%→45% takes many months to reach significance; a pretty 30-trade backtest curve is noise. DSR/PBO the sweep; pilot small.
- **Manual overfitting under `optimizer_enabled: 0`.** ~18 hand-tuned thresholds (ADX 25/30, ROC 5, RVOL 3, CHOP 61.8, session 13–21 UTC) are still data-snooping. Separate tuning from the hold-out; deflate by trial count.
- **Correlated concurrent bets.** coin_count 2 forced into top-quintile RS in a BTC-up regime are ~1.5× ONE bet; in a momentum crash both gap through stops together — a hidden tail the trade log won't show until it happens (see `fleet-coordination` Avcı profile).
- **Cross-sectional RS is weaker net of cost (Han/Kang/Ryu),** and "strongest" = most-extended = highest reversal risk over a 10–20-coin universe where the quintile boundary is 2–4 noisy names — reason to keep RS behind a flag.
- **Suspicious citations.** The `2605.04004` "80.7% stop-out" and "60–70% of breakouts fail" figures are imported from other markets; verify before they justify a threshold.

## Code patterns
Gate-0 — decompose the baseline into the numbers that actually matter (pure TypeScript):

```ts
export interface ClosedTrade { netPnl: number; role: string; } // netPnl AFTER fees+slippage+funding

export interface Decomposition {
  n: number; wins: number; winRate: number;
  avgWin: number; avgLoss: number;         // avgLoss reported as a POSITIVE magnitude
  payoffRatio: number;                     // avgWin / avgLoss — the lever, not win rate
  expectancy: number;                      // per-trade EV in the same units as netPnl
}

/** Reconstruct from paired v3_position_event rows (or v3_pnl_ledger). netPnl must be cost-inclusive. */
export function decomposeBaseline(trades: ClosedTrade[]): Decomposition {
  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl <= 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.netPnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + t.netPnl, 0) / losses.length) : 0;
  const winRate = trades.length ? wins.length / trades.length : 0;
  return {
    n: trades.length, wins: wins.length, winRate, avgWin, avgLoss,
    payoffRatio: avgLoss ? avgWin / avgLoss : Infinity,
    expectancy: winRate * avgWin - (1 - winRate) * avgLoss,
  };
}

/** Break-even payoff a given win rate REQUIRES: at 34% ⇒ 0.66/0.34 ≈ 1.94R. */
export const requiredBreakEvenPayoff = (winRate: number) => (1 - winRate) / winRate;

/** Is the L1 signal actually the problem, or is it the exit? */
export function gate0Verdict(d: Decomposition) {
  const breakeven = requiredBreakEvenPayoff(d.winRate);
  return {
    signalLikelyFine: d.payoffRatio >= breakeven, // if true → fix the 0.8% trail, not the signal
    breakevenPayoff: breakeven,
    marginR: d.payoffRatio - breakeven,
  };
}
```

Feature-flag ladder + cost-adjusted expectancy gate for turning a held-back filter ON:

```ts
export type FilterKey = "mtf" | "rs_rank" | "rsi_macd" | "squeeze_booster" | "orb";

/** In v1, only the three evidenced primitives run; everything else must be flag-ON AND OOS-proven. */
export function filtersAllowed(stage: "v1" | "staged", flags: Record<FilterKey, boolean>) {
  const v1Core = ["volScaledSizing", "closedBarAntiWick", "rvolVolExpansion"] as const;
  if (stage === "v1") return { core: v1Core, extra: [] as FilterKey[] };
  const extra = (Object.keys(flags) as FilterKey[]).filter(k => flags[k]);
  return { core: v1Core, extra };
}

/** A filter earns its flag ONLY if it lifts cost-adjusted expectancy on the untouched OOS slice. */
export function filterEarnsKeep(baseOosExpectancy: number, withFilterOosExpectancy: number, minLiftR = 0) {
  return withFilterOosExpectancy - baseOosExpectancy > minLiftR; // one filter at a time; log the trial for DSR
}
```

Sample-size reality — trades needed to tell two win rates apart (two-proportion, ~95%/80% power):

```ts
/** Rough n PER ARM to distinguish pBase from pTarget. At 0.34 vs 0.45 this is a few hundred → months at 5–20/mo. */
export function tradesToDistinguish(pBase: number, pTarget: number, zA = 1.96, zB = 0.84) {
  const pBar = (pBase + pTarget) / 2;
  const num = zA * Math.sqrt(2 * pBar * (1 - pBar)) + zB * Math.sqrt(pBase * (1 - pBase) + pTarget * (1 - pTarget));
  return Math.ceil((num * num) / ((pTarget - pBase) ** 2));
}

/** Months of paper/pilot before the count is even reachable. */
export const monthsToSignificance = (nNeeded: number, tradesPerMonth = 12) => nNeeded / tradesPerMonth;
```

Mechanical −10% role-budget kill-switch (shared shape with `strategy-validation-protocol`):

```ts
export function roleKillSwitch(roleBudgetUsdt: number, roleEquityUsdt: number, killPct = 10) {
  const drawdown = roleEquityUsdt / roleBudgetUsdt - 1;              // negative underwater
  return { pauseNewEntries: drawdown <= -killPct / 100, keepManagingExits: true, drawdown };
}
```

`bun:test` — Gate-0 catches a healthy-payoff baseline the redesign would have wrongly "fixed":

```ts
import { test, expect } from "bun:test";
import { decomposeBaseline, gate0Verdict, tradesToDistinguish } from "@repo/avci-validation";

test("34% win with 2.3R payoff is +EV — the signal is fine, don't stack filters", () => {
  // 34 winners of +2.3R, 66 losers of −1R (cost-inclusive)
  const trades = [
    ...Array(34).fill({ netPnl: 2.3, role: "avci" }),
    ...Array(66).fill({ netPnl: -1.0, role: "avci" }),
  ];
  const d = decomposeBaseline(trades);
  expect(d.winRate).toBeCloseTo(0.34, 2);
  expect(d.expectancy).toBeGreaterThan(0);                 // positive skew works at 34%
  expect(gate0Verdict(d).signalLikelyFine).toBe(true);     // ⇒ fix the exit, not the entry
});

test("distinguishing 34% from 45% needs hundreds of trades", () => {
  expect(tradesToDistinguish(0.34, 0.45)).toBeGreaterThan(200); // months at 5–20 trades/month
});
```

## References
- [Win Rate and Risk/Reward: Connection Explained — LuxAlgo](https://www.luxalgo.com/blog/win-rate-and-riskreward-connection-explained/) — why 34% + high payoff is +EV; the break-even payoff a win rate requires.
- [Making Fat Right Tails Fatter With Trend Following — The Hedge Fund Journal](https://thehedgefundjournal.com/making-fat-right-tails-fatter-with-trend-following/) — positive skew is the edge; truncating winners kills it (the trailing-exit risk).
- [Momentum Crashes — Daniel & Moskowitz (NBER w20439, PDF)](https://www.nber.org/system/files/working_papers/w20439/w20439.pdf) — why raising hit-rate the wrong way and pyramiding into strength concentrate crash risk.
- [Momentum Has Its Moments — Barroso & Santa-Clara (SSRN 2041429)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2041429) — vol-scaled sizing, the one v1 primitive that ships regardless of the rest.
- [Time-Series and Cross-Sectional Momentum in Crypto under Realistic Assumptions — Han/Kang/Ryu (SSRN)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4675565) — cross-sectional momentum is WEAKER net of cost → keep RS-rank behind a flag.
- [Cryptocurrency momentum has (not) its moments — Springer FMPM (2025)](https://link.springer.com/article/10.1007/s11408-025-00474-9) — momentum's skew/moment behaviour in crypto; corroborates the net-of-cost caveat.
- [The Deflated Sharpe Ratio — Bailey & López de Prado (SSRN 2460551)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) — deflate the swept Sharpe by trial count before believing the ~18-key redesign.
- [Deflated Sharpe ratio — Wikipedia](https://en.wikipedia.org/wiki/Deflated_Sharpe_ratio) — quick reference for selection-bias / non-normality correction.
- [The Sharpe Ratio Efficient Frontier (Probabilistic Sharpe Ratio) — Bailey & López de Prado (SSRN 1821643)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1821643) — PSR and Minimum Track Record Length: how long a track record must be to trust a Sharpe.
- [Probabilistic Sharpe Ratio — QuantConnect Research](https://www.quantconnect.com/research/17112/probabilistic-sharpe-ratio/) — worked PSR at the small sample sizes Avcı will actually produce.
- [Walk-forward optimization — Wikipedia](https://en.wikipedia.org/wiki/Walk_forward_optimization) — rolling IS→OOS tuning that each held-back filter must clear.
- [Purged cross-validation — Wikipedia](https://en.wikipedia.org/wiki/Purged_cross-validation) — purge/embargo so overlapping windows don't leak into the OOS judge.
- [Bybit Perpetual Futures Contract Fees Explained — Help Center](https://www.bybit.com/en/help-center/article/Perpetual-Futures-Contract-Fees-Explained) — taker 0.055% / maker 0.02%; the cost the decomposition must net out.
- [Bybit V5 — Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — 8h funding to include in cost-inclusive per-trade PnL for Gate-0.
- [Structural Limits of OHLCV-Based Intraday Signals: A Falsification Study (arXiv 2605.04004)](https://arxiv.org/pdf/2605.04004) — TO-VERIFY (barely-past-cutoff ID); do not anchor the "80.7% stop-out" figure until confirmed.

## Related skills
- `avci-volatility-position-sizing`, `avci-volume-volatility-confirmation` — the two v1 primitives (with closed-bar anti-wick) this spine ships first.
- `avci-breakout-confluence` — the signal engine whose held-back boosters (MTF, RS, RSI/MACD) stay flag-OFF until they earn OOS keep here.
- `avci-taker-entry-slippage-guard` — the exit-slippage reality that makes realized avg_loss > 1.5×ATR; feeds Gate-0's cost-inclusive PnL.
- `atr-adaptive-exits` (Avcı profile) — where to look first if Gate-0 shows the payoff ratio is fine (the 0.8% trailing exit clipping winners).
- `avci-regime-timing-standdown`, `fleet-coordination` — the correlation/standdown controls behind the "2 slots ≈ 1 bet" caveat.
- `backtesting-engine` — the cost model producing cost-inclusive per-trade PnL and the avg_win/avg_loss/payoff outputs.
- `strategy-validation-protocol` — the role-agnostic gate (PASS BAR, DSR/PBO, hold-out, micro-pilot) this skill feeds.
