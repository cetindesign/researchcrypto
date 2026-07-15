#!/usr/bin/env bun
/**
 * ENDtrader V4 — Portföy-Seviyesi Adaptif Koruma (REFERANS)
 * ----------------------------------------------------------
 * İki eksik katman (V4 motoru bunları yapmıyor):
 *   1) exposureGuard()     — GİRİŞ anında: net maruziyet + aynı-yön + korelasyon-küme tavanı.
 *                            (Doküman §10.2: "aynı yönde maks N / net long ≤ %X" YOK.)
 *   2) reviewOpenPositions() — HER TURDA: açık pozisyonları güncel piyasa-yönüne karşı yeniden
 *                            gerekçelendir; ters dönenleri küçült/kapat (14 Tem squeeze dersi).
 *
 * Prensip: kapılar giriş-anında değil, SÜREKLİ çalışmalı. Bir pozisyonun tezi bozulduğunda
 * onu geri çeken bir kuvvet yoksa sistem "tek yönde takılır" ve dönüşte squeeze yer.
 *
 * Motorda yer: exposureGuard → tarama/emir öncesi (portföy ısısı kontrolünün yanında);
 * reviewOpenPositions → pozisyon yönetimi döngüsünde (stale/trailing çıkışlarıyla birlikte).
 *
 * Test: bun portfolio-guard.ts --selftest
 */

// ------------------------------- CONFIG -------------------------------
export const GUARD_CFG = {
  maxSameSide: 2,            // aynı yönde en fazla pozisyon
  maxNetExposurePct: 0.60,   // |Σlong − Σshort| / equity tavanı (v3'teki maxLongPct/maxShortPct ruhu)
  maxPerClusterPct: 0.40,    // tek korelasyon kümesine maks risk
  reviewAction: "reduce" as "reduce" | "close", // ters dönende varsayılan aksiyon
};

// Kaba korelasyon kümeleri. Kripto perp'lerde alt'lar ~hepsi BTC-beta olduğu için
// asıl koruma NET MARUZİYET'tir; küme tavanı yalnızca granülerlik ekler.
const CLUSTER: Record<string, string> = {
  BTC: "major", ETH: "major",
  SOL: "l1", AVAX: "l1", NEAR: "l1", APT: "l1", SUI: "l1", ADA: "l1", DOT: "l1",
  ATOM: "l1", TON: "l1", SEI: "l1", TRX: "l1", ETC: "l1", BCH: "l1", LTC: "l1",
  UNI: "defi", AAVE: "defi", INJ: "defi", RUNE: "defi", LINK: "defi",
  ARB: "l2", OP: "l2",
  DOGE: "meme",
  FIL: "infra", TIA: "infra", XLM: "infra", XRP: "infra", HBAR: "infra",
};
export function clusterOf(symbol: string): string {
  return CLUSTER[symbol.replace("USDT", "")] ?? "alt";
}

// ------------------------------- TYPES --------------------------------
export type Side = "long" | "short";
export type OpenPosition = {
  symbol: string; side: Side; notionalUsd: number;
  thesisFlipped?: boolean;  // boşluk #2: MR karşıt-tez (fiyat fade edilen bandı kırdı / coin rejimi döndü)
  adverseNews?: boolean;    // boşluk #3: aleyhte haber (motor bunu açık pozisyona uygulamıyor)
};
export type Candidate = { symbol: string; side: Side; notionalUsd: number };
export type MarketBias = "risk_on" | "risk_off" | "neutral";

// --------------------------- EXPOSURE GUARD ---------------------------
function signedNotional(pos: { side: Side; notionalUsd: number }): number {
  return pos.side === "long" ? pos.notionalUsd : -pos.notionalUsd;
}

/**
 * Giriş anında portföy maruziyet kontrolü. allow=false ise bu sinyal atlanır.
 * Üç kapı: (1) aynı-yön sayısı, (2) net maruziyet artışı, (3) küme yoğunluğu.
 */
