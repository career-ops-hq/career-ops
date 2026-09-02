// tests/outcome-vocabulary-drift.test.mjs — one vocabulary, two ends.
//
// outcome.mjs accepts an outcome type, normalizes it, and writes it VERBATIM
// into data/outcomes/{...}/outcome.md as `- **Outcome Type**: {key}`. Anything
// that later reads that journal must accept every spelling the writer accepts,
// or a recorded outcome is invisible to it.
//
// calibrate.mjs (#3315) shipped with a private 7-entry copy of a 14-entry
// vocabulary. Two consequences, and the second is the one that matters:
//
//   1. `declined` and `ghosted` resolved to nothing, and their tracker state is
//      `Discarded`, which calibrate reads as "never applied — outside the
//      population". So a declined OFFER — the strongest evidence the score
//      predicted well — was dropped from calibration entirely.
//   2. parseOutcomeJournal only advanced `latestType` on a RECOGNIZED type, so
//      a journal whose last entry used an alias reported the entry above it.
//      Its own docstring forbids exactly this: "an application that went
//      interview_progress and later rejected must read as rejected, not as its
//      happiest historical moment."
//
// The census below is what stops it recurring: it is derived from OUTCOME_MAP,
// so a synonym added to the writer is covered on the day it is added.
//
// Run:  node --test tests/outcome-vocabulary-drift.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOME_MAP, CANONICAL_OUTCOMES, canonicalOutcome } from '../lib/outcome-types.mjs';
import { parseOutcomeJournal, computeCalibration, JOURNAL_OUTCOMES } from '../calibrate.mjs';

const journal = (...types) => types.map((t) => `## Entry: 2026-01-01\n- **Outcome Type**: ${t}\n`).join('');

test('every spelling outcome.mjs accepts carries a meaning calibrate can read', () => {
  const orphans = [];
  for (const key of Object.keys(OUTCOME_MAP)) {
    const canonical = canonicalOutcome(key);
    if (!canonical) { orphans.push(`${key}: no canonical type`); continue; }
    if (!JOURNAL_OUTCOMES[canonical]) orphans.push(`${key} -> ${canonical}: absent from calibrate's JOURNAL_OUTCOMES`);
  }
  assert.deepEqual(orphans, [], `outcome types the writer accepts and the reader cannot resolve:\n  ${orphans.join('\n  ')}`);
});

test('calibrate knows exactly the canonical set, no more and no less', () => {
  // Both directions. A canonical type missing here is an outcome that cannot be
  // scored; an extra one is a meaning no writer can produce.
  assert.deepEqual(Object.keys(JOURNAL_OUTCOMES).sort(), [...CANONICAL_OUTCOMES].sort());
});

test('a journal written with an alias resolves to its canonical meaning', () => {
  for (const [alias, canonical] of [
    ['declined', 'offer_declined'],
    ['ghosted', 'no_response'],
    ['rejection', 'rejected'],
    ['accepted', 'hired'],
    ['offer', 'offer_received'],
    ['interview', 'interview_progress'],
    ['stage_reached', 'interview_progress'],
  ]) {
    assert.equal(parseOutcomeJournal(journal(alias)).latestType, canonical, `alias ${alias}`);
  }
});

test('the LAST entry wins even when it is an alias', () => {
  // The docstring's promise. Before the fix each of these reported the first
  // entry, because the second was unrecognized and left latestType untouched.
  assert.equal(parseOutcomeJournal(journal('interview_progress', 'ghosted')).latestType, 'no_response');
  assert.equal(parseOutcomeJournal(journal('interview_progress', 'rejection')).latestType, 'rejected');
  assert.equal(parseOutcomeJournal(journal('offer_received', 'declined')).latestType, 'offer_declined');
});

test('a hand-edited journal spelling still resolves', () => {
  // outcome.mjs normalizes before writing, but the journal is a markdown file a
  // user can edit. canonicalOutcome applies the same normalization.
  assert.equal(parseOutcomeJournal(journal('Offer-Declined')).latestType, 'offer_declined');
  assert.equal(parseOutcomeJournal(journal('REJECTED')).latestType, 'rejected');
});

test('an unrecognized FINAL entry clears the earlier one', () => {
  // The same defect as the alias case, one step further out: a type genuinely
  // outside the vocabulary must not leave the previous entry standing either.
  // `interview_progress` then `withdrawn_by_employer` is not an application
  // still progressing through interviews — null falls through to the tracker
  // status, which is the honest answer for an outcome we cannot read.
  assert.equal(parseOutcomeJournal(journal('interview_progress', 'withdrawn_by_employer')).latestType, null);
  assert.equal(parseOutcomeJournal(journal('offer_received', 'something_new')).latestType, null);
  // …and it really does fall through, rather than dropping the row.
  const rows = [{ num: 1, company: 'Acme', score: 4.6, status: 'Rejected' }];
  const journals = new Map([[1, parseOutcomeJournal(journal('offer_received', 'something_new'))]]);
  const out = computeCalibration(rows, journals, { minBandN: 1 });
  assert.equal(out.resolved, 1, 'the row must resolve from its tracker status');
  assert.equal(out.bands.find((b) => b.band === '>=4.5').offers, 0, 'the stale offer must not survive');
});

test('an unrecognized type is still unrecognized', () => {
  // The widening must not turn into "accept anything": an unknown type has to
  // fall through to the tracker status, not invent a meaning.
  assert.equal(parseOutcomeJournal(journal('withdrawn_by_employer')).latestType, null);
  assert.equal(canonicalOutcome('nonsense'), null);
  assert.equal(canonicalOutcome(''), null);
  assert.equal(canonicalOutcome(null), null);
});

test('a declined offer counts as reaching an offer, whichever spelling recorded it', () => {
  // The end-to-end consequence. Tracker state for both spellings is Discarded,
  // which calibrate reads as outside the population — so before the fix the
  // alias row vanished instead of counting as the strongest positive signal
  // there is.
  const rows = [{ num: 1, company: 'Acme', score: 4.6, status: 'Discarded' }];
  for (const spelling of ['offer_declined', 'declined']) {
    const journals = new Map([[1, parseOutcomeJournal(journal(spelling))]]);
    const out = computeCalibration(rows, journals, { minBandN: 1 });
    assert.equal(out.resolved, 1, `${spelling}: dropped from the population`);
    const band = out.bands.find((b) => b.band === '>=4.5');
    assert.equal(band.offers, 1, `${spelling}: not counted as reaching an offer`);
    assert.equal(band.interviews, 1, `${spelling}: not counted as reaching an interview`);
  }
});
