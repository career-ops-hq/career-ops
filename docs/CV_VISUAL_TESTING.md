# CV visual regression testing

The suite discovers HTML CV templates through the product's `listTemplates()`
registry, including template packs. Every template renders the same eight
fictional fixtures: English and Simplified Chinese × short and dense content ×
photo and no photo. Dense fixtures exercise long company names, role titles,
dates, URLs, competencies, and skills. No real CV, profile, photo, or external
font is read; template network requests are blocked.

Each case checks printable-width geometry, clipped content, photo overlap,
section headings, PDF text bounds and heading placement, a first-page summary, exact PDF page count,
and preservation of the fixture's text for ATS extraction. The ATS template
intentionally has no photo slot; templates that expose a photo slot must render
the photo fixture. Snapshots cover **every actual PDF page**, rasterized at 72 DPI,
so page breaks and continuation pages are reviewed alongside the first page.

## Canonical Linux run

Run these commands from the repository root with Docker installed:

```bash
docker build --platform linux/amd64 --tag career-ops-cv-visual tests/cv-visual
docker run --rm --init --ipc=host --platform linux/amd64 \
  --volume "$PWD:/work" --volume /work/node_modules \
  career-ops-cv-visual \
  sh -c 'npm install --ignore-scripts --package-lock=false && npm run test:cv-visual'
```

CI uses these same commands and [`tests/cv-visual/Dockerfile`](../tests/cv-visual/Dockerfile).
The Playwright image pins Chromium and its operating system by digest; the dated
Ubuntu archive fixes Liberation Sans/Serif, Noto CJK, and Poppler versions. The
explicit `linux/amd64` platform also applies on Apple Silicon. An anonymous
container volume keeps its Linux `node_modules` separate from host dependencies.
The suite uses one worker, deterministic A4/printable dimensions, UTC, a light color scheme, and a
0.2% per-page pixel tolerance. It waits for fonts and images before rendering.

## Review artifacts

`test-results/cv-visual-artifacts/<template>-<fixture>/` contains `cv.pdf`, each
`page-*.png`, extracted `ats.txt`, and `layout.json` with geometry and pagination
diagnostics. Failures also produce expected, actual, and pixel-diff images under
`test-results/cv-visual-results/`. The CI job uploads both directories on success
and failure, so reviewers can inspect the PDF, every page, and text extraction.

For a failing case, inspect its diagnostics and all PDF pages before changing a
baseline. Pay particular attention to long heading/date rows, content close to
the page edges, headings separated from their body, missing CJK glyphs, and
additional or empty pages. Pixel comparison complements the geometry and ATS
checks; it does not replace visual review.

## Intentional baseline updates

Use the canonical container for all committed snapshots. Do not accept native
macOS, Windows, or ARM screenshots as the Linux baseline.

1. Run the suite and review the rendered PDF pages and diagnostics. Fix
   unexpected clipping, overlap, missing text, or page growth first.
2. When pagination intentionally changes, update the **exact** page count for
   the template/fixture in `tests/cv-visual/baselines.json` after reviewing the
   PDF. Adding a discoverable template requires all eight fixture counts.
3. Generate candidate snapshots in the same image:

   ```bash
   docker run --rm --init --ipc=host --platform linux/amd64 \
     --volume "$PWD:/work" --volume /work/node_modules \
     career-ops-cv-visual \
     sh -c 'npm install --ignore-scripts --package-lock=false && npm run test:cv-visual:update'
   ```

4. Review every changed PNG in `tests/cv-visual/__screenshots__/`. Remove obsolete
   page snapshots if the approved page count decreased. Commit only intentional
   page-count and image changes, then repeat the canonical run without the
   update flag to confirm the baseline matches.

When updating Playwright, update its exact dependency and the Docker image
version/digest together. A font, Poppler, image, or Ubuntu archive-date update
also requires a complete baseline review; do not raise the tolerance to conceal
environment drift.

## Native smoke checks

A native run is useful while editing templates. Install Liberation Sans/Serif,
Noto CJK, and Poppler (`pdftotext` and `pdftoppm`) for your platform, then run:

```bash
npm install --ignore-scripts
npx playwright install chromium
npm run test:cv-visual -- --ignore-snapshots
```

This exercises layout, pagination, and ATS assertions without comparing or
updating committed PNGs. Native fonts and rasterizers can still alter geometry
or page counts, so investigate differences in the canonical container before
changing the expected result. A native smoke check does not replace the Linux
snapshot gate or the full `node test-all.mjs` contribution gate.
