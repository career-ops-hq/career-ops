// tests/readme-hitl-markers.test.mjs — every README (English and translated)
// must carry the HITL guarantee marker, inside the table row it anchors.
//
// The Human-in-the-Loop row is the product's central guarantee, and it is the
// line translations weaken first: an audit found 10 of 16 translated READMEs
// hedging it — a manner adverb ("automatically"), an emphatic reflexive ("by
// itself"), or worst, a conditional ("without your permission") that turns an
// absolute prohibition into an implied opt-in. The fix planted an invisible
// marker in the row of all 17 files stating the rule for future translators:
//
//   <!-- hitl: absolute guarantee. Do not add ... -->
//
// An anchor nobody reads protects nothing. This file is the reader: a
// translation that drops the marker, or moves it out of the row (on its own
// line it SPLITS the rendered table — verified against GitHub's renderer:
// 2 <tr> instead of 4), fails here.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nREADME HITL markers — the guarantee row keeps its anchor');

const MARKER = '<!-- hitl: absolute guarantee.';
const readmes = readdirSync(ROOT).filter((f) => /^README[\w.-]*\.md$/.test(f)).sort();

// The whole family must be present: a marker check over an empty (or
// mis-globbed) list would pass vacuously, which is exactly the blind-check
// class this suite exists to avoid.
if (readmes.length >= 17) pass(`found ${readmes.length} README files (17 expected as of Aug 2026)`);
else fail(`only ${readmes.length} README*.md files found — glob broken or files removed`);

for (const file of readmes) {
  const content = readFileSync(join(ROOT, file), 'utf8');
  const count = content.split(MARKER).length - 1;
  if (count !== 1) {
    fail(`${file}: expected exactly 1 HITL marker, found ${count}`);
    continue;
  }
  const line = content.split('\n').find((l) => l.includes(MARKER)) ?? '';
  // Inside the row means inside a table line: starts with a pipe and carries
  // row content around the comment. A marker on its own line renders as a
  // table-splitting paragraph, silently breaking the layout in 17 languages.
  // The row label itself is translated ("Humain dans la Boucle", "人机协同"),
  // so the marker text is the row's identity — do not grep for English here.
  if (!line.trimStart().startsWith('|') || (line.match(/\|/g) || []).length < 2) {
    fail(`${file}: HITL marker sits outside a table row (own line splits the table)`);
  } else {
    pass(`${file}: marker present, inside its table row`);
  }

  // Wholesale-drift control: every README describes the report as A-H. This
  // deliberately does NOT try to catch phrasing variants (French and Arabic
  // write ranges with a preposition, "de A à F" / "من A إلى F", which is how
  // two stale lines survived three sweeps in Aug 2026) — variants need human
  // audit; this only catches a translation with no current structure at all.
  if (content.includes('A-H') || content.includes('A–H')) {
    pass(`${file}: mentions the A-H report structure`);
  } else {
    fail(`${file}: never mentions A-H — translation predates the current report structure`);
  }
}
