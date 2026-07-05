---
name: ml-trading-signals
description: Build machine-learning trading signals for a Bybit crypto platform without fooling yourself. Covers feature engineering from OHLCV and order-book data, rigorous data-leakage and look-ahead prevention, proper time-series cross-validation (walk-forward, purged K-fold with embargo, combinatorial purged CV), triple-barrier labeling and meta-labeling, sample weighting for overlapping labels, avoiding overfitting, non-stationarity/regime shift, realistic evaluation (transaction costs, slippage, latency), and FreqAI integration. Invoke for "ML signal", "predictive model", "feature engineering", "data leakage", "look-ahead bias", "walk-forward", "purged k-fold", "embargo", "triple barrier", "meta-labeling", "label the data", "overfitting backtest", "TimeSeriesSplit", "FreqAI", "scikit-learn model", "XGBoost/LightGBM signal", or "why does my model work in backtest but not live".
---

# Machine Learning for Trading Signals

## When to use this skill
- Engineering features from Bybit OHLCV / order-book snapshots for a predictive model.
- Deciding how to **label** data (up/down/flat, return thresholds, triple-barrier).
- Setting up cross-validation for time-series so results aren't inflated by leakage.
- Diagnosing "great backtest, terrible live" — almost always leakage, overfitting, or non-stationarity.
- Wiring an ML model into FreqAI or a custom Bybit pipeline.

## Core concepts

**Financial ML is adversarial to your intuition.** The default sklearn workflow (random `train_test_split`, k-fold CV, single accuracy number) is *wrong* for markets and will report a strategy that fails live. The entire discipline is about not fooling yourself.

**Look-ahead bias / data leakage** — using information at time *t* that wasn't actually available until *t+k*. Sources:
- **Feature leakage:** computing indicators, normalization, or resampling using future bars (e.g. a centered rolling mean, or scaling with stats from the whole dataset).
- **Label leakage:** the label's outcome window overlaps the features of a later training sample (the classic reason financial CV must be *purged*).
- **Survivorship/selection:** only modeling coins that still list today.
- **Fill leakage:** assuming you fill at the same bar's close that generated the signal.

**Labeling.** Fixed-horizon returns ("+1 if return over next N bars > 0") ignore *path* and risk. The **triple-barrier method** (López de Prado) labels each event by which of three barriers is touched first: upper (profit-take, +1), lower (stop-loss, −1), or vertical (time expiry, 0/sign of return). Barriers are set from volatility (e.g. dynamic ±kσ), making labels risk-aware and path-dependent.

**Meta-labeling.** A primary model (or rule) decides *side*; a secondary ML model predicts *whether to act* (bet size / take-or-skip). Improves precision and lets you tune the F1 without touching the direction logic.

**Overlapping labels → non-IID samples.** Triple-barrier windows overlap in time, so samples share information. This inflates apparent performance and biases importances. Fix with **sample uniqueness weighting** and **sequential bootstrap**; and CV must **purge + embargo**.

**Purged K-Fold + embargo.** Remove from the training set any observation whose label window overlaps the test fold (purge), plus a small time buffer after the test fold (embargo) to kill serial-correlation leakage. **Combinatorial Purged CV (CPCV)** generates many train/test path combinations for a distribution of out-of-sample performance instead of one fragile number.

**Walk-forward** — train on past, test on the immediately following (unseen future) block, roll forward. Mirrors live deployment; `TimeSeriesSplit` gives an expanding-window version.

**Non-stationarity.** Price is non-stationary; returns are closer but volatility/regime shifts constantly. Prefer stationary-but-memory-preserving transforms (fractional differentiation), retrain/recalibrate on a schedule, and evaluate across regimes (bull/bear/chop) not just one lucky period.

