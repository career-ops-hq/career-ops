// tests/generate-pdf-middot.test.mjs — normalizeTextForATS turns a middle dot
// separator into " | " but keeps the Catalan l·l (ela geminada), which is a
// letter inside a word, not a separator.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ngenerate-pdf.mjs — Catalan l·l survives ATS normalization');

const { normalizeTextForATS } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
const body = (html) => normalizeTextForATS(`<p>${html}</p>`).html;

const cases = [
  ['Expert en intel·ligència artificial i col·laboració', 'Expert en intel·ligència artificial i col·laboració'],
  ['INTEL·LIGÈNCIA ARTIFICIAL', 'INTEL·LIGÈNCIA ARTIFICIAL'],
  ['Python · Go · SQL', 'Python | Go | SQL'],
  ['Barcelona·Madrid', 'Barcelona | Madrid'],
  ['Col·legi · Barcelona', 'Col·legi | Barcelona'],
];
for (const [input, want] of cases) {
  const got = body(input);
  if (got === `<p>${want}</p>`) pass(`"${input}" -> "${want}"`);
  else fail(`"${input}" became ${got}, want <p>${want}</p>`);
}

const { replacements } = normalizeTextForATS('<p>intel·ligència · dades</p>');
if (replacements.middot === 1) pass('counts only the separator as a middot replacement');
else fail(`middot count wrong: ${JSON.stringify(replacements)}`);
