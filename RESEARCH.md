# RESEARCH.md — Araştırma Özeti ve Kaynakça (TR)

Bu doküman, **Bybit üzerinde Python öncelikli bir çoklu-bot (multibot) kripto trading platformu**
geliştirirken bir yapay zeka aracının (**Google Antigravity**) kullanacağı **Agent Skills** kataloğunun
araştırma notlarını, tasarım kararlarını ve tam kaynakçasını içerir.

---

## 1. Amaç ve kapsam

Hedef: Platformu *geliştiren* AI ajanına domain uzmanlığı kazandıran, açık `SKILL.md` formatında
skill dosyaları üretmek. Bunlar platformun runtime botları değil; kod yazan ajanın "ne zaman hangi
bilgiyi yükleyeceğini" bilmesini sağlayan bilgi paketleridir.

Sabit kısıtlar:
- **Borsa:** Bybit V5 (Unified Trading Account) — REST + WebSocket, `pybit` ve CCXT/CCXT Pro.
- **Dil/stack:** Python öncelikli (FastAPI, pandas, asyncio, pydantic).
- **Format:** Yalnızca dokümantasyon — inline kod snippet'leri var, ayrı `scripts/`/`assets/` yok.
- **Çıktı yeri:** `.agents/skills/<skill>/SKILL.md` (Antigravity proje kapsamı).

**Sonuç:** 22 skill / 7 kategori, her biri trigger-yüklü `description` + "ne zaman kullanılır" +
core concepts + Bybit/Python özellikleri + checklist + Do/Don't + tuzaklar + kod pattern'leri +
doğrulanmış **References** bölümü. Toplam **~198 benzersiz kaynak linki**.

## 2. Google Antigravity skill formatı (araştırma bulgusu)

Antigravity, Anthropic'in başlattığı **Agent Skills açık standardını** benimsiyor; format Claude Code
ile birebir aynı:
- Skill = klasör + zorunlu `SKILL.md` (YAML frontmatter: `name`, `description`) + opsiyonel
  `references/`, `scripts/`, `assets/`.
- **Proje kapsamı:** `<proje-kök>/.agents/skills/` · **Global kapsam:** `~/.gemini/config/skills/`.
- Ayrıca `AGENTS.md` (ajan/rol tanımları) ve `.agents/rules/` (pasif kurallar), global `GEMINI.md`.
- `description` alanı skill'in tetiklenme anahtarıdır — bu yüzden her skill'de anahtar kelimelerle
  doldurulmuştur.

Kaynaklar:
- Agent Skills in Antigravity — https://antigravity.google/docs/skills
- Authoring Google Antigravity Skills (Codelab) — https://codelabs.developers.google.com/getting-started-with-antigravity-skills
- Autonomous pipelines with agents.md & skills.md (Codelab) — https://codelabs.developers.google.com/autonomous-ai-developer-pipelines-antigravity
- Getting Started with Google Antigravity (Codelab) — https://codelabs.developers.google.com/getting-started-google-antigravity

## 3. Metodoloji

1. **Fan-out araştırma:** 22 skill, 7 paralel araştırma ajanına bölündü. Her ajan kendi domain'i için
   canlı web araması yaptı, resmi kaynakları önceledi.
2. **Doğrulama:** Linkler arama sonuçlarına karşı teyit edildi. Bybit dokümantasyon sitesi
   (`bybit-exchange.github.io`) bir JS SPA olduğu ve bot-fetch'e 403 döndüğü için sayfa gövdeleri arama
   snippet'leriyle doğrulandı; derin path'ler standart `/docs/v5/...` şemasına göre kullanıldı.
3. **Sentez:** Her skill ortak bir şablona göre yazıldı; tutarlı bölüm sırası ve İngilizce gövde.
4. **Birleştirme:** README (indeks), AGENTS.md (roller) ve bu doküman (özet + kaynakça) üretildi.

## 4. Öne çıkan tasarım kararları / tuzaklar

- **Sermaye güvenliği:** Canlıdan önce testnet/demo; API anahtarlarında **withdraw kapalı + IP
  whitelist zorunlu**; global **kill switch**; canlıya geçmeden parametre doğrulama.
