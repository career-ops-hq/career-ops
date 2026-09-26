/**
 * inlineLocalFonts memoization (#2384).
 *
 * A batch render inlines the same fonts once per document; without a cache each
 * document re-reads and re-base64s every font file. This verifies the encoded
 * data: URL is memoized by resolved path: after the font file is deleted, a
 * second call still inlines it (served from the cache) and returns byte-identical
 * output — proving both the re-read is skipped and determinism is preserved.
 */
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { inlineLocalFonts } from '../generate-pdf.mjs';

const fontsDir = join(ROOT, 'fonts');
const fontName = `__cache-probe-${process.pid}.woff2`;
const fontPath = join(fontsDir, fontName);
const bytes = Buffer.from('CACHE_PROBE_FONT_BYTES');
const expectedB64 = bytes.toString('base64');
const html = `<style>@font-face{font-family:probe;src:url('./fonts/${fontName}')}</style>`;

// A distinct probe (separate path → separate cache key) for the miss path:
// inlineLocalFonts must NOT cache a missing font, so one added mid-run is picked
// up on the next call.
const missName = `__miss-probe-${process.pid}.woff2`;
const missPath = join(fontsDir, missName);
const missBytes = Buffer.from('MISS_PROBE_FONT_BYTES');
const missB64 = missBytes.toString('base64');
const missHtml = `<style>@font-face{font-family:miss;src:url('./fonts/${missName}')}</style>`;

// A checkout may not carry a fonts/ dir; writeFileSync below needs it to exist.
// Track whether we created it so cleanup never deletes a real repo fonts/ dir.
const fontsDirCreated = !existsSync(fontsDir);
if (fontsDirCreated) mkdirSync(fontsDir, { recursive: true });

try {
  writeFileSync(fontPath, bytes);

  const first = await inlineLocalFonts(html);
  // Delete the source: only an in-memory cache can serve the next call.
  rmSync(fontPath, { force: true });
  const second = await inlineLocalFonts(html);

  if (
    first.includes(expectedB64) &&
    first === second &&
    !second.includes(`./fonts/${fontName}`)
  ) {
    pass('inlineLocalFonts memoizes encoded fonts by path (batch renders skip re-reads)');
  } else {
    fail(
      `font cache regressed: firstHasBase64=${first.includes(expectedB64)} ` +
      `identical=${first === second} fellBackToRawRef=${second.includes(fontName)}`,
    );
  }

  // Uncached miss: call while the font is absent (keeps the raw ref, no Base64),
  // then create it and call again — the second call must inline it, proving the
  // ENOENT result was never cached and a font added mid-run is picked up.
  const before = await inlineLocalFonts(missHtml);
  writeFileSync(missPath, missBytes);
  const after = await inlineLocalFonts(missHtml);

  if (
    before.includes(`./fonts/${missName}`) &&
    !before.includes(missB64) &&
    after.includes(missB64)
  ) {
    pass('inlineLocalFonts does not cache missing fonts (one added mid-run is inlined)');
  } else {
    fail(
      `font miss caching regressed: beforeKeptRawRef=${before.includes(`./fonts/${missName}`)} ` +
      `beforeHadBase64=${before.includes(missB64)} afterInlined=${after.includes(missB64)}`,
    );
  }
} finally {
  rmSync(fontPath, { force: true });
  rmSync(missPath, { force: true });
  // Remove fonts/ only if this test created it; leave a pre-existing repo dir.
  if (fontsDirCreated) rmSync(fontsDir, { recursive: true, force: true });
}
