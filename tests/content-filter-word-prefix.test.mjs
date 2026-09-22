// tests/content-filter-word-prefix.test.mjs — a `content_filter` keyword may
// opt in to boundary-anchored matching with a `word:` or `stem:` prefix, and a
// bare keyword must keep its plain-substring behaviour byte-for-byte.
//
// The bug this guards (#3274): `buildContentFilter` matched every keyword with
// `String.includes()`, so a negative `java` rejected every posting that merely
// mentioned "JavaScript", and `ios` rejected any description containing
// "curiosity". Combined with the scanner recording only what PASSED, those
// postings vanished with no trace — the same silent-narrowing shape #3103
// found in `title_filter`, and the reason the fix is opt-in rather than a
// changed default.
//
// content_filter reads the job DESCRIPTION, not the title, so unlike
// `compileKeyword` there is no short-acronym auto-anchor: a 2-3 letter run
// inside a paragraph of prose ("aws", "sql", "go") is routinely intended.
// Section 3 pins that difference directly.

import { pass, fail, ROOT } from './helpers.mjs';
import { buildContentFilter, compileContentKeyword } from '../scan.mjs';

console.log('\ncontent filter — `word:` / `stem:` prefixes (#3274)');

// ── 1. The three settings, negative side, on one description each ─────
// A TRIPLE per row (plain / stem: / word:), same discipline as
// tests/title-stem-prefix.test.mjs: the interesting property is that `stem:`
// sits strictly between a plain substring and `word:`, which a pair against
// one neighbour alone cannot show.
const TRIPLES = [
  // keyword, description, plainRejects, stemRejects, wordRejects
  //
  // "java" STARTS "javascript", so it is the #3103 "Solanaceae" class: stem:
  // anchors the left edge only and still rejects it — only word: closes it.
  ['java', 'We ship TypeScript and JavaScript', true, true, false],
  ['java', 'A Kotlin and Java 21 backend', true, true, true],
  ['java', 'Migrating our Javadoc tooling', true, true, false],
  // "ios" lands MID-word in "curiosity" — the case stem: does close.
  ['ios', 'We value curiosity and rigor', true, false, false],
  ['ios', 'Build our iOS app in Swift', true, true, true],
  ['go', 'A Django and Mongo shop', true, false, false],
  ['go', 'Everything is written in Go', true, true, true],
];
const wrong = [];
for (const [kw, desc, wantPlain, wantStem, wantWord] of TRIPLES) {
  const rejects = (entry) => buildContentFilter({ negative: [entry] })(desc) === false;
  const got = [rejects(kw), rejects(`stem:${kw}`), rejects(`word:${kw}`)];
  const want = [wantPlain, wantStem, wantWord];
  if (String(got) !== String(want)) wrong.push(`"${kw}" vs "${desc}": rejects ${got}, want ${want}`);
}
if (wrong.length === 0) {
  pass('a content_filter negative: plain ⊇ stem: ⊇ word:, each anchoring one more edge');
} else {
  fail(`content_filter prefix semantics wrong: ${JSON.stringify(wrong)}`);
}

// The distinguishing property on its own, so a regression cannot hide in the
// table: some case stem: rejects and word: does not, and some the plain form
// rejects and stem: does not.
const loosenedByStem = TRIPLES.some(([, , , s, w]) => s && !w);
const tightenedByStem = TRIPLES.some(([, , p, s]) => p && !s);
if (loosenedByStem && tightenedByStem) {
  pass('stem: is neither word: nor the plain default on the content filter either');
} else {
  fail(`stem: collapsed into a neighbour: looser-than-word=${loosenedByStem} tighter-than-default=${tightenedByStem}`);
}

// ── 2. The plain default is unchanged ───────────────────────────────
// Every pre-#3274 semantic still holds for a keyword with no prefix.
const bareJava = buildContentFilter({ negative: ['java'] });
if (bareJava('We ship TypeScript and JavaScript') === false && bareJava('A pure Rust team') === true) {
  pass('a bare negative keyword still matches as a plain substring (JavaScript still rejected)');
} else {
  fail('the plain-substring default changed for an unprefixed keyword');
}

