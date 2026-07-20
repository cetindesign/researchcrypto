import { chromium } from 'playwright-core';
import { marked } from 'marked';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const MAN = '/home/user/researchcrypto/book/manuscript';
const SMP = '/home/user/researchcrypto/book/gumroad/sample';
const OUT = '/home/user/researchcrypto/book/dist';
const SCRATCH = '/tmp/claude-0/-home-user-researchcrypto/7343cb29-b746-5059-82ff-5c45c0a18084/scratchpad/bookbuild';
mkdirSync(OUT, { recursive: true });
marked.setOptions({ gfm: true, breaks: false });

const SHIELD = `<svg class="shield" viewBox="0 0 100 122" xmlns="http://www.w3.org/2000/svg">
  <path d="M50 5 L91 21 V57 C91 87 72 108 50 117 C28 108 9 87 9 57 V21 Z" fill="none" stroke="#d9a94a" stroke-width="3.5"/>
  <path d="M31 61 L44 75 L71 43" fill="none" stroke="#d9a94a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const COVER_HTML = `<section class="cover">
  <div class="cover-top"><div class="eyebrow">FREE SAMPLE</div></div>
  <div class="cover-mid">
    ${SHIELD}
    <h1 class="cover-title">CRYPTO<span class="c101">101</span></h1>
    <div class="cover-sub">Real-World Knowledge for Beginners</div>
    <div class="cover-rule"></div>
    <div class="cover-tag">A free chapter: how to spot and beat every common crypto scam.</div>
  </div>
  <div class="cover-bottom"><div class="cover-foot">Understand it. Buy it. Keep it safe. Spot every scam.</div></div>
