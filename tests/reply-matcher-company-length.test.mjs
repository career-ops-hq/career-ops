// tests/reply-matcher-company-length.test.mjs — the short-name gate measures a
// company name in the same unit the rest of the file uses for "word material".
//
// checkCompanyMatch routes short names -- the two- and three-letter acronyms
// where `HP` could match inside `PHP` -- to a word-boundary test, and RETURNS
// that result, so the substring paths below never run for them. Which names are
// "short" is therefore a routing decision with teeth, and it was made by a count
// that discarded combining marks. Devanagari and Bengali write most vowels as
// marks, so ordinary company names counted 2 or 3 and were handed the acronym
// rule, while their Latin transliterations were long enough to skip it.
//
// This file asserts the count, the mentions that used to be refused because of
// it, and -- separately -- every short-name behaviour the fix must NOT weaken.

import { readFileSync } from 'fs';
import { checkCompanyMatch } from '../reply-matcher.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nreply-matcher — company length counts word material, not just letters');

/** A mention that must be found, with the reason it is not a stylistic choice. */
const MUST_MATCH = [
  // Marathi and Bengali attach case suffixes to the noun. This is standard
  // orthography, not informal writing, so it is how a real reply is worded.
  ['विप्रो', 'विप्रोमध्ये तुमच्या अर्जाबद्दल धन्यवाद.', 'Marathi -मध्ये locative glued to the name'],
  ['टाटा', 'टाटामध्ये तुमची निवड झाली आहे.', 'Tata, 4 code points counted 2'],
  ['টাটা', 'টাটাতে আপনার আবেদনের জন্য ধন্যবাদ।', 'Bengali -তে locative glued to the name'],
  ['ज़ोमैटो', 'ज़ोमैटोमध्ये तुमची मुलाखत ठरली आहे.', 'Zomato, 7 code points counted 3'],
  ['क्रेड', 'क्रेडमध्ये अर्ज केल्याबद्दल आभार.', 'CRED, 5 code points counted 3'],
  // Plain, space-separated mentions must keep working too -- these passed before
  // the fix, and a fix that traded them away would be no fix at all.
  ['विप्रो', 'विप्रो में आपके आवेदन के लिए धन्यवाद।', 'Devanagari, space-separated'],
  ['टाटा', 'टाटा में आपका साक्षात्कार तय हुआ है।', 'Devanagari, space-separated'],
];

for (const [company, text, why] of MUST_MATCH) {
  if (checkCompanyMatch(text, company)) pass(`matches: ${company} — ${why}`);
  else fail(`missed ${company} in ${JSON.stringify(text)} — ${why}`);
}

// ── the asymmetry that shows the UNIT is wrong, not the threshold ────────────
//
// Two Bengali names, one script, one grammatical construction. Before the fix
// the longer one matched and the shorter one did not, because mark-stripping
// pushed only the shorter one under SHORT_NAME_MAX. And the Latin spelling of
// the same company never met the rule at all. After the fix all three agree.
{
  const bengaliLong = checkCompanyMatch('উইপ্রোতে আপনার আবেদন গৃহীত হয়েছে।', 'উইপ্রো');
  const bengaliShort = checkCompanyMatch('টাটাতে আপনার আবেদনের জন্য ধন্যবাদ।', 'টাটা');
  if (bengaliLong && bengaliShort) {
    pass('two Bengali names in the same construction behave the same way');
  } else {
    fail(`Bengali names disagree — উইপ্রো: ${bengaliLong}, টাটা: ${bengaliShort}; `
      + 'the gate is still measuring in a script-dependent unit');
  }

  const latin = checkCompanyMatch('Thanks for applying to Tatawards.', 'Tata');
  const devanagari = checkCompanyMatch('टाटामध्ये अर्ज केल्याबद्दल आभार.', 'टाटा');
  if (latin === devanagari) pass('a company spelled in Latin and in Devanagari is treated alike');
  else fail(`Tata matches (${latin}) but टाटा does not (${devanagari}) — same name, same length`);
}

