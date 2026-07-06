---
name: market-neutral-funding
description: Build the SkyPower V3 Faz 3 Safra (Ballast) role — a delta-neutral funding-carry engine on Bybit (spot long + USDⓈ-M perp short) in TypeScript/Bun. Covers the NEW spot-leg capability (the perp-only engine adds category "spot"), two-leg SIMULTANEOUS order execution (place both legs, verify both filled, unwind on a partial), funding-threshold entry/exit (enter when the cost-adjusted funding APR clears a hurdle, exit when funding decays/reverses), weekly delta rebalancing as spot vs perp quantities drift, and realistic economics (net APY ~5–15% in 2026 after fees/slippage; ≥20bps opportunities only ~40% profitable after cost) plus the risks (funding reversal, leg slippage, exchange risk). Pure funding/delta functions + a dirty-shell two-leg placer. Use for Safra, delta-neutral, market-neutral, funding carry/arbitrage, basis / cash-and-carry, spot long + perp short, funding threshold, funding history, delta rebalance, two-leg execution, or adding spot support to the engine.
---

# Market-Neutral Funding Carry (Safra / Ballast)

## When to use this skill
- Implementing the **Safra** role: earn the perpetual funding payment while holding no net price exposure.
- Adding **spot-leg** support to a perp-only engine (Bybit `category: "spot"` order path).
- Executing the **two legs simultaneously** (spot long + perp short) and handling a partial fill.
- Deciding **entry/exit** from a funding threshold and its cost-adjusted, annualized value.
- **Rebalancing delta** as the spot and perp legs drift apart.
- Reasoning about the **real net APY** and the **risks** (funding reversal, leg slippage, exchange risk).

## Core concepts

**Delta-neutral funding carry.** Hold **+1 unit spot** and **−1 unit perp** of the same coin. The two price exposures cancel (net delta ≈ 0), so P&L does not depend on the coin's direction — you collect the perpetual's **funding payment** while the position is open. When funding is **positive** (perp trades above spot; longs pay shorts), the **short-perp** side *receives* funding — this is the normal carry. When funding is negative, the trade inverts (short spot + long perp), which on Bybit USDⓈ-M usually isn't available cleanly, so Safra targets **positive-funding** coins only.

**Funding annualization.** Bybit pays funding on an interval (commonly every **8h**, but some symbols settle at **1h/2h/4h** — read `fundingInterval` from instruments-info, never assume 8h). Annualized rate: `APR = fundingRate × (settlementsPerDay) × 365 = fundingRate × (24 / intervalHours) × 365`. Example: `0.01%` per 8h → `0.0001 × 3 × 365 ≈ 10.95%` APR; `0.03%`/8h → `≈ 32.9%`. This is the gross carry before costs.

**Cost-adjusted entry.** The carry must beat round-trip cost. You pay: **spot** taker/maker + **perp** taker/maker on the way IN and again on the way OUT (four fills), plus **bid/ask slippage** on two legs. On Bybit fees are ~taker 0.055% / maker 0.02%; four taker fills ≈ 0.22% of notional, and manual multi-leg basis execution commonly loses **17–54 bps** to slippage. So the *effective hurdle* is roughly the amortized entry+exit cost over the expected holding period. **Realistic 2026 economics:** net APY typically **~5–15%** after costs (funding markets cooled from late-2024 highs), and short-horizon opportunities of **≥20bps** clear a profit only ~**40%** of the time after fees — so enter only when the annualized, cost-adjusted funding is comfortably positive, not marginally.

**Two-leg simultaneous execution.** The legs must go on **together** — if you buy spot but the perp short lags, you're briefly directional and a wick can wipe the edge. Approaches: (1) size to a fraction of ±1% book depth on **both** venues so each leg fills fast; (2) place both near-simultaneously (batch or back-to-back), then **verify both filled** via reconcile; (3) if only one leg fills (partial), **immediately unwind** the filled leg rather than sit naked. Never leave one leg hanging across a loop tick.

