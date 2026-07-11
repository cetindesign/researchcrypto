# Ders 4 — Emir Tipleri: Market, Limit, Stop-Loss, Take-Profit

[← Perpetual & Funding](03-perpetual-ve-funding.md) · [İçindekiler](README.md) · [Sonraki: Risk Yönetimi →](05-risk-yonetimi.md)

Bir pozisyon açarken/kapatırken borsaya ne yapmasını istediğini **emir tipiyle** söylersin.
Dört tanesini bilmen yeter.

---

## 1) Market emri (Piyasa)

**"Şu anki fiyattan hemen al/sat."**
- ✅ Anında gerçekleşir.
- ❌ **Slippage (kayma):** hızlı piyasada beklediğinden biraz kötü fiyattan dolabilir. Ayrıca
  daha pahalı **"taker" ücreti** ödersin.
- Ne zaman: hızlı girmen/çıkman şartsa.

## 2) Limit emri

**"Sadece belirlediğim fiyattan (ya da daha iyisinden) al/sat."**
- Örn. BTC 60.000 $, sen "59.500'e düşerse long'a gir" dersin. Fiyat gelmezse **emir dolmaz**, bekler.
- ✅ Fiyatı sen kontrol edersin, daha ucuz **"maker" ücreti** ödersin.
- ❌ Fiyat gelmezse işlem hiç olmayabilir.
- Ne zaman: acele yoksa, iyi fiyat bekliyorsan (çoğu zaman tercih edilen).

## 3) Stop-Loss (SL) — 🛑 hayat kurtaran emir

**"Fiyat aleyhime şu seviyeye gelirse pozisyonu otomatik kapat ve zararı durdur."**
- Amaç: küçük bir kaybı kabul edip **likidasyona kadar gitmeni engellemek.**
- **Kural: Stop-loss'suz asla kaldıraçlı pozisyon açma.** Ekran başında olmasan da seni korur.

**Örnek:** 200 $, 5x, BTC 60.000'den long. Likidasyon ~48.000'de (%20 aşağı). SL'yi
**58.800'e** (%2 aşağı) koyarsan: fiyat oraya gelirse pozisyon kapanır, kayıp
1.000 $ × %2 = **20 $** ile sınırlı kalır — 200 $'ın tamamı yerine sadece 20 $.

## 4) Take-Profit (TP) — kârı kilitle

**"Fiyat lehime şu hedefe gelirse otomatik kapat ve kârı al."**
- Açgözlülüğü engeller; hedefe varınca duygu karışmadan çıkarsın.

> 💡 İyi trader'lar pozisyonu açarken **aynı anda hem SL hem TP** belirler.

### Stop-Market vs Stop-Limit

Stop tetiklenince hangi emir atılsın?
- **Stop-market:** market emri atılır — kesin dolar ama slippage riski var.
- **Stop-limit:** limit emri atılır — fiyat garantili ama dolmayabilir.

Yeni başlayan için **stop-market** daha güvenli; çünkü SL'de asıl amaç *kesinlikle çıkmaktır.*

### Maker vs Taker (ücret notu)
- **Taker:** mevcut emri "alıp götüren" (market emri) → daha yüksek ücret.
- **Maker:** emir defterine likidite "ekleyen" (dolmayı bekleyen limit emri) → daha düşük ücret.

---

## 🧮 Kontrol soruları

1. Acelen yok, BTC'yi mevcut fiyatın biraz altından almak istiyorsun. Market mı limit mi?
2. Stop-loss'un temel amacı nedir, tek cümleyle?
3. 200 $, 5x, long. SL'yi %3 aşağıya koydun. Tetiklenirse kaç dolar kaybedersin?

<details>
<summary>Cevaplar</summary>

1. **Limit** — fiyatı sen belirlersin, acelen yoksa daha iyi fiyata (ve daha düşük maker ücretine) dolar.
2. Kaybı önceden belirlenmiş küçük bir seviyede durdurup **likidasyonu ve büyük kayıpları önlemek.**
3. Pozisyon 1.000 $; %3 = **30 $** kayıp.

</details>

---

### Bu derste öğrendiklerin
- Market = hemen dolar (slippage/taker); Limit = fiyatını sen seçersin (maker, dolmayabilir)
- Stop-Loss = kaybı durduran koruma; onsuz işlem açma
- Take-Profit = kârı hedefte otomatik kilitler
