---
name: exchange-integration-bybit
description: How to call Bybit's V5 signed REST API from TypeScript on Bun for this trading platform — build requests with `fetch`, sign them with HMAC-SHA256 (X-BAPI-API-KEY, X-BAPI-SIGN, X-BAPI-TIMESTAMP, X-BAPI-RECV-WINDOW, X-BAPI-SIGN-TYPE:2), where the pre-sign string is timestamp+apiKey+recvWindow+queryString (GET) or timestamp+apiKey+recvWindow+rawBody (POST). Covers the Unified Trading Account (UTA), the `category` param (linear/spot), retCode/retMsg handling (200 != success), rate-limit headers, HTTP 403 IP bans and retCode 10006, testnet vs demo endpoints, and decrypting per-user API keys (AES-256-GCM) out of MySQL at call time. Invoke when the user mentions Bybit, V5 API, signing/HMAC, X-BAPI headers, recv_window, retCode, 10006/10002/10004, IP ban, testnet/demo, category, UTA, or wiring a Bybit REST client in TS/Bun. No pybit/CCXT — plain `fetch` + Bun/Web Crypto.
---

# Bybit V5 REST Integration (TypeScript / Bun)

## When to use this skill
- Adding or debugging a signed Bybit V5 REST call (positions, orders, wallet, instruments) in the engine.
- Implementing the HMAC-SHA256 pre-sign string and X-BAPI headers, or chasing a `10004` signature / `10002` timestamp error.
- Deciding `category` (`linear` vs `spot`) for a request, or handling `retCode`/`retMsg`.
- Handling rate-limit headers, `retCode 10006` "Too many visits!", or an HTTP 403 IP ban.
- Switching between mainnet, testnet, and demo-trading base URLs.
- Loading a user's AES-256-GCM-encrypted API key/secret from MySQL and using it to sign a request.

## Core concepts
Bybit **V5** is a single unified REST surface. You select the product per request with the `category` parameter (`linear` = USDT/USDC perpetuals, `spot` = spot; this platform is derivatives-first so calls are almost always `category: "linear"`). Path convention is `{host}/v5/{module}/{endpoint}`, e.g. `/v5/market/kline`, `/v5/order/create`, `/v5/position/list`, `/v5/account/wallet-balance`.

Every response is the same envelope:
```json
{ "retCode": 0, "retMsg": "OK", "result": { ... }, "retExtInfo": {}, "time": 1700000000000 }
```
`retCode === 0` means success. **A 200 can still carry a non-zero `retCode`** — always branch on `retCode`, never on the HTTP status alone.

**Unified Trading Account (UTA):** one account shares a single margin pool across spot and derivatives; balance/asset calls use `accountType: "UNIFIED"`. This platform assumes UTA accounts.

## Codebase specifics (Bybit / Bun / this platform)
- **Runtime is Bun, language is TypeScript (strict).** Use the global `fetch` and either `Bun.CryptoHasher` or Web Crypto (`crypto.subtle`) for HMAC. Do **not** reach for pybit/CCXT — the engine owns its thin signed-request helper. (CCXT/`bybit-api` exist as optional references only; the codebase does not use them.)
- **Keys live encrypted in MySQL.** Exchange API key/secret are stored **AES-256-GCM encrypted** per user. Decrypt them at call time (via `node:crypto`), sign, and discard the plaintext — never log it, never persist plaintext, never cache it longer than the request. Read them through Drizzle.
- **This is the exchange side of the reconcile pattern.** The v3 Bybit engine runs every 10s: it calls signed REST to fetch **real** positions, treats the exchange as the source of truth, and reconciles the DB ledger to it. Closes/entries are **MARKET** orders. Keep this module as the "dirty shell" — pure decision math belongs in `packages/`, not inline here.
- **Signed request headers** (private endpoints):
  - `X-BAPI-API-KEY` — the decrypted API key
  - `X-BAPI-TIMESTAMP` — `Date.now()` (Unix ms)
  - `X-BAPI-RECV-WINDOW` — validity window in ms (default `"5000"`)
  - `X-BAPI-SIGN` — the HMAC-SHA256 signature, lowercase hex
  - `X-BAPI-SIGN-TYPE` — `"2"` (HMAC keys)
