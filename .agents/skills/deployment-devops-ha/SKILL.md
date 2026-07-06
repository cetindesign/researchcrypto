---
name: deployment-devops-ha
description: Deploy and operate this single-container Bun/TypeScript Bybit trading platform in production. Covers the Dokploy push-to-main auto Docker build + deploy pipeline, the ONE Bun container that serves the Hono/tRPC API + React UI AND runs the 6 background loops (collector, v3 Bybit engine, optimizer, calendar, news, ensureSchema), NO migration files (idempotent ensure-schema.ts ALTER TABLE on boot), config/secrets via env vars, graceful shutdown on SIGTERM (stop loops, flatten-or-protect open positions), crash recovery via reconcile-on-boot (exchange = source of truth), NTP/clock sync for Bybit signature timestamps and recv_window, a Bun Dockerfile, and preventing a double-run of the engine (single-writer to the exchange). Invoke for "Dockerfile", "Dokploy", "deploy", "auto-deploy", "SIGTERM", "graceful shutdown", "ensure-schema", "no migrations", "reconcile on boot", "recv_window", "timestamp error 10002", "clock skew", "double-run engine", "single writer", "env secrets", "healthcheck", or "high availability".
---

# Deployment, DevOps & HA (Dokploy + single Bun container)

## When to use this skill
- Writing or editing the `Dockerfile` (Bun) or Dokploy application settings for this platform.
- Wiring push-to-`main` → Dokploy auto build + deploy, and reasoning about zero-downtime / overlap.
- Handling `SIGTERM` so the 6 loops stop cleanly and open Bybit positions are flattened or protected.
- Guaranteeing DB columns exist on boot via idempotent `ensure-schema.ts` (there are NO migration files).
- Debugging Bybit `10002 timestamp` / `recv_window` auth failures caused by container clock drift.
- Making sure only ONE engine instance ever sends orders (single-writer) across a deploy.

## Core concepts

**One process, one container, six loops.** The whole platform is a single Bun backend. On boot it serves the Hono HTTP server (tRPC API + the built React UI) and then starts six periodic loops: `ensureSchema` → `collector` (price snapshots) → `v3` Bybit engine (~10s) → `optimizer` (2h) → `calendar` scraper (15m) → `news` scraper (3m, Gemini). There is no separate worker fleet and no message bus — everything is in-process, polling signed REST. Operational reasoning is about this one stateful money-handling process, not a stateless web app.

**Deploy = push to `main` → Dokploy.** Dokploy watches the repo (GitHub App / webhook) and on each push to the configured branch rebuilds the image and redeploys. Use the **Dockerfile** build type (full control over the Bun image) rather than Nixpacks/Buildpacks for a trading service. The heavy option for production is CI-builds-the-image then triggers Dokploy via the deploy webhook so the server only pulls and swaps; the simple option is letting Dokploy build on the server. Either way, set the branch, the Dockerfile path, and inject env vars in the Dokploy Environment tab.

