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

  // The marker is an anchor, and until now nothing read what it anchors: a
  // README whose row had been hedged still passed, because the comment was
  // present and inside a table row. That is the wrong half to check on its own.
  //
  // The hedge cannot be caught in 17 languages, but it does not have to be.
  // Every translation is derived from the English source, so a hedge that
  // enters there propagates to all of them faithfully -- with every marker
  // still in place and this suite still green. Checking README.md is what
  // closes that door; the marker check continues to carry the translations.
  if (file === 'README.md') {
    // Remove the comment before scanning: the marker QUOTES the hedges it
    // forbids, so a scan of the raw line matches the anchor's own warning
    // text and fails a correctly-worded row.
    //
    // Sliced at the marker's own bounds rather than stripped with
    // /<!--[\s\S]*?-->/g. CodeQL flags that pattern as incomplete
    // multi-character sanitization, and the objection holds here: an unclosed
    // comment leaves a bare `<!--` sitting in `prose`, so a row whose comment
    // lost its `-->` would be scanned with the anchor text still in it and the
    // hedge check would fail for a reason that has nothing to do with hedging.
    // The marker's position is already known, so exact bounds are available —
    // and an unclosed comment becomes its own named failure instead.
    const mStart = line.indexOf(MARKER);
    const mEnd = line.indexOf('-->', mStart);
    // Not `continue` — that would skip the A-H check further down for this
    // file, hiding a second problem behind the first.
    const prose = mEnd === -1 ? null : line.slice(0, mStart) + line.slice(mEnd + '-->'.length);
    if (prose === null) {
      fail(`${file}: the HITL marker comment is never closed with -->`);
    } else if (/never submits an application/i.test(prose)) {
      pass(`${file}: the row states the prohibition in absolute terms`);
    } else {
      fail(`${file}: the HITL row no longer says "never submits an application"`);
    }
    const HEDGES = /\b(usually|generally|normally|typically|by default|unless|without your permission|automatically|by itself)\b/i;
    const hedge = prose === null ? null : prose.match(HEDGES);
    if (prose === null) {
      // Already reported above; do not also claim the row is hedge-free, which
      // would be a green tick on a line that was never successfully read.
    } else if (hedge) {
      fail(`${file}: the HITL row hedges with "${hedge[0]}" -- the guarantee is absolute, not a default`);
    } else {
      pass(`${file}: no hedge in the guarantee row`);
    }
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
