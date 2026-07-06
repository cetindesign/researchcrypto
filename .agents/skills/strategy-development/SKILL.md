---
name: strategy-development
description: Building SkyPower V3 Bybit-fleet decision logic in TypeScript (Bun) as PURE, deterministic, tested functions in a shared package (pure core), kept out of the engine's exchange/DB side effects (dirty shell). Covers hand-rolled indicators in TS (EMA/RSI/ATR/ADX — no pandas); the role strategies — Avci breakout/momentum vs Kayikci cross-sectional trend / breadth; entry/exit rules; the DECREASING profit pyramid (multiplier ≤ 0.7, max 2–3, Avci only) with DCA-on-loss ELIMINATED (loss_layer_enabled 0); the coin-selector and guards (news / calendar / BTC-shock / cooldown); the signal-horizon (15min–4h) vs 3s execution-cadence split; plus avoiding look-ahead on polled klines. Invoke on "strategy", "signal", "indicator", "EMA/RSI/ATR", "breakout", "momentum", "cross-sectional / breadth", "Avci/Kayikci", "entry/exit rule", "layering", "katman", "profit pyramid", "DCA", "coin selector", "guard", "pure core", "look-ahead", "signal horizon vs execution cadence", or how the bot decides to long/short a Bybit perp.
---

# Strategy Development

## When to use this skill
- Designing entry/exit logic: "when should the v3 engine open a long on a Bybit perp?"
- Adding or choosing indicators computed in TypeScript (EMA, RSI, ATR, ADX, SMA) with no Python/pandas.
- Writing the layering (katman) add rules and per-coin candidate scoring in the coin-selector.
- Implementing or tuning the guards (news / calendar / BTC-shock / cooldown) that veto an entry.
- Moving decision math out of the inlined Bybit engine into a pure, `bun:test`-covered package.
- Diagnosing "backtest looks great, live loses money" — usually look-ahead on the still-forming candle.