**No migration files — schema is guaranteed at boot.** Instead of a migration tool, `ensure-schema.ts` runs first and issues **idempotent** `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements (via Drizzle's `sql` raw executor against MySQL). It must be safe to run on every boot and every deploy. New column? Add an idempotent ALTER here; never a versioned migration.

**Graceful shutdown = stop loops, then protect money.** On `SIGTERM` (Dokploy stops the old container on deploy) the process must, within the grace period: stop scheduling new loop turns, let the in-flight engine turn finish, and **flatten** (market-close positions + cancel orders) or **protect** (confirm a server-side reduce-only SL/TP sits on Bybit) — never exit leaving a naked, unstopped position.

**Crash recovery = reconcile, don't remember.** After any restart the engine treats the **exchange as source of truth**: it fetches live positions/orders from Bybit (signed REST) and reconciles the DB ledger to them before trading. In-memory state is assumed lost. This is the same reconcile step the engine runs every turn, so a crash-restart is just a normal boot.

**Clock sync.** Bybit V5 rejects signed requests whose `X-BAPI-TIMESTAMP` falls outside `recv_window` of server time. A drifting container clock → intermittent `10002 invalid timestamp` / signature errors that look random. Sync the host clock (NTP/chrony) and keep `recv_window` modest (5000–10000 ms); optionally offset local time using `GET /v5/market/time`.

**HA is bounded by single-writer.** For any account/symbol exactly ONE process may send orders. You cannot naively run two replicas of this container against the same Bybit account — they would double every order. So "HA" here means fast, safe restart + a guard that prevents two engines from trading at once, not active-active. Enforce with a boot lock (e.g. MySQL `GET_LOCK`) so a lingering old container yields before the new one trades.

## Codebase specifics (Bun / Dokploy / this platform)
- **Runtime:** Bun. Serve with `Bun.serve` / Hono; static UI is the Vite build output served by Hono. Loops are plain `setInterval`/async schedulers started after `ensureSchema` resolves.
- **Signals in Bun:** register `process.on("SIGTERM", ...)` and `process.on("SIGINT", ...)`; on SIGTERM run the shutdown routine then `server.stop()` and `process.exit(0)`. (Bun historically lagged on signal listeners — pin a recent Bun version.)
- **Secrets/config via env only:** `BYBIT_API_KEY`/`BYBIT_API_SECRET` (per-user keys are AES-256-GCM encrypted in the DB, but the master encryption key + `DATABASE_URL` + `GEMINI_API_KEY` come from env), never baked into the image or logged. Set them in Dokploy's Environment tab / a mounted env file.
- **Dockerfile:** multi-stage on `oven/bun` — install deps with `bun install --frozen-lockfile`, build the web app, then a slim runtime stage that `bun run`s the server. Run as non-root, `STOPSIGNAL SIGTERM`, expose the Hono port, add a `HEALTHCHECK` hitting `/health`.
- **Reconcile on boot:** `GET /v5/position/list` + `GET /v5/order/realtime` (`category=linear`) to rebuild live state before the engine's first entry decision.
- **Server-side protection:** prefer Bybit-native stops (`POST /v5/position/trading-stop` or `reduceOnly` orders) so a position stays covered even if the container is gone — a software TP/SL check that only lives in the Bun process does not survive `kill -9`.

## Implementation checklist
- [ ] Multi-stage Bun `Dockerfile` (`oven/bun`, pinned tag), non-root user, `bun install --frozen-lockfile`, `STOPSIGNAL SIGTERM`, `HEALTHCHECK`.
- [ ] Dokploy app configured: build type = Dockerfile, branch = `main`, auto-deploy on push, env vars set in the Environment tab.
- [ ] `ensure-schema.ts` runs first on boot; all statements idempotent (`IF NOT EXISTS`); safe to re-run every deploy.
- [ ] `SIGTERM`/`SIGINT` handler: stop scheduling loop turns → await current engine turn → flatten-or-protect positions → `server.stop()` → exit 0, bounded by the grace period.
- [ ] Boot reconciliation: fetch live Bybit positions/orders and reconcile the DB before the first entry.
- [ ] Single-writer guard (e.g. MySQL `GET_LOCK`) so a new deploy waits for the old container to release before its engine trades.
- [ ] Host NTP/chrony sync; monitor `abs(localTime - serverTime)`; alert if > 1000 ms; keep `recv_window` 5000–10000.
- [ ] `/health` endpoint that fails if the engine loop is stalled or the DB is unreachable; Dokploy healthcheck wired to it.
- [ ] Env-only secrets; scrub keys from logs and error traces; separate testnet/demo vs mainnet keys behind an explicit flag.
- [ ] Every engine decision written to `v3_decision_log` and every state change to `v3_position_event` so a restart is auditable.

## Do / Don't
**Do**
- Treat the exchange as source of truth and reconcile on every boot/restart.
- Keep SL/TP as server-side Bybit stops so positions survive a crash or `kill -9`.
- Make `ensure-schema.ts` fully idempotent and run it before any loop starts.
- Let the new Dokploy deploy wait (boot lock) until the old container releases before it trades.
- Sync the host clock via NTP and keep `recv_window` small; fix the clock, not the window.

**Don't**
- Don't run two containers/replicas against the same Bybit account — you double every order.
- Don't rely on a Bun-memory TP/SL as the only protection; SIGKILL skips your shutdown handler.
- Don't add versioned migration files — extend `ensure-schema.ts` with idempotent ALTERs.
- Don't bake `BYBIT_API_SECRET`/`GEMINI_API_KEY` into image layers or print them in logs.
- Don't set `recv_window` to minutes to mask timestamp errors — that reopens replay risk.

## Common pitfalls
- **Deploy overlap double-trading:** Dokploy starts the new container before the old one drains; for seconds both run the engine → duplicate orders. The boot lock + graceful drain prevents it.
- **Naked position after OOM/SIGKILL:** the shutdown handler never runs, so protection must already live on Bybit (server-side stop), not in the process.
- **Container clock drift:** the container inherits a drifting host clock → sporadic `10002` auth failures. Fix NTP on the host.
- **Non-idempotent schema step:** a plain `ADD COLUMN` (no `IF NOT EXISTS`) throws on the second boot and crash-loops the whole platform.
- **State desync after restart:** trusting the DB ledger instead of re-fetching Bybit positions → the engine acts on a stale view. Always reconcile.
- **Secrets in image:** `COPY .env` bakes credentials into a layer forever, even if later deleted.

## Code patterns

Graceful shutdown that stops the loops and protects positions (Bun/TS):
```ts
const loops = new Set<NodeJS.Timeout>();
let draining = false;

