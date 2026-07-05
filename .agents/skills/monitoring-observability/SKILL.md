---
name: monitoring-observability
description: Observability for a multi-bot Bybit crypto trading platform in Python/FastAPI/asyncio. Covers Prometheus metrics (order-submit/fill latency histograms, fill rate, WebSocket disconnects/reconnects, Bybit API error rate and rate-limit usage, realized/unrealized PnL, position and exposure gauges, per-bot heartbeat), the prometheus_client and prometheus-fastapi-instrumentator libraries, Grafana dashboards, alerting with Alertmanager and Grafana Alerting routed to Telegram/Discord/PagerDuty (stuck/silent bot, drawdown breach, WS disconnect, high error rate, PnL anomaly), structured JSON logging with structlog and correlation/trace IDs, distributed tracing with OpenTelemetry, SLIs/SLOs/error budgets and burn-rate alerts, and health/readiness/liveness probes. Invoke when the task mentions metrics, Prometheus, Grafana, dashboard, alert, Alertmanager, /metrics, counter/gauge/histogram, heartbeat, dead-man switch, drawdown alert, latency, structured logs, structlog, tracing, OpenTelemetry, span, SLO, error budget, health check, liveness, or readiness.
---

# Monitoring & Observability

## When to use this skill
- Instrumenting bots or the FastAPI API with Prometheus metrics (order latency, fill rate, WS disconnects, API errors, PnL, heartbeat).
- Designing Grafana dashboards for trading health and PnL.
- Writing alert rules (Alertmanager / Grafana Alerting) and routing to Telegram/Discord/PagerDuty.
- Adding structured logs, correlation IDs, or OpenTelemetry tracing.
- Defining SLIs/SLOs and burn-rate alerts, or adding health/readiness/liveness endpoints.
- Diagnosing a "bot went silent", "orders are slow", or "we didn't get alerted" incident.

## Core concepts
The **three pillars**: metrics (aggregatable numbers over time), logs (discrete structured events), traces (causal spans across services). For trading you also need a **dead-man's-switch / heartbeat**: proof each bot is *alive and acting*, not just that the process is up.

Prometheus metric types:
- **Counter** — monotonically increasing (orders submitted, API errors, WS reconnects). Query rate with `rate()`/`increase()`.
- **Gauge** — value that goes up/down (open positions, current exposure, unrealized PnL, queue depth, last-heartbeat-age).
- **Histogram** — bucketed distribution (order round-trip latency); gives you `_bucket`, `_sum`, `_count` and lets you compute p50/p95/p99 with `histogram_quantile()`.
- **Summary** — client-side quantiles; prefer histograms so you can aggregate across instances.

Prometheus **pulls** (scrapes) a `/metrics` endpoint on an interval. Labels create separate time series — keep cardinality low (label by `bot_id`, `symbol`, `side`, `result`; **never** by order_id, timestamp, or raw price).

SRE vocabulary:
- **SLI** = a measured ratio of good/total events (e.g. successful order submits ÷ total).
- **SLO** = target for an SLI over a window (e.g. 99.5% of order submits succeed over 28d).
- **Error budget** = `1 - SLO`; a 99.9% SLO = 0.1% budget. Burn-rate alerts fire when you're spending the budget too fast.

