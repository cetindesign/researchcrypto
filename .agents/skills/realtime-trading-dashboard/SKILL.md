---
name: realtime-trading-dashboard
description: Building the live monitoring UI for a multi-bot Bybit trading platform — React 19 + Vite + TanStack Router + TanStack Query + Tailwind v4, consuming the backend tRPC v11 API through the typed @trpc/tanstack-react-query integration. Because there is NO WebSocket, live PnL/positions/orders/decision-log come from TanStack Query POLLING (refetchInterval), not a socket. Covers sensible refetch intervals per data type, dynamic/adaptive polling, optimistic updates for config toggles, TradingView Lightweight Charts v5 fed from query data (setData once, update() thereafter), and avoiding re-render storms. Invoke when the task mentions the trading dashboard/panel, tRPC React hooks, refetchInterval polling, live PnL/positions panel, Lightweight Charts/candlestick chart, optimistic UI, TanStack Router pages, Tailwind v4, or "chart not updating"/re-render lag.
---

# Realtime Trading Dashboard (React 19 + TanStack + tRPC, polling)

## When to use this skill
- Building or extending panel pages (positions, orders, PnL, decision log, bot config) with TanStack Router + TanStack Query.
- Wiring the UI to the backend via the typed tRPC React Query hooks and choosing `refetchInterval` per data type.
- Making live-ish updates work **without a WebSocket** — everything is HTTP polling of the tRPC API.
- Adding optimistic UI for config edits / enabling-disabling a bot slot, with rollback on error.
- Rendering candlestick/PnL charts with TradingView Lightweight Charts v5 fed from polled query data.
- Fixing performance: re-render storms, janky charts, too-aggressive polling burning the shared rate-limit budget.

## Core concepts
- **No socket — polling is the live channel.** The backend is polling REST against Bybit (no WS anywhere). The UI mirrors that: TanStack Query's `refetchInterval` re-runs a query every N ms while a component observes it. `refetchInterval` is independent of `staleTime` — it fires on its own clock. Pick intervals to match how fast the underlying data actually changes and the server's own tick.
- **Typed tRPC hooks.** With `@trpc/tanstack-react-query`, `trpc.positions.list.queryOptions()` returns a fully typed options object you pass to `useQuery`; `trpc.configs.update.mutationOptions()` for `useMutation`. Query keys are derived from the tRPC path, so cache invalidation is type-safe (`queryClient.invalidateQueries(trpc.positions.list.queryFilter())`).
- **Interval budget.** Every poll is a real HTTP call that may fan out to a DB read (or, worst case, a signed Bybit call server-side). Fast panels (PnL, positions) ~3-5s; orders ~5s; decision/event log ~15-30s; slow/static config ~on-demand only. Use `refetchIntervalInBackground: false` (default) so hidden tabs stop polling.
- **Adaptive polling.** `refetchInterval` accepts a function `(query) => number | false` — slow down or stop when there's nothing to watch (no open positions → 30s; an active fill in flight → 2s), and stop entirely (`false`) on error to avoid hammering a failing endpoint.
- **Optimistic updates.** For config toggles, use `useMutation` with `onMutate` (cancel in-flight queries, snapshot cache, `setQueryData` optimistically), `onError` (roll back to snapshot), `onSettled` (invalidate to reconcile with server truth). Remember the engine only *acts* on the change on its next 10s turn — reflect "pending" state, don't imply the position changed instantly.
- **Charts are imperative, not React state.** Lightweight Charts v5: `createChart(el)` then `chart.addSeries(CandlestickSeries, opts)`. Load history **once** with `series.setData(array)`; apply new/updated bars with `series.update(point)`. Drive the chart from a `useRef` + effect that reads query data — never store bar arrays in React state and re-render per tick.