**Funding-threshold exit.** Exit when the reason to hold is gone: funding **decays below the hold hurdle**, **reverses sign** (now you'd be paying), the **basis compresses**, or a better coin frees capital. Exit unwinds **both legs** simultaneously (sell spot + buy-to-close perp). Because each round trip costs ~0.2%+, don't churn on noise — require a persistent funding drop, not a single soft print.

**Delta rebalancing (weekly).** Even a perfectly hedged open drifts: the perp accrues/pays funding and PnL in USDT while the spot holding's coin quantity is fixed, and prices move, so notional on the two legs diverges. Periodically (e.g. **weekly**, or when |net delta| exceeds a band like 2–5% of notional) **rebalance**: trim/add the smaller leg so spot and perp notionals match again. Rebalancing itself costs fees — band it; don't rebalance every tick.

**Risks.**
- **Funding reversal** — the rate can flip negative; the carry becomes a cost. Exit on sign flip.
- **Leg slippage / execution risk** — the prices of the two legs move before both fill; a bad fill can eat weeks of carry in one open.
- **Exchange / custody risk** — spot and perp both sit on Bybit; an outage, withdrawal freeze, or auto-deleveraging (ADL) on the short can break neutrality. Size to survive it.
- **Margin pressure** — the short perp needs margin; a sharp rally raises its unrealized loss (offset by the spot gain, but they settle in different wallets) — keep enough margin so the perp isn't liquidated before the spot can be sold.

## Codebase specifics
- **New capability = engine change (LAST priority).** The current engine is **USDⓈ-M perp-only** (`category: "linear"`). Safra requires a **spot leg**: `POST /v5/order/create` with `category: "spot"` (Buy to open, Sell to close). This is the one place the engine gains a non-perp order path — keep it isolated behind a small spot client; don't leak `category` branching across the whole OMS.
- **Reads.** Current funding + next settlement: `GET /v5/market/tickers?category=linear` → `fundingRate`, `nextFundingTime`. Funding interval: `GET /v5/market/instruments-info` → `fundingInterval` (minutes). History for backtest/decay: `GET /v5/market/funding/history`.
- **Config (`v3_coin_config`) for the Safra role.** `engine_enabled: 1`, capital 25–30% of the fleet (see fleet-coordination), `loss_layer_enabled: 0`, `profit_layer_enabled: 0` (no pyramiding a carry). Add Safra-specific knobs (new columns): `funding_entry_apr_min`, `funding_exit_apr_min`, `delta_band_pct`, `rebalance_interval_hours`, `leg_slip_bps_max`. `exposure_limit_usdt` caps carry notional. Its perp short is **delta-neutral** → excluded from the fleet net-directional cap.
- **Pure core / dirty shell.** Funding annualization, cost-adjusted entry/exit decisions, and delta-imbalance math are **pure functions** in a package (e.g. `packages/funding`), unit-tested with `bun test`. Only the **two-leg placement**, fills verification, and reconcile live in the dirty shell (signed Bybit REST via `fetch` + `node:crypto`).
- **Exchange = truth.** After placing both legs, read them back (`/v5/position/list` for the perp, `/v5/account/wallet-balance` or spot holdings for the spot) and reconcile; a delta is computed from **real** filled quantities, not intended ones.
- **Idempotency.** Each leg carries its own persisted `orderLinkId` written to `v3_decision_log` before sending; a retry reuses it (see order-execution-oms). Tag the pair with a shared carry id in `v3_position_event`.
- **Polling, no WebSocket.** Funding, fills, and delta are all read on the loop interval — there is no funding/fill push. Enter well before `nextFundingTime` so you actually hold across settlement.

## Implementation checklist
- [ ] Add an isolated Bybit **spot** client (`category: "spot"`) for the long leg; keep it out of the perp OMS core.
- [ ] Read `fundingRate` + `nextFundingTime` (tickers) and `fundingInterval` (instruments-info) — never hardcode 8h.
- [ ] Compute **annualized, cost-adjusted** funding with a pure `netCarryApr()`; enter only above `funding_entry_apr_min`.
- [ ] Place both legs (spot Buy + perp Sell) near-simultaneously with equal notional; persist each `orderLinkId` first.
- [ ] **Verify both filled** via reconcile; on a partial, **unwind the filled leg immediately** (don't sit directional).
- [ ] Attach adequate margin to the perp short so a rally can't liquidate it before the spot is sold.
- [ ] Compute **net delta** each loop with a pure `deltaImbalance()`; rebalance when out of `delta_band_pct` (or weekly).
- [ ] Exit **both legs** when funding decays below `funding_exit_apr_min` or **flips sign**; require persistence, not one print.
- [ ] Reject entries where expected `leg_slip_bps` exceeds `leg_slip_bps_max` or size exceeds a fraction of ±1% depth.
- [ ] Unit-test annualization, cost hurdle, and delta math; write every decision to `v3_decision_log`, each fill to `v3_position_event`.

## Do / Don't
**Do**
- Read the real `fundingInterval` per symbol and annualize with it.
- Enter only when funding **comfortably** clears the round-trip cost hurdle, not marginally.
- Place both legs together and verify both filled; unwind a partial immediately.
- Keep enough perp margin to survive a rally until the spot can be sold.
- Band delta rebalancing (weekly or on breach) so fees don't eat the carry.

**Don't**
- Don't assume 8h funding — some symbols are 1h/2h/4h; the annualization changes a lot.
- Don't hold one leg naked across a tick — that reintroduces the directional risk you removed.
- Don't chase ≥20bps blips (only ~40% profit after cost); require durable, annualized edge.
- Don't churn on funding noise — each round trip costs ~0.2%+ in fees alone.
- Don't count the Safra perp short in the fleet net-directional cap (it's hedged by spot).
- Don't ignore ADL / exchange risk — both legs on one venue is a single point of failure.

## Common pitfalls
- **Wrong interval → wrong APR.** Annualizing a 1h-funding symbol as 8h understates the rate 8× (or overstates the other way) — always read `fundingInterval`.
- **Leg slippage eats the carry.** 17–54 bps of two-leg slippage can exceed weeks of funding; size to depth and cap `leg_slip_bps`.
- **Partial fill left naked.** One leg fills, the other doesn't → you're directional; must unwind on the same tick, not next loop.
- **Margin blowup on the short.** The perp short can be liquidated in a rally even though the spot is up — different wallets; keep buffer.
- **Funding sign flip.** Holding through a reversal turns income into expense; exit on flip, don't wait for the next rebalance.
- **Over-rebalancing.** Rebalancing every small drift pays fees repeatedly; use a delta band.
- **Fee blindness.** Modeling gross funding as net; four fills + slippage is the real hurdle.
- **Missing the settlement.** Entering after `nextFundingTime` means you paid costs but didn't hold across a payment.

## Code patterns

Pure funding annualization + cost-adjusted entry (`packages/funding`):
```ts
export function annualizeFunding(fundingRate: number, intervalHours: number): number {
  const perDay = 24 / intervalHours;          // settlements/day (8h→3, 1h→24)
  return fundingRate * perDay * 365;          // APR as a fraction (0.01%/8h → ~0.1095)
}

export function netCarryApr(p: {
  fundingRate: number; intervalHours: number;
  roundTripCostFrac: number;                  // 4 fills + 2-leg slippage, as a fraction of notional
  expectedHoldDays: number;                   // amortize entry+exit cost over the hold
}): number {
  const gross = annualizeFunding(p.fundingRate, p.intervalHours);
  const costApr = p.roundTripCostFrac * (365 / Math.max(p.expectedHoldDays, 0.5)); // annualized cost drag
  return gross - costApr;                      // net carry APR
}

export function shouldEnterCarry(netApr: number, minApr: number): boolean {
  return netApr >= minApr;                     // enter only with a comfortable margin, e.g. minApr = 0.08
}

export function shouldExitCarry(fundingRate: number, netApr: number, exitApr: number): boolean {
  return fundingRate <= 0 || netApr < exitApr; // sign flip OR carry decayed below hold hurdle
}
```

Pure delta-imbalance + rebalance decision:
```ts
export function deltaImbalance(p: {
  spotQty: number; spotPrice: number;         // long leg
  perpQty: number; perpPrice: number;         // short leg (positive qty = size shorted)
}): { netDeltaUsdt: number; imbalancePct: number } {
  const spotNotional = p.spotQty * p.spotPrice;
  const perpNotional = p.perpQty * p.perpPrice;
  const netDeltaUsdt = spotNotional - perpNotional;                 // 0 = perfectly hedged
  const base = Math.max(spotNotional, perpNotional, 1);
  return { netDeltaUsdt, imbalancePct: Math.abs(netDeltaUsdt) / base };
}

export function needsRebalance(imbalancePct: number, bandPct: number): boolean {
  return imbalancePct > bandPct;              // e.g. bandPct = 0.03 (3%)
}
```

Dirty-shell two-leg placement with partial-fill unwind (signed Bybit REST):
```ts
// signedPost(...) = HMAC-SHA256 X-BAPI signer from order-execution-oms.
async function openCarry(
  key: { apiKey: string; apiSecret: string },
  symbol: string, qty: string,                 // equal base qty on both legs
  ids: { spot: string; perp: string },         // persisted to v3_decision_log BEFORE this call
) {
  // 1) fire both legs near-simultaneously: spot Buy (long) + perp Sell (short)
  const [spot, perp] = await Promise.all([
    signedPost("/v5/order/create", key.apiKey, key.apiSecret, {
      category: "spot",   symbol, side: "Buy",  orderType: "Market", qty, orderLinkId: ids.spot }),
    signedPost("/v5/order/create", key.apiKey, key.apiSecret, {
      category: "linear", symbol, side: "Sell", orderType: "Market", qty, orderLinkId: ids.perp }),
  ]);
  const spotOk = spot.retCode === 0, perpOk = perp.retCode === 0;

  // 2) partial → unwind the leg that DID fill so we never sit directional
  if (spotOk && !perpOk) {
    await signedPost("/v5/order/create", key.apiKey, key.apiSecret, {
      category: "spot", symbol, side: "Sell", orderType: "Market", qty, reduceOnly: false });
    throw new Error("carry aborted: perp leg failed, spot unwound");
  }
  if (perpOk && !spotOk) {
    await signedPost("/v5/order/create", key.apiKey, key.apiSecret, {
      category: "linear", symbol, side: "Buy", orderType: "Market", qty, reduceOnly: true });
    throw new Error("carry aborted: spot leg failed, perp unwound");
  }
  if (!spotOk && !perpOk) throw new Error("carry aborted: both legs failed");

  // 3) reconcile both legs from the exchange (truth) before trusting delta = 0
  return { spot: spot.result, perp: perp.result };
}
```

Dirty-shell funding read (choose Tier-A, positive-funding coins):
```ts
// GET /v5/market/tickers?category=linear&symbol=SOLUSDT → result.list[0].fundingRate, nextFundingTime
// GET /v5/market/instruments-info?category=linear&symbol=SOLUSDT → result.list[0].fundingInterval (minutes)
// GET /v5/market/funding/history?category=linear&symbol=SOLUSDT&limit=200 → decay/stability for the backtest
```

## References
- [Bybit V5 — Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — `category:"spot"` (long leg) and `category:"linear"` (short leg); MARKET/reduceOnly params.
- [Bybit V5 — Get Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers) — `fundingRate` and `nextFundingTime` for the current carry and settlement timing.
- [Bybit V5 — Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — `fundingInterval` (minutes); never hardcode 8h.
- [Bybit V5 — Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — historical funding for decay/stability and cost-aware backtest.
- [Bybit — Introduction to Funding Rate](https://www.bybit.com/en/help-center/article/Introduction-to-Funding-Rate) — how funding is charged, direction, and settlement intervals.
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position) — read the short-leg size/margin/liqPrice back for reconcile and margin safety.
- [Bybit V5 — Batch Place Order](https://bybit-exchange.github.io/docs/v5/order/batch-place) — option for firing both legs in one round trip to cut leg-timing risk.
- [Crypto Funding Rate Arbitrage: Delta-Neutral Guide to 8–20% APY (ArbitrageScanner)](https://arbitragescanner.io/blog/crypto-funding-rate-arbitrage-guide) — realistic APY bands and the cost hurdle.
- [Delta-Neutral Crypto Strategies: The Basics, Risks Included (BloFin Academy)](https://blofin.com/en/academy/education/delta-neutral-crypto-strategies) — funding-carry mechanics and its risks.
- [How Talos Multi-Leg Algos Slash Execution Slippage for Basis Trades (Talos)](https://www.talos.com/insights/how-talos-multi-leg-algos-slash-execution-slippage-for-basis-trades) — 17–54 bps two-leg execution slippage; why simultaneity matters.
- [Cash-and-Carry Arbitrage in Crypto: Basis, Funding Capture, Where It Breaks (CryptoAdventure)](https://cryptoadventure.com/cash-and-carry-arbitrage-in-crypto-explained-basis-funding-capture-and-where-the-trade-breaks/) — basis risk, funding reversal, exchange risk.
- [BIS Working Paper No. 1087 — Crypto Carry](https://www.bis.org/publ/work1087.pdf) — academic treatment of crypto funding/basis carry and its return drivers.
- [Bun — Documentation](https://bun.com/docs) — `fetch`, `node:crypto` HMAC, `Promise.all` for near-simultaneous legs; `bun test` for the pure funding math.
- [Drizzle ORM — MySQL get started](https://orm.drizzle.team/docs/mysql/get-started-mysql) — carry-config, `v3_decision_log`, and `v3_position_event` writes for the two-leg audit trail.
