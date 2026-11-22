// tests/reply-matcher-corporate-form.test.mjs — a tracker company written with
// a corporate form ("Acme Inc.") must still match a reply that names the plain
// employer ("Acme").
//
// checkCompanyMatch() looked for the whole tracker cell in the mail, so the
// match worked only one way: a tracker "Acme" matched "Acme Inc." in the text,
// but a tracker "Acme Inc." never matched "Acme". The fix reuses
// companiesMatchIgnoringCorporateForm() from tracker-utils.mjs, the rule
// set-status, merge-tracker, dedup-tracker and contact-lookup already share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCompanyMatch, matchCandidates } from '../reply-matcher.mjs';

test('a tracker company with a legal suffix matches the plain name in the mail', () => {
  assert.equal(checkCompanyMatch('Thanks for applying to Acme', 'Acme Inc.'), true);
  assert.equal(checkCompanyMatch('Update from Globex', 'Globex GmbH'), true);
  assert.equal(checkCompanyMatch('Your Initech application', 'Initech, LLC'), true);
  assert.equal(checkCompanyMatch('Your Initech application', 'Initech L.L.C.'), true);
  assert.equal(checkCompanyMatch('Stark Industries recruiting', 'Stark Industries Ltd'), true);
});

test('the reverse direction still matches', () => {
  assert.equal(checkCompanyMatch('Thanks from Acme Inc.', 'Acme'), true);
  assert.equal(checkCompanyMatch('Globex GmbH — Ihre Bewerbung', 'Globex'), true);
});

test('the bare name must stand as a whole word', () => {
  assert.equal(checkCompanyMatch('Welcome to Acmecorp', 'Acme Inc.'), false);
  assert.equal(checkCompanyMatch('Hiring at Globexx', 'Globex GmbH'), false);
});

test('a short name does not shed its suffix', () => {
  // The shared rule refuses stems under MIN_STEM_CHARS, so "HP Inc." never
  // searches for a bare "hp" and the PHP guard in the boundary tests holds.
  assert.equal(checkCompanyMatch('We are hiring a senior PHP developer', 'HP Inc.'), false);
  assert.equal(checkCompanyMatch('We are hiring a senior PHP developer', 'HP Co'), false);
  assert.equal(checkCompanyMatch('Your application at 3M', '3M Co'), false);
  // A three-character stem is long enough, and still needs the word.
  assert.equal(checkCompanyMatch('Your application at IBM', 'IBM Corp'), true);
  assert.equal(checkCompanyMatch('Your IBMX account', 'IBM Corp'), false);
});

test('a generic descriptor is not dropped from the tracker name', () => {
  // Only legal suffixes are optional here. Treating "Solutions" as one would
  // turn "Data Solutions Inc." into a search for the word "data".
  assert.equal(checkCompanyMatch('We reviewed your data engineering profile', 'Data Solutions Inc.'), false);
  assert.equal(checkCompanyMatch('Thanks from Data Solutions', 'Data Solutions Inc.'), true);
});

test('a substantive extra word in the tracker name is still required', () => {
  assert.equal(checkCompanyMatch('Thanks for applying to Acme', 'Acme Robotics Inc.'), false);
  assert.equal(checkCompanyMatch('Thanks for applying to Acme Robotics', 'Acme Robotics Inc.'), true);
});

test('placeholders still never match', () => {
  assert.equal(checkCompanyMatch('Are you available on Monday?', '?'), false);
  assert.equal(checkCompanyMatch('Are you available on Monday?', '? Inc.'), false);
});

test('a reply naming the plain employer scores against the suffixed tracker row', () => {
  const [result] = matchCandidates([{
    message_id: 'cf-1',
    from: 'talent@example.org',
    subject: 'Acme — Backend Engineer',
    body_snippet: 'We would like to schedule an interview.',
  }], [
    { num: 1, company: 'Acme Inc.', role: 'Backend Engineer', status: 'Applied', notes: '' },
  ], []);
  assert.equal(result.application_num, 1);
  assert.ok(result.signals.includes('company-name'));
});

test('a role-less rejection treats "Acme" and "Acme Inc." rows as one employer', () => {
  const [result] = matchCandidates([{
    message_id: 'cf-2',
    received_at: '2026-08-20T12:00:00Z',
    from: 'careers@acme.example',
    subject: 'Thank you for your interest in Acme',
    body_snippet: 'Unfortunately, we will not be moving forward with your application.',
    signal: 'rejection',
  }], [
    { num: 10, date: '2026-08-01', company: 'Acme', role: 'Backend Engineer', status: 'Applied', notes: '' },
    { num: 11, date: '2026-08-02', company: 'Acme Inc.', role: 'Product Designer', status: 'Applied', notes: '' },
  ], []);
  assert.deepEqual(result.signals, ['company-wide-rejection']);
  assert.deepEqual(result.application_nums, [10, 11]);
});

test('rows that each match the plain name but not each other stay two employers', () => {
  const [result] = matchCandidates([{
    message_id: 'cf-3',
    received_at: '2026-08-20T12:00:00Z',
    from: 'careers@acme.example',
    subject: 'Thank you for your interest in Acme Solutions and Acme Technologies',
    body_snippet: 'Unfortunately, we will not be moving forward with your application.',
    signal: 'rejection',
  }], [
    { num: 20, date: '2026-08-01', company: 'Acme Solutions', role: 'Backend Engineer', status: 'Applied', notes: '' },
    { num: 21, date: '2026-08-02', company: 'Acme Technologies', role: 'Product Designer', status: 'Applied', notes: '' },
  ], []);
  assert.deepEqual(result.signals, ['ambiguous-match']);
  assert.equal(result.application_nums, undefined);
});
