---
name: avci-volatility-position-sizing
description: SHIP-FIRST, best-evidenced Avci (Hunter) addition: volatility-scaled position sizing for the SkyPower V3 Bybit breakout role, pure TypeScript in packages/ tested with bun test. Replaces static entry_usdt with dollar-risk-constant sizing positionSize=(riskFraction*roleBudget)/(stopAtrMult*atrPct) so a 1.5xATR stop always risks a fixed 0.5-1% of the Avci budget — smaller notional on high-ATR coins, larger when calm (Barroso-Santa-Clara 12% vol target / Daniel-Moskowitz: ~doubles Sharpe, kills momentum crashes). Adds a single-symbol <=30% cap, a correlation/beta-to-BTC cap across the 2 concurrent Avci slots (correlated BTC/ETH/L1 = one basket), and the decreasing profit pyramid (multiplier 0.7, max 3, add on +profit ONLY while ROC stays positive AND vol is NOT expanding); loss_layer stays 0. Use for Avci sizing, vol-scaled/volatility-target sizing, ATR-normalized entry_usdt, risk per trade, profit pyramiding, correlation/beta cap, single-symbol cap. See risk-management, avci-taker-entry-slippage-guard.
---

# Avci Volatility-Scaled Position Sizing (Bybit Perpetuals, TypeScript)

## When to use this skill
- Replacing Avci's static `entry_usdt` (fixed notional) with **dollar-risk-constant, ATR-normalized** sizing.
- Making a **1.5xATR stop always risk a fixed 0.5-1%** of the Avci role budget regardless of the coin's ATR%.
- Adding the **single-symbol <=30% of role budget** concentration cap (applied AFTER pyramiding).
- Adding the **correlation / beta-to-BTC cap** across Avci's 2 concurrent slots (BTC/ETH/L1 = one basket).
- Building the **decreasing profit pyramid** (mult 0.7, max 3, add on +profit only) with the anti-crash add-gate.
- Reasoning about why **volatility targeting** roughly doubles Sharpe and kills momentum crashes — and its honest caveats.

## Core concepts

**This is the one Avci piece that ships first, regardless of the rest.** Across many independent studies and markets, **volatility-scaled sizing is the single most defensible momentum improvement**: Barroso & Santa-Clara ("Momentum Has Its Moments") target a constant ~12% annualized volatility and roughly **double the Sharpe ratio while virtually eliminating the crash left tail**; Daniel & Moskowitz ("Momentum Crashes") show dynamic scaling that cuts size as volatility rises is what tames the optionality that blows momentum up. It requires **no signal edge** to work — it only reshapes the return distribution — so it ships on the v1 ladder ahead of every entry filter (see avci-signal-validation-rollout).

**Dollar-risk-constant sizing (the core formula).** The stop is a multiple of ATR, not a fixed percent, so notional must scale inversely with volatility. Express everything as fractions of price:

```
dollarRisk    = riskFraction * roleBudget           // e.g. 0.0075 * roleBudget  (0.5-1% of the Avci budget)
stopDistFrac  = stopAtrMult * atrPct                 // atrPct as a FRACTION (0.02-0.08); stopAtrMult = 1.5
notionalUsd   = dollarRisk / stopDistFrac            // = (riskFraction*roleBudget) / (stopAtrMult*atrPct)
qty           = notionalUsd / entryPrice             // round to qtyStep in the shell
```

`positionSize(riskFraction, roleBudget, atrPct, stopAtrMult) = (riskFraction*roleBudget)/(stopAtrMult*atrPct)`. A 1.5xATR stop-out then costs **exactly `riskFraction*roleBudget`** whether the coin has 2% or 8% ATR: the high-ATR thin coin gets a **smaller** notional, the calm coin a **larger** one, and the dollar loss at the stop is constant. This is Van Tharp's percent-volatility model / the Turtle N-unit method, and it is what `entry_usdt` (a fixed notional) fails to do — a flat $15 over-risks the 8% coin by ~4x versus the 2% coin.

**`entry_usdt` becomes a BASE, not the size.** Resolve the config contradiction the critic flags (fixed `entry_usdt 15 * leverage 3` vs dynamic vol-scaling): keep `entry_usdt` as a **nominal base** used only for bootstrap / minimum-order fallback, and let `positionSize()` compute the live notional from `risk_per_trade_pct`, `roleBudget`, ATR%, and `stop_loss_pct` (the 1.5 ATR multiple). Only ONE sizing path ships — the vol-scaled one.

