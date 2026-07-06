---
name: sentiment-news-signals
description: Build the news + economic-calendar pipeline of this Bybit/Bun/TypeScript trading platform and the guards it produces. Covers the `news` scraper loop (every 3m) and `calendar` scraper loop (every 15m) that ingest RSS / economic-calendar sources, score news sentiment with Google Gemini, and persist scored items to MySQL via Drizzle; the entry guards derived from them (news-guard, BTC-shock, calendar blackout) that gate the v3 engine's entries; and Bybit funding-rate + long/short-ratio as crowd-positioning sentiment. Also covers RSS parsing in TypeScript (rss-parser / fast-xml-parser), de-dupe, availability-time / look-ahead handling, latency and noise, and fusing sentiment guards with price signals. Invoke for "news scraper", "calendar scraper", "RSS feed", "economic calendar", "news guard", "BTC shock", "calendar blackout", "sentiment score", "Gemini sentiment", "funding rate signal", "long short ratio", "crowd positioning", "gate entries", "blackout window", or "alt-data look-ahead".
---

# News, Calendar & Positioning Signals (guards that gate entries)

## When to use this skill
- Implementing or changing the `news` (3m) or `calendar` (15m) scraper loops.
- Parsing RSS / economic-calendar feeds in TypeScript and storing scored items in MySQL (Drizzle).
- Scoring headline sentiment with Google Gemini and turning it into a numeric signal.
- Building the entry guards — **news-guard**, **BTC-shock**, **calendar blackout** — that block the engine from entering.
- Using Bybit **funding rate** and **long/short ratio** as contrarian crowd-positioning features.

## Core concepts

**Sentiment here is a GATE, not a standalone signal.** In this platform the news/calendar pipeline mainly produces **guards** that veto entries — it rarely triggers a trade on its own. A guard answers one question per candidate: "is it unsafe to open a new position right now?" The engine's entry path checks these guards (news / calendar / BTC-shock / cooldown) before placing a MARKET order. Blocking a bad entry is worth more than a clever signal.

