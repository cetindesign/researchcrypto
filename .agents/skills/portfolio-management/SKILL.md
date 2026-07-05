---
name: portfolio-management
description: Managing capital across multiple bots/strategies on Bybit — capital allocation and weighting, rebalancing, equity-curve and PnL accounting (realized vs unrealized, trading fees, funding fees), aggregating positions across bots on one account vs isolating them in sub-accounts, diversification and correlation, and tracking per-strategy performance (Sharpe, drawdown, PnL attribution). Use when the task involves allocating capital between strategies, "how much to give each bot", rebalancing, portfolio equity/PnL accounting, realized vs unrealized PnL, funding/fee accounting, netting or aggregating positions across bots, Bybit sub-accounts, diversification, or per-strategy performance metrics.
---

# Portfolio Management (Multi-Bot on Bybit)

## When to use this skill
- Deciding capital allocation / weights across multiple bots or strategies.
- Building an equity curve or PnL ledger (realized vs unrealized, fees, funding).
- Reconciling account balance with the sum of per-bot positions.
- Choosing single account vs sub-accounts for isolating strategies.
- Rebalancing allocations on a schedule or on drift/performance triggers.
- Measuring per-strategy Sharpe, drawdown, win rate, or PnL attribution.

## Core concepts

**Capital allocation.** Split total equity `E` into per-strategy budgets `w_i * E` (`Σ w_i ≤ 1`, keep a cash buffer for margin spikes and funding). Common schemes:
- **Equal-weight** — simple, robust baseline; hard to beat out-of-sample.
- **Risk-parity / inverse-vol** — `w_i ∝ 1/σ_i` so each strategy contributes similar risk.
- **Performance / Sharpe-weighted** — tilt toward strategies with higher risk-adjusted returns; cap max weight to avoid overfitting to recent luck.
- **Mean-variance (Markowitz)** — maximize return per unit variance using expected returns, vols, and the correlation matrix; the efficient frontier is the set of optimal risk/return portfolios. Powerful but unstable: tiny input errors produce extreme weights — regularize, add weight caps, or shrink the covariance matrix.

**Diversification & correlation.** Diversification benefit comes from combining *imperfectly correlated* return streams; it is driven by covariance, not the number of bots. Two strategies with correlation < 1 have combined variance below the weighted average. In crypto, most directional long strategies collapse to BTC-beta in a selloff (correlations → 1), so measure realized *strategy-return* correlation, not just which symbols they trade.

**Equity curve.** Time series of account equity = `wallet balance + Σ unrealized PnL`. Foundation for drawdown, Sharpe, and allocation decisions. Snapshot on a fixed cadence (e.g. every minute + on every fill) so metrics are comparable.

**PnL accounting.**
- **Realized PnL** = closed-trade PnL − open fee − close fee − Σ funding paid/received. It is *net* of costs.
- **Unrealized PnL** = mark-to-market on open positions; does **not** include the fees/funding you'll still incur.
- **Trading fees** = taker/maker fee × notional, per fill (and partial fills each incur fees).
- **Funding fees** = `position_value × funding_rate`, exchanged between longs and shorts every funding interval (8h on Bybit majors) *only if you hold at the funding timestamp*. Positive rate → longs pay shorts. High-turnover and carry strategies live or die on fees+funding — always book them.

**Sharpe ratio.** Excess return per unit of volatility: `(mean(returns) − rf) / std(returns)`, annualized by `√periods_per_year`. Primary cross-strategy comparison metric; report alongside max drawdown and Calmar.

**Position aggregation: one account vs sub-accounts.**
- **One (unified) account, many bots:** Bybit nets same-symbol positions in one-way mode — two bots long BTCUSDT share a single net position and one liquidation price, so you *cannot* cleanly attribute PnL or risk per bot from the exchange. You must track each bot's intended position internally and reconcile against the netted exchange position. Shared cross margin also means one bot's loss can liquidate another's.
- **Sub-accounts (one per bot/strategy):** each gets its own balance, positions, margin, liquidation, and API key — clean isolation, clean per-strategy accounting, contained blast radius. Cost: capital is siloed (must transfer to rebalance), and you manage N key sets. Bybit allows up to ~20 standard sub-accounts; the master can 2-way transfer between itself and any sub (and between subs), fee-free; standard subs can only transfer back to master.

