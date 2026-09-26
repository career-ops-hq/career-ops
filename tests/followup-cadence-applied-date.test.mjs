/**
 * tests/followup-cadence-applied-date.test.mjs — parseAppliedDate() and its
 * cross-reference filter, isCrossReferencedMention() (career-ops#4084).
 *
 * parseAppliedDate() originally matched only "applied" immediately followed by
 * a date. Any word in between — including the channel phrasing career-ops'
 * own apply modes write, "Applied via {ATS} {date}" — missed the match
 * entirely and silently degraded to the evaluation-date fallback, which
 * `followup-cadence.mjs`'s own header comment calls out as the failure this
 * lookup exists to prevent.
 *
 * Run: node test-all.mjs --only followup-cadence-applied-date
 */
import { pass, fail } from './helpers.mjs';
import { parseAppliedDate } from '../followup-cadence.mjs';

console.log('\nfollowup-cadence.mjs — parseAppliedDate bounded-gap matching (#4084)');

function expectDate(notes, expected, label) {
  const got = parseAppliedDate(notes, { requireValidCalendarDate: true });
  if (got === expected) {
    pass(label);
  } else {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  }
}

// ── The exact four repro cases from the issue — career-ops' own apply-mode
//    phrasing, which the adjacent-only regex missed entirely. ──
expectDate(
  'Applied via Ashby 2026-08-31', '2026-08-31',
  '"Applied via Ashby {date}" matches',
);
expectDate(
  'Applied via the site form 2026-09-04', '2026-09-04',
  '"Applied via the site form {date}" matches',
);
expectDate(
  'Applied on 2026-08-25 via Ashby', '2026-08-25',
  '"Applied on {date} via Ashby" matches (date before the trailing channel mention)',
);
expectDate(
  'Applied 2026-09-04 via the CoE talents portal', '2026-09-04',
  '"Applied {date} via ..." (already adjacent) keeps matching — no regression',
);

// ── Regression guard: the original adjacent-only shape still works, plus the
//    optional "~" estimated-date marker with a gap. ──
expectDate('Applied 2026-08-06.', '2026-08-06', 'adjacent "Applied {date}." still matches');
expectDate('Applied via Ashby ~2026-08-31', '2026-08-31', 'estimated date ("~") survives a gap too');

// ── The gap must not become unbounded: it must not cross a sentence break or
//    reach into a much later, unrelated date. ──
expectDate(
  'Applied to a similar role. Their deadline was 2026-08-31', null,
  'a "." sentence break still stops the match — no reaching into the next sentence',
);
expectDate(
  'Applied, but this note rambles on for way more than forty characters before finally mentioning 2026-08-31',
  null,
  'a gap past the 40-char bound does not match — the fix does not become unbounded',
);
expectDate(
  'They said the JD was posted 2026-08-01, I have not applied yet', null,
  '"applied" with no date after it at all still returns null',
);

// ── Exact boundary: the gap plus its mandatory trailing whitespace must total
//    40 chars, not 41 (CodeRabbit, #4143 — the {0,39} quantifier accounts for
//    the \s that follows it). ──
expectDate(
  `Applied${' '.repeat(40)}2026-08-31`, '2026-08-31',
  'a gap totalling exactly 40 chars (including the mandatory trailing space) still matches',
);
expectDate(
  `Applied${' '.repeat(41)}2026-08-31`, null,
  'a gap totalling 41 chars — one past the documented bound — no longer matches',
);

// ── Line-terminator boundary: a bare \r or a Unicode line/paragraph separator
//    must stop the gap exactly like \n does, not just LF (CodeRabbit, #4143 —
//    ECMA-262's line-terminator set is \n, \r, U+2028, U+2029). ──
expectDate(
  'Applied via Ashby\rNote: something\r2026-08-31', null,
  'a bare "\\r" (no accompanying "\\n") still ends the gap',
);
expectDate(
  `Applied via Ashby${String.fromCharCode(0x2028)}Note${String.fromCharCode(0x2028)}2026-08-31`, null,
  'a Unicode line separator (U+2028) still ends the gap',
);
expectDate(
  `Applied via Ashby${String.fromCharCode(0x2029)}Note${String.fromCharCode(0x2029)}2026-08-31`, null,
  'a Unicode paragraph separator (U+2029) still ends the gap',
);

// ── Sentence-boundary punctuation: "?" and "!" must stop the gap exactly like
//    "." does, not just "." (CodeRabbit, second round on #4143). ──
expectDate('Applied? 2026-08-31', null, 'a "?" sentence break still stops the match');
expectDate('Applied! 2026-08-31', null, 'a "!" sentence break still stops the match');

// ── The mandatory separator itself must not be a line terminator: \s matches
//    \r/\n/U+2028/U+2029 same as a space, so excluding them only from the gap
//    (not the separator) would have left this one case still crossing a line
//    break (CodeRabbit, second round on #4143). ──
expectDate('Applied via Ashby\n2026-08-31', null, 'a "\\n" used AS the mandatory separator still stops the match');
expectDate('Applied via Ashby\r2026-08-31', null, 'a "\\r" used AS the mandatory separator still stops the match');
expectDate(
  `Applied via Ashby${String.fromCharCode(0x2028)}2026-08-31`, null,
  'a U+2028 used AS the mandatory separator still stops the match',
);
expectDate(
  `Applied via Ashby${String.fromCharCode(0x2029)}2026-08-31`, null,
  'a U+2029 used AS the mandatory separator still stops the match',
);

// ── Cross-reference filtering must stay in sync with the wider matcher: a
//    cited row's OWN date, written with the same gapped phrasing, must still
//    be recognized as "the citation already has a date" so the date after the
//    separator is read as this row's own (career-ops#2607's rule, now
//    exercised with gapped phrasing rather than only the adjacent form). ──
{
  const notes = '#154 Sr PM (applied via Ashby 2026-08-04); applied via Ashby 2026-06-15';
  const got = parseAppliedDate(notes, { requireValidCalendarDate: true });
  if (got === '2026-06-15') {
    pass('a gapped citation date ends the reference\'s scope, so the date after ";" is read as this row\'s own');
  } else {
    fail(`gapped-citation cross-reference case: expected "2026-06-15" (this row's own date), got ${JSON.stringify(got)}`);
  }
}
{
  // Mirror case: the citation has NO date yet (gapped phrasing), so the
  // semicolon does not end its scope and the date after it is still the
  // citation's, not this row's — parseAppliedDate must return null.
  const notes = '#154 is already live via Ashby; applied via Ashby 2026-08-04';
  const got = parseAppliedDate(notes, { requireValidCalendarDate: true });
  if (got === null) {
    pass('a citation with no date yet still claims the date after ";" — parseAppliedDate returns null, not a foreign date');
  } else {
    fail(`citation-without-date case: expected null, got ${JSON.stringify(got)}`);
  }
}
