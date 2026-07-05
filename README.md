# researchcrypto — Agent Skills for a Multi-Bot Crypto Trading Platform

> **TR:** Bybit üzerinde, Python öncelikli bir **çoklu-bot (multibot) kripto trading platformu**
> geliştiren bir yapay zeka aracının (**Google Antigravity**) kullanacağı **Agent Skills** kataloğu.
> 22 skill / 7 kategori. Ayrıntılı Türkçe özet ve tam kaynakça için → [`RESEARCH.md`](RESEARCH.md).

This repository is a curated catalog of **Agent Skills** (`SKILL.md` files) that give an AI coding
agent the domain expertise to **build a multi-bot crypto trading platform**. It targets
**Google Antigravity** (the skills use the open `SKILL.md` format, so they also work in Claude Code,
Cursor, and any tool that supports the Agent Skills standard).

**Fixed context for every skill:** Exchange = **Bybit V5 (Unified Trading Account)** ·
Stack = **Python-first** (FastAPI, pandas, asyncio, pydantic, `pybit`, CCXT) ·
Skills are **documentation-only** (guidance + inline snippets; no runtime scripts).

## How Antigravity uses these skills

- **Project scope (this repo):** skills live in [`.agents/skills/<name>/SKILL.md`](.agents/skills/) —
  Antigravity auto-discovers them for this workspace.
- **Global scope:** copy a skill folder to `~/.gemini/config/skills/` to use it across all projects.
- Each `SKILL.md` has a trigger-packed `description`; the agent loads a skill when the task matches
  those triggers. See [`AGENTS.md`](AGENTS.md) for the role → skill mapping.

## Catalog (22 skills / 7 categories)

### A · Exchange & Market Data
| Skill | What it covers |
|---|---|
| [`exchange-integration-bybit`](.agents/skills/exchange-integration-bybit/SKILL.md) | Bybit V5 REST auth (HMAC/X-BAPI/recv_window), `pybit`, CCXT, `category`, rate limits/IP bans, testnet vs demo, retCode handling, tick/qty precision. |
| [`market-data-ingestion`](.agents/skills/market-data-ingestion/SKILL.md) | OHLCV/kline, orderbook, trades, funding, open interest; ms timestamps, gap detection/backfill, normalization, REST vs WS. |
| [`realtime-websocket-streaming`](.agents/skills/realtime-websocket-streaming/SKILL.md) | Public/private WS, topic model, 20s ping/pong, WS auth, reconnect-resubscribe, orderbook snapshot+delta with `u`/seq gap detection. |

### B · Trading Logic
| Skill | What it covers |
|---|---|
| [`strategy-development`](.agents/skills/strategy-development/SKILL.md) | Signals, indicators (pandas-ta/TA-Lib), entry/exit, multi-timeframe, warmup, anti-repaint, strategy/execution separation. |
| [`backtesting-engine`](.agents/skills/backtesting-engine/SKILL.md) | Event-driven vs vectorized, look-ahead/survivorship bias, slippage/fee/funding modeling, walk-forward, overfitting, metrics. |
| [`order-execution-oms`](.agents/skills/order-execution-oms/SKILL.md) | Order types, TIF, place/amend/cancel, `orderLinkId` idempotency, partial fills, retry/backoff, hedge mode, leverage. |

### C · Risk & Portfolio
| Skill | What it covers |
|---|---|
| [`risk-management`](.agents/skills/risk-management/SKILL.md) | Position sizing (fractional Kelly), SL/TP, drawdown & daily-loss limits, exposure/correlation caps, liquidation risk, kill switch. |
| [`portfolio-management`](.agents/skills/portfolio-management/SKILL.md) | Capital allocation, rebalancing, realized/unrealized PnL & fee/funding accounting, sub-accounts, per-strategy attribution. |

