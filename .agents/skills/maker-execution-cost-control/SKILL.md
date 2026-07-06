---
name: maker-execution-cost-control
description: The #1 fix for SkyPower V3 — replace taker MARKET entries with maker post-only LIMIT orders on Bybit V5 to survive fees and slippage. Covers PostOnly timeInForce limit entries (linear), tick-chasing (re-price 2–3 ticks then ABORT, never cross), maker 0.02% vs taker 0.055% fee math, the EV/breakeven equation (34% win needs avg winner ≥ 2.3–4× avg loser), slippage bps budgets (Tier-A 5–10 / Tier-B 20–50), sizing as a small fraction of ±1% orderbook depth (GET /v5/market/orderbook), and market slippage protection via slippageToleranceType + slippageTolerance for the taker fallback. Explains WHY the MARKET-only engine bleeds on thin (ince) coins. Pure cost/EV/slippage functions in packages/ (bun test) + dirty-shell post-only placement. Invoke for post-only, PostOnly, maker vs taker fee, tick chase, chase the book, abort limit, slippage, slippageTolerance, orderbook depth sizing, breakeven win rate, expected value, EV gate, cost-aware, why not market order, or Kayikci limit entry.
---

# Maker Execution & Cost Control

## When to use this skill
- Moving the v3 engine off **MARKET-only** entries to **post-only maker LIMIT** orders (Kayıkçı requirement; Avcı may still take on breakout).
- Implementing **tick-chasing**: rest a PostOnly limit at/inside the touch, re-price a few ticks as the book moves, and **abort** instead of crossing to taker.
- Computing whether a trade is worth taking at all: **maker/taker fee math**, **slippage budget**, and the **expected-value / breakeven** equation for a low win-rate momentum strategy.
- **Sizing** an order so it is a small fraction of ±1% orderbook depth (avoid being your own slippage).
- Adding **slippage protection** to the taker fallback path (`slippageToleranceType` + `slippageTolerance`, or a manual IOC limit).
- Explaining to a reviewer WHY thin ("ince") coins bleed the account under taker MARKET entries.

## Core concepts
- **The #1 problem is cost, not signal.** On $100 notional a $1 cut threshold is 1% of notional. Round-trip **taker** commission = 0.055% × 2 ≈ **$0.11 = ~11% of that threshold**, before slippage. Thin-coin slippage of 20–100 bps can equal or exceed the entire edge. Fee is charged on **notional (qty × price), not margin** — leverage does not shrink it.
- **Maker vs taker.** Bybit USDⓈ-M perp standard fees: **taker 0.055%**, **maker 0.02%** (VIP/some sources lower, maker can reach 0.01%/0%; treat as config and read the live account fee). Switching entry from taker to maker saves ~0.035% per side — over hundreds of trades that is the difference between +EV and −EV.
- **Post-only (PostOnly TIF).** A **Limit** order with `timeInForce: "PostOnly"` is **cancelled if it would fill immediately** (i.e. if it would cross and be a taker). This *guarantees* you pay the maker fee or nothing — you never accidentally take. Trade-off: you may not fill, so you need a chase-then-abort loop.
- **Tick chase, then abort.** Post at the passive touch; if unfilled after a short poll window, cancel and re-post 1 tick closer (still PostOnly, still passive). Allow **2–3 tick steps**; if still unfilled, **ABORT the entry** — do NOT flip to MARKET/taker to "make sure it fills". Chasing past a few ticks means the edge has already moved against you.
- **Slippage model.** For a taker fill, expected slippage ≈ half-spread + walking the book for your size. Budget it explicitly: **Tier-A 5–10 bps, Tier-B 20–50 bps**. Cost-aware backtests must subtract this buffer; live sizing must keep you inside it.
- **Depth-fraction sizing.** Read **±1% orderbook depth** (`GET /v5/market/orderbook`, category `linear`) and cap order qty to a **small fraction** (e.g. ≤ 5–10%) of the thinner side's depth. If `entry_usdt` exceeds that fraction, shrink or skip — you are otherwise trading against yourself.
- **Expected value / breakeven.** Breakeven win rate = `1 / (1 + R)` where R = avg winner / avg loser. At **34% win rate** you break even around **R ≈ 1.9**, and to have a real margin over fees+slippage the target is **avg winner ≥ 2.3–4× avg loser, consistently**. Every EV number must be **net of round-trip fees + slippage + funding**, not gross.
- **Taker fallback with protection.** When a taker fill is unavoidable (Avcı breakout, forced exit), don't send a naked MARKET. Use Bybit's **`slippageToleranceType` + `slippageTolerance`** (the engine converts the market order into an IOC limit, rejected if the book has nothing inside tolerance), or construct your own **IOC limit** capped N bps from Ask1/Bid1.

