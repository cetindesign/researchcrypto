---
name: reconcile-source-of-truth
description: The reconcile pattern for this Bun + TypeScript multi-bot Bybit platform — the EXCHANGE is the single source of truth and the MySQL DB is only an accounting ledger. Each 10s engine tick fetches real Bybit positions and open orders via signed REST (polling, no WebSocket) and reconciles the DB to match before making any decision. Covers detecting drift, orphaned DB rows, positions opened/closed out-of-band, partial fills; reconcile-on-boot after a crash; idempotent updates keyed on orderLinkId; conflict-resolution rules (exchange wins); and writing every discrepancy to v3_position_event. Invoke when the user mentions reconcile, source of truth, drift, DB out of sync with exchange, orphaned position/order, out-of-band close, partial fill handling, crash recovery, reconcile-on-boot, idempotent position update, exchange vs DB mismatch, or trusting the exchange over local state.
---

# Reconcile: Exchange as Source of Truth

## When to use this skill
- Starting an engine tick — before checking TP/SL or entering, sync the DB to what Bybit actually reports.
- Recovering after a crash/restart: rebuild believed state from the exchange, not from stale DB rows.
- Handling a position closed or opened **out-of-band** (manual close in the app, liquidation, external tool).
- Reconciling **partial fills** where the exchange filled less than the DB assumed.
- Deciding who wins when the DB and the exchange disagree (spoiler: the exchange).
- Recording a discrepancy for the audit trail (`v3_position_event`).

## Core concepts
- **Exchange = truth, DB = ledger.** The DB records what we *believe* and *why we acted* (audit). It is never authoritative about live position size, entry price, or open orders. On any conflict, the exchange value wins and the DB is corrected.
- **Reconcile-before-decide.** Every tick, in order: fetch real Bybit positions + open orders → reconcile DB to them → *only then* evaluate TP/SL/trailing, layering, and new entries. Deciding on stale DB state risks double-entry or closing a phantom position.
- **Drift.** Any difference between DB belief and exchange reality: size mismatch (partial fill), an entry the DB missed, a close the DB missed, an order that no longer exists. Reconcile detects and resolves each.
- **Orphaned DB row.** DB says a position/order is open, but the exchange has none. Close/flatten the DB row and log the event — do not re-issue orders for it.
- **Out-of-band change.** A position opened or closed without the engine (manual, liquidation, another process). The exchange shows the new reality; adopt it.
- **Idempotent updates.** Because this is polling and retries happen, reconcile must be safe to run repeatedly. Key updates on `orderLinkId`/position key and upsert — running it twice yields the same DB state.
- **Polling, not events.** There is **no WebSocket**. Reconcile reads periodic signed REST snapshots, so it must tolerate brief staleness (an order placed this tick may not yet appear) and never assume the last snapshot is instantaneous.

## Codebase specifics (Bybit / engine loop / Drizzle)
- **Signed REST reads** each tick:
  - `GET /v5/position/list` — real open positions (size, side, avgPrice, unrealised PnL).
  - `GET /v5/order/realtime` — open/partially-filled orders (our `orderLinkId` is the match key).
  - `GET /v5/execution/list` — fills, to attribute partials and realized PnL.
  All signed with HMAC-SHA256 X-BAPI headers + recv_window (see `exchange-integration-bybit`).
- **Match key.** Every order the engine places carries an `orderLinkId` (client order id). Reconcile joins exchange orders to DB rows on `orderLinkId`; positions match on `(symbol, side)` under the account/category.
- **Conflict rules (exchange wins):**
  - Exchange has position, DB doesn't → insert/adopt it (opened out-of-band), log `opened`.
  - DB has position, exchange doesn't → close the DB row (closed out-of-band / liquidation / orphaned), log `closed` or `drift`.
  - Sizes differ → set DB size = exchange size (partial fill), log `partial_fill`.
  - DB order open, exchange order gone → mark filled/cancelled from `execution/list`, else cancelled; log it.
- **Reconcile-on-boot.** `ensure-schema` runs, then the first engine tick reconciles *before* any decision, so a crash mid-order can't cause a duplicate entry — the exchange already reflects whatever actually happened.
- **Every discrepancy → `v3_position_event`** (append-only) with a `detail` JSON snapshot of exchange-vs-DB. Routine decisions still go to `v3_decision_log`.

## Implementation checklist
- [ ] At tick start, fetch positions (`/v5/position/list`) and open orders (`/v5/order/realtime`) via signed REST.
- [ ] Build a keyed map of exchange state; join to DB rows on `orderLinkId` / `(symbol, side)`.
- [ ] Apply conflict rules with the exchange as winner; make each write idempotent (upsert on the key).
- [ ] Pull `/v5/execution/list` to resolve partial fills and realized PnL for changed orders.
- [ ] Adopt out-of-band opens; flatten orphaned DB rows; correct sizes to match the exchange.
- [ ] Append one `v3_position_event` row per discrepancy with an exchange-vs-DB snapshot.
- [ ] Run the full reconcile on boot *before* the first TP/SL or entry decision.
- [ ] Only after reconcile succeeds, proceed to decision logic; if reconcile fails (timeout/rate-limit), skip decisions this tick.

