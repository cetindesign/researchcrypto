---
name: exchange-integration-bybit
description: How to integrate with Bybit's V5 unified API from Python for a trading bot — unified trading account (UTA), REST authentication (API key/secret, HMAC-SHA256 signing, X-BAPI headers, recv_window, timestamp), the official `pybit` SDK (`unified_trading.HTTP`), CCXT / CCXT Pro with id `bybit`, the `category` param (spot/linear/inverse/option), rate limits and IP bans, testnet vs demo trading endpoints, retCode/retMsg error handling, and symbol/precision/tick-size discovery via instruments-info. Invoke when the user mentions Bybit, V5 API, pybit, CCXT bybit, API key signing, HMAC signature, recv_window, "retCode", "10006", rate limit / IP ban, testnet, unified account, category param, tickSize/qtyStep, or wiring an exchange client for orders and market data.
---

# Bybit V5 API Integration (Python)

## When to use this skill
- Wiring up a Bybit REST or WebSocket client in Python (pybit or CCXT).
- Implementing request signing (HMAC-SHA256) or debugging `retCode: 10004` signature errors.
- Choosing between `spot`, `linear`, `inverse`, `option` for a call (the `category` param).
- Handling rate limits, `10006` "Too many visits!", or `403 access too frequent` IP bans.
- Switching between mainnet, testnet, and demo-trading endpoints.
- Discovering a symbol's tick size, qty step, and min order qty before placing orders.

## Core concepts
Bybit **V5** is a single unified API surface for Spot, Derivatives (USDT/USDC perpetual & futures = `linear`, coin-margined = `inverse`) and `option`. You pick the product per request with the `category` parameter rather than switching base URLs.

**Unified Trading Account (UTA):** one account that shares a single margin pool across spot, linear/inverse derivatives and options. Newer accounts are UTA 2.0 by default. `accountType` in balance/asset calls is `UNIFIED` (derivatives + spot) with `FUND` for the funding wallet. Legacy `CONTRACT`/`SPOT` account types only appear on non-upgraded accounts. Always confirm the account is UTA before assuming a shared margin balance.

**Path convention:** `{host}/v5/{module}/{endpoint}`, e.g. `/v5/market/kline`, `/v5/order/create`, `/v5/position/list`, `/v5/account/wallet-balance`.

**Every response envelope** looks like:
```json
{ "retCode": 0, "retMsg": "OK", "result": { ... }, "retExtInfo": {}, "time": 1700000000000 }
```
`retCode == 0` means success. Never assume success from HTTP 200 alone — a 200 can still carry a non-zero `retCode`.

## Bybit / Python specifics

### Base URLs
- Mainnet REST: `https://api.bybit.com` (fallbacks `https://api.bytick.com`).
- Testnet REST: `https://api-testnet.bybit.com` (separate funds/keys from mainnet).
- Demo trading REST: `https://api-demo.bybit.com` (mainnet-like data, virtual funds; needs a demo API key).

### REST authentication (signed endpoints)
Send these headers on private requests:
- `X-BAPI-API-KEY` — your API key
- `X-BAPI-TIMESTAMP` — current Unix time in **milliseconds**
- `X-BAPI-RECV-WINDOW` — validity window in ms (default `5000`)
- `X-BAPI-SIGN` — the HMAC-SHA256 signature (lowercase hex)
- `X-BAPI-SIGN-TYPE` — `2` for HMAC keys

**Pre-sign string** (order matters):
- GET: `timestamp + api_key + recv_window + queryString`
- POST: `timestamp + api_key + recv_window + rawRequestBody` (the exact JSON string you send)

Sign with `HMAC_SHA256(secret, preSignString)` and hex-encode (lowercase). RSA keys are also supported (`X-BAPI-SIGN-TYPE: 1`) but HMAC is the default.

**Timestamp rule:** the server accepts `server_time - recv_window <= timestamp < server_time + 1000`. Keep the host clock NTP-synced; clock drift is the #1 cause of `10002` (invalid timestamp) and `10004` (signature) errors. If drift is unavoidable, raise `recv_window` (e.g. 20000) but do not set it huge — that reopens replay risk.

