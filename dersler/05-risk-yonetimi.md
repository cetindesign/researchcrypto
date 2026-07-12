# Ders 5 — Risk Yönetimi

[← Emir Tipleri](04-emir-tipleri.md) · [İçindekiler](README.md) · [Sonraki: Pratik →](06-pratik.md)

> Tüm parçaların birleştiği yer. Grafik okumaktan bile önemli. İyi trader'ı kötüsünden
> ayıran şey burasıdır.

---

## Zihniyet: "Ne kadar kazanırım?" değil, "Ne kadar kaybedebilirim?"

Amatör pozisyonu "kaç kat kaldıraç, ne kadar kazanç" diye açar. Profesyonel önce
**"en fazla kaç dolar kaybederim"** diye sorar. Sistem bunun üstüne kurulur.

## Kural 1 — İşlem başına %1-2 riski

> Tek bir işlemde hesabının **en fazla %1'ini** (yeni başlayan için) riske at.

1.000 $ hesap → işlem başına risk = **10 $.** İşlem ters gidip stop-loss tetiklenince
kaybın 10 $ olur. Neden bu kadar az? Üst üste 10 işlem kaybetsen bile hesabının yalnızca
%10'unu kaybedersin — **oyunda kalırsın.** Bu iş bir hayatta kalma işidir.

## Kural 2 — Pozisyon büyüklüğünü HESAPLA

Her şeyi birbirine bağlayan formül:

```
Pozisyon büyüklüğü = Riske edeceğin para ÷ Stop-loss mesafesi (%)
```

**Örnek:** 1.000 $ hesap, %1 risk = 10 $. Stop-loss'u girişten **%5 uzağa** koyacaksın.
```
Pozisyon = 10 $ ÷ 0,05 = 200 $
```
Stop tetiklenirse: 200 $ × %5 = **tam 10 $** kayıp. Planladığın gibi.

## Kural 3 — Kaldıraç bir HEDEF değil, bir SONUÇtur

200 $'lık pozisyonu açmak için kilitleyeceğin teminat, kaldıracını belirler
(40 $ teminat → 5x, 20 $ teminat → 10x). **Kritik nokta:** stop-loss sabitken kaldıracı
artırmak **riskini artırmaz** — riskin zaten stop tarafından 10 $'a sabitlenmiştir.

> Önce **risk** ve **stop yeri** → pozisyon büyüklüğü → kaldıraç sadece "ne kadar teminat
> bağlanacağı"dır. Kaldıraçla **başlamazsın**, kaldıraçla **bitirirsin.**

## Kural 4 — Risk/Ödül oranı (R:R), en az 1:2

Riske ettiğin her 1 dolara karşılık en az 2 dolar hedefle.
- Risk 10 $, take-profit 20 $ → **1:2.**
- Güzelliği: 1:2 ile işlemlerinin yalnızca **%40'ında** haklı çıksan bile kârdasın.
  Sürekli haklı olmana gerek yok; matematik lehine çalışır.

## Kural 5 — Asla yapma

- ❌ **Stop-loss'u geri çekmek** ("birazdan döner"). Hesap katili #1.
- ❌ **Zarar eden pozisyona ekleme yapmak** (averaging down). Kaldıraçta likidasyonu hızlandırır.
- ❌ **Aynı anda çok sayıda benzer/korele pozisyon** (hepsi BTC yönlü ise aslında tek büyük risktir).

---

## 🧮 Kontrol soruları

1. 2.000 $ hesap, işlem başına %1 risk. Kaç dolar riske edersin?
2. Stop-loss girişten %4 uzakta. Pozisyon büyüklüğün kaç dolar olmalı?
3. 10 $ riske edip 30 $ hedefliyorsun. R:R oranın kaç?

<details>
<summary>Cevaplar</summary>

1. 2.000 $ × %1 = **20 $.**
2. 20 $ ÷ 0,04 = **500 $** pozisyon. (Stop tetiklenirse 500 × %4 = 20 $ kayıp.)
3. 30 ÷ 10 = **1:3.** Çok sağlıklı bir oran.

</details>

---

### Bu derste öğrendiklerin
- İşlem başına en fazla %1-2 risk al — hayatta kalma önce gelir
- Pozisyon büyüklüğü = risk ÷ stop mesafesi
- Kaldıraç girdi değil çıktıdır; stop sabitken riski değiştirmez
- En az 1:2 R:R hedefle; stop'u asla geri çekme, zarara ekleme yapma
