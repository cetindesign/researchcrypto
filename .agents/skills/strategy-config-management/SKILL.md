---
name: strategy-config-management
description: Manage per-user and per-bot trading configuration in this Bun + TypeScript multi-bot Bybit platform — config rows stored in MySQL via Drizzle ORM, edited end-to-end through tRPC v11 mutations validated with Zod, and surfaced in the React 19 panel. Covers the Drizzle config schema, Zod input validation on mutations, keeping Bybit API keys AES-256-GCM encrypted in a separate table from plain config, the testnet/mainnet toggle, validating params before a bot goes live, and safe reload where the 10s engine loop re-reads active configs each tick. Invoke when the user mentions bot config, strategy params, per-user settings, config schema, tRPC mutation, Zod validation, encrypted API keys, testnet vs mainnet, validate-before-live, leverage/risk limits per bot, active configs, or hot config reload. Not pydantic/YAML/TOML — config lives in the DB.
---

# Strategy & Config Management

## When to use this skill
- Designing or extending the Drizzle config schema for a bot/strategy (symbols, leverage, TP/SL, layering thresholds, guards).
- Adding a tRPC v11 mutation that validates config with Zod before writing it to MySQL.
- Separating **secrets** (Bybit key/secret, AES-256-GCM encrypted) from **plain config** so keys never sit in a readable column.
- Wiring the testnet/mainnet toggle so a "test" bot can never resolve to the mainnet base URL.
- Writing a `validateForLive()` gate that runs before a bot is allowed to place a MARKET order.
- Making config edits take effect safely while the 10s engine loop is running (each tick re-reads active configs).

## Core concepts
- **Config vs secrets.** Config = behavioral parameters (leverage, risk %, TP/SL, guard toggles) — plain columns, safe to render in the panel and log. Secrets = Bybit `apiKey`/`apiSecret` — encrypted at rest, decrypted only at the signing boundary. Store them in **separate tables** with different access paths.
- **DB is the config store.** There is no `.env`/YAML/TOML per bot. A config is a row keyed by `(userId, botId)`; the engine reads active rows every tick. Editing config = a tRPC mutation → `UPDATE`.
- **Schema-first validation.** Every field is a typed Drizzle column and a Zod field with bounds. Zod validates at the tRPC boundary (`.input()`), so an invalid config is rejected before it ever touches the DB.
- **Active flag, not process restart.** A bot is enabled/paused by an `active` boolean column. The single backend process (one container) keeps running; the loop simply includes or skips the row.
- **Validate-before-live.** Static Zod bounds are not enough — a final gate checks live exchange facts (instrument tick/qty filters, leverage cap, testnet↔account match) before the first real order.
- **Reloadable vs immutable-while-open.** Some fields (e.g. `takeProfitPct`) can change live; some (e.g. `symbol`, `leverage`, `category`) must not change while a position is open. Classify every field and reject unsafe live edits.

## Codebase specifics (Bun / tRPC / Drizzle / Bybit)
- **tRPC v11 mutation** is the only write path. Input is a Zod object; the resolver runs inside a Better-Auth session so `ctx.user.id` scopes the row — a user can only edit their own config.
- **Drizzle schema** lives in the shared package; the config table uses `decimal`/`varchar`/`boolean`/`json` columns, never `float` for money (see `mysql-drizzle-data-layer`). No migration files — new columns land via the idempotent `ensure-schema.ts` ALTER guards on boot.
- **Secrets table** holds `iv`, `authTag`, `ciphertext` (all hex/base64 `varchar`), never the plaintext key. Encrypt with Node/Bun `crypto` `aes-256-gcm`; the 32-byte master key comes from a container env var, not the DB.
- **Testnet/mainnet** is a `boolean testnet` column that maps to the base URL (`api-testnet.bybit.com` vs `api.bybit.com`). Resolve the URL from this flag in one place so a testnet config can never sign against mainnet.
- **Engine reload:** the v3 Bybit engine loop (every 10s) starts each tick by `SELECT`ing active configs. There is no in-memory cache to invalidate — a committed mutation is picked up on the next tick. Keep per-tick config reads cheap (indexed, small rows).
- **Guards & layering params** (news/calendar/BTC-shock/cooldown thresholds, katman add levels) are plain config fields the engine reads per tick; validate their ranges in Zod.