- **Look-ahead / veri sızıntısı yok:** Backtesting, strateji ve ML skill'lerinde zorunlu kılındı
  (next-bar fill, purged K-fold + embargo, triple-barrier labeling).
- **Idempotency:** `orderLinkId` (≤36 karakter) ve `Idempotency-Key` ile retry'lerde çift emir önleme.
- **Bybit özgü gerçekler:** WS 20s ping / 10dk idle cutoff; kline dizi sırası `[start,open,high,low,
  close,volume,turnover]` ve en yeni-önce, 1000 satır limiti; private WS auth `"GET/realtime"+expires`;
  HTTP 403 = 10dk IP ban; demo trading mainnet tabanlı (~50k USDT seed, private-WS only).

## 5. Kaynakça (kategori bazında)

> Her skill'in kendi `SKILL.md` dosyasının sonunda tam ve doğrulanmış **References** bölümü vardır.
> Aşağıda konsolide edilmiş liste yer alır.

### A · Exchange & Market Data
**Bybit V5 resmi dokümanları**
- Introduction — https://bybit-exchange.github.io/docs/v5/intro
- Integration Guidance (auth/signing) — https://bybit-exchange.github.io/docs/v5/guide
- Rate Limit Rules — https://bybit-exchange.github.io/docs/v5/rate-limit
- Error Codes — https://bybit-exchange.github.io/docs/v5/error
- Get Instruments Info — https://bybit-exchange.github.io/docs/v5/market/instrument
- Get Kline — https://bybit-exchange.github.io/docs/v5/market/kline
- Get Recent Public Trades — https://bybit-exchange.github.io/docs/v5/market/recent-trade
- Get Funding Rate History — https://bybit-exchange.github.io/docs/v5/market/history-fund-rate
- Get Open Interest — https://bybit-exchange.github.io/docs/v5/market/open-interest
- Get Tickers — https://bybit-exchange.github.io/docs/v5/market/tickers
- Get Orderbook — https://bybit-exchange.github.io/docs/v5/market/orderbook
- Get Server Time — https://bybit-exchange.github.io/docs/v5/market/time
- Demo Trading Service — https://bybit-exchange.github.io/docs/v5/demo
- WebSocket Connect — https://bybit-exchange.github.io/docs/v5/ws/connect
- WS Public Orderbook — https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook
- WS Public Trade — https://bybit-exchange.github.io/docs/v5/websocket/public/trade
- WS Public Ticker — https://bybit-exchange.github.io/docs/v5/websocket/public/ticker
- WS Public Kline — https://bybit-exchange.github.io/docs/v5/websocket/public/kline
- WS Private Order — https://bybit-exchange.github.io/docs/v5/websocket/private/order
- WS Private Execution — https://bybit-exchange.github.io/docs/v5/websocket/private/execution

**SDK / kütüphaneler**
- pybit (resmi Python SDK) — https://github.com/bybit-exchange/pybit
- pybit (PyPI) — https://pypi.org/project/pybit/
- pybit v5 WebSocket örnekleri — https://dev.to/kylefoo/pybit-v5-how-to-subscribe-to-websocket-topics-1iem
- CCXT documentation — https://docs.ccxt.com/
- CCXT bybit implementation — https://github.com/ccxt/ccxt/blob/master/python/ccxt/bybit.py
- CCXT Pro manual — https://docs.ccxt.com/ccxt.pro.manual

