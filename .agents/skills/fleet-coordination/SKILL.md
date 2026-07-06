---
name: fleet-coordination
description: Coordinate the SkyPower V3 Faz 3 four-role bot fleet (Avcı/Hunter, Kayıkçı/Boatman, Bulucu/Finder, Safra/Ballast) on the Bybit V5 TypeScript engine — run each role as a separate config/instance of the SAME engine, enforce a fleet-level SYMBOL LOCK (one bot per symbol via a MySQL lock table), cap FLEET-TOTAL and net-directional exposure across correlated BTC/ETH/L1 (per-bot exposure_enabled is not enough — correlated names act as one position), partition the universe (Kayıkçı = Tier-A only, Avcı = Tier-A+B with a higher threshold), allocate role capital (Kayıkçı 35–40%, Safra 25–30%, Avcı 10–15%, Reserve 20–25%), route each signal to one role, and let Bulucu (engine_enabled 0, capital $0) serve the candidate list + regime compass. Use for the fleet, roles, symbol lock / one bot per symbol, distributed lock, fleet exposure/directional cap, correlated exposure, role capital allocation, universe partitioning Tier-A/Tier-B, signal routing, or Bulucu serving candidates/regime.
---

# Fleet Coordination (SkyPower V3 Faz 3)

## When to use this skill
- Splitting the strategy into the four roles (Avcı, Kayıkçı, Bulucu, Safra) as separate configs/instances of one engine.
- Preventing two bots from opening the same symbol (fleet-level **symbol lock**).
- Capping **fleet-total** notional and **net directional** exposure across correlated coins (not just per-bot).
- Partitioning the coin universe per role (Kayıkçı Tier-A only; Avcı Tier-A+B, higher threshold).
- Allocating capital across roles and holding a reserve.
- Routing a Bulucu candidate to exactly one role so two bots don't chase the same signal.
- Designing how Bulucu (no trading) serves the candidate list + regime direction to the trading roles.

## Core concepts

**One engine, four configs.** All roles run the *same* v3 engine binary. A role is just a set of `v3_coin_config` rows (plus a `role` tag) and a capital budget — not a fork of the code. Bulucu is a config with `engine_enabled: 0` and `entry_usdt: 0`: it scans, scores, computes the regime, and writes candidates + direction, but never places an order. Avcı, Kayıkçı, Safra are configs with `engine_enabled: 1` that *consume* Bulucu's output. This keeps a single audited hot path (`v3_decision_log`/`v3_position_event`) and one reconcile loop; roles diverge only in config and in which pure decision functions they call.

**The role split (what each does).**
- 🔭 **Bulucu (Finder)** — the only writer of the shared candidate list + regime compass. `engine_enabled: 0`, capital $0. Builds/scores the Tier-A/Tier-B universe (see coin-universe-selection), manages cooldown/blacklist, computes the ≥2-of-3 regime direction (see regime-detection). Serves `{ symbol, tier, score, direction }` rows to the others.
- 🚣 **Kayıkçı (Boatman)** — cross-sectional breadth. 10–15 small positions in the regime direction, **Tier-A only**, NO layering, post-only limit entry. First role to validate (mostly config).
- 🎯 **Avcı (Hunter)** — momentum/breakout. 1–3 positions, **Tier-A+B** but a *higher* signal threshold, decreasing profit pyramid (mult ≤ 0.7, ≤ 2–3 layers), taker OK on breakout.
- ⚓ **Safra (Ballast)** — delta-neutral funding carry (see market-neutral-funding). LAST priority, separate engine capability.

**Symbol lock (one bot per symbol).** Per-bot state cannot stop two roles opening the SAME coin — Avcı's breakout and Kayıkçı's breadth can both like `SOLUSDT`, doubling correlated risk under one ticker. The fleet needs a **shared lock table in MySQL**: a role must acquire an exclusive lock on `symbol` before it opens, and hold it until it flattens. Locks are **leased (TTL)** so a crashed bot's lock self-expires and the symbol frees on reconcile — never an eternal orphan lock.

