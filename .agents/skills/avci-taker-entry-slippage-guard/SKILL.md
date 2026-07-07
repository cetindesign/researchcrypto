---
name: avci-taker-entry-slippage-guard
description: Avci (Hunter) is the TAKER exception to SkyPower V3's maker-execution-cost-control (Kayikci's post-only rule) — Avci's honest execution cost model and microstructure entry gate, pure TS in packages/, bun test. The maker/taker fee gap (taker 0.055% vs maker 0.02%) is a RED HERRING; the real lever and primary blow-up path is SLIPPAGE — especially EXIT slippage on thin Tier-B stop-outs during a sweep, which can exceed the whole 1.5xATR stop. Avci takes because speed IS the edge, but only through an entry-instant re-poll of ticker/orderbook (reject on wide spread or thin depth <$100k/side), never a naked MARKET: use Bybit slippageToleranceType+slippageTolerance (IOC-limit capped N bps) with the adverse-selection caveat that the fastest breaks get swept inside the cap. Models EXIT slippage per Tier and feeds it to sizing and the disaster stop. Use for Avci taker entry, slippage guard, IOC slippage tolerance, exit-slippage modeling. See maker-execution-cost-control, avci-volatility-position-sizing.
---

# Avci Taker Entry & Slippage Guard (Bybit Perpetuals, TypeScript)

## When to use this skill
- Deciding when Avci **takes** (genuine breakout) vs when it should defer to the maker path — Avci is the **exception** to Kayikci's post-only rule (see maker-execution-cost-control).
- Building the **entry-instant microstructure gate**: re-poll ticker/orderbook and reject if spread or depth fail.
- Wiring the **protected taker fallback** (`slippageToleranceType` + `slippageTolerance`, IOC-limit capped N bps) instead of a naked MARKET.
- **Modeling EXIT slippage per Tier** and feeding it into position sizing and the disaster-stop distance.
- Explaining why the **fee gap is a red herring** and **exit slippage on thin Tier-B stop-outs is the primary blow-up path**.

## Core concepts

**The fee gap is a red herring; slippage is the lever.** Bybit V5 charges **taker 0.055%, maker 0.02%**, so posting saves only **0.035%/side** (round-trip taker 0.11% vs maker 0.04%). On a thin coin, a single market fill can move price a whole percent — realistic **0.1-0.5%+ entry slippage dwarfs the 0.035% fee delta**. Shaving fees is optimizing the small number. The real cost is slippage, and the biggest slippage is on the **exit**, not the entry.

**EXIT slippage on thin Tier-B stop-outs is the primary blow-up path.** The whole risk model rests on a 1.5xATR stop, but on a ~$20M-turnover Tier-B coin a **stop-market during a liquidity sweep blows straight through that cushion** — the pre-breakout book is calm, but at the stop-trigger instant the book is thin and one-sided. Entry slippage on a ~$15-45 notional is trivial; **EXIT slippage when stops cluster is where the money actually dies**, and it is what makes the realized average loss materially larger than 1.5xATR. This is unmodeled in the naive design and must be budgeted explicitly.

**Why Avci takes anyway (speed IS the edge).** For a genuine accelerating breakout, a chasing maker is **systematically NOT filled exactly when the trade is good** — academic LOB evidence (Oxford/QMUL "To Make, or to Take", Binance BTC-perp live experiment; DeLise "Negative Drift of a Limit Order Fill") shows maker fill probability is *negatively* correlated with subsequent favorable return. So on a real breakout the correct primitive is **taker-with-protection**, and "the main hurdle with taker orders is overcoming the taker fee" — which is small. Avci takes; Kayikci posts. `taker_on_breakout_only=1` keeps the taker path scoped to confirmed breakouts, not every entry.

**Entry-instant microstructure gate.** Before firing the taker order, **re-poll ticker + orderbook at the entry instant** (the calm pre-breakout snapshot is stale) and reject if:
- `spread > max_spread_pct` (0.15%), or
- top-of-book depth on the fill side `< min_depth_usd` (~$100k/side).

