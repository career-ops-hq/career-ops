// tests/modes-readme-report-blocks.test.mjs — every localized mode README that
// lists its evaluation mode describes the report as A-H.
//
// #5844 moved eleven localized evaluation modes to the A-H report and updated
// their READMEs. Eight more READMEs (ar, es, ja, ru, tr, vi, zh, zh-TW) kept
// "A-F", "A-G" or "A-F + G" after their modes had Block H, because nothing
// read them. tests/readme-hitl-markers.test.mjs does this for the root
// READMEs; this is the same check for modes/*/README.md.
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nMode READMEs — the evaluation mode is described as A-H');

const readmes = readdirSync(join(ROOT, 'modes'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'modes', d.name, 'README.md')))
  .map((d) => `modes/${d.name}/README.md`)
  .sort();

// A README describes an evaluation mode when its file table maps one to an
// evaluation source: modes/oferta.md, or another locale's (nl maps to
// modes/fr/offre.md). modes/interview/README.md maps none.
const EVAL_SOURCE = /`modes\/(?:[\w-]+\/)?(?:oferta|offre)\.md`/;
const describing = readmes.filter((rel) => EVAL_SOURCE.test(readFileSync(join(ROOT, rel), 'utf8')));
if (describing.length >= 20) pass(`${describing.length} mode READMEs describe an evaluation mode`);
else fail(`only ${describing.length} mode READMEs map a file to an evaluation mode — the scan is matching less than it should`);

for (const rel of describing) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const stale = text.match(/\bA\s*[-–]\s*[FG]\b/);
  if (stale) fail(`${rel} still says "${stale[0]}" — the report runs A-H`);
  else if (/\bA\s*[-–]\s*H\b/.test(text)) pass(`${rel} describes the report as A-H`);
  else fail(`${rel} never names the A-H report structure`);
}