**Single-symbol concentration cap (<=30%).** Layered on top of vol-scaling: the **fully pyramided** position on any one symbol may not exceed **30% of the Avci role budget**. Apply the cap AFTER computing base + all planned pyramid layers, not just to the base — otherwise a "small" base plus adds can quietly become the whole book.

**Correlation / beta-to-BTC cap across the 2 slots.** `coin_count 2` forced into top-quintile relative strength in a BTC-up regime are **~1.5x ONE beta-to-BTC bet, not two independent bets** — in a momentum crash / V-recovery both gap through their stops together. Treat correlated names (BTC, ETH, and high-beta L1s that co-move) as **one basket**: cap the summed beta-weighted exposure of the basket, so the second slot is *reduced or refused* when it is really more of the same bet. This is a portfolio cap on top of the per-trade risk fraction — it does not appear if you only size trades one at a time.

**Decreasing profit pyramid (anti-martingale, Avci-only).** Adds are strictly **profit-only and decreasing**: base + two adds at `profit_layer_multiplier 0.7` form a **convergent geometric series** (`Q + 0.7Q + 0.49Q ~= 2.19Q`), so the weighted-average entry never chases price the way an *increasing* (inverted-pyramid) multiplier would. Each add fires only when price has advanced `profit_add_step_pct` (1.0%) beyond the last fill **AND** the gate below passes, and the aggregate stop **ratchets up** each add so total open risk never exceeds the original budget (Turtle staircase). `loss_layer_enabled` stays **0** — no DCA-on-loss, ever (proven 1/13, -$43.69; see risk-management).

**The add-gate that stops you pyramiding into a crash.** Pyramiding into strength IS the momentum-crash failure mode — it concentrates size near local tops right before the mean-reversion. So an add is permitted **only while ROC stays positive AND volatility is NOT expanding further** (ATR not making a fresh local high / not accelerating). Adding into a vol spike is exactly where crashes concentrate; the gate refuses it.

**Honest vol-scaling caveats (required).** Volatility targeting is robust but not free:
- It is **estimated with a lag** — realized-vol windows react *after* the regime turns, so a fast crash can hit before the estimate rises and shrinks you.
- Low realized vol can make it **lever UP right before a volatility explosion** (calm-before-the-storm); cap leverage (`leverage 3`) and keep the single-symbol and basket caps as hard backstops the vol estimate can't override.
- After a crash it **shrinks size while vol is still elevated**, so it can keep you small through the sharpest recovery entries — a real opportunity cost, not a bug.
- It reshapes the distribution; it does **not** create edge. If the signal has no expectancy, vol-scaling only makes the losing smoother (see avci-signal-validation-rollout gate zero).

## Codebase specifics

**Pure core / dirty shell.** All sizing math is **pure functions in `packages/`** (e.g. `packages/avci-sizing`): `positionSize`, the single-symbol cap, the basket/beta cap, `pyramidLayers`, and the add-gate predicate. No `fetch`, no Drizzle, no clock. The engine (dirty shell) fetches equity/role budget, ATR% (from the same ATR(14) the exits use), the live orderbook, and BTC-beta inputs, then **calls** these functions. Unit-test all with `bun test`.

**`v3_coin_config` keys.**
- Existing: `entry_usdt=15` (now a **base**, scaled by ATR%), `leverage=3`, `stop_loss_pct=1.5` (an **ATR multiple**, not a raw percent), `profit_layer_enabled=1`, `profit_max_layers=3`, `profit_layer_multiplier=0.7`, `profit_add_step_pct=1.0`, `loss_layer_enabled=0`.
- NEW (conservative defaults, swept **offline only** inside the validation protocol; `optimizer_enabled` stays 0, never live-optimized): `risk_per_trade_pct=0.5-1.0`, `vol_target_pct=12` (annualized analog for a portfolio-level scaler), `single_symbol_cap_pct=30`, `correlation_cap` (max beta-weighted basket exposure), `beta_lookback_bars`, `pyramid_add_requires_roc_positive=1`, `pyramid_add_block_on_vol_expansion=1`.
- **Units discipline:** `*_pct` config columns are **percent**; convert to fractions (`/100`) at the shell boundary before calling the pure core, which works in fractions. `profit_add_step_pct` / layer-trigger semantics (price-% vs margin-%) are UNVERIFIED — read the engine before trusting them (see OPEN QUESTIONS in avci-signal-validation-rollout).

