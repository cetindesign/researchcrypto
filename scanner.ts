#!/usr/bin/env bun
/**
 * Mean-Reversion Scanner + Logger  (Bybit + Bun)
 * ------------------------------------------------
 * Amaç: Bir coin havuzunu tarar, her coin icin Bollinger %B + RSI + ADX/trend
 * hesaplar ve "su an hangi coin LONG mean-reversion girisine hazir" der.
 * En onemli ozellik: KARAR LOGLAMA. Her coin icin hangi kosulun gectigini/kaldigini
 * yazar; boylece "neden islem acmiyor" sorusunu net cevaplar.
 *
 * Bu bir TARAYICI/LOGGER'dir — EMIR ACMAZ. Sadece okuma (public market data).
 *
 * Calistirma:
 *   bun scanner.ts              # canli tarama (Bybit)
 *   bun scanner.ts --selftest   # ag olmadan, sentetik veriyle mantik testi
 *   bun scanner.ts --json       # ek olarak makine-okur JSON ozet basar
 */

// ----------------------------- CONFIG -----------------------------
const CONFIG = {
  category: "linear" as "linear" | "spot", // Bybit: linear = USDT perpetual
  interval: "240",       // mum periyodu (dk): 60,120,240,360,720 veya "D"
  candles: 300,          // cekilecek mum sayisi (200 MA icin >=220 sart)
  useClosedCandle: true, // olusmakta olan son (repaint eden) mumu kullanma

  symbols: [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "AVAXUSDT",
    "TRXUSDT", "LTCUSDT", "ATOMUSDT", "AAVEUSDT", "XLMUSDT", "OPUSDT",
    "LINKUSDT", "DOTUSDT", "ADAUSDT", "DOGEUSDT", "NEARUSDT", "APTUSDT",
    "ARBUSDT", "SUIUSDT", "BCHUSDT", "UNIUSDT", "ETCUSDT", "HBARUSDT",
  ],

  // Gostergeler
  bbPeriod: 20,
  bbMult: 2,
  rsiPeriod: 14,
  adxPeriod: 14,
  maFast: 50,
  maSlow: 200,
  slopeLookback: 10,     // 200 MA egimini kac mumla olcecegiz
  trendSlopePct: 0.003,  // 200MA bu orandan (%0.3) fazla egimliyse = trend; altinda = yatay

  // LONG giris esikleri (mean-reversion)
  pctBEnter: 0.05,       // fiyat alt banda %5'ten yakin
  rsiEnter: 35,          // asiri satim
  // SHORT / ust-bant esikleri (bilgi amacli)
  pctBExit: 0.95,
  rsiExit: 65,
  // Trend filtresi
  adxRange: 25,          // ADX bunun ALTINDA => trend yok (range rejimi)

  logFile: "scanner-log.jsonl",
};

// ----------------------------- TYPES -----------------------------
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

type Analysis = {
  symbol: string;
  ok: boolean;
  price: number;
  pctB: number;
  rsi: number;
  adx: number;
  plusDI: number;
  minusDI: number;
  sma50: number;
  sma200: number;
  sma200Slope: number;
  trend: "downtrend" | "uptrend" | "range" | "unknown";
  cBand: boolean;
  cRsi: boolean;
  cRange: boolean;
  verdict: "READY_LONG" | "WAIT_LONG" | "SKIP_DOWNTREND" | "SKIP_UPTREND" | "READY_SHORT" | "NODATA";
  reason: string;
};

