---
name: sentiment-news-signals
description: Build alternative-data trading signals for a Bybit crypto platform from news, social sentiment, on-chain metrics, and exchange positioning data. Covers crypto news/social (X/Twitter, Reddit) collection, NLP sentiment scoring (VADER, FinBERT, crypto-tuned LLMs), on-chain metrics (exchange net-flow, SOPR, MVRV), Bybit funding-rate and long/short-ratio as crowd-positioning sentiment, handling alt-data noise/latency/look-ahead, and fusing sentiment with price signals. Invoke for "sentiment signal", "news signal", "Twitter/X sentiment", "Reddit sentiment", "FinBERT", "VADER", "fear and greed", "funding rate signal", "long short ratio", "crowd positioning", "on-chain metrics", "exchange netflow", "SOPR", "MVRV", "Glassnode", "CryptoPanic", "alt-data", or "combine sentiment with price".
---

# Sentiment, News & Alternative-Data Signals

## When to use this skill
- Building a signal from crypto news headlines or social posts (X/Twitter, Reddit).
- Scoring text sentiment (VADER / FinBERT / crypto-tuned model) and turning it into a feature.
- Using Bybit **funding rate** and **long/short ratio** as contrarian crowd-positioning signals.
- Incorporating on-chain metrics (exchange net-flow, SOPR, MVRV) as regime/context features.
- Avoiding the traps of alt-data: latency, look-ahead, bots, and noise; fusing with price.

## Core concepts

**Alt-data = context, not a standalone edge (usually).** News/social sentiment is noisy, laggy, and easily manipulated (bots, paid shills, wash-posting). It works best as a *filter or tilt* on top of a price/technical signal, or as a regime indicator — rarely as a lone trigger.

**Sentiment sources, roughly by signal quality:**
- **Exchange positioning (best signal-to-noise, real money):** Bybit funding rate and long/short account ratio reflect where leveraged crowd is actually positioned. Extreme positioning is often *contrarian* — very high funding (longs overpaying) precedes long squeezes; a crowded long/short ratio marks over-extension.
- **On-chain (medium, slow):** exchange net-flow (coins to exchanges → sell pressure; outflows → accumulation), SOPR (spent outputs in profit/loss; >1 = profit-taking), MVRV (market vs realized value; extremes = euphoria/capitulation). Good for macro regime, poor for intraday timing.
- **News (medium, event-driven):** headlines from aggregators (e.g. CryptoPanic) around listings, hacks, regulation, ETF flows. Fast movers but prone to "buy the rumor, sell the news".
- **Social (noisiest):** X/Twitter, Reddit volume and polarity; strong reflexivity and bot contamination. Treat *change* in sentiment/volume, not absolute level.

**NLP scoring options:**
- **VADER** — lexicon/rule-based, tuned for social media, fast, no GPU; weak on finance/crypto slang.
- **FinBERT** — BERT fine-tuned on financial text (Financial PhraseBank, etc.); better on finance tone but not crypto-native ("HODL", "rekt", "wagmi").
- **Crypto-tuned transformers / LLMs** — best on crypto slang; higher cost/latency. Ensemble lexicon + transformer for robustness.

**Look-ahead & latency are the killer bugs of alt-data.** Every datum must be stamped with the **time it became available to you** (publish/ingest time), not the event time. A tweet's `created_at`, an on-chain metric's *confirmation/settlement* time, a funding value's *funding timestamp*. Backtests that join sentiment on event time leak the future. Also account for ingestion delay (API polling, model inference time) so live and backtest align.

