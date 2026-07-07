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
- Skills: `strategy-development`, `backtesting-engine`, `strategy-validation-protocol`, `parameter-optimizer`, `sentiment-news-signals`, `coin-universe-selection`, `regime-detection`

### 3. Execution & Risk Engineer
Order routing, the OMS, capital safety, and reconciliation.
- Skills: `order-execution-oms`, `maker-execution-cost-control`, `atr-adaptive-exits`, `entry-guards-cooldown`, `risk-management`, `portfolio-management`, `reconcile-source-of-truth`

### 4. Platform / Orchestration Engineer
The single-process, 6-loop runtime, its config, and the multi-bot fleet.
- Skills: `bot-orchestration`, `fleet-coordination`, `strategy-config-management`, `monorepo-turborepo`, `pure-core-dirty-shell`

### 4b. Market-Neutral (Safra) Engineer — last priority
The delta-neutral funding-carry role (engine change: spot leg + two-leg fills).
- Skills: `market-neutral-funding`, `fleet-coordination`, `reconcile-source-of-truth`

### 4c. 🎯 Avcı (Hunter) Momentum Engineer
The momentum/breakout role — most aggressive, least proven (10-15% of fleet capital). **Read
`avci-signal-validation-rollout` FIRST: Gate-0 requires decomposing the L1 34% baseline's payoff ratio before
building anything.** Discipline: 34% win rate is normal positive-skew; confluence cuts trade count, not win rate.
- Skills: `avci-breakout-confluence`, `avci-volume-volatility-confirmation`, `avci-volatility-position-sizing`,
  `avci-taker-entry-slippage-guard`, `avci-regime-timing-standdown`, `avci-signal-validation-rollout`

### 5. Backend & Frontend Engineer
The Hono/tRPC control plane, the React panel, and the AI assistant.
- Skills: `backend-api-service`, `realtime-trading-dashboard`, `gemini-ai-integration`

### 6. Security Engineer
Keys, auth, and application security.
- Skills: `api-key-secrets-security`, `trading-app-security`

### 7. DevOps / SRE
Deployment, observability, and testing gates.
- Skills: `deployment-devops-ha`, `monitoring-observability`, `testing-paper-trading`

## SkyPower V3 — Faz 3 build order (fleet strategy)
When implementing the SkyPower V3 fleet, follow the report's sequence:
- **Faz A — get Kayıkçı live (mostly config-only + core [KOD]):** `coin-universe-selection`, `regime-detection`,
  `maker-execution-cost-control`, `atr-adaptive-exits`, `entry-guards-cooldown` (+ updated `order-execution-oms`,
  `risk-management`, `strategy-development`).
- **Faz B — fleet & proof:** `fleet-coordination`, `strategy-validation-protocol` (+ updated `backtesting-engine`,
  `market-data-ingestion`, `parameter-optimizer`).
- **Faz C — last:** `market-neutral-funding` (Safra — spot leg + two-leg execution = engine change).

**Iron rules for this strategy:** entries are **maker post-only** (not MARKET) — **except Avcı, which takes on
genuine breakouts** via `avci-taker-entry-slippage-guard`; every role must pass `strategy-validation-protocol`
(cost-adjusted PF ≥ 1.3, ≥300 trades, +EV, 2 regimes) before real capital; one bot per symbol
(`fleet-coordination` lock); DCA-on-loss stays OFF; the live frequency optimizer stays OFF.

**Avcı-specific (group I):** before writing/optimizing Avcı, run **Gate-0** (`avci-signal-validation-rollout`) —
decompose the L1 34% baseline's avg_win/avg_loss/payoff (breakeven ≈1.94R at 34%); if payoff is already healthy,
fix the too-tight 0.8% trailing exit (`atr-adaptive-exits`) instead of redesigning the signal. Ship the v1 trio
first (vol-scaled sizing + closed-bar signal + volume/volatility confirmation); hold MTF/RS/MACD/RSI/ORB behind
flags until each earns its keep out-of-sample. Never stack filters to chase win rate.

---
See [`README.md`](README.md) for the full 38-skill catalog and [`RESEARCH.md`](RESEARCH.md) for the
research notes and source bibliography (Türkçe özet dahil).
