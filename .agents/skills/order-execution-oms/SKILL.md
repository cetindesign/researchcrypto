---
name: order-execution-oms
description: Order execution and an Order Management System (OMS) for Bybit V5 perpetuals in Python — order types (Market, Limit, conditional/stop, TP/SL, reduce-only, post-only), time-in-force (GTC/IOC/FOK/PostOnly), placing/amending/cancelling orders, orderLinkId for client idempotency, partial fills, reject/retry handling with exponential backoff, avoiding duplicate orders on retry, one-way vs hedge position mode, and leverage. Invoke when the user mentions "place/amend/cancel order", "Bybit order", "orderLinkId", "reduce-only", "post-only", "time in force", "stop/conditional order", "TP/SL", "partial fill", "retry/backoff", "duplicate order", "position mode", "hedge mode", "set leverage", "pybit", or "ccxt create_order".
---

# Order Execution & OMS

## When to use this skill
- Placing, amending, or cancelling orders on Bybit V5 (Market, Limit, conditional/stop, TP/SL).
- Choosing time-in-force (GTC/IOC/FOK/PostOnly) and flags (reduce-only, post-only, close-on-trigger).
- Making order submission idempotent so a network retry never doubles a position.
- Handling partial fills, rejects, and rate limits with safe retry/backoff.
- Configuring position mode (one-way vs hedge) and leverage before trading.
- Building the OMS layer that sits between strategy signals and the exchange.

