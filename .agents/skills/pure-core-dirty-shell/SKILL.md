---
name: pure-core-dirty-shell
description: The platform's central architecture principle — functional core / imperative shell ("pure core / dirty shell"). All trading DECISION MATH (TP/SL/trailing checks, layering/katman thresholds, coin selection, guard evaluation, position sizing) lives as PURE, deterministic, TDD'd TypeScript functions in `packages/` with ZERO I/O; every side effect (Bybit V5 signed REST, MySQL/Drizzle reads & writes, Telegram, logging) lives in thin engine/shell files that call the pure core. Invoke when adding or changing engine decision logic, when a function needs `fetch`/DB/`Date.now()`/`crypto` inside it, when writing Bun unit tests for trading math, when refactoring the v3 Bybit engine, or when the task mentions "pure function", "functional core", "imperative shell", "dependency injection", "testable", "no I/O", "deterministic", or "the engine inlines logic". Enforces the known deviation fix — the Bybit engine must call the pure core, not copy it.
---

# Pure Core / Dirty Shell (Functional Core, Imperative Shell)

## When to use this skill
- Adding or editing any trading DECISION: TP/SL/trailing trigger, layering (katman) add threshold, coin-selector, guard (news/calendar/BTC-shock/cooldown), or position sizing.
- You are about to put `fetch`, a Drizzle query, `Date.now()`, `Math.random()`, or a Telegram call *inside* a function that also computes a decision.
- Writing or extending Bun unit tests (`bun:test`) for the engine's math.
- Refactoring the v3 Bybit engine loop so it stops inlining/copying logic and calls `packages/` instead.
- Reviewing a PR that mixes "what should happen" (decision) with "make it happen" (effect).

## Core concepts
- **Functional core / imperative shell (FCIS):** the *core* is pure functions — inputs in, decision out, no side effects, no hidden state. The *shell* is the thin imperative layer that does I/O and calls the core. Pure functions are trivial to unit-test with no mocks; the shell is exercised by a few integration tests. This split is the platform's #1 architectural rule.
- **Pure = deterministic + no I/O:** same inputs always give the same output; no `fetch`, no DB, no clock, no RNG, no logging, no mutation of arguments. Time, prices, and positions are *passed in* as plain data, never read from the world inside the function.
- **Decision vs effect:** the core answers *"should we close / add / enter, and with what quantity?"* and returns a plain object (e.g. `{ action: "close", reason: "tp_hit", qty }`). The shell reads that object and performs the MARKET order, DB write, and Telegram ping.
- **Dependency injection of effects:** when the core genuinely needs an effect (rare), inject it as a parameter (a function/interface), never import it. Injected effects are stubbed in tests and real in production.
- **Where things live:** decision math → `packages/` (a `packages/binance`-style pure package; for Bybit the equivalent pure package). Side effects (Bybit signed REST, Drizzle, Telegram, `v3_decision_log` / `v3_position_event` writes) → engine/shell files under `apps/`.

## Codebase specifics (Bybit / Bun / this platform)
- **One engine turn is a shell orchestration:** read active user configs from DB → fetch REAL positions from Bybit (signed REST) → reconcile DB to exchange → **call the pure core** to decide TP/SL/trailing, layering, and candidate entry → the shell fires MARKET orders and writes `v3_decision_log` / `v3_position_event`. The *decisions* in the middle are pure; everything around them is dirty.
- **Bybit is polling, not WebSocket:** the shell polls signed REST on the ~10s engine tick (see `rest-polling-and-rate-limits`). Fetched positions/prices are then handed to the pure core as data — the core never knows Bybit exists.
- **Exchange = source of truth, DB = ledger:** reconciliation is a shell concern (see `reconcile-source-of-truth`). The pure core receives the already-reconciled snapshot.
- **Bun test = the enforcement mechanism:** every pure function has a `*.test.ts` next to it using `bun:test`. Because the core has no I/O, these tests need no network, no DB, no mocks — they run in milliseconds and are the TDD safety net for money-moving math.
- **KNOWN DEVIATION (fix this):** the v3 Bybit engine currently **inlines/copies** parts of the decision math directly into the loop instead of importing the pure core. This is bad because (1) the inlined copy is **untested** — it lives in a file full of I/O that unit tests can't reach; (2) it **drifts** from the reference (Binance) engine's pure core, so the two engines silently disagree; (3) it **breaks the principle**, making the loop long, hard to reason about, and impossible to test deterministically. The fix: extract each inlined branch into a pure function in `packages/`, cover it with `bun:test`, and have the engine call it.