## Bybit / Python specifics
- **Long/Short Ratio:** `GET /v5/market/account-ratio` — params `category=linear`, `symbol=BTCUSDT`, `period` (`5min`,`15min`,`30min`,`1h`,`4h`,`1d`), `limit` (≤500). Returns `buyRatio`/`sellRatio` (fraction of accounts long/short) + `timestamp`. Use as a crowd-positioning / contrarian feature; watch extremes and rate-of-change.
- **Funding Rate History:** `GET /v5/market/funding/history` — `category=linear`, `symbol`, `limit` (≤200). Positive funding = longs pay shorts (bullish crowd, potential over-leverage). Funding interval varies by symbol (query `GET /v5/market/instruments-info`). Current/predicted funding is on the ticker (`GET /v5/market/tickers` → `fundingRate`, `nextFundingTime`).
- **Open Interest:** `GET /v5/market/open-interest` (`period` like long/short) — rising OI + rising price = trend conviction; rising OI + falling price = shorts building. Pairs well with funding.
- **News/social ingestion (Python):** async collectors (`aiohttp`) with polling + de-dupe by URL/id; store raw text + `available_at` timestamp. Twitter/X via API v2; Reddit via PRAW; news via aggregator API (e.g. CryptoPanic). Respect rate limits and cache.
- **Scoring pipeline:** VADER (`vaderSentiment`) for a fast baseline; FinBERT/crypto model via `transformers` for quality; batch inference, cache by text hash. Aggregate to a per-symbol, per-bar score (mean/weighted by author reach, EWMA to denoise).
- **Fusion:** align every alt-data feature to the trading bar by its `available_at` (lag it), then feed alongside price features into the ML signal skill's model, or use as a gate (e.g. only take long technical signals when funding isn't extreme).

## Implementation checklist
- [ ] For every alt-data record, store `available_at` (ingest/publish time), not just event time; lag features to it.
- [ ] De-duplicate and filter bots/spam (author age, follower thresholds, duplicate-text clustering).
- [ ] Normalize each source to a comparable score (z-score or EWMA), and prefer *change* over level.
- [ ] Pull Bybit funding + long/short ratio + OI; build contrarian/extreme features (percentile ranks).
- [ ] Add on-chain regime features (net-flow, SOPR, MVRV) lagged to their availability.
- [ ] Aggregate text sentiment per symbol per bar (reach-weighted mean + volume of mentions).
- [ ] Backtest with the SAME latency you'll have live (ingestion + inference delay).
- [ ] Combine with price signal as a filter/tilt; validate the combined signal via walk-forward (see ml-trading-signals skill), not sentiment alone.
- [ ] Monitor source reliability drift (API changes, bot waves, dead accounts).

## Do / Don't
**Do**
- Timestamp data by when it was actually available to you; lag every feature to that.
- Treat Bybit funding / long-short extremes as *contrarian* positioning signals, not momentum.
- Use *change* in sentiment/volume and percentile ranks, not raw absolute scores.
- Filter bots/spam and de-dupe before scoring.
- Ensemble a lexicon model (VADER) with a finance/crypto transformer (FinBERT) for robustness.

**Don't**
- Don't join sentiment/on-chain data on event time — that leaks the future into the backtest.
- Don't trade on a single tweet or headline; reflexivity and manipulation are rampant.
- Don't assume general-English sentiment models understand crypto slang ("rekt", "HODL", "wagmi").
- Don't ignore ingestion/inference latency — a signal you can't act on in time is worthless.
- Don't use raw absolute sentiment level as a signal; it's regime-dependent and drifts.

## Common pitfalls
- **Availability look-ahead:** on-chain metrics and news get revised/confirmed after the event; using event time inflates backtests massively.
- **Funding sign confusion:** positive funding means longs pay shorts (crowd long), which is a *warning* at extremes, not a buy. Verify sign and interval per symbol.
- **Bot/shill contamination:** coordinated posting spikes "positive" sentiment right before dumps; unfiltered social sentiment is often a fade signal.
- **Rate limits / gaps:** X/Reddit/news APIs throttle; missing windows create silent NaNs the model misreads. Backfill and flag gaps.
- **Model tone mismatch:** FinBERT calls "short squeeze" negative; crypto context inverts many finance priors. Validate on labeled crypto text.
- **Stale on-chain cadence:** SOPR/MVRV are daily-ish and slow; using them for minute-level signals just adds a constant.
- **Overfitting to a few events:** a sentiment "edge" driven by 3 news spikes won't generalize.

## Code patterns

