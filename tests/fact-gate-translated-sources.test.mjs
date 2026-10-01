// tests/fact-gate-translated-sources.test.mjs — a CV written in English must be
// able to cite counts whose evidence is in a Spanish cv.md.
//
// `modes/_custom.md` and the `pdf` mode let a user keep cv.md in their own
// language and generate each CV in the language of the posting. The fact gate
// extracts counts from BOTH sides with the same English-only METRIC_NOUNS, so
// the source line "una autorización que leía 43 documentos pasó a leer 1"
// yielded no claim, and the faithful translation "went from 43 documents to 1"
// was blocked as a fabricated "43 documents" — a real metric the user had to
// delete from the CV to get it rendered.
//
// The fix widens only what counts as EVIDENCE: sources are also read with a
// Spanish noun lexicon folded onto the English canonical nouns. The generated
// document is still read exactly as before, so a Spanish CV gains no new
// claims and nothing that passed before can start failing.
//
// Run:  node --test tests/fact-gate-translated-sources.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyFacts } from '../verify-cv-facts.mjs';

function withSource(sourceText, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fact-gate-es-'));
  try {
    const src = join(dir, 'cv.md');
    writeFileSync(src, sourceText);
    return fn({ sourcePaths: [src], configPath: join(dir, 'no-config.json') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an English count translated from a Spanish source is evidenced', () => {
  withSource('- una autorización que leía 43 documentos pasó a leer 1.', (opts) => {
    const r = verifyFacts('An authorization check went from reading 43 documents to 1.', opts);
    assert.deepEqual(r.invented, []);
  });
});

test('accented Spanish nouns and time units are read as evidence', () => {
  withSource('Proyecto para cliente — 2025 · ~3 meses. Más de 10 años de uso de Linux en 4 países.', (opts) => {
    const r = verifyFacts('Client project, ~3 months. 10 years of Linux across 4 countries.', opts);
    assert.deepEqual(r.invented, []);
  });
});

test('a translated count that does NOT match the source is still caught', () => {
  withSource('Lideré a 20 ingenieros en 3 unidades.', (opts) => {
    const r = verifyFacts('Led 45 engineers across 3 units.', opts);
    assert.deepEqual(r.invented, ['45 engineers']);
  });
});

test('a Spanish generated document gains no new claims', () => {
  withSource('Sin conteos acá.', (opts) => {
    const r = verifyFacts('Gestioné 45 empleados en 3 instalaciones.', opts);
    assert.deepEqual(r.invented, [], 'target-side extraction is unchanged by this fix');
  });
});
