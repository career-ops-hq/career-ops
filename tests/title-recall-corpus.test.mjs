// tests/title-recall-corpus.test.mjs — a recall regression corpus for the shared
// title matcher (title-keywords.mjs).
//
// #3103 and #3104 established the guarantee this file exists to keep: a change to
// keyword matching must not silently stop matching real roles. Both directions of
// that change are invisible in normal operation. A matcher that newly matches too
// much shows up as noise someone eventually complains about; a matcher that stops
// matching shows up as nothing at all — the scan summary reports one lower number,
// which is indistinguishable from a quiet week on the boards. #2544 is the same
// observation about the title filter's single "filtered by title" counter.
//
// The anchoring decision on #2970 turned on exactly this evidence: measuring a
// proposed default against a real corpus showed it dropped "Engineering Lead -
// Crypto and DeFi", and that one recall loss is what settled the design. Without a
// corpus in the repo, the next such proposal has to rebuild one from scratch, in a
// contributor's private scan history, where nobody else can check it.
//
// A diff in this fixture is therefore not automatically a bug. It is always a
// decision: regenerate the fixture in the same commit that changes the matcher, and
// say in the commit message which titles moved and why. What must not happen is
// finding out months later.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { buildTitleFilter } from '../title-keywords.mjs';

console.log('\ntitle recall corpus — real titles, checked against the current matcher');

const FIXTURE = join(ROOT, 'tests', 'fixtures', 'title-recall-corpus.json');
const corpus = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
const filter = buildTitleFilter(corpus.title_filter);

// 1. The whole corpus, in one pass. Reporting the first few drifts by name matters
//    more than the count: "12 titles changed" sends you to a diff, "Solana Program
//    Engineer no longer matches" sends you to the cause.
const drift = corpus.titles.filter(({ title, matches }) => filter(title) !== matches);
if (drift.length === 0) {
  pass(`all ${corpus.titles.length} corpus titles match the recorded verdict`);
} else {
  const lost = drift.filter(d => d.matches);      // matched before, does not now
  const gained = drift.filter(d => !d.matches);   // newly matching
  const sample = drift.slice(0, 8)
    .map(d => `    ${d.matches ? 'LOST  ' : 'GAINED'} ${d.title}`).join('\n');
  fail(`${drift.length} corpus titles drifted (${lost.length} lost, ${gained.length} gained):\n${sample}` +
       (drift.length > 8 ? `\n    ... and ${drift.length - 8} more` : '') +
       `\n  If the change is intended, regenerate ${FIXTURE} in the same commit.`);
}

// 2. A corpus that matched nothing, or everything, would pass assertion 1 forever
//    while guarding nothing — the fixture could be silently emptied or the filter
//    reduced to a no-op and the suite would stay green. Pin both edges.
const matching = corpus.titles.filter(t => t.matches).length;
if (matching > 0 && matching < corpus.titles.length) {
  pass(`corpus discriminates: ${matching} match, ${corpus.titles.length - matching} do not`);
} else {
  fail(`corpus is degenerate: ${matching}/${corpus.titles.length} match — it can no longer detect a matcher change`);
}

// 3. The specific bleeds named in #3103, and the recall case that decided #2970,
//    pinned by name so a failure says which documented behaviour broke rather than
//    just "a title drifted".
//
//    Most are real corpus entries. Two are synthetic controls, marked `synthetic`
//    below: each is the positive half of a pair whose negative half IS observed
//    ("Astar Network Rust Engineer" against the NASTAR titles, "Senior C++ Engineer"
//    for the non-word-edge rule), and neither has turned up on a board yet.
//    Assertion 4 checks the marking against the fixture, so the distinction cannot
//    rot into a comment that says one thing while the data says another.
const SYNTHETIC = 'synthetic';
const CASES = [
  // [keyword, title, expected, why, origin?]
  ['Solana', 'Genomic Breeder (Solanaceae)', true, '#3103: unanchored by default, still a substring'],
  ['word:Solana', 'Genomic Breeder (Solanaceae)', false, '#2970: word: closes it'],
  ['word:Solana', 'Senior Solana Engineer', true, 'word: keeps the real match'],
  ['Rust Engineer', 'Sr. Zero Trust Engineer III (6794)', true, '#3103: "Trust Engineer" inside'],
  ['word:DeFi + Engineer', 'Engineering Lead - Crypto and DeFi', true, '#2970: the recall case that settled the default'],
  ['word:DeFi + Engineer', 'Senior Systems Engineer, Product Definition', false, 'word: composes inside an AND-group'],
  ['DeFi + Engineer', 'Senior Systems Engineer, Product Definition', true, 'control: unprefixed AND-group still bleeds'],
  ['word:Astar', 'NASTAR/Events Crew - Winter 26-27', false, 'observed 2026-08-22: Astar inside NASTAR'],
  ['word:Astar', 'Astar Network Rust Engineer', true, 'and the real one survives', SYNTHETIC],
  ['C++', 'Senior C++ Engineer', true, 'non-word edges keep substring matching — \\b could never match here', SYNTHETIC],
];
let ok = 0;
for (const [kw, title, want, why] of CASES) {
  const matched = buildTitleFilter({ positive: [kw], negative: [] })(title);
  if (matched === want) { ok++; } else {
    fail(`"${kw}" vs "${title}" → ${matched}, expected ${want} (${why})`);
  }
}
if (ok === CASES.length) pass(`${CASES.length} documented matching cases from #3103 / #2970 hold`);

// 4. Keep the `synthetic` marking honest. A case marked synthetic that later shows
//    up on a board should lose the marking; an unmarked case must be a real observed
//    title, or the comment above is lying about where the evidence comes from.
const corpusTitles = new Set(corpus.titles.map(t => t.title));
const mismarked = CASES
  .map(([, title, , , origin]) => ({ title, synthetic: origin === SYNTHETIC, observed: corpusTitles.has(title) }))
  .filter(c => c.synthetic === c.observed);
if (mismarked.length === 0) {
  pass('every pinned case is marked synthetic if and only if it is absent from the corpus');
} else {
  fail('pinned cases mismarked:\n' + mismarked
    .map(c => `    ${c.observed ? 'marked synthetic but IS in the corpus' : 'unmarked but NOT in the corpus'}: ${c.title}`)
    .join('\n'));
}