### pybit (official SDK)
`pip install pybit` (requires Python 3.10+). Wraps signing, retries and WebSockets.
```python
from pybit.unified_trading import HTTP

session = HTTP(testnet=True, api_key=KEY, api_secret=SECRET)
# Prefer demo=True for demo trading account instead of testnet.
session.get_tickers(category="linear", symbol="BTCUSDT")
session.get_instruments_info(category="linear", symbol="BTCUSDT")
session.place_order(category="linear", symbol="BTCUSDT",
                    side="Buy", orderType="Limit", qty="0.01", price="30000")
```

### CCXT / CCXT Pro
`pip install ccxt`. Exchange id is `bybit`. CCXT normalizes symbols to `BTC/USDT` (spot) and `BTC/USDT:USDT` (linear perp).
```python
import ccxt
ex = ccxt.bybit({
    'apiKey': KEY, 'secret': SECRET,
    'options': {'defaultType': 'swap'},  # 'spot' | 'swap' | 'future' | 'option'
})
ex.set_sandbox_mode(True)                # routes to testnet
ex.load_markets()
ex.fetch_ohlcv('BTC/USDT:USDT', '1m', limit=200)
# Pass raw V5 params through the last arg when needed:
ex.fetch_ohlcv('BTC/USDT:USDT', '1m', params={'category': 'linear'})
```
CCXT Pro (bundled in `ccxt.pro`) adds `watch_*` streaming methods over the same `bybit` id. Use pybit or ccxt.pro for production WebSockets — see the `realtime-websocket-streaming` skill.

### category param cheat-sheet
- `spot` — spot pairs.
- `linear` — USDT & USDC perpetuals/futures.
- `inverse` — coin-margined (e.g. BTCUSD).
- `option` — USDC options.
Most market and trade endpoints **require** `category`; passing the wrong one is a common `10001` "params error".

### Rate limits & IP bans
- Trading limits are per-**UID**, per-endpoint, on a rolling 1-second window. Read the response headers `X-Bapi-Limit`, `X-Bapi-Limit-Status` (remaining), and `X-Bapi-Limit-Reset-Timestamp` to self-throttle.
- Exceeding the API rate limit returns `retCode 10006` ("Too many visits!") / `10018`.
- Exceeding raw HTTP frequency returns **HTTP 403 "access too frequent"** = an **IP ban**. Stop all sessions and wait at least **10 minutes**; the ban lifts automatically. Do not hammer through it — retries extend the ban.

### Symbol / precision / tick-size discovery
Call `GET /v5/market/instruments-info` (pybit `get_instruments_info`) once at startup and cache it:
- `priceFilter.tickSize` — minimum price increment (round/quantize prices to this).
- `lotSizeFilter.qtyStep` — minimum qty increment.
- `lotSizeFilter.minOrderQty` / `maxOrderQty` — order size bounds.
- `lotSizeFilter.minNotionalValue` — minimum order value (spot/linear).
Orders violating these are rejected (`10001`/`170137` etc.). Quantize with `Decimal`, never float.

## Implementation checklist
- [ ] Store API key/secret in env/secret manager; never commit them.
- [ ] Build a signed-request helper (timestamp ms, recv_window, HMAC-SHA256 hex) OR use pybit/ccxt so signing is handled.
- [ ] NTP-sync the host clock; set `recv_window` (5000-20000 ms).
- [ ] Select mainnet / testnet / demo base URL from config.
- [ ] Load `instruments-info` at startup; cache `tickSize`, `qtyStep`, `minOrderQty` per symbol.
- [ ] Quantize prices/qty to filters using `Decimal` before every order.
- [ ] Check `retCode == 0` on every response; branch on `retCode`, not HTTP status.
- [ ] Read rate-limit headers and back off; treat HTTP 403 as a 10-minute hard stop.
- [ ] Wrap calls with retry + jittered backoff for transient `10016` (server error) / network errors only.

