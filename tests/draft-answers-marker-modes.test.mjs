// tests/draft-answers-marker-modes.test.mjs: every evaluation mode marks its
// draft-answers block with `(draft)`.
//
// This is the guard for the way #3884 happened in the first place. The reader
// matched one exact heading, `## H) Draft Application Answers`, and each new
// localized mode translated the name, moved the block to `G)`, or both. Nothing
// failed: `parseDraftAnswersBlockH` returned null, which its contract spells
// "this report has no draft block", so `modes/apply.md` regenerated answers the
// evaluation had already written. Silent, and only for non-English users.
//
// The reader now looks for the `(draft)` marker first (#4432), then the English
// name, then the `H)` letter (#4400). The letter rule reads today's translated
// headings only because every mode happens to keep `H)` since #5843; the marker
// is the rule that does not depend on the letter or the language. So the marker
// is asserted here, against the modes themselves, rather than left to a fixture
// that only proves the parser works on headings someone remembered to write.
//
// Evaluation modes are counted by structure, never by filename: most are not
// named oferta.md (fursah, angebot, offre, naukri, lowongan, annuncio, kyujin,
// gonggo, stilling, vacature, is-ilani, tuyen-dung), so a sweep by expected
// name misses exactly the files most likely to drift. `^## F)` is the marker of
// an A-H evaluation mode, the same property web/src/lib/report-sections.mjs
// counts on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDraftAnswersBlockH } from '../application-answers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MODES = join(ROOT, 'modes');
const MARKED_HEADING = /^##[ \t]+.*\(draft\)[ \t]*$/gim;

/** Every mode file: modes/*.md and modes/<lang>/*.md. */
function modeFiles() {
  const files = [];
  for (const entry of readdirSync(MODES)) {
    const full = join(MODES, entry);
    if (statSync(full).isDirectory()) {
      for (const inner of readdirSync(full)) {
        if (inner.endsWith('.md')) files.push(join(full, inner));
      }
    } else if (entry.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

const evaluationModes = modeFiles()
  .filter(f => /^## F\)/m.test(readFileSync(f, 'utf-8')))
  .map(f => ({ rel: relative(ROOT, f), text: readFileSync(f, 'utf-8') }));

/** A one-question Block H body under `heading`. */
const report = (heading) => `# Report\n\n${heading}\n\n**Why this role?**\n\nBecause.\n\n## Risk Summary\n\nNone.\n`;

test('evaluation modes are found by structure (^## F))', () => {
  // 21 today. A drop means the report structure changed and this suite would
  // otherwise pass while checking nothing.
  assert.ok(evaluationModes.length >= 21,
    `expected at least 21 evaluation modes, found ${evaluationModes.length}`);
});

for (const { rel, text } of evaluationModes) {
  test(`${rel} marks exactly one heading (draft), and it is the H) block`, () => {
    const marked = [...text.matchAll(MARKED_HEADING)].map(m => m[0]);
    assert.equal(marked.length, 1,
      marked.length === 0
        ? 'no (draft) marker: a report from this mode is found only by its letter'
        : `the marker is ambiguous: ${marked.join(' | ')}`);
    assert.match(marked[0], /^## H\) \S/,
      'the marker must sit on the draft-answers block, which every mode defines as H)');
  });

  test(`${rel}: its own heading parses, and still parses under another letter`, () => {
    const heading = text.match(MARKED_HEADING)?.[0];
    assert.ok(heading, 'no (draft)-marked heading to read');

    const asWritten = parseDraftAnswersBlockH(report(heading));
    assert.equal(asWritten?.freeText?.length, 1, `cannot read "${heading}"`);

    // The case only the marker covers. A model that drops or merges a block
    // shifts the letters, and the letter rule then has no `H)` to find; for a
    // translated name the English-name rule cannot help either.
    const moved = parseDraftAnswersBlockH(report(heading.replace(/^## H\)/, '## I)')));
    assert.equal(moved?.freeText?.length, 1,
      `"${heading}" is lost once its letter moves: the marker is not what finds it`);
  });
}
