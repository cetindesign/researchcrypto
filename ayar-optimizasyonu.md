# ENDtrader V4 — Ayar Optimizasyon Sayfası

> Kaynak: 14 Tem 2026 canlı işlem raporu (23 işlem, %13 win, net −$16.08) + sistem
> dokümanları. Amaç: (1) piyasaya göre dinamik coin seçimi, (2) takılmayan rejim,
> (3) 14 Tem'de bulunan problemlerin çözümü. **Backtest yapılmadan**, veriye dayalı
> gerekçeli başlangıç konfigürasyonu — küçük boyutta uygulanıp win-rate izlenmeli.

## ⚠️ Dürüst tavan (önce oku)
Doküman §12 backtesti: **gevşek SOP'ta bile negatif** (K1+K2 kapalı = 159 işlem / −%60.9).
14 Tem de bunu doğruladı: filtreler açılınca ham stratejilerin **zayıf/negatif edge'i** ortaya
çıktı. Yani **filtreler = edge'in kendisiydi.** Sonuç: aşağıdaki ayarlar "kaybetmeyi durduran"
kaliteyi geri yükler, ama **hiçbir ayar negatif bir ham edge'i pozitife çeviremez.** Win-rate
~1-2 haftada **%40+**'a çıkmazsa sorun ayar değil, ham stratejilerin kendisidir (rework gerekir).

---

## A. Rejim — "takılı kalmayı" çöz  ⭐ ana lever

| Kolon | Şimdi | Öneri | Neden |
|---|---|---|---|
| `regime_selection_mode` | auto | **coin_specific** | Global tek-rejim yerine **coin başına Hurst** (15m/60): yükselen coin trend (long), yatay coin MR. 14 Tem'de rallide UNI'yi MR-short'lamak yerine trend-long yapardı. Rejim tek yerde takılmaz. |
| `adx_threshold` | 20 | 20 (aynı) | coin_specific'te Hurst kullanılır; global kaos eşiği için kalsın. |

---

## B. Sinyal kalitesi — %13 win'in kök nedeni (Katman-2'yi geri aç)

14 Tem'de her girişte **"MSS Bypass + Divergence Bypass + RS Kapalı"** vardı = Katman-2 fiilen
devre dışı → çöp sinyaller. Geri sıkılaştır (ama %100 katıya değil, o 0-işlem veriyordu):

| Kolon | Şimdi | Öneri | Neden |
|---|---|---|---|
| `strategy_params.meanReversion.divergenceEnabled` | false | **true** | MR girişlerine RSI-divergence tetiği geri gelir; üst-bant short'u "gerçek tepe" ister. |
| `rs_check_enabled` | false | **true** | Çift görev: (a) kalite filtresi, (b) **rallide short'u doğal bastırır** — short için coin BTC'den zayıf olmalı; her şey yükselirken bu nadir. Dinamik yön adaptasyonunun config-seviyesi karşılığı. |
| `strategy_params.trendFollowing.mssEnabled` | true (ama düşüyor) | **true** — ⚠️ önce KOD | §14.1: `mssEnabled` zod'da yok → panelden true yapılsa bile kayıtta **sessizce düşer.** Tek-satır zod fix'i yapılmadan bu ayar etkisiz. |

---

## C. Churn — momentum-exit + cooldown (14 Tem'in en görünür deseni)

7 işlem girişten **60-90 sn** sonra kapandı; aynı sembole dakikalar içinde 2-4 tekrar giriş.

| Kolon | Şimdi | Öneri | Neden |
|---|---|---|---|
| `momentum_exit_enabled` | true | **false** | Giriş ve çıkış tetiği neredeyse aynı anda ateşliyor (makas daralması). Kapatınca trend işlemleri EMA9/21 karşıt-kesişim + stop ile çıkar. (Gerçek fix: min-hold süresi — kod.) |
| `cooldown_minutes` | 0 | **90** | 0 iken cooldown fiilen KAPALI. 90 dk → bir sembol zararla kapanınca 90 dk bekler; "T'de 9 dakikada 4 giriş" churn'ünü keser. |
| `cooldown_loss_trigger` | 1 | 1 (aynı) | Son 1 kapanış zararsa cooldown başlat — yeter. |

