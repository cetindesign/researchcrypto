---
name: portfolio-management
description: Managing capital across many bots/users on Bybit in this TypeScript platform — slot-based capital allocation, layering (katman), realized/unrealized PnL with explicit fee and funding accounting stored in MySQL via Drizzle, reconciling the DB ledger against real exchange positions (exchange = truth), per-user configs, and per-strategy/per-slot performance attribution (PnL, drawdown, win rate, Sharpe). Use when the task involves allocating capital to slots, "how much per bot", layering/adding to a position, building the PnL ledger, booking trading fees or funding, reconciling DB vs Bybit positions, per-user allocation, closed vs unrealized PnL, equity snapshots, or attributing performance to a strategy/slot. DB is the accounting ledger; the exchange is the source of truth.
---

# Portfolio Management (Multi-Bot / Multi-User on Bybit, TypeScript)

## When to use this skill
- Allocating capital across slots/users, or deciding how much a bot gets.
- Handling layering (katman) — adding to an open position within a slot's caps.
- Building the PnL ledger: realized vs unrealized, trading fees, funding.
- Reconciling the Drizzle/MySQL ledger against real Bybit positions.
- Snapshotting equity and computing per-slot/per-strategy performance metrics.
- Storing/reading per-user configs that drive allocation and attribution.

## Core concepts

**Slot-based allocation.** Capital is divided into **slots** — the platform's unit of allocation. Each slot holds at most one position at a time and carries a budget (a notional cap and/or a fraction of the user's equity). The allocator decides which candidate coin fills a free slot; the number of slots and their budgets are per-user config. Keep a cash buffer (never allocate 100%) for margin spikes and funding. Common weighting: equal-weight slots (robust default), or size slots by inverse realized volatility / recent risk-adjusted performance with a per-slot cap to avoid chasing luck.

**Layering (katman).** Within a slot, the strategy may **add to** the position (average in) at defined thresholds. Portfolio-side rules: cap the number of layers and the aggregate slot notional (risk-management owns the hard caps), and track the true blended `avgPrice` and total size per slot so PnL and exposure stay correct after each add.

**Equity & snapshots.** Account equity = wallet balance + Σ unrealized PnL (Bybit's `totalEquity` already includes unrealized — don't add notional on top). Snapshot equity on a fixed cadence and on every fill/close so drawdown, Sharpe, and allocation decisions use comparable series. Store snapshots in MySQL.

**PnL accounting (book fees and funding explicitly).**
- **Realized PnL** = closed-trade PnL − open fee − close fee − Σ funding paid/received. It is *net* of costs.
- **Unrealized PnL** = mark-to-market on open positions; does **not** include the fees/funding you'll still pay.
- **Trading fees** = taker/maker rate × notional, per fill (every partial fill and every layer add incurs a fee).
- **Funding** = `positionValue × fundingRate`, exchanged between longs/shorts every funding interval (8h on Bybit majors, 00:00/08:00/16:00 UTC) **only if you hold at the funding timestamp**. Positive rate → longs pay shorts. High-turnover and carry slots live or die on fees+funding — always book them.

**DB = ledger, exchange = truth (reconcile).** The MySQL tables are your **accounting ledger**; the **exchange is the single source of truth** for what positions actually exist. Every engine tick fetches real positions from Bybit and **reconciles**: if the DB says a slot is open but Bybit shows flat (e.g. a manual close or a missed close), correct the DB and book the realized PnL from Bybit's closed-PnL record — never let the ledger silently diverge. Reconstruct the authoritative money trail from Bybit's transaction log (which includes funding settlements), not from your own guesses.

**Per-user configs.** Each user has slots count, budgets, risk fractions, allowed coins, and guard settings — read from the DB. Allocation and attribution are always scoped per user; two users' slots are independent capital pools.

**Per-strategy / per-slot attribution.** Attribute realized PnL, fees, funding, drawdown, win rate, and Sharpe to the slot and strategy that produced them. Because one Bybit account nets same-symbol positions in one-way mode, you **cannot** read per-slot PnL off the exchange — you must attribute internally from `v3_position_event` / closed-PnL records keyed by slot, and reconcile the *sum* against the exchange net position.

