---
name: risk-management
description: Trading risk controls for a multi-bot Bybit perpetuals platform — position sizing (fixed-fractional, Kelly and fractional/half-Kelly), stop-loss/take-profit, max-drawdown limits, per-trade and portfolio exposure caps, correlation risk, leverage and liquidation risk (maintenance margin, MMR tiers, liquidation price), daily loss limits, and a global kill switch / circuit breaker. Use whenever the task involves how much to risk or bet, sizing an order, setting stop-loss/take-profit, "risk per trade", "position size", "Kelly", drawdown or daily loss limits, leverage, "liquidation price", "maintenance margin", exposure or correlation caps, circuit breaker, kill switch, or protecting capital before placing Bybit orders.
---

# Risk Management (Bybit Perpetuals)

## When to use this skill
- Deciding position size / notional for a trade ("risk per trade", "how many contracts", "Kelly").
- Setting stop-loss, take-profit, trailing stops, or reducing exposure.
- Enforcing max drawdown, daily loss limits, cooldowns, or a global kill switch.
- Computing leverage, maintenance margin, MMR tiers, or a liquidation price on Bybit perps.
- Capping per-symbol, per-bot, or portfolio-wide exposure and handling correlation risk.
- Reviewing any code path that opens/increases a position for missing risk checks.

## Core concepts

**Fixed-fractional (risk-per-trade).** Risk a constant fraction `r` of equity per trade (typ. 0.25%–1%). Given entry and stop distance, size so the loss at stop equals `r * equity`:

```
risk_amount = equity * r
stop_dist   = abs(entry - stop_price)          # in quote units per contract
qty         = risk_amount / stop_dist          # linear USDT perp: qty in base units
```

This decouples size from conviction and auto-shrinks after losses (equity falls → smaller bets). It is the default; Kelly only *scales* it.

**Kelly criterion.** Optimal growth-maximizing fraction. For a bet with win prob `p`, loss prob `q=1-p`, and payoff ratio `b` (avg win / avg loss):

```
f* = p - q / b          # fraction of bankroll to risk
```

Full Kelly maximizes long-run geometric growth but produces brutal drawdowns (50–80%+) and is extremely sensitive to estimation error in `p` and `b` — which are noisy and non-stationary in crypto. **Always use fractional Kelly.** Half-Kelly (`f*/2`) keeps ~75% of the growth rate at roughly half the drawdown; quarter-Kelly is common for uncertain edges. Rule: `size = min(fixed_fractional_cap, kelly_fraction * kelly_multiplier)`. Never bet full Kelly, and clamp `f*` to 0 when negative (no edge → no trade).

**Stop-loss / take-profit.** Every position must have a predefined invalidation (stop). Prefer exchange-native stops so they survive a bot crash (see Bybit specifics). Take-profit and R-multiples (target = N × risk) define expectancy; trailing stops lock gains.

**Max drawdown limit.** Peak-to-trough equity decline. Set a hard cap (e.g. 15–20%); on breach, halt new entries and optionally flatten. Track both per-strategy and account-wide.

**Daily loss limit.** Stop trading for the rest of the UTC day once realized+unrealized PnL drops below `-D` (e.g. -3% of equity). Prevents tilt/cascade days. Reset at 00:00 UTC.

**Exposure limits.** Per-trade notional cap, per-symbol cap, per-bot cap, and a portfolio gross/net exposure cap (sum of |notional| / equity). Reject orders that would breach any tier.

**Correlation risk.** Crypto majors are highly correlated (BTC/ETH/alts often >0.7). Ten "diversified" long alt bots is effectively one large BTC-beta bet. Cap *aggregate* exposure per correlation cluster, not just per symbol. Estimate a rolling correlation matrix and treat correlated positions as one risk unit.

**Leverage & liquidation (Bybit perps).** Leverage sets max position value, not risk per se. Liquidation happens when margin can no longer cover the maintenance margin. See below for formulas.

**Kill switch / circuit breaker.** A single global flag that, when tripped, blocks all new orders across every bot and (optionally) cancels open orders and flattens positions. Triggers: daily/max-drawdown breach, data staleness, repeated API errors, WebSocket disconnect, clock skew, or a manual toggle.

## Bybit / Python specifics

