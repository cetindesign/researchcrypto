---
name: monorepo-turborepo
description: Working inside the platform's Turborepo + Bun-workspaces monorepo. `apps/` holds runnable things (the Bun/Hono server that also runs the 6 background loops, plus Vite/React web UIs); `packages/` holds shared TS libraries — the pure-core decision packages, the Drizzle schema, shared Zod types, and the tRPC router type surface. Invoke when adding a new package or app, deciding whether code belongs in an app or a package, wiring a workspace dependency (`workspace:*`, `@repo/*`), editing `turbo.json` tasks/caching/`dependsOn`/`outputs`, sharing types across frontend and backend (tRPC `AppRouter`, Drizzle `$inferSelect`), running `bun`/`turbo` build/dev/test tasks, fixing a circular dependency, or when the task mentions "monorepo", "turborepo", "bun workspaces", "internal package", "shared types", "turbo cache", or "where does this code go".
---

# Monorepo (Turborepo + Bun Workspaces)

## When to use this skill
- Creating a new `apps/*` (server or web UI) or a new `packages/*` (shared library).
- Deciding whether a piece of code belongs in an app or a package.
- Wiring one workspace to depend on another (`"@repo/x": "workspace:*"`).
- Editing `turbo.json`: adding a task, `dependsOn`, `outputs`, `inputs`, or cache settings.
- Sharing types end-to-end: tRPC `AppRouter` types, Drizzle row types, shared Zod schemas.
- Running or debugging `bun`/`turbo` `build` / `dev` / `test` tasks and cache misses.
- Diagnosing a circular dependency or a package that imports "up" into an app.

## Core concepts
- **Two-folder layout:** `apps/` = deployable/runnable units (the Bun+Hono backend, each Vite+React panel). `packages/` = everything shared: pure-core decision packages, Drizzle schema, shared types, config. Rule of thumb from Turborepo: apps are consumers, packages are producers — dependencies point **from apps into packages**, never the reverse.
- **Bun workspaces:** the root `package.json` lists `"workspaces": ["apps/*", "packages/*"]`. Each workspace has its own `package.json`. Cross-package references use the **workspace protocol** `"@repo/decision": "workspace:*"`; `bun install` links them locally and de-dupes shared deps.
- **Turborepo = the task runner/cache on top of Bun:** `turbo.json` declares each task (`build`, `dev`, `test`, `lint`, `typecheck`), what it depends on (`dependsOn`), what it reads (`inputs`), and what it writes (`outputs`). Turbo hashes inputs and **replays cached output** when nothing changed, and runs independent packages in parallel.
- **Internal packages, mostly just-in-time:** because Bun natively understands TypeScript, most shared packages are consumed as raw `.ts` (just-in-time) — the app's bundler/Bun transpiles them, no build step. Publishable/compiled packages use `tsc` and cache their `dist/**` via `outputs`.
- **Types are the shared contract:** the frontend imports the backend's tRPC `AppRouter` **type** and the Drizzle schema's inferred row types. No codegen, no duplicated interfaces — TypeScript is the single source of truth across the wire.

## Codebase specifics (this platform)
- **`apps/server` (Bun + Hono):** one process. Serves the tRPC/HTTP API for the panel AND on boot starts the 6 background loops (ensureSchema → collector → v3 Bybit engine every ~10s → optimizer every 2h → calendar scraper every 15m → news scraper every 3m). It is a **shell**: it imports pure decision logic from packages and does the Bybit signed REST / Drizzle / Telegram I/O itself.
- **`apps/web*` (Vite + React 19 + TanStack Router/Query + Tailwind v4):** the panel(s). Import only *types* from the server (the tRPC client is typed by `AppRouter`) and shared UI/util packages.
- **`packages/` you will touch:**
  - the **pure-core decision package(s)** — TP/SL/trailing, layering, guards, sizing (see `pure-core-dirty-shell`). Pure, TDD'd, no I/O.
  - the **Drizzle schema + db** package — table definitions, `ensure-schema.ts`, inferred row types (see `mysql-drizzle-data-layer`).
  - **shared types / Zod schemas** — tRPC input validators and DTOs used by both server and web.
- **Deploy is single-container (Dokploy):** push to `main` → Docker build → deploy. The Docker build runs `turbo build` (server + web) so Turbo caching directly shortens deploy time. No DB migration files — schema is guaranteed by the idempotent `ensure-schema.ts` at boot.
- **Bun test everywhere:** `turbo test` fans out `bun test` across packages; the pure-core packages carry the bulk of the fast unit tests.

## Implementation checklist
- [ ] New shared logic/types/schema → `packages/*`. New runnable server/UI → `apps/*`.
- [ ] Give the package a scoped name (`@repo/<name>`); export a clean `index.ts` barrel.
- [ ] Add the dependency with the workspace protocol: `"@repo/<name>": "workspace:*"`, then `bun install`.
- [ ] Register tasks in `turbo.json` with correct `dependsOn` (`"^build"`), `outputs` (`dist/**`), and `inputs`.
- [ ] For end-to-end types: export `type AppRouter = typeof appRouter` from the server; import it as a **type-only** import in the web app's tRPC client.
- [ ] For DB types: derive from Drizzle (`typeof table.$inferSelect` / `$inferInsert`) instead of hand-writing interfaces.
- [ ] Keep dependency direction app → package; if a package needs something from an app, that something belongs in a package.
- [ ] Run `turbo typecheck build test` before pushing; verify no cache-busting `outputs` are missing.