## Codebase specifics
- **Pure core / dirty shell.** All cost/EV/slippage/sizing math lives as **pure functions in `packages/`** (deterministic, unit-tested with `bun test`). Only the actual order POST and orderbook fetch live in the dirty shell.
- **[KOD gap] Engine is MARKET-only for entries.** This skill's whole point: add a **post-only limit entry path** with a chase loop. Cross-reference `order-execution-oms` for signing, `orderLinkId` idempotency, retry/backoff.
- **[KOD gap] No depth-fraction sizing.** `entry_usdt` is used directly; there is no check against ±1% orderbook depth. Add a sizing clamp before placement.
- **Relevant `v3_coin_config` keys:** `entry_usdt` (target notional per entry), `likidite_enabled` + `min_volume_usdt` (liquidity gate), `spread_enabled` + `max_spread_pct` (spread gate). Tier-A vs Tier-B liquidity criteria are enforced by coin-universe selection; this skill assumes a symbol already passed that gate and focuses on *execution* cost.
- **Polling, no WebSocket.** The chase loop is a REST poll: place PostOnly → poll `/v5/order/realtime` for fill → if unfilled after the window, cancel + re-post. Budget rate limits (see `rest-polling-and-rate-limits`).
- **Endpoints.** Place: `POST /v5/order/create` (`orderType: "Limit"`, `timeInForce: "PostOnly"`, `price` tick-aligned); cancel: `POST /v5/order/cancel`; depth: `GET /v5/market/orderbook`; fees: read from `GET /v5/account/fee-rate` rather than hardcoding for VIP correctness.
- **Audit.** Log every chase step and the abort decision to `v3_decision_log` (reason: `maker_unfilled_abort`, `depth_cap_shrink`, `ev_reject`); the fill event to `v3_position_event`.

## Implementation checklist
- [ ] Fetch `tickSize`/`qtyStep` (instruments-info) and `±1%` depth (`/v5/market/orderbook`) before sizing.
- [ ] Clamp `entry_usdt`-derived qty to ≤ a small fraction of the thinner-side ±1% depth; skip if the minimum won't fit.
- [ ] Compute a **cost-aware EV** (net of maker/taker fee + slippage bps + funding); reject the entry if EV ≤ 0 or R below the role's breakeven target.
- [ ] Place a **PostOnly Limit** at the passive touch with a pre-persisted `orderLinkId`.
- [ ] Poll for fill; on timeout cancel and re-post 1 tick closer, up to **2–3 steps**; then **abort** (never cross to taker on entry).
- [ ] For the taker fallback only, set `slippageToleranceType` + `slippageTolerance` (or send an IOC limit capped N bps off touch).
- [ ] Round `price` to `tickSize` and `qty` to `qtyStep`; format as strings before signing.
- [ ] Write each chase step + the final outcome (filled / aborted / rejected) to `v3_decision_log`.

## Do / Don't
**Do**
- Enter maker with **PostOnly** so you pay the maker fee or nothing.
- Chase only **2–3 ticks**, then abort — a missed entry costs nothing; a chased-into-taker entry costs the edge.
- Size as a **fraction of ±1% depth**; treat your own market impact as a cost.
- Gate every entry on **net-of-cost EV** with the role's breakeven R (34% win ⇒ target winner ≥ 2.3–4× loser).
- Protect the taker fallback with `slippageTolerance`/IOC-limit caps.
- Read the **live account fee rate** instead of hardcoding, so VIP tiers are correct.

