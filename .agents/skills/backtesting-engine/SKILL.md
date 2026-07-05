---
name: backtesting-engine
description: Backtesting crypto strategies correctly for Bybit perpetuals in Python — event-driven vs vectorized engines, avoiding look-ahead and survivorship bias, realistic slippage/fee/funding modeling for Bybit perps, in-sample vs out-of-sample and walk-forward analysis, overfitting control, and performance metrics (Sharpe, Sortino, Calmar, max drawdown, CAGR, profit factor). Invoke when the user mentions "backtest", "walk-forward", "out-of-sample", "look-ahead bias", "survivorship", "slippage/fees/funding modeling", "overfitting", "Sharpe/Sortino/max drawdown/profit factor", "vectorbt", "backtesting.py", "Freqtrade backtesting", or asks whether a strategy's historical results are trustworthy.
---

# Backtesting Engine

## When to use this skill
- "Backtest this strategy on BTCUSDT perps over the last 2 years."
- Choosing between a vectorized (vectorbt) and event-driven (backtesting.py / Freqtrade / Jesse / custom) engine.
- Making fills realistic: modeling Bybit taker/maker fees, slippage, and funding on perps.
- Setting up in-sample/out-of-sample splits or walk-forward analysis.
- Interpreting metrics and detecting overfitting ("Sharpe 4 in backtest, is it real?").
- Debugging suspiciously good results (look-ahead, survivorship, data quality).

