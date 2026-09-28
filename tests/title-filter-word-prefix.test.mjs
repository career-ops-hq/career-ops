// tests/title-filter-word-prefix.test.mjs — a `word:` keyword must match the
// whole word only, and the shipped config must not carry a positive that some
// negative permanently vetoes.
//
// The bug this guards: `title_filter.negative` held a bare "Intern", and
// compileKeyword only anchors 2-3 letter keywords, so a 6-letter one stayed a
// plain substring. It therefore vetoed every "Internal" and "International"
// title, and killed the "Internal Tools" POSITIVE outright — no title could
// ever satisfy an entry that the negative list matches inside its own text.
//
// The cost was not measurable from data/scan-history.tsv, and that is worth
// stating: the history records only titles that PASSED the filter, so every
// title this veto removed was never written there. A count over stored rows
// would have read as zero damage for a healthy filter and a broken one alike.
// The dead-positive check below needs no observed titles, which is exactly why
// it is the assertion worth pinning.

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { buildTitleFilter, compileKeyword } from '../scan.mjs';
import { AND_SEPARATOR } from '../title-keywords.mjs';
import { parsePortals } from '../openrouter-runner.mjs';

console.log('\ntitle filter — `word:` prefix and dead-positive guard');

// ── 1. The matcher itself ────────────────────────────────────────────
const intern = compileKeyword('word:intern');
if (intern('operations intern') && intern('intern, platform') && intern('intern')) {
  pass('`word:intern` matches the standalone word at the end, start and alone');
} else {
  fail('`word:intern` failed to match a standalone "intern"');
}
if (!intern('internal tools engineer') && !intern('international partnerships manager')) {
  pass('`word:intern` does not match inside "internal" or "international"');
} else {
  fail('`word:intern` still matches mid-word');
}
// Hyphens and slashes are word separators in titles, not letters.
if (intern('intern/graduate programme') && intern('summer-intern')) {
  pass('`word:intern` treats "/" and "-" as boundaries');
} else {
  fail('`word:intern` should match across "/" and "-" boundaries');
}
// Digits must not glue either, or "intern2026" would slip through as a word.
if (!intern('intern2026') && !intern('x_intern')) {
  pass('`word:intern` is not glued to an adjacent digit or underscore');
} else {
  fail('`word:intern` matched across a digit or underscore boundary');
}

// A plain keyword must be untouched by all of this.
if (compileKeyword('intern')('internal tools') === true) {
  pass('a keyword WITHOUT the prefix keeps plain substring behaviour');
} else {
  fail('an unprefixed keyword changed behaviour — not backward compatible');
}

// Regex metacharacters in the keyword are literal, not pattern syntax.
const dotnet = compileKeyword('word:.net');
if (dotnet('senior .net developer') && !dotnet('anet developer')) {
  pass('`word:` escapes regex metacharacters (".net" is not "any char + net")');
} else {
  fail('`word:` leaked regex metacharacters into the pattern');
}

// A bare `word:` is a typo. It must match NOTHING: an empty pattern would match
// every title, and as a negative that would veto an entire scan.
if (compileKeyword('word:')('customer success manager') === false) {
  pass('a bare `word:` matches nothing rather than everything');
} else {
  fail('a bare `word:` matched a title — one stray colon would veto every scan');
}

// ── 2. Through the filter, positive and negative sides ───────────────
const neg = buildTitleFilter({ positive: ['internal tools', 'operations'], negative: ['word:intern'] });
if (neg('Internal Tools Engineer') === true) {
  pass('an anchored negative no longer kills the "internal tools" positive');
} else {
  fail('"Internal Tools Engineer" is still rejected');
}
if (neg('Operations Intern') === false) {
  pass('an anchored negative still rejects a real internship');
} else {
  fail('"Operations Intern" leaked through — the veto stopped working');
}
// Word-anchoring works inside an AND-group too, since terms keep compileKeyword.
const group = buildTitleFilter({ positive: ['word:intern + operations'] });
if (group('Operations Intern') === true && group('Internal Operations') === false) {
  pass('a `word:` term inside an AND-group keeps its anchoring');
} else {
  fail('a `word:` term lost its anchoring inside an AND-group');
}