**Don't**
- Don't send naked MARKET entries on thin coins — that is the behavior this skill exists to replace.
- Don't flip a stuck PostOnly to MARKET "to guarantee the fill"; abort instead.
- Don't compute EV on **gross** returns — always subtract round-trip fee + slippage + funding.
- Don't size to `entry_usdt` blindly when ±1% depth is thin; shrink or skip.
- Don't hardcode 0.055/0.02 into EV as truth for every account; use them as defaults and read live.
- Don't confuse fee-on-notional with fee-on-margin — leverage does not reduce commission.

## Common pitfalls
- **Post-only rejection loop.** If the market moves through your price between poll ticks, a PostOnly re-post can be rejected ("would immediately match"). Treat that as a signal the touch moved — re-read the book, don't spam.
- **Chasing forever.** Without a hard step cap the loop becomes a slow taker. Enforce 2–3 steps then abort.
- **Slippage double-count.** Subtracting slippage in the backtest AND capping it live is correct; forgetting it in the backtest makes a −EV strategy look +EV.
- **Depth staleness.** The orderbook snapshot is a moment in time under polling; use a conservative fraction and re-check right before placing.
- **Ignoring funding.** For multi-hour holds funding can rival commission; include it in EV, especially for Safra-style carry.
- **Fee-on-margin fallacy.** A common miscalculation — fee scales with notional, so 20× leverage does not make the 0.055% "smaller".

## Code patterns
Pure cost / EV / sizing functions (in `packages/`, unit-tested with `bun test`):

```ts
// packages/exec-cost/src/cost.ts  — all pure, deterministic
export const FEE = { maker: 0.0002, taker: 0.00055 } as const; // Bybit perp defaults; read live for VIP

/** Round-trip cost as a fraction of notional. */
export function roundTripCost(entry: "maker" | "taker", exit: "maker" | "taker", slippageBps: number): number {
  return FEE[entry] + FEE[exit] + slippageBps / 10_000; // exit is typically taker (reduce-only MARKET close)
}

/** Breakeven win rate for a reward:risk ratio R = avgWin/avgLoss. */
export const breakevenWinRate = (R: number): number => 1 / (1 + R);

/** Net expected value per unit notional, AFTER costs. winner/loser are gross fractions (0.01 = 1%). */
export function netEV(winRate: number, avgWinner: number, avgLoser: number, cost: number): number {
  return winRate * (avgWinner - cost) - (1 - winRate) * (avgLoser + cost);
}

/** Cap target notional (USDT) to a small fraction of the thinner side's ±1% depth. */
export function depthCappedNotional(target: number, bidDepth1pct: number, askDepth1pct: number, frac = 0.08): number {
  return Math.min(target, frac * Math.min(bidDepth1pct, askDepth1pct));
}

/** Post-only chase price: step `n` ticks toward the touch but stay passive (never cross). */
export function chasePrice(side: "Buy" | "Sell", touch: number, tick: number, step: number): number {
  return side === "Buy" ? touch - step * tick : touch + step * tick;
}
```

Dirty-shell post-only entry with a bounded tick-chase and abort (reuses `order-execution-oms` signing + idempotency):

