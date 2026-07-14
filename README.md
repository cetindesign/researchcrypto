# researchcrypto — Mean-Reversion Tarayıcı (Bybit + Bun)

Bir coin havuzunu tarar, her coin için **Bollinger %B + RSI + ADX/trend** hesaplar ve
**"şu an hangi coin LONG mean-reversion girişine hazır"** der. En önemli özelliği
**karar loglamadır**: her coin için hangi koşulun geçtiğini/kaldığını yazar — böylece
_"neden işlem açmıyor"_ sorusunu net cevaplar.

> ⚠️ Bu bir **tarayıcı/logger**'dır — **emir açmaz**. Sadece Bybit public market data okur.
> Yatırım tavsiyesi değildir.

## Kurulum & Çalıştırma

```bash
bun scanner.ts            # canlı tarama (Bybit)
bun scanner.ts --json     # ek olarak makine-okur JSON çıktı
bun scanner.ts --selftest # ağ olmadan, sentetik veriyle mantık testi
```

Bağımlılık yok — sadece Bun (native `fetch`). Bybit'e erişimin olan bir makinede çalışır.

## Çıktı nasıl okunur

Her satır bir coin: `%B` (0 = alt bant, 1 = üst bant), `RSI`, `ADX`, `TREND` ve **DURUM**:

| Durum | Anlam |
|---|---|
| 🟢 **GIRISE HAZIR (LONG)** | Fiyat alt banda yakın (`%B ≤ 0.05`) **ve** `RSI < 35` **ve** rejim = yatay |
| 🔵 **UST BANT** | `%B ≥ 0.95` **ve** `RSI > 65` → short / kâr-al bölgesi |
| 🟡 **BEKLE** | Yatay ama henüz alt bantta değil (hangi koşulun eksik olduğunu yazar) |
| ⛔ **ATLA (düşüş/yükseliş trendi)** | Trend var → mean-reversion yapma |
| ⚪ **VERİ YOK** | Yetersiz mum / API hatası |

Altta bir **ÖZET + TEŞHİS** satırı çıkar. `🟢 0 hazır` ise sebebini söyler:
_"14 coin düşüş-trendi filtresine takıldı; 8 coin aralık ortasında (alt bandı bekliyor)."_
Bu, botun neden işlem açmadığını doğrudan gösterir.

## "3 gündür işlem açmıyor" — teşhis mantığı

İşlem açmamanın iki olası sebebi var; bu tarayıcı ikisini ayırır:

1. **Doğru davranış** — Kötü rejimde geçerli kurulum yoktur. Çoğu coin ya trendde
   ya da aralık ortasındadır. `TEŞHİS` satırı bunu gösterir. Bu durumda eşikleri
   **kör gevşetmeyin** — trende karşı işlem açmaya başlarsınız.
2. **Yanlış yapılandırma/bug** — Filtre her şeyi bloklar. Loglara bakıp hangi
   koşulun _sürekli_ `False` olduğunu görürsünüz (ör. RSI eşiği çok düşük, bantlar
   çok geniş, trend filtresi aşırı katı).

> Bu repodaki trend filtresi bilerek **200MA'nın anlamlı eğimiyle** tanımlanır
> (`trendSlopePct`). Yalnızca "fiyat < 200MA" kuralı, yatay aralık diplerini
> yanlışlıkla "düşüş trendi" sanıp botu susturur — bu klasik hata `--selftest` ile yakalanır.

## Yapılandırma (`scanner.ts` içinde `CONFIG`)

| Ayar | Varsayılan | Açıklama |
|---|---|---|
| `interval` | `240` | Mum periyodu (dk): 60/120/240/360/720 veya `D`. Daha çok sinyal için düşür. |
| `symbols` | 24 coin | Taranan havuz. Genişletmek işlem sıklığını **sağlıklı** artırır. |
| `pctBEnter` | `0.05` | Long girişi için alt banda yakınlık |
| `rsiEnter` | `35` | Long girişi için aşırı-satım eşiği |
| `adxRange` | `25` | ADX bunun altında = trend yok (range) |
| `trendSlopePct` | `0.003` | 200MA bundan fazla eğimliyse trend (düşür = daha katı) |
| `useClosedCandle` | `true` | Oluşmakta olan (repaint eden) mumu kullanma |

## Karar geçmişi

Her canlı çalıştırma `scanner-log.jsonl` dosyasına bir satır ekler (git'e girmez).
Cron ile periyodik çalıştırıp bu dosyayı biriktirin; birkaç gün sonra "kaç turda
kaç sinyal çıktı, hangi filtre ne sıklıkla bloklu" diye analiz edebilirsiniz.

## Yol haritası (isteğe bağlı sonraki adımlar)

- Backtester (geçmiş veride kuralları test et → "eğitim")
- Bybit ile emir yürütme (paper/testnet → küçük canlı)
- Pozisyon boyutu / stop / risk yönetimi modülü