## Implementation checklist
- [ ] Define the Drizzle config table keyed by `(userId, botId)` with typed columns and an `active` boolean; decimals for prices/percentages.
- [ ] Define a Zod schema mirroring the columns with bounds (`z.number().min().max()`, enums for `category`, `.refine()` for cross-field rules like `slPct < tpPct`).
- [ ] Expose a tRPC `config.upsert` mutation: `.input(configSchema)` → auth check `ctx.user.id` → Drizzle `insert().onDuplicateKeyUpdate()`.
- [ ] Keep secrets in a separate table; encrypt with `aes-256-gcm`, store `iv + authTag + ciphertext`; never return plaintext from any query/procedure.
- [ ] Add a `testnet` boolean and resolve the Bybit base URL from it in a single helper.
- [ ] Write `validateForLive(cfg, instrumentInfo)` that checks tick/qty filters, leverage cap, and testnet↔account before flipping `active = true`.
- [ ] Mark each field reloadable vs immutable-while-open; reject immutable edits when the bot has an open position.

## Do / Don't
- **Do** validate with Zod at the tRPC boundary so bad input never reaches Drizzle.
- **Do** keep Bybit keys in a separate encrypted table and decrypt only when signing a request.
- **Do** derive the base URL from the `testnet` flag in exactly one place.
- **Don't** store API secrets in the plain config table or return them from any procedure.
- **Don't** use `float`/`double` for leverage, sizes, or percentages — use `decimal` columns and validate as numbers/strings.
- **Don't** mutate `symbol`/`leverage`/`category` while a position is open.
- **Don't** add YAML/TOML/pydantic/`.env`-per-bot config — config is DB rows.

## Common pitfalls
- **Trusting the client.** The React panel is untrusted; the Zod `.input()` on the mutation is the real validation gate.
- **Leaking secrets in logs.** Decrypted keys must never be logged or serialized into a tRPC response. Redact.
- **Testnet drift.** A config marked testnet whose key is a mainnet key — `validateForLive` should confirm the key works against the testnet base URL.
- **Stale reload assumptions.** Because the loop re-reads each tick, a half-written multi-row edit can be read mid-update; write config atomically (single-row upsert / transaction).
- **Float percentages.** `0.1 + 0.2 !== 0.3` — keep money/percentage math in decimal strings.

## Code patterns

```ts
// packages/db/schema.ts — plain config + separate encrypted secrets
import { mysqlTable, varchar, boolean, decimal, json, index } from "drizzle-orm/mysql-core";

export const botConfig = mysqlTable("v3_bot_config", {
  userId:    varchar("user_id", { length: 64 }).notNull(),
  botId:     varchar("bot_id", { length: 64 }).notNull(),
  symbol:    varchar("symbol", { length: 32 }).notNull(),
  category:  varchar("category", { length: 12 }).notNull(), // linear | inverse | spot
  leverage:  decimal("leverage", { precision: 6, scale: 2 }).notNull(),
  riskPct:   decimal("risk_pct", { precision: 6, scale: 4 }).notNull(),
  tpPct:     decimal("tp_pct", { precision: 6, scale: 4 }).notNull(),
  slPct:     decimal("sl_pct", { precision: 6, scale: 4 }).notNull(),
  guards:    json("guards").$type<{ news: boolean; calendar: boolean; btcShock: boolean; cooldownSec: number }>().notNull(),
  testnet:   boolean("testnet").notNull().default(true),
  active:    boolean("active").notNull().default(false),
}, (t) => [ index("user_bot_idx").on(t.userId, t.botId) ]);

export const botSecret = mysqlTable("v3_bot_secret", {
  userId:     varchar("user_id", { length: 64 }).notNull(),
  botId:      varchar("bot_id", { length: 64 }).notNull(),
  iv:         varchar("iv", { length: 32 }).notNull(),          // hex
  authTag:    varchar("auth_tag", { length: 32 }).notNull(),    // hex
  ciphertext: varchar("ciphertext", { length: 512 }).notNull(), // hex
});
```

