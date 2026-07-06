---
name: monitoring-observability
description: Observability for a single-process, polling, multi-loop Bybit crypto trading platform on Bun + Hono + tRPC + Drizzle/MySQL. Covers Telegram notifications as the platform's alert channel (stuck/silent loop, drawdown breach, reconcile drift, high Bybit error rate, rate-limit exhaustion), a per-loop heartbeat / dead-man's switch using last-tick timestamps for the 6 background loops (collector, v3 Bybit engine, optimizer, calendar scraper, news scraper), the v3_decision_log / v3_position_event audit trail as the primary forensic tool, structured JSON logging in TypeScript with a request/loop correlation id, a Hono /health endpoint reporting per-loop liveness + DB + Bybit reachability, and latency/fill tracking around signed REST round-trips. Prometheus/Grafana are called out as an OPTIONAL future add-on, not the current setup. Invoke when the task mentions monitoring, observability, Telegram alert, heartbeat, dead-man switch, stuck/silent loop, last-tick, drawdown alert, reconcile drift, Bybit error rate, rate limit, health endpoint, /health, liveness, structured logs, correlation id, latency, fill tracking, or "why didn't we get alerted".
---

# Monitoring & Observability

## When to use this skill
- Instrumenting the 6 background loops or the Hono/tRPC API with heartbeats, health checks, and latency tracking.
- Wiring Telegram notifications for operational alerts (silent loop, drawdown, reconcile drift, Bybit error spikes, rate-limit).
- Designing a per-loop dead-man's switch (last-tick timestamp) so a hung loop is detected even though the process is up.
- Using `v3_decision_log` / `v3_position_event` to reconstruct "why did the bot do X" after an incident.
- Adding a `/health` endpoint reporting per-loop liveness + DB + Bybit reachability for Dokploy/uptime checks.
- Diagnosing "a loop went silent", "orders are slow", "reconcile keeps drifting", or "we didn't get alerted".

## Core concepts
This platform is **one Bun process** that on boot starts **6 periodic polling loops** (no WebSocket): `collector`, `v3 Bybit engine` (~10s), `optimizer` (~2h), `calendar scraper` (~15m), `news scraper` (~3m). Observability must answer, per loop: *is it alive, is it on time, is it succeeding, and what did it decide?*

- **Liveness vs "alive and acting"**: the container being up says nothing about a hung loop. You need a **heartbeat / dead-man's switch**: each loop writes `lastTickAt = Date.now()` at the end of every iteration; a watchdog alerts when `now - lastTickAt > expectedInterval * k`.
- **The audit trail is the primary forensic tool.** `v3_decision_log` (every engine decision + the guards that fired) and `v3_position_event` (every open/add/close/reconcile event) let you replay any incident. This is more valuable here than any metrics dashboard — treat it as first-class observability, not just bookkeeping.
- **Symptoms over causes**: alert on *outcomes the operator cares about* — silent loop, drawdown breach, reconcile drift (DB vs exchange mismatch), Bybit error-rate spike, rate-limit near exhaustion — not on every transient error.
- **Staleness detection** replaces WS-disconnect metrics: since everything is polling, "stale" means a loop's last successful tick, or a price snapshot in `collector`, is older than expected.
- **Structured logs** (one JSON object per event, with a `loop` and correlation id) make the process greppable; they complement, not replace, the DB audit trail.