**Role budget.** Avci = **10-15% of fleet capital**; `roleBudget` is that slice, and `risk_per_trade_pct` is a fraction of it. The single-symbol and basket caps are fractions of `roleBudget`, not of total fleet equity. Consult fleet-coordination for the fleet-total gross/net cap before allowing the entry.

**Audit.** Log the sizing decision (ATR%, computed notional, which cap bound, add-gate result, `reason`) to `v3_decision_log`; the fill to `v3_position_event`. Machine-readable reasons: `size:vol_scaled`, `cap:single_symbol_30`, `cap:btc_basket`, `pyramid:added`, `pyramid:blocked_vol_expansion`, `pyramid:blocked_roc`.

## Implementation checklist
- [ ] Pure `positionSize(riskFraction, roleBudget, atrPctFrac, stopAtrMult)` returning notional USDT; reject `atrPctFrac<=0`.
- [ ] Pure `capSingleSymbol(stackedNotional, roleBudget, capPct=0.30)` applied to base + ALL planned layers.
- [ ] Pure `admitByBasketCap(openSlots, cand, roleBudget, capBeta)` that reduces/refuses the 2nd slot when the BTC basket is full.
- [ ] Pure `pyramidLayers(baseQty, mult=0.7, maxLayers=3)` → convergent geometric series.
- [ ] Pure `shouldAddLayer({advancedStepPct, rocNow, atrExpanding, lossLayerEnabled})` → profit-only AND ROC>0 AND !atrExpanding.
- [ ] Feed the **modeled exit-slippage** (per Tier, from avci-taker-entry-slippage-guard) into the effective stop distance so sizing budgets for the real loss, not the nominal 1.5xATR.
- [ ] Shell: convert `*_pct` config → fractions; fetch ATR%, equity, roleBudget, BTC-beta; call the pure core; round qty to `qtyStep`; reject sub-`minOrderQty`.
- [ ] Shell: ratchet the aggregate stop up on every add so total open risk never exceeds the initial budget.
- [ ] `bun test`: dollar-risk equal across ATR% 2 vs 8, 30% cap binds on stacked size, basket cap refuses correlated 2nd slot, add-gate blocks on vol expansion, geometric series sums to ~2.19x.

## Do / Don't
**Do**
- Size so a 1.5xATR stop costs a **constant** `risk_per_trade_pct` of the role budget across the whole ATR% 2-8 range.
- Treat `entry_usdt` as a base only; let `positionSize()` compute the live notional. Ship ONE sizing path.
- Apply the 30% single-symbol cap to the **fully pyramided** size, and the basket/beta cap **across both slots**.
- Add only into a live winner while **ROC>0 and vol is not expanding**; ratchet the stop up on every add.
- Keep `loss_layer_enabled=0`; keep leverage capped; keep the caps as hard backstops the vol estimate can't override.
- State the vol-scaling caveats honestly (lag, lever-up-before-crash, shrink-through-recovery, no edge created).

**Don't**
- Don't ship a fixed `entry_usdt * leverage` notional alongside vol-scaling — pick the vol-scaled path.
- Don't treat two top-RS longs in a BTC-up regime as two bets — cap the correlated basket as ~1.5x one bet.
- Don't pyramid on a loss, on flat/negative ROC, or into an expanding-vol spike (that is the crash entry).
- Don't apply the 30% cap only to the base and let adds blow past it.
- Don't let the vol estimate lever you up in unnatural calm — the leverage/cap backstops exist for exactly that.
- Don't claim vol-scaling fixes a broken signal; it reshapes the distribution, it doesn't create expectancy.