## Codebase specifics (React 19 / Vite / TanStack / Tailwind v4)
- **Stack:** React 19 + Vite (dev/build), TanStack Router for type-safe file/route trees, TanStack Query as the server-state cache, Tailwind v4 for styling, tRPC client for the API. All TypeScript strict. The web app is a Turborepo `apps/` package; it imports the backend's `AppRouter` **type** for end-to-end typing.
- **Data sources (all tRPC queries, polled):** `positions.list`, `orders.list`, `bots.pnl`, `configs.get`, `logs.decisions` (the `v3_decision_log`), `logs.events` (the `v3_position_event` audit trail). The server reconciles Bybit → DB; the UI reads the reconciled ledger, so it never talks to Bybit directly and never holds API keys.
- **tRPC client setup:** `createTRPCContext<AppRouter>()` gives a `TRPCProvider`; wrap the app with it plus a shared `QueryClient`/`QueryClientProvider`. The httpBatchLink points at the Hono `/trpc` endpoint with `credentials: 'include'` so the Better-Auth session cookie rides along.
- **Router + auth guard:** protected routes use a TanStack Router `beforeLoad` that checks the session query and redirects to the Google/email login when unauthenticated. Route params/search are type-checked by the compiler.
- **Tailwind v4:** installed via `@tailwindcss/vite` plugin; a single `@import "tailwindcss";` in the entry CSS (no `tailwind.config.js`, no PostCSS). Theme tokens (colors for up/down, PnL green/red) live in a `@theme { --color-... }` block and are emitted as both CSS vars and utilities.
- **Pending-vs-actual semantics:** because the engine is a 10s loop, an optimistic toggle should show "queued" until the next `configs.get` / `logs.events` poll confirms the engine applied it. Don't fake instant fills.

## Implementation checklist
- [ ] Wrap the app in `QueryClientProvider` + tRPC `TRPCProvider`; httpBatchLink → `/trpc` with `credentials:'include'`.
- [ ] Set per-query `refetchInterval`: PnL/positions 3-5s, orders 5s, logs 15-30s, config on-demand.
- [ ] Use adaptive `refetchInterval` functions to slow/stop when idle and stop on error.
- [ ] Leave `refetchIntervalInBackground` default (off) so hidden tabs don't poll.
- [ ] Optimistic `useMutation` for config/slot toggles: `onMutate` cancel+snapshot+set, `onError` rollback, `onSettled` invalidate.
- [ ] Show a "pending / applied on next engine tick" state; confirm via the next poll, not instantly.
- [ ] Chart: `createChart` in a ref effect; `setData(history)` once; `update(point)` from newest polled bar; `chart.remove()` on unmount.
- [ ] Derive chart bars from query data in an effect; keep them out of React state to avoid re-render storms.
- [ ] TanStack Router `beforeLoad` auth guard; redirect to login when the session query is empty.
- [ ] Tailwind v4 via `@tailwindcss/vite` + `@import "tailwindcss";`; theme colors in `@theme`.
- [ ] A staleness/last-updated indicator (compare `dataUpdatedAt` to now) so users know polling is alive.

## Do / Don't
**Do**
- Match `refetchInterval` to real change-rate and the server's 10s engine cadence; poll slower for logs.
- Use the typed `queryOptions`/`mutationOptions` factories and `invalidateQueries` with tRPC query filters.
- Feed charts imperatively (`setData` once, then `update`); read query data via refs.
- Reconcile optimistic UI on `onSettled` by invalidating the affected tRPC query.
- Stop or back off polling on error and when panels are idle/hidden.

**Don't**
- Don't reach for a WebSocket — there is none; add polling, not a socket layer.
- Don't set 500ms-1s intervals on everything; it multiplies HTTP/DB load and the shared Bybit rate budget.
- Don't `setData()` the whole series on every poll — use `update()` for the latest bar.
- Don't store bar arrays / positions in React state and re-render the chart tree each tick.
- Don't imply an optimistic toggle changed the live position — the engine applies it on its next turn; show "pending".
- Don't fetch Bybit or hold API keys in the browser; always go through the tRPC API.

## Common pitfalls
- **Polling too hard:** aggressive `refetchInterval` across many panels saturates the single backend process and the exchange rate-limit budget; stagger and slow down.
- **`setData` per poll:** re-ingesting the full candle history each interval causes chart stutter and GC churn — `update()` the newest bar instead.
- **Chart in React state:** driving the canvas through `useState` re-renders the component tree on every poll; use refs + effects.
- **Optimistic without rollback:** `onMutate` mutating the cache but no `onError` snapshot restore leaves the UI lying after a failed mutation.
- **Instant-fill illusion:** treating an optimistic config change as an executed trade — the 10s engine hasn't acted yet; label it pending.
- **ms vs seconds on the chart:** Bybit/DB timestamps are milliseconds; Lightweight Charts wants UNIX **seconds** — divide by 1000 or bars land in 1970.
- **Background polling drain:** forgetting hidden tabs keep polling if `refetchIntervalInBackground` is on.

