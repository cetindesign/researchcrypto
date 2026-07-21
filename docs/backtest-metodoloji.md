# EndTrx V4 — Sağlıklı Backtest ve Strateji Belirleme Metodolojisi

> Bu doküman, EndTrx V4 (Bybit Futures, 15m EMA trend takibi) motoru için backtest'in
> **nasıl dürüstçe** kurulacağını ve stratejinin **nasıl sağlıklı belirleneceğini** tanımlar.
> Sayısal borsa gerçekleri (ücret, funding, native trailing, order-book verisi) ve metodoloji
> iddiaları iki bağımsız denetim ajanıyla çapraz doğrulanmıştır; bulunan bir birim hatası ve
> birkaç nüans bu metne işlenmiştir.

---

## 0. Zihniyet: Backtest para kazandırmaz, yalanı eler

İyi bir backtest güzel bir eşitlik eğrisi üretmez — **stratejiyi öldürmeye çalışır.** Soru
"bu ne kadar kazandırır" değil, "bu edge gerçek mi, yoksa geçmişe uydurma mı" sorusudur.
Backtest **daha akıllı** görünüyorsa bir yerde hile yapıyordur; çünkü sağlıklı bir simülasyon,
canlı botun **daha yavaş ama daha dürüst** bir kopyasıdır.

**Birinci kural:** Backtest, canlıda var olan **her sürtünmeyi ve her engeli** taşımalı.
Canlıda olan bir kısıtı (ücret, slippage, derinlik filtresi, haber kalkanı, likidasyon)
sessizce atlarsan, backtest daha az kısıtla ticaret yaptığı için haksız yere parlar.

---

## 1. Bu stratejiye özel tuzaklar

### 1.1 Look-ahead (geleceğe bakış) ve "repainting"
- EMA9/EMA21 kesişimi **yalnızca KAPANMIŞ 15m mumda** değerlendirilmeli. Oluşmakta olan
  mumun anlık fiyatıyla kesişim onaylanırsa, canlıda göremeyeceğin sinyaller "görülmüş" olur.
- Asıl canlı tehlike **repainting**: bot 15 sn'de bir formasyon halindeki mumu değerlendirirse,
  bir sinyal belirip mum kapanmadan kaybolabilir. Çözüm: **giriş mantığını hem canlıda hem
  backtest'te kapanmış muma kilitle.** O zaman 15 sn'lik tempo yalnızca çıkışlar için önemli olur.
- Aynı kural **çapraz zaman dilimi** girdileri için de geçerli: BTC-trend filtresi ve 5m-RSI
  çıkışı kendi zaman dilimlerinin **kapanmış** barlarıyla, doğru zaman damgası hizasıyla okunmalı.
  Özensiz resampling gelecek bilgisini sızdırır.

### 1.2 Intrabar yol belirsizliği → 1m/tick veri zorunlu
15m OHLCV, mum İÇİNDEki fiyat yolunu vermez. Native trailing stop, breakeven ve momentum
çıkışları **yola bağımlıdır**; 15m mumla dürüst simüle edilemez. Çıkış yönetimini **1m
(ideali tick)** veri üzerinde yürüt. Sinyal 15m kapanışıyla, çıkış/likidasyon 1m ile.

### 1.3 Aynı mumda stop-vs-hedef belirsizliği
Bir mumun aralığında hem stop hem kâr tetiği varsa, OHLC hangisinin önce geldiğini söyleyemez.
**Kötümser varsayım (önce stop vuruldu)** dürüst varsayılan seçimdir; tek tam-doğru alternatif
daha ince veriyle sırayı çözmektir.

### 1.4 "Breakeven aslında breakeven değil" (DÜZELTİLMİŞ maliyet analizi)
Dikkat — burada birim karışıklığına düşmek kolay:
- Gidiş-dönüş taker ücreti = notional'ın **%0.11'i** = 10x'te **marjinin ~%1.1'i**.
- "%0.5 breakeven" ise bir **fiyat hareketi** = 10x'te **marjinin +%5'i**.
- Yani ücretler breakeven tetiğini **aşmaz**, onun ~1/5'i kadardır. (Marjin-% ile fiyat-%'yi
  yan yana koyup "ücret hedefi yiyor" demek **yanlıştır**.)

**Asıl kritik gerçek:** Stop'u girişe taşıyıp oradan stoplanınca gidiş-dönüş ücreti yine ödenir
→ sonuç **~marjinin %1'i kadar KÜÇÜK BİR ZARAR**, sıfır değil. Breakeven, bu stratejinin en sık
görülen çıkışlarından biri olduğu için, **backtest onu "0 PnL" kaydederse tam da en sık senaryoda
sonucu şişirir.** Breakeven çıkışlarını daima ücret düşülmüş net değeriyle kaydet.

