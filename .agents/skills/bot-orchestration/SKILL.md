---
name: bot-orchestration
description: The core runtime of this platform — ONE Bun/Docker process that serves the Hono/tRPC web API AND, on boot, starts six polling loops (ensureSchema, collector, v3 Bybit engine @10s, optimizer @2h, calendar scraper @15m, news scraper @3m). Covers loop scheduling with setInterval/timers, single-flight (no overlapping ticks), reading per-user config each tick, a shared Bybit per-UID rate-limit budget across loops, crash recovery via reconcile-on-boot, graceful shutdown on SIGTERM, and WHY this is polling in-process rather than an event bus/message queue (absorbs the event-decoupling topic: when a real queue would or wouldn't help). Use when the task involves the boot sequence, the loop scheduler, overlapping/stacked ticks, setInterval vs setTimeout, sharing the rate-limit budget, reconcile-on-boot, SIGTERM shutdown, single vs multi process, or whether to introduce a message queue.
---

# Bot Orchestration (Single-Process Polling Runtime, Bun + Bybit)

## When to use this skill
- Working on the boot sequence or the six background loops.
- Scheduling a periodic loop, or fixing overlapping/stacked ("re-entrant") ticks.
- Deciding setInterval vs a self-scheduling setTimeout loop.
- Sharing the Bybit per-UID rate-limit budget across loops that all call the exchange.
- Recovering after a crash/redeploy (reconcile-on-boot) or shutting down cleanly on SIGTERM.
- Deciding whether to add a message queue / event bus (and why the answer is usually "no").

## Core concepts

**One process, one container.** The whole backend is a **single Bun process** in one Docker container. It does two things at once: (1) serves the web panel/API over **Hono + tRPC**, and (2) on boot, starts **six long-lived polling loops**. There is no separate worker fleet, no Celery, no external scheduler — the loops are just timers in the same event loop as the HTTP server. Deploy is push-to-`main` → Dokploy rebuilds and restarts this one container.

**The boot sequence (order matters).**
```
boot → ensureSchema()        // idempotent ALTER TABLE — guarantee columns before anything reads/writes
     → reconcileOnBoot()     // adopt real Bybit positions into the DB ledger before trading
     → start HTTP (Hono/tRPC)
     → collector       loop  // price snapshots
     → v3 Bybit engine loop  // every 10s   ← the trading loop
     → optimizer       loop  // every 2h
     → calendar scraper loop // every 15m
     → news scraper     loop // every 3m (Gemini sentiment)
```
`ensureSchema` runs to completion first (no migrations exist; schema is guaranteed here). Then reconcile, then the loops start.

**Loop scheduling — self-scheduling `setTimeout`, not bare `setInterval`.** `setInterval(fn, 10_000)` fires every 10s **regardless of whether the last run finished** — a slow tick (Bybit timeout, DB stall) causes the next one to stack on top, and now two engine ticks race on the same positions. Prefer a **self-scheduling loop**: run the tick, `await` it fully, then schedule the next from the *end* of the run. This guarantees a fixed *gap* between runs and makes overlap structurally impossible. `setInterval` is only acceptable for cheap, idempotent, non-overlapping work.

**Single-flight (no overlapping ticks).** Even with self-scheduling, guard each loop with an `isRunning` flag (a mutex) so a manual trigger or a timer edge can't start a second concurrent run. If a tick is still running when the next is due, **skip** it (log a "tick overrun") rather than queue it. One engine tick must never run while another is live — they'd double-close or double-enter.

**Per-user config read each tick.** The engine is multi-user. It does **not** cache config across ticks — each tick reads the active user configs fresh from the DB (slots, budgets, risk fractions, allowed coins, guard settings) so a change from the panel takes effect on the next tick with no restart. This is the polling equivalent of config hot-reload.

**Shared Bybit rate-limit budget across loops.** Bybit rate limits are **per UID, per second** (rolling window) — and the engine, collector, and optimizer may all hit the exchange for the *same* user's UID. If each loop fires independently you blow the limit (`retCode 10006 "Too many visits!"`, or an HTTP 403 IP ban). Route **all** signed REST for a UID through **one shared, rate-limited client** (a token bucket / async queue) that honors `X-Bapi-Limit-Status` and `X-Bapi-Limit-Reset-Timestamp` and backs off. Order endpoints have tighter limits than market-data — budget them separately. (See the rest-polling-and-rate-limits skill for the client itself.)

**Crash recovery via reconcile-on-boot.** In-memory state does not survive a redeploy, and Dokploy restarts happen often. The authoritative state lives in Bybit (positions) and MySQL (ledger). On every boot, **before** the engine trades: fetch real positions from Bybit, reconcile them into the DB slot state (adopt orphans, book missed closes — see reconcile-source-of-truth / portfolio-management), then start ticking. Never assume a clean slate. Tag orders with a stable `orderLinkId` (e.g. `v3-<slot>-<ts>`) so fills can be matched back to a slot after a restart.

**Graceful shutdown (SIGTERM).** Docker/Dokploy send `SIGTERM` on redeploy, then `SIGKILL` after a grace period. Handle `SIGTERM`: stop scheduling new ticks, let the in-flight engine tick finish (so you never kill mid-order), flush any pending DB writes, then exit. A position opened but not yet written to the ledger because you were `SIGKILL`ed mid-write is exactly what reconcile-on-boot then has to repair — so make writes transactional and shutdown clean.

**Why polling, not an event bus (absorbs event-bus-messaging).** There is deliberately **no Kafka/Redis Streams/NATS and no WebSocket** here. The loops are decoupled **in-process**: each loop owns its cadence and communicates through the **shared MySQL state**, not through messages. The engine reads what the news/calendar scrapers wrote to the DB; it doesn't subscribe to an event. This is simpler, has no broker to run or fail, and gives a single, queryable source of truth (the DB) that survives restarts.
- **When a real queue would NOT help:** at this scale (one container, per-user 10s cadence, low fan-out), a broker adds a moving part, delivery-semantics complexity (at-least-once, idempotent consumers, consumer-group rebalancing), and another thing to reconcile — for zero latency benefit. Polling every 10s is already well within the product's reaction budget.
- **When a real queue WOULD help:** if you outgrow one process — multiple engine instances that must not double-trade a slot (needs distributed locking/leader election), true sub-second reaction to external events, fan-out to many independent consumers, or durable work hand-off across services. Until then, in-process timers + DB-as-bus is the right call. If you do add one, make consumers idempotent (dedupe on `orderLinkId`) and keep the DB as the reconcile anchor.

## Codebase specifics (Bun / Hono / tRPC / this platform)

**Server + loops in one entrypoint.**
```ts
import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./trpc/router";

await ensureSchema();          // idempotent ALTER TABLE — first, always
await reconcileOnBoot();       // adopt real Bybit positions into the DB ledger

const app = new Hono();
app.use("/trpc/*", trpcServer({ router: appRouter }));

startLoop("engine",   engineTick,   10_000);
startLoop("collector", collectorTick, 5_000);
startLoop("optimizer", optimizerTick, 2 * 60 * 60_000);
startLoop("calendar",  calendarTick,  15 * 60_000);
startLoop("news",      newsTick,      3 * 60_000);

export default { port: 3000, fetch: app.fetch }; // Bun serves Hono
```

**Self-scheduling loop with single-flight (the scheduler used by every loop).**
```ts
const running = new Set<string>();

export function startLoop(name: string, tick: () => Promise<void>, gapMs: number) {
  const run = async () => {
    if (running.has(name)) { console.warn(`[${name}] overrun — skipping tick`); }
    else {
      running.add(name);
      try { await tick(); }
      catch (e) { console.error(`[${name}] tick failed`, e); } // one bad tick must not kill the loop
      finally { running.delete(name); }
    }
    if (!shuttingDown) timers.set(name, setTimeout(run, gapMs)); // schedule from END of run
  };
  timers.set(name, setTimeout(run, 0));
}
```

**One engine tick (dirty shell; math lives in the pure core).**
```ts
async function engineTick() {
  const users = await db.select().from(userConfig).where(eq(userConfig.active, true)); // fresh each tick
  for (const u of users) {
    const positions = await rateLimited(u.uid, () => bybitGetPositions(u)); // shared per-UID budget
    await reconcile(u, positions);           // exchange = truth → DB ledger
    await manageStops(u, positions);          // software TP/SL/trailing → reduce-only MARKET
    await maybeLayer(u, positions);           // katman adds within caps
    await maybeEnter(u);                      // free slot + guards (news/calendar/BTC-shock/cooldown)
  }
}
```

**Graceful shutdown.**
```ts
let shuttingDown = false;
process.on("SIGTERM", async () => {
  shuttingDown = true;                                  // stop scheduling new ticks
  for (const t of timers.values()) clearTimeout(t);
  while (running.size) await new Promise((r) => setTimeout(r, 100)); // let in-flight ticks finish
  await db.$client.end?.();
  process.exit(0);
});
```

## Implementation checklist
- [ ] Boot order: `ensureSchema` → `reconcileOnBoot` → HTTP → start loops. Nothing trades before reconcile.
- [ ] Every loop is self-scheduling `setTimeout` (schedule next from end of run), not bare `setInterval`.
- [ ] Single-flight guard per loop; on overrun, **skip** (log), never queue a second concurrent tick.
- [ ] Engine reads per-user config fresh from the DB each tick (no cross-tick cache).
- [ ] All signed Bybit REST for a UID goes through one shared rate-limited client honoring X-Bapi-Limit headers.
- [ ] `orderLinkId` namespaced per slot on every order for post-restart attribution.
- [ ] SIGTERM handler: stop new ticks, drain in-flight tick, flush DB, exit before SIGKILL.
- [ ] A per-loop try/catch so one failing tick can't kill the loop or the process.
- [ ] Keep it single-process; only reach for a queue/leader-election when scaling past one instance.

## Do / Don't
**Do**
- Run ensureSchema and reconcile-on-boot before the first engine tick.
- Self-schedule from the end of each run and guard with single-flight.
- Share one per-UID rate-limit budget across every loop that calls Bybit.
- Read user config fresh each tick so panel changes apply without a restart.
- Drain the in-flight tick on SIGTERM; make DB writes transactional.

**Don't**
- Don't use bare `setInterval` for the engine — slow ticks stack and race positions.
- Don't let two engine ticks run concurrently (double-close / double-enter).
- Don't give each loop its own Bybit client — you'll hit `10006` / a 403 IP ban.
- Don't assume a clean slate on boot — orphaned positions persist on the exchange.
- Don't add Kafka/Redis/NATS "for decoupling" at single-process scale; use the DB as the bus.

## Common pitfalls
- **Tick overrun / stacking:** `setInterval` plus a slow Bybit call → overlapping engine ticks operating on the same slot.
- **Shared-budget bans:** independent per-loop clients multiply request rate → rate-limit ban or HTTP 403 IP ban (~10 min).
- **Boot-before-reconcile:** trading before adopting real positions double-trades a slot that's already open on the exchange.
- **Lost mid-write on SIGKILL:** an order placed but not yet ledgered; only reconcile-on-boot repairs it — keep writes transactional.
- **Stale config:** caching user config across ticks means panel changes silently don't apply.
- **One tick throwing kills the loop:** without per-tick try/catch, one Bybit timeout ends the loop for everyone.
- **Clock skew / recv_window:** an unsynced container clock gets requests rejected by Bybit.
- **Premature queue:** introducing a broker adds delivery-semantics and reconcile complexity with no benefit at this scale.

## Code patterns

Single-flight mutex as a reusable wrapper:
```ts
export function singleFlight<T>(fn: () => Promise<T>) {
  let inflight: Promise<T> | null = null;
  return () => (inflight ??= fn().finally(() => { inflight = null; }));
}
```

Shared per-UID token-bucket gate (all loops await it before a signed call):
```ts
const buckets = new Map<string, { tokens: number; ts: number }>();

export async function rateLimited<T>(uid: string, call: () => Promise<T>,
                                     rate = 8, per = 1000): Promise<T> {
  const b = buckets.get(uid) ?? { tokens: rate, ts: Date.now() };
  const now = Date.now();
  b.tokens = Math.min(rate, b.tokens + ((now - b.ts) * rate) / per);
  b.ts = now;
  if (b.tokens < 1) await new Promise((r) => setTimeout(r, ((1 - b.tokens) * per) / rate));
  b.tokens = Math.max(0, b.tokens - 1);
  buckets.set(uid, b);
  return call(); // on retCode 10006 / 403, back off using X-Bapi-Limit-Reset-Timestamp
}
```

## References
- [Bun — setInterval (globals)](https://bun.com/reference/globals/setInterval) — timer semantics under Bun; basis for the loop scheduler.
- [Bun — node:timers module](https://bun.com/reference/node/timers) — setTimeout/setInterval/clearTimeout used to self-schedule loops.
- [Hono — Bun getting started](https://hono.dev/docs/getting-started/bun) — serving the API from the same Bun process that runs the loops.
- [tRPC — Define Routers](https://trpc.io/docs/server/routers) — the typed appRouter mounted on Hono in the boot entrypoint.
- [@hono/trpc-server (Hono ↔ tRPC middleware)](https://www.npmjs.com/package/@hono/trpc-server) — mounting the tRPC router on Hono in the boot entrypoint.
- [tRPC — Fetch / Edge Runtimes Adapter](https://trpc.io/docs/server/adapters/fetch) — the fetch adapter the Hono middleware is built on.
- [Bybit V5 — Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — per-UID/second budget, X-Bapi-Limit headers, retCode 10006 shared across loops.
- [Bybit V5 — Integration Guidance (auth/signing)](https://bybit-exchange.github.io/docs/v5/guide) — signed REST all loops share; recv_window and clock-skew rules.
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position) — positions fetched each tick and on boot for reconcile.
- [Docker — docker container stop (SIGTERM then SIGKILL)](https://docs.docker.com/reference/cli/docker/container/stop/) — the shutdown signal/grace model the SIGTERM handler must satisfy.
- [Drizzle ORM — Transactions](https://orm.drizzle.team/docs/transactions) — atomic tick writes so a mid-write SIGKILL leaves a repairable ledger.
- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/) — what a real event bus would add (consumer groups, XACK/XPENDING) if the platform ever outgrows one process.
</content>
