# clean-markers — strip renderer "tells" from generated output

`generate-pdf.mjs` renders résumés with Playwright/Chromium, which stamps every PDF's Info dictionary
with `Creator: Chromium` and `Producer: Skia/PDF`. It's harmless, but "Chromium" looks out of place on a
résumé, and some applicants prefer their generated documents to carry no toolchain fingerprint. Text
sources can also accumulate invisible Unicode (zero-width spaces, bidi controls, tag characters, soft
hyphens, non-breaking spaces) that read as machine-generated.

`clean-markers.mjs` audits and optionally strips both — for PDFs and text files.

## Usage

```bash
node clean-markers.mjs audit  output/acme-cv.pdf          # report only, never modifies
node clean-markers.mjs clean  --author "Jane Doe" output/acme-cv.pdf
node clean-markers.mjs clean  --ascii output/cover-letter.md   # also normalize smart quotes / dashes
node clean-markers.mjs audit  output/*.pdf output/*.html       # globs OK
```

- **`audit`** never modifies a file — use it to *prove* a document is clean. Exit code `1` if any file
  FAILS, so it works as a pre-send gate in a script or CI step.
- **`clean`** removes `Creator`/`Producer` from PDFs and sets `Author` (blank by default, or `--author`),
  and strips invisible Unicode from text files (NBSP→space; zero-width/bidi/tag/soft-hyphen dropped).
- **`--ascii`** (clean, text only) additionally converts curly quotes → straight, em/en-dash → hyphen,
  ellipsis → `...` — handy for plain-text cover letters or emails.

## When to run

Right after `generate-pdf.mjs`, before the résumé leaves your machine:

```bash
node generate-pdf.mjs output/acme-cv.html output/acme-cv.pdf
node clean-markers.mjs clean --author "Jane Doe" output/acme-cv.pdf
```

## Dependencies

None required up front. PDF metadata editing uses `pdf-lib`, **auto-installed on demand** the first time
`clean` touches a PDF; the text/byte audit is pure Node stdlib. It does **not** alter visible résumé
content (real punctuation stays) unless you pass `--ascii`.