---

## D. Maruziyet & risk — edge kanıtlanana kadar küçült

| Kolon | Şimdi | Öneri | Neden |
|---|---|---|---|
| `max_positions` | 5 | **2** | Hem churn sayısını hem eşzamanlı korele maruziyeti sınırlar (portföy körlüğü, §10.2). |
| `leverage` | 10 | **5** | İşlem başı salınımı yarıya indirir; edge belirsizken sermaye korunur. |
| `daily_loss_limit_pct` | 2 | **1.5** | Günlük zarar backstop'unu sıkılaştır (14 Tem −%3.2 idi). |
| Risk-kilidi bypass | — | **KULLANMA** | 14 Tem: 19:25 kilit tetiklendi → bypass → 4 yeni giriş, **4'ü de zarar (−$18)**. Kilit tam bunu engelliyordu. `risk_lock_bypass_at`'i o gün için set etme. |
| `consecutive_loss_limit` | 2 | 2 (aynı) | Çalıştı; dokunma. |

---

## E. Evren temizliği — altın & mikrocap

14 Tem logunda **XAUT (altın)** işlem gördü (bilinen sorun #10) + BILL/LAB/BSB/T($0.005) gibi mikrocap'ler.

| Kolon | Şimdi | Öneri | Neden |
|---|---|---|---|
| `scan_volume_limit` | 50M | **100M** | Mikrocap kuyruğunu (BILL/LAB/BSB/T) süzer; likit majör/mid'lere odaklar. |
| `skypower_blacklist` | — | **+= XAUT, XAUUSD** | Kripto-dışı altın enstrümanını evrenden çıkar (kalıcı fix `isNonCrypto` gate — kod). |

---

## F. Config tek başına YETMEZ — önce kod fix'i gerekenler

| Değişiklik | Neden config yetmez |
|---|---|
| `mssEnabled` zod'a ekle (§14.1) | Eklenmezse B'deki `mssEnabled=true` kaydedilemez. |
| Momentum-exit **min-hold** (ör. giriş sonrası ilk N dk çıkma) | Churn'ün gerçek fix'i; `momentum_exit_enabled=false` geçici çözüm. |
| `isNonCrypto` gate (altın/kripto-dışı) | Blacklist elle; kalıcı otomatik filtre kod ister. |
| `computeMarketBias` + `reviewOpenPositions` (bu repodaki modüller) | Dinamik yön kapısı + açık-kitap yeniden-gerekçe (rejim-flip / MR karşıt-tez / haber). Config'te tam karşılığı yok; `rs_check=true` yalnız yaklaşık. |

---

## G. İkincil / opsiyonel (izle, aceleci olma)

- `take_profit_pct` 5 → düşünülebilir 3: mevcut uzak TP (%5 fiyat = %50 ROE @10x) nadiren doluyor;
  14 Tem'de tek TP tüm günü taşıdı. Daha yakın TP hit oranını artırır — ama önce kalite (B) düzelmeli.
- `ai_selection_enabled`: kapalı kalsın (opaklık; deterministik kalması iyi).
- `stale_minutes` 300 / `stale_roe_threshold` 5: dokunma, tutarlı çalışıyor.

---

## Uygulama sırası
1. **Kod fix'leri** (F): mssEnabled zod + (istenirse) min-hold, isNonCrypto.
2. **Panel ayarları** (A–E): coin_specific · divergence+RS açık · momentum-exit kapalı · cooldown 90 · max_pos 2 · lev 5 · scan 100M · gold blacklist.
3. **Küçük boyutta** tek hesapta aç, **win-rate + churn**'ü ~1-2 hafta izle.
4. Win-rate %40'a çıkmıyorsa → ayar değil, ham strateji rework'ü.
