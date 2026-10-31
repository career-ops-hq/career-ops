import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { matchCandidates } from '../reply-matcher.mjs';

function check(label, run) {
  try {
    run();
    pass(label);
  } catch (error) {
    fail(`${label}: ${error.message}`);
  }
}

const app = { num: 1, company: 'Acme', role: 'Backend Engineer', status: 'Applied', notes: '' };
const candidate = {
  message_id: 'old-rejection', from: 'careers@acme.com',
  subject: 'Acme Backend Engineer application',
  body_snippet: 'We will not be moving forward.', signal: 'rejection',
};
const match = (date, received_at, notes = '') => matchCandidates([{ ...candidate, received_at }], [{ ...app, date, notes }])[0];

check('a unique exact-role reply cannot reject an explicitly submitted application after receipt', () => {
  const result = match('2026-06-01', '2026-06-20T12:00:00Z', 'Applied 2026-06-22');
  assert.equal(result.application_num, null);
  assert.deepEqual(result.signals, ['no-match']);
});

check('a later evaluation/backfill date does not override an earlier explicit submission date', () => {
  assert.equal(match('2026-06-21', '2026-06-20T12:00:00Z', 'Applied 2026-06-01').application_num, 1);
  assert.equal(match('2026-07-01', '2026-06-20T12:00:00Z', 'Applied via Ashby 2026-06-01').application_num, 1);
});

check('an evaluation date alone leaves submission ordering unknown', () => {
  assert.equal(match('2026-06-21', '2026-06-20T12:00:00Z').application_num, 1);
  assert.equal(match('~2026-07', '2026-06-20T12:00:00Z').application_num, 1);
});

check('local-day timezone uncertainty never excludes a valid adjacent-day submission', () => {
  assert.equal(match('2026-06-01', '2026-06-20T23:30:00Z', 'Applied 2026-06-21').application_num, 1);
  assert.equal(match('2026-06-01', '2026-06-20', 'Applied 2026-06-22').application_num, 1);
  assert.equal(match('2026-06-01', '2026-06-20', 'Applied 2026-06-23').application_num, null);
  assert.equal(match('2026-06-01', '2026-06-20T23:30:00-02:00', 'Applied 2026-06-21').application_num, 1);
});

check('estimated, invalid or cross-referenced submission notes cannot exclude a row', () => {
  for (const notes of ['Applied ~2026-07-01', 'Applied 2026-02-30', '#99 is already live (applied 2026-07-01)']) {
    assert.equal(match('2026-07-01', '2026-06-20T12:00:00Z', notes).application_num, 1, notes);
  }
});

check('a foreign estimated date cannot soften the selected own explicit submission date', () => {
  for (const notes of [
    'Applied 2026-06-23; #99 (Applied ~2026-06-23)',
    '#99 (Applied ~2026-06-23); Applied 2026-06-23',
  ]) {
    const result = match('2026-06-01', '2026-06-20', notes);
    assert.equal(result.application_num, null, notes);
    assert.deepEqual(result.signals, ['no-match']);
  }
});

check('the selected own estimated date stays uncertain beside other explicit dates', () => {
  for (const notes of [
    'Applied ~2026-06-23; Applied 2026-06-25',
    '#99 (Applied 2026-06-23); Applied ~2026-06-23',
  ]) assert.equal(match('2026-06-01', '2026-06-20', notes).application_num, 1, notes);
});

check('missing, malformed and uncertain dates keep existing single-row matching', () => {
  for (const [date, received] of [
    ['2026-06-21', undefined], ['2026-06-21', '2026-02-30'],
    ['2026-06-21', '2026-06-20T12:00:00'], ['', '2026-06-20'],
    ['2026-02-30', '2026-02-01'], ['~2026-06', '2026-06-20'],
    ['2026-06-20T14:00:00Z', '2026-06-20'],
    ['2026-06-20', '2026-06-20T12:00:00Z'],
    ['2026-06-21', 'June 20, 2026'], ['July 1, 2026', '2026-06-20'],
  ]) assert.equal(match(date, received).application_num, 1, `${date} / ${received}`);
});

check('an approximate receipt month cannot exclude an explicit later submission', () => {
  assert.equal(match('2026-06-01', '~2026-06', 'Applied 2026-07-04').application_num, 1);
});

check('an excluded role-specific row cannot redirect the reply to one other role', () => {
  const result = matchCandidates([{ ...candidate, received_at: '2026-06-20' }], [
    { ...app, num: 1, date: '2026-06-01', notes: 'Applied 2026-06-23' },
    { ...app, num: 2, role: 'Product Designer', date: '2026-06-01' },
  ])[0];
  assert.equal(result.application_num, null);
  assert.equal(result.application_nums, undefined);
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.signals, ['ambiguous-match']);
});

check('an excluded named role cannot redirect the reply to a partially matching role', () => {
  const result = matchCandidates([{ ...candidate, received_at: '2026-06-20' }], [
    { ...app, num: 1, date: '2026-06-01', notes: 'Applied 2026-06-23' },
    { ...app, num: 2, role: 'Backend Developer', date: '2026-06-01' },
  ])[0];
  assert.equal(result.application_num, null);
  assert.equal(result.application_nums, undefined);
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.signals, ['ambiguous-match']);
});

