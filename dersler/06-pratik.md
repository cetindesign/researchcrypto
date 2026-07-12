# Ders 6 — Pratik: Demo Hesapta İlk İşlem

[← Risk Yönetimi](05-risk-yonetimi.md) · [İçindekiler](README.md) · [Sonraki: Psikoloji & Hatalar →](07-psikoloji-ve-hatalar.md)

Teoriyi gerçek bir ekranda birleştirdiğimiz ders.

---

## Neden önce demo? (tartışılmaz)

Gerçek parayla başlamak, yüzme öğrenmeden okyanusa atlamaktır. Neredeyse tüm büyük borsalar
ücretsiz bir **testnet / demo hesap** sunar: sahte bakiyeyle **gerçek arayüzde**, **sıfır
riskle** pratik yaparsın.

> **Kendine söz ver:** En az birkaç hafta demo'da *sürekli* (tek seferlik şans değil) kâr
> üretmeden gerçek paraya geçme.

Demo hesap = gerçek fiyatlar + gerçek butonlar + sahte para. Hata yapmanın bedava olduğu tek yer.

## İlk işlemin — adım adım

Demo bakiye **1.000 $**, BTC 60.000 $ varsayalım.

1. **Teminat modu: Isolated.** (Ders 2 — cross'a dokunma.)
2. **Yön + gerekçe:** "BTC yükseliyor, **long** açıyorum." Gerekçesiz işlem = kumar.
3. **Risk:** hesabın %1'i = **10 $.** (Ders 5)
4. **Stop-loss yeri:** grafikte mantıklı bir seviye — diyelim girişin **%3 altı** = 58.200 $.
5. **Pozisyon büyüklüğü:** 10 $ ÷ 0,03 = **~333 $.**
6. **Kaldıraç:** 333 $'lık pozisyonu makul teminatla açacak şekilde (örn. ~66 $ teminat → 5x).
   Kaldıraç burada sadece bir sonuç; riskin hâlâ 10 $.
7. **Gir + aynı anda SL ve TP koy:**
   - Giriş: **limit** 60.000
   - **Stop-Loss:** 58.200 (−%3 → −10 $)
   - **Take-Profit:** 63.600 (+%6 → +20 $) → **R:R = 1:2**
8. **Çek elini, planı çalıştır.** SL'ye giderse −10 $, TP'ye giderse +20 $. İkisi de önceden
   kabul ettiğin sonuçlar.

## İşlem günlüğü tut

Her işlemi yaz: tarih, yön, giriş, SL, TP, gerekçe, sonuç ve **"kurallarıma uydum mu?"**.
Zamanla bu günlük kendi hatalarını sana gösterir. Kazanç/kayıptan daha önemlisi:
**plana sadık kaldın mı?**

| Tarih | Coin | Yön | Giriş | SL | TP | Gerekçe | Sonuç | Plana uydum mu? |
|-------|------|-----|-------|----|----|---------|-------|-----------------|
| ...   | BTC  | Long| 60000 |58200|63600| ...   | +20 $ | Evet |

---

## 🧮 Kontrol soruları

1. Demo hesabın 1.000 $. Bir işlemde %2 risk alıyorsun, stop girişten %5 uzakta. Pozisyon büyüklüğü?
2. Neden SL ve TP'yi pozisyonu açar açmaz *aynı anda* koyarız?
3. İşlem günlüğünde en önemli sütun hangisi, neden?

<details>
<summary>Cevaplar</summary>

1. 1.000 $ × %2 = 20 $ risk. 20 ÷ 0,05 = **400 $** pozisyon.
2. Çünkü işlem başladıktan sonra duygular (korku/açgözlülük) devreye girer. Önceden koyarsan
   plan otomatik çalışır; ekrana bakmasan da korunursun ve kararı sakinken vermiş olursun.
3. **"Plana uydum mu?"** — çünkü uzun vadede kazandıran şey tek bir işlemin sonucu değil,
   kurallara *tutarlı* bağlılıktır. Kurala uyup kaybetmek iyi işlemdir; kuralı bozup kazanmak
   kötü alışkanlıktır.

</details>

---

### Bu derste öğrendiklerin
- Gerçek paradan önce demo/testnet'te tutarlı kâr üret
- İlk işlem akışı: Isolated → yön+gerekçe → risk → stop yeri → pozisyon → kaldıraç → SL+TP birlikte
- İşlem günlüğü tut; asıl ölçüt plana sadakat
