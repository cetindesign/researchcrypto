# 15 Günlük Rejim Optimizasyonu (15 Tem – 4 Ağu 2026)

> 5 coin × (4 rejim-hipotez ajanı + 1 sentez) = 25 ajan, 0 hata, ~632K token.
> Görsel: https://claude.ai/code/artifact/bb85f518-5bf1-4bf8-bd64-31c8861e2da1

## ⏸️ Optimal aksiyon: 5/5 coin → BEKLE (oybirliği)
Optimizasyon strateji dayatmadan çalıştı; "Bekle" geçerli/tercih edilen çıktı olarak izinliydi ve
**5/5 kazandı.** Breakout aktif stratejiler içinde en yüksek skoru aldı (LTC 73, AAVE 66) ama
"Bekle" (80-82) her coinde önde. Sebep: pre-FOMC düşük-vol chop (squeeze'i false-breakout olarak
çözer → MR'ı da breakout'u da öldürür), net trend yok, ve botun churn kusuru her aktif stratejiyi −EV yapar.

## Rejim-fit skorları
| Coin | MR | Trend | Breakout | Bekle | Optimal |
|---|---|---|---|---|---|
| SOL | 37 | 24 | 45 | **82** | BEKLE (yüksek) |
| AAVE | 33 | 30 | 66 | **74** | BEKLE (orta) |
| LTC | 57 | 30 | 73 | **80** | BEKLE (yüksek) |
| LINK | 55 | 40 | 55 | **82** | BEKLE (yüksek) |
| BTC | 37 | 22 | 48 | **82** | BEKLE (yüksek) |

## 15 günlük plan
- **15–27 Tem (Pre-FOMC): FLAT** — sıfır pozisyon; bu zamanı botu düzeltmeye harca.
- **27–30 Tem (FOMC): FLAT** — whipsaw/likidite avı penceresi.
- **29–31 Tem+ (Post-FOMC): İZLE** — tek sürülebilir pencere, aşağıdaki tetikler + hacim + execution fix koşuluyla.

## İzleme haritası (post-FOMC, teyitli GÜNLÜK kapanış + hacim + fix şartıyla; şu an canlı tetik YOK)
- **SOL:** ▲ >$80.87 → $84 → $97 · ▼ <$73/$70
- **AAVE:** ▲ >$100.21 → $108.42, stop <$92 · ▼ <$85 → $70
- **LTC:** ▲ >$44.55 + $46.08/$46.25/$46.45 duvarı · ▼ <$39.87 → $37
- **LINK:** ▲ >$9.30-9.33 → $10 · ▼ <$8.40 (veya $7.00-7.20) → $6.00 (fiyat çelişkisi — canlı teyit)
- **BTC:** ▲ >$65,457 · ▼ <$63,029, taban $58K

## Bu 15 günün en +EV kullanımı: botu düzelt
"Bekle" pasif değil, hazırlık. Post-FOMC fırsat çıksa bile bot onu şu hâliyle süremez (churn kazananı keser). Yani:
1. Momentum-exit min-hold (60-90 sn churn'ü durdur).
2. Cooldown düzelt (0→90) + SOP geri-kalibrasyon (Katman-2 bypass'ı geri al).
3. mssEnabled zod fix.
Bunlar bitince post-FOMC'da tetik + hacim ile çok küçük/paper giriş meşru; fix yoksa girme.

## Fırsat maliyeti (dürüst)
"Bekle"nin tek riski: dovish FOMC temiz trend açarsa (ör. SOL >$80.87 → $97) flat oturup kaçırmak.
Ama yön belirsiz + kanıtsız-edge'li churn'lü botla kovalamak kaçırmaktan pahalı → 15 gün beklemek düşük-riskli doğru karar.
