---
name: risk-management
description: Trading risk controls for a multi-bot, multi-user Bybit-perpetuals platform, written as pure TypeScript functions in packages/ and unit-tested — position sizing (fixed-fractional risk-per-trade, fractional/half-Kelly), software-enforced take-profit/stop-loss/trailing checked on the 10s engine tick and closed with a MARKET order, max-drawdown and daily-loss limits, per-slot exposure and layering (katman) caps, Bybit maintenance-margin / liquidation awareness, the entry guards (news / calendar / BTC-shock / cooldown), and a global kill switch. Use whenever the task involves how much to risk, sizing an order, "risk per trade", "position size", "Kelly", stop-loss/take-profit/trailing, drawdown or daily-loss limits, slot/layering caps, maintenance margin or liquidation price, the guards, kill switch, or adding a risk check to the v3 Bybit engine before it opens/closes a position.
---

# Risk Management (Bybit Perpetuals, TypeScript)

## When to use this skill
- Sizing a position / notional for an entry ("risk per trade", "how much", "Kelly").
- Writing or reviewing the software TP/SL/trailing logic the engine checks every 10s tick.
- Enforcing max-drawdown, daily-loss, per-slot exposure, or layering (katman) caps.
- Adding or tuning an entry guard (news / calendar / BTC-shock / cooldown).
- Reasoning about Bybit maintenance margin, MMR tiers, or a liquidation price.
- Wiring the global kill switch, or adding any risk check to the v3 engine hot path.

## Core concepts

**Risk math is pure, TDD'd core.** Every number below is computed by a **pure function** in a shared package (e.g. `packages/risk`), with no `fetch`, no DB, no clock. Inputs in, decision out. This is what makes it unit-testable and is why the platform's `pure core / dirty shell` rule exists: the engine (dirty shell) fetches equity/positions and *calls* these functions; it never inlines the math. (Known deviation: the Bybit engine partly inlines risk logic — steer new code back into the pure core.)

**Fixed-fractional (risk-per-trade).** Risk a constant fraction `r` of equity per trade (typ. 0.25%–1%). Size so the loss at the stop equals `r * equity`:

```
riskAmount = equity * r
stopDist   = abs(entry - stop)      // quote per unit
qty        = riskAmount / stopDist  // base units for a linear USDT perp
```

This decouples size from conviction and auto-shrinks after losses (equity falls → smaller bets). It is the default; Kelly only *scales* it.

**Fractional Kelly.** Growth-optimal fraction for win prob `p`, loss prob `q=1-p`, payoff ratio `b` (avg win / avg loss): `f* = p - q/b`. Full Kelly maximizes long-run growth but produces brutal (50–80%+) drawdowns and is hypersensitive to estimation error in `p`/`b`, which are noisy and non-stationary in crypto. **Always use fractional Kelly** — half-Kelly keeps ~75% of the growth at ~half the drawdown; quarter-Kelly for uncertain edges. Rule: `size = min(fixedFractionalCap, kellyMult * f*)`, clamp `f*` to 0 when negative (no edge → no trade).

**Software TP/SL/trailing (no exchange-native stops here).** Because the platform is **polling, not event-driven**, protective exits are enforced **in software on the 10s engine tick**: each tick reads the position's mark/last price, and if price has crossed the stored `takeProfit`, `stopLoss`, or a ratcheting `trailingStop` level, the engine closes the position with a **reduce-only MARKET order**. Trailing is a high-water mark: on each tick, raise the stop as the position moves favorably, never lower it. The trade-off vs Bybit-native conditional orders: up to one tick (~10s) of latency, so size the buffer accordingly and treat maintenance margin as the true hard floor.

**Max-drawdown limit.** Peak-to-trough equity decline. Track an equity peak; on breach of a hard cap (e.g. 15–20%) halt new entries (and optionally flatten). Track per-user and platform-wide.

**Daily-loss limit.** Once realized+unrealized PnL for the UTC day drops below `-D` (e.g. -3% of equity), stop new entries for the rest of the day. Reset at 00:00 UTC. Prevents tilt/cascade days.