**The three guards:**
- **news-guard** — recent high-impact negative/insecurity news (hack, exploit, regulation, delisting, exchange trouble) scored by Gemini above a severity threshold → pause new entries for a cooldown window.
- **BTC-shock** — a sharp BTC move (large short-window % change / volatility spike from the collector's snapshots) → because alts follow BTC, block or tighten entries until it settles. This one is price-derived, not text — it lives beside the news guards because it is another "don't enter now" gate.
- **calendar blackout** — around a scheduled high-impact macro event (CPI, FOMC, NFP from the economic calendar) → a blackout window before/after during which entries are suppressed.

**Availability time, not event time (the killer bug).** Every scraped item must be stamped with **when it became available to us** (fetch/publish time), never the event time. A calendar event's *scheduled* time is known ahead — that's fine and is exactly what powers the blackout — but a news item's sentiment must only affect decisions *after* we ingested it. Mixing these leaks the future; more practically, it makes a guard fire on data the live engine wouldn't have had yet.

**Latency & noise.** RSS feeds lag the event; Gemini scoring adds seconds; feeds carry duplicates, reposts, and clickbait. So: de-dupe by URL/guid before scoring (also to save Gemini calls), treat one headline as weak evidence, prefer a short rolling window of items over any single one, and design guards to fail safe (if scoring is unavailable, either skip the guard or, for safety-critical ones, block entries rather than trade blind — pick per guard).

**Crowd positioning = real-money sentiment.** Bybit **funding rate** and **long/short account ratio** show where leveraged traders actually sit — far higher signal-to-noise than social text. They're **contrarian at extremes**: very positive funding (longs overpaying) and a crowded long ratio precede long squeezes. Use them as a tilt/filter on entries, using *change* and percentile rank, not raw level.

## Codebase specifics (Bun / Drizzle / Bybit / Gemini)
- **Loops:** `news` runs every 3m, `calendar` every 15m, both started after `ensureSchema`, both polling REST (no WebSocket). Use `fetch` (Bun-native) with per-feed timeouts and backoff; never let a slow feed stall the loop.
- **RSS ingestion (TS):** `rss-parser` for a high-level `parseURL`/`parseString` API, or `fast-xml-parser` (zero-dep, tiny) when you want raw control over odd/atom feeds. Both run under Bun. Normalize to `{ guid, title, link, publishedAt, source, fetchedAt }`.
- **Sources:** crypto news RSS aggregators for `news`; economic-calendar feeds (e.g. Investing.com / Forex Factory style) for `calendar`. Respect each source's rate limits and cache the last-seen guid to avoid re-scoring.
- **Scoring with Gemini:** send de-duped headlines to Gemini with a strict JSON `responseSchema` → `{ sentiment: -1..1, severity: 0..1, category, symbolsAffected[] }`. See the `gemini-ai-integration` skill for the client, structured output, prompt-injection defense (scraped text is untrusted!), retries, and cost control.
- **Storage (Drizzle):** persist each scored item to a `news_item` / `calendar_event` table with `fetchedAt` (availability), `publishedAt`, the Gemini score fields, and a de-dupe unique key on `guid`/`link`. Guards query recent rows, not the live feed.
- **Bybit positioning:** `GET /v5/market/account-ratio` (`category=linear`, `symbol`, `period`) → `buyRatio`/`sellRatio`; `GET /v5/market/funding/history` → historical `fundingRate`; current funding + `nextFundingTime` on `GET /v5/market/tickers`. Store with their own timestamps; use percentile/extreme features.
- **Guard evaluation:** the engine's entry check reads the latest guard state (a small computed row/flag per symbol or global), so guards are precomputed by the loops and read cheaply in the hot path — not recomputed by calling Gemini inside the engine turn.

## Implementation checklist
- [ ] `news` (3m) and `calendar` (15m) loops with `fetch` + per-feed timeout, backoff, and last-seen-guid cache.
- [ ] Parse feeds with `rss-parser`/`fast-xml-parser`; normalize and stamp every item with `fetchedAt` (availability).
- [ ] De-dupe by `guid`/`link` before scoring (unique key in the table) to cut noise and Gemini cost.
- [ ] Score news via Gemini structured JSON → `{sentiment, severity, category, symbolsAffected}`; store in MySQL (Drizzle).
- [ ] Compute **news-guard**: negative/high-severity items in the last window → block/cooldown new entries.
- [ ] Compute **BTC-shock** from collector snapshots: |BTC short-window %move|/vol over threshold → block/tighten entries.
- [ ] Compute **calendar blackout**: suppress entries in a window around scheduled high-impact events (event time IS known ahead).
- [ ] Pull Bybit funding + long/short ratio; derive contrarian/extreme (percentile, rate-of-change) features.
- [ ] Precompute guard state so the engine reads a cheap flag; never call Gemini inside the engine turn.
- [ ] Make guards fail safe when a source or Gemini is down (skip vs block, decided per guard) and log why a guard fired.

## Do / Don't
**Do**
- Stamp every item by availability (`fetchedAt`); only let news affect decisions after ingestion.
- De-dupe before scoring; treat a short rolling window of items, not a single headline.
- Precompute guard flags in the loops; keep the engine's entry check O(1).
- Treat Bybit funding / long-short extremes as contrarian positioning, using change + percentile.
- Treat all scraped news text as untrusted input to Gemini (see gemini-ai-integration).

**Don't**
- Don't join news sentiment on event time — that leaks the future and makes guards fire on data you didn't have.
- Don't trade or block on one raw headline; reflexivity and reposts are rampant.
- Don't call Gemini synchronously inside the ~10s engine loop; score in the news loop and store the result.
- Don't let a slow/broken feed stall the loop — bound every `fetch` with a timeout.
- Don't use raw absolute funding/ratio level as a signal; it's regime-dependent — use extremes.

## Common pitfalls
- **Availability look-ahead:** using `publishedAt` (or event time) instead of `fetchedAt` for news → the guard "knew" too early.
- **Duplicate storms:** aggregators repost the same story; unfiltered, it inflates severity and burns Gemini quota. Unique-key de-dupe.
- **Funding sign confusion:** positive funding = longs pay shorts (crowd long) — a *warning* at extremes, not a buy.
- **Blackout math off-by-one:** blackout must cover *before and after* the event and use the event's timezone; a wrong TZ misses CPI/FOMC entirely.
- **Gemini in the hot path:** scoring in the engine turn adds seconds of latency and cost; keep it in the 3m loop.
- **Guard fails open silently:** if scoring errors and the guard defaults to "allow", you enter into exactly the news you meant to avoid — decide fail-open vs fail-closed per guard and log it.
- **Stale positioning cadence:** long/short-ratio periods are coarse (5m–1d); don't treat a 1h value as tick-fresh.

## Code patterns

Poll + parse an RSS feed, de-dupe, stamp availability (Bun/TS):
```ts
import Parser from "rss-parser";
const parser = new Parser();

async function ingestFeed(source: string, url: string) {
  const ctrl = AbortSignal.timeout(8000);                 // never stall the loop
  const feed = await parser.parseURL(url);                // rss-parser handles RSS/Atom
  const fetchedAt = new Date();
  for (const it of feed.items) {
    const guid = it.guid ?? it.link!;
    await db.insert(newsItem).values({
      guid, source, title: it.title ?? "", link: it.link ?? "",
      publishedAt: it.isoDate ? new Date(it.isoDate) : fetchedAt,
      fetchedAt,                                           // availability time = when WE saw it
    }).onDuplicateKeyUpdate({ set: { fetchedAt } });       // unique(guid) => de-dupe
  }
}
```

Compute the news-guard from recently scored items:
```ts
import { and, gte, eq } from "drizzle-orm";

async function newsGuard(symbol: string, now = Date.now()): Promise<boolean> {
  const since = new Date(now - 30 * 60_000);              // 30m window on availability
  const rows = await db.select().from(newsItem).where(
    and(gte(newsItem.fetchedAt, since), eq(newsItem.scored, true)),
  );
  // block entries if any high-severity negative item hit this symbol (or BTC/global)
  return rows.some((r) =>
    r.severity >= 0.6 && r.sentiment <= -0.3 &&
    (r.symbolsAffected.includes(symbol) || r.symbolsAffected.includes("BTC")));
}
```

Bybit positioning as contrarian features (funding + long/short ratio):
```ts
async function positioning(symbol = "BTCUSDT", period = "1h") {
  const [lsr, fund] = await Promise.all([
    bybitGet("/v5/market/account-ratio", { category: "linear", symbol, period, limit: 200 }),
    bybitGet("/v5/market/funding/history", { category: "linear", symbol, limit: 200 }),
  ]);
  const list = lsr.result.list.map((x: any) => ({
    ts: Number(x.timestamp),
    skew: Number(x.buyRatio) - Number(x.sellRatio),        // >0 crowd long
  }));
  const skews = list.map((l) => l.skew).sort((a, b) => a - b);
  const latest = list.at(-1)!.skew;
  const pctile = skews.filter((s) => s <= latest).length / skews.length;   // extremes = contrarian
  const funding = Number(fund.result.list[0].fundingRate);                 // >0 longs pay shorts
  return { skew: latest, skewPctile: pctile, funding };
}
```

## References
- [rss-parser (npm)](https://www.npmjs.com/package/rss-parser) — high-level RSS/Atom parsing with TypeScript types; runs under Bun.
- [rss-parser (GitHub)](https://github.com/rbren/rss-parser) — `parseURL`/`parseString`, custom fields, examples.
- [fast-xml-parser (npm)](https://www.npmjs.com/package/fast-xml-parser) — zero-dependency, tiny XML parser for odd/Atom feeds.
- [Google Gemini API — Structured output](https://ai.google.dev/gemini-api/docs/structured-output) — `responseMimeType`/`responseSchema` for JSON sentiment scores (details in gemini-ai-integration).
- [OWASP Top 10 for LLM Applications (2025)](https://owasp.org/www-project-top-10-for-large-language-model-applications/) — scraped headlines are untrusted input (LLM01 prompt injection) before they hit Gemini.
- [Bybit V5 — Get Long/Short Ratio](https://bybit-exchange.github.io/docs/v5/market/long-short-ratio) — `account-ratio` endpoint, `buyRatio`/`sellRatio`, periods.
- [Bybit V5 — Get Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) — historical funding as crowd-leverage sentiment.
- [Bybit V5 — Get Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers) — current `fundingRate`, `nextFundingTime`, `openInterest`.
- [Bybit V5 — Get Open Interest](https://bybit-exchange.github.io/docs/v5/market/open-interest) — OI trend to confirm positioning.
- [Investing.com — RSS Feeds](https://www.investing.com/webmaster-tools/rss) — breaking crypto/forex/economy news + economic-calendar feeds.
- [Drizzle ORM — Insert (upsert / onDuplicateKeyUpdate)](https://orm.drizzle.team/docs/insert) — idempotent de-duped writes of scored items.
- [Drizzle ORM — Select](https://orm.drizzle.team/docs/select) — querying recent items to compute guard state.
