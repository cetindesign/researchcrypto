---
name: realtime-websocket-streaming
description: How to consume Bybit V5 WebSocket streams robustly in Python — public vs private endpoints, the subscribe/topic model (orderbook.50.BTCUSDT, publicTrade, tickers, kline; private position/order/wallet/execution), the 20-second ping/pong heartbeat and 10-minute idle cutoff, HMAC auth for private WS (expires + "GET/realtime" signature), reconnect-with-resubscribe, maintaining a local orderbook from snapshot+delta with `u`/`seq` update-id gap detection, backpressure/queue handling, and using pybit WebSocket, the `websockets` library, or ccxt.pro. Invoke when the user mentions websocket, WS stream, orderbook delta/snapshot, subscribe topic, ping/pong heartbeat, reconnect/resubscribe, sequence gap, publicTrade, tickers stream, private position/order/execution stream, or real-time market data feeds.
---

# Realtime WebSocket Streaming (Bybit V5, Python)

## When to use this skill
- Building a live feed for orderbook, trades, klines, or tickers.
- Streaming private account events: order, position, wallet, execution updates.
- Implementing reconnect logic that re-authenticates and re-subscribes.
- Maintaining a correct local orderbook from snapshot + delta messages.
- Detecting sequence/update-id gaps and recovering from them.
- Handling ping/pong heartbeats and consumer backpressure.

## Core concepts
Bybit V5 exposes **public** streams (market data, no auth) and **private** streams (account data, auth required). You open a connection, send a `subscribe` op with a list of **topics**, and receive JSON messages. Connections must be kept alive with a **ping every 20 seconds**; an idle connection with no ping-pong and no data is dropped after **10 minutes**.

**Topic model:** `subscribe` with `args` = list of topic strings.
- Orderbook: `orderbook.{depth}.{symbol}` (e.g. `orderbook.50.BTCUSDT`).
- Trades: `publicTrade.{symbol}`.
- Tickers: `tickers.{symbol}`.
- Kline: `kline.{interval}.{symbol}` (e.g. `kline.1.BTCUSDT`).
- Private (no symbol): `position`, `order`, `wallet`, `execution`.

Every data message carries `topic`, `type` (`snapshot` or `delta`), `ts` (ms), and `data`.

## Bybit / Python specifics

### Endpoints
Public (choose by product):
- `wss://stream.bybit.com/v5/public/spot`
- `wss://stream.bybit.com/v5/public/linear`
- `wss://stream.bybit.com/v5/public/inverse`
- `wss://stream.bybit.com/v5/public/option`

Private: `wss://stream.bybit.com/v5/private` (all products; UTA account).
Testnet: replace host with `stream-testnet.bybit.com`.
Demo trading: private stream `wss://stream-demo.bybit.com/v5/private` (public demo data uses the mainnet public streams).

### Heartbeat
Send `{"op": "ping"}` every ~20 s; server replies `{"op":"pong",...}` (or `{"ret_msg":"pong"}`). If using raw `websockets`, run a background ping task; pybit and ccxt.pro handle this internally. Missing pings → the 10-minute cutoff closes the socket.

### Private WS authentication
1. `expires = int(time.time()*1000) + 1000` (a short future ms timestamp).
2. `signature = HMAC_SHA256(secret, "GET/realtime" + str(expires))` → lowercase hex.
3. Send `{"op":"auth","args":[api_key, expires, signature]}`.
4. On the `auth` success ack, send your `subscribe` for private topics.
Re-auth on every reconnect **before** re-subscribing.

### Subscribe / response
```json
{"op": "subscribe", "args": ["orderbook.50.BTCUSDT", "publicTrade.BTCUSDT"]}
```
Ack: `{"success": true, "op": "subscribe", "conn_id": "..."}`. Respect per-connection topic-count limits (spot has a lower cap; split across connections if needed).

### Orderbook snapshot vs delta maintenance
On subscribe you first get a `type:"snapshot"` message that fully seeds the book, then `type:"delta"` messages. `data` contains:
- `b`: bids `[[price, size], ...]`, `a`: asks (same), as **strings**.
- `u`: update id (monotonically increasing per topic).
- `seq`: cross-sequence (use to order/compare messages, esp. across a reconnect).

