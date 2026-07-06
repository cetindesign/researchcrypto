---
name: rest-polling-and-rate-limits
description: How to build the robust POLLING architecture this platform runs on — there is NO WebSocket, so all live data and trading come from periodic signed/public Bybit V5 REST over `fetch` on Bun. Covers interval loops (10s v3 engine, 3m news / 15m calendar scrapers, 2h optimizer, collector snapshots), per-request `fetch` timeouts with AbortController/`AbortSignal.timeout`, exponential backoff with jitter, a shared Bybit rate-limit budget across loops, honoring `X-Bapi-Limit*` headers, handling HTTP 403 IP bans / 429 / retCode 10006, staleness detection, single-flight to avoid overlapping ticks, and graceful shutdown of loops. Invoke when the user mentions polling, interval loop, setInterval, tick, fetch timeout, AbortController, backoff, jitter, rate limit budget, X-Bapi-Limit, 403/429/10006, overlapping ticks, single-flight, staleness, or graceful shutdown — anywhere the codebase's periodic REST loops are involved. NOT WebSocket.
---

# REST Polling & Rate Limits (TypeScript / Bun)

## When to use this skill
- Adding, tuning, or debugging one of the background loops (10s engine, collector, 2h optimizer, 15m calendar, 3m news).
- Adding a per-request `fetch` timeout, or a retry with exponential backoff + jitter.
- Sharing a Bybit rate-limit budget across loops, or reacting to `X-Bapi-Limit*` headers.
- Handling an HTTP 403 IP ban, a 429, or `retCode 10006` "Too many visits!".
- Preventing overlapping ticks (a slow loop iteration re-entering itself) with single-flight.
- Detecting stale data (polls falling behind) and shutting loops down gracefully on SIGTERM.

## Core concepts
This platform is **polling, not event-driven — there is NO WebSocket.** Everything (positions, prices, orders, news, calendar) is periodic REST over Bun's global `fetch`. Correctness therefore lives in the *loop mechanics*: bounded timeouts, backoff, a shared rate-limit budget, and not overrunning yourself. Getting these wrong shows up as IP bans, stalled loops, or duplicated work — not as crashes.

Key primitives:
- **Interval loops** that fire on a cadence (the v3 Bybit engine every 10s; collector price snapshots; optimizer every 2h; calendar scraper 15m; news scraper 3m).
- **Per-request timeout** via `AbortController` / `AbortSignal.timeout(ms)` — a hung socket must not freeze a loop.
- **Backoff + jitter** on transient failures, so many loops don't retry in lockstep.
- **A rate-limit budget** shared across all Bybit callers (the engine, collector, and any backfill all hit the same IP/UID quota).
- **Single-flight**: never let tick N+1 start while tick N is still running.

## Codebase specifics (Bun / this platform's loops)
- **Runtime is Bun.** `setInterval`/`setTimeout` behave as in Node/the browser; global `fetch` and `AbortSignal.timeout` are available. No extra libraries needed.
- **Six boot loops** start after `ensureSchema`: `collector` (price snapshots), **v3 Bybit engine (every 10s)**, `optimizer` (2h), calendar scraper (15m), news scraper (3m, Gemini sentiment). The Bybit-facing loops (engine, collector, any backfill) all consume the **same** Bybit rate-limit budget — coordinate them.
- **One engine tick is heavy:** read active configs → fetch real positions (signed REST) → reconcile DB → check TP/SL/trailing → maybe MARKET close → check layering → maybe MARKET entry through the guards. If a 10s tick takes >10s (slow exchange, backoff), the **next** interval fire must **skip**, not stack — use single-flight.
- **Prefer a self-scheduling loop over raw `setInterval`.** `setInterval` fires on a fixed wall-clock cadence and will queue/overlap if a tick runs long; a `while (running) { await tick(); await sleep(period) }` (or schedule the next `setTimeout` only after the tick resolves) guarantees no overlap. Keep a `running` flag for graceful shutdown.
- **Rate-limit signals to honor:**
  - `X-Bapi-Limit` (your limit for that endpoint), `X-Bapi-Limit-Status` (remaining), `X-Bapi-Limit-Reset-Timestamp` (when it resets). Slow down as remaining approaches 0.
  - Default IP budget is ~600 requests / 5s window; **HTTP 403 "access too frequent" = an IP ban** — stop all Bybit polling, wait, and alert. Retrying through it extends the ban.
  - `retCode 10006` "Too many visits!" (per-UID per-second) and HTTP 429 → back off, don't hammer.
- **Staleness detection:** record `lastSuccessAt` per loop; if `now - lastSuccessAt` exceeds a few intervals, mark the feed stale and (for the engine) refuse to act on stale positions rather than trading on old data.
- **Graceful shutdown:** on SIGTERM/SIGINT (Dokploy redeploys the single container), flip `running = false`, let the in-flight tick finish, clear timers, close the DB pool.

## Implementation checklist
- [ ] Give every `fetch` an `AbortSignal.timeout(...)` (e.g. 10s for Bybit, longer for scrapers).
- [ ] Wrap transient failures in retry with exponential backoff **+ jitter**; cap the delay.
- [ ] Retry only transient errors (network, timeout, 5xx, `retCode 10016`); never retry a 403 ban or a signature error.
- [ ] Make each loop single-flight: skip/queue-of-one if the previous tick is still running.
- [ ] Prefer self-scheduling (`setTimeout` after the tick) over fixed `setInterval` for heavy loops.
- [ ] Read `X-Bapi-Limit-Status` / reset timestamp; throttle before you exhaust the budget.
- [ ] Share one rate-limit budget/gate across all Bybit callers (engine + collector + backfill).
- [ ] On 403: halt Bybit polling, back off (minutes), alert (Telegram) — do not retry through it.
- [ ] Track `lastSuccessAt`; detect staleness and refuse to trade on stale data.
- [ ] Handle SIGTERM/SIGINT: stop loops, drain in-flight tick, clear timers, close resources.