## Do / Don't
- **Do** treat Bybit's response as authoritative and correct the DB toward it.
- **Do** reconcile before every decision and on boot after a crash.
- **Do** key updates on `orderLinkId` so repeated reconciles are idempotent.
- **Do** log every drift/out-of-band event to `v3_position_event`.
- **Don't** decide (TP/SL/entry) on DB state that hasn't been reconciled this tick.
- **Don't** re-issue orders for a DB row the exchange doesn't know about — flatten and log instead.
- **Don't** assume a just-placed order appears instantly; tolerate one-tick staleness rather than double-acting.
- **Don't** overwrite exchange truth with DB belief, ever.

## Common pitfalls
- **Deciding before reconciling.** Closing on a phantom position or entering a slot that's actually full — always reconcile first.
- **Staleness race.** An order placed this tick may not yet be in the next snapshot; guard with `orderLinkId` so you don't place a duplicate.
- **Non-idempotent close.** Flattening an orphan without keying the write can loop-log or thrash; upsert and check state before writing.
- **Silent partials.** Treating a partially-filled order as fully filled corrupts size; reconcile from `execution/list`, not from the intended qty.
- **Reconcile on failure.** If the REST read times out or hits a rate limit, do NOT reconcile against an empty/partial response — skip the tick and retry (see `rest-polling-and-rate-limits`).

## Code patterns

```ts
// One reconcile pass per tick — exchange is truth, DB is corrected toward it
async function reconcile(ctx: EngineCtx, botId: string) {
  const [positions, orders] = await Promise.all([
    bybitSigned(ctx, "GET", "/v5/position/list", { category: "linear", settleCoin: "USDT" }),
    bybitSigned(ctx, "GET", "/v5/order/realtime", { category: "linear", settleCoin: "USDT", openOnly: 0 }),
  ]);
  if (!positions.ok || !orders.ok) return { reconciled: false }; // timeout/rate-limit -> skip decisions

  const exByKey = new Map(positions.list.map((p) => [`${p.symbol}:${p.side}`, p]));
  const dbRows  = await ctx.db.select().from(dbPosition).where(eq(dbPosition.botId, botId));

  // DB believes open, exchange has none -> orphaned / closed out-of-band
  for (const r of dbRows) {
    const ex = exByKey.get(`${r.symbol}:${r.side}`);
    if (!ex || Number(ex.size) === 0) {
      await ctx.db.update(dbPosition).set({ open: false }).where(eq(dbPosition.id, r.id));
      await logEvent(ctx, botId, r.symbol, "closed_out_of_band", { db: r, exchange: ex ?? null });
    } else if (ex.size !== r.size) {                        // partial fill / size drift
      await ctx.db.update(dbPosition).set({ size: ex.size, avgPrice: ex.avgPrice }).where(eq(dbPosition.id, r.id));
      await logEvent(ctx, botId, r.symbol, "partial_fill", { was: r.size, now: ex.size });
    }
    exByKey.delete(`${r.symbol}:${r.side}`);
  }
  // Exchange has a position the DB never recorded -> opened out-of-band, adopt it
  for (const [, ex] of exByKey) {
    if (Number(ex.size) === 0) continue;
    await ctx.db.insert(dbPosition).values(fromExchange(botId, ex))
      .onDuplicateKeyUpdate({ set: fromExchange(botId, ex) });         // idempotent
    await logEvent(ctx, botId, ex.symbol, "opened_out_of_band", { exchange: ex });
  }
  await reconcileOrders(ctx, botId, orders.list);          // match on orderLinkId, resolve via /v5/execution/list
  return { reconciled: true };
}
```

```ts
// Tick order: reconcile FIRST, then decide (skip decisions if reconcile failed)
async function tick(ctx: EngineCtx) {
  for (const cfg of await activeConfigs(ctx)) {
    const r = await reconcile(ctx, cfg.botId);
    if (!r.reconciled) continue;      // stale/failed snapshot -> no TP/SL or entry this tick
    await evaluateExitsAndEntries(ctx, cfg);
  }
}
```

```ts
// Append-only discrepancy record
async function logEvent(ctx: EngineCtx, botId: string, symbol: string, kind: string, detail: unknown) {
  await ctx.db.insert(positionEvent).values({ ts: Date.now(), botId, symbol, kind, detail });
}
```

## References
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position) — `/v5/position/list`, the real position state to reconcile to.
- [Bybit V5 — Get Open & Closed Orders](https://bybit-exchange.github.io/docs/v5/order/open-order) — `/v5/order/realtime`, unfilled/partial orders keyed by orderLinkId.
- [Bybit V5 — Get Trade History (executions)](https://bybit-exchange.github.io/docs/v5/order/execution) — `/v5/execution/list`, resolves partial fills and realized PnL.
- [Bybit V5 — Get Order History](https://bybit-exchange.github.io/docs/v5/order/order-list) — closed/cancelled orders when an open order disappears.
- [Bybit V5 — Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — `orderLinkId` client id used as the reconcile match key.
- [Bybit V5 — Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) — HMAC-SHA256 signing, recv_window, polling notes.
- [Drizzle ORM — Insert / upsert](https://orm.drizzle.team/docs/insert) — idempotent reconcile writes via `onDuplicateKeyUpdate`.
- [Drizzle ORM — SQL schema declaration](https://orm.drizzle.team/docs/sql-schema-declaration) — the position + `v3_position_event` tables reconcile reads/writes.
- [Bun — Fetch](https://bun.com/docs/runtime/networking/fetch) — built-in `fetch` used for the signed REST snapshot reads.
