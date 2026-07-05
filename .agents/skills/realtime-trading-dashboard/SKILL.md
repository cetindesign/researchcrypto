---
name: realtime-trading-dashboard
description: Building the live monitoring UI for a multi-bot crypto trading platform with TradingView Lightweight Charts — candlestick/line/histogram series, trade markers (entries/exits) on the chart, streaming live PnL/positions/orders/fills over a WebSocket from the FastAPI backend, high-frequency updates without re-render storms (series.update vs setData), orderbook/depth display, and low-latency rendering. Invoke when the task mentions Lightweight Charts, TradingView charts, candlestick chart, "series markers", live PnL/positions/orders panel, WebSocket to frontend, "chart not updating"/re-render lag, orderbook/depth ladder, streaming updates, or connecting the dashboard to the FastAPI `/ws` endpoint.
---

# Realtime Trading Dashboard (TradingView Lightweight Charts)

## When to use this skill
- Building or debugging the live chart: candlesticks, volume histogram, plotting bot trade entries/exits as markers.
- Streaming PnL, open positions, orders, and fills into UI panels over a WebSocket from the backend.
- Fixing performance issues: janky updates, re-render storms, memory growth, dropped frames under fast ticks.
- Rendering an orderbook / depth ladder that updates many times per second.
- Wiring the dashboard to the FastAPI WebSocket endpoint (auth, reconnect, backpressure).

## Core concepts
- **Chart / series model**: `createChart(container, options)` returns a chart; you `addSeries(CandlestickSeries, opts)` (v5 API) or the older `addCandlestickSeries()`/`addLineSeries()`/`addHistogramSeries()` (v4). Time is UNIX seconds (`UTCTimestamp`) or `'yyyy-mm-dd'` business-day strings — be consistent.
- **`setData()` vs `update()`**: `setData(array)` **replaces the entire dataset** — use it once for history/backfill. `update(point)` appends a new bar or **mutates the most recent bar in place** (same `time` = replace last, newer `time` = new bar). During live streaming call `update()` per tick; calling `setData()` on every tick is the #1 cause of re-render storms and GC churn.
- **Markers**: in v5, `createSeriesMarkers(series, markers[])` (v4: `series.setMarkers(...)`). Each marker: `{ time, position: 'aboveBar'|'belowBar'|'inBar', color, shape: 'arrowUp'|'arrowDown'|'circle'|'square', text }`. For candlesticks you only need `time` + `position`; the marker anchors to the bar's high/low. Use markers for bot entries (green arrowUp belowBar) and exits (red arrowDown aboveBar). Markers must stay sorted by `time`.
- **Panes / multi-series**: overlay volume as a histogram on its own price scale (`priceScaleId: ''` + scale margins); keep PnL equity curve as a separate line series or separate chart.
- **Rendering**: canvas-based (not DOM/SVG), so it absorbs rapid updates far better than DOM chart libs; the library also manages viewport shifts on new bars.

## Python & stack specifics
- **Backend feed**: the FastAPI backend (see `backend-api-service` skill) exposes `/ws/live`. Bot/market data ultimately comes from Bybit V5 (kline + private position/order/execution streams via `pybit`/`ccxt.pro`); the backend normalizes it and pushes compact JSON frames to the browser. Don't connect the browser directly to Bybit with API keys — proxy through the backend.
- **Message shape**: use a tagged envelope, e.g. `{ "type": "kline"|"pnl"|"position"|"order"|"fill"|"depth", "data": {...} }`, so the client dispatches to the right handler. Send **closed** candles for history and a single "current forming" candle you keep `update()`-ing until it closes.
- **Bybit kline → chart point**: map `{ start, open, high, low, close, volume }` to `{ time: start/1000, open, high, low, close }` (seconds, not ms). Bybit timestamps are milliseconds — divide by 1000.
- **Depth**: Bybit `orderbook.<depth>.<symbol>` sends a snapshot then deltas; maintain the book in JS (apply deltas by price level, drop levels with size 0) and render the ladder yourself — Lightweight Charts is for time series, not the depth ladder.
- **Frontend**: install `lightweight-charts` (npm) or use the community Python `lightweight-charts` wrapper for quick internal tools; production dashboards use the JS lib in React/Svelte/vanilla.

## Implementation checklist
- [ ] Create chart with `autoSize` (or a ResizeObserver) so it fills its container and survives layout changes.
- [ ] Backfill history once via REST → `candleSeries.setData(history)`; then switch to live `update()`.
- [ ] Open one WebSocket to the backend; authenticate (token in first message or query); dispatch by `type`.
- [ ] On each `kline` frame, `candleSeries.update(point)` — never `setData` per tick.
- [ ] Batch non-chart UI state (PnL/positions/orders) and flush on `requestAnimationFrame` to avoid React re-render storms.
- [ ] Add trade markers via `createSeriesMarkers`; keep the marker array sorted and bounded (prune old ones).
- [ ] Maintain the orderbook from snapshot+delta; render the ladder in a separate throttled component.
- [ ] Implement reconnect with exponential backoff + jitter; on reconnect, re-backfill the last bars to fill gaps.
- [ ] Show a connection/latency indicator (compare server send-timestamp to client receive-time).
- [ ] Clean up on unmount: `chart.remove()`, close the socket, cancel timers/RAF.

