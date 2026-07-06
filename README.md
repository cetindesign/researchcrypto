# researchcrypto — Agent Skills for a Multi-Bot Crypto Trading Platform

> **TR:** **TypeScript/Bun** ile yazılmış, **MySQL** destekli, **polling** tabanlı, **Bybit** üzerinde
> çalışan çok-döngülü bir **çoklu-bot kripto trading platformu** geliştiren bir yapay zeka aracının
> (**Google Antigravity**) kullanacağı **Agent Skills** kataloğu. 24 skill / 8 grup.
> Ayrıntılı Türkçe özet ve tam kaynakça için → [`RESEARCH.md`](RESEARCH.md).

A catalog of **Agent Skills** (`SKILL.md`) that give an AI coding agent the domain expertise to build
and maintain **this specific** multi-bot crypto trading platform. Targets **Google Antigravity** (open
`SKILL.md` format, so it also works in Claude Code / Cursor / any Agent-Skills-compatible tool).

## The codebase these skills target

| | |
|---|---|
| **Language / runtime** | TypeScript (strict) on **Bun** |
| **Repo** | **Turborepo** monorepo — `apps/` (servers + web) + `packages/` (shared libs) |
| **HTTP / API** | **Hono** + **tRPC v11** (end-to-end typed, Zod inputs) |
| **DB** | **MySQL + Drizzle ORM** — no migrations; idempotent `ensure-schema.ts` |
| **Frontend** | **React 19 + Vite + TanStack Router/Query + Tailwind v4** |
| **Auth / secrets** | **Better-Auth** (Google + email); API keys **AES-256-GCM** in DB; **HMAC-SHA256** signing |
| **Exchange** | **Bybit V5** (Unified account) — signed REST, **polling, NO WebSocket** |
| **Runtime shape** | ONE process serving API/UI **and** running **6 background loops** |
| **AI** | **Google Gemini** (news sentiment) · **Telegram** (alerts) · **Dokploy** (deploy) |

**The 6 boot loops:** `ensureSchema → collector (price snapshots) → v3 Bybit engine (10s) → optimizer (2h)
→ calendar scraper (15m) → news scraper (3m, Gemini sentiment)`.

**Core principles (encoded across the skills):** *pure core / dirty shell* · *exchange = source of truth,
DB = ledger (reconcile)* · *polling not event-driven* · *idempotency via `orderLinkId`* · *audit via
`v3_decision_log` / `v3_position_event`*.

## How Antigravity uses these skills

- **Project scope (this repo):** [`.agents/skills/<name>/SKILL.md`](.agents/skills/) — auto-discovered.
- **Global scope:** copy a folder to `~/.gemini/config/skills/`.
- Each `SKILL.md` has a trigger-packed `description`; the agent loads a skill when the task matches.
  See [`AGENTS.md`](AGENTS.md) for the role → skill mapping.

## Catalog (24 skills)

### ⌂ Architecture (read these first)
| Skill | What it covers |
|---|---|
| [`pure-core-dirty-shell`](.agents/skills/pure-core-dirty-shell/SKILL.md) | Functional core / imperative shell: pure TDD'd decision math in `packages/`, side effects in thin engine files. Includes the fix for the Bybit engine's inlined-logic deviation. |
| [`monorepo-turborepo`](.agents/skills/monorepo-turborepo/SKILL.md) | Turborepo + Bun workspaces; where code belongs (app vs package), `turbo.json`, end-to-end type sharing (tRPC `AppRouter`, Drizzle inferred rows), circular-dep avoidance. |
| [`reconcile-source-of-truth`](.agents/skills/reconcile-source-of-truth/SKILL.md) | Exchange = truth, DB = ledger. Each tick fetches real Bybit positions and reconciles the DB before deciding; drift, orphans, partial fills, reconcile-on-boot. |

### A · Exchange & Market Data (polling)
| Skill | What it covers |
|---|---|
| [`exchange-integration-bybit`](.agents/skills/exchange-integration-bybit/SKILL.md) | Bybit V5 signed REST from TS/Bun: `fetch` + HMAC-SHA256, X-BAPI headers, recv_window, retCode, rate-limit/IP bans, testnet vs demo, AES-256-GCM key decrypt at call time. |
| [`market-data-ingestion`](.agents/skills/market-data-ingestion/SKILL.md) | Poll kline/tickers/orderbook/funding/OI; `collector` snapshots; ms timestamps, dedup, gap backfill, Drizzle `onDuplicateKeyUpdate` upserts. |
| [`rest-polling-and-rate-limits`](.agents/skills/rest-polling-and-rate-limits/SKILL.md) | The polling architecture (no WS): interval loops, `AbortSignal.timeout`, backoff+jitter, shared Bybit rate-limit budget, single-flight, graceful shutdown. |

### B · Trading Logic
| Skill | What it covers |
|---|---|
| [`strategy-development`](.agents/skills/strategy-development/SKILL.md) | Decision logic as pure, unit-tested TS in a package: hand-rolled EMA/RSI/ATR, entry/exit, layering, coin-selector, guards, look-ahead avoidance. |
| [`backtesting-engine`](.agents/skills/backtesting-engine/SKILL.md) | Replay stored candles / `v3_decision_log` through the pure core; MARKET next-bar fills, fee/slippage/funding, walk-forward, overfitting, metrics. |
| [`order-execution-oms`](.agents/skills/order-execution-oms/SKILL.md) | Bybit MARKET entries + reduce-only closes, orderLinkId idempotency, retry/backoff, hedge mode, leverage, qty/tick rounding, audit writes. |