// ── 3. Anchoring loses the suffix forms, so the config must cover them ──
// "word:intern" deliberately does not reach "Internship" or "Interns", which
// the loose substring caught by accident. That is the trade the prefix makes,
// and it is only safe if the list says so explicitly. Assert against the
// SHIPPED config, not a local literal, or the guard proves nothing about what
// actually runs. That config is templates/portals.example.yml. portals.yml is
// the user's own copy: gitignored, absent from a clean checkout, and different
// on every install — a test asserting against it fails for everyone but the
// author, and passes in CI only by never running there.
const shippedCfg = yaml.load(readFileSync(join(ROOT, 'templates/portals.example.yml'), 'utf-8'));
const shipped = buildTitleFilter(shippedCfg.title_filter);
const mustReject = [
  'Operations Intern',
  'Customer Success Intern',
  'Implementation Internship',
  'Customer Success Internship Programme',
  'Operations Interns (2 positions)',
];
const leaked = mustReject.filter((t) => shipped(t) !== false);
if (leaked.length === 0) {
  pass('the shipped config rejects intern, interns and internship titles');
} else {
  fail(`internship titles leaked through the shipped config: ${JSON.stringify(leaked)}`);
}
// Assert on the NEGATIVE list alone, not on the overall verdict. A title is also
// rejected when no positive covers it, and which roles a config seeks is a user's
// choice this fix says nothing about: the example ships no "partnerships" positive,
// so "International Partnerships Manager" is correctly dropped there for a reason
// that has nothing to do with anchoring. Folding both causes into one boolean would
// make the guard pass or fail on edits to the positive list.
const shippedNegatives = (shippedCfg.title_filter?.negative || [])
  .filter((k) => typeof k === 'string')
  .map((k) => k.trim().toLowerCase());
const mustNotBeVetoed = [
  'Manager, Internal Tools',
  'International Partnerships Manager',
  'Director, International Operations',
];
const vetoed = mustNotBeVetoed
  .map((t) => [t, shippedNegatives.filter((k) => compileKeyword(k)(t.toLowerCase()))])
  .filter(([, hits]) => hits.length > 0);
if (vetoed.length === 0) {
  pass('no negative in the shipped config vetoes an internal or international title');
} else {
  fail(`vetoed by the shipped negatives: ${JSON.stringify(vetoed)}`);
}

// ── 4. Both title-filtering paths must agree ─────────────────────────
// openrouter-runner.mjs cannot import scan.mjs (scan.mjs creates data/ at
// import time), so it used to keep a second copy of the matching rules. The two
// had drifted in three ways, none of which the shipped config can expose,
// because it has positives and no malformed entries. Each case below is a
// config where the old copy answered differently from buildTitleFilter:
//
//   negative-only   scan: no positive constraint, keep    copy: rejected everything
//   AND-group       scan: both terms must appear          copy: literal " + " text
//   junk entry      scan: dropped as non-string           copy: coerced to "123"
//
// Comparing verdicts against the shared predicate is the assertion; agreeing on
// the shipped config alone would have passed throughout the drift.
const driftCases = [
  {
    name: 'negative-only config',
    filter: { negative: ['word:intern'] },
    titles: ['Operations Manager', 'Warehouse Associate', 'Operations Intern'],
  },
  {
    name: 'AND-group positive',
    filter: { positive: ['director + engineering'] },
    titles: ['Director of Engineering', 'Director of Sales', 'Engineering Lead'],
  },
  {
    name: 'malformed entries',
    filter: { positive: ['operations', null, 123, '   '], negative: [] },
    titles: ['Operations Manager', '123 Widgets Coordinator', 'Warehouse Associate'],
  },
  {
    name: 'no title_filter at all',
    filter: undefined,
    titles: ['Operations Manager', 'Anything At All'],
  },
];
const drifted = [];
for (const { name, filter, titles } of driftCases) {
  const yamlText = yaml.dump(filter === undefined ? {} : { title_filter: filter });
  const runner = parsePortals(yamlText).titleMatches;
  const canonical = buildTitleFilter(filter);
  for (const t of titles) {
    if (runner(t) !== canonical(t)) {
      drifted.push(`${name}: "${t}" runner=${runner(t)} scan=${canonical(t)}`);
    }
  }
}
if (drifted.length === 0) {
  pass('openrouter-runner matches buildTitleFilter on every drift case');
} else {
  fail(`the two title-filter paths disagree: ${JSON.stringify(drifted)}`);
}