- **Pre-sign string (order matters):**
  - GET: `timestamp + apiKey + recvWindow + queryString` (the exact query you put on the URL, same key order)
  - POST: `timestamp + apiKey + recvWindow + rawBody` (the exact JSON string you send in the body)
  Sign that string with `HMAC_SHA256(secret, preSign)` and hex-encode lowercase.
- **Timestamp rule:** the server accepts `server_time - recvWindow <= timestamp < server_time + 1000`. Container clock drift is the #1 cause of `10002` (invalid timestamp) and `10004` (sign error). Keep the host clock synced; if drift is unavoidable, raise `recvWindow` moderately (e.g. `10000`) rather than hugely.
- **Base URLs (from config, not hardcoded):**
  - Mainnet: `https://api.bybit.com`
  - Testnet: `https://api-testnet.bybit.com` (separate keys/funds)
  - Demo trading: `https://api-demo.bybit.com` (needs a demo API key; mainnet-like data, virtual funds)
- **Public market endpoints** (`/v5/market/*`) need **no** signing — skip the header/signing path for those (see the `market-data-ingestion` skill).

## Implementation checklist
- [ ] Load the user's encrypted key/secret from MySQL via Drizzle; AES-256-GCM decrypt just-in-time.
- [ ] Build a `signedRequest(method, path, params)` helper: `timestamp = Date.now()`, `recvWindow = "5000"`, compute pre-sign, HMAC-SHA256 hex, set the five `X-BAPI-*` headers.
- [ ] For GET, put the query on the URL **and** in the pre-sign string identically; for POST, sign the exact `JSON.stringify(body)` you send.
- [ ] Wrap `fetch` with an `AbortSignal.timeout(...)` (see the `rest-polling-and-rate-limits` skill).
- [ ] Parse JSON, check `retCode === 0`, otherwise throw with `retCode`/`retMsg`/`retExtInfo`.
- [ ] Read `X-Bapi-Limit-Status` / `X-Bapi-Limit-Reset-Timestamp` and back off before you get banned.
- [ ] Treat HTTP 403 as an IP ban: stop hammering, wait, alert.
- [ ] Select mainnet/testnet/demo host from config; never mix keys across environments.
- [ ] Never log the secret or the decrypted plaintext.

## Do / Don't
**Do**
- Branch on `retCode === 0`; log `retCode`/`retMsg`/`retExtInfo` on failure.
- Sign the exact byte string you transmit (same JSON, same query order) for POST/GET.
- Decrypt keys at use and drop the plaintext immediately.
- Test against demo/testnet before touching real funds.
- Pass `category: "linear"` (or `"spot"`) explicitly on every market/trade call.

**Don't**
- Don't trust HTTP 200 — a non-zero `retCode` is still a failure.
- Don't retry through a 403 IP ban or a `10006` storm; back off first.
- Don't reuse mainnet keys on testnet/demo (separate systems).
- Don't rebuild the sign string differently from what you send (whitespace / key order).
- Don't log, cache, or persist decrypted secrets.
- Don't add pybit/CCXT/Binance code — this is Bybit-only, plain `fetch`.

## Common pitfalls
- **Clock drift** → `10002`/`10004`. Sync the container clock; don't paper over it with a giant recvWindow.
- **Wrong `category`** → `10001` params error or silently empty results.
- **POST body mismatch:** signing a re-serialized object with different key order/whitespace than the transmitted body → signature mismatch. Serialize once, sign and send the same string.
- **Bun HMAC hasher reuse:** an HMAC `Bun.CryptoHasher` is **not** reset after `.digest()` — create a fresh hasher per signature.
- **Ignoring rate-limit headers** until a 403 ban halts the whole engine loop.
- **Logging secrets** decrypted from the DB — a compliance and security failure.

