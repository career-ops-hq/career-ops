// tests/liveness-applications-closed-question.test.mjs — "Applications closed?" is a
// question, not a closure notice.
//
// Truist's Phenom search pages carry "Applications closed? Don't see what you're
// looking for?" next to a talent-community link, so a live search page read as expired.
//
// Run:  node --test tests/liveness-applications-closed-question.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLiveness } from '../liveness-core.mjs';

const URL = 'https://careers.truist.com/us/en/search-results?keywords=R0120897';
const classify = (bodyText) =>
  classifyLiveness({ status: 200, requestedUrl: URL, finalUrl: URL, bodyText, applyControls: [] });

test('the question form is not an expired verdict', () => {
  const v = classify("Search results\nApplications closed? Don't see what you're looking for? Sign up for our talent community.");
  assert.notEqual(v.result, 'expired');
});

test('statements that applications are closed still read as expired', () => {
  for (const msg of ['Applications closed', 'Applications are closed.', 'This application is closed for this role.']) {
    assert.equal(classify(msg).result, 'expired', msg);
  }
});