## Python & stack specifics
- **Data:** Bybit `GET /v5/market/kline` for OHLCV; order book via WS `orderbook.{depth}.{symbol}` (e.g. depth 50) for microstructure features. Store with UTC timestamps; align features to bar **close** and shift so a bar's features never include its own future.
- **Features from OHLCV:** returns, log-returns, realized volatility, RSI/ATR/MACD (via `pandas-ta`/TA-Lib), rolling z-scores, volume imbalance. **Order-book features:** bid-ask spread, order-book imbalance `(bidVol−askVol)/(bidVol+askVol)`, depth at N levels, microprice. All must use only data up to the decision timestamp.
- **Models:** tree ensembles (LightGBM/XGBoost/`sklearn.ensemble.RandomForest`) dominate tabular financial ML; keep them shallow, regularize, and prefer probability outputs for bet sizing.
- **CV:** `sklearn.model_selection.TimeSeriesSplit` for a quick walk-forward; implement **purged K-fold with embargo** (from *Advances in Financial ML* / `mlfinlab`) when labels overlap. Never `KFold(shuffle=True)` or random `train_test_split` on time series.
- **Scaling done right:** fit scalers/encoders on the *training* fold only, then transform test/live (FreqAI does exactly this: it fits on train, applies the same transform to test/prediction data to avoid leakage).
- **FreqAI:** low-level features go in strategy `feature_engineering_expand_*` / `feature_engineering_standard`; targets in `set_freqai_targets()`; `include_shifted_candles` adds lagged features; `include_timeframes` adds multi-TF. FreqAI retrains on a sliding window (`train_period_days`, `backtest_period_days`) so backtests emulate live retraining without look-ahead.

## Implementation checklist
- [ ] Fix a strict timeline: every feature at row *t* uses only data with timestamp ≤ *t*'s decision point (shift indicators by 1 bar if computed on the closing bar).
- [ ] Compute labels with triple-barrier using volatility-scaled barriers; record each label's *end time*.
- [ ] Derive sample weights from label uniqueness (overlap) and optionally time-decay.
- [ ] Split with walk-forward or purged K-fold + embargo; never shuffle time.
- [ ] Fit ALL preprocessing (scalers, imputers, feature selection) inside the training fold only.
- [ ] Evaluate out-of-sample with costs: Bybit taker/maker fees, slippage, funding, and realistic fills (next bar, not signal bar).
- [ ] Report a distribution of results (CPCV / multiple walk-forward windows), not a single Sharpe. Track deflated Sharpe / probability of backtest overfitting.
- [ ] Test across distinct market regimes; check feature importance stability across folds.
- [ ] Plan retraining cadence and live-vs-backtest drift monitoring before going live.

## Do / Don't
**Do**
- Purge and embargo any train samples whose label window overlaps the test set.
- Set barriers/thresholds from volatility so labels are comparable across regimes.
- Weight overlapping samples by uniqueness; use sequential bootstrap for bagging.
- Fit scalers on train only; simulate the same retraining schedule you'll run live.
- Include realistic transaction costs, slippage, and fill timing in every evaluation.

**Don't**
- Don't use `train_test_split`/`KFold(shuffle=True)` on time-ordered market data.
- Don't normalize/standardize/select features using the full dataset (leaks test stats into train).
- Don't compute indicators with centered or future-looking windows, or fill at the signal bar's close.
- Don't optimize hyperparameters/thresholds on the same data you report — that's backtest overfitting.
- Don't trust one high Sharpe number; a single lucky window means nothing.

## Common pitfalls
- **The "amazing" backtest that dies live:** 95% of the time it's leakage (feature or label) or overfitting from tuning on the test set.
- **Scaling leakage:** `StandardScaler().fit(X_all)` before splitting — the mean/std carry future information into every fold.
- **Overlapping-label inflation:** contiguous samples share outcomes, so accuracy and feature importance are overstated; unweighted CV compounds it.
- **Class imbalance from labeling:** volatile assets produce mostly ±1; a naive accuracy metric hides that the model just predicts the majority.
- **Regime overfit:** a model tuned on a single bull run learns the trend, not a signal; it inverts in a bear market.
- **Non-stationary features:** raw price levels as features; the model memorizes a range that never recurs. Use returns / fractional differentiation.
- **Look-ahead via resampling/merge:** joining a slower timeframe or on-chain series without lagging it to when it was actually published.

## Code patterns