## Code patterns
Signed request helper (Bun, `fetch` + `Bun.CryptoHasher`):
```ts
const RECV_WINDOW = "5000";

function sign(secret: string, preSign: string): string {
  // HMAC hasher is single-use: build a fresh one per signature.
  return new Bun.CryptoHasher("sha256", secret).update(preSign).digest("hex");
}

export async function signedRequest<T>(
  base: string, apiKey: string, apiSecret: string,
  method: "GET" | "POST", path: string, params: Record<string, unknown> = {},
): Promise<T> {
  const ts = Date.now().toString();
  let url = base + path;
  let body: string | undefined;
  let payload: string; // the part appended to the pre-sign string

  if (method === "GET") {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    payload = qs;
    if (qs) url += `?${qs}`;
  } else {
    body = JSON.stringify(params); // sign & send the SAME string
    payload = body;
  }

  const signature = sign(apiSecret, ts + apiKey + RECV_WINDOW + payload);
  const res = await fetch(url, {
    method,
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 403) throw new Error("Bybit IP ban (403 access too frequent)");
  const data = (await res.json()) as { retCode: number; retMsg: string; result: T };
  if (data.retCode !== 0) throw new Error(`Bybit ${data.retCode}: ${data.retMsg}`);
  return data.result;
}
```

Web Crypto variant of the HMAC (portable alternative to `Bun.CryptoHasher`):
```ts
async function signWebCrypto(secret: string, preSign: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(preSign));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

Decrypt an AES-256-GCM key/secret pulled from MySQL (via Drizzle) at call time:
```ts
import { createDecipheriv } from "node:crypto";

// Stored layout: iv (12B) : ciphertext : authTag (16B), base64-joined.
function decryptSecret(masterKey: Buffer, ivB64: string, ctB64: string, tagB64: string): string {
  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return out.toString("utf8"); // use immediately; do not log or cache
}
```

## References
- [Bybit V5 Integration Guidance (auth & signing)](https://bybit-exchange.github.io/docs/v5/guide) — X-BAPI headers, HMAC pre-sign string, recv_window/timestamp rules.
- [Bybit V5 Introduction](https://bybit-exchange.github.io/docs/v5/intro) — product scope, UTA, path convention, response envelope.
- [Bybit V5 Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — 600 req/5s per IP, per-UID limits, `X-Bapi-Limit*` headers, 403 IP-ban behavior.
- [Bybit V5 Error Codes](https://bybit-exchange.github.io/docs/v5/error) — retCode meanings (10001/10002/10004/10006/10016…).
- [Bybit V5 Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — tickSize, qtyStep, minOrderQty for order sizing.
- [Bybit V5 Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — order params by category (MARKET closes/entries).
- [Bybit V5 Get Position Info](https://bybit-exchange.github.io/docs/v5/position) — real positions the engine reconciles against.
- [Bybit V5 Demo Trading Service](https://bybit-exchange.github.io/docs/v5/demo) — demo endpoints and how they differ from testnet.
- [Bybit V5 HMAC example (official api-usage-examples)](https://github.com/bybit-exchange/api-usage-examples/blob/master/V5_demo/api_demo/Encryption_HMAC.py) — reference pre-sign construction.
- [Bun Hashing docs (CryptoHasher / HMAC)](https://bun.com/docs/runtime/hashing) — `new Bun.CryptoHasher("sha256", key)`, single-use HMAC instances.
- [Bun CryptoHasher reference](https://bun.com/reference/bun/CryptoHasher) — constructor, `update`, `digest("hex")`.
- [MDN SubtleCrypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto) — `importKey` / `sign` for the Web Crypto HMAC path.
- [Node crypto — createDecipheriv](https://nodejs.org/api/crypto.html#cryptocreatedecipherivalgorithm-key-iv-options) — AES-256-GCM decrypt with `setAuthTag` (works under Bun).
- [MDN fetch()](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch) — request options, headers, `signal`.
