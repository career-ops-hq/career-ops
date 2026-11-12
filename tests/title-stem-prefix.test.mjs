// tests/title-stem-prefix.test.mjs — `stem:` demands that a keyword START a
// word, leaving the rest of the word free.
//
// A plain keyword is loose on BOTH sides and usually only one was meant. The
// three settings differ on exactly one axis each:
//
//   agent        Agentforce yes   Reagents yes    both sides open (the default)
//   stem:agent   Agentforce yes   Reagents NO     left boundary only
//   word:agent   Agentforce NO    Reagents NO     both boundaries
//
// Every assertion below is a TRIPLE rather than a pair, because the interesting
// property is not "stem: matches" — a plain substring matches everything stem:
// does — it is that stem: sits strictly between the other two. A pair against
// the default alone would pass on an implementation that simply anchored both
// sides, which is `word:` under another name.

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { compileKeyword, buildTitleFilter } from '../scan.mjs';

console.log('\ntitle filter — `stem:` prefix');

// ── 1. The three settings, on one title each ─────────────────────────
const TRIPLES = [
  // keyword, title, plain, stem, word
  ['agent', 'Agentforce Developer', true, true, false],
  ['agent', 'AI Agents Manager', true, true, false],
  ['agent', 'Account Manager Instrumentation & Reagents', true, false, false],
  ['crypto', 'Cryptocurrency Analyst', true, true, false],
  ['crypto', 'Encrypto Systems Lead', true, false, false],
  ['fellows', 'Fellowship Programme Lead', true, true, false],
  ['rust engineer', 'Rust Engineering Lead', true, true, false],
  ['rust engineer', 'Sr. Zero Trust Engineer III (6794)', true, false, false],
];
const wrong = [];
for (const [kw, title, wantPlain, wantStem, wantWord] of TRIPLES) {
  const l = title.toLowerCase();
  const got = [compileKeyword(kw)(l), compileKeyword(`stem:${kw}`)(l), compileKeyword(`word:${kw}`)(l)];
  const want = [wantPlain, wantStem, wantWord];
  if (String(got) !== String(want)) wrong.push(`"${kw}" vs "${title}": got ${got}, want ${want}`);
}
if (wrong.length === 0) {
  pass('stem: sits strictly between a plain keyword and word: on every case');
} else {
  fail(`stem: semantics wrong: ${JSON.stringify(wrong)}`);
}

// The distinguishing property stated on its own, so a regression cannot hide in
// the table above: there is at least one title stem: accepts and word: does not,
// and at least one the default accepts and stem: does not.
const loosenedByStem = TRIPLES.some(([, , , s, w]) => s && !w);
const tightenedByStem = TRIPLES.some(([, , p, s]) => p && !s);
if (loosenedByStem && tightenedByStem) {
  pass('stem: is neither word: nor the default — it differs from both, in the right directions');
} else {
  fail(`stem: collapsed into a neighbour: looser-than-word=${loosenedByStem} tighter-than-default=${tightenedByStem}`);
}

// ── 2. The side stem: deliberately does not cover ────────────────────
// A keyword that ENDS a longer word rather than starting it. The docs say the
// plain default serves this and stem: does not; assert that rather than leave a
// reader to discover it.
const compound = 'Gebäudeautomation Ingenieur (m/w/d)'.toLowerCase();
if (compileKeyword('automation')(compound) && !compileKeyword('stem:automation')(compound)) {
  pass('stem: does not reach a keyword that ends a compound — the plain form still does');
} else {
  fail('the compound case behaves differently from what the template documents');
}