A signal that passed the universe screen can still be un-fillable at the trigger instant; this gate is the last defense before you become the liquidity.

**Protected taker fallback (never a naked MARKET).** Use Bybit's **`slippageToleranceType` + `slippageTolerance`** — the market order is converted into an **IOC limit** rejected if the book has nothing inside tolerance — or construct your own IOC limit capped **N bps from Ask1/Bid1**. Cap by Tier: **Tier-A 5-10 bps, Tier-B 20-50 bps**.

**The adverse-selection caveat (honest).** The same adverse-selection logic that hurts makers also hurts a capped taker: on the **fastest, best breakouts the book inside the cap is exactly what gets swept**, so the order **REJECTS on the best trades and FILLS in calm chop / fakeouts**. There is no free lunch — a tight cap systematically selects *against* the trades you most want. Size the cap accepting that Avci is **few-and-selective**: a wider Tier-B cap fills more real breaks at worse prices; a tight cap misses them. Pick deliberately and validate against realized fills, not intuition.

**Model exit slippage and feed it forward.** Maintain a per-Tier **exit-slippage bps model** (Tier-A 5-10, Tier-B 20-50, widened for sweep conditions) and pipe it into:
1. **Sizing** — add it to the stop distance so the dollar risk reflects the *real* stop-out loss, not the nominal 1.5xATR (see avci-volatility-position-sizing `effectiveStopFrac`).
2. **The disaster stop** — the exchange-side backstop must sit wide enough that the modeled sweep-slippage still leaves margin above maintenance (see atr-adaptive-exits).

## Codebase specifics

**Pure core / dirty shell.** All cost/slippage/gate math is **pure functions in `packages/`** (e.g. `packages/avci-exec`): the spread/depth predicate, the slippage-cap formula, the round-trip cost (incl. funding + per-layer taker), the per-Tier exit-slippage model, and the cost-adjusted edge gate. No I/O. The **dirty shell** owns only: the entry-instant `GET /v5/market/tickers` + `GET /v5/market/orderbook` re-poll, and the `POST /v5/order/create` taker with `slippageTolerance`. Unit-test the core with `bun test`.

**`v3_coin_config` keys.**
- Existing: `max_spread_pct=0.15`, `entry_usdt=15`, `leverage=3`, `min_volume_usdt=20000000`, `stop_loss_pct=1.5` (ATR multiple).
- NEW (conservative defaults, offline-swept only; `optimizer_enabled` stays 0): `slippage_tolerance_bps` (Tier-A 5-10 / Tier-B 20-50), `min_depth_usd=100000`, `taker_on_breakout_only=1`, `exit_slippage_bps_model` (per-Tier; **feeds sizing and the disaster stop**).
- **Units:** `max_spread_pct` is a percent; slippage/exit models are in **bps** (1 bp = 0.01%). Convert consistently at the shell boundary.

**Honest all-in round-trip (not 0.11%).** For hours-held positions the true round-trip is plausibly **0.2-0.4%+**: `2*taker (0.11%) + entry slippage + exit slippage (the big one) + 8h funding per settlement crossed + taker on every pyramid layer`. The cost-adjusted edge gate must require expected captured move `>>` this all-in cost, using the **captured** move after entry lag (you enter *after* the ROC prints, so you do NOT capture the full `min_momentum_pct 5`).

**Endpoints.** Re-poll: `GET /v5/market/tickers` (spread from bid1/ask1), `GET /v5/market/orderbook` (category `linear`, top-of-book depth). Place: `POST /v5/order/create` (`orderType:"Market"` + `slippageToleranceType`/`slippageTolerance`, or `orderType:"Limit"` + `timeInForce:"IOC"` capped off touch), pre-persisted `orderLinkId`. See order-execution-oms for signing/idempotency, rest-polling-and-rate-limits for budget.