// --------------------------- INDICATORS ---------------------------
function smaSeries(v: number[], p: number): number[] {
  const out = new Array(v.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= p) sum -= v[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

function stdevSeries(v: number[], p: number, means: number[]): number[] {
  const out = new Array(v.length).fill(NaN);
  for (let i = p - 1; i < v.length; i++) {
    const m = means[i];
    let s = 0;
    for (let k = i - p + 1; k <= i; k++) {
      const d = v[k] - m;
      s += d * d;
    }
    out[i] = Math.sqrt(s / p); // populasyon std (Bollinger konvansiyonu)
  }
  return out;
}

function rsiSeries(close: number[], p: number): number[] {
  const out = new Array(close.length).fill(NaN);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < close.length; i++) {
    const ch = close[i] - close[i - 1];
    const gain = Math.max(ch, 0);
    const loss = Math.max(-ch, 0);
    if (i <= p) {
      avgGain += gain; avgLoss += loss;
      if (i === p) {
        avgGain /= p; avgLoss /= p;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (p - 1) + gain) / p;
      avgLoss = (avgLoss * (p - 1) + loss) / p;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

// Wilder ADX + yonlu gostergeler (+DI / -DI)
function adxSeries(high: number[], low: number[], close: number[], p: number) {
  const n = close.length;
  const tr = new Array(n).fill(0);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1];
    const dn = low[i - 1] - low[i];
    plusDM[i] = up > dn && up > 0 ? up : 0;
    minusDM[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1]),
    );
  }
  const smTR = new Array(n).fill(NaN);
  const smP = new Array(n).fill(NaN);
  const smM = new Array(n).fill(NaN);
  let trSum = 0, pSum = 0, mSum = 0;
  for (let i = 1; i < n; i++) {
    if (i <= p) {
      trSum += tr[i]; pSum += plusDM[i]; mSum += minusDM[i];
      if (i === p) { smTR[i] = trSum; smP[i] = pSum; smM[i] = mSum; }
    } else {
      smTR[i] = smTR[i - 1] - smTR[i - 1] / p + tr[i];
      smP[i] = smP[i - 1] - smP[i - 1] / p + plusDM[i];
      smM[i] = smM[i - 1] - smM[i - 1] / p + minusDM[i];
    }
  }
  const plusDI = new Array(n).fill(NaN);
  const minusDI = new Array(n).fill(NaN);
  const dx = new Array(n).fill(NaN);
  for (let i = p; i < n; i++) {
    plusDI[i] = smTR[i] === 0 ? 0 : (100 * smP[i]) / smTR[i];
    minusDI[i] = smTR[i] === 0 ? 0 : (100 * smM[i]) / smTR[i];
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
  }
  const adx = new Array(n).fill(NaN);
  const firstDX = p;
  const adxStart = firstDX + p - 1;
  let dxSum = 0;
  for (let i = firstDX; i < n; i++) {
    if (i < adxStart) dxSum += dx[i];
    else if (i === adxStart) { dxSum += dx[i]; adx[i] = dxSum / p; }
    else adx[i] = (adx[i - 1] * (p - 1) + dx[i]) / p;
  }
  return { adx, plusDI, minusDI };
}