## Do / Don't
- **Do** put decision math, schema, and shared types in `packages/` so both server and web (and both engines' tests) reuse one copy.
- **Do** use `workspace:*` for internal deps and `@repo/*` scoped names.
- **Do** set `outputs` in `turbo.json` for any task that writes files, or the cache restores nothing.
- **Do** import cross-boundary types with `import type` so nothing runtime leaks frontend↔backend.
- **Don't** let a `packages/*` import from `apps/*` — that inverts the dependency and creates cycles.
- **Don't** duplicate the Drizzle row shape or tRPC I/O types by hand — infer them.
- **Don't** run tasks with bare `bun --filter` when a `turbo` pipeline exists; you lose caching and ordering.
- **Don't** add Bybit REST / Drizzle / Telegram code into a shared pure package — that belongs in `apps/server`.

## Common pitfalls
- **Missing `outputs`:** `turbo build` "succeeds" but never restores cached `dist/` — every build is cold. Match real output dirs (`dist/**`, `.vite/**`).
- **Circular workspace deps:** `@repo/a` ↔ `@repo/b`. Break by extracting the shared bit into a third leaf package (e.g. `@repo/types`) that both depend on.
- **App-into-package leak:** importing the Bybit client or `db` into a pure package pulls I/O into the core and creates a cycle — inject it or move the caller to the shell.
- **Runtime value crossing the wire type boundary:** importing a server *value* (not just its type) into the web app bundles server code (and secrets) into the browser. Use `import type`.
- **Stale cache after env change:** a task whose behavior depends on an env var must list it in `env`/`inputs`, or Turbo replays a wrong cached result.
- **Wrong task order:** forgetting `dependsOn: ["^build"]` builds an app before its packages are built.

## Code patterns (TypeScript / Bun / Turborepo)

**Root `package.json` — Bun workspaces:**
```json
{
  "name": "researchcrypto",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "packageManager": "bun@1.1.0",
  "devDependencies": { "turbo": "^2.0.0" }
}
```

**`turbo.json` — pipeline, caching, ordering:**
```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".vite/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"], "outputs": [] },
    "lint": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```
`^build` = "build this package's dependencies first". `dev` is `persistent` (long-running) and never cached.

**A shared package — `packages/decision/package.json` (just-in-time TS, no build):**
```json
{
  "name": "@repo/decision",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "bun test", "typecheck": "tsc --noEmit" }
}
```

**Consuming it from an app — `apps/server/package.json`:**
```json
{
  "name": "@repo/server",
  "type": "module",
  "dependencies": { "@repo/decision": "workspace:*", "@repo/db": "workspace:*", "hono": "^4" }
}
```

**End-to-end tRPC types across the boundary:**
```ts
// apps/server/src/trpc/router.ts  (backend defines the contract)
export const appRouter = router({ /* ...procedures... */ });
export type AppRouter = typeof appRouter;   // export the TYPE only
```
```ts
// apps/web/src/trpc.ts  (frontend consumes it — type-only import, zero runtime)
import type { AppRouter } from "@repo/server/trpc/router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
export const trpc = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: "/trpc" })] });
```

**Shared DB types inferred from Drizzle (no hand-written interfaces):**
```ts
// packages/db/src/schema.ts
export const v3PositionEvent = mysqlTable("v3_position_event", { /* ...columns... */ });
export type PositionEvent = typeof v3PositionEvent.$inferSelect;   // reused by server + web
export type NewPositionEvent = typeof v3PositionEvent.$inferInsert;
```

**Running tasks:**
```bash
turbo build                 # build every workspace, respecting dependsOn + cache
turbo dev --filter=@repo/web # run one app's dev server
turbo test --filter=@repo/decision  # fast pure-core unit tests via bun test
turbo typecheck build test  # what CI / the Dokploy Docker build runs before deploy
```

## References
- [Turborepo — Structuring a repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) — the `apps/` vs `packages/` convention.
- [Turborepo — Configuring tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks) — `tasks`, `dependsOn`, `^build` topological ordering.
- [Turborepo — Configuration reference (turbo.json)](https://turborepo.dev/docs/reference/configuration) — `outputs`, `inputs`, `env`, `cache`, `persistent`.
- [Turborepo — Internal Packages](https://turborepo.dev/docs/core-concepts/internal-packages) — just-in-time vs compiled internal packages, `workspace:*`.
- [Turborepo — Creating an Internal Package](https://turborepo.dev/docs/crafting-your-repository/creating-an-internal-package) — scaffolding a shared `packages/*`.
- [Turborepo — Managing dependencies](https://turborepo.dev/docs/crafting-your-repository/managing-dependencies) — workspace dependency direction and installation.
- [Turborepo — TypeScript guide](https://turborepo.dev/docs/guides/tools/typescript) — sharing tsconfig and types across the monorepo.
- [Bun — Workspaces](https://bun.com/docs/pm/workspaces) — root `workspaces` glob, `workspace:*` protocol, `--filter`, de-duplication.
- [Bun — Test runner](https://bun.com/docs/test) — `bun test` used by the `test` task across packages.
- [tRPC — Docs](https://trpc.io/docs/) — end-to-end type inference; sharing `AppRouter` type with the client, no codegen.
- [Drizzle ORM — Schema declaration](https://orm.drizzle.team/docs/sql-schema-declaration) — `$inferSelect` / `$inferInsert` row types shared across app and web.