**Audit.** Log the gate outcome + fill vs modeled slippage to `v3_decision_log` (reasons: `taker_gate:spread_reject`, `taker_gate:depth_reject`, `taker:filled`, `taker:ioc_reject`, `taker:adverse_reject`) and the fill to `v3_position_event`. Track realized-vs-modeled exit slippage so the model is recalibrated on own data.

## Implementation checklist
- [ ] Pure `passMicrostructure({spreadPct, depthUsd}, {maxSpreadPct, minDepthUsd})` → reject on spread or thin depth.
- [ ] Pure `slippageCapBps(tier, spreadPct)` clamped to the Tier band (A 5-10 / B 20-50).
- [ ] Pure `exitSlippageBps(tier, sweep)` → per-Tier model, widened under sweep conditions; export a fraction for sizing.
- [ ] Pure `allInRoundTrip({takerBps, entrySlipBps, exitSlipBps, fundingBps, layers})` and a `costAdjustedEdgeOk(capturedMove, allIn, margin)` gate.
- [ ] Feed `exitSlippageBps` into `avci-volatility-position-sizing` (effective stop) AND the `atr-adaptive-exits` disaster-stop distance.
- [ ] Shell: **re-poll** ticker + orderbook at the entry instant (never trust the screen snapshot); run the gate.
- [ ] Shell: taker via `slippageToleranceType`/`slippageTolerance` (or IOC limit capped N bps); never a naked MARKET.
- [ ] Shell: on IOC/tolerance reject, log `taker:adverse_reject` and do NOT retry as a naked market — a missed fast break is cheaper than a swept fill.
- [ ] `bun test`: spread/depth rejects, cap clamps to Tier band, all-in > 0.11% with funding+layers, edge gate blocks when captured move ≤ cost.

## Do / Don't
**Do**
- Re-poll the book at the **entry instant**; reject if spread > `max_spread_pct` or depth < `min_depth_usd`.
- Take with **`slippageTolerance` / IOC-limit caps**, sized by Tier; treat the cap as a deliberate selectivity choice.
- **Model EXIT slippage per Tier** and feed it to sizing and the disaster stop — that is where the loss distribution lives.
- Compute the honest **all-in** round-trip (taker×2 + slippage + funding + per-layer taker), and gate edge against the *captured* move.
- Keep `taker_on_breakout_only=1` — take only genuine breakouts; defer everything else to the maker path.

**Don't**
- Don't optimize the 0.035% fee gap — it is a red herring next to slippage.
- Don't send a **naked MARKET** on a thin coin; and don't retry a rejected IOC as a market "to make sure it fills".
- Don't model risk off the nominal 1.5xATR stop — exit slippage on a sweep exceeds it; budget for the real loss.
- Don't assume you capture the full ROC — you enter *after* it prints; use the captured move net of entry lag.
- Don't ignore funding/per-layer taker on hours-held pyramided positions — that is what flips marginal setups negative.

