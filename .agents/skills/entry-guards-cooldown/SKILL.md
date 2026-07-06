---
name: entry-guards-cooldown
description: Orchestrate every SkyPower V3 entry gate as ANDed pure predicates the engine checks before opening or adding to a position. Covers normal cooldown (cooldown_time_min 60), loss-cooldown (cooldown_loss_trigger 2 → cooldown_loss_time_min 1440 = 24h), fleet blacklist (7d window, 4+ losses → removed, Bulucu-managed), the missing REENTRANCY GUARD that prevents a double layer-add / double open on a symbol under polling, one-bot-per-symbol symbol-lock, and gating on news_guard / event_guard / BTC Shock Shield / regime-neutral (no new entries when the compass is neutral). Guard state lives in MySQL (cooldown timestamps, blacklist rows, symbol locks, in-flight markers); each tick enters only if ALL guards pass, writing the blocking reason to v3_decision_log. Pure predicates in packages/ (bun test) + dirty-shell state reads/writes. Invoke for cooldown, loss cooldown, blacklist, reentrancy, double add, symbol lock, one bot per symbol, news guard, event guard, BTC shock, regime neutral, or why was this trade blocked.
---

# Entry Guards & Cooldown

## When to use this skill
- Deciding, on each engine tick, whether a symbol is **allowed to be entered / added to** before any order is placed.
- Implementing **cooldown** (normal 60min and loss-cooldown 24h after N consecutive losses) with state in MySQL.
- Implementing the **fleet blacklist** (Bulucu removes a symbol after repeated losses in a rolling window).
- Adding the **[KOD] reentrancy guard** that stops a double layer-add or double open under polling (the classic bug: two ticks both see "slot free" and both open).
- Enforcing **one bot per symbol** (fleet symbol-lock) so two roles don't both trade the same coin.
- Wiring **news_guard / event_guard / BTC Shock Shield / regime-neutral** as veto predicates.

## Core concepts
- **Guards are ANDed pure predicates.** Entry is allowed only if **every** guard returns "allow". Each guard is a **pure function** of `(now, config, guardState)` → `{ allow: boolean; reason?: string }`. Purity makes them unit-testable and makes the blocking reason auditable. The dirty shell only *reads* the state (MySQL) and *applies* the verdict.
- **Normal cooldown (`cooldown_time_min: 60`).** After a position on a symbol closes, block re-entry on that symbol for 60 minutes. Prevents thrash / immediate re-entry into the same failing setup.
- **Loss-cooldown (`cooldown_loss_trigger: 2` → `cooldown_loss_time_min: 1440`).** After **2 consecutive losses** on a symbol (or role/symbol pair), impose a **24-hour** cooldown — a much stronger brake than the normal one. A win resets the consecutive-loss counter.
- **Fleet blacklist (Bulucu-managed).** A rolling **7-day** window: if a symbol produces **4+ losses**, Bulucu removes it from the tradable universe entirely. This is fleet-level (all roles), computed by the non-trading Finder, not per-bot. Symbols age back in when the window clears.
- **Reentrancy guard [KOD — still missing].** Under **polling with no WebSocket**, an order's fill isn't confirmed instantly, so two consecutive ticks (or a slow retry) can both conclude "no position yet, open one" → **double open / double layer-add**. The guard is a short-lived **in-flight marker** (per symbol+intent) written **before** placing the order and cleared only after reconcile; while it's set, the same-symbol entry/add is vetoed. Pair it with `orderLinkId` idempotency (see `order-execution-oms`) — belt and suspenders.
- **Symbol-lock (one bot per symbol).** A fleet-level lock table: a symbol may be held by at most one role at a time. Prevents Avcı and Kayıkçı from both piling into correlated exposure on the same coin.
- **Directional / veto guards.** `news_guard_enabled` and `event_guard_enabled` veto entries around high-impact news/events; **BTC Shock Shield** is an emergency brake (also tightens trailing, see `regime-detection`) that halts new entries on a BTC shock; **regime-neutral** means the compass has `<2 of 3` signals aligned → **no new entries** in either direction.
- **Guards gate ENTRY, not EXIT.** Never let a guard block a close, a stop, or a reduce-only. Exits and disaster stops must always be allowed to run.

