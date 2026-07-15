# ENDtrader V4 — Dinamik Coin Seçimi Tasarımı

> Amaç: Motorun tarama evrenini "hacme göre sırala" ham yaklaşımından çıkarıp,
> **mevcut rejime ve yöne (long/short) göre puanlanmış, SOP'u geçme olasılığı
> yüksek** bir top-N kısa listeye çevirmek.
> Referans kod: [`coin-scorer.ts`](coin-scorer.ts) (saf skorlama çekirdeği, `--selftest` geçer).

---

## 0. Önce dürüst teşhis (dokümanlardan)

- **Kök neden coin seçimi DEĞİL.** V4 dokümanı §12: _"tam SOP = 0 işlem"_ (30 gün, 10 coin).
  K1 kapalı → 8 işlem; K1+K2 kapalı → 159 işlem. Yani botun işlem açmamasının sebebi dar
  evren değil, **SOP v2 filtre yığınının aşırı katı olması.** Dinamik coin seçimi bunu tek
  başına çözmez — ama **SOP'u geçme olasılığı yüksek coinleri öne alarak** taramanın isabetini
  artırır. Kalıcı çözüm: dinamik seçim **+** SOP eşiklerini `run-sop-v4-backtest.ts` ile ölçüp
  ayarlamak (§9).
- **Bu bot SHORT açıyor** (§4). O yüzden **düşüş trendindeki coinler "kaçın" değil, üst-bant
  SHORT adayı.** Coin evreni long-only mean-reversion'dan çok daha geniştir — skorlama bunu
  yön (direction) alanıyla modeller.
- **Global rejim `auto`'da BTC'den geliyor** (§3). BTC şu an yatay + düşük 1H ADX → sistem
  büyük olasılıkla **Mean-Reversion** rejiminde. Seçim mantığı rejimi girdi alır, sabitlemez.

---

## 1. Mimari: nereye girer

Mevcut akış (SOP §11): `... → Tarama (hacim $50M → kara liste → cooldown) → ham sinyal → SOP`.
Tarama adımı bugün **saf hacim sıralaması**. Öneri: araya bir **Dinamik Sıralayıcı** koymak.

```
[YENİ] Coin Ranker daemon (yavaş, 5-10 dk)         [MEVCUT] Motor döngüsü (15 sn)
  ├─ aktif perp listesi (Bybit)                      ├─ rejim tespiti
  ├─ her coin: kline 15m/5m + ticker + OI + funding  ├─ risk kilitleri
  ├─ scoreCoin() → skor + botFit + yön               ├─ pozisyon yönetimi
  ├─ selectUniverse() → top-N + yön çeşitliliği      └─ TARAMA: ham hacim yerine
  └─ v4_coin_rank tablosuna yaz  ───────────────────────►  v4_coin_rank top-N'i oku, onları tara
```

**Neden iki ayrı kadans?** 15 sn'lik motor döngüsünde 200+ perp için Hurst/ATR/OI/funding
hesaplamak pahalı ve gereksiz. Sıralamayı **ayrı bir daemon** 5-10 dk'da bir yapar (tıpkı
`snapshotEquityBybit` 5 dk, AI regime selector saatlik gibi), sonucu DB'ye yazar; hızlı motor
döngüsü sadece hazır kısa listeyi okur. Böylece seçim **dinamik** ama motor **hafif** kalır.

---

## 2. Skorlama modeli (`scoreCoin`)

Her aday coin için önce **sert kapılar**, sonra **ağırlıklı bileşen skoru** (0–100).

