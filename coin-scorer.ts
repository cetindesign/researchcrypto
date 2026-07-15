#!/usr/bin/env bun
/**
 * ENDtrader V4 — Dinamik Coin Skorlama Çekirdeği (REFERANS)
 * ---------------------------------------------------------
 * Amaç: Tarama evrenindeki her coini, MEVCUT REJİME ve YÖNE göre puanlayıp
 * sıralamak. Motor (apps/bybit) ham "hacme göre sırala" yerine, bu skorun
 * ürettiği top-N kısa listeyi tarar → SOP'un geçme olasılığı yüksek, rejime
 * uygun coinlere odaklanır. LONG + SHORT farkındalıklıdır.
 *
 * Bu dosya SAF ve test edilebilirdir (ağ yok): mum dizileri + bağlam alır,
 * skor döndürür. Üretimde:
 *   - Gösterge fonksiyonlarını packages/binance'teki mevcutlarla değiştirin.
 *   - hurst()'ü mevcut coin_specific Hurst hesabınızla eşitleyin.
 *   - OI / funding / derinlik verisini ScoreInput'a canlı besleyin.
 *
 * Test: bun coin-scorer.ts --selftest
 */

// ------------------------------- CONFIG -------------------------------
export const SCORE_CFG = {
  // Sert kapılar (biri kalırsa coin elenir)
  minVol24hUsd: 50_000_000,   // scan_volume_limit ile ayni
  minDepthUsd: 200_000,       // order_book_depth_threshold ile ayni

  // Oynaklik "goldilocks" (15m ATR% uzerinden; rejime gore ayarlanir)
  volSweetPct: 0.6,           // ideal 15m ATR%
  volMinPct: 0.15,            // altinda "olu"
  volMaxPct: 2.0,             // ustunde kaos (MM-Hunter rejimine kayar)

  // Agirliklar (toplam = 1.0)
  w: { liquidity: 0.20, regimeFit: 0.34, volatility: 0.16, sopProxy: 0.22, funding: 0.08 },

  // Yardimcilar
  hurstWindow: 60,            // 15m x 60 mum (coin_specific ile ayni)
  fundingCapAbs: 0.0005,      // |8h funding| bunu asarsa aleyhte yonu cezalandir
  slopeLookback: 10,
  trendSlopePct: 0.003,
}

// ------------------------------- TYPES --------------------------------
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Regime = "mean_reversion" | "trend_following" | "market_maker_hunter";
export type BotFit = "MR_BOTH" | "MR_LONG" | "MR_SHORT" | "TREND_LONG" | "TREND_SHORT" | "CHAOS" | "AVOID";

export type ScoreInput = {
  symbol: string;
  candles15m: Candle[];      // rejim + Hurst + ATR
  candles5m?: Candle[];      // MR bant yakinligi (yoksa 15m kullanilir)
  globalRegime: Regime;      // detectMarketRegime ciktisi
  vol24hUsd: number;
  depthUsd: number;          // ±%1 tahta derinligi
  fundingRate?: number;      // guncel funding (kesir, orn 0.0001)
  rsVsBtc?: number;          // coin - BTC getirisi (kesir, orn 0.03 = %3 guclu)
  oiChangePct1h?: number;    // 1h OI degisimi (%)
  volSurge?: number;         // son 5m hacim / 20-mum ort (orn 1.4)
  isBlacklisted?: boolean;
  isNonCrypto?: boolean;     // XAU/XAUT vb.
  marketBias?: "risk_on" | "risk_off" | "neutral"; // canli piyasa-yon kapisi (computeMarketBias)
};

export type ScoreResult = {
  symbol: string;
  gatePassed: boolean;
  score: number;             // 0-100
  botFit: BotFit;
  direction: "long" | "short" | "both" | "none";
  regime: "uptrend" | "downtrend" | "range" | "chaos" | "unknown";
  components: Record<string, number>;
  reason: string;
};