## Core concepts
- **Vectorized backtesting**: apply signals across the whole price array at once (numpy/pandas). Extremely fast — vectorbt tests thousands of parameter sets in seconds — but easy to leak future data and awkward for path-dependent logic (trailing stops, pyramiding, dynamic sizing).
- **Event-driven backtesting**: feed candles one bar at a time; the strategy only ever sees data up to "now". Structurally prevents look-ahead (backtesting.py's `Strategy.next()` only exposes data up to the current index; Jesse and Freqtrade are event/loop driven). Slower but faithful to how a live OMS behaves.
- **Look-ahead bias**: using data not available at decision time — deciding on the current unclosed bar, using the close to fill at the open, `.shift(-1)`, whole-series `max/min`, or indicators that repaint. The #1 cause of fake profits.
- **Survivorship bias**: backtesting only symbols that still trade today, ignoring delisted/failed coins. On crypto this is severe — many alts went to zero. Use a point-in-time symbol universe.
- **In-sample (IS) vs out-of-sample (OOS)**: optimize on IS, then evaluate untouched OOS. A strategy that only works IS is curve-fit.
- **Walk-forward analysis (WFA)**: roll the IS/OOS windows forward (optimize on window N, test on N+1, advance, repeat) and stitch the OOS results. This is the gold standard for judging whether an optimization process generalizes, not just one lucky split.
- **Overfitting**: fitting noise. Symptoms: great IS / poor OOS, a fragile "peak" in the parameter surface, too many parameters, unrealistic Sharpe. Prefer a broad plateau of good parameters over a sharp spike.

## Bybit / Python specifics
Realistic cost model for **Bybit USDT perpetuals** (linear):
- **Fees**: default VIP-0 perp fees are roughly **maker 0.02% / taker 0.055%** (fetch live values via `/v5/account/fee-rate`; never hardcode blindly). Post-only limit fills earn the maker rate (or a rebate at higher tiers); market and marketable limits pay taker.
- **Funding**: perps pay/receive funding every 8h (00:00/08:00/16:00 UTC) at the symbol's funding rate. A backtest that ignores funding overstates PnL for positions held across funding stamps. Pull historical funding (`/v5/market/history-fund-rate`) and apply `position_notional * funding_rate` at each stamp, sign by side.
- **Slippage**: model at least a fixed spread + size-dependent impact. For a taker entry, fill at `mid ± spread/2` plus impact; better, replay the L1/L2 book if you have it. Assume you do NOT get the best bid/ask for free.
- **Contract rules**: respect `qtyStep`, `minOrderQty`, `tickSize`, and `minNotional` from `/v5/market/instruments-info` — round sizes/prices the same way live orders will be, or fills won't match reality.
- **Leverage/liquidation**: model maintenance margin and liquidation for leveraged perp tests; a strategy can be "profitable" while occasionally getting liquidated.

Data sourcing: fetch klines via pybit `get_kline` or CCXT `fetch_ohlcv('BTC/USDT:USDT', ...)` on the `bybit` id, paginating. Bybit returns a max of 1000 klines per request — page by time and de-duplicate. Verify no gaps/duplicates and consistent timezone (UTC).

Engines commonly used: **backtesting.py** (lightweight event-driven, built-in Sharpe/drawdown), **vectorbt** (vectorized, numba-accelerated, mass parameter sweeps, QuantStats integration), **Freqtrade backtesting** (built for crypto exchanges incl. Bybit, has lookahead/recursive-analysis tooling and hyperopt), **Jesse** (crypto-native, event-driven, no look-ahead by design).

## Implementation checklist
- [ ] Load clean OHLCV: UTC, no gaps, no duplicate timestamps, monotonic index.
- [ ] Build a point-in-time symbol universe (include delisted symbols) to avoid survivorship bias.
- [ ] Signals fire on the closed bar; fills happen on the NEXT bar's open (never same-bar close).
- [ ] Apply Bybit fees (maker vs taker by order type), slippage, and 8h funding at each stamp.
- [ ] Round sizes/prices to `qtyStep`/`tickSize`; reject sub-`minOrderQty`/`minNotional` trades.
- [ ] Split IS/OOS; run walk-forward, not a single split.
- [ ] Report Sharpe, Sortino, Calmar, max drawdown, CAGR, profit factor, win rate, trade count, exposure.
- [ ] Run a look-ahead detector (Freqtrade `lookahead-analysis`) and a shift-invariance/repaint test.
- [ ] Compare against a benchmark (buy-and-hold BTC) and a randomized/shuffled-signal null.

## Do / Don't
**Do**
- Fill at next-bar open (or intrabar with conservative slippage), matching live latency.
- Fetch live fee tiers and funding history; apply them per trade and per stamp.
- Judge robustness by OOS/walk-forward performance and parameter-surface flatness.
- Keep enough trades (rule of thumb: 100+) for metrics to mean anything.

**Don't**
- Don't optimize and report on the same data (that number is meaningless).
- Don't ignore funding, fees, or slippage — they routinely flip a "winner" negative on perps.
- Don't trust a single dazzling Sharpe; check drawdown, trade count, and OOS.
- Don't backtest only currently-listed coins if the strategy scans many symbols.

## Common pitfalls
- **Same-bar look-ahead**: computing a signal from a bar's close and filling at that same close/open. Delay the fill by one bar.
- **Funding omission**: holding a perp for days without applying 8h funding can hide a large cost (or gain).
- **Fee under-modeling**: assuming maker fees for orders that actually cross as taker. If you don't guarantee post-only, assume taker.
- **Data survivorship & quality**: missing candles filled by forward-fill create phantom flat periods; duplicate timestamps double-count. Validate before backtesting.
- **Metric misuse**: annualize Sharpe with the right periods-per-year for your bar size; a crypto market trades 24/7/365, so use 365 (not 252) trading days. Sortino needs a target/MAR; Calmar = CAGR / |max drawdown|.
- **Multiple-testing / p-hacking**: sweeping thousands of parameter sets and picking the best inflates Sharpe by chance. Use walk-forward and out-of-sample to discount it.
- **Position-size look-ahead**: sizing off the future equity curve or future volatility.

## Code patterns
Applying Bybit costs inside an event-driven fill:

```python
TAKER = 0.00055   # confirm via /v5/account/fee-rate
MAKER = 0.00020

def fill(side, price, qty, is_maker, spread):
    # taker crosses the spread; add slippage on top of the fee
    slip = 0.0 if is_maker else spread / 2
    exec_price = price + slip if side == "buy" else price - slip
    fee = exec_price * qty * (MAKER if is_maker else TAKER)
    return exec_price, fee

def apply_funding(position_notional, funding_rate, side):
    # charged every 8h; long pays when rate > 0
    sign = 1 if side == "long" else -1
    return -sign * position_notional * funding_rate
```

Walk-forward skeleton:

```python
def walk_forward(data, optimize, evaluate, is_len, oos_len, step):
    oos_results = []
    start = 0
    while start + is_len + oos_len <= len(data):
        is_slice  = data.iloc[start : start + is_len]
        oos_slice = data.iloc[start + is_len : start + is_len + oos_len]
        best_params = optimize(is_slice)                 # fit on IS only
        oos_results.append(evaluate(oos_slice, best_params))  # judge on OOS
        start += step
    return oos_results   # stitch and analyze the OOS curve only
```

## References
- [Backtesting.py documentation](https://kernc.github.io/backtesting.py/) — event-driven engine; `init()`/`next()` prevent look-ahead; built-in stats.
- [Backtesting.py API reference](https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html) — Backtest/Strategy/Trade objects, fees (`commission`) and slippage options.
- [vectorbt — getting started](https://vectorbt.dev/) — vectorized, numba-accelerated backtesting and mass parameter sweeps.
- [vectorbt GitHub](https://github.com/polakowo/vectorbt) — Portfolio API, fees/slippage params, metrics.
- [Backtesting — Freqtrade](https://www.freqtrade.io/en/stable/backtesting/) — crypto exchange backtesting with realistic fees/funding and detailed metric tables.
- [Lookahead analysis — Freqtrade](https://www.freqtrade.io/en/stable/lookahead-analysis/) — automated future-data leak detection.
- [Recursive analysis — Freqtrade](https://www.freqtrade.io/en/stable/recursive-analysis/) — detects indicator repainting via history-length variance.
- [Hyperopt — Freqtrade](https://www.freqtrade.io/en/stable/hyperopt/) — parameter optimization with IS/OOS and overfitting caveats.
- [Jesse GitHub](https://github.com/jesse-ai/jesse) — crypto-native event-driven backtester with no look-ahead by design.
- [QuantStats GitHub](https://github.com/ranaroussi/quantstats) — Sharpe, Sortino, Calmar, max_drawdown, CAGR, profit_factor implementations and tearsheets.
- [Bybit Fee Rate API](https://bybit-exchange.github.io/docs/v5/account/fee-rate) — live maker/taker fees to feed the cost model.
- [Bybit Instruments Info API](https://bybit-exchange.github.io/docs/v5/market/instrument) — qtyStep, tickSize, minOrderQty, minNotional for realistic rounding.