Rules to maintain a correct book:
- On `snapshot`: **clear** local bids/asks and load the given levels.
- On `delta`: for each `[price, size]`, if `size == "0"` **delete** that price level; otherwise **insert/replace** it. Do not add sizes — deltas are absolute level states.
- `u == 1` marks the first snapshot of a fresh subscription (a service restart re-sends a snapshot with `u` reset). Treat any new `snapshot` as a full reset.
- **Gap detection:** for consecutive deltas on a topic, expect `u` to increase by 1 each message (per the topic's own counter). If `u` jumps unexpectedly, you missed a message → **discard the local book, re-subscribe (or fetch a REST snapshot) and reseed**. Never keep applying deltas onto a book with a detected gap.
- Level-1 quirk: for level-1 feeds a snapshot may be re-pushed after 3 s of no change with the **same `u`** — that is not a gap.

### Depths & push frequency
- Linear/Inverse: `1` (10 ms), `50` (20 ms), `200` (100 ms), `500` (100 ms).
- Spot: `1` (10 ms), `50` (20 ms), `200` (200 ms).
- Option: `25`, `100`.
Pick the shallowest depth that satisfies the strategy — deeper books are heavier and faster to fall behind on.

### Reconnect with resubscribe
Sockets will drop (idle, network, deploys). Build an infinite loop with exponential backoff + jitter that, on every (re)connect: opens the socket, (private) re-auths, re-subscribes **all** topics, and **discards/reseeds** any stateful books. Track subscribed topics in a set so resubscribe is exact. Cap backoff (e.g. 1s→30s) and reset it after a sustained healthy connection.

### Backpressure
The parse/apply work must keep up with 10-20 ms pushes. Read from the socket into an `asyncio.Queue` and process in a separate task; if the queue grows past a bound, drop stale market-data messages or widen the batch — but **never drop private order/execution messages**. A slow consumer that blocks the read loop causes missed pings → disconnect → gap.

### Libraries
- **pybit** (`from pybit.unified_trading import WebSocket`): handles ping, auth, reconnect, and gives per-topic callbacks. Fastest path.
- **ccxt.pro**: `watch_order_book`, `watch_trades`, `watch_ohlcv`, `watch_orders`, `watch_positions` over id `bybit`; maintains the book for you.
- **`websockets`** (raw): full control; you must implement ping, auth, resubscribe, and book maintenance yourself.

## Implementation checklist
- [ ] Choose public product endpoint(s) and/or the private endpoint.
- [ ] Send `{"op":"ping"}` every 20 s (or rely on pybit/ccxt.pro).
- [ ] For private: compute `expires`, sign `"GET/realtime"+expires`, `op:"auth"`, await ack.
- [ ] Subscribe topics; verify the `success:true` ack.
- [ ] On `snapshot`: reset local book; on `delta`: apply, deleting size-0 levels.
- [ ] Track `u` per topic; on an unexpected jump, discard and reseed.
- [ ] Reconnect loop: backoff+jitter → (re-auth) → resubscribe all → reseed books.
- [ ] Decouple socket read from processing via a bounded queue.
- [ ] Never drop private order/execution/position messages under backpressure.

## Do / Don't
**Do**
- Re-authenticate before resubscribing on every private reconnect.
- Treat every `snapshot` as a hard reset of the local book.
- Delete price levels whose delta `size == 0`.
- Reseed from a fresh snapshot after any detected `u` gap.
- Keep the read loop non-blocking so heartbeats stay on time.
**Don't**
- Don't sum delta sizes — a delta is the level's new absolute size.
- Don't keep applying deltas after a sequence gap (silent book corruption).
- Don't rely solely on WS for cold-start history — backfill via REST first.
- Don't let a slow consumer stall the socket (missed pings → disconnect).
- Don't hardcode one topic list in two places; resubscribe from a tracked set.

## Common pitfalls
- **Sequence gaps** from a dropped delta → a book that looks fine but is wrong. Always gap-check `u` and reseed.
- **Forgetting to reset on snapshot** → stale levels linger after a server-side restart.
- **Backpressure** starving the ping task → the 10-minute cutoff fires and you blame "random" disconnects.
- **Auth timing**: subscribing to private topics before the `auth` ack silently returns nothing.
- **Wrong endpoint per product**: linear topics on the spot socket never arrive.
- **Duplicate/partial klines**: use the `confirm` flag on the kline stream to know a candle has closed.

## Code patterns
pybit public orderbook with a maintained local book:
```python
from pybit.unified_trading import WebSocket
from time import sleep

book = {"b": {}, "a": {}}
last_u = None

def on_msg(msg):
    global last_u
    d, mtype = msg["data"], msg["type"]
    if mtype == "snapshot" or d["u"] == 1:
        book["b"].clear(); book["a"].clear()
    elif last_u is not None and d["u"] != last_u + 1:
        # gap: drop and let a re-subscribe/reseed happen
        book["b"].clear(); book["a"].clear()
    for side in ("b", "a"):
        for price, size in d.get(side, []):
            if size == "0":
                book[side].pop(price, None)
            else:
                book[side][price] = size
    last_u = d["u"]

ws = WebSocket(testnet=False, channel_type="linear")
ws.orderbook_stream(depth=50, symbol="BTCUSDT", callback=on_msg)
while True:
    sleep(1)
```
Private stream auth (pybit handles signing internally):
```python
ws = WebSocket(testnet=False, channel_type="private",
               api_key=KEY, api_secret=SECRET)
ws.order_stream(callback=lambda m: print("order", m))
ws.position_stream(callback=lambda m: print("position", m))
ws.execution_stream(callback=lambda m: print("fill", m))
ws.wallet_stream(callback=lambda m: print("wallet", m))
```
ccxt.pro live loop with built-in reconnect:
```python
import ccxt.pro as ccxtpro, asyncio
async def main():
    ex = ccxtpro.bybit({'options': {'defaultType': 'swap'}})
    try:
        while True:
            ob = await ex.watch_order_book('BTC/USDT:USDT', limit=50)
            print(ob['bids'][0], ob['asks'][0])
    finally:
        await ex.close()
asyncio.run(main())
```

## References
- [Bybit V5 WebSocket Connect](https://bybit-exchange.github.io/docs/v5/ws/connect) — endpoints, 20s ping / 10-min cutoff, auth (expires + "GET/realtime" HMAC), subscribe format.
- [Bybit V5 WS Public Orderbook](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook) — depths, push frequency, snapshot/delta, u/seq, size-0 deletes, u=1 reset.
- [Bybit V5 WS Public Trade](https://bybit-exchange.github.io/docs/v5/websocket/public/trade) — publicTrade topic and fields.
- [Bybit V5 WS Public Ticker](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker) — tickers topic, snapshot vs delta behavior.
- [Bybit V5 WS Public Kline](https://bybit-exchange.github.io/docs/v5/websocket/public/kline) — kline.{interval}.{symbol}, confirm flag.
- [Bybit V5 WS Private Order](https://bybit-exchange.github.io/docs/v5/websocket/private/order) — private order stream after auth.
- [Bybit V5 WS Private Execution](https://bybit-exchange.github.io/docs/v5/websocket/private/execution) — fills stream.
- [Bybit V5 Demo Trading Service](https://bybit-exchange.github.io/docs/v5/demo) — demo private WS host.
- [pybit (official Python SDK)](https://github.com/bybit-exchange/pybit) — WebSocket class, *_stream callbacks, internal ping/reconnect.
- [Pybit v5: how to subscribe to WebSocket topics](https://dev.to/kylefoo/pybit-v5-how-to-subscribe-to-websocket-topics-1iem) — practical channel_type/topic subscription walkthrough.
- [CCXT Pro manual](https://docs.ccxt.com/ccxt.pro.manual) — watch_* methods, connection reuse, built-in reconnection.
