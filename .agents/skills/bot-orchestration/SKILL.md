---
name: bot-orchestration
description: Running MANY trading-bot instances against Bybit — lifecycle (start/stop/pause/restart), process/async isolation, scheduling, resource limits, sharing one exchange connection & a single per-UID rate-limit budget across bots, per-bot state persistence & crash recovery, avoiding conflicting orders on the same symbol, and choosing concurrency (asyncio vs multiprocessing vs Celery/workers). Use when the task involves orchestrating/supervising multiple bots, bot lifecycle or scheduling, "run N bots", process vs async isolation, shared vs dedicated WebSocket/REST connections, Bybit rate-limit budgeting across bots, crash recovery/state persistence, order deduplication or conflicting orders on one symbol, or picking asyncio/multiprocessing/Celery for the runtime.
---

# Bot Orchestration (Many Instances on Bybit)

## When to use this skill
- Designing the supervisor/runtime that starts, stops, pauses, and restarts many bots.
- Deciding asyncio vs multiprocessing vs Celery/workers for the bot fleet.
- Sharing (or isolating) Bybit REST/WebSocket connections and the rate-limit budget.
- Persisting per-bot state and recovering positions/orders after a crash or redeploy.
- Preventing two bots from placing conflicting orders on the same symbol.
- Scheduling periodic bot tasks (rebalances, health checks, funding-time actions).

## Core concepts

**Lifecycle.** Each bot is a state machine: `CREATED → RUNNING → PAUSED → STOPPED` (+ `ERROR`, `RECOVERING`). A supervisor owns transitions. **Pause ≠ stop:** pause halts *new* entries but keeps managing open positions/stops; stop tears down and flushes state. Startup must be **idempotent** — on (re)start a bot reconciles with the exchange (fetch open orders/positions) *before* acting, never assuming a clean slate.

**Concurrency model — pick by workload:**
- **asyncio (single process, event loop):** ideal here. Bot logic is overwhelmingly **I/O-bound** (REST calls, WebSocket streams). One loop runs hundreds of bots as tasks, shares one WebSocket and one HTTP session, and centralizes rate limiting. Weaknesses: one blocking call stalls every bot; a crash kills the whole process; no CPU parallelism (GIL).
- **multiprocessing (one process per bot):** true isolation and fault containment — one bot crashing doesn't take down others; real parallelism for CPU-bound work (heavy indicators, ML inference). Cost: higher memory, harder shared-state/rate-limit coordination (each process has its own connections and budget).
- **Celery / task-queue workers (Redis/RabbitMQ broker):** best for *scheduled, discrete* jobs (periodic rebalance, backtests, batch signal computation) and horizontal scale-out with retries and Celery Beat scheduling. Not a fit for a persistent tick loop or awaiting long-lived positions — Celery can't natively run/await async tasks and isn't built for always-on stateful loops.
- **Pragmatic hybrid:** asyncio event loop(s) for the live trading tick + WebSocket, multiprocessing to isolate a few heavy/CPU-bound or risky strategies, Celery/Beat for periodic maintenance jobs. This mirrors Hummingbot (per-bot container/instance orchestrated by a control API) and Freqtrade (one process per bot, externally supervised).

**Shared vs dedicated connections & the rate-limit budget.** Bybit rate limits are **per UID, per second** (rolling window) — so **all bots on the same API key/account share ONE budget**. If ten bots each fire orders independently you'll blow the limit (`retCode 10006 "Too many visits!"`). Route all REST calls for a UID through **one shared, rate-limited client** (a token-bucket/async semaphore); subscribe **one shared WebSocket** per account and fan out messages to bots (WebSocket messages don't count against REST limits). Use separate sub-account API keys to get *separate* budgets when a strategy needs headroom.

**State persistence & crash recovery.** A bot's authoritative state (intended positions, working orders, cursor/last-processed candle, strategy vars) must survive process death. Persist to durable storage (SQLite/Postgres/Redis) transactionally on every state change. On restart: load state → fetch live orders/positions from Bybit → **reconcile** (adopt/cancel orphans, resume management). Attach a `orderLinkId` (client order id) to every order so you can match exchange orders back to the owning bot after a restart.

**Avoiding conflicting orders on one symbol.** In a unified/one-way account Bybit **nets** all positions on a symbol — two bots trading BTCUSDT fight over one net position and can flatten/reverse each other. Options: (1) **one bot per symbol** (partition the universe); (2) a **symbol lock / arbitration layer** that serializes and merges intents before they hit the exchange; (3) **hedge mode** (separate long/short legs, `positionIdx` 1/2) for opposing strategies; or (4) **sub-account per bot** so each has its own isolated position. Always namespace `orderLinkId` per bot to prevent id collisions and to attribute fills.

