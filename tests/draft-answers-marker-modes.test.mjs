// tests/draft-answers-marker-modes.test.mjs - every evaluation mode must mark
// its draft-answers block.
//
// This is the guard for the way #3884 happened in the first place. The reader
// matched one exact heading, `## H) Draft Application Answers`, and each new
// localized mode translated the name, moved the block to `G)`, or both. Nothing
// failed: `parseDraftAnswersBlockH` returned null, which its contract spells
// "this report has no draft block", so `modes/apply.md` regenerated answers the
// evaluation had already written. Silent, and only for non-English users.
//
// A reader keyed on the `(draft)` marker fixes the sixteen modes that exist
// today, but it cannot stop the seventeenth from arriving unmarked — the same
// silent failure, one locale later. So the marker is asserted here, against the
// modes themselves, rather than left to a fixture that only proves the parser
// works on headings someone remembered to write.
//
// Evaluation modes are counted by the property, never by filename: only eight
// of the nineteen are named oferta.md (the rest are fursah.md, angebot.md,
// offre.md, naukri.md, lowongan.md, annuncio.md, kyujin.md, gonggo.md,
// vacature.md, is-ilani.md), so a sweep by expected name misses exactly the
// files most likely to drift. `^## F)` is the marker of an A-H evaluation mode
// and is the same property web/src/lib/report-sections.mjs counts on.

import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';

console.log('\nmodes/ - every evaluation mode marks its draft-answers block with (draft)');

try {
  const modesDir = join(ROOT, 'modes');
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(modesDir)) {
    const full = join(modesDir, entry);
    if (statSync(full).isDirectory()) {
      for (const inner of readdirSync(full)) {
        if (inner.endsWith('.md')) files.push(join(full, inner));
      }
    } else if (entry.endsWith('.md')) {
      files.push(full);
    }
  }

  // An evaluation mode is one that specifies the lettered A-H report structure.
  const evaluationModes = files.filter(f => /^## F\)/m.test(readFileSync(f, 'utf-8')));

  if (evaluationModes.length >= 19) {
    pass(`found ${evaluationModes.length} evaluation modes by structure (^## F\\))`);
  } else {
    fail(`expected at least 19 evaluation modes, found ${evaluationModes.length} — has the report structure changed?`);
  }

  const unmarked = [];
  const duplicated = [];
  for (const file of evaluationModes) {
    const text = readFileSync(file, 'utf-8');
    const marked = [...text.matchAll(/^##\s+.*\(draft\)\s*$/gim)];
    const rel = file.slice(ROOT.length + 1);
    if (marked.length === 0) unmarked.push(rel);
    else if (marked.length > 1) duplicated.push(`${rel} (${marked.length})`);
  }

  if (unmarked.length === 0) {
    pass(`all ${evaluationModes.length} evaluation modes write a (draft)-marked heading`);
  } else {
    fail(
      'evaluation modes with no (draft) marker — parseDraftAnswersBlockH cannot find their ' +
      `draft block, so apply mode will silently regenerate every answer:\n  ${unmarked.join('\n  ')}`,
    );
  }

  if (duplicated.length === 0) {
    pass('no evaluation mode marks two headings (draft)');
  } else {
    fail(`(draft) marker is ambiguous in:\n  ${duplicated.join('\n  ')}`);
  }

  // The marker has to survive the reader, not just exist in the file. Pull each
  // mode's real heading line and run it through the parser with a minimal body.
  const { parseDraftAnswersBlockH } = await import(
    new URL('../application-answers.mjs', import.meta.url).href
  );
  const unreadable = [];
  for (const file of evaluationModes) {
    const heading = /^##\s+.*\(draft\)\s*$/im.exec(readFileSync(file, 'utf-8'))?.[0];
    if (!heading) continue;
    const got = parseDraftAnswersBlockH(`${heading}\n\n**Q?**\nA.\n`);
    if (got?.freeText?.length !== 1) unreadable.push(`${file.slice(ROOT.length + 1)}: ${heading}`);
  }

  if (unreadable.length === 0) {
    pass('every mode\'s actual heading line parses back into a question/answer pair');
  } else {
    fail(`headings the parser cannot read:\n  ${unreadable.join('\n  ')}`);
  }
} catch (e) {
  fail(`draft-answers marker coverage crashed: ${e.stack || e.message}`);
}
