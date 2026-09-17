# CV visual regression testing

The first visual-regression slice renders the standard HTML CV template against
four sanitized fixtures: English and Simplified Chinese, short and dense
content, and photo/no-photo layouts. It combines screenshot baselines with
geometry, page-count, and ATS text-extraction gates. Additional templates can be
added in separately reviewed follow-ups once this harness is stable.

## Run locally

Install Chromium and Poppler (`pdftotext`), then run:

```bash
npx playwright install chromium
npm run test:cv-visual
```

Rendered PDFs and PNG previews are written to
`test-results/cv-visual-artifacts/`. On failure, Playwright writes the expected,
actual, and pixel-diff images under `test-results/cv-visual-results/`.

## Intentional baseline updates

When a reviewed template change intentionally alters layout:

```bash
npm run test:cv-visual:update
npm run test:cv-visual
```

Review every changed PNG rather than accepting snapshots mechanically. Update
`test/cv-visual/baselines.json` only when the expected PDF page range changes.
Unexpected page growth, even with a visually acceptable screenshot, should be
treated as a regression until the new density is explicitly approved.

The suite uses a single Chromium worker, fixed viewport, UTC timezone, light
color scheme, and a 4% pixel tolerance to absorb minor platform font-rasterizer
differences without hiding structural changes. CI installs Noto CJK and Poppler
so Chinese glyph coverage and extracted PDF text are both tested.
