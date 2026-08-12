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
} finally {
  rmSync(fontPath, { force: true });
  // Remove fonts/ only if this test created it; leave a pre-existing repo dir.
  if (fontsDirCreated) rmSync(fontsDir, { recursive: true, force: true });
}