**Fleet-total exposure + directional cap.** `exposure_enabled`/`exposure_limit_usdt` are *per-bot*; the fleet can still stack 40 alt longs across three roles and be one giant beta-to-BTC bet. Enforce two fleet-level caps computed across ALL roles' live positions: (1) **gross notional** ≤ fleet cap, and (2) **net directional** notional — because BTC/ETH and L1 majors are ~0.8+ correlated, treat them as **one basket**: sum signed notional (long +, short −), weight by beta-to-BTC, and cap the net so the fleet isn't secretly 100% long the market. Safra's perp shorts are delta-neutralized by spot and should be *excluded* from the directional sum (they carry no market delta).

**Universe partitioning.** Kayıkçı draws only from **Tier-A** (≥$100M vol, ≤0.05% spread, deep book) — breadth demands liquidity. Avcı may reach into **Tier-B** (thinner) but only with a *higher* entry threshold to pay for the worse fill. Bulucu scans wide (80–150 symbols); the partition is applied when routing candidates, not by lowering thresholds.

**Role capital allocation.** Split total equity: **Kayıkçı 35–40%**, **Safra 25–30%**, **Avcı 10–15%**, **Reserve 20–25%**. Reserve is un-deployed dry powder for regime shifts / pilots. Each role's `exposure_limit_usdt` is derived from its slice; a role may never exceed its budget even if a signal is strong.

**Role separation / signal routing.** A Bulucu candidate goes to **exactly one** role by a deterministic rule so two bots don't take the same signal: Tier-B or breakout-momentum candidate → Avcı; Tier-A trend/breadth candidate in the regime direction → Kayıkçı; positive-funding + liquid-spot candidate → Safra. Ties resolve by a fixed role priority. Routing happens *before* the symbol lock, so only the assigned role even attempts the coin.

## Codebase specifics
- **Config = the role.** Roles are `v3_coin_config` rows tagged by `role` (add a `role` column) plus a shared candidate/lock table. Keys already present that differ per role: `engine_enabled` (Bulucu 0), `coin_count` (Kayıkçı 10–15, Avcı 1–3), `entry_usdt`, `exposure_enabled`, `exposure_limit_usdt`, `exposure_reserve_usdt`, `bias_enabled`, `max_long_pct`/`max_short_pct`, `profit_layer_enabled`/`profit_max_layers`/`profit_layer_multiplier` (Avcı only; Kayıkçı 0), plus universe filters (`likidite_enabled`, `min_volume_usdt`, `max_spread_pct`, `atr_enabled`, `min_atr_pct`). `loss_layer_enabled: 0` everywhere (DCA-on-loss is dead).
- **[KOD] gaps this skill fills.** The engine today has only per-bot checks. Missing and to be added: (1) the fleet **symbol-lock table** + acquire/release, (2) **fleet-total gross + net-directional** caps computed across roles, (3) **candidate routing** so one signal → one role, (4) a shared **candidate/regime table** written by Bulucu.
- **Pure core / dirty shell.** All decisions — capital split, gross/net exposure math, tier partition, candidate routing — are **pure functions** in a package (e.g. `packages/fleet`), unit-tested with `bun test`. Only the **lock table**, its `acquire/release`, and reading live positions live in the dirty shell (Drizzle + signed Bybit REST).
- **Exchange = truth.** Fleet exposure is computed from **real** positions read via `GET /v5/position/list` (roles share the Bybit account, or positions are summed across sub-accounts), never from optimistic local state. Reconcile first, then evaluate fleet caps.
- **Polling, no WebSocket.** Lock acquisition and exposure checks run inside each role's ~3s/10s loop turn; there is no push. Keep the lock transaction short.
- **Idempotent schema.** Add the lock/candidate tables in `ensure-schema.ts` with `create table if not exists`; safe to re-run.

## Implementation checklist
- [ ] Add a `role` tag to configs; run Bulucu with `engine_enabled: 0`, `entry_usdt: 0`.
- [ ] Create `v3_symbol_lock` (symbol PK, role, botId, acquiredAt, expiresAt) via idempotent ensure-schema.
- [ ] Acquire the lock in a short transaction (`SELECT … FOR UPDATE` or insert-on-conflict) **before** opening; reject if held and unexpired; reclaim expired (lease TTL) leases.
- [ ] Release the lock when the position flattens; on reconcile, free locks with no matching live position.
- [ ] Compute **role capital** with a pure `allocateRoleCapital(equity)` → derive each `exposure_limit_usdt`; keep 20–25% reserve.
- [ ] Compute **fleet gross** notional and **net directional** (beta-weighted, Safra hedged legs excluded) across all roles; block an entry that would breach either cap.
- [ ] Route each Bulucu candidate to exactly one role (`routeCandidate`) before the lock step.
- [ ] Partition universe: Kayıkçı → Tier-A only; Avcı → Tier-A+B with a higher threshold.
- [ ] Bulucu writes `v3_fleet_candidate` (symbol, tier, score, direction, ts); trading roles read it, never recompute.
- [ ] Unit-test every pure function; write each lock/route/exposure decision to `v3_decision_log`.