## Implementation checklist
- [ ] Decide: is this new code a **decision** (→ `packages/`, pure) or an **effect** (→ engine/shell)? Never both in one function.
- [ ] Pure function signature takes plain data only: numbers, strings, DB row shapes, config objects — no clients, no connections.
- [ ] No `fetch` / Drizzle / `Date.now()` / `Math.random()` / `console.log` inside the core. Pass `now`, `prices`, `positions` in as arguments.
- [ ] Return a plain, serializable **decision object** (`{ action, reason, qty? }`), not a performed action.
- [ ] Write the `bun:test` first (TDD): table-driven cases for TP hit, SL hit, trailing update, layering threshold, each guard.
- [ ] Shell reads the decision and performs the Bybit MARKET order + `v3_decision_log` / `v3_position_event` write + optional Telegram.
- [ ] If refactoring the Bybit engine: move one inlined branch at a time into `packages/`, add tests, delete the copy, keep the diff behavior-preserving.
- [ ] Confirm the Bybit pure core matches the reference engine's core (no drift).

## Do / Don't
- **Do** keep the core deterministic — hand it `now: number` and prices as data.
- **Do** put TP/SL/trailing/layering/guard/sizing math in `packages/` with tests.
- **Do** inject effects as function parameters when the core truly needs one.
- **Do** return decisions; let the shell act on them.
- **Don't** call Bybit REST, Drizzle, or Telegram from inside a decision function.
- **Don't** read the clock or RNG inside the core — that makes tests flaky and non-deterministic.
- **Don't** copy/inline pure logic into the engine loop "to save an import" — that is exactly the deviation to fix.
- **Don't** mutate the input `position`/`config` objects; return new values.

## Common pitfalls
- **Hidden clock:** `Date.now()` inside a trailing-stop check makes it untestable and time-dependent. Pass `now` in.
- **Hidden I/O:** a "pure" sizing function that quietly queries balance from Drizzle is not pure — pass balance in.
- **Effect + decision fused:** a function that computes *and* places the close order can't be unit-tested and can't be reused by both engines.
- **Silent drift:** fixing a rounding bug in the engine's inlined copy but not in `packages/` (or vice-versa) — the two diverge and one is wrong.
- **Over-injecting:** wrapping trivial arithmetic in an injected dependency. Only inject genuine effects (network, DB, clock, RNG).
- **Untested edge cases:** floating-point qty/price rounding, exact-equality triggers, zero/negative quantities — cover them in `bun:test`.

## Code patterns (TypeScript)

**Pure core — `packages/<pure>/src/decide.ts` (no I/O, deterministic):**
```ts
export type Position = { symbol: string; entry: number; qty: number; trailPeak: number };
export type Config = { tpPct: number; slPct: number; trailPct: number };
export type Decision =
  | { action: "hold" }
  | { action: "close"; reason: "tp_hit" | "sl_hit" | "trail_hit"; qty: number }
  | { action: "add"; reason: "layer"; qty: number };

// Everything the function needs is passed in. No fetch, no DB, no clock.
export function decideExit(pos: Position, mark: number, cfg: Config): Decision {
  const pnlPct = (mark - pos.entry) / pos.entry;
  if (pnlPct >= cfg.tpPct) return { action: "close", reason: "tp_hit", qty: pos.qty };
  if (pnlPct <= -cfg.slPct) return { action: "close", reason: "sl_hit", qty: pos.qty };
  const peak = Math.max(pos.trailPeak, mark);
  if (mark <= peak * (1 - cfg.trailPct))
    return { action: "close", reason: "trail_hit", qty: pos.qty };
  return { action: "hold" };
}
```

