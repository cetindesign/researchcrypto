---
name: order-execution-oms
description: Order execution against Bybit V5 linear perps in TypeScript (Bun) for the v3 engine's dirty shell — placing maker post-only LIMIT entries (tick-chase-then-abort loop, see maker-execution-cost-control) plus reduce-only MARKET closes, attaching exchange-side disaster stops via stopLoss on create-order and POST /v5/position/trading-stop (filling stop_loss_order_id), signed REST via fetch + HMAC-SHA256 (X-BAPI, recv_window), orderLinkId idempotency, retry/backoff without duplicate orders, one-way vs hedge (positionIdx), set-leverage, qtyStep/tickSize rounding, and audit to v3_decision_log / v3_position_event with the exchange as source of truth (reconcile). Software TP/SL/trailing drives the normal exit; the exchange stop is a crash/tick-delay safety net. Polling only — NO WebSocket order stream. Invoke for place/close order, post-only entry, MARKET close, reduce-only, orderLinkId, reconcile, positionIdx, set leverage, trading stop, stopLoss, stop_loss_order_id, exchange-side stop, HMAC sign Bybit, or OMS.
---

# Order Execution & OMS

## When to use this skill
- Placing a **maker post-only LIMIT entry** (via the tick-chase loop in `maker-execution-cost-control`) or a reduce-only MARKET close against Bybit V5 from the v3 engine shell.
- Attaching an **exchange-side disaster stop** to a new position (`stopLoss` on create-order or `POST /v5/position/trading-stop`) and recording its `stop_loss_order_id`.
- Signing Bybit V5 REST requests in TypeScript (`fetch` + `crypto` HMAC-SHA256, X-BAPI headers).
- Making order submission idempotent so a polling retry or timeout never doubles a position.
- Closing a position when the in-software TP/SL/trailing check trips (normal exit is a reduce-only MARKET close).
- Configuring one-way vs hedge (`positionIdx`) and leverage once at startup.
- Reconciling the DB ledger against real exchange positions and writing `v3_position_event` audit rows.

## Core concepts
- **Maker post-only entries; MARKET only for closes.** Under SkyPower V3 the engine no longer enters with MARKET (taker) — entries are **maker post-only LIMIT** orders placed through a **tick-chase-then-abort** loop (owned by `maker-execution-cost-control`), because taker commission + thin-coin slippage is the #1 cost problem. Avcı may still take on a genuine breakout. **Exits** remain a reduce-only **MARKET** close when the software TP/SL/trailing check trips. This skill owns the *mechanics* (signing, idempotency, retry, reconcile, stop attachment); the maker skill owns the *chase/abort/EV* logic.
- **Three-layer exit, one exchange-side stop.** Normal exit is still **software-driven** (TP/SL/trailing evaluated each ~10s loop → reduce-only MARKET close). In addition, attach an **exchange-side disaster stop** (≈3×ATR) at entry so a crash or tick delay can't leave the position unprotected: set `stopLoss` on the create-order request, or push it with `POST /v5/position/trading-stop`. Persist the returned/derived id into the existing `stop_loss_order_id` column (currently unused). The software stop is primary; the exchange stop is the safety net.
- **reduceOnly for closes.** Every exit carries `reduceOnly: true` so a stale or duplicated close can only shrink/flatten the position — never flip it into an opposite one.
- **orderLinkId = idempotency key.** A client-supplied unique id (≤ 36 chars). Persist it to `v3_decision_log`/`v3_position_event` **before** sending. On any retry, reuse the *same* orderLinkId; Bybit rejects the duplicate instead of placing a second order. This is the backbone of safe retries under a polling architecture.
- **Polling, not streaming.** There is NO WebSocket order/execution stream. Fill state and positions are read with signed REST (`/v5/order/realtime`, `/v5/position/list`). Design around interval polling, timeouts, backoff, and rate-limit budgets — not push events.
- **Exchange = source of truth; DB = ledger.** After acting, read the real position back from Bybit and reconcile the DB to it. Never trust optimistic local state; a timed-out response does not mean the order failed.
- **Position mode.** One-way (`positionIdx: 0`, one net position/symbol) is the platform default; hedge mode uses `1` (buy side) / `2` (sell side). Orders must carry the matching `positionIdx`.
- **Idempotency vs at-least-once.** The network can drop a *response* after Bybit accepted the order. Blind retry → duplicate; retry with the same orderLinkId (and a status check first) → safe.

