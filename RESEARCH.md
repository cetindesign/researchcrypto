# RESEARCH.md — Araştırma Özeti ve Kaynakça (TR)

Bu doküman, **TypeScript/Bun ile yazılmış, MySQL destekli, polling tabanlı, Bybit üzerinde çalışan
çoklu-bot bir kripto trading platformunu** geliştiren bir yapay zeka aracının (**Google Antigravity**)
kullanacağı **Agent Skills** kataloğunun araştırma notlarını, tasarım kararlarını ve kaynakçasını içerir.

> **Not (v2):** Katalog önce Python varsayımıyla yazıldı; ardından paylaşılan **gerçek kod tabanına**
> göre tümüyle **TypeScript/Bun**'a taşındı. Aşağıdaki her şey v2 (gerçek) duruma göredir.

---

## 1. Kod tabanı — temel gerçekler (ground truth)

| Katman | Teknoloji |
|---|---|
| Dil / runtime | **TypeScript (strict) · Bun** |
| Repo | **Turborepo** monorepo (`apps/` + `packages/`) |
| HTTP / API | **Hono** + **tRPC v11** (uçtan uca tipli, Zod input) |
| Veritabanı | **MySQL + Drizzle ORM** — migration yok, idempotent `ensure-schema.ts` |
| Arayüz | **React 19 + Vite + TanStack Router/Query + Tailwind v4** |
| Kimlik / sır | **Better-Auth** (Google + e-posta); API anahtarları **AES-256-GCM** (DB'de); imza **HMAC-SHA256** |
| Borsa | **Bybit V5** (Unified) — imzalı REST, **polling, WebSocket YOK** |
| Çalışma şekli | Tek süreç: API/UI + **6 arka plan döngüsü** |
| Dış | **Google Gemini** (haber sentiment) · **Telegram** (uyarı) · **Dokploy** (deploy) · RSS |

**6 boot döngüsü:** `ensureSchema → collector (fiyat snapshot) → v3 Bybit motoru (10sn) → optimizer (2sa)
→ takvim scraper (15dk) → haber scraper (3dk, Gemini sentiment)`.

**Mimari ilkeler:** *saf çekirdek / kirli kabuk* · *borsa = tek gerçek kaynak, DB = defter (reconcile)* ·
*polling (event-driven değil)* · *idempotency (`orderLinkId`)* · *audit (`v3_decision_log` / `v3_position_event`)*.

## 2. Antigravity skill formatı

Antigravity, **Agent Skills açık standardını** kullanır (Claude Code ile aynı). Skill = klasör + zorunlu
`SKILL.md` (frontmatter: `name`, `description`). Proje kapsamı `<kök>/.agents/skills/`, global kapsam
`~/.gemini/config/skills/`. Ayrıca `AGENTS.md` ve `.agents/rules/`.
- Agent Skills in Antigravity — https://antigravity.google/docs/skills
- Authoring Antigravity Skills (Codelab) — https://codelabs.developers.google.com/getting-started-with-antigravity-skills

## 3. Katalog (24 skill / 8 grup)

| Grup | Skill'ler |
|---|---|
| ⌂ Mimari | `pure-core-dirty-shell`, `monorepo-turborepo`, `reconcile-source-of-truth` |
| A · Borsa & Veri (polling) | `exchange-integration-bybit`, `market-data-ingestion`, `rest-polling-and-rate-limits` |
| B · Trading Mantığı | `strategy-development`, `backtesting-engine`, `order-execution-oms` |
| C · Risk & Portföy | `risk-management`, `portfolio-management` |
| D · Orkestrasyon & Veri | `bot-orchestration`, `strategy-config-management`, `mysql-drizzle-data-layer` |
| E · Backend/UI/Anahtar | `backend-api-service`, `realtime-trading-dashboard`, `api-key-secrets-security` |
| F · Güvenlik/İzleme/Test | `trading-app-security`, `monitoring-observability`, `testing-paper-trading` |
| G · DevOps & AI | `deployment-devops-ha`, `parameter-optimizer`, `sentiment-news-signals`, `gemini-ai-integration` |

**v1 → v2 değişimleri:** dil Python→TypeScript/Bun · borsa örnekleri **yalnız Bybit** · WebSocket
kaldırıldı → `rest-polling-and-rate-limits` · TimescaleDB → `mysql-drizzle-data-layer` · `event-bus-messaging`
→ `bot-orchestration`'a eritildi · `ml-trading-signals` → `parameter-optimizer` · `llm-agent-integration`
→ `gemini-ai-integration` · **yeni:** `pure-core-dirty-shell`, `monorepo-turborepo`, `reconcile-source-of-truth`.

## 4. Metodoloji

- **Fan-out araştırma:** 24 skill, 8 paralel araştırma ajanına bölündü; her ajan kendi domain'i için canlı
  web araması yaptı, resmi kaynakları önceledi (Bybit V5, Bun, Hono, tRPC, Drizzle, TanStack, Better-Auth,
  Zod, Turborepo, Gemini, OWASP).
- **Doğrulama:** Linkler arama sonuçlarına karşı teyit edildi. Bazı doküman siteleri (bybit-exchange.github.io,
  ai.google.dev, docs.dokploy.com, orm.drizzle.team) bot-fetch'e 403 döndüğü için sayfa gövdeleri arama
  snippet'leriyle doğrulandı; derin path'ler resmi şemaya göre kullanıldı.
- **Sentez:** Her skill ortak şablonla, TypeScript-only snippet'lerle, İngilizce gövdeyle yazıldı.

## 5. Öne çıkan tasarım kararları / tuzaklar (v2)

- **Saf çekirdek / kirli kabuk:** Karar matematiği (`packages/`) saf, deterministik, `bun test` ile test
  edilir; borsa/DB/Telegram yan etkileri ince motor dosyalarında. (Bilinen sapma: Bybit motorunun mantığı
  inline kopyalaması — `pure-core-dirty-shell` bunu düzeltmeyi hedefler.)
- **Reconcile:** Her tick borsadan gerçek pozisyonları çekip DB'yi eşitler; karar öncesi drift/orphan/partial
  fill tespiti; snapshot başarısızsa karar verme.
- **Polling & rate-limit:** `AbortSignal.timeout` ile fetch timeout, backoff+jitter, döngüler arası paylaşılan
  Bybit rate-limit bütçesi, single-flight (üst üste binen tick yok), 403/429/10006 yönetimi.
- **Idempotency:** `orderLinkId` ile retry'de çift emir önleme; MARKET giriş + reduce-only MARKET çıkış.
- **Sır güvenliği:** AES-256-GCM (kayıt başına rastgele IV + auth tag, env master key), yalnız imza anında
  bellekte çöz; withdraw kapalı + IP whitelist Bybit anahtarları; sır loglama yok.
- **Şema:** Migration dosyası yok; idempotent `ensure-schema.ts` ALTER guard'ları; fiyatlar DECIMAL/string
  (float değil).

## 6. Kaynakça (kategori bazında)

> Her skill'in `SKILL.md` sonunda tam ve doğrulanmış **References** bölümü vardır (~190 benzersiz kaynak).

### Platform / stack (çekirdek)
- Bun — Docs — https://bun.com/docs · Test runner — https://bun.com/docs/test · Hashing/CryptoHasher — https://bun.com/docs/runtime/hashing · Workspaces — https://bun.com/docs/pm/workspaces · bun audit — https://bun.com/docs/pm/cli/audit
- Hono — https://hono.dev/docs/ · RPC — https://hono.dev/docs/guides/rpc · Better-Auth örneği — https://hono.dev/examples/better-auth
- tRPC — Procedures — https://trpc.io/docs/server/procedures · Context — https://trpc.io/docs/server/context · Middlewares — https://trpc.io/docs/server/middlewares · Error handling/formatting — https://trpc.io/docs/server/error-handling · TanStack setup — https://trpc.io/docs/client/tanstack-react-query/setup · @hono/trpc-server — https://www.npmjs.com/package/@hono/trpc-server
- Drizzle ORM — MySQL — https://orm.drizzle.team/docs/get-started/mysql-new · Schema — https://orm.drizzle.team/docs/sql-schema-declaration · Column types — https://orm.drizzle.team/docs/column-types/mysql · Indexes/constraints — https://orm.drizzle.team/docs/indexes-constraints · Transactions — https://orm.drizzle.team/docs/transactions · Insert/Upsert — https://orm.drizzle.team/docs/insert · https://orm.drizzle.team/docs/guides/upsert
- Zod — https://zod.dev/ · API — https://zod.dev/api
- Better-Auth — Hono — https://better-auth.com/docs/integrations/hono · Session — https://better-auth.com/docs/concepts/session-management · 2FA — https://better-auth.com/docs/plugins/2fa · Cookies — https://better-auth.com/docs/concepts/cookies · Security — https://better-auth.com/docs/reference/security
- Turborepo — Structuring — https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository · Tasks — https://turborepo.dev/docs/crafting-your-repository/configuring-tasks · Config — https://turborepo.dev/docs/reference/configuration · Internal packages — https://turborepo.dev/docs/core-concepts/internal-packages · TypeScript — https://turborepo.dev/docs/guides/tools/typescript
- Better-T-Stack (referans şablon) — https://github.com/AmanVarshney01/Better-T-Stack
- Node crypto — https://nodejs.org/api/crypto.html · createCipheriv — https://nodejs.org/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options
- MDN — fetch — https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch · AbortController — https://developer.mozilla.org/en-US/docs/Web/API/AbortController · AbortSignal.timeout — https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static · SubtleCrypto — https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto

### Frontend
- TanStack Query — Polling — https://tanstack.com/query/latest/docs/framework/react/guides/polling · useQuery — https://tanstack.com/query/v5/docs/framework/react/reference/useQuery · Optimistic — https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates
- @trpc/tanstack-react-query — https://www.npmjs.com/package/@trpc/tanstack-react-query
- TanStack Router — createRouter — https://tanstack.com/router/latest/docs/guide/creating-a-router · file-based — https://tanstack.com/router/latest/docs/routing/file-based-routing
- Tailwind v4 — Vite — https://tailwindcss.com/docs/installation/using-vite · v4 blog — https://tailwindcss.com/blog/tailwindcss-v4
- TradingView Lightweight Charts — Docs — https://tradingview.github.io/lightweight-charts/docs · React — https://tradingview.github.io/lightweight-charts/tutorials/react/simple · v4→v5 — https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5

### Bybit V5 (resmi doküman)
- Introduction — https://bybit-exchange.github.io/docs/v5/intro · Integration Guidance (auth/signing) — https://bybit-exchange.github.io/docs/v5/guide · Rate Limit — https://bybit-exchange.github.io/docs/v5/rate-limit · Error Codes — https://bybit-exchange.github.io/docs/v5/error · Server Time — https://bybit-exchange.github.io/docs/v5/market/time · Demo Trading — https://bybit-exchange.github.io/docs/v5/demo
- Market: Kline — https://bybit-exchange.github.io/docs/v5/market/kline · Instruments — https://bybit-exchange.github.io/docs/v5/market/instrument · Tickers — https://bybit-exchange.github.io/docs/v5/market/tickers · Orderbook — https://bybit-exchange.github.io/docs/v5/market/orderbook · Funding History — https://bybit-exchange.github.io/docs/v5/market/history-fund-rate · Open Interest — https://bybit-exchange.github.io/docs/v5/market/open-interest · Long/Short Ratio — https://bybit-exchange.github.io/docs/v5/market/long-short-ratio
- Order: Create — https://bybit-exchange.github.io/docs/v5/order/create-order · Cancel — https://bybit-exchange.github.io/docs/v5/order/cancel-order · Open/Closed — https://bybit-exchange.github.io/docs/v5/order/open-order
- Position: Info — https://bybit-exchange.github.io/docs/v5/position · Trading Stop — https://bybit-exchange.github.io/docs/v5/position/trading-stop · Position Mode — https://bybit-exchange.github.io/docs/v5/position/position-mode · Leverage — https://bybit-exchange.github.io/docs/v5/position/leverage
- Account: Wallet Balance — https://bybit-exchange.github.io/docs/v5/account/wallet-balance · Closed PnL — https://bybit-exchange.github.io/docs/v5/position/close-pnl · Transaction Log — https://bybit-exchange.github.io/docs/v5/account/transaction-log · Fee Rate — https://bybit-exchange.github.io/docs/v5/account/fee-rate
- User (API keys): Create Sub API Key — https://bybit-exchange.github.io/docs/v5/user/create-subuid-apikey · API Key Info — https://bybit-exchange.github.io/docs/v5/user/apikey-info
- Help Center: Create API Key — https://www.bybit.com/en/help-center/article/How-to-create-your-API-key · Liquidation Price (UTA) — https://www.bybit.com/en/help-center/article/Liquidation-Price-Calculation-under-Isolated-Mode-Unified-Trading-Account · Maintenance Margin — https://www.bybit.com/en/help-center/article/Maintenance-Margin-USDT-Contract · P&L Calc — https://www.bybit.com/en/help-center/article/Profit-Loss-calculations-USDT-Contract · Funding Fee — https://www.bybit.com/en/help-center/article/Funding-fee-calculation · Demo Trading FAQ — https://www.bybit.com/en/help-center/article/FAQ-Demo-Trading

### Test / kalite / mimari
- Vitest — https://vitest.dev/guide/ · fast-check — https://fast-check.dev/ · (Bun ile) — https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-bun-test-runner/
- Functional core / imperative shell — https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell · https://functional-architecture.org/functional_core_imperative_shell/
- Functional DI (TS) — https://hassannteifeh.medium.com/functional-dependency-injection-in-typescript-4c2739326f57

### Güvenlik / izleme / deploy
- OWASP — Top 10:2021 — https://owasp.org/Top10/2021/ · API Security Top 10 — https://owasp.org/API-Security/ · ASVS — https://owasp.org/www-project-application-security-verification-standard/ · Secrets Mgmt — https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html · Cryptographic Storage — https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html · LLM Top 10 — https://owasp.org/www-project-top-10-for-large-language-model-applications/
- Telegram Bot API (sendMessage) — https://core.telegram.org/bots/api#sendmessage · pino — https://getpino.io/ · Google SRE SLOs — https://sre.google/sre-book/service-level-objectives/
- Dokploy — Docs/GitHub (push-to-main auto build/deploy) · Docker — Dockerfile reference — https://docs.docker.com/reference/dockerfile/ · container stop (SIGTERM) — https://docs.docker.com/reference/cli/docker/container/stop/ · oven/bun (Docker) — https://hub.docker.com/r/oven/bun · chrony/NTP — https://chrony-project.org/documentation.html

### AI (Gemini) & optimizer
- Google Gemini — @google/genai (npm) — https://www.npmjs.com/package/@google/genai · js-genai (GitHub) — https://github.com/googleapis/js-genai · Structured output — https://ai.google.dev/gemini-api/docs/structured-output · Rate limits — https://ai.google.dev/gemini-api/docs/rate-limits · Pricing — https://ai.google.dev/gemini-api/docs/pricing
- RSS — rss-parser (npm) — https://www.npmjs.com/package/rss-parser · fast-xml-parser — https://www.npmjs.com/package/fast-xml-parser
- Parametre optimizasyonu — Advances in Financial ML (López de Prado) — https://www.wiley.com/en-us/Advances+in+Financial+Machine+Learning-p-9781119482086 · Walk-forward (IBKR) · Purged CV (Wikipedia) — https://en.wikipedia.org/wiki/Purged_cross-validation · Hyperparameter optimization — https://en.wikipedia.org/wiki/Hyperparameter_optimization

---

## 7. Sabahki session için notlar

- Katalog eksiksiz (24/24 skill, TypeScript/Bun) ve `claude/crypto-trading-ai-skills-8juz86` dalına push edildi.
- Sonraki adım önerileri:
  1. **Repoyu ekleyip birebir hizalama:** Gerçek dosya/tablo/paket adlarını (`packages/*`, gerçek tablo şeması)
     okuyup skill'lerdeki örnek isimleri koda tam uydurma.
  2. **`.agents/rules/` ekleme:** Pasif kurallar (ör. "canlı emir yalnız risk checklist + reconcile geçtiyse";
     "yeni karar mantığı yalnız `packages/` saf çekirdeğinde").
  3. **Bybit motoru refactor'ı:** `pure-core-dirty-shell` skill'ini rehber alarak inline kopyayı saf çekirdeğe taşıma.
  4. **Antigravity'de deneme:** `.agents/skills/` altını yükleyip tetikleyicilerin doğru çalıştığını gözlemleme.