### B · Trading Logic (strateji / backtest / execution)
- Freqtrade — Strategy Customization — https://www.freqtrade.io/en/stable/strategy-customization/
- Freqtrade — Advanced Strategy — https://www.freqtrade.io/en/stable/strategy-advanced/
- Freqtrade — Lookahead analysis — https://www.freqtrade.io/en/stable/lookahead-analysis/
- Freqtrade — Recursive analysis — https://www.freqtrade.io/en/stable/recursive-analysis/
- Freqtrade — Backtesting — https://www.freqtrade.io/en/stable/backtesting/
- Freqtrade — Hyperopt — https://www.freqtrade.io/en/stable/hyperopt/
- pandas-ta (PyPI) — https://pypi.org/project/pandas-ta/
- pandas-ta docs — https://www.pandas-ta.dev/
- TA-Lib Python docs — https://ta-lib.github.io/ta-lib-python/
- TA-Lib functions — https://ta-lib.github.io/ta-lib-python/funcs.html
- TA-Lib GitHub — https://github.com/TA-Lib/ta-lib-python
- Jesse — https://jesse.trade/ · GitHub — https://github.com/jesse-ai/jesse
- backtesting.py — https://kernc.github.io/backtesting.py/ · API — https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html
- vectorbt — https://vectorbt.dev/ · GitHub — https://github.com/polakowo/vectorbt
- QuantStats — https://github.com/ranaroussi/quantstats
- Bybit V5 — Place/Amend/Cancel Order — https://bybit-exchange.github.io/docs/v5/order/create-order · https://bybit-exchange.github.io/docs/v5/order/amend-order · https://bybit-exchange.github.io/docs/v5/order/cancel-order
- Bybit V5 — Set Trading Stop — https://bybit-exchange.github.io/docs/v5/position/trading-stop
- Bybit V5 — Switch Position Mode — https://bybit-exchange.github.io/docs/v5/position/position-mode
- Bybit V5 — Set Leverage — https://bybit-exchange.github.io/docs/v5/position/leverage
- Bybit V5 — Fee Rate — https://bybit-exchange.github.io/docs/v5/account/fee-rate

### C · Risk & Portfolio
- Bybit — Liquidation Price (Isolated, UTA) — https://www.bybit.com/en/help-center/article/Liquidation-Price-Calculation-under-Isolated-Mode-Unified-Trading-Account
- Bybit — UTA Trading Rules / Liquidation Process — https://www.bybit.com/en/help-center/article/UTA-Trading-Rules
- Bybit — Maintenance Margin (USDT Perp) — https://www.bybit.com/en/help-center/article/Maintenance-Margin-USDT-Contract
- Bybit — Risk Limit — https://www.bybit.com/en/help-center/article/Risk-Limit-Perpetual-and-Futures
- Bybit — Margin Parameters — https://www.bybit.com/en/announcement-info/margin-parameters/
- Bybit — P&L Calculations — https://www.bybit.com/en/help-center/article/Profit-Loss-calculations-USDT-Contract
- Bybit — Funding Fee Calculation — https://www.bybit.com/en/help-center/article/Funding-fee-calculation
- Bybit — Introduction to Funding Rate — https://www.bybit.com/en/help-center/article/Introduction-to-Funding-Rate
- Bybit — Create Sub UID (+ API Key) — https://bybit-exchange.github.io/docs/v5/user/create-subuid · https://bybit-exchange.github.io/docs/v5/user/create-subuid-apikey
- Freqtrade — Protections — https://www.freqtrade.io/en/stable/plugins/ · Stoploss — https://www.freqtrade.io/en/stable/stoploss/
- Kelly Criterion & Position Sizing — https://coriva.eu.org/en/kelly-criterion-position-sizing/
- Modern Portfolio Theory (CFI) — https://corporatefinanceinstitute.com/resources/career-map/sell-side/capital-markets/modern-portfolio-theory-mpt/
- Hummingbot docs — https://hummingbot.org/docs/ · Hummingbot API — https://github.com/hummingbot/hummingbot-api
- Celery vs ARQ — https://leapcell.io/blog/celery-versus-arq-choosing-the-right-task-queue-for-python-applications
- Concurrency: multiprocessing vs asyncio — https://testdriven.io/blog/concurrency-parallelism-asyncio/

### D · Config & Data Infra
- Pydantic — Settings Management — https://docs.pydantic.dev/latest/concepts/pydantic_settings/
- Pydantic — Migration Guide — https://docs.pydantic.dev/latest/migration/ · Validators — https://docs.pydantic.dev/latest/concepts/validators/ · Models — https://docs.pydantic.dev/latest/concepts/models/
- TimescaleDB (GitHub) — https://github.com/timescale/timescaledb
- Continuous aggregates — https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates
- PostgreSQL Numeric Types — https://www.postgresql.org/docs/current/datatype-numeric.html
- Working with Money in Postgres (Crunchy) — https://www.crunchydata.com/blog/working-with-money-in-postgres
- InfluxDB vs TimescaleDB — https://www.influxdata.com/comparison/influxdb-vs-timescaledb/
- InfluxDB vs TimescaleDB vs QuestDB — https://questdb.com/blog/comparing-influxdb-timescaledb-questdb-time-series-databases/
- Redis Streams — https://redis.io/docs/latest/develop/data-types/streams/ (XREADGROUP / XACK / XPENDING)
- Apache Kafka docs — https://kafka.apache.org/documentation/ · Exactly-once (Confluent) — https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/
- NATS JetStream Consumers — https://docs.nats.io/nats-concepts/jetstream/consumers · Compare NATS — https://docs.nats.io/nats-concepts/overview/compare-nats

