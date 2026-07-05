---
name: strategy-development
description: Building crypto trading strategy logic for Bybit bots in Python — signal generation, technical indicators (pandas-ta, TA-Lib, ta), entry/exit rules, multi-timeframe design, indicator warmup/startup periods, avoiding repainting and look-ahead, separating strategy from execution, and parameterizing for optimization. Invoke when the user mentions "trading strategy", "signal", "indicator", "RSI/MACD/EMA/Bollinger", "entry/exit rules", "timeframe", "warmup/startup candles", "repainting", "pandas-ta", "TA-Lib", "populate_indicators", "strategy parameters", or asks how a bot should decide to buy/sell on Bybit.
---

# Strategy Development

## When to use this skill
- Designing signal logic: "when should the bot go long/short on BTCUSDT?"
- Adding or choosing technical indicators (RSI, MACD, EMA/SMA, Bollinger, ATR, ADX, SuperTrend).
- Structuring entry/exit rules and translating them into a dataframe of signals.
- Choosing timeframes and setting the correct indicator warmup / startup candle count.
- Diagnosing repainting or look-ahead ("my backtest is amazing but live loses money").
- Parameterizing a strategy so it can be optimized/hyperopted without touching execution code.

## Core concepts
- **Signal generation**: a strategy converts OHLCV candles into discrete intent — enter_long, enter_short, exit — usually as boolean columns on a pandas DataFrame indexed by candle close time.
- **Indicator warmup / startup period**: rolling indicators (EMA200, ATR14) emit NaN or wrong values until enough candles exist. You must skip the unstable prefix. In Freqtrade this is `startup_candle_count`; set it to the largest lookback any indicator uses (e.g. an EMA200 + a 14-period ATR ⇒ ≥ 200).
- **Repainting**: a signal that changes value on an already-closed candle after the fact. Caused by using indicators that reference future candles, by acting on the *current, still-forming* candle, or by centered/recalculated indicators. A repainting strategy backtests beautifully and fails live.
- **Look-ahead bias**: using information not yet available at decision time (e.g. today's close to decide today's open trade, or `.shift(-1)`, `max()` over the whole series, resampling that leaks future bars).
- **Timeframe**: the candle interval that drives signals (Bybit `interval`: 1,3,5,15,30,60,120,240,360,720,D,W,M). Higher timeframes = fewer, more robust signals; lower = more noise and fees. Multi-timeframe strategies compute a trend filter on a higher TF and time entries on a lower TF.
- **Separation of concerns**: the strategy is a *pure function* of market data → signals + desired risk (stop, target, size hint). It must NOT call the exchange. A separate execution/OMS layer turns signals into Bybit orders. This makes the same code testable in backtest and live.

## Python & stack specifics
Indicator libraries (pick one primary, know the trade-offs):
- **pandas-ta**: pure-Python pandas extension, 130+ indicators, no system deps. `df.ta.rsi(length=14)` or `df.ta.macd()`. Easiest to install; slower than TA-Lib on huge data.
- **TA-Lib** (`ta-lib-python`): Cython wrapper over the C library, 2-4x faster, 150+ indicators + 60 candlestick patterns. Requires the native `ta-lib` C library installed first. Function API returns numpy arrays: `talib.RSI(close, timeperiod=14)`; Abstract API: `from talib.abstract import *`.
- **ta** (bukosabino): pure-Python, clean class API, good for a light dependency footprint.

Design a strategy as data-in / signals-out so backtester and live bot share it:

```python
import pandas as pd
import pandas_ta as ta

class Params:                      # parameterize everything tunable
    ema_fast: int = 21
    ema_slow: int = 55
    rsi_len: int = 14
    rsi_floor: float = 50.0
    atr_len: int = 14
    startup: int = 55              # = max lookback; drop this many leading candles

def add_indicators(df: pd.DataFrame, p=Params) -> pd.DataFrame:
    df = df.copy()
    df["ema_fast"] = ta.ema(df["close"], length=p.ema_fast)
    df["ema_slow"] = ta.ema(df["close"], length=p.ema_slow)
    df["rsi"]      = ta.rsi(df["close"], length=p.rsi_len)
    df["atr"]      = ta.atr(df["high"], df["low"], df["close"], length=p.atr_len)
    return df

def signals(df: pd.DataFrame, p=Params) -> pd.DataFrame:
    df = add_indicators(df, p)
    cross_up = (df["ema_fast"] > df["ema_slow"]) & \
               (df["ema_fast"].shift(1) <= df["ema_slow"].shift(1))
    df["enter_long"] = cross_up & (df["rsi"] > p.rsi_floor)
    df["exit_long"]  = df["ema_fast"] < df["ema_slow"]
    # suggested risk, consumed by the execution/OMS layer (never here):
    df["stop_dist"]  = 2.0 * df["atr"]
    return df.iloc[p.startup:]      # drop unstable warmup region
```

Bybit relevance: strategies run on Bybit kline data (via pybit `get_kline` / CCXT `fetch_ohlcv` with the `bybit` id). Always trade on the *closed* candle: pull the last **confirmed** kline, not the in-progress one. On the WebSocket kline stream, act only when the message's `confirm` flag is `true`.

