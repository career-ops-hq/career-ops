// tests/title-keywords-cjk-boundary.test.mjs — a CJK character is a word EDGE,
// not a word continuation.
//
// Short acronyms (2-3 letters: ai, ml, vp) and `word:`/`stem:` keywords match
// on word boundaries built from letters, marks, digits and underscore. Han,
// Hiragana, Katakana and Hangul are letters to \p{L}, but those scripts glue a
// Latin acronym straight onto the next word, so "AI全栈工程师" (AI full-stack
// engineer) has the keyword touching the next word by design. With CJK
// counted as word characters every such title failed `ai` — while
// "AI Engineer" passed — and every zh-CN board (MokaHR, Tencent, Alibaba,
// Meituan, Feishu) silently lost its AI/ML postings to the title filter.
//
// Each case pairs a CJK title with the Latin title that means the same thing,
// and the Latin-rejection cases at the end pin that the boundary itself still
// exists: a fix that made CJK titles match by dropping the boundary altogether
// would also make "maintenance" match `ai` again.

import { pass, fail } from './helpers.mjs';
import { compileKeyword, compilePositiveKeyword } from '../title-keywords.mjs';

console.log('\ntitle keywords — CJK characters are word boundaries');

// ── 1. A short acronym glued to CJK matches exactly like its spaced twin ──
const PAIRS = [
  // keyword, CJK title, equivalent Latin title
  ['ai', 'AI全栈研发工程师', 'AI full-stack engineer'],
  ['ai', '高级AI工程师', 'senior AI engineer'],
  ['ml', 'ML工程师', 'ML engineer'],
  ['ai', 'AIエンジニア', 'AI engineer'],
  ['ai', 'AI엔지니어', 'AI engineer'],
];
const uneven = [];
for (const [kw, cjk, latin] of PAIRS) {
  const m = compileKeyword(kw);
  if (!(m(cjk.toLowerCase()) && m(latin.toLowerCase()))) uneven.push({ kw, cjk, latin });
}
if (uneven.length === 0) pass('a 2-3 letter keyword matches a CJK title exactly as it matches the spaced Latin equivalent');
else fail(`CJK/Latin parity broken: ${JSON.stringify(uneven)}`);

// ── 2. The same through the positive-keyword compiler (AND-groups, prefixes) ──
if (compilePositiveKeyword('ai')('ai全栈研发工程师') && compilePositiveKeyword('word:ai')('ai全栈研发工程师')) {
  pass('compilePositiveKeyword() and `word:` see the CJK edge too');
} else {
  fail('compilePositiveKeyword()/`word:` still treat a CJK character as part of the keyword’s word');
}

// ── 3. `word:` and `stem:` share the left boundary, so both see the CJK edge ──
if (
  compileKeyword('word:intern')('実習intern') === true && compileKeyword('word:intern')('international') === false &&
  compileKeyword('stem:intern')('実習internship') === true && compileKeyword('stem:intern')('preinternship') === false
) {
  pass('`word:intern` and `stem:intern` fire after glued 実習, and still leave "international"/"preinternship" alone');
} else {
  fail('`word:`/`stem:` boundary wrong next to CJK');
}

// ── 4. Nothing loosened: Latin-internal matches stay rejected ──
const STILL_REJECTED = [
  ['ai', 'maintenance engineer'],
  ['ai', 'chair of the board'],
  ['ml', 'html developer'],
  ['vp', 'svp engineering'],
  ['vp', 'vpé'],            // accented continuation is still a continuation
  ['word:intern', 'preinternship coordinator'],
];
const loosened = STILL_REJECTED.filter(([kw, title]) => compileKeyword(kw)(title) !== false);
if (loosened.length === 0) pass('Latin word-internal matches are still rejected (accented letters included)');
else fail(`boundary loosened for Latin text: ${JSON.stringify(loosened)}`);