export function exposureGuard(
  open: OpenPosition[], candidate: Candidate, equityUsd: number, cfg = GUARD_CFG,
): { allow: boolean; reason: string; netPctBefore: number; netPctAfter: number } {
  const netBefore = open.reduce((s, p) => s + signedNotional(p), 0);
  const netAfter = netBefore + signedNotional(candidate);
  const netPctBefore = netBefore / equityUsd;
  const netPctAfter = netAfter / equityUsd;
  const base = { netPctBefore, netPctAfter };

  // 1) Aynı yönde maks N
  const sameSide = open.filter((p) => p.side === candidate.side).length;
  if (sameSide >= cfg.maxSameSide)
    return { allow: false, reason: `ayni yonde zaten ${sameSide} pozisyon (maks ${cfg.maxSameSide})`, ...base };

  // 2) Net maruziyet: aday, kalabalık yönde |net|'i artırıyorsa ve tavanı aşıyorsa blokla
  if (Math.abs(netPctAfter) > cfg.maxNetExposurePct && Math.abs(netAfter) > Math.abs(netBefore))
    return { allow: false, reason: `net maruziyet %${(netPctAfter * 100).toFixed(0)} > tavan %${(cfg.maxNetExposurePct * 100).toFixed(0)}`, ...base };

  // 3) Korelasyon kümesi NET yoğunluğu (hedge eden ters-yön short'u cezalandırma)
  const cl = clusterOf(candidate.symbol);
  const clusterNet = open.filter((p) => clusterOf(p.symbol) === cl).reduce((s, p) => s + signedNotional(p), 0);
  const clusterNetAfter = clusterNet + signedNotional(candidate);
  if (Math.abs(clusterNetAfter) / equityUsd > cfg.maxPerClusterPct && Math.abs(clusterNetAfter) > Math.abs(clusterNet))
    return { allow: false, reason: `'${cl}' kumesi net %${((Math.abs(clusterNetAfter) / equityUsd) * 100).toFixed(0)} > tavan %${(cfg.maxPerClusterPct * 100).toFixed(0)}`, ...base };

  return { allow: true, reason: "ok", ...base };
}

// ----------------------- OPEN-BOOK RE-JUSTIFY -------------------------
/**
 * Her turda açık pozisyonları güncel koşullara karşı yeniden gerekçelendir.
 * Motorun MEVCUT çıkışlarına (Trend karşıt-EMA, momentum, stale, ROE stop, günlük kilit)
 * BİR YEDEK DEĞİL — onların KAPSAMADIĞI üç boşluğu doldurur (kullanıcı motor incelemesi, 0b27f4c):
 *   #1 rejim değişince açık pozisyonun yeniden değerlendirilmemesi → marketBias ters dönüşü
 *   #2 MR için karşıt-tez çıkışının olmaması (Trend'de var)        → p.thesisFlipped
 *   #3 haber yön kısıtının açık pozisyona işlememesi              → p.adverseNews
 * Tetiklenirse reduce/close önerir; motordaki stop yine de her pozisyonu bağlar.
 */
export function reviewOpenPositions(
  open: OpenPosition[], marketBias: MarketBias, cfg = GUARD_CFG,
): Array<{ symbol: string; side: Side; action: "hold" | "reduce" | "close"; reason: string }> {
  return open.map((p) => {
    const marketAgainst =
      (marketBias === "risk_on" && p.side === "short") ||
      (marketBias === "risk_off" && p.side === "long");
    const reasons: string[] = [];
    if (marketAgainst) reasons.push(`piyasa ${marketBias}`);         // #1
    if (p.thesisFlipped) reasons.push("karsit-tez (band/rejim kirildi)"); // #2
    if (p.adverseNews) reasons.push("aleyhte haber");                // #3
    if (reasons.length)
      return { symbol: p.symbol, side: p.side, action: cfg.reviewAction, reason: `${p.side} tezi bozuldu: ${reasons.join(" + ")}` };
    return { symbol: p.symbol, side: p.side, action: "hold", reason: "tez gecerli" };
  });
}