### C · Risk & Portfolio
| Skill | What it covers |
|---|---|
| [`risk-management`](.agents/skills/risk-management/SKILL.md) | Pure-function sizing (fractional Kelly), software TP/SL/trailing on the 10s tick, drawdown/daily-loss limits, exposure/layering caps, liquidation awareness, guards, kill switch. |
| [`portfolio-management`](.agents/skills/portfolio-management/SKILL.md) | Slot allocation, layering, realized/unrealized PnL + fee/funding accounting in Drizzle, ledger-vs-exchange reconcile, per-strategy attribution. |

### D · Orchestration & Data
| Skill | What it covers |
|---|---|
| [`bot-orchestration`](.agents/skills/bot-orchestration/SKILL.md) | The single-process 6-loop runtime; scheduling, single-flight, per-tick config, shared rate-limit budget, reconcile-on-boot, SIGTERM; why polling not a bus (absorbs event-bus topic). |
| [`strategy-config-management`](.agents/skills/strategy-config-management/SKILL.md) | Per-user config in MySQL via Drizzle, edited through tRPC + Zod, encrypted keys in a separate table, testnet/mainnet toggle, validate-before-live, safe reload. |
| [`mysql-drizzle-data-layer`](.agents/skills/mysql-drizzle-data-layer/SKILL.md) | Drizzle schema for candles/orders/fills/config + audit tables; idempotent `ensure-schema.ts` (no migrations); (symbol,time) indexing, DECIMAL precision, DB-as-ledger. |

### E · Backend, UI & Keys
| Skill | What it covers |
|---|---|
| [`backend-api-service`](.agents/skills/backend-api-service/SKILL.md) | Bun + Hono + tRPC v11, Better-Auth context, protected/RBAC procedures, TRPCError formatting, serving the SPA, same process as the loops. |
| [`realtime-trading-dashboard`](.agents/skills/realtime-trading-dashboard/SKILL.md) | React 19 + Vite + TanStack Router/Query + Tailwind v4 + typed tRPC; live data via `refetchInterval` polling; Lightweight Charts v5; no re-render storms. |
| [`api-key-secrets-security`](.agents/skills/api-key-secrets-security/SKILL.md) | AES-256-GCM key storage in MySQL (random IV, auth tag, env master key), just-in-time decrypt→HMAC sign, no-withdraw + IP-whitelist keys, rotation, per-user isolation. |

### F · Security, Monitoring & Testing
| Skill | What it covers |
|---|---|
| [`trading-app-security`](.agents/skills/trading-app-security/SKILL.md) | Better-Auth + 2FA/step-up, OWASP Top 10 / API Top 10, RBAC/BOLA ownership, Zod on every procedure, audit tables, orderLinkId replay defense, `bun audit`. |
| [`monitoring-observability`](.agents/skills/monitoring-observability/SKILL.md) | Telegram alerts, per-loop heartbeat / dead-man switch, `v3_*` audit as forensic tool, structured logs, Hono `/health`; Prometheus/Grafana optional. |
| [`testing-paper-trading`](.agents/skills/testing-paper-trading/SKILL.md) | `bun test` TDD of the pure core, deterministic fixtures + frozen time, mock Bybit at the fetch boundary, fast-check, testnet/demo smoke, deploy gate. |

### G · DevOps & AI
| Skill | What it covers |
|---|---|
| [`deployment-devops-ha`](.agents/skills/deployment-devops-ha/SKILL.md) | Dokploy push-to-main auto build/deploy, single Bun container, ensure-schema (no migrations), SIGTERM shutdown protecting positions, reconcile-on-boot, NTP for recv_window. |
| [`parameter-optimizer`](.agents/skills/parameter-optimizer/SKILL.md) | The 2h optimizer loop tuning strategy parameters via pure-core replay; walk-forward, overfitting/look-ahead avoidance, grid/random/Bayesian, guardrails on live params. |
| [`sentiment-news-signals`](.agents/skills/sentiment-news-signals/SKILL.md) | News (3m) + calendar (15m) scrapers over RSS, Gemini sentiment scoring, the news/BTC-shock/calendar guards, funding & long-short ratio as positioning. |
| [`gemini-ai-integration`](.agents/skills/gemini-ai-integration/SKILL.md) | Google Gemini from TS (`@google/genai`), structured JSON via responseSchema + Zod re-validation, iron-rule guardrails (never places orders), prompt-injection defense, audit. |

## Repository layout

```
.agents/skills/<skill-name>/SKILL.md   # 24 documentation-only Agent Skills (TypeScript/Bun/Bybit)
AGENTS.md                              # AI agent roles -> which skills each owns
README.md                              # this catalog index
RESEARCH.md                            # Türkçe özet + methodology + full source bibliography
```

---
*Every `SKILL.md` ends with a verified **References** section (~190 unique sources). See
[`RESEARCH.md`](RESEARCH.md) for the consolidated bibliography and the Turkish summary.*
