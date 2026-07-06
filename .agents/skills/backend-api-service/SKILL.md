---
name: backend-api-service
description: Building the TypeScript backend for a multi-bot Bybit crypto trading platform on Bun — a Hono HTTP server exposing an end-to-end typed tRPC v11 API (Zod inputs), Better-Auth (Google + email) sessions in the tRPC context, protected/RBAC procedures, TRPCError handling + errorFormatter, serving the React panel, and reading/writing the same Drizzle/MySQL tables the engine uses — all inside ONE Bun process that also runs the 6 background loops (collector, v3 Bybit engine, optimizer, calendar/news scrapers). Invoke when the task mentions Hono, tRPC router/procedure, Bun server, Better-Auth, protectedProcedure, session context, Zod input, Drizzle query from the API, tRPC error handling, serving the SPA, or wiring the API to the engine's data via reconcile/decision-log tables.
---

# Backend API Service (Bun + Hono + tRPC v11)

## When to use this skill
- Scaffolding or extending the control-plane API: new tRPC routers, procedures, Zod input schemas.
- Adding auth: Better-Auth (Google OAuth + email/password) sessions, putting the user in tRPC context, `protectedProcedure` and role checks (RBAC).
- Exposing bot state (live PnL, positions, orders, `v3_decision_log`, `v3_position_event`) to the dashboard as typed tRPC queries the UI polls.
- Mounting the Hono server on Bun so it serves the built React SPA AND the tRPC API from a single process/container.
- Deciding how the API shares Drizzle/MySQL data with the 6 background loops without stepping on the engine's writes.
- Consistent error handling: `TRPCError` codes, `errorFormatter`, `onError` logging (no secrets).