/** Loglama/panel için portföy maruziyet özeti. */
export function exposureSummary(open: OpenPosition[], equityUsd: number) {
  const net = open.reduce((s, p) => s + signedNotional(p), 0);
  const gross = open.reduce((s, p) => s + p.notionalUsd, 0);
  const longs = open.filter((p) => p.side === "long").length;
  const shorts = open.filter((p) => p.side === "short").length;
  return { netPct: net / equityUsd, grossPct: gross / equityUsd, longs, shorts };
}

// ------------------------------ SELFTEST ------------------------------
function selftest() {
  console.log("\n  [SELFTEST] portfolio-guard — maruziyet kapısı + açık-kitap yeniden-gerekçe\n");
  const eq = 1000;
  const P = (symbol: string, side: Side, n: number): OpenPosition => ({ symbol, side, notionalUsd: n });

  // Senaryo A: 2 long acikken 3. long adayi (SOL/AVAX/NEAR hepsi L1, hepsi BTC-beta)
  const openA = [P("SOLUSDT", "long", 300), P("AVAXUSDT", "long", 300)];
  const a = exposureGuard(openA, { symbol: "NEARUSDT", side: "long", notionalUsd: 300 }, eq);

  // Senaryo B: ayni ama aday SHORT (net maruziyeti AZALTIR → izin verilmeli)
  const b = exposureGuard(openA, { symbol: "DOTUSDT", side: "short", notionalUsd: 300 }, eq);

  // Senaryo C: net maruziyet tavani ($700 long / $1000 = %70 > %60)
  const c = exposureGuard([P("BTCUSDT", "long", 400)], { symbol: "ETHUSDT", side: "long", notionalUsd: 300 }, eq, { ...GUARD_CFG, maxSameSide: 5 });

  // Senaryo D: 14 Tem — 2 acik SHORT, piyasa risk_on → ikisi de kucult/kapat (bosluk #1)
  const openD = [P("AVAXUSDT", "short", 200), P("ADAUSDT", "short", 200)];
  const d = reviewOpenPositions(openD, "risk_on");

  // Senaryo E: NOTR piyasa ama MR karsit-tez (#2) ve aleyhte haber (#3) → yine kucult
  const openE: OpenPosition[] = [
    { symbol: "LTCUSDT", side: "short", notionalUsd: 200, thesisFlipped: true },
    { symbol: "SOLUSDT", side: "long", notionalUsd: 200, adverseNews: true },
    { symbol: "BTCUSDT", side: "long", notionalUsd: 200 },
  ];
  const e = reviewOpenPositions(openE, "neutral");
  const eBy: Record<string, string> = {}; e.forEach((x) => (eBy[x.symbol] = x.action));

  const rows: [string, boolean, string][] = [
    ["A: 3. ayni-yon long BLOKLANIR", !a.allow, a.reason],
    ["B: net'i azaltan short IZIN alir", b.allow, b.reason],
    ["C: net maruziyet %70 > %60 BLOKLANIR", !c.allow, c.reason],
    ["D: risk_on'da 2 short da 'reduce/close' (#1)", d.every((x) => x.action !== "hold"), d.map((x) => `${x.symbol.replace("USDT", "")}:${x.action}`).join(",")],
    ["E: karsit-tez short kucultulur (#2)", eBy["LTCUSDT"] !== "hold", "LTC:" + eBy["LTCUSDT"]],
    ["E: aleyhte-haber long kucultulur (#3)", eBy["SOLUSDT"] !== "hold", "SOL:" + eBy["SOLUSDT"]],
    ["E: temiz pozisyon TUTULUR", eBy["BTCUSDT"] === "hold", "BTC:" + eBy["BTCUSDT"]],
  ];
  console.log("  " + "─".repeat(92));
  let ok = true;
  for (const [name, pass, detail] of rows) {
    console.log("  " + (pass ? "✓" : "✗") + " " + name.padEnd(40) + (detail ? "→ " + detail : ""));
    if (!pass) ok = false;
  }
  console.log("  " + "─".repeat(92));
  console.log("  Ozet(A): " + JSON.stringify(exposureSummary(openA, eq)));
  console.log(`\n  ${ok ? "✓ Tum kontroller gecti." : "✗ Bazi kontroller BASARISIZ."}\n`);
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--selftest")) selftest();