// ----------------------------- INDICATORS -----------------------------
function sma(v: number[], p: number): number[] {
  const o = new Array(v.length).fill(NaN); let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; }
  return o;
}
function atrPct(c: Candle[], p = 14): number {
  if (c.length < p + 1) return NaN;
  let sum = 0;
  for (let i = c.length - p; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    sum += tr;
  }
  return (sum / p) / c[c.length - 1].c * 100;
}
function bollPctB(c: Candle[], p = 20, mult = 2): number {
  const close = c.map((x) => x.c); const i = close.length - 1;
  const m = sma(close, p); if (Number.isNaN(m[i])) return 0.5;
  let s = 0; for (let k = i - p + 1; k <= i; k++) { const d = close[k] - m[i]; s += d * d; }
  const sd = Math.sqrt(s / p); const up = m[i] + mult * sd, lo = m[i] - mult * sd;
  return up === lo ? 0.5 : (close[i] - lo) / (up - lo);
}
// Basit R/S Hurst tahmini (getiriler uzerinde). Uretimde mevcut Hurst'unuzu kullanin.
function hurst(close: number[], win: number): number {
  const s = close.slice(-win); if (s.length < 20) return 0.5;
  const ret: number[] = []; for (let i = 1; i < s.length; i++) ret.push(Math.log(s[i] / s[i - 1]));
  const n = ret.length; const mean = ret.reduce((a, b) => a + b, 0) / n;
  let cum = 0, mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) { cum += ret[i] - mean; if (cum < mn) mn = cum; if (cum > mx) mx = cum; }
  const R = mx - mn; let ss = 0; for (const x of ret) { const d = x - mean; ss += d * d; }
  const S = Math.sqrt(ss / n); if (S === 0 || R === 0) return 0.5;
  return Math.log(R / S) / Math.log(n);
}
function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }

// ------------------------- REGIME + DIRECTION -------------------------
function classifyRegime(c: Candle[]): { regime: ScoreResult["regime"]; slopePct: number; hurstV: number; atr: number } {
  const close = c.map((x) => x.c); const i = close.length - 1;
  const atr = atrPct(c, 14);
  const s200 = sma(close, 200); const s50 = sma(close, 50);
  const hurstV = hurst(close, SCORE_CFG.hurstWindow);
  let slopePct = NaN, regime: ScoreResult["regime"] = "unknown";

  if (atr >= SCORE_CFG.volMaxPct) { regime = "chaos"; return { regime, slopePct: NaN, hurstV, atr }; }

  const ref = !Number.isNaN(s200[i]) ? s200 : s50;
  if (!Number.isNaN(ref[i]) && !Number.isNaN(ref[i - SCORE_CFG.slopeLookback])) {
    slopePct = (ref[i] - ref[i - SCORE_CFG.slopeLookback]) / ref[i];
    const price = close[i];
    if (price < ref[i] && slopePct <= -SCORE_CFG.trendSlopePct) regime = "downtrend";
    else if (price > ref[i] && slopePct >= SCORE_CFG.trendSlopePct) regime = "uptrend";
    else regime = "range";
  }
  return { regime, slopePct, hurstV, atr };
}