## Codebase specifics
- **Pure core / dirty shell.** Predicate logic is a **pure function** in `packages/`, unit-tested with `bun test`. The shell fetches guard state from MySQL, calls the predicate bundle, and on veto writes the reason to `v3_decision_log` and skips the entry.
- **State in MySQL.** Cooldown timestamps + consecutive-loss counters, blacklist rows (symbol, loss count, window start), symbol-lock rows (symbol → role/bot, acquired_at), and reentrancy in-flight markers (symbol, intent, orderLinkId, created_at). Schema via idempotent `ensure-schema.ts` (no migrations).
- **Relevant `v3_coin_config` keys:** `cooldown_enabled`, `cooldown_time_min` (60), `cooldown_loss_trigger` (2), `cooldown_loss_time_min` (1440), `news_guard_enabled`, `event_guard_enabled`. Blacklist window/threshold (7d / 4 losses), symbol-lock, reentrancy, and fleet-total exposure are **[KOD] fleet-level** — not single per-coin toggles; store their config alongside the fleet/Bulucu tables.
- **[KOD gaps this skill fills:** reentrancy guard, symbol-lock, fleet blacklist enforcement, fleet-total exposure + directional cap. Per-bot `exposure_enabled` is not enough for correlated BTC/ETH/L1 clusters.]
- **Engine loop placement.** Guards run in the **entry stage** of the tick, AFTER reconcile and the software TP/SL/trailing check, BEFORE coin-selection turns into an order. Order matters: check the **cheapest / most decisive** vetoes first (reentrancy, symbol-lock, regime-neutral) to short-circuit.
- **Bulucu is authoritative for the universe.** The Finder (`engine_enabled: 0`) computes blacklist + cooldown state and serves it; trading bots consume it. Don't recompute the blacklist per-bot.

## Implementation checklist
- [ ] Model each guard as a pure `(now, cfg, state) => { allow, reason }`; compose with a short-circuiting AND.
- [ ] Persist a **reentrancy in-flight marker** (symbol+intent) BEFORE placing an entry/add; clear it only after reconcile confirms the fill.
- [ ] Acquire a **symbol-lock** row before entry; release on close; enforce one holder per symbol.
- [ ] Track **consecutive losses** per symbol; trigger 24h loss-cooldown at `cooldown_loss_trigger`; reset on a win.
- [ ] Enforce normal `cooldown_time_min` from the last close time.
- [ ] Honor the Bulucu **blacklist** (7d / 4+ losses) — never enter a blacklisted symbol.
- [ ] Wire `news_guard`, `event_guard`, BTC Shock Shield, and **regime-neutral** as veto predicates.
- [ ] On any veto, write the exact `reason` to `v3_decision_log`; NEVER let a guard block an exit/stop.
- [ ] Unit-test each predicate at its boundaries (exactly at, just before, just after each threshold).

## Do / Don't
**Do**
- Keep predicates **pure** and compose them with an explicit AND that returns the FIRST blocking reason.
- Set the **reentrancy marker before** the order and clear it **after reconcile** — that window is exactly where double-adds happen.
- Reset the consecutive-loss counter on a **win**; use consecutive (not total) for the 24h trigger.
- Treat the **Bulucu blacklist** as the single source of truth for universe removal.
- Audit every veto with its reason so "why didn't we enter?" is answerable.
- Check decisive/cheap guards first to short-circuit the tick.

**Don't**
- Don't let any guard block a **close, stop, or reduce-only** — exits always run.
- Don't rely on `orderLinkId` idempotency alone for double-add prevention; add the reentrancy marker too.
- Don't recompute the blacklist per-bot — it is fleet-level (Bulucu).
- Don't open in a **neutral regime** — neutral means no new entries, not "pick a side".
- Don't leave a symbol-lock or in-flight marker dangling on crash; reconcile must be able to clear stale markers by age.
- Don't store cooldown only in memory — a process restart must not wipe active cooldowns.