### 1.5 Likidasyon modellemesi (10x'te EN tehlikeli boşluk)
15m kapanış simülasyonu mum içi **fitilleri** kaçırır. 10x izole marjinde ~−%9-10 fiyat
hareketi (bakım marjini düşülünce) likidasyondur. **Tek bir fitil, senin yazılım stop/trailing
mantığın tetiklenmeden önce pozisyonu likide edebilir.** Backtest mutlaka **intrabar likidasyonu**
modellemeli — aksi halde en yıkıcı senaryoyu hiç görmezsin.

### 1.6 Simüle EDİLEMEYEN kalkanlar
- **Derinlik Koruması (±%1'de $50k):** Tarihsel L2 order-book derinliği standart OHLCV'de
  **yoktur**. Ya canlı L2 snapshot kaydedeceksin ya da satın alacaksın (Tardis / Kaiko / CoinAPI).
  Modelleyemiyorsan bir proxy koy (hacim/spread eşiği) ve raporun başına "bu kalkan backtest'te
  tam modellenmiyor" yaz — **sessizce atlama.**
- **Haber Kalkanı:** Takvim **point-in-time** olmalı. Bugünün *revize* ForexFactory takvimini
  geçmişe uygulamak da bir look-ahead türüdür. O an yayınlanmış haliyle, doğru zaman damgasıyla arşivle.

### 1.7 Funding: yönlü ve pariteye-göre değişken
- Trend takipçisi genelde **kalabalık tarafta** durur → tipik olarak funding **öder**.
- Aralık artık evrensel 8h değil: BTC/ETH 8h, birçok alt **4h/2h**, ve 30 Ekim 2025'ten beri
  funding tavanına vuran kontratlar **saatlik (1h)** ödemeye geçebilir (Bybit Dynamic Settlement).
- Funding'i "ücrete dahil" diye toplama; **pariteye ve tutma süresine göre ayrı** modelle.

### 1.8 Stop/trailing çıkışlarında slippage
Native trailing ve stop'lar retracement'ta **market emre** dönüşür — en kötü fill tam da
tetiklendiği anda gelir. (Bybit native trailing futures'ta yalnızca kapatma amaçlıdır ve market
tetikler.) Sabit slippage varsayımı bu kuyruğu hafife alır; hızlı-tape için daha geniş varsay.

### 1.9 BTC filtresi = korelasyon, çeşitlilik değil + hesap-seviyesi margin
BTC-uyum kalkanı tüm pozisyonları **aynı yöne** zorlar → efektif çeşitlilik ≈ 1. N bağımsız bahis
gibi sayarsan gerçek drawdown'u ve Sharpe'ı olduğundan iyi görürsün. Dahası, korele + 10x
kombinasyonunda tek bir rejim dönüşü **tüm pozisyonları aynı anda margin-call** edebilir. Bu yüzden
per-trade değil, **hesap seviyesinde** margin/likidasyon modelle.

### 1.10 Survivorship bias (çift yönlü)
Bugünün top coin'leriyle test etme. Ama dikkat: bot çift yönlü olduğu için, ölen coin'ler genelde
*aşağı* aktığından **short** işlemler kâr ederdi — onları dışlamak short tarafı *olduğundan düşük*
gösterebilir. Ayrıca delist'ler ani **gap/likidasyon** olaylarıdır, 15m sim bunu yakalayamaz.
Evreni **o dönemde işlem gören** coinlerle kur.

---

## 2. Maliyet modeli (zorunlu, sıfırla test yasak)

| Kalem | Değer (Bybit standart, non-VIP) | Not |
|---|---|---|
| Taker ücret | %0.055 / yön | Market fill varsay: stop/trailing/momentum çıkışları taker'dır. |
| Maker ücret | %0.020 / yön | Yalnız limit girişlerde. |
| Gidiş-dönüş (iki taker) | %0.11 notional = 10x'te ~%1.1 marjin | Bir bacak maker olursa düşer. |
| Funding | Pariteye göre 8h / 4h / 2h / 1h | Yönlü; trend takipçisi genelde öder. |
| Slippage | Sığ altlarda yüksek; stop'ta market | Sabit değil, tape hızına göre kuyruk bırak. |

---

## 3. Strateji nasıl belirlenir (dürüst iş akışı)

1. **Hipotezle başla, eğriyle değil.** Önce edge'in *neden* var olduğunu yaz ("EMA9/21 + EMA100
   trendli piyasada momentum yakalar"), sonra test et. "Hangi parametre güzel eğri veriyor" diye
   aramak = overfitting.
2. **In-sample / Out-of-sample ayır.** Tasarım ve optimizasyonu yalnız in-sample'da yap. OOS'a
   **en sonda, bir kez** dokun. OOS'ta çökerse strateji uydurmadır.
3. **Walk-forward.** Pencereyi kaydırarak optimize et → sonraki pencerede test et → tekrarla.
   Tek "altın parametre seti"nden çok daha güvenilir.
4. **Parametre platosu, sivri tepe değil.** İyi bir edge komşu değerlerde de makul kalır. Breakeven
   %0.5 harika ama %0.4 ve %0.6 berbatsa, o %0.5 gürültüye uydurmadır.
5. **Serbestlik derecesini say.** EMA(9/21/100) + RSI seviye/zaman dilimi + trailing callback +
   breakeven tetik + cooldown + derinlik eşiği + haber penceresi + BTC-trend tanımı → **~12-15 knob.**
   Ne kadar çok knob, o kadar yüksek overfitting riski.
6. **Rejim çeşitliliği.** Trend takibi trendde kazanır, yatayda whipsaw'la kanar. Boğa/ayı/yatay
   dönemleri **ayrı** raporla. Uyarı: kriptonun kısa geçmişi az sayıda *bağımsız* rejim sunar; tek
   bir boğayı ikiye bölmek gerçek rejim çeşitliliği değildir.

---

## 4. Metrikler (toplam getiri EN yanıltıcı olan)

| Metrik | Neden / eşik |
|---|---|
| **Expectancy** | (Kazanma% × ort. kazanç) − (Kayıp% × ort. kayıp). İşlem başına gerçek EV. |
| **Profit Factor** | Brüt kâr / brüt zarar. Bu yüksek-frekanslı tasarım için **>1.5–2.0** hedefle (">1.3" fazla cömert). |
| **Max Drawdown + süresi** | 10x'te hayatta kalma sorusu. |
| **Sharpe / Sortino** | Getiriyi riske böler; korelasyon nedeniyle şişebilir (madde 1.9). |
| **İşlem sayısı** | **≥200** olmadan istatistiksel anlamsız — şans olabilir. |

Kurallar:
- Tüm metrikler **maliyet düşülmüş (net)** hesaplanmalı.
- **Monte Carlo için düz karıştırma YAPMA.** İşlemleri i.i.d. varsayan reşüffle, trend takipçisinin
  yatayda **kümelenen** kayıp serilerini yok eder ve drawdown'u olduğundan iyi gösterir. Kayıp
  serilerini koruyan **block bootstrap** kullan.
- **Çoklu-test düzeltmesi.** Onlarca coin × onlarca parametre tarayıp kazananları raporlamak
  p-hacking'tir. Deflated Sharpe / White's Reality Check (SPA) gibi bir düzeltme + minimum işlem
  sayısı + expectancy güven aralığı ekle.

---

## 5. EndTrx V4 için somut backtest mimarisi

1. **Veri katmanı:** Sinyal 15m kapanış, çıkış+likidasyon yönetimi **1m OHLCV** (ideali tick).
2. **Maliyet motoru:** taker + funding (pariteye göre değişken aralık) + slippage'ı **zorunlu
   parametre** yap; sıfırla teste izin verme.
3. **Intrabar likidasyon:** 10x izole için mum-içi fitille likidasyonu simüle et; yazılım stop'undan önce.
4. **Kalkan paritesi:** Backtest'in aldığı her kararı canlı botla eşitle. Modellenemeyen kalkanları
   (derinlik, point-in-time haber) raporun başına açıkça "kapalı/proxy" diye yazdır.
5. **"Breakeven ≠ sıfır":** Breakeven çıkışlarını ücret düşülmüş net (~−%1 marjin) kaydet.
6. **Hesap-seviyesi margin:** Korele + 10x maruziyeti hesap bazında modelle, per-trade değil.
7. **Metrik paneli:** expectancy, PF (net), max DD, Sharpe, işlem sayısı, rejim bazlı kırılım,
   block-bootstrap drawdown dağılımı.
8. **Forward test:** Backtest'i geçen adayları önce **Bybit testnet / paper** üzerinde 2-4 hafta
   canlı akışta doğrula. Backtest ↔ forward test ayrışıyorsa (genelde ayrışır), fark hangi kalkanı
   yanlış modellediğini söyler.

---

## 6. Doğrulama notu

Bu dokümandaki sayısal borsa gerçekleri (Bybit taker %0.055 / maker %0.020, native server-side
trailing stop, per-pair değişken funding, tarihsel L2 derinliğin OHLCV'de bulunmaması) ve
metodoloji iddiaları iki bağımsız denetim ajanıyla çapraz kontrol edildi. Bu süreçte düzeltilen
başlıca hata, "ücretler %0.5 breakeven'ı aşıyor" ifadesindeki **birim karışıklığıydı** (marjin-%
vs fiyat-%); doğrusu madde 1.4'te. Ayrıca Monte Carlo düz-karıştırma yerine block bootstrap'a
çevrildi ve baştan atlanan **intrabar likidasyon modellemesi** eklendi.