// Multi-word phrases are meant to match anywhere and take no prefix.
const phrase = buildContentFilter({ negative: ['security clearance'] });
if (phrase('Requires an active security clearance') === false && phrase('Remote, no clearance needed') === true) {
  pass('a multi-word negative keeps exact-substring semantics with no prefix');
} else {
  fail('multi-word negative behaviour drifted');
}

// A config that never uses a prefix is byte-for-byte identical to before.
const legacy = buildContentFilter({ positive: ['rust', 'golang'], negative: ['php', 'wordpress'] });
const legacyCases = [
  ['We build in Rust and a little Go', true],
  ['Legacy PHP and WordPress maintenance', false],
  ['A Rust shop with some PHP scripts', false],
  ['A Python and Java team', false],
  ['', true],
];
const drifted = legacyCases.filter(([d, want]) => legacy(d) !== want);
if (drifted.length === 0) {
  pass('a prefix-free content_filter behaves exactly as it did before #3274');
} else {
  fail(`prefix-free content_filter verdicts moved: ${JSON.stringify(drifted)}`);
}

// ── 3. No short-acronym auto-anchor — the difference from compileKeyword ─
// compileKeyword anchors "go"/"aws"/"sql" because "COO" inside "Coordinator"
// is always wrong in a title. In description prose it is not, so
// compileContentKeyword must leave a bare short keyword as a substring.
const shortPos = buildContentFilter({ positive: ['go'] });
if (shortPos('We use MongoDB heavily') === true && shortPos('A pure Ruby shop') === false) {
  pass('a bare 2-3 letter content_filter keyword stays a substring (no title-style auto-anchor)');
} else {
  fail('compileContentKeyword auto-anchored a short keyword — it should not');
}
// And the prefix still works at that length when asked for explicitly.
if (compileContentKeyword('word:go')('everything in go') === true &&
    compileContentKeyword('word:go')('mongo and django') === false) {
  pass('word: still anchors a short keyword when the entry opts in');
} else {
  fail('word: did not anchor a short content_filter keyword');
}

// ── 4. Positive side and by_title_keyword overrides honour the prefix ─
const wordPositive = buildContentFilter({ positive: ['word:java'] });
if (wordPositive('Senior Java engineer, Spring Boot') === true &&
    wordPositive('Frontend, heavy JavaScript') === false) {
  pass('word: on a positive requires a whole-word match');
} else {
  fail('word: positive did not anchor');
}

const scoped = buildContentFilter({
  by_title_keyword: { 'Backend Engineer': { negative: ['word:java'] } },
});
if (scoped('Laravel with some JavaScript on the side', ['Backend Engineer']) === true &&
    scoped('Spring Boot and Java 21', ['Backend Engineer']) === false) {
  pass('content_filter.by_title_keyword honours a word:/stem: prefix inside an override rule');
} else {
  fail('by_title_keyword override ignored a word: prefix');
}

// ── 5. Shared plumbing: a bare prefix, and regex metacharacters ──────
// A stray `word:` / `stem:` with nothing after it matches nothing — the safe
// half of "a silent drop of one entry over a silent flood", same as
// title-keywords.mjs.
const bare = buildContentFilter({ negative: ['word:', 'stem:'] });
if (bare('any description text at all') === true) {
  pass('a bare word:/stem: negative is a no-op, not a veto');
} else {
  fail('a bare word:/stem: negative vetoed a posting');
}

// Metacharacters in the keyword are literal, exactly as under the title filter.
const dotnet = compileContentKeyword('word:.net');
if (dotnet('our stack is .net 8') === true && dotnet('anet internal tool') === false) {
  pass('word: escapes regex metacharacters (".net" is not "any char + net")');
} else {
  fail('word: leaked regex metacharacters into the content_filter pattern');
}