**Per-slot exposure & layering (katman) caps.** Capital is allocated in **slots** (see portfolio-management). Cap notional per slot, and cap **layering**: how many add-on entries (katman) a slot may stack and the max aggregate size — so a losing position isn't averaged down without bound. Reject any add that would exceed the slot's notional or layer count.

**Bybit maintenance-margin / liquidation awareness.** On Bybit's Unified Trading Account, liquidation happens when margin can no longer cover **maintenance margin (MM)**. `MM ≈ positionValue × MMR − maintenanceDeduction + est. close fee`; **MMR is tiered by position value** (risk-limit tiers) and adjusts in real time as mark price moves. Isolated mode liquidates when **mark price** hits the position's `liqPrice`; cross/portfolio mode liquidates when account **MMR reaches 100%**, so one bad position can take out others sharing the wallet. Prefer isolated margin per bot/slot. Always trust Bybit's returned `liqPrice`/`positionMM` from the position endpoint; use formulas only as a sanity check.

**Entry guards.** Before opening a candidate that passes the coin-selector, it must clear four independent guards (each a pure predicate the engine ANDs together):
- **news** — a fresh high-impact headline (Gemini-scored sentiment) blocks entries on the affected symbol.
- **calendar** — scheduled macro events (CPI, FOMC) inside a blackout window block entries.
- **BTC-shock** — a sharp BTC move (e.g. |Δ| over N% in M minutes) blocks new risk across correlated alts.
- **cooldown** — after a loss/close on a symbol, block re-entry for a cooldown period to avoid revenge/oscillation.

**Global kill switch.** One flag, checked in the hot path, that blocks all new entries platform-wide (and optionally flattens). Trips on: max-drawdown or daily-loss breach, stale data, repeated API/timeout errors, clock skew, or a manual toggle from the panel. Reset is manual (or a new UTC day for the daily limit).

## Codebase specifics (Bybit / Bun / this platform)