**Sharpe & metrics.** Sharpe = `(mean(returns) − rf) / std(returns)`, annualized by `√periodsPerYear`. Report alongside max drawdown and Calmar; compare strategies on risk-adjusted terms, not raw PnL.

## Codebase specifics (Bybit / Drizzle / this platform)

**Ledger tables (Drizzle, MySQL).** Schema is guaranteed by an idempotent `ensure-schema.ts` (ALTER TABLE), not migration files. Store money as `decimal`, never float:
```ts
import { mysqlTable, bigint, varchar, decimal, timestamp, int } from "drizzle-orm/mysql-core";

export const slotState = mysqlTable("v3_slot_state", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  userId: varchar("user_id", { length: 64 }).notNull(),
  slotId: int("slot_id").notNull(),
  symbol: varchar("symbol", { length: 32 }),
  side: varchar("side", { length: 8 }),
  size: decimal("size", { precision: 38, scale: 12 }),
  avgPrice: decimal("avg_price", { precision: 38, scale: 12 }),
  layers: int("layers").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const pnlLedger = mysqlTable("v3_pnl_ledger", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  userId: varchar("user_id", { length: 64 }).notNull(),
  slotId: int("slot_id").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(), // 'trade' | 'fee' | 'funding'
  amount: decimal("amount", { precision: 38, scale: 12 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

**Read real state from Bybit (signed REST, no WebSocket).** Sign with `crypto.createHmac` + X-BAPI headers (see risk-management / rest-polling skills). Authoritative endpoints for the ledger:
- `GET /v5/account/wallet-balance` (UNIFIED) → `totalEquity` for equity snapshots.
- `GET /v5/position/list` → live positions to reconcile the ledger against.
- `GET /v5/position/closed-pnl` → per-trade `closedPnl`, `openFee`, `closeFee` for realized PnL.
- `GET /v5/account/transaction-log` → the authoritative running ledger including **funding settlements**.

**Write the ledger in a transaction.** Book the trade, its fees, and any funding atomically so a crash never half-writes:
```ts
await db.transaction(async (tx) => {
  await tx.insert(pnlLedger).values([
    { userId, slotId, kind: "trade",   amount: closedPnl },
    { userId, slotId, kind: "fee",     amount: negate(openFee + closeFee) },
  ]);
  await tx.update(slotState).set({ symbol: null, side: null, size: "0", layers: 0 })
          .where(and(eq(slotState.userId, userId), eq(slotState.slotId, slotId)));
});
```

## Implementation checklist
- [ ] Define slots per user (count + budget) in config; keep a cash buffer; enforce per-slot notional caps.
- [ ] Track blended `avgPrice`, `size`, and `layers` per slot; update on every layer add.
- [ ] Snapshot equity (`totalEquity`) on a fixed cadence + on every fill/close.
- [ ] Build the PnL ledger from `closed-pnl` + `transaction-log`; book trade, fee, and funding rows explicitly.
- [ ] Reconcile every tick: DB slot state vs Bybit `position/list`; correct the DB to match the exchange and book any missed realized PnL.
- [ ] Attribute PnL/fees/funding/drawdown/Sharpe per slot and per strategy from `v3_position_event`.
- [ ] Store money as `decimal(38,12)`; never float.
- [ ] Write related ledger + slot updates inside a Drizzle `db.transaction`.

## Do / Don't
**Do**
- Book fees and funding into realized PnL — unrealized flatters you by omitting them.
- Treat the exchange as truth: reconcile the DB ledger to `position/list` every tick.
- Reconstruct the money trail from Bybit's transaction log (it has funding settlements).
- Keep a cash/margin buffer; don't allocate 100% of equity into slots.
- Attribute per slot internally; compare strategies on Sharpe/Calmar, not raw PnL.

**Don't**
- Don't run two slots on the same symbol in one one-way account expecting independent positions — Bybit nets them; attribute internally.
- Don't double-count equity by adding notional to `totalEquity` (it already includes unrealized PnL).
- Don't store prices/PnL as float — use `decimal`.
- Don't let the ledger diverge from the exchange because a close was missed — reconcile and correct.
- Don't call "many slots" diversification when their returns are correlated to BTC.

## Common pitfalls
- **Funding blind spot:** ignoring funding makes carry/high-turnover slots look profitable when they aren't.
- **Netting confusion:** same-symbol slots merge into one net position on the exchange; per-slot PnL must come from your internal ledger.
- **Ledger drift:** a manual close or missed close on Bybit leaves the DB thinking a slot is open — every tick's reconcile is what catches it.
- **Double-counted equity:** summing wallet balance and position value inflates equity.
- **Float rounding:** `float`/`double` corrupt PnL and fee sums; `decimal` is exact.
- **Timezone mismatch:** funding settles in UTC; a local-time PnL day boundary mis-books it.
- **Survivorship in weighting:** tilting allocation to recent winners chases noise and raises regime correlation.

## Code patterns

Inverse-volatility slot weights with a cap and cash buffer (pure):
```ts
export function inverseVolWeights(vols: number[], wCap = 0.4, cashBuffer = 0.1): number[] {
  const inv = vols.map((v) => 1 / v);
  const sum = inv.reduce((a, b) => a + b, 0);
  let w = inv.map((x) => Math.min(x / sum, wCap));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (x / s) * (1 - cashBuffer)); // fraction of equity per slot
}
```

Annualized Sharpe from an equity snapshot series (pure):
```ts
export function sharpe(equity: number[], periodsPerYear = 365 * 24, rf = 0): number {
  const r: number[] = [];
  for (let i = 1; i < equity.length; i++) r.push((equity[i] - equity[i - 1]) / equity[i - 1]);
  const ex = r.map((x) => x - rf / periodsPerYear);
  const mean = ex.reduce((a, b) => a + b, 0) / ex.length;
  const sd = Math.sqrt(ex.reduce((a, b) => a + (b - mean) ** 2, 0) / (ex.length - 1));
  return sd === 0 ? 0 : (mean / sd) * Math.sqrt(periodsPerYear);
}
```

Reconcile DB slot state against the exchange (dirty shell calls a pure diff):
```ts
export function reconcileSlot(
  dbOpen: boolean, exchangeSize: number,
): "book_close" | "adopt_open" | "ok" {
  if (dbOpen && exchangeSize === 0) return "book_close"; // closed on exchange, DB stale
  if (!dbOpen && exchangeSize !== 0) return "adopt_open"; // exists on exchange, DB missed it
  return "ok";
}
```

## References
- [Bybit V5 — Get Wallet Balance](https://bybit-exchange.github.io/docs/v5/account/wallet-balance) — totalEquity for equity snapshots (balance + unrealized PnL).
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position/position-list) — live positions to reconcile the ledger against (exchange = truth).
- [Bybit V5 — Get Closed PnL](https://bybit-exchange.github.io/docs/v5/position/close-pnl) — per-trade closedPnl, openFee, closeFee for realized PnL.
- [Bybit V5 — Get Transaction Log](https://bybit-exchange.github.io/docs/v5/account/transaction-log) — authoritative ledger including funding settlements.
- [Bybit — P&L Calculations (USDT Perpetual & Expiry)](https://www.bybit.com/en/help-center/article/Profit-Loss-calculations-USDT-Contract) — realized vs unrealized PnL formulas.
- [Bybit — Funding Fee Calculation](https://www.bybit.com/en/help-center/article/Funding-fee-calculation) — positionValue × fundingRate, 8h settlement timing.
- [Bybit — Introduction to Funding Rate](https://www.bybit.com/en/help-center/article/Introduction-to-Funding-Rate) — who pays whom and the interval.
- [Drizzle ORM — MySQL column types](https://orm.drizzle.team/docs/column-types/mysql) — decimal/timestamp columns for money and snapshots.
- [Drizzle ORM — Transactions](https://orm.drizzle.team/docs/transactions) — db.transaction() for atomic ledger + slot writes.
- [Zod — Defining schemas](https://zod.dev/api) — validate per-user allocation config at the tRPC boundary.
</content>
