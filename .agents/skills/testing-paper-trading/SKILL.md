---
name: testing-paper-trading
description: Safely testing this Bun + TypeScript multi-bot Bybit trading codebase before real capital is at risk. Covers Bun's built-in test runner (`bun test`) for TDD of the pure-core decision functions in packages/ (TP/SL/trailing, layering, guards, sizing, PnL), Vitest as an alternative runner, deterministic/reproducible tests (fixed seeds, frozen time, recorded candle fixtures, no look-ahead / no next-bar peeking), mocking Bybit V5 signed REST responses at the client boundary, property-based testing with fast-check, Bybit testnet (api-testnet.bybit.com) vs demo trading (api-demo.bybit.com) for integration/smoke, a dry-run mode that reads live prices but never sends orders, and gating deploy (push to main -> Dokploy) behind green tests. Invoke when the task mentions bun test, vitest, unit test, TDD, pure core, deterministic, reproducible, fixed seed, freeze time, candle fixture, look-ahead, mock Bybit, respond stub, fast-check, property-based, testnet, demo trading, dry-run, smoke test, CI gate, or "test before going live".
---

# Testing & Paper Trading

## When to use this skill
- Writing `bun test` unit tests for pure-core decision functions in `packages/` (TP/SL/trailing, layering/katman adds, guards, position sizing, PnL, tick/step rounding).
- Adding Vitest as an alternative runner (e.g. for React/Vite front-end or shared config).
- Making tests deterministic: fixed seeds, frozen time, recorded candle fixtures, guaranteed no look-ahead.
- Mocking Bybit V5 signed REST so tests run offline and reproducibly.
- Wiring a dry-run mode or pointing the engine at Bybit **testnet**/**demo** for integration/smoke tests.
- Setting up the CI gate so a push to `main` only deploys via Dokploy after tests pass.

## Core concepts
The architecture is **pure core / dirty shell**: decision math is pure, side-effect-free TypeScript in `packages/` (TDD'd), and exchange/DB I/O lives in the engine files. Testing exploits this — the pure core is trivially unit-testable with no network. (Known deviation: the Bybit engine partly inlines logic instead of calling the pure core; steer new logic into the pure package so it's testable.)

Defense-in-depth, cheapest → most realistic:
1. **Unit tests** (`bun test`) — pure decision functions with fixture inputs. Millisecond feedback, TDD.
2. **Property-based tests** (fast-check) — invariants over generated inputs (PnL sign, rounding idempotence, monotonic trailing).
3. **Recorded-fixture replay** — feed recorded candle/position JSON through the same decision path; regression-pin outputs.
4. **Dry-run / paper** — live prices polled from Bybit, decisions computed, but **no order is ever sent**.
5. **Testnet / demo smoke** — real signed REST + matching engine with fake money; validates HMAC signing, `recvWindow`, rate limits, reconcile.
6. **Mainnet canary** — tiny size, tight caps, watched via the heartbeat + Telegram alerts.

Key hazards:
- **Look-ahead bias**: using a value not yet available at decision time. Since this engine is polling (decide on the latest closed candle, act now), tests must feed only data that existed at the decision instant — never let a fixture include the "future" candle the function shouldn't see.
- **Reproducibility**: same inputs → same output. Requires fixed RNG seeds, frozen clock, pinned candle fixtures, and stable coin lists.
- **Testnet ≠ demo ≠ live**: fills, prices, and liquidity differ. Dry-run narrows the gap but still won't reproduce fills that depend on your own market impact.

## Codebase specifics (Bun test / Vitest / Bybit / this platform)
- **`bun test`** is the primary runner: Jest-compatible API (`describe/test/expect`, `beforeEach`, `mock`, `spyOn`), native TypeScript, no config. It auto-discovers `*.test.ts` / `*.spec.ts`. Run the whole suite with `bun test`, one file with `bun test path/to/x.test.ts`, and filter with `-t "name"`. Use `--coverage` for coverage.
- **Vitest** is the documented alternative (Vite-native, same Jest-like API) — useful for the React 19 + Vite front-end or when a package needs Vitest tooling. Keep the pure core runnable under **both**; don't import Bun-only globals in shared packages.
- **Test the pure core, mock the shell.** Unit tests import the decision functions directly and pass plain fixtures (candles, current position, config). No `fetch`, no DB. Mock Bybit only for the thin client-boundary integration tests.
- **Deterministic time & randomness**: freeze the clock by injecting a `now()` (or `setSystemTime` from `bun:test`) and seed any RNG; never call `Date.now()` / `Math.random()` deep inside decision logic — pass them in.
- **Recorded candle fixtures**: capture real Bybit kline / position payloads to JSON under a `__fixtures__` dir and replay them through the same parsing + decision path. This pins regressions and removes network flakiness. Ensure a fixture for a "decide at bar t" test does **not** contain bar t+1.
- **Mocking Bybit REST**: stub at the client boundary. With `bun test`, use `mock()` / `spyOn` on the module that wraps `fetch`, or monkeypatch `globalThis.fetch` to return a canned `Response` with the exact V5 shape (`{ retCode: 0, result: {...} }`). Keep the HMAC-SHA256 signing code itself tested separately with a known vector.
- **Property-based with fast-check**: express invariants — long PnL is positive iff exit>entry, `roundToTick(roundToTick(x))===roundToTick(x)`, trailing stop is monotonic in the favorable direction, a guard that blocks never also permits. fast-check runs a fixed seed for reproducibility and shrinks failures to a minimal case.
- **Bybit testnet vs demo** (don't confuse them): **testnet** REST `https://api-testnet.bybit.com`, a fully separate site/accounts, fund via the testnet faucet — good for signing/rate-limit/reconcile validation but with unrealistic prices. **Demo trading** REST `https://api-demo.bybit.com` runs on **mainnet market data** in UTA, seeds ~50,000 USDT / 50,000 USDC / 1 BTC / 1 ETH, and its key is created from the **mainnet** site (not testnet). Demo has **no WebSocket API** — which is fine, this platform is polling-only. Keep the base URL in config; never hard-code mainnet.
- **Dry-run mode**: a config flag where the engine polls real prices and runs the full decision path but the order-placement function is a no-op that logs the intended order + `orderLinkId` instead of calling Bybit. Run a dry-run soak watching the same heartbeat/Telegram alerts as prod before enabling live.
- **CI / deploy gate**: Dokploy auto-builds+deploys on push to `main`. Gate it: CI runs `bun install --frozen-lockfile`, typecheck (`tsc --noEmit`), `bun test` (+ property tests), and ideally a testnet/demo smoke run; a red suite must block the merge/deploy. Never deploy live on green unit tests alone — require a testnet smoke.

## Implementation checklist
- [ ] Keep decision math in `packages/` pure and side-effect-free; inject `now`/RNG; unit-test it with `bun test`.
- [ ] Cover TP/SL/trailing triggers, layering add thresholds, each guard (news/calendar/BTC-shock/cooldown), sizing, PnL, and Bybit tick/step rounding.
- [ ] Property-test invariants with fast-check (PnL sign, rounding idempotence, trailing monotonicity), fixed seed, modest runs in PR CI.
- [ ] Freeze time and seed RNG so every test/replay reproduces exactly; no `Date.now()`/`Math.random()` inside core.
- [ ] Store recorded candle/position fixtures under `__fixtures__`; assert a "decide at t" fixture excludes bar t+1 (no look-ahead).
- [ ] Mock Bybit at the client boundary (`mock`/`spyOn`/stub `fetch`) returning exact V5 `{retCode,result}` shapes; test HMAC signing with a known vector.
- [ ] Provide a dry-run mode: live prices in, full decision path, order placement no-op that logs intent + `orderLinkId`.
- [ ] Run a **testnet smoke**: authenticate, place+cancel an order, fetch positions, run one reconcile — proves signing/`recvWindow`/rate-limit/reconcile.
- [ ] Run a **demo/dry-run soak** on live prices before mainnet, watching heartbeat + Telegram alerts.
- [ ] CI on every PR: `bun install --frozen-lockfile`, `tsc --noEmit`, `bun test` (+ property + fixture replay); block merge on red.
- [ ] Deploy gate: only let a push to `main` reach Dokploy after green tests; start mainnet as a tiny canary.

## Do / Don't
**Do**
- Push new decision logic into the pure `packages/` core so it's unit-testable without network.
- Inject time and randomness; freeze/seed them in tests for exact reproducibility.
- Mock Bybit at the client boundary so tests are offline, fast, and deterministic.
- Keep the pure core runnable under both `bun test` and Vitest.
- Run testnet/demo/dry-run before mainnet and expect fills to differ.

**Don't**
- Don't create a demo key from the testnet site (demo lives on mainnet), and don't expect a demo WebSocket API.
- Don't let a fixture for "decide at bar t" contain bar t+1 — that silently introduces look-ahead.
- Don't call `Date.now()`/`Math.random()`/`fetch` deep inside decision math — pass dependencies in.
- Don't let a test hit the real network — flaky, slow, and can place real orders if misconfigured.
- Don't ship to live (Dokploy on `main`) on green unit tests alone — require a testnet/demo smoke run.

## Common pitfalls
- **Look-ahead in fixtures**: including the not-yet-closed candle so a signal "works" in test but not live.
- **Non-deterministic tests**: unseeded fast-check-adjacent RNG, real `Date.now()`, or a live `fetch` → flaky CI.
- **Testnet price divergence**: thin testnet books give unrealistic prices; use **demo** (mainnet data) for price realism.
- **Untested signing**: mocking so high that HMAC-SHA256 signing / `recvWindow` is never exercised — validate it on testnet.
- **Fees & funding ignored**: perpetual funding + taker fees can flip a "profitable" path negative; model them in PnL tests.
- **Logic inlined in the engine**: decision code stuck in the dirty shell can't be unit-tested — extract it to the pure core.
- **Dry-run that still sends**: a dry-run flag that forgets one order-placement path and hits mainnet — assert zero real calls in dry-run.
- **Green-on-merge, red-in-prod**: no testnet smoke in the gate, so a signing/reconcile regression reaches Dokploy.

## Code patterns
```typescript
// Pure-core unit test with bun test — inject time, no network. TDD the decision functions.
import { test, expect } from "bun:test";
import { shouldClose } from "../packages/core/exits"; // pure: (position, price, cfg) => Decision

test("long hits take-profit at the TP price", () => {
  const pos = { side: "Buy" as const, entry: 100, qty: 1, tp: 110, sl: 95 };
  expect(shouldClose(pos, 110).action).toBe("close");   // TP trigger
  expect(shouldClose(pos, 104).action).toBe("hold");    // no trigger
});
```

```typescript
// Property-based invariants with fast-check — fixed seed, shrinks failures.
import { test, expect } from "bun:test";
import fc from "fast-check";
import { realizedPnl, roundToTick } from "../packages/core/math";

test("long PnL is positive iff exit>entry", () => {
  fc.assert(fc.property(
    fc.double({ min: 1, max: 1e6, noNaN: true }),
    fc.double({ min: 1, max: 1e6, noNaN: true }),
    fc.double({ min: 1e-4, max: 100, noNaN: true }),
    (entry, exit, qty) => (realizedPnl("Buy", entry, exit, qty) > 0) === (exit > entry),
  ), { seed: 42 });
});

test("roundToTick is idempotent", () =>
  fc.assert(fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }),
    (x) => roundToTick(roundToTick(x, 0.5), 0.5) === roundToTick(x, 0.5)), { seed: 42 }));
```

```typescript
// Mock Bybit V5 REST at the fetch boundary + frozen clock -> deterministic integration test.
import { test, expect, mock, setSystemTime } from "bun:test";

test("place order parses the V5 response and keeps orderLinkId", async () => {
  setSystemTime(new Date("2026-07-05T00:00:00Z"));           // freeze time
  globalThis.fetch = mock(async () => new Response(
    JSON.stringify({ retCode: 0, result: { orderId: "abc", orderLinkId: "lnk-1" } }),
    { status: 200 })) as unknown as typeof fetch;
  const r = await placeOrder({ symbol: "BTCUSDT", side: "Buy", qty: "0.001", orderLinkId: "lnk-1" });
  expect(r.retCode).toBe(0);
  expect(r.result.orderLinkId).toBe("lnk-1");               // idempotency id preserved
  setSystemTime();                                          // restore
});
```

```typescript
// Dry-run: same decision path, order placement is a no-op that logs intent instead of calling Bybit.
async function submitOrder(o: OrderIntent, cfg: { dryRun: boolean }) {
  if (cfg.dryRun) {
    log({ event: "dryrun.order", ...o, orderLinkId: o.orderLinkId }); // never hits Bybit
    return { retCode: 0, result: { orderId: `dry-${o.orderLinkId}` } };
  }
  return bybitCreateOrder(o); // real signed REST only when live
}
```

## References
- [Bun — Test runner](https://bun.com/docs/test) — `bun test`, Jest-compatible API, TS support, `--coverage`, filtering.
- [bun:test — API reference](https://bun.com/reference/bun/test) — `mock`, `spyOn`, `setSystemTime`, lifecycle hooks.
- [Vitest — Getting Started](https://vitest.dev/guide/) — alternative Vite-native runner with a Jest-like API.
- [fast-check](https://fast-check.dev/) — property-based testing for TS: arbitraries, seeds, shrinking.
- [fast-check with Bun test runner](https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-bun-test-runner/) — wiring fast-check into `bun test`.
- [Bybit V5 — Demo Trading Service](https://bybit-exchange.github.io/docs/v5/demo) — `api-demo.bybit.com`, seeded balances, UTA, no WS API, key created on mainnet.
- [Bybit V5 — Introduction](https://bybit-exchange.github.io/docs/v5/intro) — mainnet/testnet base URLs and environment overview.
- [Bybit V5 — Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) — HMAC signing, `recvWindow`, rate limits to exercise on testnet.
- [Bybit V5 — Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — response shape + `orderLinkId` to assert in mocks.
- [FAQ — Demo Trading (Bybit Help)](https://www.bybit.com/en/help-center/article/FAQ-Demo-Trading) — demo vs testnet differences, requesting more funds.
- [Drizzle ORM — MySQL](https://orm.drizzle.team/docs/mysql/get-started-mysql) — DB access to seed/reset fixtures for integration tests.
