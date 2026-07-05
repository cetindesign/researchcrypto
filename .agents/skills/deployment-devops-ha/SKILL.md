---
name: deployment-devops-ha
description: Deploy and operate a multi-bot Bybit crypto trading platform reliably in production. Covers Dockerizing Python bots (FastAPI/asyncio), Docker Compose orchestration, config and secret injection, high availability and failover, graceful shutdown that flattens or protects open positions on SIGTERM, crash-safe state recovery, preventing two instances of the same bot (leader election / distributed locks), NTP clock sync for Bybit signature timestamps, CI/CD, and blue-green / rolling deploys. Invoke for "Dockerfile", "docker compose", "deploy the bot", "graceful shutdown", "SIGTERM", "restart open positions", "leader election", "distributed lock", "double-run bot", "clock skew", "timestamp error", "recv_window", "blue-green", "rolling deploy", "systemd service", "Kubernetes", "healthcheck", "state recovery", "failover", or "high availability".
---

# Deployment, DevOps & High Availability for Trading Bots

## When to use this skill
- Writing a `Dockerfile` / `docker-compose.yml` to containerize a Python trading bot.
- Handling `SIGTERM`/restart so open Bybit positions are flattened or protected, not abandoned.
- Ensuring exactly one live instance of a bot runs (avoiding duplicate orders after a deploy or in HA).
- Debugging Bybit `10002 invalid request, timestamp` / `recv_window` errors caused by clock skew.
- Setting up CI/CD, blue-green or rolling deploys, healthchecks, and state recovery after a crash.
- Injecting API keys/secrets without baking them into images or logs.

## Core concepts

**Bot = stateful process.** Unlike a stateless web service, a trading bot holds real money exposure. A careless restart can leave a naked position with no stop-loss, or replay orders. Every operational decision must answer: "If this process dies right now, what happens to open positions and open orders?"

**Single-writer invariant.** For any (bot, account, symbol) there must be **exactly one** process sending orders at a time. Two instances → duplicate/conflicting orders, doubled size, self-trades. This is the #1 outage cause during deploys (old + new both running). Enforce with a **distributed lock / leader election**, not just "we only started one container".

**Graceful shutdown policy.** On `SIGTERM` the bot must, within the grace period, either:
- **Flatten** — market-close all positions and cancel open orders (safest for intraday bots), or
- **Protect** — leave positions but ensure a reduce-only stop-loss / TP order sits on the exchange server-side so the position is covered even with no process running.
Choose per strategy; never just `exit()` with a naked, unstopped position.

**State recovery = reconcile, don't remember.** After any restart, treat the **exchange** as source of truth. Fetch live positions and open orders from Bybit and reconcile against local persisted state (DB/Redis). Never assume in-memory state survived. Idempotent order handling via `orderLinkId` (client order id) prevents double submission.

**Clock sync.** Bybit V5 rejects signed requests whose `timestamp` is outside `recv_window` (default 5000 ms) of server time. Container/host clock drift → intermittent auth failures. Sync host clock via NTP/chrony; optionally offset local time to Bybit server time.

## Bybit / Python specifics

- **Timestamp & recv_window.** Every signed V5 request sends `X-BAPI-TIMESTAMP` (ms) and `X-BAPI-RECV-WINDOW`. Rule: `server_time - recv_window <= timestamp < server_time + 1000`. Fix drift by syncing NTP; if latency is high, raise `recv_window` (e.g. 5000→10000 ms) but do **not** set it huge (masks real clock bugs). `pybit` `HTTP(...)` and CCXT both let you tune this. Check server time with `GET /v5/market/time`.
- **Idempotent orders.** Always set `orderLinkId` (custom client id, unique per intent). On reconnect/retry, resubmitting the same `orderLinkId` is rejected as duplicate → safe retries. Query by it with `GET /v5/order/realtime`.
- **Server-side protection.** Prefer exchange-native stops: set `stopLoss`/`takeProfit` on the position (`POST /v5/position/trading-stop`) or place `reduceOnly` conditional orders. These survive a process crash — a Python-side stop does not.
- **Reconcile on boot.** `GET /v5/position/list` and `GET /v5/order/realtime` (category=linear) to rebuild live state before the strategy loop starts.
- **WebSocket resilience.** Private WS pushes fills/position updates; on reconnect you can miss messages, so re-snapshot via REST after every reconnect. Handle `pong`/heartbeat; pybit auto-reconnects but you must re-sync state.
- **Secrets.** Read `BYBIT_API_KEY`/`BYBIT_API_SECRET` from env or Docker/Compose secrets (mounted at `/run/secrets/...`), never hardcode. Keep testnet and mainnet keys separate; gate mainnet behind an explicit `ENV=prod` flag.