## Do / Don't
**Do**
- Verify `retCode == 0` and log `retCode`/`retMsg`/`retExtInfo` on failure.
- Sign the exact byte string you transmit (same JSON, same field order) for POST.
- Test against testnet/demo before touching real funds.
- Cache `load_markets()` / `instruments-info`; refresh periodically, not per call.
**Don't**
- Don't trust HTTP 200 — a non-zero `retCode` still means failure.
- Don't retry through a `403`/IP ban or a `10006` storm; back off first.
- Don't send prices/qty with more precision than `tickSize`/`qtyStep`.
- Don't reuse mainnet keys on testnet (they are separate systems).
- Don't use floats for price/qty math — precision drift causes rejected or wrong-size orders.

## Common pitfalls
- **Clock drift** → `10002`/`10004`. Sync NTP; don't paper over with a giant recv_window.
- **Wrong `category`** → `10001` params error, or silently empty results.
- **Rebuilding the sign string differently from the sent body** (whitespace, key order) → signature mismatch.
- **Assuming UTA margin on a non-upgraded account** → balances split across `CONTRACT`/`SPOT`.
- **Float precision** on `qty`/`price` → order rejected or off-by-a-tick fills.
- **Ignoring rate-limit headers** until a 403 ban stops the whole bot.

## Code patterns
Manual signed GET (no SDK), useful to understand or debug signing:
```python
import time, hmac, hashlib, requests

KEY, SECRET = "...", "..."
BASE = "https://api-testnet.bybit.com"
recv_window = "5000"

def signed_get(path, params: dict):
    ts = str(int(time.time() * 1000))
    query = "&".join(f"{k}={v}" for k, v in params.items())
    pre_sign = ts + KEY + recv_window + query
    sign = hmac.new(SECRET.encode(), pre_sign.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-BAPI-API-KEY": KEY,
        "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-RECV-WINDOW": recv_window,
        "X-BAPI-SIGN": sign,
        "X-BAPI-SIGN-TYPE": "2",
    }
    r = requests.get(f"{BASE}{path}?{query}", headers=headers, timeout=10)
    data = r.json()
    if data.get("retCode") != 0:
        raise RuntimeError(f"Bybit error {data['retCode']}: {data['retMsg']}")
    return data["result"]
```
Quantizing to instrument filters:
```python
from decimal import Decimal, ROUND_DOWN

def quantize(value: str | float, step: str) -> Decimal:
    v, s = Decimal(str(value)), Decimal(step)
    return (v / s).to_integral_value(rounding=ROUND_DOWN) * s
# price = quantize(30000.12345, tickSize); qty = quantize(0.0137, qtyStep)
```

## References
- [Bybit V5 Introduction](https://bybit-exchange.github.io/docs/v5/intro) — product scope, UTA overview, path convention.
- [Bybit V5 Integration Guidance (auth & signing)](https://bybit-exchange.github.io/docs/v5/guide) — X-BAPI headers, HMAC pre-sign string, recv_window/timestamp rules.
- [Bybit V5 Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — per-UID limits, response headers, 403 IP-ban behavior.
- [Bybit V5 Error Codes](https://bybit-exchange.github.io/docs/v5/error) — retCode meanings (10001/10002/10004/10006/10016/10018…).
- [Bybit V5 Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — priceFilter.tickSize, lotSizeFilter.qtyStep, minOrderQty.
- [Bybit V5 Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — order params by category.
- [Bybit V5 Demo Trading Service](https://bybit-exchange.github.io/docs/v5/demo) — demo endpoints and limitations vs testnet.
- [pybit (official Python SDK)](https://github.com/bybit-exchange/pybit) — unified_trading.HTTP / WebSocket usage and examples.
- [pybit on PyPI](https://pypi.org/project/pybit/) — install, version, Python 3.10+ requirement.
- [CCXT documentation](https://docs.ccxt.com/) — unified methods, params passthrough, sandbox mode.
- [CCXT bybit implementation](https://github.com/ccxt/ccxt/blob/master/python/ccxt/bybit.py) — how CCXT maps unified calls onto V5.