**Scheduling.** Align periodic actions to exchange time (funding at 00:00/08:00/16:00 UTC, candle closes). Use `asyncio` timers, APScheduler, or Celery Beat. Guard against overlap (a slow run shouldn't stack) and clock skew (sync to server time; Bybit rejects requests with large `recv_window` drift).

**Resource limits.** Cap per-bot concurrency, memory, and in-flight orders. Backpressure when the shared rate-limit budget is low. In multiprocessing, use cgroups/`ulimit`/container limits so one runaway bot can't starve the host.

## Bybit / Python specifics

**Rate-limit budget management (pybit).** Read the returned headers and back off proactively:
```python
# X-Bapi-Limit               current limit for the endpoint
# X-Bapi-Limit-Status        remaining requests this window
# X-Bapi-Limit-Reset-Timestamp  ms epoch when the window resets
# retCode 10006 / retMsg "Too many visits!"  => you exceeded the limit
```
Order create/cancel/amend and account endpoints have **tighter** limits than public market data; budget them separately. Trading limits can be raised for eligible/institutional UIDs via Bybit — but the per-UID sharing rule stands.

**One shared WebSocket, many consumers (pybit).**
```python
from pybit.unified_trading import WebSocket
ws = WebSocket(testnet=False, channel_type="private",
               api_key=..., api_secret=...)   # ONE private stream per account
ws.order_stream(callback=dispatch)            # fan out to owning bot by orderLinkId
ws.position_stream(callback=dispatch)
# public data: one WebSocket(channel_type="linear") shared across all bots
```
CCXT Pro alternatively provides `watch_*` coroutines with built-in rate limiting and exponential-backoff reconnect if you prefer the unified-exchange abstraction.

**Client order ids for recovery/attribution.**
```python
shared_client.place_order(category="linear", symbol="BTCUSDT", side="Buy",
    orderType="Limit", qty="0.01", price="58000",
    orderLinkId="botA-momentum-000123")   # unique per bot; survives restarts
```
On restart: `get_open_orders(category="linear")` / `get_positions(...)`, then reconcile by `orderLinkId` prefix.

## Implementation checklist
- [ ] Central supervisor owning bot lifecycle state machine (start/stop/pause/restart, ERROR/RECOVERING).
- [ ] Default to a shared asyncio event loop; isolate only CPU-heavy or high-risk strategies in separate processes.
- [ ] ONE rate-limited REST client per UID (token bucket / async semaphore honoring `X-Bapi-Limit-Status`).
- [ ] ONE shared public WebSocket + one private WebSocket per account; dispatch messages to bots.
- [ ] Unique `orderLinkId` namespaced per bot on every order.
- [ ] Persist per-bot state transactionally; on startup, load → fetch live state → reconcile before trading.
- [ ] Symbol arbitration: one-bot-per-symbol, a serialization lock, hedge mode, or sub-accounts — pick one and enforce it.
- [ ] Scheduler (Celery Beat / APScheduler / async timers) for funding-time and periodic jobs, with overlap guards.
- [ ] Health checks + auto-restart with backoff; a global kill switch that halts all bots.
- [ ] Resource caps per bot (in-flight orders, memory, concurrency) with backpressure on low budget.

## Do / Don't
**Do**
- Share one connection and one rate-limit budget per UID; centralize throttling.
- Tag every order with a per-bot `orderLinkId` for post-crash attribution.
- Reconcile against the exchange on startup before issuing any order.
- Partition symbols or arbitrate intents so bots don't fight over a netted position.
- Persist state on every change and make startup idempotent.

**Don't**
- Don't let each bot open its own REST/WS client on a shared key — you'll hit `10006` bans.
- Don't run multiple bots on one symbol in one-way mode without arbitration.
- Don't do blocking/CPU-heavy work inside the shared event loop.
- Don't use Celery for the always-on tick loop or to await open positions.
- Don't assume a clean slate on restart — orphaned orders/positions persist on the exchange.

## Common pitfalls
- **Shared-budget bans:** independent per-bot clients silently multiply request rate → rate-limit ban.
- **Position netting fights:** two bots long/flat the same symbol cancel each other's intent.
- **orderLinkId collisions** across bots make reconciliation ambiguous after a restart.
- **Event-loop stalls:** one synchronous `requests`/`time.sleep`/pandas-ta call freezes all bots — use async or offload to a thread/process.
- **Lost state on redeploy:** in-memory-only state means the bot forgets its open positions and double-trades.
- **Clock skew / recv_window:** unsynced clocks get requests rejected; sync to Bybit server time.
- **Scheduler overlap:** a slow periodic job stacking on itself causes duplicate actions.
- **Reconnect gaps:** WebSocket drops without resubscribe/snapshot-refresh leave stale order/position views.

## Code patterns

Shared async rate-limited REST client (token bucket) for one UID:
```python
import asyncio, time
class RateLimitedClient:
    def __init__(self, http, rate=8, per=1.0):   # ~8 order req/s shared by all bots
        self.http, self.rate, self.per = http, rate, per
        self.tokens, self.ts = rate, time.monotonic()
        self.lock = asyncio.Lock()

    async def call(self, method, **kw):
        async with self.lock:
            now = time.monotonic()
            self.tokens = min(self.rate, self.tokens + (now - self.ts) * self.rate / self.per)
            self.ts = now
            if self.tokens < 1:
                await asyncio.sleep((1 - self.tokens) * self.per / self.rate)
                self.tokens = 0
            else:
                self.tokens -= 1
        return await asyncio.to_thread(getattr(self.http, method), **kw)  # pybit is sync
```

Supervisor lifecycle skeleton (asyncio):
```python
import asyncio
class Supervisor:
    def __init__(self): self.bots, self.tasks, self.killed = {}, {}, False
    async def start(self, bot):
        await bot.recover()                       # load state + reconcile with Bybit
        self.tasks[bot.id] = asyncio.create_task(self._run(bot))
    async def _run(self, bot):
        while not self.killed and bot.state == "RUNNING":
            try: await bot.tick()
            except Exception:
                bot.state = "ERROR"; await bot.persist()
                await asyncio.sleep(5); await bot.recover(); bot.state = "RUNNING"
    def pause(self, bid): self.bots[bid].state = "PAUSED"   # keeps managing positions
    async def stop(self, bid):
        self.bots[bid].state = "STOPPED"; self.tasks[bid].cancel()
    def kill_all(self): self.killed = True                  # global circuit breaker
```

Per-symbol arbitration lock (serialize intents in one process):
```python
symbol_locks = {}
def lock_for(sym): return symbol_locks.setdefault(sym, asyncio.Lock())
async def submit_intent(sym, coro):
    async with lock_for(sym):     # only one bot mutates a symbol's orders at a time
        return await coro
```

## References
- [Bybit V5 — Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — per-UID/second limits, X-Bapi-Limit headers, retCode 10006.
- [Bybit V5 — WebSocket Connect](https://bybit-exchange.github.io/docs/v5/ws/connect) — connection limits, auth, public vs private streams.
- [Bybit — Enhanced API rate limits for institutional traders](https://announcements.bybit.global/article/update-bybit-enhances-api-rate-limits-for-institutional-traders-bltbbbf60de757d074e/) — how eligible UIDs raise trading limits.
- [pybit — Official Bybit Python SDK](https://github.com/bybit-exchange/pybit) — HTTP + WebSocket connectors, unified_trading module.
- [pybit — WebSocket example (explanatory)](https://github.com/bybit-exchange/pybit/blob/master/examples/websocket_example_explanatory.py) — shared-stream subscribe/callback pattern.
- [CCXT Pro Manual](https://github.com/ccxt/ccxt/wiki/ccxt.pro.manual) — watch_* streaming, built-in rate limiting and reconnect backoff.
- [Hummingbot — Documentation](https://hummingbot.org/docs/) — multi-bot/container orchestration, connectors, controllers.
- [Hummingbot API — orchestrate multiple bots](https://github.com/hummingbot/hummingbot-api) — backend API pattern for managing many bot instances.
- [Freqtrade — Documentation](https://www.freqtrade.io/en/stable/) — one-process-per-bot architecture, state persistence, control API.
- [Celery — Task queue for scheduled/background jobs](https://leapcell.io/blog/celery-versus-arq-choosing-the-right-task-queue-for-python-applications) — worker pools, Beat scheduling, and async limitations.
- [Python concurrency: multiprocessing vs concurrent.futures vs asyncio](https://testdriven.io/blog/concurrency-parallelism-asyncio/) — choosing the right model for I/O- vs CPU-bound bot work.