### E · Backend, UI & Keys
- FastAPI — https://fastapi.tiangolo.com/ · OAuth2 scopes — https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/ · WebSockets — https://fastapi.tiangolo.com/advanced/websockets/ · Background Tasks — https://fastapi.tiangolo.com/tutorial/background-tasks/
- Uvicorn — https://www.uvicorn.org/ · slowapi — https://github.com/laurentS/slowapi · structlog — https://www.structlog.org/en/stable/
- Securing FastAPI with JWT (TestDriven) — https://testdriven.io/blog/fastapi-jwt-auth/
- Auth & AuthZ with FastAPI (Better Stack) — https://betterstack.com/community/guides/scaling-python/authentication-fastapi/
- TradingView Lightweight Charts — https://tradingview.github.io/lightweight-charts/docs · Series types — https://tradingview.github.io/lightweight-charts/docs/series-types · Markers — https://tradingview.github.io/lightweight-charts/tutorials/how_to/series-markers · Realtime demo — https://tradingview.github.io/lightweight-charts/tutorials/demos/realtime-updates · API — https://tradingview.github.io/lightweight-charts/docs/api · GitHub — https://github.com/tradingview/lightweight-charts
- Bybit — Create/Modify/Info API Key — https://bybit-exchange.github.io/docs/v5/user/create-subuid-apikey · https://bybit-exchange.github.io/docs/v5/user/modify-master-apikey · https://bybit-exchange.github.io/docs/v5/user/apikey-info
- Bybit Help — Create API Key — https://www.bybit.com/en/help-center/article/How-to-create-your-API-key
- cryptography — Fernet — https://cryptography.io/en/stable/fernet/
- HashiCorp Vault — Transit — https://developer.hashicorp.com/vault/docs/secrets/transit
- OWASP — Secrets Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

### F · Security, Monitoring & Testing
- OWASP Top 10:2021 — https://owasp.org/Top10/2021/ · API Security Top 10 — https://owasp.org/API-Security/ · ASVS — https://owasp.org/www-project-application-security-verification-standard/ (GitHub — https://github.com/OWASP/ASVS)
- PyOTP — https://github.com/pyauth/pyotp · docs — https://pyauth.github.io/pyotp/
- pip-audit — https://github.com/pypa/pip-audit · PyPI — https://pypi.org/project/pip-audit/
- Securing the Python Supply Chain — https://bernat.tech/posts/securing-python-supply-chain/
- Idempotency (Google Cloud) — https://cloud.google.com/discover/idempotency
- Prometheus client_python — https://github.com/prometheus/client_python · Metric types — https://prometheus.io/docs/concepts/metric_types/ · Alerting rules — https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/
- prometheus-fastapi-instrumentator — https://github.com/trallnag/prometheus-fastapi-instrumentator
- Grafana — Alertmanager — https://grafana.com/docs/grafana/latest/alerting/set-up/configure-alertmanager/ · Alert rules — https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/
- OpenTelemetry Python — https://opentelemetry.io/docs/languages/python/ (Instrumentation — https://opentelemetry.io/docs/languages/python/instrumentation/)
- Google SRE — SLOs — https://sre.google/sre-book/service-level-objectives/ · Alerting on SLOs — https://sre.google/workbook/alerting-on-slos/ · Error Budget Policy — https://sre.google/workbook/error-budget-policy/
- Bybit — Request Test Coins on Testnet — https://www.bybit.com/en/help-center/article/How-to-Request-Test-Coins-on-Testnet
- pytest — https://docs.pytest.org/en/stable/ · pytest-asyncio — https://pytest-asyncio.readthedocs.io/en/latest/
- Hypothesis — https://hypothesis.readthedocs.io/en/latest/ · responses — https://github.com/getsentry/responses · respx — https://lundberg.github.io/respx/ · freezegun — https://github.com/spulec/freezegun
- Freqtrade — Bot basics (dry-run vs live) — https://www.freqtrade.io/en/stable/bot-basics/