## Implementation checklist
- [ ] Slim, non-root Dockerfile (`python:3.12-slim`, pinned deps, multi-stage if compiling TA-Lib).
- [ ] `STOPSIGNAL SIGTERM`; app installs an `asyncio` signal handler for `SIGTERM`/`SIGINT`.
- [ ] Graceful shutdown coroutine: stop taking new signals → run flatten-or-protect policy → cancel/verify orders → close WS/DB → exit 0. Bound it to the grace period.
- [ ] Set Compose/K8s `stop_grace_period` / `terminationGracePeriodSeconds` longer than worst-case flatten time (e.g. 60s).
- [ ] Distributed lock so only the leader trades (Redis `SET key val NX PX ttl` + renew, or K8s Lease). `ReleaseOnCancel` on shutdown for instant failover.
- [ ] Boot reconciliation: fetch live positions/orders from Bybit, rebuild state, reject stale local assumptions.
- [ ] Persist critical state (open intents, `orderLinkId`s) to Redis/Postgres, not just memory.
- [ ] NTP/chrony on host; monitor drift; alert if `abs(local-serverTime) > 1000ms`.
- [ ] Healthcheck endpoint (`/health`) that fails if WS disconnected or lock lost.
- [ ] Secrets via Docker secrets / env from a secret manager; scrub keys from logs.
- [ ] CI/CD: lint + unit + backtest smoke → build image → push → deploy. Blue-green or rolling with the single-writer lock ensuring the old instance yields before the new one trades.
- [ ] Structured logging + Prometheus metrics (position, PnL, order latency, lock ownership) and alerting.

## Do / Don't
**Do**
- Treat the exchange as the source of truth and reconcile on every start/reconnect.
- Put stops/TPs on Bybit's server so positions are protected even if the bot is down.
- Use a distributed lock; make the new deploy wait for the old instance to release before it trades.
- Sync clocks with NTP and monitor skew against Bybit server time.
- Use unique `orderLinkId`s so retries are idempotent.

**Don't**
- Don't `kill -9` / rely on default 10s Docker grace when a flatten can take longer — you'll orphan positions.
- Don't run two containers of the same bot pointed at the same account without a lock (double fills).
- Don't keep the only stop-loss in Python memory; a crash removes your protection.
- Don't bake API secrets into the image or print them in logs / tracebacks.
- Don't set `recv_window` to minutes to "fix" timestamp errors — fix the clock instead.

## Common pitfalls
- **Deploy overlap double-trading:** rolling update starts the new pod before the old one drains; both hold positions for seconds → duplicate orders. The lock + `preStop`/graceful drain fixes this.
- **Naked position after crash:** OOM-kill (SIGKILL) skips your shutdown handler entirely — so protection must already live on the exchange, not depend on shutdown code running.
- **Clock drift in containers:** the container inherits the host clock; a drifting host → sporadic `timestamp` auth failures that look random. NTP on the host, not inside the container.
- **State desync:** WS reconnect drops a fill message; local state thinks the position is open but it's closed (or vice versa). Always REST-snapshot after reconnect.
- **Lock without TTL renewal:** if the leader holds a lock with a long TTL and dies, failover stalls; if TTL is too short, a GC pause makes it lose leadership mid-trade. Renew at ~1/3 of TTL and design for brief overlap safety.
- **Secrets in image layers:** `COPY .env` bakes creds into a layer forever, even if deleted later.

## Code patterns