**Bun test — `packages/<pure>/src/decide.test.ts` (no mocks needed):**
```ts
import { describe, test, expect } from "bun:test";
import { decideExit } from "./decide";

const cfg = { tpPct: 0.02, slPct: 0.01, trailPct: 0.005 };

describe("decideExit", () => {
  const pos = { symbol: "BTCUSDT", entry: 100, qty: 1, trailPeak: 100 };
  test("take-profit fires at +2%", () =>
    expect(decideExit(pos, 102, cfg).action).toBe("close"));
  test("stop-loss fires at -1%", () =>
    expect(decideExit(pos, 99, cfg)).toEqual({ action: "close", reason: "sl_hit", qty: 1 }));
  test("holds inside the band", () =>
    expect(decideExit(pos, 101, cfg).action).toBe("hold"));
});
```

**Deviation — BEFORE (Bybit engine inlines the math; untested, drifts):**
```ts
// apps/server/src/engine/bybit.ts  — ❌ decision logic buried in the I/O loop
for (const pos of positions) {
  const mark = await getBybitMark(pos.symbol);        // I/O
  const pnl = (mark - pos.entry) / pos.entry;
  if (pnl >= cfg.tpPct || pnl <= -cfg.slPct) {         // copied logic — no test reaches this
    await placeBybitMarketClose(pos.symbol, pos.qty);  // I/O
    await db.insert(v3DecisionLog).values({ /* ... */ });
  }
}
```

**Deviation — AFTER (shell calls the pure core; core is tested, single source of truth):**
```ts
// apps/server/src/engine/bybit.ts  — ✅ thin shell: fetch → decide (pure) → act
import { decideExit } from "@repo/decision"; // the shared pure package

for (const pos of positions) {
  const mark = await getBybitMark(pos.symbol);         // I/O (shell)
  const decision = decideExit(pos, mark, cfg);         // pure core — same fn the tests cover
  if (decision.action === "close") {
    await placeBybitMarketClose(pos.symbol, decision.qty);        // I/O (shell)
    await db.insert(v3DecisionLog).values({
      symbol: pos.symbol, reason: decision.reason, qty: decision.qty,
    });                                                            // I/O (shell)
  }
}
```

**Injecting an effect when the core truly needs one (higher-order function):**
```ts
// If a decision legitimately needs "now", inject it — don't read the clock inside.
export function decideCooldown(lastEntryMs: number, cooldownMs: number, now: number): boolean {
  return now - lastEntryMs >= cooldownMs; // pure: `now` is data
}
// Shell supplies the real clock; tests supply a fixed number.
const ok = decideCooldown(pos.lastEntryMs, cfg.cooldownMs, Date.now());
```

## References
- [Functional Core, Imperative Shell (Destroy All Software)](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell) — the canonical screencast that named the pattern.
- [Functional Core, Imperative Shell — functional-architecture.org](https://functional-architecture.org/functional_core_imperative_shell/) — pattern definition: pure core, effectful shell.
- [Functional core, imperative shell in JavaScript (Magnus Tovslid)](https://medium.com/@magnusjt/functional-core-imperative-shell-in-javascript-29bef2353ac2) — JS/TS-flavored walkthrough.
- [Functional Core, Imperative Shell: Separating Logic from Side Effects](https://allarddewinter.net/blog/functional-core-imperative-shell-separating-logic-from-side-effects/) — testing benefits (no mocks for the core).
- [Functional core, imperative shell — MarsBased](https://marsbased.com/blog/2020/01/20/functional-core-imperative-shell) — practical framing of core vs shell responsibilities.
- [Functional Dependency Injection in TypeScript (Hassan Nteifeh)](https://hassannteifeh.medium.com/functional-dependency-injection-in-typescript-4c2739326f57) — injecting effects as function parameters in TS.
- [Purely functional dependency injection in TypeScript (anttih.com)](https://anttih.com/articles/2018/07/05/purely-functional-di) — two-layer (uninjected/injected) structure for testable code.
- [Bun — Test runner](https://bun.com/docs/test) — `bun:test`, `describe`/`test`/`expect`, watch mode, TDD workflow.
- [Test-Driven Development (TDD) with Bun Test](https://dev.to/robertobutti/test-driven-development-tdd-with-bun-test-4nnh) — red-green-refactor with Bun's runner.