// ----------------------------- ANALYZE -----------------------------
function analyze(symbol: string, candles: Candle[]): Analysis {
  const base: Analysis = {
    symbol, ok: false, price: NaN, pctB: NaN, rsi: NaN, adx: NaN,
    plusDI: NaN, minusDI: NaN, sma50: NaN, sma200: NaN, sma200Slope: NaN,
    trend: "unknown", cBand: false, cRsi: false, cRange: false,
    verdict: "NODATA", reason: "yetersiz veri",
  };
  const need = CONFIG.bbPeriod + 2;
  if (candles.length < need) return base;

  const close = candles.map((c) => c.c);
  const high = candles.map((c) => c.h);
  const low = candles.map((c) => c.l);
  const i = close.length - 1;

  const mid = smaSeries(close, CONFIG.bbPeriod);
  const sd = stdevSeries(close, CONFIG.bbPeriod, mid);
  const upper = mid[i] + CONFIG.bbMult * sd[i];
  const lower = mid[i] - CONFIG.bbMult * sd[i];
  const rsi = rsiSeries(close, CONFIG.rsiPeriod);
  const { adx, plusDI, minusDI } = adxSeries(high, low, close, CONFIG.adxPeriod);
  const s50 = smaSeries(close, CONFIG.maFast);
  const s200 = smaSeries(close, CONFIG.maSlow);

  const price = close[i];
  const pctB = upper === lower ? 0.5 : (price - lower) / (upper - lower);
  const rsiV = rsi[i];
  const adxV = Number.isNaN(adx[i]) ? 0 : adx[i];
  const sma50 = s50[i];
  const sma200 = s200[i];
  const slope = !Number.isNaN(s200[i - CONFIG.slopeLookback]) ? s200[i] - s200[i - CONFIG.slopeLookback] : NaN;

  // --- Trend siniflandirma (bizim "gizli dusus trendi" kuralimiz) ---
  // Trend = 200MA'nin ANLAMLI egimi + fiyatin MA'ya gore konumu.
  // (Sadece "fiyat MA alti" DEGIL — yoksa yatay aralik dipleri yanlislikla
  //  dusus trendi sanilir ve bot hicbir zaman al sinyali uretmez.)
  const slopePct = !Number.isNaN(slope) && sma200 ? slope / sma200 : NaN;
  const slope50 = !Number.isNaN(s50[i - CONFIG.slopeLookback]) ? s50[i] - s50[i - CONFIG.slopeLookback] : NaN;
  const slope50Pct = !Number.isNaN(slope50) && sma50 ? slope50 / sma50 : NaN;

  let trend: Analysis["trend"] = "range";
  if (!Number.isNaN(sma200) && !Number.isNaN(slopePct)) {
    const down = price < sma200 && slopePct <= -CONFIG.trendSlopePct; // dusen 200MA altinda
    const up = price > sma200 && slopePct >= CONFIG.trendSlopePct;    // yukselen 200MA ustunde
    trend = down ? "downtrend" : up ? "uptrend" : "range";
  } else if (!Number.isNaN(sma50) && !Number.isNaN(slope50Pct)) {
    // 200MA yoksa (yeni coin) 50MA ile zayif fallback
    const down = price < sma50 && slope50Pct <= -CONFIG.trendSlopePct;
    const up = price > sma50 && slope50Pct >= CONFIG.trendSlopePct;
    trend = down ? "downtrend" : up ? "uptrend" : "range";
  } else {
    trend = "unknown";
  }

  const cBand = pctB <= CONFIG.pctBEnter;
  const cRsi = rsiV < CONFIG.rsiEnter;
  const cRange = trend === "range" || trend === "unknown";

  let verdict: Analysis["verdict"];
  let reason: string;
  if (trend === "downtrend") {
    verdict = "SKIP_DOWNTREND";
    reason = `dusus trendi (fiyat 200MA alti, egim<0) — MR yapma`;
  } else if (trend === "uptrend") {
    verdict = "SKIP_UPTREND";
    reason = `yukselis trendi (ADX ${adxV.toFixed(0)}) — MR yapma`;
  } else if (cBand && cRsi) {
    verdict = "READY_LONG";
    reason = `alt bant + asiri satim`;
  } else if (pctB >= CONFIG.pctBExit && rsiV > CONFIG.rsiExit) {
    verdict = "READY_SHORT";
    reason = `ust bant + asiri alim (short/kar-al)`;
  } else {
    verdict = "WAIT_LONG";
    const miss: string[] = [];
    if (!cBand) miss.push(`%B ${pctB.toFixed(2)} (≤${CONFIG.pctBEnter} gerek)`);
    if (!cRsi) miss.push(`RSI ${rsiV.toFixed(0)} (<${CONFIG.rsiEnter} gerek)`);
    reason = "bekle: " + miss.join(", ");
  }

  return {
    symbol, ok: true, price, pctB, rsi: rsiV, adx: adxV,
    plusDI: plusDI[i], minusDI: minusDI[i], sma50, sma200, sma200Slope: slope,
    trend, cBand, cRsi, cRange, verdict, reason,
  };
}