// The shipped config too, since that is what actually runs for a new install.
const runnerYaml = readFileSync(join(ROOT, 'templates/portals.example.yml'), 'utf-8');
const { titleMatches } = parsePortals(runnerYaml);
const bothPaths = [
  'Operations Intern',
  'Implementation Internship',
  'Manager, Internal Tools',
  'International Partnerships Manager',
  'Customer Success Manager',
  'Warehouse Associate',
];
const disagreed = bothPaths.filter((t) => titleMatches(t) !== shipped(t));
if (disagreed.length === 0) {
  pass('scan.mjs and openrouter-runner agree on every intern/internal title');
} else {
  fail(`the two title-filter paths disagree on: ${JSON.stringify(disagreed)}`);
}

// ── 5. No config may carry a permanently-vetoed positive ─────────────
// A positive the negative list matches INSIDE its own text can never be
// satisfied by any title. This needs no observed titles, which is why it is the
// assertion that catches the original bug.
//
// Run against templates/portals.example.yml: it is what every new install
// starts from, and it shipped with "Internal Tools" in positive and a bare
// "Intern" in negative, so the default carried a dead keyword and handed the
// bug to the next user.
// A positive is dead only when NO title can satisfy it — which depends on the
// negative's shape, not just on whether it matches the positive's own text.
//
//   plain substring negative   every title containing the positive contains it
//                              too, so the positive is unsatisfiable.
//   word:-anchored negative    a title may carry the positive inside a LONGER
//                              word, where the anchor no longer matches:
//                              positive "director" with negative "word:director"
//                              still admits "Directorship Programme". Flagging
//                              that pair would reject a valid config.
//
// So an anchored negative only kills an anchored positive over the same term,
// where every match of one is a match of the other.
//
// An AND-group is judged term by term, not as one string. Every term of a group
// must appear for the group to match, so killing ANY term kills the whole entry:
// `word:director + engineering` cannot be satisfied while `word:director` is a
// negative, even though the negative does not match the group's full text.
// Splitting uses the module's own AND_SEPARATOR rather than a local copy.
function deadPositives(titleFilter) {
  const positives = (titleFilter?.positive || []).filter((k) => typeof k === 'string');
  const negatives = (titleFilter?.negative || []).filter((k) => typeof k === 'string');
  const bare = (k) => k.trim().toLowerCase().replace(/^word:/, '').trim();
  const anchored = (k) => k.trim().toLowerCase().startsWith('word:');
  const out = [];
  for (const p of positives) {
    const terms = p.split(AND_SEPARATOR).map((t) => t.trim()).filter(Boolean);
    const killers = new Set();
    for (const term of terms) {
      const text = bare(term);
      if (!text) continue;
      for (const n of negatives) {
        if (!compileKeyword(n.trim().toLowerCase())(text)) continue;
        if (anchored(n) && !(anchored(term) && bare(n) === text)) continue;
        killers.add(n);
      }
    }
    if (killers.size) out.push(`${p} <- ${[...killers].join(', ')}`);
  }
  return out;
}

const dead = deadPositives(shippedCfg.title_filter);
if (dead.length === 0) {
  pass('no positive in templates/portals.example.yml is permanently vetoed by a negative');
} else {
  fail(`templates/portals.example.yml positives that can never match: ${JSON.stringify(dead)}`);
}

// The example config is what a new user inherits, so assert its BEHAVIOUR too,
// not only that it parses without a contradiction.
const example = shipped;
const exampleKeep = ['Internal Tools Engineer', 'International AI Program Manager'];
const exampleDrop = ['AI Engineer Intern', 'Machine Learning Internship'];
const exampleWrong = [
  ...exampleKeep.filter((t) => example(t) !== true),
  ...exampleDrop.filter((t) => example(t) !== false),
];
if (exampleWrong.length === 0) {
  pass('the example config keeps internal/international and still drops internships');
} else {
  fail(`example config verdicts wrong for: ${JSON.stringify(exampleWrong)}`);
}

