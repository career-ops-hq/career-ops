// tests/liveness-core-hard-expired-signal.test.mjs — hasHardExpiredSignal()
// must not be fooled by a hedge or negation around the trigger phrase.
//
// hasHardExpiredSignal() reuses HARD_EXPIRED_PATTERNS — built for a scraped
// page's closure banner, which states expiration as a bare fact and never
// hedges or denies it — for a caller whose input is LLM prose instead
// (#4364). Prose CAN hedge ("I cannot determine whether this job has
// expired") or negate ("this is not a case where the job has expired"),
// which plain substring matching cannot tell apart from an affirmative
// report on its own (CodeRabbit review on PR #4459). This file pins the
// sentence-scoped hedge/uncertainty guard added to close that gap.

import { pass, fail } from './helpers.mjs';
import { hasHardExpiredSignal } from '../liveness-core.mjs';

console.log('\nliveness-core — hasHardExpiredSignal() ignores hedged/negated prose (#4364 review)');

// ── The exact regression case the review asked for ──────────────────────────
if (hasHardExpiredSignal('I cannot determine whether this job has expired. Please check the posting manually.') === false) {
  pass('"I cannot determine whether this job has expired" is NOT a hard-expired signal');
} else {
  fail('a hedged, uncertain statement was misread as an affirmative expiration report');
}

// ── A direct denial of the same phrase ──────────────────────────────────────
if (hasHardExpiredSignal('This is not a case where this job has expired; the role is very much active.') === false) {
  pass('a sentence that explicitly denies expiration is NOT a hard-expired signal');
} else {
  fail('a negated statement was misread as an affirmative expiration report');
}

// ── Other common hedge phrasings around the same trigger words ─────────────
for (const text of [
  "I'm unsure whether this job has expired or not.",
  'It is unclear if this job has expired.',
  "I don't know whether this posting has expired.",
  'It is hard to tell if this role is closed.',
  'Whether or not the job has expired is unclear from the page.',
]) {
  if (hasHardExpiredSignal(text) === false) {
    pass(`hedge not read as a signal: "${text}"`);
  } else {
    fail(`hedge incorrectly read as a hard-expired signal: "${text}"`);
  }
}

// ── The real reported reproduction must still be caught ────────────────────
const realDeadPosting =
  'The job posting at the provided URL (**Product Manager - AI Platform (m/f/x)** at **Scalable GmbH**) has expired and is no longer accepting applications\n'
  + '> **Notice on page:** *"This job has expired / Sorry, this job has expired"*\n'
  + 'Per the **Liveness Gate** rules, evaluation stops here before Block A. No evaluation, report, or CV customization will be generated for an expired posting.';
if (hasHardExpiredSignal(realDeadPosting) === true) {
  pass('the original #4364 reproduction is still detected as a hard-expired signal');
} else {
  fail('REGRESSION: the exact reported dead-posting text is no longer detected');
}

// ── A genuinely malformed, unrelated response is still not a signal ────────
if (hasHardExpiredSignal('Sure, here is my analysis of the role.') === false) {
  pass('an unrelated short response is not a hard-expired signal');
} else {
  fail('an unrelated response was misread as a hard-expired signal');
}

// ── The hedge check is scoped to the SENTENCE, not the whole response ──────
// A hedge stated about one thing must not suppress an affirmative, separately
// stated expiration elsewhere in the same response.
const mixedResponse =
  "I'm not sure what the required years of experience are for this role. "
  + 'That said, the job posting has expired and is no longer accepting applications.';
if (hasHardExpiredSignal(mixedResponse) === true) {
  pass('a hedge about an unrelated detail does not suppress a genuine expiration statement elsewhere in the response');
} else {
  fail('an unrelated hedge elsewhere in the text incorrectly suppressed a real expiration signal');
}

// ── "not accepting applications" is NOT a hedge, it is the closure itself ──
// Guards against an over-broad fix: a bare "not" must not be treated as a
// negation cue, since "no longer accepting applications" (one of
// HARD_EXPIRED_PATTERNS's own phrases) legitimately contains it.
if (hasHardExpiredSignal('This job posting has expired and is no longer accepting applications.') === true) {
  pass('"no longer accepting applications" still reads as an affirmative signal (bare "not"/"no" is not treated as a hedge)');
} else {
  fail('REGRESSION: the hedge guard over-triggered on ordinary closure language containing "no"/"not"');
}

// ── A hedge and a real signal on separate LINES, no terminal punctuation ───
// (CodeRabbit follow-up review on #4459). normalizeForMatch() collapses a
// newline to a plain space, so without splitting on real line breaks FIRST,
// "I cannot determine whether the URL is valid\nThis job has expired" reads
// as one run-on "sentence" once normalized — the hedge on the first line
// would then incorrectly suppress the affirmative report on the second.
if (hasHardExpiredSignal('I cannot determine whether the URL is valid\nThis job has expired') === true) {
  pass('a hedge and an affirmative report on separate lines (no sentence-ending punctuation) are scoped independently');
} else {
  fail('REGRESSION: a hedge on one line suppressed an affirmative report on the very next line');
}

// ── A single hedge sentence WRAPPED across two lines is still a hedge ──────
// (CodeRabbit compounding follow-up on the fix above). Splitting on every
// line break would strand "this job has expired" — the tail of a soft word
// wrap, not a new statement — on its own line with no hedge in sight, and
// misread the wrap as an affirmative report. Distinguished from the genuine
// two-statement case above by capitalization: a real new statement starts
// with a capital letter ("This job has expired"); a wrapped continuation
// starts in lowercase ("this job has expired").
if (hasHardExpiredSignal('I cannot determine whether\nthis job has expired') === false) {
  pass('a single hedge sentence word-wrapped across two lines (lowercase continuation) is still recognized as a hedge');
} else {
  fail('REGRESSION: a soft-wrapped hedge was misread as an affirmative report because its tail landed on its own line');
}
