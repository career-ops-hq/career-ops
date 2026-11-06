import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLiveness } from '../liveness-core.mjs';

const REQUESTED = 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/1234567';
const NOT_FOUND = 'https://recruiting.paylocity.com/Recruiting/jobs/JobNotFound';
const SHELL = 'Careers\nHome  Search\nLoading…\n© 2026 Northwind Paper';

const classify = (overrides) => classifyLiveness({
  status: 200,
  requestedUrl: REQUESTED,
  finalUrl: REQUESTED,
  bodyText: SHELL,
  applyControls: [],
  ...overrides,
});

test('a Paylocity JobNotFound redirect is expired', () => {
  const verdict = classify({ finalUrl: NOT_FOUND });
  assert.deepEqual([verdict.result, verdict.code], ['expired', 'expired_url']);
});

test('the same short shell still on the posting URL stays uncertain', () => {
  const verdict = classify();
  assert.deepEqual([verdict.result, verdict.code], ['uncertain', 'insufficient_content']);
});

test('JobNotFound on another host is not an expired URL', () => {
  const verdict = classify({
    requestedUrl: 'https://jobs.example.com/acme/jobs/1234567',
    finalUrl: 'https://jobs.example.com/acme/jobs/JobNotFound',
  });
  assert.equal(verdict.result, 'uncertain');
  assert.notEqual(verdict.code, 'expired_url');
});