**Rebalancing.** Realign actual weights to targets when they drift past a band (e.g. ±5–10 absolute %) or on a schedule, or reallocate based on rolling performance. Trade off tracking error vs transaction/funding costs — over-frequent rebalancing bleeds fees; too infrequent lets a hot strategy dominate risk.

## Bybit / Python specifics

**Read total portfolio state (pybit).**
```python
from pybit.unified_trading import HTTP
s = HTTP(api_key=..., api_secret=..., testnet=False)
w = s.get_wallet_balance(accountType="UNIFIED")["result"]["list"][0]
equity = float(w["totalEquity"])          # balance + unrealized PnL
# per-coin: w["coin"][i]["walletBalance"], "unrealisedPnl", "cumRealisedPnl"
```

**Realized PnL & fees history** (essential for a correct ledger):
```python
s.get_closed_pnl(category="linear", symbol="BTCUSDT", limit=100)
#   -> closedPnl, openFee, closeFee, cumEntryValue, cumExitValue, leverage
s.get_transaction_log(accountType="UNIFIED", category="linear")
#   -> unified ledger: TRADE, SETTLEMENT (funding), FEE, TRANSFER, funding, fee, change
```
`get_closed_pnl` gives per-trade net PnL; `get_transaction_log` is the authoritative running ledger including **funding settlements** — reconcile your internal books against it.

**Sub-account management (master API key needs Account/Subaccount Transfer perms).**
```python
s.create_sub_member(username="bot_momentum", memberType=1)        # POST /v5/user/create-sub-member
s.create_sub_api_key(subuid=SUBUID, readOnly=0,
                     permissions={"ContractTrade": ["Order","Position"]})
s.create_universal_transfer(coin="USDT", amount="1000",
    fromMemberId=MASTER, toMemberId=SUBUID,
    fromAccountType="UNIFIED", toAccountType="UNIFIED")  # rebalance capital
```

**Fee/funding rates:** taker/maker via `get_fee_rates`; upcoming and historical funding via `get_funding_rate_history(category="linear", symbol=...)`. Bybit majors fund every 8h (00:00/08:00/16:00 UTC).

## Implementation checklist
- [ ] Choose isolation model up front: unified account (cheaper capital, messy attribution) vs sub-account-per-bot (clean attribution, siloed capital). Prefer sub-accounts when per-strategy accounting matters.
- [ ] Central allocator computes target weights (`Σ ≤ 1`, cash buffer reserved) and per-bot budgets.
- [ ] Persist an equity snapshot on a fixed cadence + on every fill/funding event.
- [ ] Build a PnL ledger from `get_closed_pnl` + `get_transaction_log`; book fees and funding explicitly.
- [ ] Reconcile: `Σ per-bot intended positions == exchange net position` (unified) or per-sub position (sub-accounts). Alert on drift.
- [ ] Compute per-strategy Sharpe, max drawdown, Calmar, win rate, turnover from the equity/PnL series.
- [ ] Maintain a rolling strategy-return correlation matrix; cap aggregate exposure per cluster.
- [ ] Rebalance on drift bands or schedule; simulate the fee/funding cost of the rebalance before executing.

## Do / Don't
**Do**
- Book fees and funding into realized PnL — unrealized PnL flatters you by omitting them.
- Reconcile internal per-bot books against Bybit's transaction log every cycle.
- Use sub-accounts to get clean, per-strategy risk and PnL isolation.
- Keep a cash/margin buffer; don't allocate 100% into strategy budgets.
- Compare strategies on risk-adjusted terms (Sharpe/Calmar), not raw PnL.