</section>`;

const COVER_CSS = `
.cover{ box-sizing:border-box; width:100%; height:100%; page:cover;
  background:linear-gradient(158deg,#0c1a3e 0%,#152a5c 48%,#1d3a79 100%);
  color:#f5f7fc; display:flex; flex-direction:column; justify-content:space-between;
  padding:0.7in 0.62in 0.62in; position:relative; overflow:hidden; }
.cover::before{ content:""; position:absolute; top:-1.4in; right:-1.4in; width:3.6in; height:3.6in;
  border-radius:50%; border:1px solid rgba(217,169,74,0.28);
  box-shadow:0 0 0 26px rgba(217,169,74,0.05), inset 0 0 0 18px rgba(255,255,255,0.03); }
.cover::after{ content:""; position:absolute; bottom:-1.7in; left:-1.2in; width:3.2in; height:3.2in;
  border-radius:50%; background:radial-gradient(circle at center, rgba(76,120,220,0.30), transparent 70%); }
.eyebrow{ font-family:'DejaVu Sans',sans-serif; letter-spacing:0.42em; font-size:11pt; font-weight:700; color:#d9a94a; }
.cover-mid{ position:relative; z-index:2; }
.shield{ width:0.92in; height:auto; display:block; margin-bottom:0.28in; }
.cover-title{ font-family:'DejaVu Sans',sans-serif; font-weight:800; color:#ffffff;
  font-size:58pt; line-height:0.92; letter-spacing:-1pt; margin:0; }
.cover-title .c101{ display:block; color:#d9a94a; font-size:64pt; letter-spacing:2pt; }
.cover-sub{ font-family:'DejaVu Sans',sans-serif; font-weight:400; font-size:17pt; color:#e7ecf7; margin-top:0.16in; }
.cover-rule{ width:1.5in; height:3px; background:#d9a94a; margin:0.28in 0; border-radius:2px; }
.cover-tag{ font-family:'Bitstream Charter','Liberation Serif',serif; font-size:13.5pt; font-style:italic;
  color:#cdd6ec; max-width:3.9in; line-height:1.4; }
.cover-bottom{ position:relative; z-index:2; border-top:1px solid rgba(255,255,255,0.16); padding-top:0.16in; }
.cover-foot{ font-family:'DejaVu Sans',sans-serif; font-size:10.5pt; letter-spacing:0.02em; color:#aeb9d6; }
`;

const INTERIOR_CSS = `
@page{ size:6in 9in; margin:19mm 16mm 18mm 16mm; }
@page cover{ margin:0; }
*{ box-sizing:border-box; } html,body{ margin:0; padding:0; }
body{ font-family:'Bitstream Charter','Liberation Serif',Georgia,serif; color:#20242c; font-size:11pt; line-height:1.56; }
.chapter{ break-before:page; }
h1{ font-family:'DejaVu Sans',sans-serif; color:#16234e; font-size:23pt; line-height:1.12; font-weight:800;
  margin:0 0 0.16in; padding-bottom:0.10in; letter-spacing:-0.3pt; border-bottom:2px solid #d9a94a; }
h2{ font-family:'DejaVu Sans',sans-serif; color:#16234e; font-size:14pt; font-weight:700; margin:0.30in 0 0.06in; }
h3{ font-family:'DejaVu Sans',sans-serif; color:#16234e; font-size:12pt; font-weight:700; margin:0.22in 0 0.05in; }
p{ margin:0 0 0.11in; text-align:justify; hyphens:auto; }
strong{ color:#141821; }
code{ font-family:'DejaVu Sans Mono',monospace; font-size:9.6pt; background:#eef1f8; padding:1px 4px; border-radius:3px; color:#25324f; }
ul,ol{ margin:0 0 0.12in; padding-left:0.26in; } li{ margin:0.03in 0; text-align:left; }
blockquote{ margin:0.16in 0; padding:0.13in 0.18in; background:#f2f5fc; border-left:4px solid #16234e; border-radius:0 6px 6px 0; }
blockquote p{ margin:0; text-align:left; } blockquote strong{ color:#16234e; }
ul:has(li input){ list-style:none; padding-left:0.04in; }
li input[type=checkbox]{ appearance:none; -webkit-appearance:none; width:11px; height:11px; border:1.6px solid #16234e;
  border-radius:3px; display:inline-block; margin-right:8px; vertical-align:middle; position:relative; top:-1px; }
hr{ border:none; border-top:1px solid #d7ddec; margin:0.2in 0; }
`;

const sections = [
  marked.parse(readFileSync(`${SMP}/sample-intro.md`, 'utf8')),
  marked.parse(readFileSync(`${MAN}/07-scam-playbook.md`, 'utf8')),
  marked.parse(readFileSync(`${SMP}/sample-cta.md`, 'utf8')),
].map((h) => `<section class="chapter">${h}</section>`).join('\n');

const fullHTML = `<!doctype html><html><head><meta charset="utf-8"><style>${COVER_CSS}${INTERIOR_CSS}</style></head>
<body>${COVER_HTML}${sections}</body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(fullHTML, { waitUntil: 'networkidle' });
const interim = `${SCRATCH}/sample-interim.pdf`;
await page.pdf({ path: interim, printBackground: true, preferCSSPageSize: true });

// sample cover PNG
const coverDoc = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;}${COVER_CSS}.cover{width:576px;height:864px;}
</style></head><body>${COVER_HTML}</body></html>`;
const cp = await browser.newPage({ viewport: { width: 576, height: 864 }, deviceScaleFactor: 2.6 });
await cp.setContent(coverDoc, { waitUntil: 'networkidle' });
await cp.screenshot({ path: `${OUT}/sample-cover.png` });
await browser.close();

const pdf = await PDFDocument.load(readFileSync(interim));
const font = await pdf.embedFont(StandardFonts.Helvetica);
const pages = pdf.getPages();
for (let i = 1; i < pages.length; i++) {
  const pg = pages[i]; const { width } = pg.getSize(); const label = String(i); const size = 9;
  const w = font.widthOfTextAtSize(label, size);
  pg.drawText(label, { x: width / 2 - w / 2, y: 24, size, font, color: rgb(0.42, 0.46, 0.55) });
}
const finalPath = `${OUT}/Crypto-101-Free-Sample.pdf`;
writeFileSync(finalPath, await pdf.save());
console.log('SAMPLE PAGES:', pages.length);
console.log('SAMPLE PDF:', finalPath);