## Implementation checklist
- [ ] Fix the primary timeframe and any higher-TF trend filter up front.
- [ ] List every indicator's lookback; set `startup`/`startup_candle_count` = the max, and drop that prefix.
- [ ] Compute indicators only from data available at or before the current closed candle.
- [ ] Emit signals on **closed** candles only (`confirm==true` on WS; drop the last live row on REST).
- [ ] Return signals + risk hints (stop distance, target, size weight) — no exchange calls.
- [ ] Expose all thresholds/lengths as parameters (a dataclass or pydantic model), not magic numbers.
- [ ] Run Freqtrade `lookahead-analysis` / `recursive-analysis` (or an equivalent shift test) before trusting results.
- [ ] Sanity-check on out-of-sample data before wiring to execution.

## Do / Don't
**Do**
- Keep strategy code pure and side-effect free; inject data, return signals.
- Use `.shift(1)` to reference the *previous* closed value when a rule needs "the prior bar".
- Confirm the timezone/candle boundary; align all timeframes to the same clock.
- Version and log the exact parameter set that produced a signal.

**Don't**
- Don't act on the currently forming candle — it can still reverse before close.
- Don't use `.shift(-N)`, `.rolling(...).apply` over future rows, `df.max()`/`df.min()` over the whole series, or `resample` that borrows future bars.
- Don't call Bybit REST/WS from inside strategy logic (breaks testability and idempotency).
- Don't hardcode symbol quantity/price precision in the strategy — that belongs to execution.

## Common pitfalls
- **Repainting indicators**: some community indicators (certain SuperTrend/ZigZag/HalfTrend variants, anything centered) recompute past values. Verify by feeding progressively longer slices and checking that historical signal values never change.
- **Off-by-one warmup**: forgetting to drop the NaN prefix leaks partially-computed indicator values into signals.
- **Higher-TF leakage**: when merging a 4h trend onto 15m candles, forward-fill so each 15m bar only sees the *last closed* 4h bar, never the current unfinished one (Freqtrade: `merge_informative_pair`).
- **Fee/slippage blindness**: a strategy that flips every candle can be profitable pre-cost and deeply negative after Bybit taker fees + funding — validate net of costs in the backtester.
- **Overfitting parameters**: more indicators/thresholds ≠ better; each added knob raises curve-fitting risk. Keep the parameter count small and justify each.

## Code patterns
Higher-timeframe trend filter merged safely onto the base timeframe:

```python
# htf_df: 4h candles with a computed 'htf_ema' column; base_df: 15m candles
htf = htf_df[["date", "htf_ema", "close"]].rename(columns={"close": "htf_close"})
htf["htf_up"] = htf["htf_close"] > htf["htf_ema"]
# shift the HTF frame so a 15m bar only sees the previous CLOSED 4h bar
merged = pd.merge_asof(
    base_df.sort_values("date"),
    htf[["date", "htf_up"]].sort_values("date"),
    on="date", direction="backward", allow_exact_matches=False,
)
merged["enter_long"] &= merged["htf_up"]
```

Repaint check (historical signals must be stable as more data arrives):

```python
full = signals(df)
sliced = signals(df.iloc[: len(df) // 2])
assert full["enter_long"].iloc[: len(sliced)].equals(sliced["enter_long"]), "repainting!"
```

## References
- [Strategy Customization — Freqtrade](https://www.freqtrade.io/en/stable/strategy-customization/) — populate_indicators/entry/exit, startup_candle_count, common look-ahead mistakes.
- [Advanced Strategy — Freqtrade](https://www.freqtrade.io/en/stable/strategy-advanced/) — informative (multi-timeframe) pairs, custom stoploss, callbacks.
- [Lookahead analysis — Freqtrade](https://www.freqtrade.io/en/stable/lookahead-analysis/) — automated detection of future-data leaks in a strategy.
- [Recursive analysis — Freqtrade](https://www.freqtrade.io/en/stable/recursive-analysis/) — detects indicator values that vary with history length (repainting).
- [pandas-ta on PyPI](https://pypi.org/project/pandas-ta/) — 130+ indicator pandas extension, install and usage.
- [pandas-ta documentation](https://www.pandas-ta.dev/) — indicator reference and the three calling styles (standard, DataFrame extension, Strategy).
- [TA-Lib Python docs](https://ta-lib.github.io/ta-lib-python/) — Function API, Abstract API, install notes.
- [TA-Lib supported functions](https://ta-lib.github.io/ta-lib-python/funcs.html) — full list of 150+ indicators and their parameters.
- [TA-Lib GitHub](https://github.com/TA-Lib/ta-lib-python) — source, wheels, install troubleshooting for the native C dependency.
- [Jesse — crypto trading framework](https://jesse.trade/) — strategy syntax, 300+ indicators, backtest without look-ahead.
- [Jesse GitHub](https://github.com/jesse-ai/jesse) — reference implementation of strategy/indicator separation.