## Core concepts
- **One process, many responsibilities.** On boot the Bun entrypoint runs `ensureSchema()` (idempotent `ALTER TABLE`, no migration files), then starts the 6 loops (collector, v3 Bybit engine @10s, optimizer @2h, calendar scraper @15m, news scraper @3m) **and** starts the Hono server. The API and the engine live in the same process and share the same Drizzle connection pool and MySQL tables — the API is a *reader/reconciler* of engine state, not a second writer of positions.
- **Hono is the HTTP shell.** Hono is a tiny, runtime-agnostic web framework (`new Hono()`, `app.get/post`, `c.req`, `c.json`) that runs natively on Bun via `Bun.serve` / `export default app`. It handles routing, middleware, CORS, static-file serving, and mounts the Better-Auth handler and the tRPC adapter.
- **tRPC v11 is the API layer.** Procedures are functions; the client imports only the `AppRouter` *type*, so calls are end-to-end typed with zero codegen. `t.procedure.input(zodSchema).query(...)` / `.mutation(...)`. Inputs are validated by Zod at the boundary — invalid input becomes a `BAD_REQUEST` before your resolver runs.
- **Context = per-request state.** `createContext({ req })` runs once per request (shared across a batched call) and returns `{ db, session, user }`. Better-Auth resolves the session from the request cookie/headers; the context carries it into every procedure and middleware.
- **Protected procedures = auth middleware.** A `protectedProcedure` is `publicProcedure.use(mw)` where the middleware throws `TRPCError({ code: 'UNAUTHORIZED' })` if `ctx.session` is null, and otherwise calls `next({ ctx: { user: ctx.user } })` so downstream resolvers get a **non-null** user type. Layer a second middleware for RBAC (role/ownership) → `FORBIDDEN`.
- **Errors are typed and shaped.** Throw `TRPCError` with a standard code (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`). Use `errorFormatter` to add fields (e.g. flatten Zod issues) to the client-visible shape; use `onError` only for logging/side-effects — and scrub secrets there.

## Codebase specifics (Bun / Hono / tRPC / Drizzle / Better-Auth)
- **Runtime & deploy:** Bun (not Node). Turborepo monorepo: the server app lives in `apps/`, shared pure logic and types in `packages/`. Push to `main` → Dokploy builds one Docker image and deploys one container. No migration files; schema is guaranteed by `ensure-schema.ts`.
- **Mounting order in Hono:** (1) CORS for the panel origin (credentials on, explicit origin — never `*` with credentials); (2) Better-Auth handler at `app.on(['GET','POST'], '/api/auth/*', c => auth.handler(c.req.raw))`; (3) tRPC at `/trpc/*` via the `@hono/trpc-server` middleware, passing `createContext`; (4) static serving of the built Vite SPA (`serveStatic`) with an SPA fallback to `index.html` last.
- **Data access:** all DB access goes through Drizzle (`drizzle-orm/mysql2` or Bun's driver). The API reads engine-owned tables (positions view, `v3_decision_log`, `v3_position_event`, user configs) and writes only *its own* domain (user config edits, enabling/disabling a bot slot, saving encrypted API keys). It must **not** place exchange orders directly — that is the engine's job; the API flips config/flags the engine reads on its next 10s turn.
- **Reconcile boundary:** the exchange is the source of truth; the DB is the ledger. When the panel shows "positions", prefer the reconciled DB rows the engine maintains rather than issuing your own signed Bybit call per page-load (rate-limit budget is shared). If you must hit Bybit live, see `exchange-integration-bybit` and reuse the signed-fetch helper.
- **Auth providers:** Better-Auth configured with the Google social provider and email/password; sessions via signed cookies (optionally cookie-cache to avoid a DB hit per request). Roles/ownership live on the user/config rows; enforce per-user isolation so user A can never read user B's configs, keys, or PnL.
- **Zod everywhere:** every mutation input (config edits, key upload, slot toggles) has a Zod schema; reuse those schemas in `packages/` so the UI and server validate identically.

## Implementation checklist
- [ ] Bun entrypoint: `ensureSchema()` → start 6 loops → `export default { fetch: app.fetch }` (or `Bun.serve`). Loops started with `void startLoop()`; never block the server boot.
- [ ] `initTRPC.context<Context>().create({ errorFormatter })`; export `router`, `publicProcedure`, `protectedProcedure`.
- [ ] `createContext`: read Better-Auth session from `req.headers`, attach `{ db, session, user }`.
- [ ] `protectedProcedure` middleware → `UNAUTHORIZED` when no session; RBAC/ownership middleware → `FORBIDDEN`.
- [ ] Feature routers (`bots`, `positions`, `orders`, `configs`, `keys`, `logs`) merged into one `appRouter`; `export type AppRouter = typeof appRouter`.
- [ ] Mount Better-Auth handler + `@hono/trpc-server` on Hono; add CORS with explicit panel origin + credentials.
- [ ] Serve the built SPA via `serveStatic` with `index.html` fallback for client routes.
- [ ] Zod input schema on every mutation; share schemas from `packages/`.
- [ ] `onError` logs `path`+`code` with a request id and **scrubbed** payload (never the API secret); map unexpected throws to `INTERNAL_SERVER_ERROR`.
- [ ] `/health` route (plain Hono) returning loop heartbeats/last-tick timestamps for Dokploy.
- [ ] Per-user isolation asserted in every resolver: filter by `ctx.user.id`; never trust an id from input alone.

## Do / Don't
**Do**
- Keep decision math as pure, tested functions in `packages/`; keep DB/exchange side-effects in the engine and thin resolvers.
- Validate every input with Zod; reuse the same schema client and server.
- Resolve the session once in `createContext` and read it from `ctx` everywhere.
- Return purpose-built DTOs; strip secrets and internal columns before sending to the client.
- Let the engine own order placement; the API only edits config/flags it reads next tick.

**Don't**
- Don't block the event loop with long/sync work in a resolver — Bun is single-process here; a stalled handler stalls the loops too. Offload to the periodic loops, not to the request.
- Don't place Bybit orders or run heavy scans inside a tRPC request; that's the engine's job and burns the shared rate-limit budget.
- Don't return raw user/config rows containing encrypted key material or another user's data.
- Don't use `onError` to reshape client errors (use `errorFormatter`); don't log secrets in either.
- Don't set CORS `allow_origins:'*'` together with credentials.

## Common pitfalls
- **Session not in context:** forgetting to pass `req` (headers) into Better-Auth's `getSession` → every `protectedProcedure` 401s. Resolve it in `createContext`, not per-procedure.
- **Batching + context:** `createContext` runs once per HTTP request even when tRPC batches many calls — don't assume one context per procedure.
- **Zod flat errors lost:** without an `errorFormatter` that flattens `error.cause` (ZodError), the client sees a generic message instead of field errors.
- **Double source of truth:** the API issuing its own Bybit position reads that disagree with the engine's reconciled rows — pick the ledger for display, reconcile in the engine.
- **Leaking cross-tenant data:** trusting a `userId`/`configId` from procedure input instead of `ctx.user.id` — always scope queries to the session user.
- **Static fallback shadowing the API:** registering the SPA catch-all before `/trpc` or `/api/auth` so API routes 404 into `index.html` — mount static last.

## Code patterns
```ts
// trpc.ts — init, context, protected procedure (tRPC v11)
import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { auth } from './auth';          // Better-Auth instance
import { db } from './db';              // Drizzle client

export async function createContext({ req }: { req: Request }) {
  const session = await auth.api.getSession({ headers: req.headers });
  return { db, session, user: session?.user ?? null };
}
type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zod: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session || !ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.user } }); // user is now non-null downstream
});
```

```ts
// routers/positions.ts — typed, per-user, reads the engine's ledger
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc';
import { v3Positions, v3DecisionLog } from '../schema';

export const positionsRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.select().from(v3Positions).where(eq(v3Positions.userId, ctx.user.id)),
  ),
  decisions: protectedProcedure
    .input(z.object({ symbol: z.string().optional(), limit: z.number().max(200).default(50) }))
    .query(({ ctx, input }) =>
      ctx.db.select().from(v3DecisionLog)
        .where(and(
          eq(v3DecisionLog.userId, ctx.user.id),
          input.symbol ? eq(v3DecisionLog.symbol, input.symbol) : undefined,
        ))
        .orderBy(desc(v3DecisionLog.createdAt))
        .limit(input.limit),
    ),
});
```

```ts
// server.ts — Hono on Bun: auth + tRPC + SPA in one process
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { trpcServer } from '@hono/trpc-server';
import { auth } from './auth';
import { appRouter } from './routers';
import { createContext } from './trpc';
import { ensureSchema } from './ensure-schema';
import { startLoops } from './loops';

await ensureSchema();      // idempotent ALTER TABLE, no migration files
startLoops();              // collector, v3 Bybit engine, optimizer, scrapers

const app = new Hono();
app.use('/trpc/*', cors({ origin: process.env.PANEL_ORIGIN!, credentials: true }));
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
app.use('/trpc/*', trpcServer({
  router: appRouter,
  createContext: (_opts, c) => createContext({ req: c.req.raw }),
}));
app.get('/health', (c) => c.json({ ok: true }));
app.use('*', serveStatic({ root: './web/dist' }));           // built React SPA
app.get('*', serveStatic({ path: './web/dist/index.html' })); // SPA fallback (last)

export default app; // Bun serves app.fetch
```

## References
- [Hono documentation](https://hono.dev/docs/) — runtime-agnostic web framework; routing, middleware, Bun adapter.
- [Hono — RPC / tRPC & third-party middleware](https://hono.dev/docs/guides/rpc) — mounting APIs and the `@hono/trpc-server` adapter on Hono.
- [Hono — Better Auth integration](https://hono.dev/examples/better-auth) — mounting `auth.handler` and session middleware on Hono.
- [tRPC — Define procedures](https://trpc.io/docs/server/procedures) — queries/mutations, `publicProcedure`, composition.
- [tRPC — Context](https://trpc.io/docs/server/context) — per-request context, `createContext`, batching behavior.
- [tRPC — Middlewares](https://trpc.io/docs/server/middlewares) — `protectedProcedure` / auth middleware pattern with `next()`.
- [tRPC — Input & output validators](https://trpc.io/docs/server/validators) — Zod input validation on procedures.
- [tRPC — Error handling](https://trpc.io/docs/server/error-handling) — `TRPCError`, error codes, `onError`.
- [tRPC — Error formatting](https://trpc.io/docs/server/error-formatting) — `errorFormatter`, flattening Zod errors into the client shape.
- [Better Auth — Hono integration](https://better-auth.com/docs/integrations/hono) — mounting the handler, session in context.
- [Better Auth — Session management](https://better-auth.com/docs/concepts/session-management) — `auth.api.getSession`, cookie caching.
- [Drizzle ORM — MySQL](https://orm.drizzle.team/docs/get-started/mysql-new) — connection, `mysqlTable`, typed queries.
- [Drizzle ORM — Schema declaration](https://orm.drizzle.team/docs/sql-schema-declaration) — defining tables/columns used by API and engine.
- [Bun — HTTP server](https://bun.com/docs/api/http) — `Bun.serve` / `export default { fetch }` used to serve Hono.
- [Better-T-Stack (reference monorepo)](https://github.com/AmanVarshney01/Better-T-Stack) — Hono + tRPC + Better-Auth + Drizzle + TanStack on Bun, same stack.
