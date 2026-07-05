# AGENTS.md — Multi-Bot Crypto Trading Platform (Bybit, Python)

This file defines the AI agent roles for developing this platform in **Google Antigravity**.
Each role maps to the domain skills under [`.agents/skills/`](.agents/skills/). When the agent
picks up work in a given domain, it should load the matching skill(s) listed below.

> Exchange: **Bybit V5 (Unified Trading Account)** · Language: **Python-first** ·
> Skills are documentation-only (no runtime scripts).

## Global working rules
- **Never** place live orders from experimental code — use Bybit **testnet / demo trading** first.
- API keys must have **withdrawal disabled** and **IP whitelist enabled** (see `api-key-secrets-security`).
- Any funds-affecting change requires the relevant risk/security skill to be loaded and its checklist satisfied.
- Prefer official Bybit V5 docs, `pybit`, and CCXT over blog posts when they disagree.

## Roles

### 1. Exchange & Market-Data Engineer
Owns connectivity to Bybit and the data pipeline.
- Skills: `exchange-integration-bybit`, `market-data-ingestion`, `realtime-websocket-streaming`, `timeseries-data-storage`

### 2. Quant / Strategy Engineer
Owns signal generation and validation.
- Skills: `strategy-development`, `backtesting-engine`, `ml-trading-signals`, `sentiment-news-signals`

### 3. Execution & Risk Engineer
Owns order routing, the OMS, and capital safety.
- Skills: `order-execution-oms`, `risk-management`, `portfolio-management`

### 4. Platform / Orchestration Engineer
Owns running many bots reliably.
- Skills: `bot-orchestration`, `strategy-config-management`, `event-bus-messaging`

### 5. Backend & Frontend Engineer
Owns the control plane and UI.
- Skills: `backend-api-service`, `realtime-trading-dashboard`, `llm-agent-integration`

### 6. Security Engineer
Owns keys, auth, and application security.
- Skills: `api-key-secrets-security`, `trading-app-security`

### 7. DevOps / SRE
Owns deployment, observability, and testing gates.
- Skills: `deployment-devops-ha`, `monitoring-observability`, `testing-paper-trading`

---
See [`README.md`](README.md) for the full skill catalog and [`RESEARCH.md`](RESEARCH.md) for the
research notes and source bibliography (Türkçe özet dahil).
