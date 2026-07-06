# AGENTS.md — Multi-Bot Crypto Trading Platform (TypeScript/Bun, Bybit)

This file defines the AI agent roles for developing this platform in **Google Antigravity**.
Each role maps to the domain skills under [`.agents/skills/`](.agents/skills/). When the agent picks up
work in a given domain, it should load the matching skill(s).

> Stack: **TypeScript (strict) on Bun** · Turborepo monorepo · Hono + tRPC v11 · MySQL + Drizzle ·
> React 19 + TanStack + Tailwind v4 · Better-Auth · **Bybit V5 signed REST, polling (no WebSocket)** ·
> Gemini (news sentiment) · Telegram (alerts) · Dokploy (deploy). Skills are documentation-only.

## Global working rules
- **Read the Architecture skills first** — [`pure-core-dirty-shell`](.agents/skills/pure-core-dirty-shell/SKILL.md),
  [`monorepo-turborepo`](.agents/skills/monorepo-turborepo/SKILL.md),
  [`reconcile-source-of-truth`](.agents/skills/reconcile-source-of-truth/SKILL.md). They govern everything else.
- **Decision math is pure and unit-tested** in `packages/`; exchange/DB/Telegram side effects live in the thin engine shell.
- **The exchange is the source of truth; the DB is a ledger.** Reconcile before deciding.
- **Polling, not WebSocket.** Respect the shared Bybit rate-limit budget across all loops.
- **Never** run experimental order code on mainnet — use Bybit **testnet / demo** first.
- API keys must have **withdrawal disabled** + **IP whitelist**, stored **AES-256-GCM** encrypted (never logged).
- Every order/decision is auditable via `v3_decision_log` / `v3_position_event`.

## Roles

### 1. Exchange & Market-Data Engineer
Connectivity to Bybit and the polling data pipeline.
- Skills: `exchange-integration-bybit`, `market-data-ingestion`, `rest-polling-and-rate-limits`, `mysql-drizzle-data-layer`

### 2. Quant / Strategy Engineer
Signal generation, validation, and parameter tuning — all in the pure core.
- Skills: `strategy-development`, `backtesting-engine`, `parameter-optimizer`, `sentiment-news-signals`

### 3. Execution & Risk Engineer
Order routing, the OMS, capital safety, and reconciliation.
- Skills: `order-execution-oms`, `risk-management`, `portfolio-management`, `reconcile-source-of-truth`

### 4. Platform / Orchestration Engineer
The single-process, 6-loop runtime and its config.
- Skills: `bot-orchestration`, `strategy-config-management`, `monorepo-turborepo`, `pure-core-dirty-shell`

### 5. Backend & Frontend Engineer
The Hono/tRPC control plane, the React panel, and the AI assistant.
- Skills: `backend-api-service`, `realtime-trading-dashboard`, `gemini-ai-integration`

### 6. Security Engineer
Keys, auth, and application security.
- Skills: `api-key-secrets-security`, `trading-app-security`

### 7. DevOps / SRE
Deployment, observability, and testing gates.
- Skills: `deployment-devops-ha`, `monitoring-observability`, `testing-paper-trading`

---
See [`README.md`](README.md) for the full 24-skill catalog and [`RESEARCH.md`](RESEARCH.md) for the
research notes and source bibliography (Türkçe özet dahil).