Graceful shutdown with flatten-or-protect (asyncio + pybit):
```python
import asyncio, signal
from pybit.unified_trading import HTTP

session = HTTP(api_key=KEY, api_secret=SECRET, recv_window=10_000)  # ms
stop = asyncio.Event()

async def flatten_all(symbol="BTCUSDT"):
    session.cancel_all_orders(category="linear", symbol=symbol)
    pos = session.get_positions(category="linear", symbol=symbol)["result"]["list"]
    for p in pos:
        size = float(p["size"])
        if size > 0:
            side = "Sell" if p["side"] == "Buy" else "Buy"
            session.place_order(category="linear", symbol=symbol, side=side,
                                orderType="Market", qty=str(size), reduceOnly=True)

async def main():
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    await reconcile_state()          # source of truth = exchange
    while not stop.is_set():
        await trade_step()
    await flatten_all()              # or: verify server-side stop is in place
```

Redis leader lock (single-writer guarantee):
```python
import redis, uuid
r = redis.Redis(host="redis")
token, KEY, TTL = str(uuid.uuid4()), "lock:bot:btc", 15  # seconds

def acquire(): return r.set(KEY, token, nx=True, ex=TTL)
def renew():   # run every ~5s; only if we still own it (Lua CAS)
    r.eval("if redis.call('get',KEYS[1])==ARGV[1] then "
           "return redis.call('expire',KEYS[1],ARGV[2]) else return 0 end",
           1, KEY, token, TTL)
def release(): r.eval("if redis.call('get',KEYS[1])==ARGV[1] then "
                      "return redis.call('del',KEYS[1]) else return 0 end", 1, KEY, token)
```

Dockerfile + Compose skeleton:
```dockerfile
FROM python:3.12-slim
RUN useradd -m bot
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=bot:bot . .
USER bot
STOPSIGNAL SIGTERM
CMD ["python", "-m", "bot"]
```
```yaml
services:
  btc-bot:
    build: .
    environment: [ENV=prod]
    secrets: [bybit_key, bybit_secret]
    stop_grace_period: 60s          # long enough to flatten
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 15s
      timeout: 5s
      retries: 3
    depends_on: [redis]
  redis: { image: redis:7 }
secrets:
  bybit_key:    { file: ./secrets/bybit_key }
  bybit_secret: { file: ./secrets/bybit_secret }
```

## References
- [Bybit V5 API — Authentication & recv_window](https://bybit-exchange.github.io/docs/v5/guide) — signing, timestamp, `recv_window` rules and error `10002`.
- [Bybit V5 — Get Server Time](https://bybit-exchange.github.io/docs/v5/market/time) — endpoint to check/offset against server clock.
- [Bybit V5 — Position List](https://bybit-exchange.github.io/docs/v5/position/position-info) — reconcile live positions on boot.
- [Bybit V5 — Set Trading Stop](https://bybit-exchange.github.io/docs/v5/position/trading-stop) — server-side SL/TP that survives a crash.
- [pybit (official Bybit Python SDK)](https://github.com/bybit-exchange/pybit) — `HTTP`/`WebSocket` clients, reconnect behavior.
- [Docker — Dockerfile reference (STOPSIGNAL, HEALTHCHECK)](https://docs.docker.com/reference/dockerfile/) — signal and healthcheck directives.
- [Docker Compose — secrets](https://docs.docker.com/compose/how-tos/use-secrets/) — inject API keys without baking into images.
- [Docker — stop containers / grace period](https://docs.docker.com/reference/cli/docker/container/stop/) — SIGTERM then SIGKILL after timeout.
- [Kubernetes — Pod termination & terminationGracePeriodSeconds](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination) — preStop hooks and graceful drain.
- [Kubernetes — Leader election with Leases](https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/) — single-active-instance pattern; `ReleaseOnCancel`.
- [Kubernetes blog — Simple leader election with Kubernetes and Docker](https://kubernetes.io/blog/2016/01/simple-leader-election-with-kubernetes/) — leader-election sidecar concept.
- [systemd.service manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) — `ExecStart`, `Restart=`, `TimeoutStopSec`, `KillSignal` for non-container deploys.
- [chrony / NTP documentation](https://chrony-project.org/documentation.html) — keep host clock in sync for signature timestamps.
- [Redis — distributed locks (SET NX PX / Redlock)](https://redis.io/docs/latest/develop/use/patterns/distributed-locks/) — enforce the single-writer invariant.
