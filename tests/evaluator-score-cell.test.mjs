// tests/evaluator-score-cell.test.mjs — every evaluator's normalizedTrackerScore
// must parse the score and emit a cell the tracker's readers accept.
//
// The evaluators run on import (arg parse + network), so the helper cannot be
// imported for a unit test. Each copy is lifted out of its source and evaluated
// standalone instead. Discovery is by definition, not by a filename list: any
// root-level script that grows its own normalizedTrackerScore is covered the day
// it lands, which is the only way this stays honest while four copies exist
// (career-ops-hq/career-ops#3796).
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';
import { looksLikeScoreCell } from '../tracker-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('\nevaluators — normalizedTrackerScore emits a parseable score cell');

const helperRe = (name) => new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`, 'm');

const copies = readdirSync(ROOT)
  .filter(name => name.endsWith('.mjs'))
  .map(name => [name, readFileSync(join(ROOT, name), 'utf-8')])
  .filter(([, src]) => helperRe('normalizedTrackerScore').test(src));

// The inputs that separate a parsing implementation from a concatenating one.
// `4.2 (final)`, `4.2 (internal)` and `4.5 - strong signal` all contain the bare
// substring `na`, which an unanchored /n\/?a/i guard turned into `N/A` — a
// completed evaluation recorded as unscored. `8/10` and `4.2/10` are the mirror
// image: a wrong denominator reinterpreted as `8/5` merges as a genuine score.
const cases = [
  ['4.2',                 '4.2/5'],
  ['4.2/5',               '4.2/5'],
  ['4.2 (strong fit)',    '4.2/5'],
  ['4.2 (strong fit)/5',  '4.2/5'],
  ['4.2 (strong fit)/10', 'N/A'],
  // The first fraction stays authoritative: a later `/5` must not mask an
  // unrelated `3/4` earlier in the cell. Refusing here is the documented
  // trade-off for taking the denominator wherever it sits, and it is pinned so
  // nobody quietly relaxes it into guessing a score.
  ['4.2 (fit 3/4 axes)/5', 'N/A'],
  ['4.2 (fit 3/4 axes)',   'N/A'],
  ['4.2 (final)',         '4.2/5'],
  ['4.2 (internal)',      '4.2/5'],
  ['4.5 - strong signal', '4.5/5'],
  ['4.2 (N/A noted)',     '4.2/5'],
  ['5',                   '5/5'],
  ['0',                   '0/5'],
  ['8/10',                'N/A'],
  ['4.2/10',              'N/A'],
  ['7',                   'N/A'],
  ['-1',                  'N/A'],
  ['80%',                 'N/A'],
  ['?',                   'N/A'],
  ['',                    'N/A'],
  [undefined,             'N/A'],
  ['N/A',                 'N/A'],
  ['n/a',                 'N/A'],
  ['unknown',             'N/A'],
];

const problems = [];
for (const [name, src] of copies) {
  const tsv  = src.match(helperRe('tsvSafe'));
  const norm = src.match(helperRe('normalizedTrackerScore'));
  if (!tsv || !norm) { problems.push(`${name}: could not lift the helpers out of the source`); continue; }
  let fn;
  try {
    fn = new Function(`${tsv[0]}\n${norm[0]}\nreturn normalizedTrackerScore;`)();
  } catch (err) {
    problems.push(`${name}: helpers do not evaluate standalone (${err.message})`);
    continue;
  }
  for (const [input, expected] of cases) {
    const got = fn(input);
    if (got !== expected) {
      problems.push(`${name}: ${JSON.stringify(input)} -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    }
    // Whatever a copy decides to return, the tracker's readers have to accept it.
    if (!looksLikeScoreCell(got)) {
      problems.push(`${name}: ${JSON.stringify(input)} -> ${JSON.stringify(got)}, which looksLikeScoreCell rejects`);
    }
  }
}

if (copies.length < 2) {
  fail(`expected the helper in at least two evaluators, found ${copies.length} (${copies.map(([n]) => n).join(', ') || 'none'}) — the helper moved, so this suite is no longer guarding anything`);
} else if (problems.length === 0) {
  pass(`all ${copies.length} normalizedTrackerScore copies (${copies.map(([n]) => n).join(', ')}) parse the score and emit a cell every reader accepts`);
} else {
  fail(`score-cell normalization broken: ${problems.join('; ')}`);
}
