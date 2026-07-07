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

## 3. Katalog (38 skill / 10 grup)

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
| **H · SkyPower V3 (strateji)** | `coin-universe-selection`, `regime-detection`, `maker-execution-cost-control`, `atr-adaptive-exits`, `entry-guards-cooldown`, `fleet-coordination`, `strategy-validation-protocol`, `market-neutral-funding` |
| **I · 🎯 Avcı (momentum rolü)** | `avci-breakout-confluence`, `avci-volume-volatility-confirmation`, `avci-volatility-position-sizing`, `avci-taker-entry-slippage-guard`, `avci-regime-timing-standdown`, `avci-signal-validation-rollout` |

**v1 → v2 değişimleri:** dil Python→TypeScript/Bun · borsa örnekleri **yalnız Bybit** · WebSocket
kaldırıldı → `rest-polling-and-rate-limits` · TimescaleDB → `mysql-drizzle-data-layer` · `event-bus-messaging`
→ `bot-orchestration`'a eritildi · `ml-trading-signals` → `parameter-optimizer` · `llm-agent-integration`
→ `gemini-ai-integration` · **yeni:** `pure-core-dirty-shell`, `monorepo-turborepo`, `reconcile-source-of-truth`.

## 3b. SkyPower V3 — Faz 3 stratejisine hizalama (v3, grup H)