check('an excluded named role cannot redirect the reply to a nested shorter title', () => {
  const result = matchCandidates([{ ...candidate, subject: 'Acme Senior Backend Engineer application', received_at: '2026-06-20' }], [
    { ...app, num: 1, role: 'Senior Backend Engineer', date: '2026-06-01', notes: 'Applied 2026-06-23' },
    { ...app, num: 2, date: '2026-06-01', notes: 'Applied 2026-06-01' },
  ])[0];
  assert.equal(result.application_num, null);
  assert.equal(result.application_nums, undefined);
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.signals, ['ambiguous-match']);
});

check('an excluded shorter title preserves an earlier named longer role', () => {
  const result = matchCandidates([{ ...candidate, subject: 'Acme Senior Backend Engineer application', received_at: '2026-06-20' }], [
    { ...app, num: 1, date: '2026-06-01', notes: 'Applied 2026-06-23' },
    { ...app, num: 2, role: 'Senior Backend Engineer', date: '2026-06-01', notes: 'Applied 2026-06-01' },
  ])[0];
  assert.equal(result.application_num, 2);
});

check('an excluded partially matching role preserves an earlier exact-role match', () => {
  const result = matchCandidates([{ ...candidate, received_at: '2026-06-20' }], [
    { ...app, num: 1, role: 'Backend Developer', date: '2026-06-01', notes: 'Applied 2026-06-23' },
    { ...app, num: 2, date: '2026-06-01', notes: 'Applied 2026-06-01' },
  ])[0];
  assert.equal(result.application_num, 2);
});

check('a role naming a future row does not become a company-wide rejection of other roles', () => {
  const result = matchCandidates([{ ...candidate, received_at: '2026-06-20' }], [
    { ...app, num: 1, date: '2026-06-01', notes: 'Applied 2026-06-23' },
    { ...app, num: 2, role: 'Product Designer', date: '2026-06-01' },
    { ...app, num: 3, role: 'Finance Analyst', date: '2026-06-01' },
  ])[0];
  assert.equal(result.application_num, null);
  assert.equal(result.application_nums, undefined);
  assert.deepEqual(result.signals, ['ambiguous-match']);
});

check('a definitely future row does not make a valid earlier application ambiguous', () => {
  const result = matchCandidates([{ ...candidate, received_at: '2026-06-20' }], [
    { ...app, num: 1, date: '2026-06-01', notes: 'Applied 2026-06-01' },
    { ...app, num: 2, date: '2026-06-01', notes: 'Applied 2026-06-23' },
  ])[0];
  assert.equal(result.application_num, 1);
});

check('an unrelated future partial-role match cannot block a unique company match', () => {
  const result = matchCandidates([{ ...candidate, subject: 'Acme Backend application', received_at: '2026-06-20' }], [
    { ...app, num: 1, company: 'Beta', date: '2026-06-01', notes: 'Applied 2026-06-23' },
    { ...app, num: 2, role: 'Backend Developer', date: '2026-06-01', notes: 'Applied 2026-06-01' },
  ])[0];
  assert.equal(result.application_num, 2);
});

check('company or sender-domain evidence corroborates an excluded partial-role match', () => {
  for (const message of [
    { from: 'careers@example.org', subject: 'Acme Backend application' },
    { from: 'careers@acme.com', subject: 'Backend application' },
  ]) {
    const result = matchCandidates([{ ...candidate, ...message, received_at: '2026-06-20' }], [
      { ...app, num: 1, date: '2026-06-01', notes: 'Applied 2026-06-23' },
      { ...app, num: 2, role: 'Product Designer', date: '2026-06-01', notes: 'Applied 2026-06-01' },
    ])[0];
    assert.equal(result.application_num, null);
    assert.deepEqual(result.signals, ['ambiguous-match']);
  }
});

check('an exact excluded role remains standalone evidence without company or domain corroboration', () => {
  const result = matchCandidates([{ ...candidate, received_at: '2026-06-20' }], [
    { ...app, num: 1, company: 'Beta', date: '2026-06-01', notes: 'Applied 2026-06-23' },
    { ...app, num: 2, role: 'Product Designer', date: '2026-06-01', notes: 'Applied 2026-06-01' },
  ])[0];
  assert.equal(result.application_num, null);
  assert.deepEqual(result.signals, ['ambiguous-match']);
});

check('an unrelated excluded partial role cannot widen ambiguity into a company-wide rejection', () => {
  const result = matchCandidates([{ ...candidate, subject: 'Acme Backend application', received_at: '2026-06-20' }], [
    { ...app, num: 1, company: 'Beta', date: '2026-06-01', notes: 'Applied 2026-06-23' },
    { ...app, num: 2, role: 'Product Designer', date: '2026-06-01' },
    { ...app, num: 3, role: 'Finance Analyst', date: '2026-06-01' },
  ])[0];
  assert.equal(result.application_num, null);
  assert.equal(result.application_nums, undefined);
  assert.deepEqual(result.signals, ['ambiguous-match']);
});