```ts
// Zod schema shared by the mutation and the React form
import { z } from "zod";

export const configSchema = z.object({
  botId:    z.string().min(1),
  symbol:   z.string().regex(/^[A-Z0-9]+$/),
  category: z.enum(["linear", "inverse", "spot"]),
  leverage: z.number().positive().max(100),
  riskPct:  z.number().gt(0).max(0.1),
  tpPct:    z.number().gt(0).max(1),
  slPct:    z.number().gt(0).max(1),
  guards:   z.object({ news: z.boolean(), calendar: z.boolean(), btcShock: z.boolean(), cooldownSec: z.number().int().min(0) }),
  testnet:  z.boolean(),
}).refine((c) => c.slPct < c.tpPct, { message: "slPct must be < tpPct", path: ["slPct"] });
```

```ts
// tRPC v11 mutation — Zod validates before Drizzle writes; auth scopes the row
export const configRouter = router({
  upsert: protectedProcedure.input(configSchema).mutation(async ({ ctx, input }) => {
    const row = { ...input, userId: ctx.user.id,
      leverage: String(input.leverage), riskPct: String(input.riskPct),
      tpPct: String(input.tpPct), slPct: String(input.slPct) };
    await ctx.db.insert(botConfig).values(row)
      .onDuplicateKeyUpdate({ set: row });      // idempotent upsert
    return { ok: true };
  }),
});
```

```ts
// AES-256-GCM encryption for Bybit keys (Bun/Node crypto)
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
const KEY = Buffer.from(process.env.SECRET_MASTER_KEY!, "hex"); // 32 bytes

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { iv: iv.toString("hex"), authTag: c.getAuthTag().toString("hex"), ciphertext: ct.toString("hex") };
}
export function open(s: { iv: string; authTag: string; ciphertext: string }) {
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(s.iv, "hex"));
  d.setAuthTag(Buffer.from(s.authTag, "hex"));            // throws if tampered
  return Buffer.concat([d.update(Buffer.from(s.ciphertext, "hex")), d.final()]).toString("utf8");
}
```

```ts
// Base URL resolved from testnet flag in ONE place; validate-before-live gate
export const bybitBase = (testnet: boolean) =>
  testnet ? "https://api-testnet.bybit.com" : "https://api.bybit.com";

export function validateForLive(cfg: BotConfig, info: InstrumentInfo) {
  if (Number(cfg.leverage) > info.leverageFilter.maxLeverage) throw new Error("leverage over cap");
  // round tpPct/slPct to info.priceFilter.tickSize; confirm minOrderQty/qtyStep from lotSizeFilter
  // confirm the stored key authenticates against bybitBase(cfg.testnet) before setting active=true
}
```

## References
- [tRPC — Input & Output Validators](https://trpc.io/docs/server/validators) — `.input()` with a Zod parser on procedures.
- [tRPC — Define Procedures](https://trpc.io/docs/server/procedures) — queries vs mutations, protected procedures.
- [Zod — Basic usage](https://zod.dev/basics) — `safeParse`, discriminated result, error handling.
- [Zod — Defining schemas](https://zod.dev/api) — objects, enums, numbers, `.refine()` cross-field rules.
- [Drizzle ORM — MySQL column types](https://orm.drizzle.team/docs/column-types/mysql) — `decimal`, `varchar`, `boolean`, `json`.
- [Drizzle ORM — Insert / upsert](https://orm.drizzle.team/docs/insert) — `insert().onDuplicateKeyUpdate()`.
- [Drizzle ORM — Upsert guide](https://orm.drizzle.team/docs/guides/upsert) — idempotent MySQL upsert patterns.
- [Node.js crypto](https://nodejs.org/api/crypto.html) — `createCipheriv`/`getAuthTag`/`setAuthTag` for AES-256-GCM.
- [Bun — Node crypto `createCipheriv`](https://bun.com/reference/node/crypto/createCipheriv) — same API under Bun.
- [Better Auth — Session management](https://better-auth.com/docs/concepts/session-management) — server-side `getSession` to scope config by user.
- [Bybit V5 — Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) — testnet vs mainnet base URLs, recv_window.
- [Bybit V5 — Get Position Info](https://bybit-exchange.github.io/docs/v5/position) — instrument/leverage facts for validate-before-live.