async function shutdown(sig: string) {
  if (draining) return;
  draining = true;
  console.log(`[shutdown] ${sig}: stopping loops`);
  for (const t of loops) clearInterval(t);      // no new engine turns
  await currentEngineTurn?.catch(() => {});     // let the in-flight turn finish
  await flattenOrProtectPositions();            // market-close or confirm server-side SL/TP
  server.stop();                                // stop Hono/Bun.serve
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

Idempotent `ensure-schema.ts` (Drizzle raw SQL, no migration files):
```ts
import { sql } from "drizzle-orm";
import { db } from "./db";

export async function ensureSchema() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS v3_decision_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(64) NOT NULL,
    symbol  VARCHAR(32) NOT NULL,
    decision JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  // additive, safe to re-run every boot (MySQL 8 supports IF NOT EXISTS on ADD COLUMN)
  await db.execute(sql`ALTER TABLE v3_decision_log ADD COLUMN IF NOT EXISTS reason VARCHAR(255) NULL`);
}
```

Single-writer boot lock (MySQL advisory lock — one engine trades):
```ts
// GET_LOCK returns 1 if acquired; the old container holds it until it releases on SIGTERM.
const [{ locked }] = (await db.execute(
  sql`SELECT GET_LOCK('v3_engine_singleton', 30) AS locked`,
)) as any;
if (locked !== 1) throw new Error("another engine holds the trading lock; not starting");
// ... run engine ... on shutdown: await db.execute(sql`SELECT RELEASE_LOCK('v3_engine_singleton')`);
```

Multi-stage Bun Dockerfile:
```dockerfile
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build                      # Vite build for the React UI

FROM oven/bun:1-slim AS release
WORKDIR /app
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app ./
USER bun
ENV NODE_ENV=production
STOPSIGNAL SIGTERM
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "src/server.ts"]
```

## References
- [Dokploy — Auto Deploy](https://docs.dokploy.com/docs/core/auto-deploy) — push-to-branch triggers a rebuild + redeploy; webhook URL and GitHub App setup.
- [Dokploy — Applications: Going Production](https://docs.dokploy.com/docs/core/applications/going-production) — CI-builds-then-deploy vs server-side build, zero-downtime guidance.
- [Dokploy — Build Type (Dockerfile / Nixpacks / Buildpacks)](https://docs.dokploy.com/docs/core/applications/build-type) — choosing the Dockerfile build type and Dockerfile path.
- [Dokploy — GitHub integration](https://docs.dokploy.com/docs/core/github) — connecting the repo and branch for auto-deploy.
- [Bun — Containerize a Bun application with Docker](https://bun.com/docs/guides/ecosystem/docker) — official multi-stage Dockerfile, `--frozen-lockfile`, slim runtime.
- [oven/bun — Docker image](https://hub.docker.com/r/oven/bun) — base image tags (`1`, `1-slim`, `-alpine`, `-debian`).
- [Docker — Dockerfile reference (STOPSIGNAL, HEALTHCHECK)](https://docs.docker.com/reference/dockerfile/) — signal and healthcheck directives.
- [Hono + Bun — graceful shutdown / SIGTERM (discussion)](https://github.com/orgs/honojs/discussions/3731) — stopping the server and draining on signal in Bun.
- [Drizzle ORM — MySQL](https://orm.drizzle.team/docs/get-started/mysql-new) — `drizzle-orm/mysql2`, running raw `sql` for idempotent `ensure-schema`.
- [Bybit V5 — Integration Guidance (auth & recv_window)](https://bybit-exchange.github.io/docs/v5/guide) — signing, `X-BAPI-TIMESTAMP`, `recv_window`, error `10002`.
- [Bybit V5 — Get Server Time](https://bybit-exchange.github.io/docs/v5/market/time) — check/offset local time against server clock.
- [Bybit V5 — Position List](https://bybit-exchange.github.io/docs/v5/position/position-info) — reconcile live positions on boot.
- [Bybit V5 — Set Trading Stop](https://bybit-exchange.github.io/docs/v5/position/trading-stop) — server-side SL/TP that survives a crash.
- [chrony / NTP documentation](https://chrony-project.org/documentation.html) — keep the host clock synced for signature timestamps.