## Codebase specifics (polling loops / Telegram / Hono / this platform)
- **Telegram is the alert channel.** Send via `POST https://api.telegram.org/bot<token>/sendMessage` with `chat_id` + `text` (`parse_mode: "HTML"` for emphasis). Keep a tiny helper with a severity prefix, dedup/rate-limit (Telegram caps ~30 msg/s; you want far fewer), and a cooldown so a flapping condition doesn't spam the channel. Alert-worthy events: silent loop, drawdown breach, reconcile drift, high Bybit `retCode` rate, rate-limit exhaustion, kill-switch toggled, unhandled loop exception.
- **Heartbeat per loop**: keep an in-memory `Map<LoopName, number>` of `lastTickAt`, updated at the end of each iteration, and persist a copy (or a `loop_heartbeat` table) so a restart and the `/health` endpoint can read it. A single watchdog interval compares each loop's age to its expected cadence and fires one Telegram alert (with cooldown) when a loop is silent.
- **Reconcile drift**: the engine's core job is reconciling DB accounting to real Bybit positions. Count how often reconcile has to correct the DB and alert when drift exceeds a threshold in a window — persistent drift means the ledger and exchange disagree (a correctness bug or missed fill).
- **Bybit error/rate-limit tracking**: bucket responses by `retCode` (e.g. `10006` rate limit, `10016`/`10002` server/timestamp) and by HTTP timeout; alert on error-rate over a rolling window. Read Bybit's `X-Bapi-Limit-Status` / limit headers and alert *before* exhaustion so you throttle instead of getting banned.
- **Latency & fills**: wrap each signed REST call and record duration (`Date.now()` deltas) and outcome; log p50/p95-ish rollups per loop. For orders, log request→ack latency and whether the MARKET close/entry actually filled (query back by `orderLinkId`). Persist notable timings to the audit tables for after-the-fact analysis.
- **Structured logging in TS**: a thin JSON logger (or `pino`) writing one object per line with `{ ts, level, loop, corrId, event, ...fields }`. Generate a `corrId` per loop iteration and thread it through so all lines for one engine turn share an id. Never log secrets or raw Bybit responses containing keys.
- **Hono `/health`**: a lightweight GET that returns `200` with each loop's last-tick age, a DB ping, and a cheap Bybit reachability check (e.g. server-time endpoint). Return `503` if any critical loop is stale or the DB is down so Dokploy / an external uptime probe (e.g. UptimeRobot hitting `/health`) can restart or page.
- **Prometheus/Grafana are OPTIONAL and future**: the current stack does not scrape metrics. If richer time-series is wanted later, expose a `/metrics` endpoint and add Prometheus + Grafana as an add-on — but today the heartbeat + Telegram + `v3_decision_log` triad is the system.

## Implementation checklist
- [ ] Per-loop `lastTickAt` heartbeat updated at the end of every iteration; persisted for `/health` and restarts.
- [ ] A single watchdog that compares each loop's age to its expected cadence and Telegram-alerts (with cooldown) on staleness.
- [ ] Telegram helper with severity prefix, per-alert cooldown/dedup, and a hard rate cap.
- [ ] Alerts wired for: silent loop, drawdown breach, reconcile drift over threshold, Bybit error-rate spike, rate-limit near exhaustion, kill-switch toggle, unhandled loop exception.
- [ ] Reconcile-drift counter per window; alert + write the drift detail to `v3_position_event`.
- [ ] Bybit calls bucketed by `retCode`/timeout; rolling error-rate; read + act on rate-limit headers.
- [ ] Latency captured around every signed REST call; order request→ack + fill-confirm logged (by `orderLinkId`).
- [ ] Structured JSON logging with `loop` + `corrId` on every line; no secrets/raw key payloads.
- [ ] `v3_decision_log` / `v3_position_event` capture the guards that fired and before/after state for full replay.
- [ ] Hono `/health` reporting per-loop liveness + DB ping + Bybit reachability; `503` when critical loop stale/DB down.
- [ ] (Optional/future) `/metrics` + Prometheus + Grafana as an add-on — documented, not required now.

## Do / Don't
**Do**
- Give every loop a heartbeat and alert on staleness — the #1 way to catch a hung loop a liveness probe misses.
- Use `v3_decision_log` / `v3_position_event` as the primary forensic record; make sure they capture *why* (guards) and *before/after*.
- Alert on symptoms (silent loop, drawdown, reconcile drift, error-rate) with a cooldown to avoid flapping.
- Watch Bybit rate-limit headers and throttle before exhaustion.
- Thread a correlation id through each engine turn so its logs are reconstructable.

**Don't**
- Don't rely on process-up to know a loop is working — a stuck loop still "runs".
- Don't send a Telegram message per raw error; batch/cooldown or you train operators to mute the channel.
- Don't log secrets, API keys, full session tokens, or raw Bybit responses containing keys.
- Don't treat missing metrics as an outage vs. a stale loop — distinguish "no data" from "bad data".
- Don't build Prometheus/Grafana now if the ask is basic ops visibility — heartbeat + Telegram + audit tables suffice.

## Common pitfalls
- **Silent loop, healthy container**: the process is up, the engine loop is wedged on a hung `fetch`; only a last-tick staleness check catches it — add per-call timeouts.
- **No cooldown → alert spam**: a flapping condition floods Telegram, operators mute it, the real alert is missed.
- **Reconcile drift ignored**: treating drift corrections as routine hides a systematic ledger-vs-exchange bug or a missed fill.
- **Untracked timeouts**: a polling REST call with no timeout blocks the whole loop; count and bound them.
- **Clock drift**: heartbeat ages and Bybit `recvWindow` both depend on a correct clock — keep the container NTP-synced.
- **Audit gaps**: logging the decision but not the guards/outcome, so `v3_decision_log` can't explain an incident.
- **`/health` too shallow**: returning `200` just because the HTTP server answers, while a critical loop is dead — include per-loop liveness.
- **High-cardinality log fields** (raw prices, order ids in every line) bloat logs; keep structured fields bounded and put detail in the audit tables.