// The MIRROR case, and the one a reader is likelier to hit: a keyword that
// genuinely STARTS the unwanted word. `stem:` asks for the LEFT boundary only,
// so it matches these by design and only `word:` closes them. Asserting both
// halves per title -- stem: still matches, word: does not -- is what makes this
// discriminating: an implementation that anchored both sides would pass the
// first half and fail the second. Both titles are observed corpus entries.
const startsTheWord = [
  ['solana', 'Genomic Breeder (Solanaceae)'],
  ['neutron', 'Senior Neutronics Engineer - Isotope Production'],
];
const unclosed = startsTheWord.filter(([kw, title]) => {
  const l = title.toLowerCase();
  return !(compileKeyword(`stem:${kw}`)(l) && !compileKeyword(`word:${kw}`)(l));
});
if (unclosed.length === 0) {
  pass('stem: does not close a keyword that STARTS the unwanted word — only word: does');
} else {
  fail(`the start-of-word case differs from what the template documents: ${JSON.stringify(unclosed)}`);
}

// ── 3. Shared plumbing: a bare prefix, escaping, AND-groups ──────────
if (compileKeyword('stem:')('customer success manager') === false) {
  pass('a bare `stem:` matches nothing rather than everything');
} else {
  fail('a bare `stem:` matched a title — one stray colon would flood or veto a scan');
}
// Metacharacters are literal, exactly as under `word:`.
const dotnet = compileKeyword('stem:.net');
if (dotnet('safety .netting specialist') && !dotnet('anet developer')) {
  pass('`stem:` escapes regex metacharacters (".net" is not "any char + net")');
} else {
  fail('`stem:` leaked regex metacharacters into the pattern');
}
// A term inside an AND-group keeps its own prefix.
const group = buildTitleFilter({ positive: ['stem:crypto + engineer'] });
if (group('Cryptocurrency Engineer') === true && group('Encrypto Engineer') === false) {
  pass('a `stem:` term inside an AND-group keeps its boundary');
} else {
  fail('a `stem:` term lost its boundary inside an AND-group');
}

// ── 4. The negative side, which the recall corpus cannot reach ───────
// #3103: none of the corpus's 675 titles contains Internal, International or
// Internship, so a corpus diff reports zero for exactly the strings the shipped
// template names as the reason the default is a substring. These six are that
// blind spot, pinned directly.
const NEGATIVE_BLIND_SPOT = [
  // keyword, title, plain rejects, stem rejects, word rejects
  ['intern', 'Internal Tools Engineer', true, true, false],
  ['intern', 'International Sales Manager', true, true, false],
  ['intern', 'Software Engineering Internship', true, true, false],
  ['crypto', 'Cryptocurrency Analyst', true, true, false],
  ['agent', 'Agentforce Developer', true, true, false],
  ['automation', 'Gebäudeautomation Ingenieur', true, false, false],
];
const negWrong = [];
for (const [kw, title, plain, stemR, wordR] of NEGATIVE_BLIND_SPOT) {
  const rejects = (entry) => buildTitleFilter({ positive: [], negative: [entry] })(title) === false;
  const got = [rejects(kw), rejects(`stem:${kw}`), rejects(`word:${kw}`)];
  const want = [plain, stemR, wordR];
  if (String(got) !== String(want)) negWrong.push(`"${kw}" vs "${title}": rejects ${got}, want ${want}`);
}
if (negWrong.length === 0) {
  pass('the six negative cases the recall corpus is blind to behave as documented');
} else {
  fail(`negative-side behaviour wrong: ${JSON.stringify(negWrong)}`);
}

// ── 5. The shipped template still parses and behaves ─────────────────
// Adding a prefix must not change any verdict for a config that does not use it.
const cfg = yaml.load(readFileSync(join(ROOT, 'templates/portals.example.yml'), 'utf-8'));
const shipped = buildTitleFilter(cfg.title_filter);
const unchanged = [
  ['Internal Tools Engineer', true],
  ['International AI Program Manager', true],
  ['Operations Intern', false],
  ['Machine Learning Internship', false],
];
const drifted = unchanged.filter(([t, want]) => shipped(t) !== want);
if (drifted.length === 0) {
  pass('the shipped template is unaffected: no entry uses the new prefix yet');
} else {
  fail(`shipped-config verdicts moved: ${JSON.stringify(drifted)}`);
}
