# Ders 2 — Likidasyon: Nasıl "yanarsın"

[← Temeller](01-temeller.md) · [İçindekiler](README.md) · [Sonraki: Perpetual & Funding →](03-perpetual-ve-funding.md)

> Bu, kursun **en kritik** dersidir. Burayı iyi anlamadan gerçek işlem açma.

---

## Mantık

Kaldıraçta kayıpların **senin teminatından** düşülür. Teminatın belli bir kritik seviyenin
altına inince borsa pozisyonunu **zorla kapatır** — çünkü borç verdiği parayı riske atmak
istemez. Buna **likidasyon** denir. Likide olursan **teminatını (neredeyse tamamını)
kaybedersin.**

## Altın kural (ezberle)

> Seni likide edecek ters hareket ≈ **%100 ÷ kaldıraç**

| Kaldıraç | Seni yakan yaklaşık ters hareket |
|----------|----------------------------------|
| 2x   | ~%50 |
| 5x   | ~%20 |
| 10x  | ~%10 |
| 20x  | ~%5  |
| 100x | ~%1  |

**100x** kullanan biri, fiyat sadece **%1** ters giderse her şeyini kaybeder. Kripto bir
saatte %1 rahat oynar. Yüksek kaldıraç = kumar.

> **Not:** Gerçekte biraz daha erken likide olursun; borsa küçük bir **bakım teminatı
> (maintenance margin)** tamponu ve **işlem ücretleri** ekler. Ama kafanda bu tablo yeterli.

## Örnek

200 $, **5x**, long (pozisyon 1.000 $):
- Fiyat %20 düşerse → 1.000 $ × %20 = **200 $ zarar** = tüm teminatın. **Likidasyon.** 💀
- Yani 5x'te bile fiyatın %20 ters gitmesi seni sıfırlar.

## İki teminat modu (çok önemli ayrım)

- **Isolated (izole) margin:** Riski o pozisyona koyduğun parayla **sınırlarsın.** Likide
  olursan sadece o teminatı kaybedersin; hesabının geri kalanı güvende.
  → **Yeni başlayan herkes bunu kullanmalı.**
- **Cross margin:** Hesabındaki **tüm bakiye** teminat olur. Tek kötü işlem bütün hesabını
  silebilir. → Deneyimlenene kadar uzak dur.

---

## 🧮 Kontrol soruları

1. 10x kaldıraçla long açtın. Fiyat yaklaşık yüzde kaç düşerse likide olursun?
2. Biri "50x ile hızlı zengin olacağım" diyor. Yüzde kaç ters hareket onu sıfırlar? Neden tehlikeli?
3. Isolated mı cross margin mı? Neden?

<details>
<summary>Cevaplar</summary>

1. ~%10 (100 ÷ 10).
2. ~%2 (100 ÷ 50). Kripto sakin bir günde bile dakikalar içinde %2 oynayabilir; ücretler + bakım teminatı ile daha da erken yanarsın. Anlık bir **fitil (wick)** bile likide edebilir. Yüksek kaldıraç "hızlı zengin" değil, "hızlı sıfır"dır.
3. **Isolated** — riski tek pozisyonla sınırlar, kötü bir işlem bütün hesabı silemez.

</details>

---

### Bu derste öğrendiklerin
- Likidasyon = teminatın kritik seviyeye inince pozisyonun zorla kapatılması
- Yakan ters hareket ≈ %100 ÷ kaldıraç
- Isolated margin kullan; cross'tan uzak dur