## Do / Don't
**Do**
- Run one engine; make roles differ by config + which pure functions they call.
- Gate every open behind the fleet symbol lock; lease locks with a TTL and reclaim on crash.
- Cap **fleet** gross AND net-directional exposure; treat BTC/ETH/L1 majors as one correlated basket.
- Derive per-role `exposure_limit_usdt` from the capital split; keep a real reserve.
- Route a signal to exactly one role deterministically; let Bulucu be the single source of candidates + regime.

**Don't**
- Don't rely on per-bot `exposure_enabled` alone — it can't see the fleet's aggregate directional bet.
- Don't let two roles hold the same symbol; don't skip lock release on flatten.
- Don't leave locks un-leased (a crash orphans the symbol forever).
- Don't let Bulucu place orders, hold capital, or let trading roles recompute the universe/regime themselves.
- Don't count Safra's delta-neutral perp short in the net-directional sum.

## Common pitfalls
- **Orphan locks.** A bot dies holding a lock; without a TTL + reconcile-time release, that symbol is dead to the fleet forever.
- **Correlated blind spot.** Three roles each within their per-bot cap, together 100% long BTC-beta — the net-directional cap is the only thing that catches it.
- **Double signal.** No routing rule → Avcı and Kayıkçı both open the same breakout; the symbol lock is the last-line defence, routing is the first.
- **Shared-account position summing.** If roles share one Bybit account, `position/list` returns net per symbol — you can't attribute size to a role from the exchange alone; track role ownership in the lock/ledger, not only via reconcile.
- **Stale exposure.** Evaluating fleet caps before reconcile double-counts a just-closed position and blocks good entries.
- **Reserve leakage.** Deriving budgets that sum to 100% leaves no dry powder; cap role budgets to 75–80% of equity.
- **Lock contention latency.** Long lock transactions stall the 3s loop; keep the acquire/release critical section tiny.

## Code patterns

Pure role-capital allocation (`packages/fleet`):
```ts
export type RoleBudget = { role: "kayikci" | "safra" | "avci"; fraction: number; budgetUsdt: number };

export function allocateRoleCapital(equity: number): { budgets: RoleBudget[]; reserveUsdt: number } {
  const weights = { kayikci: 0.375, safra: 0.275, avci: 0.125 } as const; // reserve = 22.5%
  const budgets = (Object.keys(weights) as (keyof typeof weights)[]).map((role) => ({
    role, fraction: weights[role], budgetUsdt: equity * weights[role],
  }));
  const reserveUsdt = equity * (1 - budgets.reduce((s, b) => s + b.fraction, 0));
  return { budgets, reserveUsdt };
}
```

Pure fleet gross + net-directional exposure check (correlated majors as one basket):
```ts
export type FleetPos = {
  symbol: string; side: "long" | "short"; notionalUsdt: number;
  betaToBtc: number;        // ~1 for BTC, 0.8–1.2 majors, higher for beta alts
  hedged: boolean;          // true = Safra delta-neutral leg → carries no market delta
};

export function fleetExposureOk(
  positions: FleetPos[],
  caps: { grossUsdt: number; netDirectionalUsdt: number },
  add?: FleetPos,
): { ok: boolean; reason?: string; gross: number; net: number } {
  const all = add ? [...positions, add] : positions;
  const gross = all.reduce((s, p) => s + p.notionalUsdt, 0);
  const net = all
    .filter((p) => !p.hedged)                                   // exclude delta-neutral legs
    .reduce((s, p) => s + (p.side === "long" ? 1 : -1) * p.notionalUsdt * p.betaToBtc, 0);
  if (gross > caps.grossUsdt) return { ok: false, reason: "fleet-gross", gross, net };
  if (Math.abs(net) > caps.netDirectionalUsdt) return { ok: false, reason: "fleet-directional", gross, net };
  return { ok: true, gross, net };
}
```