```ts
// shell: place a maker PostOnly limit, chase up to `maxSteps`, else abort. NEVER falls back to MARKET on entry.
async function makerEntry(
  key: ApiKey, sym: string, side: "Buy" | "Sell", qtyStr: string,
  book: { bid1: number; ask1: number }, tick: number, linkBase: string, maxSteps = 3,
): Promise<{ status: "filled" | "aborted"; orderId?: string }> {
  for (let step = 0; step <= maxSteps; step++) {
    const touch = side === "Buy" ? book.bid1 : book.ask1;                 // rest passively at our side's touch
    const price = (touch + (side === "Buy" ? -1 : 1) * step * tick).toFixed(tickDecimals(tick));
    const linkId = `${linkBase}-${step}`;                                 // persisted to v3_decision_log first
    const r = await signedPost("/v5/order/create", key, {
      category: "linear", symbol: sym, side, orderType: "Limit",
      qty: qtyStr, price, timeInForce: "PostOnly", positionIdx: 0, orderLinkId: linkId,
    });
    if (r.retCode !== 0) { await logDecision(sym, "maker_post_reject", r.retMsg); book = await getTouch(key, sym); continue; }
    const filled = await pollFill(key, sym, linkId, 2_000);               // short REST poll window
    if (filled) return { status: "filled", orderId: filled.orderId };
    await signedPost("/v5/order/cancel", key, { category: "linear", symbol: sym, orderLinkId: linkId });
    book = await getTouch(key, sym);                                      // refresh for the next chase step
  }
  await logDecision(sym, "maker_unfilled_abort", `no fill after ${maxSteps} ticks`);
  return { status: "aborted" };                                          // do NOT cross to taker
}
```

Taker fallback (Avcı breakout / forced exit) WITH slippage protection:

```ts
// Bybit converts a market order with slippageTolerance into an IOC limit; rejected if nothing sits inside tolerance.
async function protectedTaker(key: ApiKey, sym: string, side: "Buy" | "Sell", qtyStr: string, linkId: string) {
  return signedPost("/v5/order/create", key, {
    category: "linear", symbol: sym, side, orderType: "Market", qty: qtyStr,
    positionIdx: 0, orderLinkId: linkId,
    slippageToleranceType: "Percent",   // or "TickSize"
    slippageTolerance: "0.1",           // 0.1% cap from Ask1/Bid1 — no fill if the book is worse
  });
}
```

## References
- [Bybit V5 — Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — `orderType: Limit`, `timeInForce: PostOnly`, `slippageToleranceType`/`slippageTolerance`, `stopLoss`, `reduceOnly`, `orderLinkId`.
- [Bybit V5 — Get Orderbook](https://bybit-exchange.github.io/docs/v5/market/orderbook) — `GET /v5/market/orderbook`, category `linear`, `limit` up to 500 levels for ±1% depth sizing.
- [Bybit V5 — Cancel Order](https://bybit-exchange.github.io/docs/v5/order/cancel-order) — cancel a resting PostOnly between chase steps.
- [Bybit V5 — Get Fee Rate](https://bybit-exchange.github.io/docs/v5/account/fee-rate) — read the account's live maker/taker rate instead of hardcoding VIP-0 defaults.
- [Bybit — Futures Contract Fees Explained](https://www.bybit.com/en/help-center/article/Perpetual-Futures-Contract-Fees-Explained) — taker 0.055% / maker 0.02% standard perp fees; fee charged on notional.
- [Bybit — Market Order with Slippage Tolerance](https://www.bybit.com/en/help-center/article/Market-Order-with-Slippage-Tolerance) — how slippage tolerance converts a market order into a bounded IOC limit.
- [Bybit V5 — Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — `tickSize`, `qtyStep`, `minOrderQty` for tick-aligned PostOnly prices and depth-capped qty.
- [Bybit V5 — Get Open Orders](https://bybit-exchange.github.io/docs/v5/order/open-order) — poll `/v5/order/realtime` by `orderLinkId` to detect a maker fill under polling.
- [Bybit V5 — Error Codes](https://bybit-exchange.github.io/docs/v5/error) — post-only "would immediately match" rejects vs transient retryable codes.
- [LuxAlgo — Win Rate and Risk/Reward Connection](https://www.luxalgo.com/blog/win-rate-and-riskreward-connection-explained/) — breakeven win rate = 1/(1+R); why a 34% win rate needs a large winner:loser ratio.
- [P&L Ledger — Break-even Win Rate by Risk/Reward](https://www.pnlledger.com/break-even-win-rate-by-risk-reward-table/) — table mapping R:R to breakeven win rate; net-of-cost expectancy.
- [Bun — Documentation](https://bun.com/docs) — `fetch`, `node:crypto` HMAC, `Bun.sleep` for the chase/poll loop in the shell.
