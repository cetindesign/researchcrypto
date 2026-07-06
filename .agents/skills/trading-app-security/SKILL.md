---
name: trading-app-security
description: Application-level security for a multi-bot Bybit crypto trading platform built on Bun + Hono + tRPC + Drizzle/MySQL + React. Covers Better-Auth (Google + email) auth, optional TOTP 2FA and step-up re-auth, session/cookie security (HttpOnly/Secure/SameSite, signed cookies, revocation), the OWASP Top 10 and OWASP API Security Top 10 for fintech, RBAC/BOLA ownership checks, Zod input validation on every tRPC procedure, immutable audit logging via v3_decision_log / v3_position_event, idempotency & replay protection with Bybit orderLinkId and recv_window, AES-256-GCM secret storage of exchange API keys, HMAC-SHA256 request signing, protecting the kill-switch / admin / withdrawal-affecting procedures, and supply-chain hygiene (bun audit, frozen lockfile). Invoke when the task mentions login, Better-Auth, 2FA/MFA/TOTP, session, cookie, CSRF, RBAC, BOLA/IDOR, audit log, idempotency, replay, orderLinkId, kill-switch, admin procedure, withdrawal, secrets, API key storage, AES-GCM, Zod validation, rate limiting, OWASP, threat model, or "is this tRPC procedure safe".
---

# Trading Application Security

## When to use this skill
- Building or reviewing auth: Better-Auth login (Google + email), TOTP 2FA enrollment, session/cookie config, step-up re-auth.
- Adding or hardening funds-affecting tRPC procedures: place/close order, change TP/SL/leverage, edit a user config, start/stop a bot, toggle the kill-switch, anything withdrawal-adjacent.
- Designing the audit trail (`v3_decision_log` / `v3_position_event`), idempotency, replay protection, or rate limiting.
- Threat-modeling the platform or mapping controls to OWASP Top 10 / OWASP API Security Top 10 / ASVS.
- Handling secrets: Bybit API key/secret (AES-256-GCM in MySQL), Better-Auth secret, DB creds, Telegram/Gemini tokens.
- Reviewing dependencies / CI for supply-chain risk (`bun audit`, frozen `bun.lock`, minimum package age).

## Core concepts
A crypto trading platform is a **fintech application whose bugs move real money**. Every funds-affecting action must be authenticated, authorized, validated, audited, idempotent, and rate-limited.

- **AuthN vs AuthZ**: authentication proves *who* you are (Better-Auth session, 2FA); authorization proves *what you may do* (RBAC + per-object ownership).
- **BOLA / IDOR** (Broken Object-Level Authorization) is the #1 API risk: a tRPC procedure that takes a `configId`/`positionId` and returns/mutates another user's row because it never checks `ownerId === ctx.user.id`. Every procedure taking an object id must verify ownership server-side.
- **Step-up auth / re-authentication**: force a fresh credential (password + fresh TOTP) immediately before a high-risk action (disabling the kill-switch, editing keys, anything withdrawal-affecting), independent of the existing session.
- **Idempotency key**: a client-generated unique id that lets a request be safely retried without duplicating the effect. On Bybit this is **`orderLinkId`** — no double-fills after a REST timeout.
- **Replay attack**: a valid captured request re-sent to repeat its effect; defeated by idempotency keys, signed+timestamped Bybit requests inside `recv_window`, and short session lifetimes.
- **Audit log**: an append-only record of *who did what, when, and the before/after value*. Here it already exists as `v3_decision_log` (every engine decision) and `v3_position_event` (every position lifecycle event) — extend the same pattern to user/admin actions.
- **Kill-switch**: a privileged control that flattens positions / halts the engine loop. It is the single most attractive target and must sit behind its own RBAC role + step-up auth + alert-on-toggle.

