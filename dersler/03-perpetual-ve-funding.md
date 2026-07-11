# Ders 3 — Perpetual Futures & Funding Rate

[← Likidasyon](02-likidasyon.md) · [İçindekiler](README.md) · [Sonraki: Emir Tipleri →](04-emir-tipleri.md)

---

## Perpetual futures ("perp") nedir?

Kriptoda kaldıraçlı işlem yaparken fiilen alıp satacağın şey **coinin kendisi değil**, onun
**vadesiz vadeli işlem sözleşmesidir** (perpetual future).

- Klasik "futures" sözleşmelerinin bir **vade tarihi** vardır (belli günde kapanır).
- **Perpetual** = "sonsuz", **vadesi yoktur.** Pozisyonu istediğin kadar açık tutabilirsin.
- Binance, Bybit, OKX gibi borsalarda gördüğün **"BTCUSDT Perpetual"** bu üründür. Kaldıraç,
  long/short, likidasyon hep bunun üstünde çalışır.

## Sorun: fiyat gerçek fiyata nasıl bağlı kalıyor?

Vadesi olmayan bir sözleşmenin fiyatı spot (gerçek) fiyattan kopabilir. Bunu engellemek için
**funding rate (fonlama oranı)** mekanizması vardır.

## Funding Rate (fonlama oranı)

Belli aralıklarla (genelde **her 8 saatte bir**; bazı borsalarda 1-4 saat) long ve short'lar
birbirine **küçük bir ödeme** yapar. Dikkat: bu para **borsaya değil, trader'dan trader'a** gider.

- **Pozitif funding** → long'lar fazla, perp fiyatı spot'un üstünde. **Long'lar → short'lara öder.**
- **Negatif funding** → short'lar fazla. **Short'lar → long'lara öder.**

Bu sayede "pahalı tarafta" olmak maliyetli hale gelir, fiyat spot'a yapışık kalır.

**Örnek:** 1.000 $'lık long, funding = +%0,01 → funding anında **0,10 $ ödersin.** Küçük
görünür ama günde 3 kez ve haftalarca tutunca **sessizce kârını yer.** Uzun süre pozisyon
tutacaksan funding'e mutlaka bak.

## Mark Price vs Last Price

- **Last price:** son gerçekleşen işlem fiyatı — manipüle edilebilir, anlık fitiller atar.
- **Mark price:** birden çok borsanın ortalamasına dayanan "adil fiyat."
- 🔑 **Likidasyonun LAST price'a göre değil, MARK price'a göre hesaplanır.** Bu iyidir —
  tek borsadaki sahte bir fitil seni haksızca yakamaz. Likidasyon fiyatını izlerken hep
  mark price'a bak.

---

## Özet tablosu (1-3. dersler)

| Kavram | Tek cümle |
|--------|-----------|
| Kaldıraç | Kârı da zararı da büyüten borç |
| Teminat (margin) | Senin koyduğun, zararın düşüldüğü para |
| Long / Short | Yükselişe / düşüşe bahis |
| Likidasyon | ~%100÷kaldıraç ters hareketle teminatı kaybetmek |
| Isolated margin | Riski tek pozisyonla sınırlama (kullan!) |
| Perp | Vadesiz kaldıraç sözleşmesi (fiilen işlem yaptığın şey) |
| Funding rate | Long/short arası periyodik ödeme; fiyatı spot'a bağlar |
| Mark price | Likidasyonun hesaplandığı adil fiyat |

---

### Bu derste öğrendiklerin
- Perp = vadesiz kaldıraç sözleşmesi; kriptoda fiilen işlem yaptığın ürün
- Funding rate = long/short arası ödeme; perp fiyatını spota bağlar
- Likidasyon mark price'a göre hesaplanır
