# Book build

Generates the sales-ready PDF and cover image from the Markdown in `../manuscript/`.

## Output (`../dist/`)
- `Crypto-101-Real-World-Knowledge-for-Beginners.pdf` — 6x9" book PDF (cover + interior + page numbers)
- `cover.png` — standalone cover image (2:3) for the Gumroad thumbnail

## How it works
`build.mjs` converts each chapter with **marked**, wraps it in print-styled HTML
(cover page via a named `@page`, justified serif body, callout boxes, task-list
checkboxes), renders to PDF with **Chromium** (via `playwright-core`, using the
pre-installed browser), then stamps page numbers with **pdf-lib**.

## Requirements
- Node 18+
- Chromium at `/opt/pw-browsers/chromium` (pre-installed in this environment)
- npm deps: `marked`, `playwright-core`, `pdf-lib`

## Run
```bash
npm install marked playwright-core pdf-lib
node build.mjs
```

## Style rule
No em dash characters anywhere in the book. See `../PLAN.md` for the full style rules.
