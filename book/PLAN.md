# Proje Planı: "Crypto 101" E-Kitabı (Gumroad)

Bu belge, kitabın uçtan uca nasıl üretileceğini ve nasıl ilerleyeceğimizi anlatır.

---

## Kilitlenen kararlar

| Karar | Seçim |
|-------|-------|
| Dil | İngilizce (ürün), Türkçe (aramızdaki planlama) |
| Açı / hedef kitle | **Güvenlik-önce / anti-scam**: "dolandırılmadan güvenle ilk kripto alımını yap" |
| Kapsam | Kısa & aksiyon odaklı, **~30-40 sayfa** |
| Fiyat | **$9** ana fiyat (ara sıra $12); kısa/aksiyon segmentinin tatlı noktası |
| Platform | Gumroad (PDF ana ürün, opsiyonel EPUB) |
| Başlangıç | Önce içindekiler + 1 örnek bölüm, onay, sonra tam üretim |

## Çalışma başlığı önerileri (birini seçeriz)

1. **Crypto Without the Scams**: *A Complete Beginner's Guide to Buying, Storing, and Protecting Your First Cryptocurrency*
2. **Your First Bitcoin, Safely**: *The No-Nonsense Beginner's Guide to Crypto (Without Getting Scammed)*
3. **Don't Get Rekt**: *The Absolute Beginner's Safety Guide to Crypto*

---

## Süreç: 6 fazlı üretim hattı

### Faz 0. Plan & Onay (ŞU AN buradayız)
- Bu plan + [OUTLINE.md](OUTLINE.md) (içindekiler) + [sample-chapter.md](sample-chapter.md) (örnek bölüm)
- **Senin işin:** ses/ton ve yapıyı onayla, değişiklik iste. Onay gelmeden tam üretime geçmiyoruz.

### Faz 1. Tam Taslak (çok-agent'lı workflow)
- Onaylı içindekiler + ortak **stil kılavuzuna** göre her bölümü ayrı bir agent paralel yazar.
- Çıktı: tüm bölümlerin ham taslağı (Markdown).

### Faz 2. Editörlük
- Tek editör agent: tek ses, tekrarları temizler, temel bilgileri doğrular, kutu/checklist ekler.
- Çıktı: bütünlüklü, yayına yakın manuscript.

### Faz 3. Tasarım & Format
- Kapak (temiz, profesyonel) + iç sayfa düzeni, ardından **PDF** (+ opsiyonel EPUB).
- Çıktı: satışa hazır dosyalar.

### Faz 4. Satış Kiti (Go-to-market)
- Gumroad başlık, alt başlık, açıklama, madde madde faydalar, etiketler, fiyat.
- Ücretsiz **tadımlık örnek** (lead magnet) + adım adım **Gumroad yükleme kılavuzu**.

### Faz 5. Teslim & Revizyon
- Sen incele, düzeltmeleri uygularım, sen Gumroad'a yükle & yayınla.

---

## Zaman/beklenti notları

- Faz 0 hazır (bu commit). Onayınla Faz 1-2 tek oturumda çıkabilir; Faz 3-4 arkasından gelir.
- Workflow arka planda çalışır; bittiğinde seni uyarır ve paketi teslim ederim.

## Stil kuralları (TÜM bölümlerde zorunlu)

- ❌ **Uzun tire "—" (em dash) ASLA kullanılmaz.** Yerine virgül, iki nokta (:), nokta veya
  parantez kullan. (Not: Markdown bölüm ayıracı olan `---` bir yatay çizgidir, tire değil;
  o kalabilir.)
- Sade İngilizce, ikinci tekil şahıs ("you"), kısa paragraflar.
- Her bölümde en az bir aksiyon: checklist, adım adım liste veya "how to beat it" kutusu.
- Jargon girdiğinde hemen tek cümlede açıklanır.

## Dürüst notlar (yayından önce)

- **Yatırım tavsiyesi değil:** Kitaba net bir sorumluluk reddi (disclaimer) konur.
- **Gumroad'a yükleme sende:** Hesap açma, ödeme/vergi ayarı ve "Publish" senin elinde; ben her şeyi yüklemeye hazır veririm.
- **Politika teyidi:** Yayından önce Gumroad'un güncel içerik/ödeme koşullarını bir kez kendin kontrol et (kripto içeriği kabul ediliyor; bölgeye göre ödeme değişebilir).
- **Telif/özgünlük:** Tüm metin sıfırdan, özgün üretilir; başka kaynaklardan kopya olmaz.