**Reading live risk state (Bybit V5 signed REST via `fetch`).** No WebSocket, no `pybit`, no CCXT — sign requests with `crypto.createHmac` and X-BAPI headers:
```ts
import { createHmac } from "node:crypto";

async function bybitGet(path: string, query: string, key: string, secret: string) {
  const ts = Date.now().toString();
  const recv = "5000";
  const sign = createHmac("sha256", secret).update(ts + key + recv + query).digest("hex");
  const res = await fetch(`https://api.bybit.com${path}?${query}`, {
    headers: {
      "X-BAPI-API-KEY": key, "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": recv, "X-BAPI-SIGN": sign,
    },
    signal: AbortSignal.timeout(8000),
  });
  return res.json();
}
// GET /v5/position/list -> list[i]: size, avgPrice, leverage, liqPrice, positionMM, unrealisedPnl
// GET /v5/account/wallet-balance (UNIFIED) -> totalEquity, totalMaintenanceMargin, accountMMRate
```
`accountMMRate` is a kill-switch input: warn well before it reaches 1.0 (liquidation).

**Closing on a triggered stop (reduce-only MARKET).**
```ts
// POST /v5/order/create — signed like above but sign = HMAC(ts+key+recv+jsonBody)
// { category:"linear", symbol, side:"Sell", orderType:"Market",
//   qty:<positionSize>, reduceOnly:true, orderLinkId:`v3-close-${slotId}-${Date.now()}` }
```

**Precision.** Round `qty` to `lotSizeFilter.qtyStep` and prices to `priceFilter.tickSize` from `GET /v5/market/instruments-info`; reject below `minOrderQty`. Do this in a pure `roundToStep(value, step)` helper.

**Everything auditable.** Each risk decision (entry allowed/blocked, stop hit, kill-switch trip) is written to `v3_decision_log`; each state change to `v3_position_event` (Drizzle insert in the engine, not in the pure core).

## Implementation checklist
- [ ] Size via a pure `positionQty()` (fixed-fractional), optionally scaled by fractional Kelly (≤ half), clamped to a per-slot notional cap.
- [ ] Require a stop for every entry; reject entries with no invalidation.
- [ ] Enforce software TP/SL/trailing on every 10s tick; close with reduce-only MARKET; use mark price, not last, for the trigger.
- [ ] Track equity peak → max-drawdown; track UTC-day PnL → daily-loss; reset at 00:00 UTC.
- [ ] Enforce per-slot exposure and layering (katman) caps before every add.
- [ ] AND the four guards (news/calendar/BTC-shock/cooldown) into the entry predicate.
- [ ] Poll `accountMMRate`; warn at a threshold (e.g. 0.5) well before 1.0; prefer isolated margin per slot.
- [ ] Round qty/price to the symbol filters; reject sub-`minOrderQty`.
- [ ] Global kill switch checked in the hot path, wired to breaches and a manual toggle; write every decision to `v3_decision_log`.
- [ ] Unit-test every pure risk function (edge cases: zero stop distance, negative Kelly, tier boundaries, UTC rollover).

## Do / Don't
**Do**
- Keep all risk math as pure functions in `packages/` and unit-test them.
- Size from a fraction of *current* equity; recompute after each fill/reconcile.
- Use fractional Kelly (≤ 0.5); set `f*=0` (skip) when edge is negative/unknown.
- Trigger stops on mark price; treat maintenance margin as the hard floor beneath your software stop.
- Cap per-slot notional and layering; contain risk with isolated margin.

**Don't**
- Don't inline risk math in the engine — it becomes untestable and drifts.
- Never bet full Kelly, or Kelly from a tiny/curve-fit sample.
- Don't rely on a ~10s software stop as your only defense at high leverage — a fast wick can hit liquidation between ticks.
- Don't ignore funding/fees when sizing; they erode edge on high-turnover slots.
- Don't let one slot's blow-up in cross margin liquidate the whole account.

## Common pitfalls
- **Tick latency:** software TP/SL fires up to ~10s late; a gap can skip your level. Widen buffers; lean on maintenance margin as backstop.
- **Last-price vs mark-price:** last-price triggers get wicked out; liquidation itself uses mark price — trigger on mark.
- **Tier creep:** a winning position grows into a higher risk-limit tier → higher MMR, smaller liquidation buffer even as you profit.
- **Cross-margin contagion:** shared wallet means one position's loss consumes another's margin.
- **Kelly estimation error:** overstated win rate → overbetting → ruin.
- **Stale-equity sizing:** sizing off equity before a reconcile double-counts risk after a partial fill.
- **UTC vs local day** for the daily-loss reset causes double-counting across a session.
- **Rounding rejects:** ignoring `qtyStep`/`minOrderQty` gets orders rejected or silently truncated.

## Code patterns

Pure sizing with fractional-Kelly scaling and a notional cap (`packages/risk`):
```ts
export function positionQty(p: {
  equity: number; entry: number; stop: number;
  riskFrac?: number; winProb?: number; payoff?: number;
  kellyMult?: number; maxNotionalFrac?: number;
}): number {
  const { equity, entry, stop, riskFrac = 0.005,
          winProb, payoff, kellyMult = 0.5, maxNotionalFrac = 0.2 } = p;
  const stopDist = Math.abs(entry - stop);
  if (stopDist <= 0) throw new Error("stop must differ from entry");
  let scale = 1;
  if (winProb != null && payoff) {
    const f = Math.max(winProb - (1 - winProb) / payoff, 0) * kellyMult; // fractional Kelly
    scale = riskFrac ? Math.min(1, f / riskFrac) : 0;
  }
  const qty = (equity * riskFrac * scale) / stopDist;
  return Math.min(qty, (equity * maxNotionalFrac) / entry); // notional cap
}
```

Pure trailing-stop ratchet + trigger, evaluated each tick:
```ts
export type StopState = { side: "long" | "short"; stop: number; peak: number };