## Common pitfalls
- **Double open under polling.** Two ticks both see "no position" before the first fill reconciles. Without the reentrancy marker you get two positions. This is the headline bug this skill prevents.
- **Stale in-flight marker.** If the shell crashes between "set marker" and "clear after reconcile", the symbol is stuck vetoed. Give markers a TTL and let reconcile expire them.
- **Total vs consecutive losses.** Loss-cooldown triggers on **consecutive** losses; using total losses over-brakes. A win must reset the streak.
- **Blacklist window drift.** The 7-day window is rolling; a fixed "since midnight" window mis-counts. Compute from `now - 7d`.
- **Guard blocking an exit.** A copy-paste that runs the entry-guard bundle before a close will trap a losing position — always separate the exit path.
- **Regime-neutral treated as random side.** Neutral = flat / no new entries; don't coin-flip a direction.
- **Timezone/units.** `cooldown_*_min` is minutes; compare in ms consistently; store timestamps UTC.

## Code patterns
Pure guard predicates + short-circuiting AND (in `packages/`, `bun test`):

```ts
// packages/entry-guards/src/guards.ts — pure, deterministic
export type GuardState = {
  lastCloseAt: number | null;          // ms epoch of last close on this symbol
  consecutiveLosses: number;           // reset to 0 on a win
  blacklistedUntil: number | null;     // Bulucu 7d/4-loss removal, ms epoch
  symbolLockedBy: string | null;       // role/bot holding the symbol, or null
  inFlight: boolean;                    // reentrancy marker: an entry/add is in progress
  regime: "long" | "short" | "neutral";
  newsBlocked: boolean; eventBlocked: boolean; btcShock: boolean;
};
export type Cfg = {
  cooldownEnabled: boolean; cooldownTimeMin: number;         // 60
  cooldownLossTrigger: number; cooldownLossTimeMin: number;  // 2 -> 1440
  newsGuardEnabled: boolean; eventGuardEnabled: boolean;
};
export type Verdict = { allow: boolean; reason?: string };

const block = (reason: string): Verdict => ({ allow: false, reason });
const ok: Verdict = { allow: true };

export function reentrancyGuard(s: GuardState): Verdict {
  return s.inFlight ? block("reentrancy_in_flight") : ok;   // an entry/add is already mid-flight
}
export function symbolLockGuard(s: GuardState, me: string): Verdict {
  return s.symbolLockedBy && s.symbolLockedBy !== me ? block(`symbol_locked_by_${s.symbolLockedBy}`) : ok;
}
export function blacklistGuard(now: number, s: GuardState): Verdict {
  return s.blacklistedUntil && now < s.blacklistedUntil ? block("blacklisted") : ok;
}
export function cooldownGuard(now: number, cfg: Cfg, s: GuardState): Verdict {
  if (!cfg.cooldownEnabled || s.lastCloseAt == null) return ok;
  const lossCd = s.consecutiveLosses >= cfg.cooldownLossTrigger;          // 24h loss-cooldown
  const mins = lossCd ? cfg.cooldownLossTimeMin : cfg.cooldownTimeMin;    // else normal 60min
  const until = s.lastCloseAt + mins * 60_000;
  return now < until ? block(lossCd ? "loss_cooldown_24h" : "cooldown_60m") : ok;
}
export function regimeGuard(s: GuardState): Verdict {
  return s.regime === "neutral" ? block("regime_neutral") : ok;          // neutral => no new entries
}
export function vetoGuard(cfg: Cfg, s: GuardState): Verdict {
  if (s.btcShock) return block("btc_shock_shield");
  if (cfg.newsGuardEnabled && s.newsBlocked) return block("news_guard");
  if (cfg.eventGuardEnabled && s.eventBlocked) return block("event_guard");
  return ok;
}

/** ANDed: returns the FIRST blocking reason, else allow. */
export function canEnter(now: number, cfg: Cfg, s: GuardState, me: string): Verdict {
  for (const g of [
    reentrancyGuard(s), symbolLockGuard(s, me), blacklistGuard(now, s),
    cooldownGuard(now, cfg, s), regimeGuard(s), vetoGuard(cfg, s),
  ]) if (!g.allow) return g;
  return ok;
}
```