### D · Multi-Bot Orchestration & Infra
| Skill | What it covers |
|---|---|
| [`bot-orchestration`](.agents/skills/bot-orchestration/SKILL.md) | Bot lifecycle, isolation, shared rate-limit budget, crash recovery, order-conflict avoidance, asyncio vs multiprocessing vs Celery. |
| [`strategy-config-management`](.agents/skills/strategy-config-management/SKILL.md) | pydantic v2 config, JSON/YAML/TOML, env overrides, SecretStr, versioning/migration, validate-before-live, hot-reload. |
| [`timeseries-data-storage`](.agents/skills/timeseries-data-storage/SKILL.md) | TimescaleDB vs InfluxDB vs Postgres vs Parquet, OHLCV/trade/fill schema, (symbol,time) indexing, downsampling, NUMERIC/Decimal. |
| [`event-bus-messaging`](.agents/skills/event-bus-messaging/SKILL.md) | Redis Streams/Kafka/NATS, delivery guarantees, consumer groups, ordering, idempotent consumers, backpressure. |

### E · Backend, UI & Keys
| Skill | What it covers |
|---|---|
| [`backend-api-service`](.agents/skills/backend-api-service/SKILL.md) | FastAPI async REST + WS, pydantic models, JWT/OAuth2 scopes + RBAC, rate limiting, workers, OpenAPI, structlog. |
| [`realtime-trading-dashboard`](.agents/skills/realtime-trading-dashboard/SKILL.md) | TradingView Lightweight Charts, trade markers, live PnL/positions over WS, `series.update` without re-render storms, depth. |
| [`api-key-secrets-security`](.agents/skills/api-key-secrets-security/SKILL.md) | Least-privilege Bybit keys (no-withdraw + IP whitelist), Fernet/KMS/Vault at rest, no secret logging, rotation, per-user isolation. |

### F · Security, Monitoring & Testing
| Skill | What it covers |
|---|---|
| [`trading-app-security`](.agents/skills/trading-app-security/SKILL.md) | Auth/2FA, OWASP Top 10 + API Top 10 + ASVS, audit logging, idempotency/replay, step-up auth for kill-switch/withdrawal, supply-chain. |
| [`monitoring-observability`](.agents/skills/monitoring-observability/SKILL.md) | Prometheus metrics (latency/fills/WS/PnL/heartbeat), Grafana, Alertmanager → Telegram/Discord, OpenTelemetry, SLOs/error budgets. |
| [`testing-paper-trading`](.agents/skills/testing-paper-trading/SKILL.md) | Bybit testnet vs demo, dry-run, deterministic backtests, mocking (responses/respx), Hypothesis, pytest, CI gate before live. |

### G · DevOps & AI
| Skill | What it covers |
|---|---|
| [`deployment-devops-ha`](.agents/skills/deployment-devops-ha/SKILL.md) | Docker/Compose, secret injection, HA/failover, SIGTERM graceful shutdown (protect positions), leader election/locks, NTP, blue-green. |
| [`ml-trading-signals`](.agents/skills/ml-trading-signals/SKILL.md) | Feature engineering, leakage/look-ahead prevention, purged K-fold + embargo/CPCV, triple-barrier + meta-labeling, FreqAI. |
| [`sentiment-news-signals`](.agents/skills/sentiment-news-signals/SKILL.md) | News/social (X/Reddit), VADER/FinBERT, on-chain (netflow/SOPR/MVRV), funding & long/short ratio as sentiment, alt-data pitfalls. |
| [`llm-agent-integration`](.agents/skills/llm-agent-integration/SKILL.md) | LLM assistant with guardrails, tool calling + deterministic/human gates, structured output, prompt-injection defense, audit. |

## Repository layout

```
.agents/skills/<skill-name>/SKILL.md   # 22 documentation-only Agent Skills
AGENTS.md                              # AI agent roles → which skills each owns
README.md                              # this catalog index
RESEARCH.md                            # Türkçe özet + methodology + full source bibliography
```

## Design principles baked into every skill

1. **Capital safety first** — testnet/demo before live, no-withdraw keys, kill switch, validate-before-live.
2. **No look-ahead / no leakage** — enforced across backtesting, strategy, and ML skills.
3. **Idempotency everywhere** — `orderLinkId` and `Idempotency-Key` to survive retries without duplicate orders.
4. **Official sources** — Bybit V5 docs, `pybit`, CCXT, and canonical library docs are cited over blogs.

---
*Authored as a research deliverable. Every `SKILL.md` ends with a verified **References** section
(~198 unique sources total). See [`RESEARCH.md`](RESEARCH.md) for the consolidated bibliography.*
