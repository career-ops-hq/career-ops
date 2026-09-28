// tests/evaluator-score-cell.test.mjs — normalizedTrackerScore parses the score
// and emits a cell the tracker's readers accept, and it exists exactly once.
//
// This suite used to lift each evaluator's private copy out of its source and
// evaluate it standalone, because four copies existed and the evaluators run on
// import (arg parse + network) so the helper could not be imported. The copies
// have since been consolidated into lib/tracker-addition.mjs
// (career-ops-hq/career-ops#3796), so the behaviour half is a plain import.
//
// The discovery half stays, inverted: rather than sweeping for copies to test,
// it now asserts there are none. A fifth evaluator that grows its own
// normalizedTrackerScore is caught the day it lands, which is what kept
// `gemini-eval.mjs`'s concatenating version alive next to a sibling that had
// been immune to the same input the whole time.
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';
import { looksLikeScoreCell } from '../tracker-parse.mjs';
import { normalizedTrackerScore } from '../lib/tracker-addition.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('\nevaluators — normalizedTrackerScore emits a parseable score cell');

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
for (const [input, expected] of cases) {
  const got = normalizedTrackerScore(input);
  if (got !== expected) {
    problems.push(`${JSON.stringify(input)} -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  }
  // Whatever the helper decides to return, the tracker's readers have to accept it.
  if (!looksLikeScoreCell(got)) {
    problems.push(`${JSON.stringify(input)} -> ${JSON.stringify(got)}, which looksLikeScoreCell rejects`);
  }
}

if (problems.length === 0) {
  pass(`normalizedTrackerScore parses the score and emits a cell every reader accepts (${cases.length} cases)`);
} else {
  fail(`score-cell normalization broken: ${problems.join('; ')}`);
}

// ── Single-sourcing (#3796) ────────────────────────────────────────────────
// Discovery by definition, as before, but the answer must now be zero. Scanning
// root and lib/ covers where an evaluator or a helper module would put one.
const HOME = 'lib/tracker-addition.mjs';
const SHARED = ['tsvSafe', 'slugifyCompany', 'isPostingUrl', 'normalizedTrackerScore'];
// Declarations AND function-valued bindings. Matching only `function NAME(`
// missed the shape a re-added copy is most likely to take today --
// `const normalizedTrackerScore = (value) => ...` -- which would sail past a
// guard whose whole job is to notice a second definition.
const defRe = (name) => new RegExp(
  `^(?:export\\s+)?(?:function\\s+${name}\\s*\\(`
  + `|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s+)?(?:function\\b|\\(|[A-Za-z_$][\\w$]*\\s*=>))`,
  'm',
);

const scanned = [
  ...readdirSync(ROOT).filter(n => n.endsWith('.mjs')),
  ...readdirSync(join(ROOT, 'lib')).filter(n => n.endsWith('.mjs')).map(n => `lib/${n}`),
].filter(rel => rel !== HOME);

const rogue = [];
for (const rel of scanned) {
  const src = readFileSync(join(ROOT, rel), 'utf-8');
  for (const name of SHARED) {
    if (defRe(name).test(src)) rogue.push(`${rel} defines ${name}`);
  }
}

if (rogue.length === 0) {
  pass(`the tracker-addition helpers are defined once, in ${HOME} (${scanned.length} files scanned)`);
} else {
  fail(`private copies of the tracker-addition helpers are back — import them from ${HOME} instead: ${rogue.join('; ')}`);
}