// ------------------------------ SCORING -------------------------------
export function scoreCoin(inp: ScoreInput, cfg = SCORE_CFG): ScoreResult {
  const base: ScoreResult = {
    symbol: inp.symbol, gatePassed: false, score: 0, botFit: "AVOID",
    direction: "none", regime: "unknown", components: {}, reason: "",
  };

  // --- Sert kapilar ---
  if (inp.isBlacklisted) return { ...base, reason: "kara liste" };
  if (inp.isNonCrypto) return { ...base, reason: "kripto disi (altin vb.)" };
  if (inp.vol24hUsd < cfg.minVol24hUsd) return { ...base, reason: `dusuk hacim ($${(inp.vol24hUsd / 1e6).toFixed(0)}M)` };
  if (inp.depthUsd < cfg.minDepthUsd) return { ...base, reason: `sig tahta derinligi ($${(inp.depthUsd / 1e3).toFixed(0)}k)` };
  if (!inp.candles15m || inp.candles15m.length < 60) return { ...base, reason: "yetersiz mum" };

  const { regime, hurstV, atr } = classifyRegime(inp.candles15m);
  const bandC = inp.candles5m && inp.candles5m.length >= 20 ? inp.candles5m : inp.candles15m;
  const pctB = bollPctB(bandC, 20, 2);

  // --- Bilesenler (0..1) ---
  // 1) Likidite: min hacmin ustunde ~100x'e kadar dogrusal-log
  const liquidity = clamp01(Math.log10(inp.vol24hUsd / cfg.minVol24hUsd) / 2);

  // 2) Oynaklik uygunlugu: goldilocks can egrisi (cok dusuk=olu, cok yuksek=kaos)
  let volatility = 0;
  if (Number.isFinite(atr)) {
    if (atr < cfg.volMinPct || atr > cfg.volMaxPct) volatility = 0.1;
    else { const d = Math.abs(atr - cfg.volSweetPct) / (cfg.volMaxPct - cfg.volMinPct); volatility = clamp01(1 - d); }
  }

  // 3) SOP-gecebilirlik proxy'leri: OI artisi + hacim patlamasi + RS yon uyumu
  let sopProxy = 0.5;
  if (inp.oiChangePct1h !== undefined) sopProxy = clamp01(0.5 + inp.oiChangePct1h / 8); // +%4 OI -> ~1
  if (inp.volSurge !== undefined) sopProxy = clamp01((sopProxy + clamp01((inp.volSurge - 1) / 0.5)) / 2);

  // 4) Rejim + yon eşleşmesi (globalRegime'e göre)
  let botFit: BotFit = "AVOID"; let direction: ScoreResult["direction"] = "none"; let regimeFit = 0;
  const meanReverting = hurstV < 0.5;

  if (regime === "chaos") {
    botFit = "CHAOS"; direction = "both"; regimeFit = inp.globalRegime === "market_maker_hunter" ? 0.85 : 0.45;
  } else if (inp.globalRegime === "mean_reversion") {
    if (regime === "range") {
      botFit = "MR_BOTH"; regimeFit = clamp01(0.6 + (meanReverting ? 0.25 : 0) + (Math.abs(pctB - 0.5) * 0.3));
      direction = pctB <= 0.35 ? "long" : pctB >= 0.65 ? "short" : "both";
    } else if (regime === "downtrend") {
      botFit = "MR_SHORT"; direction = "short"; regimeFit = clamp01(0.55 + (pctB >= 0.7 ? 0.3 : pctB * 0.2));
    } else if (regime === "uptrend") {
      botFit = "MR_LONG"; direction = "long"; regimeFit = clamp01(0.55 + (pctB <= 0.3 ? 0.3 : (1 - pctB) * 0.2));
    }
  } else if (inp.globalRegime === "trend_following") {
    if (regime === "uptrend") { botFit = "TREND_LONG"; direction = "long"; regimeFit = clamp01(0.6 + (hurstV > 0.52 ? 0.25 : 0)); }
    else if (regime === "downtrend") { botFit = "TREND_SHORT"; direction = "short"; regimeFit = clamp01(0.6 + (hurstV > 0.52 ? 0.25 : 0)); }
    else { botFit = "AVOID"; regimeFit = 0.25; }
  } else { // market_maker_hunter global
    botFit = atr >= cfg.volSweetPct ? "CHAOS" : "AVOID"; direction = "both"; regimeFit = clamp01(atr / cfg.volMaxPct);
  }

  // RS yon uyumu: skoru rejim yönüyle hizala
  if (inp.rsVsBtc !== undefined && direction !== "none" && direction !== "both") {
    const aligned = (direction === "long" && inp.rsVsBtc > 0) || (direction === "short" && inp.rsVsBtc < 0);
    sopProxy = clamp01(sopProxy + (aligned ? 0.15 : -0.15));
  }

  // 5) Funding sağlığı: aleyhte kalabalık funding cezası
  let funding = 1;
  if (inp.fundingRate !== undefined && direction === "long" && inp.fundingRate > cfg.fundingCapAbs) funding = 0.4;
  if (inp.fundingRate !== undefined && direction === "short" && inp.fundingRate < -cfg.fundingCapAbs) funding = 0.4;

  // 6) PİYASA-YÖN KAPISI + ANTI-SQUEEZE (14 Tem 2026 dersi: ralli piyasada short'lama)
  // Bu bir GATE'tir, agirlikli bilesen degil: yon piyasaya ters ise skoru sertce kirpar.
  let marketAlign = 1;
  const mb = inp.marketBias ?? "neutral";
  if (direction === "short") {
    if (mb === "risk_on") marketAlign = 0.35;            // yukselen piyasaya short = squeeze yemi
    // anti-squeeze: kalabalik short (negatif funding) VEYA dipte short (oversold-at-support)
    if (inp.fundingRate !== undefined && inp.fundingRate < -cfg.fundingCapAbs) marketAlign *= 0.6;
    if (pctB <= 0.15) marketAlign *= 0.6;
  } else if (direction === "long") {
    if (mb === "risk_off") marketAlign = 0.45;           // dusen piyasaya long
    if (pctB >= 0.85) marketAlign *= 0.6;                // tepede long
  }

  const components = { liquidity, regimeFit, volatility, sopProxy, funding, marketAlign };
  const raw =
    cfg.w.liquidity * liquidity + cfg.w.regimeFit * regimeFit + cfg.w.volatility * volatility +
    cfg.w.sopProxy * sopProxy + cfg.w.funding * funding;
  const score = Math.round(raw * 100 * marketAlign);

  return {
    symbol: inp.symbol, gatePassed: true, score, botFit, direction, regime, components,
    reason: `${regime}/${botFit} dir=${direction} bias=${mb} align=${marketAlign.toFixed(2)} Hurst=${hurstV.toFixed(2)} ATR%=${Number.isFinite(atr) ? atr.toFixed(2) : "-"} %B=${pctB.toFixed(2)}`,
  };
}