Bybit positioning features (long/short ratio + funding), leak-safe timestamps:
```python
from pybit.unified_trading import HTTP
import pandas as pd
s = HTTP()

def ls_ratio(symbol="BTCUSDT", period="1h", limit=200):
    r = s.get_long_short_ratio(category="linear", symbol=symbol, period=period, limit=limit)
    df = pd.DataFrame(r["result"]["list"])
    df["ts"] = pd.to_datetime(df["timestamp"].astype("int64"), unit="ms", utc=True)
    df[["buyRatio", "sellRatio"]] = df[["buyRatio", "sellRatio"]].astype(float)
    df["skew"] = df["buyRatio"] - df["sellRatio"]          # >0 crowd long
    df["skew_pctile"] = df["skew"].rank(pct=True)          # extremes = contrarian
    return df.set_index("ts").sort_index()

def funding(symbol="BTCUSDT", limit=200):
    r = s.get_funding_rate_history(category="linear", symbol=symbol, limit=limit)
    df = pd.DataFrame(r["result"]["list"])
    df["ts"] = pd.to_datetime(df["fundingRateTimestamp"].astype("int64"), unit="ms", utc=True)
    df["fundingRate"] = df["fundingRate"].astype(float)     # >0 longs pay shorts
    return df.set_index("ts").sort_index()
```

Text sentiment (VADER + FinBERT ensemble), reach-weighted aggregation:
```python
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from transformers import pipeline
vader = SentimentIntensityAnalyzer()
finbert = pipeline("text-classification", model="ProsusAI/finbert")

def score(text):
    v = vader.polarity_scores(text)["compound"]            # [-1, 1]
    fb = finbert(text[:512])[0]
    f = {"positive": 1, "negative": -1, "neutral": 0}[fb["label"]] * fb["score"]
    return 0.5 * v + 0.5 * f

def bar_sentiment(posts):  # posts: [{text, reach, available_at}]
    df = pd.DataFrame(posts)
    df["s"] = df["text"].map(score)
    df["available_at"] = pd.to_datetime(df["available_at"], utc=True)
    df["w"] = df["reach"].clip(lower=1)
    g = df.set_index("available_at").resample("1h")
    return pd.DataFrame({
        "sent": g.apply(lambda x: (x["s"] * x["w"]).sum() / x["w"].sum() if len(x) else 0.0),
        "mentions": g.size(),
    })  # feed lagged to the price model
```

## References
- [Bybit V5 — Get Long/Short Ratio](https://bybit-exchange.github.io/docs/v5/market/long-short-ratio) — `account-ratio` endpoint, `buyRatio`/`sellRatio`, periods.
- [Bybit V5 — Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — historical funding as leverage/crowd sentiment.
- [Bybit V5 — Get Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers) — current `fundingRate`, `nextFundingTime`, `openInterest`.
- [Bybit V5 — Get Open Interest](https://bybit-exchange.github.io/docs/v5/market/open-interest) — OI trend to confirm positioning.
- [Bybit V5 — Get Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — funding interval per symbol.
- [pybit (official Bybit Python SDK)](https://github.com/bybit-exchange/pybit) — `get_long_short_ratio`, `get_funding_rate_history`, `get_open_interest`.
- [VADER Sentiment (vaderSentiment)](https://github.com/cjhutto/vaderSentiment) — lexicon/rule-based social-media sentiment.
- [FinBERT (ProsusAI) on Hugging Face](https://huggingface.co/ProsusAI/finbert) — BERT fine-tuned for financial-tone classification.
- [Hugging Face Transformers — pipelines](https://huggingface.co/docs/transformers/main_classes/pipelines) — running FinBERT/crypto sentiment models in Python.
- [PRAW — Python Reddit API Wrapper](https://praw.readthedocs.io/) — collecting Reddit posts/comments.
- [X (Twitter) API v2 docs](https://developer.x.com/en/docs/x-api) — social post ingestion and rate limits.
- [CryptoPanic API](https://cryptopanic.com/developers/api/) — aggregated crypto news with basic sentiment/votes.
- [Glassnode Docs — Metric Catalog (SOPR, MVRV, exchange flows)](https://docs.glassnode.com/data/metric-catalog) — on-chain regime metrics and their definitions/availability.
- [Glassnode Docs — Indicators endpoint](https://docs.glassnode.com/basic-api/endpoints/indicators) — pulling on-chain indicators via API (mind availability lag).