## Do / Don't
**Do**
- Use `series.update()` for every live tick and `setData()` only for initial/bulk loads.
- Coalesce bursts: if messages arrive faster than frames, keep only the latest per symbol and paint once per frame.
- Keep marker/PnL arrays bounded; unbounded growth leaks memory over a trading day.
- Proxy market data through the backend; keep exchange API keys server-side only.
- Reconnect with backoff and re-sync history to cover the gap during the disconnect.

**Don't**
- Don't call `setData()` on every WebSocket message — it re-ingests the whole series and stutters.
- Don't call `setState`/re-render per message in React; batch and use refs/imperative chart API.
- Don't feed millisecond timestamps where the lib expects seconds — bars land in 1970 or scatter.
- Don't push unsorted or out-of-order markers/data — updates get rejected or misplaced.
- Don't hold the WebSocket in component state so every frame re-renders the tree.

## Common pitfalls
- **Re-render storms**: driving a canvas chart through React state on every tick — bypass React for the hot path and mutate the series imperatively.
- **ms vs s timestamps**: Bybit sends ms; the chart wants seconds — the most common "nothing shows up" bug.
- **Gap after reconnect**: live-only `update()` loses bars during a disconnect; always re-backfill on reconnect.
- **Unbounded memory**: never pruning markers/points or old depth levels causes steady memory growth and slowdowns.
- **Order-book drift**: applying deltas without honoring the snapshot sequence / not removing zero-size levels desyncs the ladder from the exchange.
- **Multiple chart instances**: forgetting `chart.remove()` on route change leaks canvases and event listeners.

## Code patterns
```javascript
import { createChart, CandlestickSeries, HistogramSeries, createSeriesMarkers } from 'lightweight-charts';

const chart = createChart(document.getElementById('chart'), { autoSize: true });
const candles = chart.addSeries(CandlestickSeries, { upColor: '#26a69a', downColor: '#ef5350' });
const volume = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } });
volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

// 1) history once
candles.setData(await fetchHistory());               // NOT called again per tick

// 2) live stream from the FastAPI backend WS
const markers = createSeriesMarkers(candles, []);
let pending = null, frame = null;

const ws = new WebSocket(`wss://api.example.com/ws/live?token=${token}`);
ws.onmessage = (ev) => {
  const { type, data } = JSON.parse(ev.data);
  if (type === 'kline') {
    // Bybit ms -> seconds; same time => replaces the forming bar
    pending = { time: data.start / 1000, open: +data.open, high: +data.high,
                low: +data.low, close: +data.close };
    if (!frame) frame = requestAnimationFrame(() => {   // coalesce to one paint/frame
      if (pending) candles.update(pending);
      pending = null; frame = null;
    });
  } else if (type === 'fill') {
    appendMarker({ time: data.ts / 1000,
      position: data.side === 'Buy' ? 'belowBar' : 'aboveBar',
      color: data.side === 'Buy' ? '#26a69a' : '#ef5350',
      shape: data.side === 'Buy' ? 'arrowUp' : 'arrowDown',
      text: `${data.side} ${data.qty}` });
  } else if (type === 'pnl' || type === 'position' || type === 'order') {
    queuePanelUpdate(type, data);   // batch panel state, flush on RAF
  }
};

let sorted = [];
function appendMarker(m) {
  sorted.push(m);
  sorted.sort((a, b) => a.time - b.time);   // markers must be time-sorted
  if (sorted.length > 500) sorted = sorted.slice(-500);  // bound memory
  markers.setMarkers(sorted);
}
```

```javascript
// Reconnect with backoff + gap re-sync
function connect(attempt = 0) {
  const ws = new WebSocket(url);
  ws.onclose = () => {
    const delay = Math.min(30000, 2 ** attempt * 1000) + Math.random() * 500;
    setTimeout(() => { backfillRecentBars().then(() => connect(attempt + 1)); }, delay);
  };
  ws.onopen = () => { attempt = 0; ws.send(JSON.stringify({ auth: token })); };
  return ws;
}
```

## References
- [Lightweight Charts — Getting started](https://tradingview.github.io/lightweight-charts/docs) — install, create chart, add series, load data.
- [Lightweight Charts — Series types](https://tradingview.github.io/lightweight-charts/docs/series-types) — candlestick, line, histogram, area configuration.
- [Lightweight Charts — Add series markers](https://tradingview.github.io/lightweight-charts/tutorials/how_to/series-markers) — plotting trade entry/exit markers.
- [Lightweight Charts — Realtime updates demo](https://tradingview.github.io/lightweight-charts/tutorials/demos/realtime-updates) — streaming with `update()`.
- [Lightweight Charts — API reference](https://tradingview.github.io/lightweight-charts/docs/api) — full API: `setData`, `update`, marker/series interfaces.
- [lightweight-charts on GitHub](https://github.com/tradingview/lightweight-charts) — source, changelog, v4→v5 migration.
- [FastAPI — WebSockets](https://fastapi.tiangolo.com/advanced/websockets/) — backend WebSocket endpoint the dashboard connects to.
- [Bybit V5 — WebSocket public (kline)](https://bybit-exchange.github.io/docs/v5/ws/connect) — market-data streams feeding the chart.
- [Bybit V5 — Private order stream](https://bybit-exchange.github.io/docs/v5/websocket/private/order) — order/fill events surfaced as markers/panels.