// ── guards: every short-name behaviour the fix must NOT weaken ───────────────
//
// The gate's job is to stop a two- or three-character needle matching inside a
// longer word. Counting marks makes FEWER names short, so the risk this fix
// carries is that it hands some name the substring path that should have kept
// the boundary. Latin, Han, Hiragana and Katakana names carry no combining
// marks, so their counts cannot move -- these assertions state that as a
// property of the code rather than a claim in a commit message, and they pass
// both before and after.
{
  const MUST_NOT_MATCH = [
    ['HP', 'We use PHP extensively here.', 'the bug the rule exists for: HP inside PHP'],
    ['HP', 'Our SHOP is hiring.', 'HP inside a longer word, different position'],
    ['3M', 'A team of 30 Modelers joined.', '3M must not match across a word break'],
    ['AI', 'This role involves no MAINTENANCE.', 'two-letter name inside a longer word'],
  ];
  for (const [company, text, why] of MUST_NOT_MATCH) {
    if (!checkCompanyMatch(text, company)) pass(`refuses: ${company} — ${why}`);
    else fail(`${company} matched in ${JSON.stringify(text)} — ${why}`);
  }

  const STILL_MATCH = [
    ['HP', 'Thank you for applying to HP.', 'a real short-name mention, on a boundary'],
    ['IBM', 'Your IBM application is progressing.', 'three-letter name on a boundary'],
    ['3M', 'We received your 3M application.', 'digit-initial short name'],
    // Han, Hiragana and Katakana keep the substring path (NO_WORD_SEPARATOR_RE):
    // those scripts run without separators, so a boundary could never hold.
    ['腾讯', '我们是腾讯的招聘团队', 'Han name inside unseparated text'],
    ['ソニー', 'ソニーの採用担当です', 'Katakana name inside unseparated text'],
  ];
  for (const [company, text, why] of STILL_MATCH) {
    if (checkCompanyMatch(text, company)) pass(`still matches: ${company} — ${why}`);
    else fail(`${company} stopped matching in ${JSON.stringify(text)} — ${why}`);
  }

  // Placeholders stay refused: `?` is the documented unknown-employer marker
  // (#1596), and it must not gain a match through the length gate either.
  for (const ph of ['?', '—', '-']) {
    if (!checkCompanyMatch('Do you have any questions? Please reply.', ph)) {
      pass(`refuses the placeholder company ${JSON.stringify(ph)}`);
    } else fail(`placeholder ${JSON.stringify(ph)} matched as a company name`);
  }
}

// ── the four predicates move as a unit, or this fails ───────────────────────
//
// reply-matcher.mjs defines "word material" in four places, and its own comment
// says they have to move together -- updating some of them is what produced
// #3535. Three already counted \p{M}; the length gate did not, and nothing was
// watching. The behavioural assertions above cannot catch the next drift,
// because a fifth predicate added tomorrow, or one of these four quietly
// narrowed, breaks a case no fixture here happens to cover.
//
// So read the source and require every character class that spans \p{L} and
// \p{N} to include \p{M} between them. Source-reading is the same instrument
// tests/main-guard-convention.test.mjs uses for its own repo-wide rule.
{
  const src = readFileSync(new URL('../reply-matcher.mjs', import.meta.url), 'utf8');

  // Any bracketed class mentioning both \p{L} and \p{N}, negated or not.
  const classes = src.match(/\[[^\]\n]*\\p\{L\}[^\]\n]*\\p\{N\}[^\]\n]*\]/g) || [];
  if (classes.length >= 4) pass(`found ${classes.length} word-material character classes to check`);
  else fail(`expected at least 4 word-material classes, found ${classes.length} — has the file been restructured?`);

  const missing = classes.filter((c) => !c.includes('\\p{M}'));
  if (missing.length === 0) {
    pass('every word-material class in reply-matcher.mjs counts \\p{M}');
  } else {
    fail('these character classes span \\p{L} and \\p{N} but drop combining marks, '
      + `so they disagree with the rest of the file: ${missing.join('  ')}`);
  }

  // The specific predicate this PR fixed, named so a failure points at it
  // directly rather than at the census above.
  if (/const wordMaterial = company\.replace\(\/\[\^\\p\{L\}\\p\{M\}\\p\{N\}\]\/gu, ''\)/.test(src)) {
    pass("checkCompanyMatch's length gate still measures word material, marks included");
  } else {
    fail("checkCompanyMatch's length gate no longer strips to \\p{L}\\p{M}\\p{N} — "
      + 'if it was rewritten, keep \\p{M} in the count or the Indic cases above regress');
  }
}