## Code patterns
```tsx
// polling live panels via typed tRPC hooks (no WebSocket)
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';

function LivePanels() {
  const trpc = useTRPC();

  const positions = useQuery(trpc.positions.list.queryOptions(undefined, {
    refetchInterval: 4_000,          // positions/PnL: a few seconds
  }));

  const orders = useQuery(trpc.orders.list.queryOptions(undefined, {
    // adaptive: fast while orders are open, slow when idle, stop on error
    refetchInterval: (q) =>
      q.state.status === 'error' ? false : (q.state.data?.length ? 3_000 : 15_000),
  }));

  const decisions = useQuery(trpc.logs.decisions.queryOptions(
    { limit: 50 }, { refetchInterval: 20_000 }, // audit log changes slowly
  ));

  return /* render tables; show positions.dataUpdatedAt as "last updated" */ null;
}
```

```tsx
// optimistic config toggle — engine applies it on its next 10s turn
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../trpc';

function useToggleBot(configId: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const key = trpc.configs.get.queryOptions({ configId }).queryKey;

  return useMutation(trpc.configs.update.mutationOptions({
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (o: any) => ({ ...o, enabled: vars.enabled, pending: true }));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx && qc.setQueryData(key, ctx.prev), // rollback
    onSettled: () => qc.invalidateQueries({ queryKey: key }),        // reconcile w/ server
  }));
}
```

```tsx
// Lightweight Charts v5: setData once, update() from polled data, no re-render storm
import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';

export function CandleChart({ symbol }: { symbol: string }) {
  const el = useRef<HTMLDivElement>(null);
  const series = useRef<ISeriesApi<'Candlestick'>>();
  const chart = useRef<IChartApi>();
  const trpc = useTRPC();

  const klines = useQuery(trpc.market.klines.queryOptions({ symbol }, { refetchInterval: 5_000 }));

  useEffect(() => {
    if (!el.current) return;
    chart.current = createChart(el.current, { autoSize: true });
    series.current = chart.current.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
    });
    return () => chart.current?.remove();          // cleanup: no leaked canvases
  }, []);

  useEffect(() => {
    const rows = klines.data;
    if (!rows?.length || !series.current) return;
    // ms -> seconds; setData once to backfill, update() the latest bar thereafter
    const bars = rows.map((r) => ({ time: r.start / 1000, open: +r.open, high: +r.high,
      low: +r.low, close: +r.close }));
    if (!series.current.data().length) series.current.setData(bars as any);
    else series.current.update(bars[bars.length - 1] as any);
  }, [klines.data]);

  return <div ref={el} style={{ height: 400 }} />;
}
```

## References
- [TanStack Query — Polling / refetchInterval](https://tanstack.com/query/latest/docs/framework/react/guides/polling) — timer-based refetch, background polling.
- [TanStack Query — useQuery reference](https://tanstack.com/query/v5/docs/framework/react/reference/useQuery) — `refetchInterval`, `refetchIntervalInBackground`, `dataUpdatedAt`.
- [TanStack Query — Optimistic updates](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates) — `onMutate`/`onError`/`onSettled`, cache snapshot & rollback.
- [TanStack Query — Important defaults](https://tanstack.com/query/v5/docs/framework/react/guides/important-defaults) — staleTime vs refetch behavior.
- [tRPC — TanStack React Query setup](https://trpc.io/docs/client/tanstack-react-query/setup) — `@trpc/tanstack-react-query`, `queryOptions`/`mutationOptions` factories.
- [@trpc/tanstack-react-query (npm)](https://www.npmjs.com/package/@trpc/tanstack-react-query) — the typed React Query integration package.
- [TanStack Router — Creating a router](https://tanstack.com/router/latest/docs/guide/creating-a-router) — `createRouter`, type registration.
- [TanStack Router — File-based routing](https://tanstack.com/router/latest/docs/routing/file-based-routing) — route tree, `__root`, dynamic params.
- [Tailwind CSS v4 — Vite install](https://tailwindcss.com/docs/installation/using-vite) — `@tailwindcss/vite`, `@import "tailwindcss";`.
- [Tailwind CSS v4.0 announcement](https://tailwindcss.com/blog/tailwindcss-v4) — CSS-first `@theme` config, no `tailwind.config.js`.
- [Lightweight Charts — Getting started](https://tradingview.github.io/lightweight-charts/docs) — `createChart`, `addSeries`, `setData`, `update`.
- [Lightweight Charts — React example](https://tradingview.github.io/lightweight-charts/tutorials/react/simple) — chart in a ref + effect, cleanup.
- [Lightweight Charts — v4 → v5 migration](https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5) — `addSeries(CandlestickSeries, …)` API.
- [Lightweight Charts — Series types](https://tradingview.github.io/lightweight-charts/docs/series-types) — candlestick/line/histogram config.