/**
 * Canlı piyasa-yön (breadth) sinyali → yön kapısı.
 * 14 Tem 2026 dersi: bot yükselen piyasada short'layıp squeeze yedi. Bu fonksiyon
 * agregat piyasa durumundan "risk_on/off/neutral" üretir; scoreCoin short/long
 * skorlarını buna göre kırpar.
 *   btcMomPct       : BTC son ~24s % değişim
 *   breadthAboveMA  : evrenin yüzde kaçı kısa-MA üstünde (0..1)
 *   shortLiqShare   : son tasfiyelerin short oranı (0..1); >0.6 = short'lar eziliyor = squeeze
 */
export function computeMarketBias(x: { btcMomPct: number; breadthAboveMA: number; shortLiqShare?: number }): "risk_on" | "risk_off" | "neutral" {
  let s = 0;
  if (x.btcMomPct > 2) s++; else if (x.btcMomPct < -2) s--;
  if (x.breadthAboveMA > 0.6) s++; else if (x.breadthAboveMA < 0.4) s--;
  if (x.shortLiqShare !== undefined) { if (x.shortLiqShare > 0.6) s++; else if (x.shortLiqShare < 0.4) s--; }
  return s >= 1 ? "risk_on" : s <= -1 ? "risk_off" : "neutral";
}

/**
 * Sıralı evreni üretir + KORELASYON/YÖN çeşitliliği uygular (bilinen eksik #2/#4).
 * Aynı yönde en fazla maxPerDir, toplam topN döner.
 */
export function selectUniverse(results: ScoreResult[], topN = 15, maxPerDir = 10): ScoreResult[] {
  const ranked = results.filter((r) => r.gatePassed && r.botFit !== "AVOID").sort((a, b) => b.score - a.score);
  const out: ScoreResult[] = []; let longs = 0, shorts = 0;
  for (const r of ranked) {
    if (out.length >= topN) break;
    if (r.direction === "long" && longs >= maxPerDir) continue;
    if (r.direction === "short" && shorts >= maxPerDir) continue;
    out.push(r); if (r.direction === "long") longs++; if (r.direction === "short") shorts++;
  }
  return out;
}