### G · DevOps & AI
- Docker — Dockerfile reference — https://docs.docker.com/reference/dockerfile/ · Compose secrets — https://docs.docker.com/compose/how-tos/use-secrets/ · container stop — https://docs.docker.com/reference/cli/docker/container/stop/
- Kubernetes — Pod termination — https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination · Coordinated Leader Election — https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/ · Leader election blog — https://kubernetes.io/blog/2016/01/simple-leader-election-with-kubernetes/
- systemd.service — https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html · chrony/NTP — https://chrony-project.org/documentation.html
- Redis distributed locks (Redlock) — https://redis.io/docs/latest/develop/use/patterns/distributed-locks/
- Advances in Financial ML — López de Prado (Wiley) — https://www.wiley.com/en-us/Advances+in+Financial+Machine+Learning-p-9781119482086 · Ch.3 Labeling — https://www.oreilly.com/library/view/advances-in-financial/9781119482086/c03.xhtml
- Purged cross-validation (Wikipedia) — https://en.wikipedia.org/wiki/Purged_cross-validation
- The 10 Reasons Most ML Funds Fail (GARP) — https://www.garp.org/hubfs/Whitepapers/a1Z1W0000054x6lUAA.pdf
- mlfinlab — https://www.mlfinlab.com/
- scikit-learn — TimeSeriesSplit — https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html · Cross-validation — https://scikit-learn.org/stable/modules/cross_validation.html
- FreqAI — Intro — https://www.freqtrade.io/en/stable/freqai/ · Feature engineering — https://www.freqtrade.io/en/stable/freqai-feature-engineering/ · Parameters — https://www.freqtrade.io/en/stable/freqai-parameter-table/
- Bybit — Long/Short Ratio — https://bybit-exchange.github.io/docs/v5/market/long-short-ratio
- VADER Sentiment — https://github.com/cjhutto/vaderSentiment · FinBERT (ProsusAI) — https://huggingface.co/ProsusAI/finbert · Transformers pipelines — https://huggingface.co/docs/transformers/main_classes/pipelines
- PRAW (Reddit) — https://praw.readthedocs.io/ · X API v2 — https://developer.x.com/en/docs/x-api · CryptoPanic API — https://cryptopanic.com/developers/api/
- Glassnode — Metric Catalog — https://docs.glassnode.com/data/metric-catalog · Indicators — https://docs.glassnode.com/basic-api/endpoints/indicators
- Claude — Tool use overview — https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview · Implement tool use — https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use · Structured outputs — https://platform.claude.com/docs/en/build-with-claude/structured-outputs · Prompt caching — https://platform.claude.com/docs/en/build-with-claude/prompt-caching · Advanced tool use — https://www.anthropic.com/engineering/advanced-tool-use
- OpenAI — Function calling — https://platform.openai.com/docs/guides/function-calling · Structured Outputs — https://platform.openai.com/docs/guides/structured-outputs
- OWASP Top 10 for LLM Applications — https://owasp.org/www-project-top-10-for-large-language-model-applications/

---

## 6. Sabahki session için notlar

- Katalog eksiksiz (22/22 skill) ve `claude/crypto-trading-ai-skills-8juz86` dalına push edildi.
- Sonraki adımlar için öneriler:
  1. **Derin link doğrulama:** Bazı Bybit derin path'leri arama snippet'leriyle teyit edildi; canlı
     WebFetch ile tek tek doğrulanabilir.
  2. **`.agents/rules/` ekleme:** Platforma özel pasif kurallar (ör. "canlı emir yalnızca risk-management
     checklist geçtiyse").
  3. **İkinci tur derinleştirme:** İstenen skill'lere `references/` alt-dokümanları veya örnek şablonlar
     eklenebilir.
  4. **Skill'leri gerçek repoda deneme:** Antigravity'de `.agents/skills/` altına koyup tetikleyicilerin
     doğru çalıştığını gözlemleme.