Paylaşılan **SkyPower V3 Faz 3** strateji raporuna göre 8 yeni beceri eklendi + 6 mevcut beceri güncellendi.
Kararlar: kapsam **1(a)** (8 yeni + 6 güncelleme), güncellemeler **2(a)** (mevcut dosyalar yerinde), optimizer
**3(a)** (canlı döngü kapalı → offline walk-forward'a çerçevelendi).

**8 yeni beceri:** `coin-universe-selection` (iki-katmanlı evren, Tier-A/B eşikleri, wash-trade filtresi,
Amihud), `regime-detection` (BTC çıpası + breadth + funding/OI, 2/3 kuralı), `maker-execution-cost-control`
(#1 çözüm: post-only + tick-kovalama + EV matematiği), `atr-adaptive-exits` (borsa felaket-stop + yazılım stop
+ Chandelier), `entry-guards-cooldown` (cooldown/kara-liste + reentrancy guard), `fleet-coordination` (sembol
kilidi + filo-toplam exposure + rol dağılımı), `strategy-validation-protocol` (maliyet-farkında backtest →
walk-forward → hold-out → DSR → ≥300 işlem/PF≥1.3 → mainnet mikro-pilot → kill-kriteri), `market-neutral-funding`
(Safra: delta-nötr spot+perp carry).

**6 güncelleme:** `order-execution-oms` (MARKET-only kaldırıldı → maker/post-only + borsa-tarafı TP/SL) ·
`risk-management` (ATR boyutlama `qty=(equity×risk%)/(k×ATR)` + filo exposure) · `market-data-ingestion`
(orderbook derinlik ±%1/±%2, spread, OI, listeleme yaşı) · `backtesting-engine` (maliyet modeli maker 0.02 /
taker 0.055 + Tier slippage + funding, DSR) · `strategy-development` (breakout/momentum + breadth + azalan
piramit ≤0.7) · `parameter-optimizer` (canlı döngü kapalı, offline walk-forward'a çerçevelendi).

**İnşa sırası:** Faz A (Kayıkçı'yı canlıya taşıyan çekirdek) → Faz B (filo & kanıt) → Faz C (Safra, motor değişikliği).

## 3c. 🎯 Avcı (Hunter) momentum rolüne özel derinleştirme (grup I)

10 ajanlık bir **araştırma workflow'u** (8 paralel cephe + skeptik kritik + sentez, **81 doğrulanmış kaynak**)
ile Avcı momentum/breakout rolü derinlemesine incelendi. 6 yeni beceri + 5 avci-profile güncelleme yazıldı.

**Kritik ajanının merkezî uyarısı (tüm tasarımı yönetti):** **%34 kazanma oranı breakout sistemleri için
NORMALDİR** — para pozitif çarpıklıktan gelir (birkaç büyük kazanan çok sayıda küçük kaybedeni öder). Filtre
yığıp bu oranı yükseltmek sağ kuyruğu budar; asıl kaldıraçlar **payoff oranı (avg_win/avg_loss)** ve **ince
Tier-B coinlerde çıkış slippage'i**dir (hiç ölçülmemiş). Bu yüzden **Gate-0**: inşadan önce L1 %34'ün payoff'unu
ayrıştır (34%'te başabaş ≈1.94R); sağlıklıysa suçlu muhtemelen sıkı 0.8% trailing çıkıştır, sinyal değil.

**v1 ilk-gönder üçlüsü** (kanıtı en güçlü): vol-ölçekli boyutlama + kapalı-bar anti-wick giriş + hacim/volatilite
çift teyidi. MTF, relative-strength, MACD/RSI, ORB → flag arkasında, OOS'ta hak edene kadar kapalı. ~18 yeni
anahtar muhafazakâr varsayılan + yalnız offline sweep (`optimizer_enabled: 0`).

**6 yeni:** `avci-breakout-confluence` (Donchian+ADX+ROC+RVOL sert kapı) · `avci-volume-volatility-confirmation`
(anti-fakeout) · `avci-volatility-position-sizing` (Barroso/Daniel-Moskowitz vol-target, ilk gönder) ·
`avci-taker-entry-slippage-guard` (taker istisnası + çıkış-slippage) · `avci-regime-timing-standdown`
(momentum-crash veto) · `avci-signal-validation-rollout` (Gate-0 + kademeli açılım).
**5 güncelleme (avci-profile):** `strategy-development`, `atr-adaptive-exits` (0.8% callback→Chandelier),
`fleet-coordination` (2-slot korelasyon kapağı), `entry-guards-cooldown`, `backtesting-engine`
(avg_win/avg_loss/expectancy/payoff birinci-sınıf çıktı).

**Avcı kaynakçası (81 doğrulanmış · seçki):**
- **Sinyal/indikatör:** Donchian (LuxAlgo), ADX/ROC/RVOL (StockCharts), Turtle System, MTF (QuantPedia) — https://www.tradingblox.com/Manuals/UsersGuideHTML/turtlesystem.htm · https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx
- **Anti-fakeout/squeeze:** TTM Squeeze (StockCharts), BB/KC (TrendSpider), False-breakout (FXNX/LuxAlgo) — https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/ttm-squeeze · https://fxnx.com/en/blog/7-ways-avoid-false-breakouts-stop-being-market-liquidity
- **Momentum-crash & vol-target:** Daniel-Moskowitz (NBER w20439), Barroso-Santa-Clara (SSRN 2041429), Man Group, Alpha Architect — https://www.nber.org/system/files/working_papers/w20439/w20439.pdf · https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2041429 · https://www.man.com/insights/the-impact-of-volatility-targeting
- **Kripto momentum:** Han/Kang/Ryu (SSRN 4675565), BTC intraday (Reading), tea-time (Springer) — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4675565
- **Yürütme/mikroyapı:** Bybit create-order/slippageTolerance, Chase Order, Make-or-Take LOB (arXiv 2502.18625), Maker-vs-Taker (BloFin) — https://bybit-exchange.github.io/docs/v5/order/create-order · https://arxiv.org/html/2502.18625v1
- **Boyutlama/piramit:** Pyramiding (QuantStrategy), Anti-Martingale (FXOpen), Turtle sizing (QuantifiedStrategies) — https://quantstrategy.io/blog/the-mathematics-of-pyramiding-calculating-position-sizes/
- **Çıkış:** Chandelier (StockCharts), Bybit Trailing Stop — https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/chandelier-exit · https://bybit-exchange.github.io/docs/v5/position/trading-stop
- **Doğrulama:** Deflated Sharpe (Bailey-LdP SSRN 2460551), Walk-forward, Win-rate vs R:R (LuxAlgo) — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551 · https://en.wikipedia.org/wiki/Walk_forward_optimization
- ⚠️ Doğrulanacak: arXiv `2605.04004` (%80.7 stop-out) ve `2503.08692` (pump-dump) — ID desenleri cutoff'a yakın; dayanak yapılmadan teyit edilmeli.

**Açık sorular (bloklayıcı dahil):** L1 %34'ün payoff'u (Gate-0); `profit_add_step_pct`/`layer_trigger_type`
ve ~18 yeni anahtarın birimi; kline turnover(USDT) vs volume(base); MTF+OI+funding taramasının rate-limit
bütçesine sığması; 2-slot korelasyon/beta veri kaynağı.

**Paylaşılabilir rapor (artifact):** https://claude.ai/code/artifact/dd0bf88e-835e-4d3d-80b3-4c10c30c70b0

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

### H · SkyPower V3 strateji kaynakları (grup H)
- **Evren & likidite:** Amihud illiquidity (Ødegaard notes; paperswithbacktest) · QuantPedia wash-trading · Coinbase market-impact · Bybit orderbook/instruments/open-interest — https://bybit-exchange.github.io/docs/v5/market/orderbook · https://bybit-exchange.github.io/docs/v5/market/instrument · https://bybit-exchange.github.io/docs/v5/market/open-interest
- **Rejim & trend:** StockCharts Percent-Above-MA (breadth) · TradingView EMA · StockCharts ATR/ATRP · Man Group — Trend Following: Crisis Alpha — https://www.man.com/insights/trend-following-equity-and-bond-crisis-alpha
- **Maker/maliyet:** Bybit Fee Structure — https://www.bybit.com/en/help-center/article/Trading-Fee-Structure · Get Fee Rate — https://bybit-exchange.github.io/docs/v5/account/fee-rate · Create Order (PostOnly/TIF/stopLoss/slippageToleranceType) — https://bybit-exchange.github.io/docs/v5/order/create-order · LuxAlgo win-rate/RR
- **ATR/Chandelier çıkış:** StockCharts Chandelier Exit — https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/chandelier-exit · StratBase ATR trailing · LuxAlgo/AlphaEx/ChartMill ATR stop+sizing · Bybit Set Trading Stop — https://bybit-exchange.github.io/docs/v5/position/trading-stop
- **Doğrulama:** Deflated Sharpe Ratio (Wikipedia; Bailey & López de Prado SSRN) — https://en.wikipedia.org/wiki/Deflated_sharpe_ratio · PBO (SSRN) · Walk-forward (StratBase/QuantInsti) · Profit factor (QuantifiedStrategies) · CoinAPI execution-quality/slippage
- **Delta-nötr (Safra):** BIS Working Paper 1087 (Crypto Carry) — https://www.bis.org/publ/work1087.htm · BloFin delta-neutral · Talos multi-leg slippage · Bybit Batch Place Order — https://bybit-exchange.github.io/docs/v5/order/batch-place · Funding History — https://bybit-exchange.github.io/docs/v5/market/history-fund-rate
- **Filo koordinasyonu:** MySQL 8 Locking Functions (GET_LOCK) — https://dev.mysql.com/doc/refman/8.0/en/locking-functions.html · Locking Reads (FOR UPDATE) — https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html · Drizzle transactions — https://orm.drizzle.team/docs/transactions

---

## 7. Sabahki session için notlar

- Katalog eksiksiz (**32/32 skill**, TypeScript/Bun; 8'i SkyPower V3'e özel) ve `claude/crypto-trading-ai-skills-8juz86` dalına push edildi.
- **SkyPower V3 için sonraki adım:** Faz A becerilerini gerçek repoda uygula (Kayıkçı önce; çoğu config-only + core [KOD]: sembol kilidi, ATR-stop hesaplayıcı, reentrancy guard, borsa-stop entegrasyonu). Her rol `strategy-validation-protocol` çıtasını geçmeden canlıya çıkmaz.
- Sonraki adım önerileri:
  1. **Repoyu ekleyip birebir hizalama:** Gerçek dosya/tablo/paket adlarını (`packages/*`, gerçek tablo şeması)
     okuyup skill'lerdeki örnek isimleri koda tam uydurma.
  2. **`.agents/rules/` ekleme:** Pasif kurallar (ör. "canlı emir yalnız risk checklist + reconcile geçtiyse";
     "yeni karar mantığı yalnız `packages/` saf çekirdeğinde").
  3. **Bybit motoru refactor'ı:** `pure-core-dirty-shell` skill'ini rehber alarak inline kopyayı saf çekirdeğe taşıma.
  4. **Antigravity'de deneme:** `.agents/skills/` altını yükleyip tetikleyicilerin doğru çalıştığını gözlemleme.