**Don't**
- Don't run two bots on the same symbol in one one-way account expecting independent positions — Bybit nets them.
- Don't trust mean-variance weights without caps/shrinkage — they explode on noisy inputs.
- Don't rebalance so often that fees/funding eat the benefit.
- Don't treat "many bots" as diversification when their returns are correlated.
- Don't attribute a netted position's PnL to one bot without an internal allocation model.

## Common pitfalls
- **Funding blind spot:** ignoring funding makes carry/high-turnover strategies look profitable when they aren't.
- **Netting confusion:** same-symbol positions across bots merge in one-way mode; hedge mode has separate long/short legs but still one account.
- **Double-counting equity:** summing wallet balance *and* position value inflates equity — equity already includes unrealized PnL, not notional.
- **Survivorship in performance weighting:** allocating to recent winners chases noise and raises correlation to a single regime.
- **Covariance instability:** Markowitz optima flip sign with small estimation changes; regularize.
- **Sub-account transfer latency/limits:** rebalancing between subs is a real transfer with its own constraints — not instant free capital movement mid-trade.
- **Timezone mismatch** between funding settlement (UTC) and your PnL day boundary.

## Code patterns

Inverse-volatility (risk-parity-lite) allocation with a weight cap:
```python
import numpy as np
def inverse_vol_weights(vols, w_cap=0.4, cash_buffer=0.1):
    inv = 1.0 / np.asarray(vols, float)
    w = inv / inv.sum()
    w = np.minimum(w, w_cap)
    w = w / w.sum() * (1 - cash_buffer)   # keep buffer as cash
    return w                              # per-strategy fraction of equity
```

Annualized Sharpe from an equity curve:
```python
import numpy as np
def sharpe(equity, periods_per_year=365*24, rf=0.0):
    eq = np.asarray(equity, float)
    r = np.diff(eq) / eq[:-1]
    ex = r - rf / periods_per_year
    sd = ex.std(ddof=1)
    return 0.0 if sd == 0 else ex.mean() / sd * np.sqrt(periods_per_year)
```

Rebalance only when a weight drifts outside its band:
```python
def needs_rebalance(current, target, band=0.05):
    return any(abs(c - t) > band for c, t in zip(current, target))
```

## References
- [Bybit V5 — Create Sub UID](https://bybit-exchange.github.io/docs/v5/user/create-subuid) — programmatic sub-account creation for per-bot isolation.
- [Bybit V5 — Create Sub UID API Key](https://bybit-exchange.github.io/docs/v5/user/create-subuid-apikey) — scoped API keys per sub-account.
- [Bybit — FAQ: Standard Subaccount](https://www.bybit.com/en/help-center/article/FAQ-Standard-Subaccount) — transfer rules, limits (~20 subs), fee-free master↔sub transfers.
- [Bybit — P&L Calculations (USDT Perpetual & Expiry)](https://www.bybit.com/en/help-center/article/Profit-Loss-calculations-USDT-Contract) — realized vs unrealized PnL formulas.
- [Bybit — Funding Fee Calculation](https://www.bybit.com/en/help-center/article/Funding-fee-calculation) — position_value × funding_rate, settlement timing.
- [Bybit — Introduction to Funding Rate](https://www.bybit.com/en/help-center/article/Introduction-to-Funding-Rate) — who pays whom and the 8h interval.
- [Bybit — Why Closed P&L is a Loss When Unrealized Was Positive](https://www.bybit.com/en/help-center/article/Why-Closed-PL-Loss-When-Unrealized-Profit-Positive) — fees/funding gap between unrealized and realized.
- [Modern Portfolio Theory (Corporate Finance Institute)](https://corporatefinanceinstitute.com/resources/career-map/sell-side/capital-markets/modern-portfolio-theory-mpt/) — mean-variance, diversification, efficient frontier.
- [Portfolio Optimization Book — Modern Portfolio Theory (Ch.7 slides)](https://portfoliooptimizationbook.com/slides/slides-modern-portfolio-theory.pdf) — formal mean-variance and covariance treatment.
- [pybit — Official Bybit Python SDK](https://github.com/bybit-exchange/pybit) — get_wallet_balance, get_closed_pnl, get_transaction_log, transfers.