## Common pitfalls (critic's weakest-points, encoded)
- **Correlated concurrent positions.** `coin_count 2` in top-quintile RS during a BTC uptrend is **~1.5x ONE beta bet**; both gap through stops together in a crash. Without the basket/beta cap the "two-slot diversification" is an illusion.
- **Pyramiding into the crash.** Adding on +1% (mult 0.7, max 3) maximizes exposure near local tops right before mean-reversion. Profit-only avoids martingale but still concentrates size where crashes cluster — the ROC>0 AND !vol-expanding gate is the mitigation, not the pyramid itself.
- **Exit slippage > nominal stop.** On a thin Tier-B coin a stop-market during a sweep blows through the 1.5xATR cushion, so the realized average loss exceeds `risk_per_trade_pct`. Size against the **modeled** stop distance (nominal + Tier exit-slippage bps), or your "0.75% risk" is really 1%+.
- **Fixed-notional relic.** Leaving `entry_usdt` as the real size silently over-risks high-ATR coins by multiples — the exact failure vol-scaling exists to remove.
- **Vol-estimate lag.** Realized-vol windows update after the turn; a fast crash arrives before the scaler shrinks you. The caps, not the scaler, are the fast backstop.
- **Cap-on-base-only.** Applying the 30% cap before pyramiding lets the stacked position exceed 30% of the budget.
- **Win-rate temptation.** Do NOT shrink size to "raise win rate" — 34% is normal positive skew; sizing controls dollar risk and crash exposure, not hit rate (see avci-signal-validation-rollout).

## Code patterns

Pure vol-scaled sizing + caps + pyramid (`packages/avci-sizing`):
```ts
// All fractions (atrPctFrac 0.03 = 3% ATR; riskFraction 0.0075 = 0.75% of role budget).
export function positionSize(
  riskFraction: number, roleBudget: number, atrPctFrac: number, stopAtrMult = 1.5,
): number {
  const stopDistFrac = stopAtrMult * atrPctFrac;           // stop distance as a fraction of price
  if (stopDistFrac <= 0) throw new Error("atrPct/stop distance must be > 0");
  return (riskFraction * roleBudget) / stopDistFrac;        // notional USDT; dollar-risk constant
}

// Budget for the REAL loss: add modeled Tier exit-slippage to the stop distance before sizing.
export function effectiveStopFrac(stopAtrMult: number, atrPctFrac: number, exitSlipFrac: number): number {
  return stopAtrMult * atrPctFrac + exitSlipFrac;          // feed into positionSize via a wider stop
}

// Single-symbol concentration cap — applied to the FULLY PYRAMIDED notional.
export function capSingleSymbol(stackedNotional: number, roleBudget: number, capPct = 0.30): number {
  return Math.min(stackedNotional, capPct * roleBudget);
}

// Convergent (anti-martingale) profit pyramid: [Q, 0.7Q, 0.49Q] ~= 2.19Q for max 3 layers.
export function pyramidLayers(baseQty: number, mult = 0.7, maxLayers = 3): number[] {
  return Array.from({ length: maxLayers }, (_, i) => baseQty * mult ** i);
}

// Add ONLY on a live winner while ROC stays positive AND volatility is not expanding further.
export function shouldAddLayer(p: {
  advancedStepPct: number; addStepPct: number;             // price advance since last fill vs profit_add_step_pct
  rocNow: number; atrExpanding: boolean; lossLayerEnabled: 0 | 1;
}): boolean {
  if (p.lossLayerEnabled !== 0) return false;              // martingale is banned outright
  return p.advancedStepPct >= p.addStepPct && p.rocNow > 0 && !p.atrExpanding;
}
```

Pure BTC-basket / beta cap across the two concurrent slots:
```ts
export type Slot = { symbol: string; notional: number; betaToBtc: number; basket: string };

// Refuse/reduce a candidate whose basket beta-weighted exposure would exceed capBeta*roleBudget.
export function admitByBasketCap(
  open: Slot[], cand: Slot, roleBudget: number, capBeta = 1.5,
): { notional: number; reason: string } {
  const used = open.filter(s => s.basket === cand.basket)
                   .reduce((a, s) => a + s.betaToBtc * s.notional, 0);
  const room = capBeta * roleBudget - used;                // remaining beta-weighted room in the basket
  if (room <= 0) return { notional: 0, reason: "cap:btc_basket" };
  return { notional: Math.min(cand.notional, room / Math.max(cand.betaToBtc, 1e-9)), reason: "size:vol_scaled" };
}
```