**Margin & liquidation (V5 Unified Trading Account).**
- **Maintenance Margin (MM)** ≈ `Position Value × MMR − Maintenance Margin Deduction + est. close fee`. `MMR` (Maintenance Margin Rate) is **tiered by position value** (risk-limit tiers): larger positions push you into higher tiers with higher MMR and lower max leverage, and the tier adjusts in real time as mark price moves.
- **Isolated mode:** liquidation triggers when **mark price** (not last price) reaches the position's liquidation price.
- **Cross / Portfolio mode:** liquidation triggers when the account **MMR reaches 100%** (margin exhausted across the whole account) — one bad position can liquidate unrelated positions sharing the wallet. Prefer **isolated margin per bot** (or separate sub-accounts) to contain blast radius.
- Approx liquidation price (isolated linear long): `liq ≈ entry × (1 − 1/leverage + MMR)`; short: `liq ≈ entry × (1 + 1/leverage − MMR)`. Use Bybit's returned `liqPrice` from the position endpoint as source of truth; treat the formula as a sanity check.

**Getting live risk state (pybit).**
```python
from pybit.unified_trading import HTTP
s = HTTP(api_key=..., api_secret=..., testnet=False)
pos = s.get_positions(category="linear", symbol="BTCUSDT")["result"]["list"][0]
# pos: size, avgPrice, leverage, liqPrice, positionIM, positionMM, unrealisedPnl
wallet = s.get_wallet_balance(accountType="UNIFIED")["result"]["list"][0]
# wallet: totalEquity, totalMarginBalance, totalMaintenanceMargin, accountMMRate
mmr = float(wallet["accountMMRate"])   # circuit-breaker input; 1.0 == liquidation
```

**Native protective orders.** Set stops on the exchange so they persist if your process dies:
```python
s.set_trading_stop(category="linear", symbol="BTCUSDT",
                   stopLoss="58000", takeProfit="65000",
                   tpTriggerBy="MarkPrice", slTriggerBy="MarkPrice",
                   positionIdx=0)   # 0 one-way; 1/2 for hedge-mode legs
```
Or attach on entry via `place_order(..., stopLoss=..., takeProfit=..., slTriggerBy="MarkPrice")`. Prefer **MarkPrice** triggers to avoid wick-driven stop-outs on the last price.

**Set leverage / margin mode** with `set_leverage(category, symbol, buyLeverage, sellLeverage)` and `switch_margin_mode` / account-level margin mode. Lower leverage widens the gap to liquidation.

## Implementation checklist
- [ ] Central `RiskManager` that every order must pass through — no bot places orders directly.
- [ ] Compute size via fixed-fractional risk-per-trade; optionally scale by fractional Kelly (≤ half), clamped to a hard notional cap.
- [ ] Require a stop price for every entry; reject entries with no invalidation.
- [ ] Submit stop-loss/take-profit as native Bybit orders with `slTriggerBy="MarkPrice"`.
- [ ] Round `qty` and prices to the symbol's `lotSizeFilter.qtyStep` / `priceFilter.tickSize` (from `get_instruments_info`); reject sub-`minOrderQty`.
- [ ] Enforce per-symbol, per-bot, per-cluster, and portfolio gross-exposure caps before sizing.
- [ ] Track equity peak → compute drawdown; enforce max-drawdown and daily-loss limits (reset 00:00 UTC).
- [ ] Poll/subscribe to `accountMMRate`; warn at a threshold (e.g. 0.5) well before 1.0.
- [ ] Implement a global kill switch checked in the hot path; wire it to breaches and to a manual override.
- [ ] Prefer isolated margin (or sub-accounts) per bot to prevent cross-liquidation contagion.

## Do / Don't
**Do**
- Size from a fixed fraction of *current* equity; recompute after each fill.
- Use fractional Kelly (≤ 0.5) and set `f*=0` (skip trade) when edge is negative or unknown.
- Trigger stops on mark price; place them on the exchange, not just in memory.
- Contain risk per bot with isolated margin or separate sub-accounts.
- Model correlation clusters and cap aggregate exposure, not just per-symbol.

