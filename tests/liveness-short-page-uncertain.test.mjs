// tests/liveness-short-page-uncertain.test.mjs — a short page with no closure
// evidence is uncertain, not expired.
//
// A client-rendered posting that has not painted yet, or a slow single-page app
// even after the browser's re-reads, comes back as a body under 300 characters
// with no apply control. classifyLiveness used to call that `expired`
// (insufficient_content), and scan --verify wrote it to scan-history as
// skipped_expired, so the live posting was dedup-filtered out of later scans.
// A short page is now `uncertain` unless it carries its own closure evidence:
// a 404/410, a closure banner, an expired-URL redirect or a listing page.
//
// Run:  node --test tests/liveness-short-page-uncertain.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLiveness, isUnreadableVerdict, planExpiredHistoryRows } from '../liveness-core.mjs';
import { verifyOffers } from '../scan.mjs';
import { unreadableJobPage } from '../openrouter-runner.mjs';

const URL = 'https://jobs.example.com/acme/jobs/48213';
const SHELL = 'Acme Careers\nHome  Teams  Locations\nLoading…\n© 2026 Acme Corp';

const classify = (overrides) =>
  classifyLiveness({ status: 200, requestedUrl: URL, finalUrl: URL, bodyText: SHELL, applyControls: [], ...overrides });

test('a short page with no closure evidence is uncertain, keeping the insufficient_content code', () => {
  const verdict = classify();
  assert.equal(verdict.result, 'uncertain');
  // The code is what liveness-browser.mjs polls and retries on, and what
  // isUnreadableVerdict() and the mode docs name, so it must not change.
  assert.equal(verdict.code, 'insufficient_content');
  assert.equal(isUnreadableVerdict(verdict), true);
});

test('a short page with only non-apply controls is still uncertain', () => {
  const verdict = classify({ applyControls: ['Share', 'Sign in'] });
  assert.equal(verdict.result, 'uncertain');
  assert.equal(verdict.code, 'insufficient_content');
});

test('a short page still reads expired when it carries closure evidence', () => {
  const cases = [
    [{ status: 404 }, 'http_gone'],
    [{ status: 410, bodyText: '' }, 'http_gone'],
    [{ bodyText: 'Acme Careers\nThis job is no longer available.' }, 'expired_body'],
    [{ bodyText: 'JOB EXPIRED' }, 'expired_body_soft'],
    [{ bodyText: 'Acme Careers\n12 jobs found' }, 'listing_page'],
    [{ finalUrl: 'https://jobs.example.com/acme/jobs/48213?error=true' }, 'expired_url'],
  ];
  for (const [overrides, code] of cases) {
    const verdict = classify(overrides);
    assert.deepEqual([verdict.result, verdict.code], ['expired', code], JSON.stringify(overrides));
  }
});

test('a short page with a visible apply control is active', () => {
  const verdict = classify({ bodyText: 'Staff Engineer — Acme', applyControls: ['Apply now'] });
  assert.equal(verdict.result, 'active');
});

test('a long page with no apply control keeps no_apply_control', () => {
  const verdict = classify({ bodyText: 'Staff Engineer at Acme. '.repeat(20) });
  assert.deepEqual([verdict.result, verdict.code], ['uncertain', 'no_apply_control']);
});

test('the short-page verdict writes no scan-history row', () => {
  // End to end through the real classifier: the verdict check-liveness.mjs
  // would record. An `uncertain` verdict is never a death certificate.
  const history = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    `${URL}\t2026-09-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote`,
  ].join('\n');
  const verdict = classify();
  assert.deepEqual(planExpiredHistoryRows(history, [{ url: URL, ...verdict }]), []);
});

test('scan --verify drops a short page without pinning it, like no_apply_control', async () => {
  // `verified` would append it to pipeline.md and scan-history as `added`, so
  // the next scan would never look again; `dropped` records the observational
  // skipped_no_apply_control, which the next --verify scan re-checks (#4832).
  const offer = { company: 'Acme', title: 'Staff Engineer', url: URL };
  const result = await verifyOffers([offer], {}, { checkApi: async () => classify() });
  assert.deepEqual(result.dropped.map((o) => o.url), [URL]);
  assert.deepEqual([result.verified, result.expired, result.invalid], [[], [], []]);
});

test('the OpenRouter runner still refuses to evaluate a short page', () => {
  // It read any `expired` verdict as unreadable; the short page is now
  // `uncertain`, so it has to ask isUnreadableVerdict() instead.
  assert.match(unreadableJobPage({ status: 200, requestedUrl: URL, finalUrl: URL, text: SHELL }), /^insufficient_content/);
});