## Codebase specifics
- **Language/runtime.** TypeScript + Bun. HTTP via `fetch`; signing via `node:crypto` `createHmac` (Bun implements it). No `pybit`, no CCXT (mention only as an optional alternative).
- **Signing (Bybit V5).** Header auth: build `sign = HMAC_SHA256(secret, timestamp + apiKey + recvWindow + queryString|body)` and send `X-BAPI-API-KEY`, `X-BAPI-TIMESTAMP`, `X-BAPI-RECV-WINDOW`, `X-BAPI-SIGN`. API keys are stored **AES-256-GCM encrypted in MySQL** and decrypted in-process per request; never log the secret.
- **Endpoints (category `linear`).** Entry: `POST /v5/order/create` with `orderType: "Limit"`, `timeInForce: "PostOnly"`, tick-aligned `price` (and optionally `stopLoss` to attach the disaster stop at open); close: same endpoint with `orderType: "Market"` + `reduceOnly: true`; cancel a resting maker order between chase steps: `POST /v5/order/cancel`; query: `GET /v5/order/realtime`; positions: `GET /v5/position/list`; exchange-side disaster stop / trailing: `POST /v5/position/trading-stop`; leverage: `POST /v5/position/set-leverage`; mode: `POST /v5/position/switch-mode`.
- **Engine loop order (one ~10s turn):** read active user configs (Drizzle) → fetch real positions (signed REST) → reconcile DB → software TP/SL/trailing check, close with reduce-only MARKET if tripped → layering (katman) adds → if a slot is free and entry-guards/coin-selector pass, place a **maker post-only LIMIT entry** (chase-then-abort, `maker-execution-cost-control`) and attach the exchange-side `stopLoss`. Each step writes `v3_decision_log`; each fill/close writes `v3_position_event`.
- **Audit trail.** `v3_decision_log` = why the engine did (or didn't) act, incl. the guard reason; `v3_position_event` = what happened to the position (open/add/close/reconcile), with the orderLinkId and exchange `orderId`.
- **Rate limits.** Per-endpoint; read `X-Bapi-Limit`, `X-Bapi-Limit-Status`, `X-Bapi-Limit-Reset-Timestamp`. HTTP 403 from Bybit can mean a ~10-minute IP ban — back off hard, don't hammer.
- **Bybit-only.** No Binance execution paths here.

## Implementation checklist
- [ ] Set position mode and leverage once at startup; treat "not modified" (`110043`) as success.
- [ ] Generate + persist a unique `orderLinkId` to `v3_decision_log` BEFORE sending the order.
- [ ] Round `qty` to `qtyStep`/`minOrderQty` and any price to `tickSize`; format as strings; reject sub-minimum.
- [ ] Place the entry as a **post-only LIMIT** with a pre-persisted `orderLinkId`; run the tick-chase/abort loop (`maker-execution-cost-control`) — do NOT cross to MARKET on entry.
- [ ] Attach the exchange-side disaster stop (`stopLoss` on create-order or `POST /v5/position/trading-stop`, ≈3×ATR); persist `stop_loss_order_id`.
- [ ] On timeout / 5xx / `10006` / `10016`, retry with the SAME orderLinkId + backoff + jitter.
- [ ] On any retry, first query `/v5/order/realtime` by orderLinkId — if it exists, do NOT resend.
- [ ] Classify errors: retry transient (network/rate/5xx); never retry deterministic (bad params, insufficient balance, duplicate, post-only "would immediately match").
- [ ] Use `orderType: "Market"` + `reduceOnly: true` for every close; carry the correct `positionIdx`.
- [ ] After acting, fetch `/v5/position/list` and reconcile the DB; write `v3_position_event`.
- [ ] Evaluate TP/SL/trailing in software; close with a reduce-only MARKET order when tripped — the exchange stop is only the safety net.

## Do / Don't
**Do**
- Enter with a **post-only LIMIT** and the tick-chase/abort loop; keep MARKET for closes and forced taker exits only.
- Attach an **exchange-side disaster stop** at open and persist `stop_loss_order_id` as a crash/tick-delay safety net.
- Make every order idempotent with a pre-persisted `orderLinkId`; reuse it on retry.
- Treat the exchange as truth: read positions back and reconcile after each action.
- Distinguish transient vs permanent errors; only retry the transient ones, with jitter.
- Use `orderType: "Market"` + `reduceOnly: true` on all exits and the correct `positionIdx`.
- Poll fill/position state on an interval with timeouts and a rate-limit budget.

**Don't**
- Don't enter with a MARKET (taker) order on the normal path — that is the cost bug SkyPower V3 removes; abort a stuck maker instead.
- Don't skip the exchange-side stop — the software stop dies with the process; the broker stop survives.
- Don't retry a failed submit with a fresh orderLinkId — that is how you get a double position.
- Don't assume a request failed because the response timed out; query by orderLinkId first.
- Don't send a close without `reduceOnly` — a delayed close can open an opposite position.
- Don't ignore `qtyStep`/`tickSize`/`minOrderQty`, or pass floats that drift off the step.
- Don't expect a WebSocket fill event — there is none; reconcile via REST.
- Don't log the decrypted API secret or the signing string.

## Common pitfalls
- **Duplicate orders on retry.** The classic double-fill; fixed only by a stable orderLinkId + status-check-before-resend.
- **Timed-out-but-filled.** A dropped response after acceptance; blindly resending doubles the position. Always reconcile.
- **Reduce-only over-size.** A reduce-only close larger than the remaining position is capped/rejected — size it to the *current* exchange position, not local assumption.
- **Wrong positionIdx.** In hedge mode the wrong index rejects or hits the wrong side.
- **Signature failures.** Mismatched `recv_window`, clock skew, or signing the wrong body/query string → `10004`/auth errors. Use the same serialized body you send, and sync time.
- **Float precision.** JS floats drift; format `qty`/`price` as tick/step-aligned strings before signing.
- **Leverage/mode with open positions.** Switching mode needs no open positions/orders on the symbol; `set-leverage` "not modified" (`110043`) is benign.
- **Rate-limit / IP ban.** Repeated `10006` or an HTTP 403 → pause and resume at half speed; 403 can be a 10-minute ban.

## Code patterns
Signed Bybit V5 POST in TypeScript (Bun `fetch` + `node:crypto`):

```ts
import { createHmac } from "node:crypto";

const BASE = "https://api.bybit.com";
const RECV = "5000";

async function signedPost(path: string, apiKey: string, apiSecret: string, body: Record<string, unknown>) {
  const ts = Date.now().toString();
  const payload = JSON.stringify(body);                         // sign the EXACT body you send
  const sign = createHmac("sha256", apiSecret).update(ts + apiKey + RECV + payload).digest("hex");
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": RECV,
      "X-BAPI-SIGN": sign,
    },
    body: payload,
    signal: AbortSignal.timeout(10_000),                        // polling => always time-box
  });
  return res.json() as Promise<{ retCode: number; retMsg: string; result: any }>;
}
```

Idempotent MARKET order for **closes and the taker fallback** (same orderLinkId, status-check before resend). Entries use the post-only maker path in `maker-execution-cost-control`, not this helper:

```ts
const TRANSIENT = new Set([10006, 10016]);                      // rate limit / server error

async function placeMarketIdempotent(
  key: { apiKey: string; apiSecret: string },
  order: { symbol: string; side: "Buy" | "Sell"; qty: string; reduceOnly?: boolean; positionIdx?: 0 | 1 | 2 },
  orderLinkId: string,                                          // persisted to v3_decision_log BEFORE this call
  maxRetries = 3,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await signedPost("/v5/order/create", key.apiKey, key.apiSecret, {
        category: "linear", orderType: "Market", timeInForce: "IOC",
        positionIdx: 0, ...order, orderLinkId,
      });
      if (r.retCode === 0) return r.result;                     // success
      if (!TRANSIENT.has(r.retCode) || attempt >= maxRetries) throw new Error(`${r.retCode} ${r.retMsg}`);
    } catch (e) {
      // timeout OR transient: did the first attempt actually land? check by orderLinkId
      const q = await signedPost("/v5/order/realtime" as any, key.apiKey, key.apiSecret,
        { category: "linear", symbol: order.symbol, orderLinkId });
      if (q.result?.list?.length) return q.result.list[0];      // it exists — do NOT resend
      if (attempt >= maxRetries) throw e;
    }
    await Bun.sleep(Math.min(2 ** attempt * 250, 4000) + Math.random() * 250); // backoff + jitter
  }
}

// Software-triggered exit is ALWAYS a reduce-only MARKET close:
async function closePosition(key: { apiKey: string; apiSecret: string }, symbol: string, size: string, linkId: string) {
  return placeMarketIdempotent(key, { symbol, side: "Sell", qty: size, reduceOnly: true, positionIdx: 0 }, linkId);
}
```

Attach the exchange-side disaster stop after the entry fills (≈3×ATR), and persist `stop_loss_order_id`:

```ts
// Broker-side safety net: survives an engine crash / tick delay. slPrice is tick-aligned, ~3×ATR from entry.
async function attachDisasterStop(
  key: { apiKey: string; apiSecret: string }, db: DrizzleDb,
  symbol: string, slPrice: string, positionIdx: 0 | 1 | 2 = 0,
) {
  const r = await signedPost("/v5/position/trading-stop", key.apiKey, key.apiSecret, {
    category: "linear", symbol, positionIdx,
    stopLoss: slPrice, slTriggerBy: "MarkPrice", tpslMode: "Full",   // full-position stop
  });
  if (r.retCode === 0) {
    // fill the previously-unused column so reconcile knows a broker stop exists
    await db.update(v3Positions).set({ stopLossOrderId: r.result?.slOrderId ?? `ts:${symbol}` })
      .where(eq(v3Positions.symbol, symbol));
  }
  return r;
}
// Alternatively attach at open: pass `stopLoss: slPrice` directly in the /v5/order/create entry body.
```

Reconcile the DB ledger against the exchange (source of truth) after acting:

```ts
async function reconcile(key: { apiKey: string; apiSecret: string }, symbol: string, db: DrizzleDb) {
  const r = await signedPost("/v5/position/list" as any, key.apiKey, key.apiSecret, { category: "linear", symbol });
  const live = r.result.list.find((p: any) => p.symbol === symbol);
  const size = Number(live?.size ?? 0), avg = Number(live?.avgPrice ?? 0);
  // exchange wins: overwrite the ledger row and append an audit event
  await db.transaction(async (tx) => {
    await tx.update(v3Positions).set({ size, avgPrice: avg }).where(eq(v3Positions.symbol, symbol));
    await tx.insert(v3PositionEvent).values({ symbol, kind: "reconcile", size, avgPrice: avg, at: new Date() });
  });
}
```

## References
- [Bybit V5 — Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — `orderType` Limit/Market, `timeInForce: PostOnly` (maker entry), `stopLoss` at open, `reduceOnly`, `positionIdx`, `orderLinkId`.
- [Bybit V5 — Get Open & Closed Orders](https://bybit-exchange.github.io/docs/v5/order/open-order) — query order status by `orderLinkId` before a retry resend.
- [Bybit V5 — Cancel Order](https://bybit-exchange.github.io/docs/v5/order/cancel-order) — cancel a resting post-only maker order between tick-chase steps; single/all cancel.
- [Bybit V5 — Set Trading Stop](https://bybit-exchange.github.io/docs/v5/position/trading-stop) — exchange-side disaster stop / trailing; `stopLoss`, `slTriggerBy`, `tpslMode`; fills `stop_loss_order_id`.
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position) — `/v5/position/list` fields (`size`, `avgPrice`, `positionIdx`) for reconcile.
- [Bybit V5 — Switch Position Mode](https://bybit-exchange.github.io/docs/v5/position/position-mode) — one-way vs hedge and `positionIdx`.
- [Bybit V5 — Set Leverage](https://bybit-exchange.github.io/docs/v5/position/leverage) — `buyLeverage`/`sellLeverage`; "not modified" `110043` is benign.
- [Bybit V5 — Authentication / Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) — X-BAPI header signing, timestamp + apiKey + recv_window + body.
- [Bybit V5 — Error Codes](https://bybit-exchange.github.io/docs/v5/error) — `10006`/`10016` (retry) vs deterministic rejects (stop).
- [Bybit V5 — Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — per-endpoint budgets and `X-Bapi-Limit` headers; 403 IP ban behavior.
- [Bybit V5 — Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — `qtyStep`, `tickSize`, `minOrderQty` for rounding before submit.
- [Bun — Documentation](https://bun.com/docs) — `fetch`, `node:crypto` HMAC, `Bun.sleep` for backoff in the shell.
- [Drizzle ORM — MySQL get started](https://orm.drizzle.team/docs/mysql/get-started-mysql) — transactional writes to `v3_decision_log` / `v3_position_event`.