Pure universe partition + deterministic candidate routing (one signal → one role):
```ts
export type Candidate = {
  symbol: string; tier: "A" | "B"; score: number;
  direction: "long" | "short"; posFunding: boolean; liquidSpot: boolean;
};

export function roleAllowsSymbol(role: "kayikci" | "avci", tier: "A" | "B"): boolean {
  return role === "kayikci" ? tier === "A" : true; // Avcı: A+B (higher threshold applied elsewhere)
}

export function routeCandidate(c: Candidate): "kayikci" | "avci" | "safra" | null {
  if (c.posFunding && c.liquidSpot) return "safra";       // funding-carry first-claim
  if (c.tier === "B") return "avci";                      // thin coin → hunter only
  if (c.tier === "A") return "kayikci";                   // liquid trend → boatman
  return null;
}
```

Dirty-shell symbol-lock table + leased acquire/release (Drizzle + MySQL):
```ts
// ensure-schema.ts (idempotent):
// CREATE TABLE IF NOT EXISTS v3_symbol_lock (
//   symbol VARCHAR(32) PRIMARY KEY, role VARCHAR(16) NOT NULL, bot_id VARCHAR(64) NOT NULL,
//   acquired_at DATETIME NOT NULL, expires_at DATETIME NOT NULL );

const LEASE_MS = 5 * 60_000;

async function acquireSymbolLock(db: DrizzleDb, symbol: string, role: string, botId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const now = new Date(), expires = new Date(now.getTime() + LEASE_MS);
    const [held] = await tx.select().from(v3SymbolLock)
      .where(eq(v3SymbolLock.symbol, symbol)).for("update");          // row lock inside txn
    if (held && held.expiresAt > now && held.botId !== botId) return false; // held & fresh
    if (held) {
      await tx.update(v3SymbolLock).set({ role, botId, acquiredAt: now, expiresAt: expires })
        .where(eq(v3SymbolLock.symbol, symbol));                      // reclaim expired / renew own
    } else {
      await tx.insert(v3SymbolLock).values({ symbol, role, botId, acquiredAt: now, expiresAt: expires });
    }
    return true;
  });
}

async function releaseSymbolLock(db: DrizzleDb, symbol: string, botId: string) {
  await db.delete(v3SymbolLock)
    .where(and(eq(v3SymbolLock.symbol, symbol), eq(v3SymbolLock.botId, botId)));
}
// On reconcile: for each lock with no matching live position on the exchange, release it (frees orphans).
```

## References
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position) — `/v5/position/list` size/side/avgPrice, the source of truth for computing fleet exposure.
- [Bybit V5 — Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — the single engine order path every role shares (`category:"linear"`).
- [Bybit V5 — Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — per-UID budget shared by all role loops; keep lock/exposure polling within it.
- [MySQL 8.0 — Locking Functions (GET_LOCK / RELEASE_LOCK)](https://dev.mysql.com/doc/refman/8.0/en/locking-functions.html) — named advisory locks as an alternative to a lock table; auto-release on lost connection.
- [MySQL 8.4 — Locking Reads (SELECT … FOR UPDATE)](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html) — row-level locking used by the symbol-lock transaction.
- [sonots/mysql_getlock — Distributed locking with MySQL get_lock()](https://github.com/sonots/mysql_getlock) — reference pattern for a MySQL-backed distributed mutex.
- [Drizzle ORM — MySQL get started](https://orm.drizzle.team/docs/mysql/get-started-mysql) — schema + transactional acquire/release for the lock and candidate tables.
- [Beta vs Correlation (Gate Learn)](https://www.gate.com/learn/glossary/beta-vs-correlation) — beta-to-BTC weighting behind the net-directional basket cap.
- [Cryptocurrency systematic risk dynamics (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S0165176524002726) — correlations rise in drawdowns → correlated names behave as one position.
- [Optimising crypto portfolios via correlation-network clustering (arXiv)](https://arxiv.org/html/2505.24831v1) — grouping correlated assets into baskets for exposure control.
- [Bun — Documentation](https://bun.com/docs) — runtime for the engine, `bun test` for the pure fleet functions.
- [Zod — Defining schemas](https://zod.dev/api) — validate role configs and candidate rows at the tRPC boundary.