## Do / Don't
**Do**
- Bound every request with a timeout; a hung fetch must not wedge a loop.
- Add jitter to backoff so loops don't synchronize their retries.
- Enforce single-flight so a slow tick can't overlap the next.
- Treat 403 as a hard stop; treat `10006`/429 as "back off now".
- Centralize Bybit throttling so all loops respect one shared budget.

**Don't**
- Don't use a bare `setInterval(fn, 10_000)` for a tick that can exceed 10s — it overlaps.
- Don't retry through a 403 IP ban or re-fire immediately on `10006`.
- Don't retry non-transient errors (bad params, signature, auth).
- Don't let a slow scraper's failures starve or stack behind the engine loop.
- Don't act on stale data because the poll silently fell behind.
- Don't reach for a WebSocket — this platform has none by design.

## Common pitfalls
- **Overlapping ticks:** `setInterval` keeps firing while a tick is still awaiting → concurrent engine turns double-acting on the same position. Fix with single-flight + self-scheduling.
- **No timeout:** one hung Bybit request freezes the whole loop until the OS socket timeout (minutes).
- **Synchronized retries:** all loops back off by the same fixed delay and thundering-herd the exchange at once — add jitter.
- **Ignoring rate-limit headers** until a 403 ban stops every Bybit loop at once.
- **Retrying a ban:** each retry during a 403 extends it — back off first.
- **Trading on stale data:** a silently-failing poll leaves `lastSuccessAt` old; the engine acts on positions that are minutes out of date.
- **Unclean shutdown:** killing mid-tick can leave a half-done reconcile; drain the in-flight tick first.

## Code patterns
Timed fetch + retry with exponential backoff and jitter (transient-only):
```ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(
  url: string, init: RequestInit = {}, { timeoutMs = 10_000, tries = 4 } = {},
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 403) throw new Error("BYBIT_IP_BAN"); // never retry a ban
      if (res.status === 429 || res.status >= 500) throw new Error(`retryable ${res.status}`);
      return res;
    } catch (err) {
      if (String(err).includes("BYBIT_IP_BAN") || ++attempt >= tries) throw err;
      const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1));
      await sleep(backoff + Math.random() * backoff); // full jitter
    }
  }
}
```

Single-flight, self-scheduling loop (no overlap, graceful shutdown):
```ts
function startLoop(name: string, periodMs: number, tick: () => Promise<void>) {
  let running = true;
  let timer: ReturnType<typeof setTimeout>;

  const runOnce = async () => {
    if (!running) return;
    const started = Date.now();
    try {
      await tick(); // awaited fully before the next schedule → no overlap
    } catch (err) {
      console.error(`[${name}] tick failed`, err);
    } finally {
      if (running) {
        const elapsed = Date.now() - started;
        timer = setTimeout(runOnce, Math.max(0, periodMs - elapsed)); // keep cadence, no stacking
      }
    }
  };

  runOnce();
  const stop = () => { running = false; clearTimeout(timer); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return stop;
}
// startLoop("v3-engine", 10_000, engineTick);
```

Shared Bybit rate-limit gate that reacts to response headers:
```ts
let resetAt = 0; // ms epoch when the budget refreshes

async function bybitGate<T>(call: () => Promise<Response>, parse: (r: Response) => Promise<T>): Promise<T> {
  const wait = resetAt - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait)); // respect prior reset hint

  const res = await call();
  const remaining = Number(res.headers.get("X-Bapi-Limit-Status") ?? "1");
  const reset = Number(res.headers.get("X-Bapi-Limit-Reset-Timestamp") ?? "0");
  if (remaining <= 1 && reset) resetAt = reset; // pause the shared budget until reset

  const data = (await parse(res)) as { retCode?: number };
  if (data.retCode === 10006 && reset) resetAt = reset; // "Too many visits!" → hold
  return data as T;
}
```

Staleness guard used by the engine before acting:
```ts
const lastSuccessAt = new Map<string, number>();
function isStale(loop: string, maxAgeMs: number) {
  const last = lastSuccessAt.get(loop);
  return last === undefined || Date.now() - last > maxAgeMs;
}
// if (isStale("v3-engine", 40_000)) return; // don't trade on data >4 ticks old
```

## References
- [Bybit V5 Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — 600 req/5s per IP, `X-Bapi-Limit*` headers, 403 "access too frequent" IP ban.
- [Bybit V5 Error Codes](https://bybit-exchange.github.io/docs/v5/error) — `10006` "Too many visits!", `10016` server error (retryable), `10002` timestamp.
- [Bybit V5 Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) — request rules the polling loops must follow.
- [MDN AbortSignal.timeout()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static) — one-line per-request fetch timeout (TimeoutError).
- [MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) — manual cancellation / combining signals for shutdown.
- [MDN Using the Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) — `signal`, error handling, request options.
- [MDN AbortSignal.any()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static) — combine a timeout signal with a shutdown signal.
- [Bun setInterval reference](https://bun.com/reference/globals/setInterval) — timers under Bun behave like Node/the browser.
- [Bun Web APIs](https://bun.com/docs/runtime/web-apis) — global `fetch`, `AbortController`, timers available on Bun.
- [Bun Blog v1.1.32](https://bun.sh/blog/bun-v1.1.32) — Bun timer/`fetch` behavior and performance notes.