// ------------------------------ SELFTEST ------------------------------
function gen(kind: "range" | "down" | "up" | "chaos", n = 260): Candle[] {
  const out: Candle[] = []; let prev = kind === "down" ? 200 : kind === "up" ? 50 : 100;
  for (let i = 0; i < n; i++) {
    const base =
      kind === "range" ? 100 + 4 * Math.sin(i / 6)
        : kind === "chaos" ? 100 + 14 * Math.sin(i / 3) + 8 * Math.sin(i / 1.7)
          : kind === "down" ? 200 - i * 0.5 + 3 * Math.sin(i / 5)
            : 50 + i * 0.35 + 3 * Math.sin(i / 5);
    const o = prev, c = base, h = Math.max(o, c) + 0.6, l = Math.min(o, c) - 0.6;
    out.push({ t: i * 900_000, o, h, l, c, v: 1000 }); prev = c;
  }
  return out;
}
function selftest() {
  console.log("\n  [SELFTEST] coin-scorer — rejim/yon/skor yonlendirmesi\n");
  const mk = (sym: string, kind: any, over: Partial<ScoreInput> = {}): ScoreInput => ({
    symbol: sym, candles15m: gen(kind), globalRegime: "mean_reversion",
    vol24hUsd: 300e6, depthUsd: 800e3, rsVsBtc: kind === "down" ? -0.04 : 0.02,
    oiChangePct1h: 3, volSurge: 1.3, ...over,
  });
  const inputs: [string, ScoreInput][] = [
    ["RANGE→MR_BOTH", mk("RANGEUSDT", "range")],
    ["DOWN→MR_SHORT", mk("DOWNUSDT", "down")],
    ["UP→MR_LONG", mk("UPUSDT", "up")],
    ["CHAOS→CHAOS", mk("CHAOSUSDT", "chaos")],
    ["DOWN + risk_on → short baskilanir", mk("DOWNONUSDT", "down", { marketBias: "risk_on" })],
    ["dusuk-hacim→AVOID(gate)", mk("SMALLUSDT", "range", { vol24hUsd: 10e6 })],
    ["altin→AVOID", mk("XAUTUSDT", "range", { isNonCrypto: true })],
  ];
  const results = inputs.map(([, i]) => scoreCoin(i));
  console.log("  " + "─".repeat(96));
  for (let k = 0; k < inputs.length; k++) {
    const r = results[k];
    console.log("  " + inputs[k][0].padEnd(26) +
      `skor=${String(r.score).padStart(3)}  fit=${r.botFit.padEnd(10)} dir=${r.direction.padEnd(5)} ${r.gatePassed ? r.reason : "[ELENDI] " + r.reason}`);
  }
  console.log("  " + "─".repeat(96));
  const uni = selectUniverse(results, 15, 10);
  console.log(`  Secilen evren (${uni.length}): ` + uni.map((r) => `${r.symbol.replace("USDT", "")}(${r.score}/${r.direction})`).join(", "));

  const by: Record<string, ScoreResult> = {}; results.forEach((r) => (by[r.symbol] = r));
  const checks: [string, boolean][] = [
    ["RANGE → MR_BOTH", by["RANGEUSDT"].botFit === "MR_BOTH"],
    ["DOWN → MR_SHORT + short", by["DOWNUSDT"].botFit === "MR_SHORT" && by["DOWNUSDT"].direction === "short"],
    ["UP → MR_LONG + long", by["UPUSDT"].botFit === "MR_LONG" && by["UPUSDT"].direction === "long"],
    ["CHAOS → chaos rejim", by["CHAOSUSDT"].regime === "chaos"],
    ["dusuk hacim gate ELEDI", !by["SMALLUSDT"].gatePassed],
    ["altin AVOID (gate)", !by["XAUTUSDT"].gatePassed],
    ["risk_on SHORT'u baskiliyor (DOWNON < DOWN)", by["DOWNONUSDT"].score < by["DOWNUSDT"].score],
    ["computeMarketBias(14 Tem tipi) = risk_on", computeMarketBias({ btcMomPct: 3.8, breadthAboveMA: 0.7, shortLiqShare: 0.8 }) === "risk_on"],
    ["secilen evren AVOID icermez", uni.every((r) => r.botFit !== "AVOID")],
    ["tum gecen skorlar 0-100", results.filter((r) => r.gatePassed).every((r) => r.score >= 0 && r.score <= 100)],
  ];
  console.log("\n  Kontroller:"); let ok = true;
  for (const [name, pass] of checks) { console.log(`    ${pass ? "✓" : "✗"} ${name}`); if (!pass) ok = false; }
  console.log(`\n  ${ok ? "✓ Tum kontroller gecti." : "✗ Bazi kontroller BASARISIZ."}\n`);
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--selftest")) selftest();
