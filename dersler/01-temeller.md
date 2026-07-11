# Ders 1 — Temeller: Kaldıraç, Teminat, Long/Short

[← İçindekiler](README.md) · [Sonraki: Likidasyon →](02-likidasyon.md)

---

## Kaldıraç (Leverage) nedir?

Kaldıraç, **borçlanarak pozisyonunu büyütmek** demektir. Bir çarpanla ifade edilir:
2x, 5x, 10x, 100x...

**Örnek:** Cebinde 100 $ var.
- **10x kaldıraç** ile 1.000 $'lık pozisyon açabilirsin (900 $'ı borsa "ödünç veriyor" gibi düşün).
- Fiyat %1 **artarsa**: 1.000 $'ın %1'i = **10 $ kazanç** (paranın %10'u).
- Fiyat %1 **düşerse**: **10 $ zarar** (paranın %10'u).

> Kaldıraç kârı da zararı da **aynı oranda** büyütür. Sihir yok — sadece risk büyütücü.

## Teminat (Margin) nedir?

Teminat, senin **kendi koyduğun para** (yukarıdaki örnekte 100 $). Borsa borç verirken bu
parayı güvence olarak tutar. Zararların bu teminattan düşülür. Teminat kritik seviyenin
altına inince pozisyon zorla kapatılır → **likidasyon** (bkz. Ders 2).

## Long vs Short

- **Long (uzun):** "Fiyat **yükselecek**" bahsi. Ucuza al, pahalıya sat.
- **Short (kısa):** "Fiyat **düşecek**" bahsi. Kriptonun spot alımdan farkı budur —
  **düşüşten de kazanabilirsin.** Mekanik: ödünç coin alıp satarsın, ucuzlayınca geri
  alıp iade edersin, aradaki fark kârındır.

---

## 🧮 Kontrol soruları

1. Elinde 200 $ var ve 5x kaldıraç kullanıyorsun. Pozisyon büyüklüğün kaç dolar?
2. Fiyat lehine %4 hareket ederse kaç dolar kazanırsın? Bu paranın yüzde kaçı eder?

<details>
<summary>Cevaplar</summary>

1. 200 $ × 5 = **1.000 $** pozisyon.
2. 1.000 $ × %4 = **40 $** kazanç. Bu, 200 $'ın **%20'si** eder. (Fiyat %4 oynadı, cebin %20 büyüdü — kaldıracın etkisi.)

</details>

---

### Bu derste öğrendiklerin
- Kaldıraç = kârı/zararı büyüten borç
- Teminat = senin koyduğun, zararın düşüldüğü para
- Long = yükselişe, Short = düşüşe bahis