## Python & stack specifics
- **`prometheus_client`** (official): define `Counter/Gauge/Histogram`, expose via `start_http_server(9100)` for worker bots, or mount an ASGI app / `make_asgi_app()` at `/metrics` in FastAPI.
- **`prometheus-fastapi-instrumentator`**: one-liner auto-instrumentation of every route → `http_request_duration_seconds` histogram, request counts, sizes. Add custom metrics alongside it.
- **Multiprocess**: under Gunicorn/Uvicorn workers, set `PROMETHEUS_MULTIPROC_DIR` and use the multiprocess collector, or each worker exposes its own port. Async bots typically each run their own metrics server on a distinct port.
- **Histogram buckets matter**: the default buckets top out around 10s and are HTTP-shaped. For order latency define explicit buckets in **milliseconds→seconds** relevant to Bybit round-trips, e.g. `buckets=(.01,.025,.05,.1,.25,.5,1,2.5,5)`.
- **Heartbeat pattern**: each bot sets a gauge `bot_last_loop_timestamp{bot_id=...}` to `time.time()` every loop; alert on `time() - bot_last_loop_timestamp > N` (dead-man's switch). This catches a hung asyncio loop that a liveness probe would miss.
- **WS observability (Bybit V5)**: increment a `ws_disconnects_total{stream="public|private"}` counter on every reconnect; track `ws_last_message_timestamp` gauge — Bybit sends heartbeat/ping frames (~20s), so a stale timestamp means a silent stall even if TCP is up.
- **API error/rate-limit**: label a counter by Bybit `retCode` (e.g. `10006` rate limit, `10016` server error); read the `X-Bapi-Limit-Status`/limit headers and export remaining-quota as a gauge to alert *before* you get banned.
- **PnL & exposure**: export `unrealized_pnl`, `realized_pnl_total`, `position_notional`, and `account_equity` gauges (poll Bybit position/wallet endpoints) so drawdown and exposure alerts are metric-driven.
- **structlog**: JSON renderer + `contextvars` to bind `request_id`/`trace_id`/`bot_id` on every line. Correlate logs↔traces by putting the OTel trace_id into the log context.
- **OpenTelemetry Python**: `TracerProvider` + OTLP exporter; auto-instrument FastAPI/httpx; create manual spans around the order lifecycle (signal → risk check → submit → ack → fill). Propagate context into async tasks.
- **Grafana + Alertmanager**: Grafana Alerting mirrors Prometheus alerting and can hand off to Alertmanager for routing/grouping/silencing. Use `for:` to require the condition to hold before firing (kills flapping). Route by severity to Telegram/Discord (webhook contact points) and page for criticals.

## Implementation checklist
- [ ] Expose `/metrics` on the API (instrumentator) and a metrics port per bot (`prometheus_client`).
- [ ] Define core metrics: `order_submit_latency_seconds` (Histogram), `orders_total{result}`, `fills_total`, `order_fill_ratio` (or derive), `ws_disconnects_total`, `ws_last_message_timestamp`, `bybit_api_errors_total{retCode}`, `bybit_ratelimit_remaining`, `unrealized_pnl`, `realized_pnl_total`, `account_equity`, `position_notional{symbol}`, `bot_last_loop_timestamp{bot_id}`.
- [ ] Choose explicit latency buckets sized to real Bybit round-trips; keep label cardinality low.
- [ ] Configure Prometheus scrape targets + retention; add recording rules for p95 latency and PnL rollups.
- [ ] Build Grafana dashboards: per-bot heartbeat/status, order latency p50/p95/p99, fill rate, WS health, API error rate, equity/drawdown curve, exposure.
- [ ] Write alerts with `for:` durations: bot heartbeat stale, drawdown/equity breach, WS disconnect storm, API error-rate spike, rate-limit near exhaustion, no fills while orders submitted.
- [ ] Route alerts by severity via Alertmanager/Grafana to Telegram/Discord + a pager for criticals; test each route.
- [ ] Add structured JSON logging with correlation/trace IDs; ship to Loki/ELK.
- [ ] Add OpenTelemetry tracing over the order lifecycle; correlate trace_id into logs.
- [ ] Define SLIs/SLOs (order-submit success %, submit latency p95, WS uptime) and add multi-window burn-rate alerts.
- [ ] Add `/healthz` (liveness) and `/readyz` (readiness: DB, Bybit connectivity, WS subscribed) probes.

## Do / Don't
**Do**
- Instrument the **outcome** of trading actions (fills, PnL, rejects), not just HTTP metrics.
- Use histograms for latency and `histogram_quantile()` for p95/p99 across instances.
- Add a heartbeat/dead-man's-switch per bot and alert on staleness — the #1 way to catch a stuck bot.
- Alert on *rates* and *symptoms* (drawdown, no-fills, error-rate) with `for:` to avoid flapping.
- Watch Bybit rate-limit headers and alert before exhaustion.

**Don't**
- Don't label metrics with unbounded values (order_id, price, timestamp) — cardinality explosion kills Prometheus.
- Don't rely on process-up liveness to know a bot is trading — a hung async loop still "runs".
- Don't page on everything; over-alerting causes fatigue and missed real incidents.
- Don't log secrets/API keys or full order payloads with keys into your log pipeline.
- Don't use client-side Summary quantiles when you need cross-instance aggregation — use Histogram.

## Common pitfalls
- **Silent WS stall**: TCP stays open but no messages arrive; only a `ws_last_message_timestamp` staleness check catches it.
- **Default histogram buckets** are HTTP-shaped and hide sub-100ms order latency — define your own.
- **Cardinality bombs** from per-symbol × per-side × per-bot × per-retCode labels — budget your dimensions.
- **Flapping alerts** without a `for:` pending period spam the channel and get muted.
- **Scrape gap = fake outage**: if the bot's metrics port dies you lose visibility; pair metric alerts with an `up == 0` / `absent()` alert.
- **Multiprocess metrics** double-counting or missing when `PROMETHEUS_MULTIPROC_DIR` isn't set under multiple workers.
- **Clock-based heartbeat** breaks if bot and Prometheus clocks drift — keep hosts NTP-synced.

## Code patterns
```python
# Core trading metrics (prometheus_client) exposed on a per-bot port.
from prometheus_client import Counter, Gauge, Histogram, start_http_server
import time

ORDER_LATENCY = Histogram("order_submit_latency_seconds",
    "Signal->ack latency", ["symbol", "side"],
    buckets=(.01, .025, .05, .1, .25, .5, 1, 2.5, 5))
ORDERS   = Counter("orders_total", "Orders by result", ["result"])   # ok|reject|error
WS_DROPS = Counter("ws_disconnects_total", "WS reconnects", ["stream"])
UPNL     = Gauge("unrealized_pnl", "Unrealized PnL (USDT)")
HEARTBEAT= Gauge("bot_last_loop_timestamp", "Epoch of last loop", ["bot_id"])

start_http_server(9101)                       # Prometheus scrapes :9101/metrics

def trade_loop(bot_id, bybit):
    while True:
        with ORDER_LATENCY.labels("BTCUSDT", "Buy").time():
            r = bybit.place_order(category="linear", symbol="BTCUSDT",
                                  side="Buy", orderType="Market", qty="0.001",
                                  orderLinkId=new_id())
        ORDERS.labels("ok" if r["retCode"] == 0 else "reject").inc()
        HEARTBEAT.labels(bot_id).set(time.time())   # dead-man's switch
```

```yaml
# Prometheus alert rules — stuck bot, drawdown, WS storm, down target.
groups:
- name: trading
  rules:
  - alert: BotHeartbeatStale
    expr: time() - bot_last_loop_timestamp > 60
    for: 1m
    labels: {severity: critical}
    annotations: {summary: "Bot {{ $labels.bot_id }} silent >60s"}
  - alert: DrawdownBreach
    expr: (max_over_time(account_equity[1d]) - account_equity)
          / max_over_time(account_equity[1d]) > 0.10
    for: 2m
    labels: {severity: critical}
    annotations: {summary: "Intraday drawdown >10%"}
  - alert: WSDisconnectStorm
    expr: increase(ws_disconnects_total[5m]) > 3
    for: 0m
    labels: {severity: warning}
  - alert: MetricsTargetDown
    expr: up{job="bots"} == 0
    for: 1m
    labels: {severity: critical}
```

```python
# structlog JSON logs bound with correlation + OTel trace id.
import structlog
structlog.configure(processors=[
    structlog.contextvars.merge_contextvars,
    structlog.processors.add_log_level,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    structlog.processors.JSONRenderer(),
])
log = structlog.get_logger()
structlog.contextvars.bind_contextvars(bot_id="bot-42", request_id=req_id)
log.info("order.submitted", symbol="BTCUSDT", qty=0.001, order_link_id=oid)
```

## References
- [Prometheus Python client (GitHub)](https://github.com/prometheus/client_python) — Counter/Gauge/Histogram, `start_http_server`, multiprocess mode.
- [Prometheus — Metric types](https://prometheus.io/docs/concepts/metric_types/) — when to use counter vs gauge vs histogram.
- [Prometheus — Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/) — `expr`, `for`, labels/annotations.
- [prometheus-fastapi-instrumentator (GitHub)](https://github.com/trallnag/prometheus-fastapi-instrumentator) — auto-instrument FastAPI, custom metrics.
- [Grafana — Configure Alertmanager](https://grafana.com/docs/grafana/latest/alerting/set-up/configure-alertmanager/) — routing/grouping and Alertmanager hand-off.
- [Grafana — Alert rules](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/) — building rules, evaluation, pending periods.
- [OpenTelemetry Python](https://opentelemetry.io/docs/languages/python/) — SDK setup, exporters, auto-instrumentation.
- [OpenTelemetry Python — Instrumentation](https://opentelemetry.io/docs/languages/python/instrumentation/) — TracerProvider, spans, context propagation.
- [structlog — Standard library integration](https://www.structlog.org/en/stable/standard-library.html) — JSON rendering, contextvars, processors.
- [Google SRE — Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) — SLI/SLO definitions.
- [Google SRE — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) — multi-window burn-rate alerting.
- [Google SRE — Error Budget Policy](https://sre.google/workbook/error-budget-policy/) — using error budgets to gate releases.
- [Bybit V5 — WebSocket connect](https://bybit-exchange.github.io/docs/v5/ws/connect) — heartbeat/ping, reconnect, public vs private streams.