Triple-barrier labeling (volatility-scaled), leak-safe:
```python
import numpy as np, pandas as pd

def triple_barrier(close, events, pt=2.0, sl=2.0, vol=None, max_hold=20):
    # events: index of entry times; vol: daily/bar volatility (EWMA of returns)
    out = pd.DataFrame(index=events)
    for t0 in events:
        end = min(close.index.get_loc(t0) + max_hold, len(close) - 1)
        path = close.iloc[close.index.get_loc(t0):end + 1]
        ret = path / close[t0] - 1.0
        up, dn = pt * vol[t0], -sl * vol[t0]
        hit_up = ret[ret > up].index.min()
        hit_dn = ret[ret < dn].index.min()
        first = min([x for x in [hit_up, hit_dn, path.index[-1]] if pd.notna(x)])
        out.loc[t0, "t_end"] = first
        out.loc[t0, "label"] = 1 if first == hit_up else (-1 if first == hit_dn else 0)
    return out
```

Purged K-Fold with embargo (concept):
```python
from sklearn.model_selection import BaseCrossValidator
class PurgedKFold(BaseCrossValidator):
    def __init__(self, n_splits, t_end, embargo=0.01):
        self.n_splits, self.t_end, self.embargo = n_splits, t_end, embargo
    def split(self, X, y=None, groups=None):
        idx = np.arange(len(X)); folds = np.array_split(idx, self.n_splits)
        emb = int(len(X) * self.embargo)
        for te in folds:
            t0, t1 = X.index[te[0]], X.index[te[-1]]
            # purge: drop train rows whose label window [row, t_end] overlaps test span
            train = idx[(self.t_end.values < t0) | (X.index.values > t1)]
            train = train[:-emb] if emb and len(train) > emb else train  # embargo
            yield train, te
```

Walk-forward with sklearn:
```python
from sklearn.model_selection import TimeSeriesSplit
tscv = TimeSeriesSplit(n_splits=5)      # expanding train, next block = test
for tr, te in tscv.split(X):
    scaler.fit(X.iloc[tr]); Xtr = scaler.transform(X.iloc[tr])   # fit on train ONLY
    model.fit(Xtr, y.iloc[tr]); score(model, scaler.transform(X.iloc[te]), y.iloc[te])
```

## References
- [Advances in Financial Machine Learning — Marcos López de Prado](https://www.wiley.com/en-us/Advances+in+Financial+Machine+Learning-p-9781119482086) — the canonical text: labeling, purged CV, meta-labeling, sample weights, fractional differentiation.
- [AFML Ch.3 Labeling (triple-barrier) — O'Reilly](https://www.oreilly.com/library/view/advances-in-financial/9781119482086/c03.xhtml) — triple-barrier and meta-labeling definitions.
- [Purged cross-validation — Wikipedia](https://en.wikipedia.org/wiki/Purged_cross-validation) — purge/embargo and combinatorial purged CV overview.
- [The 10 Reasons Most ML Funds Fail — López de Prado (GARP)](https://www.garp.org/hubfs/Whitepapers/a1Z1W0000054x6lUAA.pdf) — leakage, overfitting, and non-IID pitfalls to avoid.
- [mlfinlab documentation (Hudson & Thames)](https://www.mlfinlab.com/) — Python implementations of triple-barrier, purged/combinatorial CV, sample weights.
- [scikit-learn — TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) — walk-forward, expanding-window CV.
- [scikit-learn — Cross-validation user guide](https://scikit-learn.org/stable/modules/cross_validation.html) — why random CV leaks with time series; pipelines to avoid preprocessing leakage.
- [FreqAI — Introduction](https://www.freqtrade.io/en/stable/freqai/) — adaptive retraining ML framework inside Freqtrade.
- [FreqAI — Feature engineering](https://www.freqtrade.io/en/stable/freqai-feature-engineering/) — `feature_engineering_*`, `include_shifted_candles`, train-only scaling to prevent leakage.
- [FreqAI — Parameter table](https://www.freqtrade.io/en/stable/freqai-parameter-table/) — `train_period_days`, `backtest_period_days`, outlier handling.
- [Bybit V5 — Get Kline (OHLCV)](https://bybit-exchange.github.io/docs/v5/market/kline) — feature source data.
- [Bybit V5 — Orderbook (WS)](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook) — microstructure features (imbalance, depth, microprice).
