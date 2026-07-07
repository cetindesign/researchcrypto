# SkyPower V3 — Master Rehber

> **Ne bu belge?** Şimdiye kadar birlikte ürettiğimiz her şeyin (sistem, 38-beceri kataloğu, SkyPower V3
> stratejisi, 🎯 Avcı rolü araştırması, botun kök-neden analizi, kanıtlı çözümler ve — en önemlisi —
> **yapay zekayı nasıl yönetmeli**) tek yerde, insan için yazılmış özeti. Amaç: **Avcı botunu, AI'nın yanıltma
> riskini kontrol ederek geliştirmek.**
>
> **İki okuyucu var, karıştırma:** Bu belge **insan-facing**'dir (sen, ortak, ekip okur). Antigravity'nin
> otomatik uyduğu makine kuralları ayrıdır (`.agents/rules/`, `AGENTS.md`, `SKILL.md`) ve sonraki adımda yazılır.

**Depo:** `cetindesign/researchcrypto` · **Dal:** `claude/crypto-trading-ai-skills-8juz86`

---

## İçindekiler
1. [Sistem bir bakışta](#1-sistem-bir-bakışta)
2. [38-beceri kataloğu haritası](#2-38-beceri-kataloğu-haritası)
3. [SkyPower V3 stratejisi özeti](#3-skypower-v3-stratejisi-özeti)
4. [🎯 Avcı rolü — derinlemesine](#4--avcı-rolü--derinlemesine)
5. [Botun mevcut durumu (kök-neden analizi)](#5-botun-mevcut-durumu-kök-neden-analizi)
6. [Çözümler — başkaları nasıl çözmüş](#6-çözümler--başkaları-nasıl-çözmüş)
7. [⭐ Yapay zekayı nasıl yönetmeli (en kritik bölüm)](#7--yapay-zekayı-nasıl-yönetmeli-en-kritik-bölüm)
8. [Yol haritası](#8-yol-haritası)
9. [Sonraki adım: makine kuralları](#9-sonraki-adım-makine-kuralları)
10. [Kaynakça](#10-kaynakça)

---

## 1. Sistem bir bakışta

| | |
|---|---|
| **Dil / runtime** | TypeScript (strict) · Bun |
| **Repo** | Turborepo monorepo (`apps/` + `packages/`) |
| **HTTP / API** | Hono · tRPC v11 |
| **Veritabanı** | MySQL · Drizzle ORM (migration yok, idempotent `ensure-schema`) |
| **Arayüz** | React 19 · Vite · TanStack · Tailwind v4 |
| **Borsa** | Bybit V5 USDⓈ-M perp — imzalı REST, **polling (WebSocket yok)** |
| **Çalışma şekli** | Tek süreç: API/UI + **6 arka plan döngüsü** |
| **Dış** | Google Gemini (haber), Telegram (uyarı), Dokploy (deploy) |

**6 döngü:** `ensureSchema → collector → v3 Bybit motoru (10sn) → optimizer (2sa) → takvim scraper (15dk) → haber scraper (3dk)`

**Filo (4 rol):** 🎯 **Avcı** (momentum/breakout) · 🚣 **Kayıkçı** (breadth/trend) · 🔭 **Bulucu** (sermayesiz seçici/servis) · ⚓ **Safra** (delta-nötr funding).

**Mimari ilkeler:** saf çekirdek / kirli kabuk · borsa = tek gerçek, DB = defter (reconcile) · polling · idempotency (`orderLinkId`) · audit (`v3_decision_log` / `v3_position_event`).

---

## 2. 38-beceri kataloğu haritası

Antigravity için yazılmış, kod yazan AI'ya domain uzmanlığı veren `SKILL.md` dosyaları. 10 grup:

| Grup | Ne kapsar |
|---|---|
| ⌂ **Mimari** | pure-core-dirty-shell, monorepo-turborepo, reconcile-source-of-truth |
| A · **Borsa & Veri** | exchange-integration-bybit, market-data-ingestion, rest-polling-and-rate-limits |
| B · **Trading** | strategy-development, backtesting-engine, order-execution-oms |
| C · **Risk & Portföy** | risk-management, portfolio-management |
| D · **Orkestrasyon & Veri** | bot-orchestration, strategy-config-management, mysql-drizzle-data-layer |
| E · **Backend/UI/Anahtar** | backend-api-service, realtime-trading-dashboard, api-key-secrets-security |
| F · **Güvenlik/İzleme/Test** | trading-app-security, monitoring-observability, testing-paper-trading |
| G · **DevOps & AI** | deployment-devops-ha, parameter-optimizer, sentiment-news-signals, gemini-ai-integration |
| H · **SkyPower V3 (strateji)** | coin-universe-selection, regime-detection, maker-execution-cost-control, atr-adaptive-exits, entry-guards-cooldown, fleet-coordination, strategy-validation-protocol, market-neutral-funding |
| I · **🎯 Avcı (momentum)** | avci-breakout-confluence, avci-volume-volatility-confirmation, avci-volatility-position-sizing, avci-taker-entry-slippage-guard, avci-regime-timing-standdown, avci-signal-validation-rollout |

Tamamı: [`.agents/skills/`](../.agents/skills/) · İndeks: [`README.md`](../README.md) · Roller: [`AGENTS.md`](../AGENTS.md)

---

## 3. SkyPower V3 stratejisi özeti

- **İki-katmanlı evren:** Tier-A (Kayıkçı, ≥$100M hacim, ≤%0.05 spread, ≥$250k derinlik…) / Tier-B (Avcı, ≥$10-20M…). "Geniş tara, az aç."
- **Maliyet mimarisi (#1 sorun):** Bybit taker %0.055 / maker %0.02; küçük pozisyonda maliyet eşiği yutuyor. Çözüm üçlüsü: maker/post-only giriş, Tier-A likidite, daha uzun ufuk.
- **Adaptif çıkış:** borsa felaket-stop (≈3×ATR) + yazılım stop (1.5-2×ATR) + Chandelier trailing.
- **Rejim pusulası:** BTC çıpası + breadth + funding/OI; 2/3 kuralı → long/short/nötr.
- **Kanıt disiplini:** maliyet-farkında backtest → walk-forward → hold-out → DSR → ≥300 işlem / PF≥1.3 → mainnet mikro-pilot → −%10 kill.

---

## 4. 🎯 Avcı rolü — derinlemesine

**Rol:** momentum/breakout; 1-3 pozisyon; yüksek eşik; taker breakout'ta kabul; yalnız azalan kâr-piramidi (≤0.7); DCA kapalı. Filo sermayesinin %10-15'i — en agresif, en az kanıtlı.

### ⚠️ Araştırmanın başlık bulgusu (kritik ajanı)
**%34 kazanma oranı breakout sistemleri için NORMALDİR.** Para pozitif çarpıklıktan gelir (birkaç büyük kazanan çok sayıda küçük kaybedeni öder). Filtre yığıp %34'ü yükseltmek sağ kuyruğu (büyük kazananları) budar; asıl kaldıraçlar **payoff oranı (avg_win/avg_loss)** ve **ince Tier-B coinlerde çıkış slippage'i**dir — ikisi de hiç ölçülmemiş.

> **Gate-0 (bloklayıcı):** İnşadan önce L1 %34'ün payoff'unu ayrıştır (34%'te başabaş ≈1.94R). Sağlıklıysa suçlu muhtemelen sıkı 0.8% trailing çıkıştır, sinyal değil — o hâlde redesign yanlış sorunu çözer.

### v1 ilk-gönder üçlüsü (kanıtı en güçlü)
1. Volatiliteye-ölçekli boyutlama (Sharpe ~2×, crash'i öldürür)
2. Kapalı-bar anti-wick giriş
3. Hacim + volatilite çift teyidi (VE'lenmiş)

Gerisi (MTF, relative-strength, MACD/RSI, ORB) → flag arkasında, OOS'ta hak edene kadar kapalı.

### 6 yeni + 5 güncelleme
**Yeni (grup I):** `avci-breakout-confluence` · `avci-volume-volatility-confirmation` · `avci-volatility-position-sizing` · `avci-taker-entry-slippage-guard` · `avci-regime-timing-standdown` · `avci-signal-validation-rollout`.
**Güncelleme:** strategy-development, atr-adaptive-exits (0.8% callback→Chandelier), fleet-coordination (2-slot korelasyon kapağı), entry-guards-cooldown, backtesting-engine (avg_win/avg_loss/expectancy/payoff çıktısı).

*(Detaylı araştırma: 10 ajan, 81 doğrulanmış kaynak. Rapor artifact'i kaynakçada.)*

---

## 5. Botun mevcut durumu (kök-neden analizi)

İki Bybit hesabında (destek, murcetin1) yapılan yalnızca-okuma incelemesi. **Üç konu:**

| Konu | Kök neden | Durum |
|---|---|---|
| **1. "Ters yön göründü"** | Long'un SL'i reduce-only "Sell" koşullu emri olarak listelenir; pozisyon sanılır. Kayıtlarda ters işlem YOK. | 🟢 Hata değil, algı |
| **2. Çift işlem** | Aynı motor iki ayrı süreçte çalıştı (binance-server çağrısı + ayrı bybit-daemon **veya** deploy sırasında eski+yeni container). Ölçüldü: pencerede kullanıcı başına dk'da 2 equity kaydı → 2 örnek. | 🔴 Kök neden bulundu; şu an tek örnek ama mekanizma duruyor |
| **3. Sürekli zarar** | Momentum-kovalama girişi (fırlamış coini tepeden alma) + dar sabit SL + tekrar-giriş (YFI ×5). Çift-süreç zararı 2×'ledi. | 🟡 Strateji + iki çarpan |

> **⭐ En önemli nüans:** Zarar rakamları (−$119 / −$70, 1/16 kazanma) **çift-süreç bug'ıyla kirlenmiş** (ORDI −22.60×2). Bu veriyle strateji hakkında hüküm verilemez. **Sıra:** önce çift-süreci kalıcı çöz → temiz veri topla → *sonra* stratejiyi yargıla.

---

## 6. Çözümler — başkaları nasıl çözmüş

### Çift bot (Sorun 2) — "aynı anda tek kopya"
1. **Tek-örnek kilidi:** Redis `SET NX` / Redlock / ShedLock / DB satırı (`engine_lock` + heartbeat). Kilidi alan çalışır, diğeri pasifler.
2. **Idempotency key:** her emre benzersiz kimlik → borsa çifti tekler. Bybit'te `orderLinkId`.
3. **Blue-green deploy:** yeni kopya → sağlık kontrolü → geçiş → **eskiyi öldür** (çakışma yok).
4. **Platform kuralı:** hesap başına tek instance.

### Tepeden alma / zarar (Sorun 3) — 5 yöntem
1. **Kovalama yerine kır-ve-geri-test:** seviyeyi kapanışla kır → geri çekilmeyi (retest) bekle → gir. Yanlış kırılımların çoğunu eler.
2. **Sabit % yerine ATR stop:** kripto'da 2.0×ATR ("goldilocks"); sabit %1.5 normal dalgalanmada vurur.
3. **Cooldown + StoplossGuard (Freqtrade):** satıştan sonra çifti kilitle; pencerede N stop → dur. YFI×5'in hazır çözümü.
4. **Kill-switch:** günlük −%5 / toplam −%10 → otomatik dur.
5. **Paper/forward-test + kademeli sermaye:** botların %73'ü 6 ayda batıyor, çoğu forward-test atladığı için.

### Ters görünme (Sorun 1)
Bybit dokümanı doğruluyor: long SL = reduce-only "Sell" — doğru davranış. Çözüm: sadece bildirim netleştirme.

---

## 7. ⭐ Yapay zekayı nasıl yönetmeli (en kritik bölüm)

Şimdiye kadar tüm analizi program içindeki AI asistanına sorarak, önerilerini dinleyerek, ona insan gibi güvenerek yaptık. **Bu doğru mu? Bizi yanıltır mı?** Dürüst cevap: **evet, yanıltma payı gerçek, ölçülmüş ve önemli.** Ama sorun aracı kullanmak değil — ona **karar yetkisini devretmek.**

### Canlı kanıt (bu projeden)
Avcı araştırmasında 8 hevesli ajan %34'ü "hata" sanıp 10 filtre yığmayı önerdi; kulağa bilimsel geliyordu. Sonra **tek bir skeptik ajan** teşhisi çürüttü. **En değerli çıktı, kendinden emin sentez değil, ona itiraz eden eleştiriydi.**

### Neden yanıltır (isimli arıza modları)
1. **Yağcılık (sycophancy):** senin çerçevene katılanı söyler, sorgulamaz.
2. **Güven yanılsaması:** akıcı + spesifik = doğru sanılır; yanlışı bile kendinden emin anlatır.
3. **Otomasyon önyargısı:** insanlar AI'yı bağlam bilgisiyle çelişse bile takip eder.
4. **Kendi verinde temellenmeme:** genel literatürden akıl yürütür; backtest sayısı uydurabilir.
5. **Sohbetle overfitting:** konuşarak ayarlanan her eşik bir serbestlik derecesi = veri gözetleme.
6. **Sahibi/sorumlusu yok:** kaybını hissetmez, P&L'inden öğrenmez, "bilmiyorum" demez.

### Doğru zihinsel model
AI = **yorulmaz, çok okumuş, dahi bir stajyer + kırmızı-takım.** Ondan fikir/kod/eleştiri al (ıraksama); **karar / risk / kill-switch insanda kalsın** (yakınsama). Doğal sohbet sorun değil; **yargı yetkisini devretmek** tuzaktır.

### Yönetim çerçevesi (Avcı hedefine bağlı)
1. **Hakem AI değil, VERİ.** AI önerir; cost-aware backtest → walk-forward → OOS → paper P&L karar verir.
2. **Varsayılan adversarial.** Tek cevaba güvenme; AI'yı kendine karşı savundur.
3. **Rolleri ayır + kriteri önceden yaz** (pre-commit; sonradan rasyonalize edemesin).
4. **Serbestlik derecelerini say ve cezalandır** (DSR); en az-kanıtlı değişikliği gönder (v1 üçlüsü), 20-anahtarlı redesign'ı değil.
5. **Falsifiability:** her iddia için "kendi verimden hangi sonuç bunu çürütür?" — git ölç. Çürütülemiyorsa hikâyedir.
6. **Bağımsız doğrula:** sayı/API/atıf (arXiv ID, config birimi → koddan).
7. **Karar günlüğü:** "AI ne önerdi → gerçekte ne oldu (P&L)"; zamanla güveni veriyle kalibre et.

### Dürüst öz-not
Bu, **bu belgeyi yazan AI'ya da** aynen uygular. 38 beceri, Avcı araştırması — hepsi makul, literatüre dayalı, tutarlı… ve **senin gerçek verinde doğrulanmamış.** Bunları *deploy edilecek gerçekler* değil, **test edilecek hipotezler** olarak al.

### Avcı hedefine tercüme
Amaç "AI'ya kazanan bir bot tasarlatmak" değil — hiçbir AI edge'i OOS kanıt olmadan bilemez. Amaç: **AI'nın hipotez + kod + eleştiri ürettiği, VERİNİN karar verdiği bir süreç.** *AI = laboratuvar asistanı; piyasa = sınavı yapan.*

---

## 8. Yol haritası

1. **P0 — Tek motor kilidi (hemen):** tek süreç + `engine_lock` + "çoklu-örnek" alarmı + blue-green deploy. → çift işlem, 2× zarar, desync biter.
2. **Temiz veri (1-2 hafta):** tek örnekle, dokunmadan çalıştır.
3. **Gate-0:** L1 %34'ün payoff'unu ayrıştır. Sinyal mi çıkış mı sorun, ölç.
4. **P1 strateji (sırayla, her biri backtest'li):** retest girişi → ATR stop → zarar-cooldown/kara-liste → üst-TF yön/standdown. **Tek seferde tek değişiklik.**
5. **Güvenlik ağı:** −%10 kill-switch + kademeli sermaye (%5-10 ile başla).
6. **P2 — bildirim netleştirme:** pozisyon vs güvenlik emri.
7. **Kural:** canlı emir yalnız validation çıtası (PF≥1.3, +EV) geçen config'le; canlı optimizer kapalı.

---

## 9. Sonraki adım: makine kuralları

Bu belge **insan içindir**. Antigravity'nin otomatik uyacağı **makine kuralları** ayrı bir adımda `.agents/rules/` altına yazılacak — örneğin:
- *"Canlı emir yalnız Gate-0 + OOS validation geçtiyse."*
- *"Tek seferde tek değişiklik; serbestlik derecelerini say (DSR)."*
- *"AI çıktısı hipotezdir; hakem veridir — doğrulama olmadan canlı önerme."*
- *"Backtest sayısı uydurma; atıf/birim koddan teyit et."*

> ⚠️ Dürüst uyarı: bu kurallar Antigravity'nin **kod yazan asistanını** bağlar — çalışan botu ya da insanı değil. Ayrıca "beni yanıltma" kuralı kısmen işe yarar; asıl koruma **senin disiplinin + veridir.**

---

## 10. Kaynakça

**AI yönetimi / önyargı:**
- [Aşırı-güvenin bedeli — deneysel çalışma (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S0747563224002206)
- [Automation bias derlemesi (Springer)](https://link.springer.com/article/10.1007/s00146-025-02422-7)
- [İnsanlar AI önyargısını miras alır (Nature)](https://www.nature.com/articles/s41598-023-42384-8)
- [LLM sycophancy — "when helpfulness backfires" (npj Digital Medicine)](https://www.nature.com/articles/s41746-025-02008-z)
- [Sycophancy güvenilirliği nasıl bozar (UNU)](https://c3.unu.edu/blog/how-sycophancy-shapes-the-reliability-of-large-language-models)
- [ChatGPT ile strateji backtest riskleri (QuantPedia)](https://quantpedia.com/hello-chatgpt-can-you-backtest-strategy-for-me/) · [(TradeZella)](https://www.tradezella.com/blog/chatgpt-claude-backtesting)

**Çift bot / tek-örnek:**
- [Distributed Locking rehberi](https://www.architecture-weekly.com/p/distributed-locking-a-practical-guide) · [ShedLock](https://oneuptime.com/blog/post/2026-01-25-distributed-scheduler-shedlock-spring/view)
- [Idempotency = çift işlem önleme (AInvest)](https://www.ainvest.com/news/idempotency-keys-prevent-duplicate-trades-digital-finance-2508/)
- [Blue-Green deploy (Docker/Node)](https://medium.com/@vasanthancomrads/zero-downtime-node-js-deployments-with-blue-green-strategy-in-docker-917e01cbed80)

**Strateji / momentum:**
- [Break-and-Retest (Capital.com)](https://capital.com/en-int/analysis/how-to-trade-the-break-retest)
- [ATR vs sabit % stop (ChartsWatcher)](https://chartswatcher.com/pages/blog/7-advanced-stop-loss-strategies-that-actually-work-in-2025)
- [Freqtrade Protections (Cooldown/StoplossGuard)](https://www.freqtrade.io/en/stable/plugins/)
- [Momentum Crashes — Daniel & Moskowitz (NBER)](https://www.nber.org/system/files/working_papers/w20439/w20439.pdf)
- [Deflated Sharpe (Bailey & López de Prado)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551)
- [Çoğu bot neden kaybeder (For Traders)](https://www.fortraders.com/blog/trading-bots-lose-money)

**Bybit:**
- [Reduce-Only Order](https://www.bybit.com/en/help-center/article/Reduce-Only-Order) · [Place Order (create-order)](https://bybit-exchange.github.io/docs/v5/order/create-order)

---

> **Yasal uyarı:** Bu belge eğitim, araştırma ve sistem-tasarımı amaçlıdır; yatırım/finansal tavsiye değildir
> ve hiçbir stratejinin kârlı olacağını garanti etmez. Kaldıraçlı türevler tüm sermayenin kaybına yol açabilir.
> Rakamlar test/erken-aşama verisindendir ve "çift-süreç" etkisi giderilene kadar kesin değildir. Bu incelemede
> hiçbir ayar/kod değiştirilmemiştir.