## Codebase specifics (Bun / Hono / tRPC / Better-Auth / Bybit)
- **Better-Auth** provides Google OAuth + email/password. Cookies are signed with `BETTER_AUTH_SECRET`; in production they are `HttpOnly` and `Secure` with `sameSite: "lax"` by default. Sessions are stored in the DB (revocable) and expire after 7 days with a rolling `updateAge`. Set `trustedOrigins` so cross-origin requests are rejected (built-in CSRF defense). Do not weaken these defaults for convenience.
- **2FA**: add Better-Auth's two-factor plugin (TOTP + backup codes). It stores an extra user field + table; the TOTP secret is managed by the plugin. Make 2FA mandatory for any account that can trade or touch keys, and require it again as **step-up** on the kill-switch and key-edit procedures. A shared failure counter locks the account after repeated bad codes.
- **tRPC procedures are the trust boundary.** Build tiered procedures: `publicProcedure` → `protectedProcedure` (valid session) → `adminProcedure` (RBAC role) → `stepUpProcedure` (fresh TOTP within N minutes). Put auth/ownership/rate-limit in middleware so it cannot be forgotten per-route.
- **Zod validates every input.** tRPC uses the Zod schema as the runtime + type contract. Use `.strict()` to reject unknown fields; constrain enums (`side: z.enum(["Buy","Sell"])`), positive quantities, and a symbol allowlist. Never trust a client-supplied `userId`/`configId` — derive the actor from `ctx.session`.
- **Bybit API keys** live **AES-256-GCM encrypted in MySQL** (via `crypto.createCipheriv("aes-256-gcm", ...)`), decrypted only in the engine at signing time. Create keys with **least privilege**: no Withdraw permission, IP-allowlisted, read+trade only. Never log the secret; never return it after creation.
- **Bybit request signing & replay defense**: sign V5 requests with **HMAC-SHA256** over `timestamp + apiKey + recvWindow + payload`; send `X-BAPI-*` headers with a small `recvWindow` (~5000 ms) and an NTP-synced clock so Bybit rejects stale/replayed requests.
- **Order idempotency**: pass a unique **`orderLinkId`** (<=36 chars) on every create-order so a retry after a polling timeout dedupes instead of opening a second position; you can also query the order back by `orderLinkId` during reconcile.
- **Rate limiting**: the engine is polling REST — respect Bybit's own limits (read `X-Bapi-Limit-Status`). Separately, rate-limit auth and mutation procedures per-user/IP in Hono/tRPC middleware to blunt credential stuffing and enumeration.
- **Supply chain**: commit `bun.lock`; CI runs `bun install --frozen-lockfile` then `bun audit --audit-level=high` (fails on GHSA advisories). Bun blocks lifecycle scripts by default (`trustedDependencies` allowlist) and supports a minimum-age filter to dodge freshly-published malicious versions.

## Implementation checklist
- [ ] Enforce TLS everywhere; keep Better-Auth cookies `HttpOnly; Secure; SameSite=Lax`; set `trustedOrigins`.
- [ ] Passwords via Better-Auth's hashing (scrypt/argon2-class); never roll your own fast hash.
- [ ] TOTP 2FA mandatory for trade/key-capable accounts; backup codes; account lock after repeated failures.
- [ ] DB-backed, revocable sessions; revoke on logout, password change, and suspected compromise.
- [ ] Ownership/RBAC check in `protectedProcedure`/`adminProcedure` middleware on *every* procedure taking an object id (defeat BOLA/IDOR).
- [ ] Step-up re-auth (fresh TOTP) on: kill-switch disable, API-key create/edit, and any withdrawal-affecting action.
- [ ] Zod `.strict()` input schema on every procedure; enum/side/qty bounds and symbol allowlist.
- [ ] Unique `orderLinkId` on every Bybit create-order; small `recvWindow`; NTP-synced clock; store link id for reconcile/dedupe.
- [ ] Append-only audit: extend `v3_decision_log` / `v3_position_event` and add user/admin action events (who/what/when/before/after); never UPDATE/DELETE.
- [ ] Per-user + per-IP rate limiting on auth and mutation procedures; backoff/lockout.
- [ ] Bybit keys: no withdraw permission, IP-bound, least privilege, AES-256-GCM encrypted in MySQL, never logged.
- [ ] Kill-switch & admin procedures: dedicated RBAC role + step-up auth + Telegram alert on every toggle.
- [ ] CI: `bun install --frozen-lockfile`, `bun audit`, secret scanning; block Dokploy deploy on findings.
- [ ] Map controls to OWASP ASVS Level 2 for the fintech surface; document gaps.

## Do / Don't
**Do**
- Treat every order/close/config-change as an idempotent, audited, authorized transaction.
- Fail closed: if auth, Zod validation, or the audit write fails, reject the action.
- Derive the actor from `ctx.session` and check row ownership server-side.
- Re-authenticate (step-up TOTP) for high-value actions even inside a valid session.
- Give the engine a least-privilege, IP-bound Bybit key with Withdraw disabled.

**Don't**
- Don't enable *Withdraw* on the trading key, and never store keys unencrypted or in logs.
- Don't log secrets, full session tokens, TOTP secrets, or raw Bybit responses containing keys.
- Don't trust client-supplied `userId`/`configId`, or do validation/authorization only in React.
- Don't expose the kill-switch or admin routes at the same trust level as normal user procedures.
- Don't retry a failed order without an `orderLinkId` — you can double-fill.
- Don't ship with a mismatched/uncommitted `bun.lock` or skip `bun audit` in CI.