## Code patterns
```typescript
// Per-loop heartbeat + a single watchdog that Telegram-alerts on staleness (dead-man's switch).
type LoopName = "collector" | "v3engine" | "optimizer" | "calendar" | "news";
const lastTick = new Map<LoopName, number>();
export const beat = (loop: LoopName) => lastTick.set(loop, Date.now());

const MAX_AGE_MS: Record<LoopName, number> = {
  collector: 60_000, v3engine: 30_000, optimizer: 3 * 3600_000,
  calendar: 20 * 60_000, news: 5 * 60_000,
};
setInterval(() => {
  const now = Date.now();
  for (const [loop, ceiling] of Object.entries(MAX_AGE_MS) as [LoopName, number][]) {
    const age = now - (lastTick.get(loop) ?? 0);
    if (age > ceiling) alert("critical", `Loop ${loop} silent for ${(age / 1000) | 0}s`);
  }
}, 15_000);
```

```typescript
// Telegram alert helper with per-key cooldown so a flapping condition can't spam the channel.
const lastSent = new Map<string, number>();
export async function alert(sev: "info" | "warn" | "critical", text: string, cooldownMs = 300_000) {
  const key = `${sev}:${text}`;
  if (Date.now() - (lastSent.get(key) ?? 0) < cooldownMs) return;
  lastSent.set(key, Date.now());
  const emoji = { info: "ℹ️", warn: "⚠️", critical: "🚨" }[sev];
  await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TG_CHAT, parse_mode: "HTML",
                           text: `${emoji} <b>${sev}</b>: ${text}` }),
  });
}
```

```typescript
// Instrumented signed REST call: latency, retCode bucketing, timeout, structured log.
async function bybitCall(fn: () => Promise<Response>, ctx: { loop: string; corrId: string }) {
  const t0 = Date.now();
  const res = await Promise.race([fn(),
    new Promise<Response>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
  const body = await res.json() as { retCode: number };
  const ms = Date.now() - t0;
  log({ level: body.retCode === 0 ? "info" : "warn", loop: ctx.loop, corrId: ctx.corrId,
        event: "bybit.call", retCode: body.retCode, ms });
  if (body.retCode === 10006) alert("warn", "Bybit rate limit (10006)"); // rate limit hit
  return body;
}
const log = (o: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...o })); // one JSON line per event
```

```typescript
// Hono /health: per-loop liveness + DB + Bybit reachability. 503 if a critical loop is stale.
app.get("/health", async (c) => {
  const now = Date.now();
  const loops = Object.fromEntries(
    [...lastTick].map(([l, ts]) => [l, { ageMs: now - ts, stale: now - ts > MAX_AGE_MS[l] }]));
  const dbOk = await db.execute(sql`select 1`).then(() => true).catch(() => false);
  const bybitOk = await fetch("https://api.bybit.com/v5/market/time")
    .then((r) => r.ok).catch(() => false);
  const healthy = dbOk && !Object.values(loops).some((l) => l.stale && l.critical);
  return c.json({ ok: healthy, loops, dbOk, bybitOk }, healthy ? 200 : 503);
});
```

## References
- [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage) — `sendMessage`, `chat_id`/`text`/`parse_mode`, rate limits.
- [Bybit V5 — Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) — rate-limit headers (`X-Bapi-Limit-Status`), `retCode`s, timestamp/`recvWindow`.
- [Bybit V5 — Introduction](https://bybit-exchange.github.io/docs/v5/intro) — REST base URLs, server-time endpoint for reachability checks.
- [Hono](https://hono.dev/docs) — routing/middleware for the `/health` endpoint on Bun.
- [Bun — Test/runtime docs](https://bun.com/docs) — `setInterval`, `fetch`, and Node-compatible APIs used by the loops/watchdog.
- [pino — Node/Bun JSON logger](https://getpino.io/) — fast structured logging with bindings/correlation fields.
- [Drizzle ORM — MySQL](https://orm.drizzle.team/docs/mysql/get-started-mysql) — DB access for heartbeat/audit tables and the `/health` ping.
- [Google SRE — Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) — framing symptom-based alerting and what to measure.
- [Prometheus — Metric types](https://prometheus.io/docs/concepts/metric_types/) — OPTIONAL future add-on if `/metrics` scraping is introduced.
- [Grafana — Alert rules](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/) — OPTIONAL future dashboards/alerting, not the current setup.
