# researchcrypto — Agent Skills for a Multi-Bot Crypto Trading Platform

> **TR:** **TypeScript/Bun** ile yazılmış, **MySQL** destekli, **polling** tabanlı, **Bybit** üzerinde
> çalışan çok-döngülü bir **çoklu-bot kripto trading platformu** geliştiren bir yapay zeka aracının
> (**Google Antigravity**) kullanacağı **Agent Skills** kataloğu. **38 skill / 10 grup** — 8'i
> **SkyPower V3 filo stratejisine**, 6'sı **🎯 Avcı momentum rolüne** özel. Türkçe özet + kaynakça → [`RESEARCH.md`](RESEARCH.md).

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

**SkyPower V3 — Faz 3 strategy alignment (group H):** the 8 strategy-specific skills encode the fleet design —
4 roles (🎯 Avcı / 🚣 Kayıkçı / 🔭 Bulucu / ⚓ Safra), a **two-tier coin universe** (Tier-A/B liquidity gates),
**maker/post-only cost control** (the #1 fix — the engine moves off MARKET-only entries), **ATR/Chandelier
adaptive exits**, a **regime compass** (BTC anchor + breadth + positioning, 2-of-3 rule), **entry guards +
cooldown/blacklist + reentrancy guard**, **fleet coordination** (symbol lock, fleet-total exposure), and a
**validation protocol** (cost-aware backtest → walk-forward → hold-out → DSR → ≥300 trades/PF≥1.3 → mainnet
micro-pilot → kill-criteria). Real `v3_coin_config` keys are used throughout.

## How Antigravity uses these skills

- **Project scope (this repo):** [`.agents/skills/<name>/SKILL.md`](.agents/skills/) — auto-discovered.
- **Global scope:** copy a folder to `~/.gemini/config/skills/`.
- Each `SKILL.md` has a trigger-packed `description`; the agent loads a skill when the task matches.
  See [`AGENTS.md`](AGENTS.md) for the role → skill mapping.

## Catalog (38 skills)

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
| [`parameter-optimizer`](.agents/skills/parameter-optimizer/SKILL.md) | **Live 2h loop OFF under SkyPower V3** (`optimizer_enabled: 0`) — tuning moves offline into the validation protocol; walk-forward, overfitting/look-ahead avoidance, no frequency-chasing, promotion only through the go-live gate. |
| [`sentiment-news-signals`](.agents/skills/sentiment-news-signals/SKILL.md) | News (3m) + calendar (15m) scrapers over RSS, Gemini sentiment scoring, the news/BTC-shock/calendar guards, funding & long-short ratio as positioning. |
| [`gemini-ai-integration`](.agents/skills/gemini-ai-integration/SKILL.md) | Google Gemini from TS (`@google/genai`), structured JSON via responseSchema + Zod re-validation, iron-rule guardrails (never places orders), prompt-injection defense, audit. |

### H · SkyPower V3 — Faz 3 strategy skills (fleet-specific)
| Skill | What it covers |
|---|---|
| [`coin-universe-selection`](.agents/skills/coin-universe-selection/SKILL.md) | Bulucu's two-tier tradeable universe: exact Tier-A/B gates (volume, spread, ±2% depth/side, listing age, ATR%, OI), volume/mcap wash-trade filter, Amihud monthly refresh, scan-wide-open-few, stored in MySQL for the fleet. |
| [`regime-detection`](.agents/skills/regime-detection/SKILL.md) | The regime/direction compass on 4h bars: BTC anchor (EMA50/200), breadth (% Tier-A above EMA50), positioning (funding + OI), 2-of-3 rule → long/short/neutral; bias via `max_long_pct`/`max_short_pct`; Shock Shield = brake not regime. |
| [`maker-execution-cost-control`](.agents/skills/maker-execution-cost-control/SKILL.md) | **The #1 fix:** post-only LIMIT entries + tick-chase-then-abort, maker 0.02% vs taker 0.055% math, the EV/breakeven equation, slippage bps budgets, ±1% depth-fraction sizing. Moves the engine off MARKET-only entries. |
| [`atr-adaptive-exits`](.agents/skills/atr-adaptive-exits/SKILL.md) | 3-layer exit: exchange-side disaster stop (~3×ATR, fills `stop_loss_order_id`) + software 1.5-2×ATR(14) stop + Chandelier trailing (HH(22)−3×ATR); time-stop, ATR-percentile regime scaling, post-exit cooldown. |
| [`entry-guards-cooldown`](.agents/skills/entry-guards-cooldown/SKILL.md) | Entry gates as ANDed pure predicates: normal + loss cooldown (60m / 2-loss→24h), fleet blacklist (7d/4-loss), the missing **reentrancy guard** (double-add fix), symbol lock, news/event/BTC-shock/neutral vetoes. Never blocks exits. |
| [`fleet-coordination`](.agents/skills/fleet-coordination/SKILL.md) | The 4-role fleet: MySQL **symbol lock** (one bot/symbol), **fleet-total + net-directional exposure** (correlated BTC/ETH/L1 as one basket), universe partitioning, role capital split (Kayıkçı 35-40% / Safra 25-30% / Avcı 10-15% / Reserve). |
| [`strategy-validation-protocol`](.agents/skills/strategy-validation-protocol/SKILL.md) | Per-role proof gate: cost-aware backtest → walk-forward → one-time hold-out → **Deflated Sharpe** (count trials) / PBO → pass bar (≥300 trades, PF≥1.3, +EV, 2 regimes) → mainnet micro-pilot → staged scale + −10% kill. |
| [`market-neutral-funding`](.agents/skills/market-neutral-funding/SKILL.md) | Safra role (**last priority, engine change**): delta-neutral spot-long + perp-short funding carry, two-leg simultaneous fills + partial-fill unwind, funding-threshold entry/exit, weekly delta rebalancing, realistic 2026 net APY. |

### I · 🎯 Avcı (Hunter) — momentum/breakout role skills
> **Discipline (from the research critic):** a 34% win rate is *normal* for breakout systems (positive skew) —
> the confluence exists to cut trade **count**, not raise win rate. Ship the v1 trio first
> (`avci-volatility-position-sizing`, `avci-volume-volatility-confirmation`, closed-bar signal); everything
> else stays behind flags until it earns its keep out-of-sample. **Gate-0:** decompose the L1 34% baseline's
> payoff ratio *before* redesigning.

| Skill | What it covers |
|---|---|
| [`avci-breakout-confluence`](.agents/skills/avci-breakout-confluence/SKILL.md) | Signal engine `evaluateAvciBreakout()`: Donchian(20) close-beyond + ATR buffer trigger; ADX≥25/ROC≥`min_momentum_pct`/RVOL≥`min_hacim_carpan` hard gate; MTF/RS/RSI/MACD as flagged boosters (v1 = the 4 core). Hosts shared indicator helpers. |
| [`avci-volume-volatility-confirmation`](.agents/skills/avci-volume-volatility-confirmation/SKILL.md) | v1 ship-first anti-fakeout gate: ANDs RVOL surge (Bybit turnover, median denom) with squeeze→expansion (BB-in-KC / BandWidth-pct), closed bars, ATR expansion ≥1.25. |
| [`avci-volatility-position-sizing`](.agents/skills/avci-volatility-position-sizing/SKILL.md) | **Ship first** (best-evidenced): vol-scaled sizing `qty=(risk%·budget)/(k·ATR%)` → fixed 0.5-1% risk; single-symbol ≤30% cap; BTC-basket correlation cap on the 2 slots; decreasing pyramid (≤0.7) only while ROC>0 & vol calm. |
| [`avci-taker-entry-slippage-guard`](.agents/skills/avci-taker-entry-slippage-guard/SKILL.md) | Avcı's taker exception: fee gap is a red herring, **exit** slippage on thin Tier-B stop-outs is the lever & blow-up path. Entry-instant depth/spread re-poll, IOC slippage cap (adverse-selection caveat), per-Tier exit-slippage model. |
| [`avci-regime-timing-standdown`](.agents/skills/avci-regime-timing-standdown/SKILL.md) | `regimeGate()` — vetoes the dead-cat-bounce breakout the RVOL/ATR gate wrongly passes (momentum crash); chop-block (Choppiness>61.8/ADX<20), 13-21 UTC session, funding+OI veto; maps regime→coin_count (standdown = 0). |
| [`avci-signal-validation-rollout`](.agents/skills/avci-signal-validation-rollout/SKILL.md) | Safety spine: **Gate-0** baseline decomposition (avg_win/avg_loss/payoff ≈1.94R breakeven at 34%), v1-vs-staged flag ladder, sample-size reality (~5-20 trades/mo → months), −10% kill. |

## Repository layout

```
.agents/skills/<skill-name>/SKILL.md   # 38 documentation-only Agent Skills (TypeScript/Bun/Bybit)
AGENTS.md                              # AI agent roles -> which skills each owns
README.md                              # this catalog index
RESEARCH.md                            # Türkçe özet + methodology + full source bibliography
```

---
*Every `SKILL.md` ends with a verified **References** section (~290 unique sources). Group H aligns to the
**SkyPower V3 — Faz 3** fleet strategy; group I specializes the **🎯 Avcı momentum role** (Donchian/ADX/ROC/RVOL
confluence, vol-scaled sizing, taker/slippage reality, momentum-crash standdown, Gate-0 validation) from an
81-source deep-research pass with an adversarial critic. See [`RESEARCH.md`](RESEARCH.md) for the bibliography.*