Dirty-shell usage in the entry stage of a tick (reentrancy marker set BEFORE the order):

```ts
// runs after reconcile + software exit checks, before coin-selection becomes an order
async function tryEnter(db: DrizzleDb, key: ApiKey, sym: string, me: string, cfg: Cfg) {
  const state = await loadGuardState(db, sym, me);            // reads MySQL: cooldown, blacklist, lock, in-flight
  const verdict = canEnter(Date.now(), cfg, state, me);
  if (!verdict.allow) { await logDecision(db, sym, "entry_blocked", verdict.reason!); return; }

  await db.transaction(async (tx) => {                        // atomically claim the symbol + mark in-flight
    await acquireSymbolLock(tx, sym, me);
    await setInFlight(tx, sym, me, /* intent */ "open");      // reentrancy marker — next tick will veto
  });
  try {
    const linkId = await persistOrderLinkId(db, sym, me);     // order-execution-oms idempotency
    await makerEntry(key, sym, /* ...maker post-only entry (maker-execution-cost-control)... */ linkId);
  } finally {
    await reconcileAndClearInFlight(db, key, sym, me);        // clear marker only after exchange truth is read
  }
}
```

Unit test sketch (`bun test`) — boundary at the loss-cooldown trigger:

```ts
import { expect, test } from "bun:test";
import { canEnter } from "../src/guards";
const cfg = { cooldownEnabled: true, cooldownTimeMin: 60, cooldownLossTrigger: 2, cooldownLossTimeMin: 1440, newsGuardEnabled: true, eventGuardEnabled: true };
const base = { lastCloseAt: 0, consecutiveLosses: 0, blacklistedUntil: null, symbolLockedBy: null, inFlight: false, regime: "long" as const, newsBlocked: false, eventBlocked: false, btcShock: false };

test("2 consecutive losses => 24h loss-cooldown", () => {
  const s = { ...base, consecutiveLosses: 2, lastCloseAt: 0 };
  expect(canEnter(23 * 3600_000, cfg, s, "kayikci")).toMatchObject({ allow: false, reason: "loss_cooldown_24h" });
  expect(canEnter(24 * 3600_000 + 1, cfg, s, "kayikci").allow).toBe(true);
});
test("reentrancy marker vetoes a second entry", () => {
  expect(canEnter(1e12, cfg, { ...base, inFlight: true }, "avci")).toMatchObject({ allow: false, reason: "reentrancy_in_flight" });
});
```

## References
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position) — `/v5/position/list` to confirm fills and clear the reentrancy marker on reconcile.
- [Bybit V5 — Get Open Orders](https://bybit-exchange.github.io/docs/v5/order/open-order) — query by `orderLinkId` to see if an in-flight entry already landed (complements the marker).
- [Bybit V5 — Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — `orderLinkId` idempotency the reentrancy guard pairs with.
- [Bybit V5 — Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — why polling ticks overlap and double-open windows exist; budget guard-state reads.
- [Drizzle ORM — MySQL get started](https://orm.drizzle.team/docs/mysql/get-started-mysql) — transactional writes for symbol-lock + in-flight markers; idempotent ensure-schema.
- [Drizzle ORM — Transactions](https://orm.drizzle.team/docs/transactions) — atomically claim symbol-lock and set the in-flight marker so two ticks can't both open.
- [Bun — Test runner](https://bun.com/docs/cli/test) — `bun test` for boundary tests on each guard predicate.
- [Investopedia — Trading Cooldown / Overtrading discipline](https://www.investopedia.com/terms/o/overtrading.asp) — rationale for post-loss cooldowns to curb revenge/thrash entries.