export function updateTrailing(s: StopState, mark: number, trailFrac: number): StopState {
  if (s.side === "long") {
    const peak = Math.max(s.peak, mark);
    return { ...s, peak, stop: Math.max(s.stop, peak * (1 - trailFrac)) };
  }
  const peak = Math.min(s.peak, mark);
  return { ...s, peak, stop: Math.min(s.stop, peak * (1 + trailFrac)) };
}

export function stopHit(s: StopState, mark: number): boolean {
  return s.side === "long" ? mark <= s.stop : mark >= s.stop;
}
```

Pure entry gate (guards + limits + kill switch), ANDed:
```ts
export type RiskCtx = {
  killed: boolean; dayPnlPct: number; drawdown: number; accountMMRate: number;
  slotNotional: number; slotCap: number; layers: number; maxLayers: number;
  guards: { news: boolean; calendar: boolean; btcShock: boolean; cooldown: boolean };
  limits: { maxDD: number; dayLoss: number; mmrWarn: number };
};

export function allowEntry(c: RiskCtx): { ok: boolean; reason?: string } {
  if (c.killed) return { ok: false, reason: "kill-switch" };
  if (c.drawdown >= c.limits.maxDD) return { ok: false, reason: "max-drawdown" };
  if (c.dayPnlPct <= -c.limits.dayLoss) return { ok: false, reason: "daily-loss" };
  if (c.accountMMRate >= c.limits.mmrWarn) return { ok: false, reason: "mmr-high" };
  if (c.slotNotional >= c.slotCap) return { ok: false, reason: "slot-exposure" };
  if (c.layers >= c.maxLayers) return { ok: false, reason: "layer-cap" };
  const g = c.guards;
  if (g.news || g.calendar || g.btcShock || g.cooldown)
    return { ok: false, reason: "guard" };
  return { ok: true };
}
```

## References
- [Bybit V5 — Integration Guidance (auth/signing)](https://bybit-exchange.github.io/docs/v5/guide) — X-BAPI headers, HMAC-SHA256 string-to-sign, recv_window rules.
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position/position-list) — size, avgPrice, leverage, liqPrice, positionMM, unrealisedPnl.
- [Bybit V5 — Create Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — MARKET/reduceOnly params for software-triggered closes and orderLinkId.
- [Bybit V5 — Set Trading Stop](https://bybit-exchange.github.io/docs/v5/position/trading-stop) — native TP/SL fields and mark-price triggers (contrast to software-enforced stops).
- [Bybit V5 — Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — per-UID/second budget for risk-state polling cadence.
- [Bybit — Liquidation Price Calculation, Isolated Mode (UTA)](https://www.bybit.com/en/help-center/article/Liquidation-Price-Calculation-under-Isolated-Mode-Unified-Trading-Account) — official isolated-mode liquidation formula.
- [Bybit — UTA Trading Rules (Liquidation Process)](https://www.bybit.com/en/help-center/article/UTA-Trading-Rules) — cross/portfolio MMR=100% liquidation trigger.
- [Bybit — Maintenance Margin (USDT Perpetual & Expiry)](https://www.bybit.com/en/help-center/article/Maintenance-Margin-USDT-Contract) — MM = value×MMR − deduction + close fee.
- [Bybit — Risk Limit (Perpetual & Expiry)](https://www.bybit.com/en/help-center/article/Risk-Limit-Perpetual-and-Futures) — tiered risk limits and dynamic MMR adjustment.
- [Node.js `crypto` — createHmac](https://nodejs.org/api/crypto.html) — HMAC-SHA256 signing used by the Bybit REST client under Bun.
- [Zod — Defining schemas](https://zod.dev/api) — validate risk-config inputs (limits, fractions) at the tRPC boundary before they reach the pure core.
- [Kelly Criterion & Position Sizing (Coriva)](https://coriva.eu.org/en/kelly-criterion-position-sizing/) — full vs fractional Kelly and drawdown trade-offs.
</content>
</invoke>