## Common pitfalls
- **BOLA everywhere**: a new `byId` procedure that forgets the `ownerId === ctx.user.id` check — the most common and most damaging API bug.
- **Silent double orders**: a polling timeout after Bybit already accepted the order; a naive retry without `orderLinkId` opens a second position.
- **Clock skew**: an unsynced container clock → Bybit rejects signed requests (`recvWindow`) or widens the replay window.
- **Audit gaps**: logging the decision but not the *outcome* and *before/after*, so you can't reconstruct an incident from `v3_decision_log`.
- **Trusting the client**: doing side/qty checks only in the React form; the tRPC procedure is the real boundary.
- **Leaked keys** in git history / images / CI logs — rotate immediately; git history is forever.
- **Verbose errors** leaking stack traces or which field failed auth (enables enumeration).
- **Loose cookies**: overriding Better-Auth defaults to `SameSite=None` or non-HttpOnly for convenience opens CSRF/XSS token theft.

## Code patterns
```typescript
// tRPC tiers: session -> ownership -> RBAC -> step-up. Auth lives in middleware.
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
const t = initTRPC.context<Context>().create();

const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.session.user } });
});
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});
// Fresh TOTP within N minutes for high-risk actions (kill-switch, key edits).
const stepUpProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (Date.now() - ctx.session.twoFactorAt > 5 * 60_000)
    throw new TRPCError({ code: "FORBIDDEN", message: "step_up_required" });
  return next();
});
```

```typescript
// Ownership check + Zod .strict() on a funds-affecting procedure. No BOLA.
const closePosition = protectedProcedure
  .input(z.object({ configId: z.number().int().positive() }).strict())
  .mutation(async ({ ctx, input }) => {
    const cfg = await db.query.userConfigs.findFirst({
      where: (c, { eq, and }) => and(eq(c.id, input.configId), eq(c.ownerId, ctx.user.id)),
    });
    if (!cfg) throw new TRPCError({ code: "NOT_FOUND" }); // hides existence, blocks IDOR
    await audit.log("position.close.attempt", ctx.user.id, { configId: cfg.id });
    // ... close with a MARKET order carrying a unique orderLinkId ...
  });
```

```typescript
// AES-256-GCM at rest + HMAC-SHA256 Bybit V5 signing (Bun/Node crypto).
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export function encrypt(plain: string, key: Buffer) {            // key = 32 bytes from KMS/env
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"),
           data: enc.toString("hex") };                          // store all three in MySQL
}

export function signBybit(secret: string, ts: string, apiKey: string,
                          recvWindow: string, payload: string) {
  return createHmac("sha256", secret)                            // X-BAPI-SIGN
    .update(ts + apiKey + recvWindow + payload).digest("hex");
}
```

```typescript
// Append-only audit event shape — who / what / when / before-after. Never UPDATE/DELETE.
await db.insert(auditLog).values({
  ts: new Date(), actorId: ctx.user.id, actorIp: ctx.ip,
  action: "config.update", object: `config:${cfg.id}`,
  before: { maxLeverage: 5 }, after: { maxLeverage: 10 }, result: "ok",
}); // same discipline as v3_decision_log / v3_position_event
```

## References
- [OWASP Top 10:2021](https://owasp.org/Top10/2021/) — canonical web-app risk list (Broken Access Control, Crypto Failures).
- [OWASP API Security Top 10](https://owasp.org/API-Security/) — API-specific risks; BOLA/broken auth map directly to tRPC procedures.
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) — verifiable requirements; target Level 2 for fintech.
- [Better Auth — Two-Factor (2FA)](https://better-auth.com/docs/plugins/2fa) — TOTP + backup codes plugin, schema, lockout.
- [Better Auth — Cookies](https://better-auth.com/docs/concepts/cookies) — signed, HttpOnly, Secure, SameSite cookie behavior.
- [Better Auth — Session Management](https://better-auth.com/docs/concepts/session-management) — DB-backed revocable sessions, expiry, updateAge.
- [Better Auth — Security](https://better-auth.com/docs/reference/security) — trustedOrigins/CSRF, secret handling, hardening notes.
- [tRPC — Backend Usage](https://trpc.io/docs/server/introduction) — procedures, context, middleware for auth/RBAC.
- [Zod](https://zod.dev/) — TypeScript-first input validation; `.strict()`, enums, bounds, `z.infer`.
- [Bybit V5 — Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — `orderLinkId` idempotency field and params.
- [Bybit V5 — Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) — HMAC-SHA256 signing, `recvWindow`, replay/timestamp, key permissions.
- [Node.js crypto](https://nodejs.org/api/crypto.html) — `createCipheriv` AES-256-GCM, `createHmac`, `randomBytes` (Bun-compatible).
- [Bun — bun audit](https://bun.com/docs/pm/cli/audit) — scan `bun.lock` against the GitHub Advisory DB; `--audit-level`, exit codes.
- [Bun — install / frozen lockfile](https://bun.com/docs/pm/cli/install) — `--frozen-lockfile`, trustedDependencies, minimum-age supply-chain filter.
- [Google Cloud — What is idempotency?](https://cloud.google.com/discover/idempotency) — idempotency-key pattern for reliable money-moving APIs.