// ------------------------------ BYBIT ------------------------------
async function fetchKlines(symbol: string): Promise<Candle[]> {
  const url = `https://api.bybit.com/v5/market/kline?category=${CONFIG.category}` +
    `&symbol=${symbol}&interval=${CONFIG.interval}&limit=${CONFIG.candles}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.retCode !== 0) throw new Error(`retCode ${json.retCode}: ${json.retMsg}`);
  const list: string[][] = json.result?.list ?? [];
  // Bybit yeni->eski dondurur; kronolojik hale getir
  const candles: Candle[] = list
    .map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
    .sort((a, b) => a.t - b.t);
  if (CONFIG.useClosedCandle && candles.length > 0) candles.pop(); // olusmakta olan mumu at
  return candles;
}

// ------------------------------ OUTPUT ------------------------------
function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return "-";
  const abs = Math.abs(p);
  const dec = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return p.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function pad(s: string, n: number): string { return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
function padL(s: string, n: number): string { return s.length >= n ? s : " ".repeat(n - s.length) + s; }

const VERDICT_LABEL: Record<Analysis["verdict"], string> = {
  READY_LONG: "🟢 GIRISE HAZIR (LONG)",
  READY_SHORT: "🔵 UST BANT (short/kar-al)",
  WAIT_LONG: "🟡 BEKLE",
  SKIP_UPTREND: "⛔ ATLA (yukseli trend)",
  SKIP_DOWNTREND: "⛔ ATLA (dusus trendi)",
  NODATA: "⚪ VERI YOK",
};

function rankKey(a: Analysis): number {
  switch (a.verdict) {
    case "READY_LONG": return 0;
    case "READY_SHORT": return 1;
    case "WAIT_LONG": return 2 + a.pctB; // alt banda en yakin once
    case "SKIP_UPTREND": return 100;
    case "SKIP_DOWNTREND": return 200;
    default: return 300;
  }
}

function printReport(results: Analysis[]) {
  const rows = [...results].sort((a, b) => rankKey(a) - rankKey(b));
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  const tf = CONFIG.interval === "D" ? "1G" : `${+CONFIG.interval / 60}S`;

  console.log("");
  console.log(`  MEAN-REVERSION TARAYICI  ·  Bybit ${CONFIG.category}  ·  ${tf} mum  ·  ${now} UTC`);
  console.log("  " + "─".repeat(104));
  console.log("  " +
    pad("COIN", 10) + padL("FIYAT", 12) + padL("%B", 7) + padL("RSI", 6) +
    padL("ADX", 6) + "  " + pad("TREND", 10) + "  " + pad("DURUM", 26) + "NOT");
  console.log("  " + "─".repeat(104));

  for (const a of rows) {
    if (!a.ok) {
      console.log("  " + pad(a.symbol, 10) + padL("-", 12) + "   " + pad("", 40) + a.reason);
      continue;
    }
    console.log("  " +
      pad(a.symbol.replace("USDT", ""), 10) +
      padL(fmtPrice(a.price), 12) +
      padL(a.pctB.toFixed(2), 7) +
      padL(a.rsi.toFixed(0), 6) +
      padL(a.adx.toFixed(0), 6) + "  " +
      pad(a.trend, 10) + "  " +
      pad(VERDICT_LABEL[a.verdict], 26) +
      a.reason);
  }
  console.log("  " + "─".repeat(104));

  // Ozet — "neden islem yok" teshisi
  const c = (v: Analysis["verdict"]) => results.filter((r) => r.verdict === v).length;
  const readyL = c("READY_LONG"), readyS = c("READY_SHORT"), wait = c("WAIT_LONG");
  const up = c("SKIP_UPTREND"), down = c("SKIP_DOWNTREND"), nd = c("NODATA");
  console.log(`  OZET: 🟢 ${readyL} hazir(long) · 🔵 ${readyS} ust-bant · 🟡 ${wait} bekliyor · ⛔ ${down} dusus · ⛔ ${up} yukseli · ⚪ ${nd} veri-yok`);
  if (readyL === 0) {
    const parts: string[] = [];
    if (down) parts.push(`${down} coin dusus-trendi filtresine takildi`);
    if (wait) parts.push(`${wait} coin aralik ortasinda (alt bandi bekliyor)`);
    if (up) parts.push(`${up} coin yukseli trendinde`);
    console.log(`  TESHIS: Girise hazir coin yok. Sebep: ${parts.join("; ") || "kosullar olusmadi"}.`);
    console.log(`          → Bu DOGRU davranis olabilir (kotu rejimde islem acmamak). Esikleri KOR gevsetme.`);
  }
  console.log("");
}

function logJsonl(results: Analysis[]) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    tf: CONFIG.interval,
    summary: {
      ready_long: results.filter((r) => r.verdict === "READY_LONG").length,
      wait_long: results.filter((r) => r.verdict === "WAIT_LONG").length,
      skip_downtrend: results.filter((r) => r.verdict === "SKIP_DOWNTREND").length,
      skip_uptrend: results.filter((r) => r.verdict === "SKIP_UPTREND").length,
    },
    coins: results.map((r) => ({
      s: r.symbol, price: r.price, pctB: +r.pctB.toFixed(3),
      rsi: +r.rsi.toFixed(1), adx: +r.adx.toFixed(1), trend: r.trend, verdict: r.verdict,
    })),
  });
  try {
    const fs = require("fs");
    fs.appendFileSync(CONFIG.logFile, line + "\n");
  } catch (e) {
    console.error("  (log yazilamadi:", (e as Error).message, ")");
  }
}

// ------------------------------ SELFTEST ------------------------------
// Ag olmadan matematik + karar mantigini dogrular (deterministik sentetik veri).
function genCandles(kind: "range" | "down" | "up" | "dip", n: number): Candle[] {
  const out: Candle[] = [];
  let prevC = kind === "down" ? 200 : kind === "up" ? 50 : 100;
  for (let i = 0; i < n; i++) {
    const base =
      kind === "range" ? 100 + 4 * Math.sin(i / 6)          // duz yatay aralik
        : kind === "dip" ? 100 + 6 * Math.sin(i / 9 + 1.85)  // yatay, sonda dipte (alt bant + oversold)
          : kind === "down" ? 200 - i * 0.45 + 4 * Math.sin(i / 5)
            : 50 + i * 0.30 + 4 * Math.sin(i / 5);
    const o = prevC;
    const cl = base;
    const h = Math.max(o, cl) + 0.8;
    const l = Math.min(o, cl) - 0.8;
    out.push({ t: i * 3600_000, o, h, l, c: cl, v: 1000 });
    prevC = cl;
  }
  return out;
}

function selftest() {
  console.log("\n  [SELFTEST] Sentetik veriyle gosterge + karar dogrulamasi\n");
  const cases: [string, "range" | "down" | "up" | "dip"][] = [
    ["DIPUSDT", "dip"], ["RANGEUSDT", "range"], ["UPUSDT", "up"], ["DOWNUSDT", "down"],
  ];
  const results = cases.map(([sym, kind]) => analyze(sym, genCandles(kind, 300)));
  printReport(results);
  // Basit dogrulama
  const byKind: Record<string, Analysis> = {};
  for (const r of results) byKind[r.symbol] = r;
  const checks: [string, boolean][] = [
    ["DIP serisi READY_LONG (🟢 girise hazir) uretti", byKind["DIPUSDT"].verdict === "READY_LONG"],
    ["Dusus serisi SKIP_DOWNTREND olarak isaretlendi", byKind["DOWNUSDT"].verdict === "SKIP_DOWNTREND"],
    ["Yukseli serisi SKIP_UPTREND/uptrend algilandi", byKind["UPUSDT"].trend === "uptrend" || byKind["UPUSDT"].verdict === "SKIP_UPTREND"],
    ["Range serisi TREND DEGIL (range) olarak siniflandi", byKind["RANGEUSDT"].trend === "range"],
    ["Range serisi trend filtresine TAKILMADI (islem yapilabilir)", byKind["RANGEUSDT"].verdict === "READY_LONG" || byKind["RANGEUSDT"].verdict === "WAIT_LONG" || byKind["RANGEUSDT"].verdict === "READY_SHORT"],
    ["Range serisi RSI 0-100 arasi gecerli", byKind["RANGEUSDT"].rsi >= 0 && byKind["RANGEUSDT"].rsi <= 100],
    ["Range serisi %B hesaplandi", Number.isFinite(byKind["RANGEUSDT"].pctB)],
    ["ADX gecerli sayi", Number.isFinite(byKind["RANGEUSDT"].adx)],
  ];
  console.log("  Kontroller:");
  let allOk = true;
  for (const [name, ok] of checks) { console.log(`    ${ok ? "✓" : "✗"} ${name}`); if (!ok) allOk = false; }
  console.log(`\n  ${allOk ? "✓ Tum kontroller gecti." : "✗ Bazi kontroller BASARISIZ."}\n`);
  process.exit(allOk ? 0 : 1);
}

// ------------------------------ MAIN ------------------------------
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();

  const results: Analysis[] = [];
  await Promise.all(
    CONFIG.symbols.map(async (sym) => {
      try {
        const candles = await fetchKlines(sym);
        results.push(analyze(sym, candles));
      } catch (e) {
        results.push({
          symbol: sym, ok: false, price: NaN, pctB: NaN, rsi: NaN, adx: NaN,
          plusDI: NaN, minusDI: NaN, sma50: NaN, sma200: NaN, sma200Slope: NaN,
          trend: "unknown", cBand: false, cRsi: false, cRange: false,
          verdict: "NODATA", reason: `hata: ${(e as Error).message}`,
        });
      }
    }),
  );

  printReport(results);
  logJsonl(results);
  if (args.includes("--json")) {
    console.log(JSON.stringify(results.map((r) => ({ ...r })), null, 2));
  }
}

main();