`bun:test` — dollar risk constant, caps bind, add-gate blocks a vol spike:
```ts
import { test, expect } from "bun:test";

test("dollar risk is constant across the ATR% band", () => {
  const budget = 10_000, risk = 0.0075;
  const calm = positionSize(risk, budget, 0.02) * (1.5 * 0.02);   // loss at stop
  const wild = positionSize(risk, budget, 0.08) * (1.5 * 0.08);
  expect(calm).toBeCloseTo(risk * budget);
  expect(wild).toBeCloseTo(risk * budget);                        // same $ risk, ~4x smaller notional on the wild coin
});

test("single-symbol cap binds on the fully pyramided size", () => {
  const budget = 10_000;
  const stacked = pyramidLayers(6_000).reduce((a, b) => a + b, 0); // ~13,140 > 3,000
  expect(capSingleSymbol(stacked, budget)).toBe(3_000);           // 30% of role budget
});

test("no add into an expanding-vol spike", () => {
  const base = { advancedStepPct: 1.2, addStepPct: 1.0, lossLayerEnabled: 0 as const };
  expect(shouldAddLayer({ ...base, rocNow: 4, atrExpanding: false })).toBe(true);
  expect(shouldAddLayer({ ...base, rocNow: 4, atrExpanding: true })).toBe(false);  // vol expanding → block
  expect(shouldAddLayer({ ...base, rocNow: -1, atrExpanding: false })).toBe(false); // ROC not positive → block
});
```

## References
- [Momentum Has Its Moments — Barroso & Santa-Clara (SSRN 2041429)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2041429) — constant ~12% vol target roughly doubles Sharpe and removes the crash left tail. The core evidence for shipping this first.
- [Momentum Crashes — Daniel & Moskowitz (NBER w20439, full PDF)](https://www.nber.org/system/files/working_papers/w20439/w20439.pdf) — dynamic scaling that cuts size as volatility rises tames the momentum-crash optionality.
- [Avoiding Momentum Crashes — Alpha Architect](https://alphaarchitect.com/avoiding-momentum-crashes/) — practitioner summary of dynamic / vol-scaled momentum vs static.
- [The Impact of Volatility Targeting — Man Group](https://www.man.com/insights/the-impact-of-volatility-targeting) — vol targeting improves Sharpe and cuts drawdowns; the honest lag/estimation caveats.
- [5 Position Sizing Methods for High-Volatility Trades — LuxAlgo](https://www.luxalgo.com/blog/5-position-sizing-methods-for-high-volatility-trades/) — percent-volatility / ATR-normalized sizing for volatile instruments.
- [Position Sizing in a Turtle Trading System — QuantifiedStrategies](https://www.quantifiedstrategies.com/position-sizing-in-a-turtle-trading-system/) — Turtle N-unit sizing and the pyramiding staircase behind the decreasing pyramid.
- [The Mathematics of Pyramiding — QuantStrategy.io](https://quantstrategy.io/blog/the-mathematics-of-pyramiding-calculating-position-sizes/) — convergent vs inverted pyramids; why a decreasing multiplier keeps the weighted entry sane.
- [Pyramiding Strategies: How to Safely Add to Winning Trades — QuantStrategy.io](https://quantstrategy.io/blog/pyramiding-strategies-how-to-safely-add-to-winning-trades/) — profit-only adds, stop-ratchet, constant aggregate risk.
- [Martingale and Anti-Martingale Position Size Strategies — FXOpen](https://fxopen.com/blog/en/martingale-and-anti-martingale-strategies-in-trading/) — why loss-layering (martingale) is banned and profit-layering (anti-martingale) is the safe form.
- [ATR-Based Stop Loss and Sizing — AlphaEx Capital](https://www.alphaexcapital.com/prop-trading/risk-money-management-and-psychology-in-prop-trading/prop-risk-management-framework/atr-based-stop-loss-and-sizing) — dollar-risk-constant sizing `qty = risk$/(k*ATR)` across volatility.
- [Momentum and Liquidity in Cryptocurrencies (arXiv 1904.00890)](https://arxiv.org/pdf/1904.00890) — crypto momentum is real but liquidity/cost-sensitive; supports capping thin-coin size and the correlation caveat.
- [Bun — Test runner (`bun:test`)](https://bun.com/docs/test) — Jest-style `test`/`expect` for the pure sizing unit tests.