**Sert kapılar (biri kalırsa coin elenir):**
| Kapı | Eşik | Notu |
|---|---|---|
| 24s hacim | ≥ `scan_volume_limit` ($50M) | mevcut filtre |
| ±%1 tahta derinliği | ≥ `order_book_depth_threshold` ($200k) | SOP'taki `checkOrderBookDepth`'i **öne** al |
| Kara liste | değil | mevcut |
| Kripto-dışı | değil | **XAU/XAUT altını eler (bilinen sorun #10)** |
| Cooldown | değil | mevcut |
| Yeterli mum | 15m ≥ 60 | Hurst penceresi |

**Ağırlıklı bileşenler (her biri 0..1, toplam ağırlık 1.0):**
| Bileşen | Ağırlık | Ne ölçer |
|---|---|---|
| `liquidity` | 0.20 | Min hacmin üstünde ~100x'e kadar log-ölçekli likidite kalitesi |
| `regimeFit` | 0.34 | Coinin rejimi + Hurst'ü + bant konumu, **global rejime** ne kadar uyuyor |
| `volatility` | 0.16 | "Goldilocks" ATR%: çok düşük=ölü, çok yüksek=kaos → çan eğrisi |
| `sopProxy` | 0.22 | **SOP-geçebilirlik**: 1H OI artışı + 5m hacim patlaması + RS yön uyumu |
| `funding` | 0.08 | Aleyhte kalabalık funding cezası (**bilinen eksik #7 — `passesFunding` burada bağlanır**) |

**Rejim + yön eşleştirmesi** (global rejim = Mean-Reversion iken):
| Coin rejimi | botFit | Yön | Mantık |
|---|---|---|---|
| range | `MR_BOTH` | both / bant yakınına göre | Alt bant LONG + üst bant SHORT |
| downtrend | `MR_SHORT` | short | Üst-bant sıçramasında trend-uyumlu SHORT |
| uptrend | `MR_LONG` | long | Alt-bant dip alımı |
| chaos | `CHAOS` | both | MM-Hunter rejimine bırak (global kaos ise yüksek skor) |

`sopProxy`, RS'in **yön ile uyumuna** göre ±0.15 düzeltilir (long isteniyor + coin BTC'den
güçlü → bonus). Bu, SOP K3'ün RS testini ön-eler.

> Referans `coin-scorer.ts` bu mantığı birebir uygular ve sentetik veriyle doğrular
> (RANGE→MR_BOTH, DOWN→MR_SHORT, UP→MR_LONG, düşük-hacim/altın→ELENDI).

---

## 2b. 🔴 Piyasa-Yön Kapısı — "referanslı dinamik"in kalbi (14 Tem 2026 dersi)

**Gerçek olay:** 14 Tem 2026'da soğuk enflasyon verisiyle piyasa geniş yükseldi
(BTC +%3.8, ETH +%6.1, ADA +%25) ve bu bir **short squeeze**'di ($281M short tasfiye).
Bot bu gün **zarar etti** — çünkü "downtrend coinleri → üst-bant SHORT" mantığıyla
**yükselen bir piyasaya short'ladı** ve sıkıştı.

**Ders:** Coin başına rejim yeterli değil. Seçim, **agregat piyasa yönüne** bağlanmalı;
yoksa piyasa döndüğünde bot ters yönde ısrar eder. Eksik katman buydu.

`computeMarketBias({ btcMomPct, breadthAboveMA, shortLiqShare })` → `risk_on / risk_off / neutral`:
| Sinyal | risk_on (short'u kıs) | risk_off (long'u kıs) |
|---|---|---|
| BTC ~24s momentum | > +%2 | < −%2 |
| Breadth (evrenin % kaçı kısa-MA üstünde) | > 0.60 | < 0.40 |
| Tasfiye dengesi (short'ların payı) | > 0.60 (short'lar eziliyor = squeeze) | < 0.40 |

`scoreCoin`, yönü piyasaya ters coinleri **sertçe kırpar** (gate, ağırlıklı bileşen değil):
- `risk_on` + short → `×0.35` (yükselen piyasaya short = squeeze yemi)
- `risk_off` + long → `×0.45`
- **Anti-squeeze:** short + negatif funding (kalabalık short) `×0.6`; short + `%B ≤ 0.15` (dipte, oversold) `×0.6`
- **Anti-chase:** long + `%B ≥ 0.85` (tepede) `×0.6`

> Referans: `coin-scorer.ts` → `computeMarketBias()` + `scoreCoin` `marketAlign`.
> Selftest: `DOWN(61, neutral) → DOWN(21, risk_on)`; 14 Tem tipi girdi `= risk_on`.

**Neden bu, "sürekli sana sormak yerine dinamik" demek:** Piyasa durumu her turda yeniden
ölçülür; koşullar değişince (ör. yukarı kırılım) sistem short beslemesini otomatik keser,
long'a döner. Statik liste yerine **canlı piyasa-durumuna referanslı** bir kapı.

**İlave koruma (bilinen eksik #4):** Bu gün gösterdi ki 10 korele short aynı anda squeeze
olabilir. `selectUniverse` yön çeşitliliği (§3) + risk katmanında "aynı yönde maks N pozisyon"
şart. Ayrıca bu tür macro-veri (CPI/enflasyon) günlerinde `event_lock_minutes` veya boyut-küçültme.

---

## 3. Çeşitlilik / korelasyon filtresi (`selectUniverse`)

Ham top-N genelde 15 birbiriyle korele alt-coinle dolar (hepsi BTC ile aynı anda hareket eder).
Bu hem SOP RS'ini bozar hem portföy ısısını yanıltır (**bilinen eksik #2 ve #4**: yön/korelasyon
limiti yok). Çözüm: sıralı listeden seçerken **aynı yönde en fazla `maxPerDir`** kuralı uygula
(ve istenirse sektör/L1 kümesi başına tavan). Sonuç: dengeli, çeşitli bir top-N.

---

## 3b. Adaptif çekirdek: giriş-anı kapısından SÜREKLİ yeniden-gerekçelendirmeye

**Prensip:** Sistem "tek yönde takılıyor" çünkü tüm kapıları **giriş anında** çalışıyor;
pozisyon açıldıktan sonra hiçbir şey onu güncel koşullara karşı yeniden sorgulamıyor.
Adaptiflik = aynı yön/rejim/piyasa mantığını **her turda açık kitaba da** uygulamak.

Motorun durumu (commit `0b27f4c`): işlem-bazında yön kapıları **var** (K1 EMA, OI-uyumu,
RS, haber). Portföy-bazında yön/korelasyon limiti **yok** (§10.2). İki eksik → `portfolio-guard.ts`:

**(1) `exposureGuard()` — giriş anı, portföy maruziyeti** (portföy ısısının yanında çalışır):
- **Aynı yönde maks N** — senin bulduğun tek-satır MVP.
- **Net maruziyet** `|Σlong − Σshort| / equity ≤ %60` — asıl koruma. Alt'lar ~hepsi BTC-beta
  olduğu için 3 "farklı" long = tek kaldıraçlı BTC-long; net-maruziyet bunu görür, portföy
  ısısı görmez. Net'i **azaltan** (hedge) ters-yön işlemi engellenmez.
- **Korelasyon-küme net tavanı** `%40` — granülerlik (L1 / DeFi / L2 / meme / major …).

**(2) `reviewOpenPositions()` — her tur, açık-kitap yeniden-gerekçe** (stale/trailing çıkışlarına EK):
- Piyasa-yönü bir pozisyonun yönüne sert ters döndüyse (`risk_on↔short`, `risk_off↔long`)
  → **küçült/kapat.** 14 Tem zararı **açık** short'lardan geldi; "yeni giriş açma" tek başına
  yetmez, mevcut kitabı da yönetmek şart.

> Referans `portfolio-guard.ts` selftest 5/5: 3. aynı-yön long bloklanır · net-azaltan short
> izin alır · net %70 > %60 bloklanır · `risk_on`'da 2 açık short → reduce.

**"Tek yerde takılmama"nın 4 döngüsü (yavaştan hızlıya):**
| Döngü | Kaynak | Ne yapar |
|---|---|---|
| Piyasa-durumu | `computeMarketBias` (5-10 dk) | risk_on/off → yön eğilimini çevirir |
| Coin sıralama | `scoreCoin`+`selectUniverse` (5-10 dk) | evreni + yönü rejime göre yeniler |
| Portföy maruziyeti | `exposureGuard` (giriş) | tek-yön/küme birikimini durdurur |
| Açık-kitap | `reviewOpenPositions` (her tur) | tezi bozulan pozisyonu geri çeker |

---

## 4. Entegrasyon noktaları (dosya dosya)

| Katman | Değişiklik |
|---|---|
| `packages/binance` | `scoreCoin()` + `selectUniverse()` saf fonksiyonlarını ekle (mevcut rsi/bollinger/ema/**Hurst**/ATR'yi yeniden kullan — referanstaki basit sürümleri kendi olgun sürümlerinle değiştir) |
| `apps/binance-server` | Yeni daemon `rankCoinsForUser` (5-10 dk). Aktif perp'leri çeker, `scoreCoin` + `selectUniverse` çalıştırır, `v4_coin_rank`'a yazar. `coin-evaluator.ts` zaten benzer veriyi topluyor → oradan besle |
| `packages/db` | Yeni tablo `v4_coin_rank` (user_id, symbol, score, bot_fit, direction, regime, updated_at). **Şema kuralı: `db:push` + ensure-schema ADD COLUMN** (Tuzak #1) |
| `apps/bybit/v4-engine-bybit.ts` | Tarama adımında ham hacim sıralaması yerine `v4_coin_rank`'tan **top-N + yön**'ü oku; yön bilgisini sinyal üretimine ipucu olarak geç. **Fail-safe:** rank tazeliği yoksa (ör. > `2×refresh`) eski hacim sıralamasına düş |
| `apps/binance-web` | Mevcut **Coin Selector** sayfası zaten skor rozetleri gösteriyor → aynı `v4_coin_rank`'ı görselleştir (artık motoru gerçekten besliyor) |

---

## 5. Yeni konfigürasyon

| Kolon | Varsayılan | Ne yapar |
|---|---|---|
| `dynamic_selection_enabled` | false | Kapalıyken mevcut hacim sıralaması (geriye uyumlu) |
| `rank_top_n` | 15 | Motora beslenen coin sayısı |
| `rank_max_per_direction` | 10 | Yön çeşitliliği tavanı |
| `rank_refresh_minutes` | 8 | Sıralayıcı kadansı |
| `vol_sweet_pct` / `vol_max_pct` | 0.6 / 2.0 | ATR% goldilocks bandı (rejime göre ayarla) |
| `funding_cap_abs` | 0.0005 | Aleyhte funding ceza eşiği |

Ağırlıklar (`w.*`) da kolona taşınabilir; başlangıçta sabit bırakıp backtest'le kalibre et.

---

## 6. Bilinen eksiklerle kesişim (bir taşla)

Bu tasarım, dokümandaki üç açık maddeyi de kapatır:
- **#10 Altın (XAU/XAUT) evrene giriyor** → sert kapı `isNonCrypto` eler.
- **#7 Funding filtresi yok** → `funding` bileşeni `passesFunding`'i skora bağlar.
- **#2/#4 Korelasyon/yön limiti yok** → `selectUniverse` yön çeşitliliği uygular.

---

## 7. Doğrulama planı (kritik — atlanmamalı)

Coin seçimi tek başına "0 işlem"i çözmez. Sırayla:
1. **Sıralayıcıyı gölge modda çalıştır** (motoru beslemeden): `v4_coin_rank`'ı 2-3 gün doldur,
   üretilen top-N'i incele. Mantıklı mı? (Bu repodaki `scanner.ts` + `coin-scorer.ts` ile
   ön-izleme yapılabilir.)
2. **`run-sop-v4-backtest.ts`'i** (a) mevcut geniş evrenle, (b) sıralayıcının top-N'iyle
   çalıştırıp işlem sayısı / PnL farkını ölç. Beklenti: aynı SOP eşikleriyle top-N daha **isabetli**.
3. **SOP eşiklerini** ayrı olarak gevşet/ayarla (ADX bypass, divergence, hacim/OI matrisi zaten
   var) ve tekrar ölç — coin seçimi + SOP kalibrasyonu **birlikte** hedef işlem sıklığını verir.
4. Canlıya `dynamic_selection_enabled=false` ile deploy et, tek kullanıcıda aç, karar log'unda
   `v4_coin_rank` isabetini izle, sonra yaygınlaştır.

---

## 8. Uygulama sırası (roadmap)

1. `scoreCoin`/`selectUniverse`'ü `packages/binance`'e taşı (referans → olgun göstergelerle).
2. `v4_coin_rank` tablosu + `rankCoinsForUser` daemon (gölge mod).
3. Coin Selector sayfasını `v4_coin_rank`'a bağla (görsel doğrulama).
4. Backtest karşılaştırması (§7.2).
5. Motorda tarama beslemesini `v4_coin_rank`'a çevir + fail-safe fallback.
6. Config bayrağıyla kademeli canlı açılış.