## Core concepts
- **Order types (Bybit V5)**: `Market` (fill now, taker) and `Limit` (rest at a price). Conditional/**stop** orders arm on a `triggerPrice` and then submit as market/limit. **TP/SL** can be attached to a position (Set Trading Stop) or as reduce-only exits.
- **Time-in-force**: `GTC` (rest until filled/cancelled), `IOC` (fill what's possible now, cancel the rest), `FOK` (fill entirely now or cancel), `PostOnly` (maker-only — Bybit cancels the order if it would execute immediately, guaranteeing the maker fee).
- **reduceOnly**: an order that can only shrink/close a position, never flip or increase it. Essential for exits so a stale exit can't accidentally open a new position.
- **closeOnTrigger**: prioritizes closing during volatile/deleverage conditions (may cancel other orders to free margin).
- **orderLinkId**: your client-supplied unique id (≤ 36 chars). It is the backbone of **idempotency** — reuse the same orderLinkId on a retry and Bybit rejects the duplicate instead of placing a second order.
- **Partial fill**: a limit order can fill in pieces; track `cumExecQty` vs `qty`, and reconcile from the order/execution stream, not from your assumption.
- **Position mode**: **one-way** (one net position per symbol, `positionIdx=0`) vs **hedge** (simultaneous long+short, `positionIdx=1` buy-side / `2` sell-side). Orders must carry the matching `positionIdx`.
- **Idempotency vs at-least-once**: the network can drop a *response* after the order was accepted. Retrying blindly risks a duplicate; retrying with the same orderLinkId is safe.

## Bybit / Python specifics
Endpoints (V5, one endpoint serves spot/linear/inverse/option via `category`):
- Place: `POST /v5/order/create` — key params: `category` (`linear` for USDT perps), `symbol`, `side` (`Buy`/`Sell`), `orderType` (`Market`/`Limit`), `qty`, `price`, `timeInForce`, `orderLinkId`, `reduceOnly`, `positionIdx`, `triggerPrice`, `triggerDirection`, `triggerBy`, `takeProfit`, `stopLoss`, `tpTriggerBy`, `slTriggerBy`, `tpslMode`.
- Amend: `POST /v5/order/amend` — change price/qty/trigger by `orderId` or `orderLinkId` (cheaper and less risky than cancel+replace; no loss of queue position semantics vs re-submitting).
- Cancel: `POST /v5/order/cancel`; `POST /v5/order/cancel-all`.
- Attach TP/SL to a position: `POST /v5/position/trading-stop` (`takeProfit`, `stopLoss`, `tpslMode` Full/Partial, `tpSize`/`slSize`, `tpLimitPrice`/`slLimitPrice`).
- Leverage: `POST /v5/position/set-leverage` (`buyLeverage`, `sellLeverage`). Position mode: `POST /v5/position/switch-mode`.
- Batch: `create-batch` / `amend-batch` / `cancel-batch` (up to 10 for linear).

SDKs:
- **pybit** (official): `session.place_order(category="linear", symbol="BTCUSDT", side="Buy", orderType="Limit", qty="0.01", price="60000", timeInForce="PostOnly", orderLinkId=uid, reduceOnly=False, positionIdx=0)`; `session.amend_order(...)`, `session.cancel_order(...)`, `session.set_leverage(...)`, `session.switch_position_mode(...)`.
- **CCXT / CCXT Pro** (`bybit` id): `exchange.create_order(symbol, type, side, amount, price, params={"timeInForce":"PostOnly","reduceOnly":True,"positionIdx":0,"clientOrderId":uid})`. CCXT maps `clientOrderId` → `orderLinkId`; `postOnly=True` and `reduceOnly=True` are unified params.

Key limits/quirks:
- `orderLinkId` ≤ 36 chars and must be unique per account.
- If both `orderId` and `orderLinkId` are sent, Bybit uses `orderId`.
- Round `qty` to `qtyStep`/`minOrderQty` and `price` to `tickSize` from `/v5/market/instrument`, or the order is rejected.
- Rate limits are per-endpoint; headers `X-Bapi-Limit`, `X-Bapi-Limit-Status`, `X-Bapi-Limit-Reset-Timestamp` report your budget.
- Prefer the **private WebSocket order/execution stream** for fill state; REST polling is slower and rate-limited.

Error codes worth special-casing:
- `10006` "Too many visits" — rate limited; back off and retry.
- `10016` INTERNAL_SERVER_ERROR — transient; retry later.
- `10001` param error, `110007` insufficient balance, `110043` leverage not modified, `110017`/duplicate-orderLinkId style rejects — do NOT blindly retry these; they're deterministic.

## Implementation checklist
- [ ] Set position mode and leverage once at startup; treat "not modified" as success.
- [ ] Generate a unique `orderLinkId` per intended order and persist it BEFORE sending.
- [ ] Round qty/price to the instrument's step/tick; reject sub-minimum orders early.
- [ ] Send the order; on timeout/5xx/`10006`/`10016`, retry with the **same** orderLinkId + exponential backoff + jitter.
- [ ] On any retry, first query order status by orderLinkId — if it exists, don't resend.
- [ ] Classify errors: retry transient (network/rate/5xx), never retry deterministic (bad params, insufficient funds, duplicate).
- [ ] Track fills via the WS order/execution stream; reconcile `cumExecQty` for partials.
- [ ] Use `reduceOnly=True` for all exits; carry the correct `positionIdx` in hedge mode.
- [ ] Prefer `amend` over cancel+create when adjusting a resting order's price/qty.

## Do / Don't
**Do**
- Make every order idempotent with a pre-persisted `orderLinkId`.
- Distinguish transient vs permanent errors and only retry the transient ones.
- Add jitter to backoff so parallel bots don't retry in lockstep and re-trigger `10006`.
- Use `PostOnly` when you require the maker fee; expect the order to be cancelled if it would cross.
- Reconcile actual position/fills from the exchange, not from optimistic local state.

**Don't**
- Don't retry a failed submit with a fresh orderLinkId — that's how you get duplicate positions.
- Don't assume a request failed just because the response timed out; check by orderLinkId first.
- Don't send exits without `reduceOnly` — a delayed exit can open an opposite position.
- Don't ignore `qtyStep`/`tickSize` rounding or `minOrderQty`/`minNotional`.
- Don't hammer on `10006`; after repeated rate limits, pause and resume at half speed.

## Common pitfalls
- **Duplicate orders on retry**: the classic double-fill. Fixed only by stable `orderLinkId` + status-check-before-resend.
- **PostOnly surprise cancels**: a PostOnly order that would execute is silently cancelled — poll/subscribe or you'll think it's resting when it's gone.
- **Wrong positionIdx in hedge mode**: order rejected or applied to the wrong side.
- **Partial-fill accounting**: assuming full fill and then over-sizing the opposite exit. Always read `cumExecQty`.
- **Reduce-only rejects**: a reduce-only order larger than the remaining position is capped/rejected; size it to current position.
- **Leverage/mode changes with open positions**: switching position mode requires no open positions/orders on the symbol; `set-leverage` returning "not modified" (110043) is benign.
- **Clock/qty precision**: floats introduce precision drift; format qty/price as strings at the tick/step to avoid rejects.

## Code patterns
Idempotent place-with-retry (pybit-style, provider-agnostic logic):

```python
import time, random, uuid
from pybit.exceptions import InvalidRequestError

TRANSIENT = {"10006", "10016"}  # rate limit / server error

def place_idempotent(session, order, link_id=None, max_retries=3):
    link_id = link_id or f"bot-{uuid.uuid4().hex[:24]}"  # <=36 chars, persist FIRST
    for attempt in range(max_retries + 1):
        try:
            return session.place_order(orderLinkId=link_id, **order)
        except InvalidRequestError as e:
            code = str(getattr(e, "status_code", "") or e.args and e.args[0])
            # already exists? treat as success — the first attempt landed
            existing = session.get_open_orders(
                category=order["category"], symbol=order["symbol"], orderLinkId=link_id
            )
            if existing["result"]["list"]:
                return existing
            if code not in TRANSIENT or attempt == max_retries:
                raise                                   # deterministic -> stop
            time.sleep(min(2 ** attempt, 8) + random.uniform(0, 0.5))  # backoff+jitter
```

Attach reduce-only TP/SL and place a post-only maker entry (CCXT `bybit`):

```python
oid = f"entry-{uuid.uuid4().hex[:24]}"
exchange.create_order("BTC/USDT:USDT", "limit", "buy", 0.01, 60000, params={
    "timeInForce": "PostOnly",   # maker-only, cancels if it would cross
    "positionIdx": 0,            # one-way mode
    "clientOrderId": oid,        # -> orderLinkId, idempotency key
    "takeProfit": 63000, "stopLoss": 58500,
})
# exit is always reduce-only so it can never flip the position:
exchange.create_order("BTC/USDT:USDT", "market", "sell", 0.01, None,
                      params={"reduceOnly": True, "positionIdx": 0})
```

## References
- [Place Order — Bybit V5](https://bybit-exchange.github.io/docs/v5/order/create-order) — all order params: orderType, timeInForce, orderLinkId, reduceOnly, positionIdx, trigger fields.
- [Amend Order — Bybit V5](https://bybit-exchange.github.io/docs/v5/order/amend-order) — modify price/qty/trigger by orderId or orderLinkId.
- [Cancel Order — Bybit V5](https://bybit-exchange.github.io/docs/v5/order/cancel-order) — single cancel; also cancel-all.
- [Set Trading Stop — Bybit V5](https://bybit-exchange.github.io/docs/v5/position/trading-stop) — position TP/SL, tpslMode Full/Partial, trigger-by, limit prices.
- [Switch Position Mode — Bybit V5](https://bybit-exchange.github.io/docs/v5/position/position-mode) — one-way vs hedge and positionIdx.
- [Set Leverage — Bybit V5](https://bybit-exchange.github.io/docs/v5/position/leverage) — buyLeverage/sellLeverage per symbol.
- [Order WebSocket stream — Bybit V5](https://bybit-exchange.github.io/docs/v5/websocket/private/order) — real-time order/fill state incl. cumExecQty and partial fills.
- [Error Codes — Bybit V5](https://bybit-exchange.github.io/docs/v5/error) — 10006, 10016, and reject codes to classify retry vs stop.
- [Rate Limit Rules — Bybit V5](https://bybit-exchange.github.io/docs/v5/rate-limit) — per-endpoint limits and X-Bapi-Limit headers.
- [Instruments Info — Bybit V5](https://bybit-exchange.github.io/docs/v5/market/instrument) — qtyStep, tickSize, minOrderQty for rounding before submit.
- [pybit position module (GitHub)](https://github.com/bybit-exchange/pybit/blob/master/pybit/_v5_position.py) — set_leverage / switch_position_mode signatures.
- [CCXT Bybit reference](https://docs.ccxt.com/exchanges/bybit) — create_order params, postOnly/reduceOnly/positionIdx mapping and clientOrderId → orderLinkId.