// ── 6. Regressions from the #2970 review ─────────────────────────────
// Each of these was reproduced before it was fixed; each fails if its fix is
// reverted.

// (a) An ASCII-only lookaround treats every accented letter as a separator, so
// `word:intern` matched inside an accented word — vetoing exactly the class of
// international title the prefix exists to protect.
const accent = compileKeyword('word:intern');
const accentWrong = [
  ...['préintern', 'internée', 'überintern'].filter((t) => accent(t) !== false),
  ...['operations intern', 'intern'].filter((t) => accent(t) !== true),
];
if (accentWrong.length === 0) {
  pass('word boundaries hold against adjacent non-ASCII letters');
} else {
  fail(`word: boundary wrong for: ${JSON.stringify(accentWrong)}`);
}

// (b) A truthy non-string title must not throw. scan.mjs used `(title || '')`
// and openrouter-runner used `String(title ?? '')`; merging the two paths onto
// the former would abort jobs.filter and lose a whole company's results.
const anyTitle = buildTitleFilter({ positive: ['engineer'] });
const threw = [];
for (const v of [123, { a: 1 }, ['x'], true, null, undefined, '']) {
  try { anyTitle(v); } catch { threw.push(JSON.stringify(v) ?? String(v)); }
}
if (threw.length === 0) {
  pass('a malformed title is matched as text instead of throwing');
} else {
  fail(`buildTitleFilter threw on: ${JSON.stringify(threw)}`);
}

// (c) An anchored negative does not kill a plain positive: the positive can
// still be satisfied inside a longer word, so flagging it would reject a
// working config.
const notDead = deadPositives({ positive: ['director'], negative: ['word:director'] });
const stillWorks = buildTitleFilter({ positive: ['director'], negative: ['word:director'] });
if (notDead.length === 0 && stillWorks('Directorship Programme') === true) {
  pass('an anchored negative is not treated as killing a plain positive');
} else {
  fail(`dead-positive guard false alarm: ${JSON.stringify(notDead)}`);
}

// …but it does kill an anchored positive over the same term, where every match
// of one is a match of the other.
const reallyDead = deadPositives({ positive: ['word:director'], negative: ['word:director'] });
if (reallyDead.length === 1) {
  pass('an anchored negative still kills the same anchored positive');
} else {
  fail(`guard missed a genuinely dead anchored positive: ${JSON.stringify(reallyDead)}`);
}

// (d) The 2-3 char acronym branch shares the word: branch's boundary. It used
// ASCII \b, so `vp` matched inside an accented word while `word:vp` did not —
// two spellings of one rule inside the module that exists to have one.
const vp = compileKeyword('vp');
const acronymWrong = [
  ...['prévp', 'vpn gateway', 'révpn'].filter((t) => vp(t) !== false),
  ...['vp engineering', 'senior vp', 'vp, platform'].filter((t) => vp(t) !== true),
];
if (acronymWrong.length === 0) {
  pass('an acronym keyword uses the same Unicode boundary as a word: entry');
} else {
  fail(`acronym boundary wrong for: ${JSON.stringify(acronymWrong)}`);
}

// (e) An AND-group is dead when ANY of its terms is dead: every term must
// appear, so vetoing one makes the whole entry unsatisfiable even though the
// negative never matches the group's full text.
const groupDead = deadPositives({
  positive: ['word:director + engineering'],
  negative: ['word:director'],
});
const groupFilter = buildTitleFilter({
  positive: ['word:director + engineering'],
  negative: ['word:director'],
});
const anySurvives = ['Director of Engineering', 'Senior Director, Engineering', 'Directorship Engineering']
  .some((t) => groupFilter(t) === true);
if (groupDead.length === 1 && anySurvives === false) {
  pass('an anchored negative kills the AND-group whose term it vetoes');
} else {
  fail(`AND-group veto not detected: flagged=${JSON.stringify(groupDead)} anySurvives=${anySurvives}`);
}

// …and a group whose terms are all safe is still not flagged.
const groupAlive = deadPositives({
  positive: ['word:director + engineering'],
  negative: ['word:intern'],
});
if (groupAlive.length === 0) {
  pass('a group with no vetoed term is left alone');
} else {
  fail(`false alarm on a live AND-group: ${JSON.stringify(groupAlive)}`);
}
