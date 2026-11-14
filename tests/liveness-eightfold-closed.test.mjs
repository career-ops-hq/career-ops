// tests/liveness-eightfold-closed.test.mjs — Eightfold's closed-posting message.
//
// Eightfold career sites show "The job you are looking for may have closed." on
// a closed requisition. The page is nearly empty, so it used to read as
// uncertain/insufficient_content and was never marked expired.
//
// Run:  node --test tests/liveness-eightfold-closed.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLiveness } from '../liveness-core.mjs';

const URL = 'https://netapp.eightfold.ai/careers/job/44227933';
const classify = (overrides) =>
  classifyLiveness({ status: 200, requestedUrl: URL, finalUrl: URL, bodyText: '', applyControls: [], ...overrides });

test('the exact Eightfold closed message is expired, not insufficient_content', () => {
  const v = classify({ bodyText: 'NetApp Careers\nThe job you are looking for may have closed.' });
  assert.equal(v.result, 'expired');
  assert.equal(v.code, 'expired_body');
});

test('small wording changes still read as expired', () => {
  for (const msg of [
    "The job you're looking for may have closed",
    'The job you are looking for might have closed.',
    'The job you are looking for has closed.',
  ]) {
    assert.equal(classify({ bodyText: msg }).result, 'expired', msg);
  }
});

test('a live posting that mentions "closed" elsewhere stays active', () => {
  const body = 'Senior Engineer\nOur offices are closed on public holidays. The closed-loop control team ' +
    'builds systems. The job you are looking for is in Raleigh, and applications are reviewed weekly. '.repeat(3);
  const v = classify({ bodyText: body, applyControls: ['Apply now'] });
  assert.equal(v.result, 'active');
});

test('an unrelated thin page stays uncertain', () => {
  const v = classify({ bodyText: 'NetApp Careers\nLoading…\n© 2026' });
  assert.equal(v.result, 'uncertain');
  assert.equal(v.code, 'insufficient_content');
});