**Don't**
- Never bet full Kelly, or Kelly computed from a tiny/curve-fit sample.
- Don't hold in-memory-only stops — a crash leaves a naked leveraged position.
- Don't ignore funding and fees when sizing; they erode edge on high-turnover bots.
- Don't run many correlated longs and call it diversified.
- Don't let one strategy's blow-up in cross margin liquidate the whole account.

## Common pitfalls
- **Last-price vs mark-price stops:** last-price triggers get wicked out; liquidation itself uses mark price.
- **Tier creep:** as a winning position grows, its risk-limit tier raises MMR and can force deleveraging — the liquidation buffer shrinks even as you profit.
- **Cross-margin contagion:** shared wallet means one position's loss consumes another's margin.
- **Estimation error in Kelly:** overstated win rate → dramatic overbetting → ruin.
- **Compounding position math:** sizing off stale equity after a partial fill double-counts risk.
- **Rounding rejects/mismatch:** ignoring `qtyStep`/`minOrderQty` gets orders rejected or silently truncated.
- **UTC vs local day** for daily loss reset causes double-counting across a session.

## Code patterns

Fixed-fractional size with fractional-Kelly scaling and caps:
```python
def position_qty(equity, entry, stop, risk_frac=0.005,
                 p=None, b=None, kelly_mult=0.5, max_notional_frac=0.20):
    stop_dist = abs(entry - stop)
    if stop_dist <= 0:
        raise ValueError("stop must differ from entry")
    scale = 1.0
    if p is not None and b:
        f = p - (1 - p) / b          # Kelly fraction
        f = max(f, 0.0) * kelly_mult # fractional Kelly, no negative bets
        scale = min(1.0, f / risk_frac) if risk_frac else 0.0
    qty = (equity * risk_frac * scale) / stop_dist
    qty = min(qty, equity * max_notional_frac / entry)  # notional cap
    return qty
```

Kill switch / circuit breaker gate (checked before every order):
```python
class RiskState:
    def __init__(self): self.killed = False; self.peak = 0.0

    def update(self, equity, day_pnl_pct, mmr,
               max_dd=0.20, day_loss=0.03, mmr_warn=0.5):
        self.peak = max(self.peak, equity)
        dd = 0 if self.peak == 0 else (self.peak - equity) / self.peak
        if dd >= max_dd or day_pnl_pct <= -day_loss or mmr >= mmr_warn:
            self.killed = True
        return self.killed

    def allow_entry(self) -> bool:
        return not self.killed   # flip to True only via manual reset / new day
```

## References
- [Bybit V5 — Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit) — per-UID limits and headers relevant to risk-check polling cadence.
- [Bybit — Liquidation Price Calculation, Isolated Mode (UTA)](https://www.bybit.com/en/help-center/article/Liquidation-Price-Calculation-under-Isolated-Mode-Unified-Trading-Account) — official isolated-mode liquidation formula.
- [Bybit — Trading Rules: Liquidation Process (UTA)](https://www.bybit.com/en/help-center/article/UTA-Trading-Rules) — cross/portfolio MMR=100% liquidation trigger.
- [Bybit — Maintenance Margin (USDT Perpetual & Expiry)](https://www.bybit.com/en/help-center/article/Maintenance-Margin-USDT-Contract) — MM = value×MMR − deduction + close fee.
- [Bybit — Risk Limit (Perpetual and Expiry Contracts)](https://www.bybit.com/en/help-center/article/Risk-Limit-Perpetual-and-Futures) — tiered risk limits and dynamic MMR adjustment.
- [Bybit — Margin Parameters](https://www.bybit.com/en/announcement-info/margin-parameters/) — current MMR and max leverage per tier per symbol.
- [Freqtrade — Protections](https://www.freqtrade.io/en/stable/plugins/) — StoplossGuard, MaxDrawdown, CooldownPeriod, LowProfitPairs reference implementations.
- [Freqtrade — Stoploss](https://www.freqtrade.io/en/stable/stoploss/) — trailing stop, stoploss_on_exchange, custom stop patterns.
- [Kelly Criterion & Position Sizing (Coriva)](https://coriva.eu.org/en/kelly-criterion-position-sizing/) — full vs fractional Kelly, drawdown trade-offs.
- [pybit — Official Bybit Python SDK](https://github.com/bybit-exchange/pybit) — get_positions, get_wallet_balance, set_trading_stop, set_leverage.