## Common pitfalls (critic's weakest-points, encoded)
- **Exit slippage through the stop (the #1 blow-up path).** A Tier-B stop-market during a sweep fills far past the 1.5xATR level; realized average loss is materially larger than the design assumes. Model it and size against it.
- **Adverse selection of the cap.** A tight IOC/tolerance cap fills in calm chop and **rejects the best fast breaks** — it can systematically select FOR the worse trades. Choose the cap knowing this; validate on realized fills.
- **Stale pre-breakout book.** The depth that passed the universe screen evaporates at the trigger instant. The calm book is not the fill book — re-poll.
- **Under-costed hours-held positions.** Quoting 0.11% ignores 8h funding, per-layer taker, and exit slippage; the honest all-in is ~0.2-0.4%+, which flips several marginal setups to negative expectancy.
- **Entry-lag illusion.** `min_momentum_pct 5` looks like a ~40x cost cushion, but you enter after the move and risk 1.5xATR — the real captured-move-vs-cost ratio is far smaller. Gate on captured move, not the trigger ROC.
- **Wash/manipulable depth.** Turnover on a $20M coin can be wash-traded; top-of-book depth can be spoofed. The gate is necessary but not sufficient — pair with the universe integrity checks (coin-universe-selection).

## Code patterns

Pure microstructure gate + slippage-cap + honest all-in cost (`packages/avci-exec`):
```ts
export type Tier = "A" | "B";
export const TAKER = 0.00055;                                        // Bybit perp taker; read live for VIP

// Entry-instant gate: reject if spread too wide or top-of-book too thin (re-polled, not the screen snapshot).
export function passMicrostructure(
  s: { spreadPct: number; depthUsd: number },
  cfg: { maxSpreadPct: number; minDepthUsd: number },
): { ok: boolean; reason?: string } {
  if (s.spreadPct > cfg.maxSpreadPct) return { ok: false, reason: "taker_gate:spread_reject" };
  if (s.depthUsd < cfg.minDepthUsd)   return { ok: false, reason: "taker_gate:depth_reject" };
  return { ok: true };
}

// IOC/tolerance cap in bps, clamped to the Tier band. Wider cap fills more real breaks at worse prices.
export function slippageCapBps(tier: Tier, spreadPct: number): number {
  const band = tier === "A" ? [5, 10] : [20, 50];
  const fromSpread = 2 * spreadPct * 100;                            // ~2x half-spread, in bps
  return Math.min(band[1], Math.max(band[0], fromSpread));
}

// Per-Tier EXIT slippage — the number that actually determines the loss distribution. Widen under a sweep.
export function exitSlippageBps(tier: Tier, sweep: boolean): number {
  const base = tier === "A" ? 8 : 35;
  return sweep ? base * 2 : base;                                    // sweeps blow through the nominal stop
}

// Honest all-in round-trip (fraction of notional): taker x2 + slippage + funding + per-layer taker.
export function allInRoundTrip(p: {
  entrySlipBps: number; exitSlipBps: number; fundingBps: number; layers: number;
}): number {
  const takerLegs = TAKER * (2 + Math.max(0, p.layers - 1));         // entry + exit + each extra pyramid layer
  return takerLegs + (p.entrySlipBps + p.exitSlipBps + p.fundingBps) / 10_000;
}

// Cost-adjusted edge gate: require the CAPTURED move (net of entry lag) to clear all-in cost with margin.
export function costAdjustedEdgeOk(capturedMoveFrac: number, allIn: number, edgeMargin = 3): boolean {
  return capturedMoveFrac >= edgeMargin * allIn;
}
```

Dirty-shell protected taker (re-poll book, then IOC-capped market; never naked):
```ts
// shell: entry-instant re-poll → gate → protected taker. Reuses order-execution-oms signing + orderLinkId.
async function takerBreakoutEntry(key: ApiKey, sym: string, side: "Buy" | "Sell", qtyStr: string,
  tier: Tier, cfg: { maxSpreadPct: number; minDepthUsd: number }, linkId: string) {
  const { spreadPct, depthUsd } = await fetchTouchAndDepth(key, sym, side);   // GET tickers + orderbook NOW
  const gate = passMicrostructure({ spreadPct, depthUsd }, cfg);
  if (!gate.ok) { await logDecision(sym, gate.reason!, `spread=${spreadPct} depth=${depthUsd}`); return { status: "skipped" }; }
  const capPct = (slippageCapBps(tier, spreadPct) / 100).toFixed(3);          // bps → percent for Bybit
  const r = await signedPost("/v5/order/create", key, {
    category: "linear", symbol: sym, side, orderType: "Market", qty: qtyStr,
    positionIdx: 0, orderLinkId: linkId,
    slippageToleranceType: "Percent", slippageTolerance: capPct,             // IOC-limit; rejects if book worse
  });
  if (r.retCode !== 0) { await logDecision(sym, "taker:adverse_reject", r.retMsg); return { status: "rejected" }; }
  return { status: "filled", orderId: r.result.orderId };                    // do NOT retry as naked MARKET
}
```

`bun:test` — gate rejects, cap clamps, honest cost exceeds 0.11%:
```ts
import { test, expect } from "bun:test";

test("microstructure gate rejects a thin book", () => {
  const cfg = { maxSpreadPct: 0.15, minDepthUsd: 100_000 };
  expect(passMicrostructure({ spreadPct: 0.30, depthUsd: 500_000 }, cfg).ok).toBe(false); // spread
  expect(passMicrostructure({ spreadPct: 0.10, depthUsd: 40_000 }, cfg).ok).toBe(false);  // depth
  expect(passMicrostructure({ spreadPct: 0.10, depthUsd: 250_000 }, cfg).ok).toBe(true);
});

test("all-in round-trip exceeds the naive 0.11% once funding + layers + exit slip are counted", () => {
  const allIn = allInRoundTrip({ entrySlipBps: 8, exitSlipBps: 35, fundingBps: 8, layers: 3 });
  expect(allIn).toBeGreaterThan(0.0011);                       // ~0.11% is a fiction; real is 0.2-0.4%+
  expect(costAdjustedEdgeOk(0.006, allIn)).toBe(false);        // a 0.6% captured move does NOT clear 3x cost
});
```

## References
- [Bybit V5 API — Place Order (slippageToleranceType / slippageTolerance / IOC)](https://bybit-exchange.github.io/docs/v5/order/create-order) — market→IOC conversion with a bps/percent slippage cap; the protected taker primitive.
- [Bybit V5 API Changelog — slippage tolerance parameter additions and value ranges](https://bybit-exchange.github.io/docs/changelog/v5) — accepted `slippageTolerance` values and per-type ranges.
- [Bybit — Market Order with Slippage Tolerance](https://www.bybit.com/en/help-center/article/Market-Order-with-Slippage-Tolerance) — how tolerance converts a market order into a bounded IOC limit that rejects a worse book.
- [Bybit — Time In Force (GTC, IOC, FOK)](https://www.bybit.com/en/help-center/article/What-Are-Time-In-Force-TIF-GTC-IOC-FOK) — IOC semantics for the manual capped-limit fallback.
- [Bybit V5 — Get Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers) — bid1/ask1 for the entry-instant spread re-poll.
- [Bybit — Perpetual Futures Contract Fees Explained](https://www.bybit.com/en/help-center/article/Perpetual-Futures-Contract-Fees-Explained) — taker 0.055% / maker 0.02%; fee charged on notional (the red-herring gap).
- [To Make, or to Take — LOB Mechanics (Oxford/QMUL, 2025, Binance BTC-perp live experiment)](https://arxiv.org/html/2502.18625v1) — maker fill probability is negatively correlated with favorable return; taker is right for accelerating breaks.
- [The Negative Drift of a Limit Order Fill — DeLise (2024)](https://arxiv.org/abs/2407.16527) — a filled passive order is adversely selected; formalizes the maker adverse-selection Avci avoids.
- [The Effect of Latency on Optimal Order Execution Policy (2025)](https://arxiv.org/pdf/2504.00846) — latency cost for a polling engine; why the entry-instant re-poll matters.
- [CoinAPI — Understanding Latency in Crypto Trading](https://www.coinapi.io/blog/crypto-trading-latency-guide) — polling latency vs the fast-break window.
- [Blofin Academy — Maker vs Taker: Fees, Rebates, and Better Execution](https://blofin.com/en/academy/education/maker-vs-taker) — practitioner framing of when taking beats posting.
- [Bybit V5 — Get Orderbook](https://bybit-exchange.github.io/docs/v5/market/orderbook) — top-of-book depth for the entry-instant depth reject.
- [Bun — Test runner (`bun:test`)](https://bun.com/docs/test) — Jest-style `test`/`expect` for the pure cost/gate unit tests.