## Core concepts
- **Pure core / dirty shell.** A strategy is a *pure function*: `(candles, config, guardState) -> Decision`. It performs no `fetch`, no DB read/write, no `Date.now()`, no randomness. All effects (Bybit REST, Drizzle writes) live in the engine (the shell). This is what makes the same code runnable in the live loop AND the backtester, and unit-testable with `bun:test`.
- **Determinism.** Given identical inputs the function must return an identical `Decision` and identical `reason` string. Inject the clock and any thresholds via `config`; never read wall-clock time or env inside the core.
- **Signal generation.** Convert OHLCV klines into a discrete intent — `enterLong` / `enterShort` / `hold` / `close` / `addLayer` — plus risk hints (stop distance, size weight) consumed by the OMS, never acted on inside the core.
- **Indicators in TypeScript.** No pandas-ta / TA-Lib. Hand-roll EMA/RSI/ATR/ADX or use a small TS lib. Rolling indicators (EMA200, ATR14, Wilder RSI) are undefined until enough candles exist — track a `warmup = max lookback` and refuse to emit signals before it.
- **Look-ahead / repainting.** The engine polls REST every ~10s, so the *latest* kline is usually still forming. Decide only on **confirmed/closed** candles; drop the last in-progress bar. Never reference a future bar, whole-array `Math.max`, or an indicator that recomputes past values.
- **Guards gate entries.** An otherwise-valid signal is vetoed by: **news** (Gemini sentiment score too negative for the coin), **calendar** (high-impact event window near now), **BTC-shock** (BTC moved > X% in the lookback → risk-off), and **cooldown** (this symbol/user was stopped-out or entered too recently). Guards are pure predicates over injected state.
- **Role strategies (SkyPower V3).** The same pure-core toolkit expresses two very different signals:
  - **Avci (Hunter) — breakout / momentum.** A *per-symbol* signal: price breaks a recent range (Donchian / N-bar high) or momentum/volume expands (`min_momentum_pct`, `hacim_artisi_enabled`). 1–3 positions, **high threshold** (widen scanning, don't lower the bar), tight ATR stop, fast trailing. Taker OK on a breakout. Only Avci may pyramid.
  - **Kayikci (Boatman) — cross-sectional trend / breadth.** A *fleet-relative* signal: rank the Tier-A universe by trend strength and open the **top-K (10–15)** small positions **in the regime direction** (from the compass — see regime-detection). Diversification comes from **breadth (count), not layering** — Kayikci does **NO** layering. Cut losers with the ATR stop, run winners with the Chandelier trail (atr-adaptive-exits). Post-only limit entry.
- **Decreasing profit pyramid (Avci only).** Add to a **winner**, never a loser, and with **shrinking** size: each add is `multiplier ≤ 0.7` of the prior layer, **max 2–3 layers**, and only after price has advanced `profit_add_step_pct` in your favor. This scales into strength (positive-skew / pyramiding) without the martingale blow-up of averaging down. **DCA-on-loss is ELIMINATED** (`loss_layer_enabled: 0` — proven 1/13 win, −$43.69); never add to a losing position. **Unit caveat:** whether `profit_add_step_pct` / `layer_trigger_type` is price-% or margin-% is UNVERIFIED in the config — confirm from the engine code before trusting a pyramid threshold.
- **Signal horizon vs execution cadence.** The engine polls fast (~3s/10s) but that is **execution cadence, not signal cadence**. Signals and the regime compass are computed on **longer bars (15min–4h)**; the fast loop only *acts* on levels already decided from closed bars. Recomputing a signal or a trailing stop off the still-forming 3s snapshot is the classic repaint bug. Keep the signal function keyed to closed higher-timeframe bars.
- **Layering (katman) — legacy note.** Historically positions were built in layers on drawdown. Under SkyPower V3 that path is **off** (`loss_layer_enabled: 0`); the only surviving "layer" is the decreasing profit pyramid above. When you see katman/add-layer arithmetic, gate it on *profit* progress and the `≤0.7 / max 2–3 / Avci-only` rule, not on drawdown.

## Codebase specifics
- **Where it lives.** Decision math belongs in a shared `packages/` library (the same "pure core" pattern the Binance side already uses), exported as plain functions. The **v3 Bybit engine** (a `~10s` loop in `apps/`) imports and calls them. Known deviation: the Bybit engine currently inlines some of this logic — steer new work back into the pure package so it can be tested.
- **Runtime.** Bun + TypeScript strict. Tests are `*.test.ts` run with `bun test` (`import { test, expect, describe } from "bun:test"`). No Jest, no ts-node.
- **Data shape.** Klines come from polled Bybit V5 REST (`/v5/market/kline`), returned newest-first as string arrays `[start, open, high, low, close, volume, turnover]`. Normalize once (reverse to oldest-first, parse to numbers, drop the unconfirmed last bar) before handing to the core.
- **Config.** Per-user strategy config is read from MySQL via Drizzle and validated with Zod at the edge; the core receives an already-parsed, typed config object — it does not re-read the DB.
- **Decision logging.** Every core `Decision` (including "hold, guard=news") is written by the shell to `v3_decision_log`; position changes go to `v3_position_event`. The core returns a structured, serializable `Decision`; the shell persists it. Keep the `reason` machine-readable (e.g. `guard:btc_shock`).
- **Bybit-only.** Do not add Binance examples here. One-way position mode assumed (`positionIdx: 0`).

## Implementation checklist
- [ ] Define `Decision` and `StrategyConfig` types; validate config with Zod at the shell boundary.
- [ ] Normalize klines: oldest-first, numeric, **drop the unconfirmed last candle**.
- [ ] Compute indicators purely; set `warmup = max(lookbacks)` and return `hold` until enough bars.
- [ ] Express entry/exit as pure predicates over closed-bar indicator values only.
- [ ] Implement guards as pure functions `(candidate, state) -> {allowed, reason}`; run them before any entry.
- [ ] For Avci, implement the decreasing profit pyramid (`multiplier ≤ 0.7`, `max 2–3`, add on *profit* progress only); refuse any loss-add (`loss_layer_enabled: 0`).
- [ ] For Kayikci, rank the Tier-A universe and open top-K in the regime direction with NO layering; drive breakout/momentum for Avci from closed-bar levels.
- [ ] Compute signals on 15min–4h closed bars; let the 3s/10s loop only execute, never re-derive the signal off the forming bar.
- [ ] Return risk hints (stop distance via ATR, size weight) for the OMS; never place orders in the core.
- [ ] Cover every branch with `bun:test`, including a determinism test and a shift/repaint test.
- [ ] Keep `reason` codes stable so `v3_decision_log` stays queryable.

## Do / Don't
**Do**
- Keep the core free of `fetch`, Drizzle, `Date.now()`, `Math.random()` — inject them via arguments/config.
- Decide on the last **closed** candle; treat the polled latest bar as still-forming.
- Return a `Decision` object with a stable `reason`; let the engine write it to `v3_decision_log`.
- Encode every threshold in `StrategyConfig` so the optimizer can tune it without code changes.
- Run guards (news/calendar/BTC-shock/cooldown) before emitting any entry.

**Don't**
- Don't inline decision math inside the Bybit engine loop where it can't be unit-tested.
- Don't read the in-progress candle, use `.slice(-1)` of unconfirmed data, or index future bars.
- Don't call Bybit or the DB from strategy code — that breaks determinism and the backtester.
- Don't hardcode symbol tick/qty precision in the core; that is the OMS's job.
- Don't let a guard depend on wall-clock time directly — pass `now` in as an argument.

## Common pitfalls
- **Forming-candle leak.** Acting on the last polled kline before it closes: it backtests perfectly and loses live. Always drop it.
- **Warmup off-by-one.** Emitting a signal while EMA/RSI is still `undefined`/NaN leaks garbage into rules; gate on `warmup`.
- **Wilder vs SMA smoothing.** RSI/ATR use Wilder's smoothing, not a simple moving average — using the wrong one shifts thresholds and desyncs backtest from live.
- **Hidden nondeterminism.** A `Date.now()`, `Math.random()`, or `Object` key-order dependence inside the core makes tests flaky and backtests non-reproducible.
- **Guard state staleness.** News/calendar scrapers run on their own intervals (news ~3m, calendar ~15m); a guard reading stale rows can wrongly allow/deny. Pass a freshness timestamp and treat stale state as risk-off.
- **BTC-shock lookahead.** Compute the BTC move from closed bars only; using the current tick makes the guard fire inconsistently.
- **Over-parameterization.** Every new threshold is another degree of freedom for the optimizer to curve-fit; justify each.

## Code patterns
Pure indicators (Wilder RSI/ATR, EMA) in TypeScript — no external deps:

```ts
export function ema(values: number[], length: number): (number | undefined)[] {
  const k = 2 / (length + 1);
  const out: (number | undefined)[] = [];
  let prev: number | undefined;
  values.forEach((v, i) => {
    if (i + 1 < length) { out.push(undefined); return; }
    if (prev === undefined) {                       // seed with SMA of first `length`
      prev = values.slice(i - length + 1, i + 1).reduce((a, b) => a + b, 0) / length;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  });
  return out;
}

export function rsiWilder(close: number[], length = 14): (number | undefined)[] {
  const out: (number | undefined)[] = [undefined];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < close.length; i++) {
    const ch = close[i] - close[i - 1];
    const gain = Math.max(ch, 0), loss = Math.max(-ch, 0);
    if (i <= length) {                              // seed averages
      avgGain += gain / length; avgLoss += loss / length;
      out.push(i === length ? 100 - 100 / (1 + avgGain / (avgLoss || 1e-12)) : undefined);
    } else {
      avgGain = (avgGain * (length - 1) + gain) / length;
      avgLoss = (avgLoss * (length - 1) + loss) / length;
      out.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-12)));
    }
  }
  return out;
}
```

Pure strategy core + guards + layering (deterministic, no side effects):

```ts
export type Candle = { start: number; open: number; high: number; low: number; close: number; volume: number };
export type Decision =
  | { action: "hold" | "enterLong" | "enterShort" | "close"; reason: string; stopDist?: number; sizeWeight?: number }
  | { action: "addLayer"; reason: string; layer: number };

export interface StrategyConfig {
  emaFast: number; emaSlow: number; rsiLen: number; rsiFloor: number; atrLen: number;
  role: "avci" | "kayikci";
  profitLayerEnabled: boolean; profitAddStepPct: number; profitLayerMultiplier: number; profitMaxLayers: number;
  lossLayerEnabled: boolean;   // SkyPower V3: always false — DCA-on-loss eliminated
}
export interface GuardState {
  now: number; newsScore: number; newsAsOf: number;
  calendarBlockedUntil: number; btcMovePct: number; cooldownUntil: number;
}

// Pure predicate: returns the first guard that vetoes, or null if allowed.
export function guardEntry(g: GuardState, cfg: { newsFloor: number; btcShockPct: number; staleMs: number }): string | null {
  if (g.now - g.newsAsOf > cfg.staleMs) return "guard:news_stale";      // stale => risk-off
  if (g.newsScore < cfg.newsFloor) return "guard:news";
  if (g.now < g.calendarBlockedUntil) return "guard:calendar";
  if (Math.abs(g.btcMovePct) >= cfg.btcShockPct) return "guard:btc_shock";
  if (g.now < g.cooldownUntil) return "guard:cooldown";
  return null;
}

export function decide(
  candles: Candle[], cfg: StrategyConfig, g: GuardState,
  pos: { size: number; avgPrice: number; layers: number } | null,
): Decision {
  const closed = candles.slice(0, -1);                 // drop the still-forming polled bar
  const warmup = Math.max(cfg.emaSlow, cfg.rsiLen, cfg.atrLen);
  if (closed.length <= warmup) return { action: "hold", reason: "warmup" };

  const close = closed.map((c) => c.close);
  const f = ema(close, cfg.emaFast).at(-1)!;
  const s = ema(close, cfg.emaSlow).at(-1)!;
  const r = rsiWilder(close, cfg.rsiLen).at(-1)!;
  const atr = /* wilder ATR of high/low/close */ 0;    // see rsiWilder pattern
  const last = close.at(-1)!;

  if (pos && pos.size > 0) {                            // manage an existing long
    const profitPct = (last - pos.avgPrice) / pos.avgPrice * 100;
    if (f < s) return { action: "close", reason: "signal:ema_flip" };
    // Decreasing profit pyramid — Avci only, add to a WINNER, never a loser (loss_layer_enabled:0).
    if (cfg.role === "avci" && cfg.profitLayerEnabled && !cfg.lossLayerEnabled
        && profitPct >= cfg.profitAddStepPct * (pos.layers + 1)     // next rung is further in profit
        && pos.layers < cfg.profitMaxLayers)                        // max 2–3 layers
      return { action: "addLayer", reason: "pyramid:profit", layer: pos.layers + 1 };
    return { action: "hold", reason: "in_position" };
  }

  const bullish = f > s && r > cfg.rsiFloor;
  if (!bullish) return { action: "hold", reason: "no_signal" };
  const veto = guardEntry(g, { newsFloor: -0.3, btcShockPct: 3, staleMs: 10 * 60_000 });
  if (veto) return { action: "hold", reason: veto };
  return { action: "enterLong", reason: "signal:ema_cross+rsi", stopDist: 2 * atr, sizeWeight: 1 };
}
```

Pure decreasing-pyramid layer size (base qty geometrically shrinks; `multiplier ≤ 0.7`):
```ts
// layer 0 = base entry; each subsequent add is `multiplier`^layer of the base. Avci only.
export function pyramidLayerQty(baseQty: number, layer: number, multiplier = 0.7, maxLayers = 3): number {
  if (multiplier > 0.7) throw new Error("profit pyramid multiplier must be <= 0.7 (decreasing)");
  if (layer < 1 || layer > maxLayers) return 0;                 // no loss-DCA, capped at 2–3 rungs
  return baseQty * multiplier ** layer;
}
```

Determinism + repaint test with `bun:test`:

```ts
import { test, expect } from "bun:test";

test("decide is deterministic", () => {
  const a = decide(candles, cfg, guard, null);
  const b = decide(structuredClone(candles), cfg, structuredClone(guard), null);
  expect(a).toEqual(b);
});

test("historical decisions are stable as more candles arrive (no repaint)", () => {
  const full = decide(candles, cfg, guard, null);
  const past = decide(candles.slice(0, -1), cfg, guard, null); // one fewer future bar
  expect(past.reason).toBe(full.reason);                       // adding a future bar must not change the past
});
```

## References
- [Bun — Test runner (`bun:test`)](https://bun.com/docs/test) — Jest-style `test`/`expect`/`describe`, watch mode, TS support for the pure-core unit tests.
- [Bun — Documentation](https://bun.com/docs) — runtime, TypeScript execution, and package layout for a Turborepo package.
- [Turborepo — Introduction](https://turborepo.dev/docs) — monorepo `apps/`+`packages/` structure that hosts the pure core separately from the engine.
- [Zod — Introduction](https://zod.dev/) — validate `StrategyConfig` at the shell boundary before it reaches the core.
- [Zod — Defining schemas](https://zod.dev/api) — `z.infer`, `.safeParse` for typed config parsing.
- [Drizzle ORM — MySQL get started](https://orm.drizzle.team/docs/mysql/get-started-mysql) — how the shell reads strategy config and writes `v3_decision_log`.
- [Bybit V5 — Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline) — kline array order `[start,open,high,low,close,volume,turnover]`, newest-first, confirm handling.
- [Bybit V5 — Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — tick/qty precision the OMS applies to the core's size/stop hints.
- [Bybit V5 — Introduction](https://bybit-exchange.github.io/docs/v5/intro) — categories, one-way vs hedge (`positionIdx`) context for entries.
- [Google Gemini API — Docs](https://ai.google.dev/gemini-api/docs) — the news-sentiment source feeding the news guard's score.
- [What's Trending: A Different Point of Skew — Man Group](https://www.man.com/insights/trend-following-different-point-skew) — why adding to winners (pyramiding) and cutting losers, not averaging down, produces positive skew.
- [Creating Portfolio Convexity: Trend Versus Options — Man Group](https://www.man.com/insights/creating-portfolio-convexity) — cross-sectional trend / breadth as the Kayikci signal; convex payoff of running winners.
- [Chandelier Exit — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/chandelier-exit) — the ATR trailing exit the role strategies hand off to (see atr-adaptive-exits).
