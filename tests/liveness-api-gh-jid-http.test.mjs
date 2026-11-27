// tests/liveness-api-gh-jid-http.test.mjs — a plain-http careers page carrying
// ?gh_jid= resolves to the Greenhouse API rung.
//
// Scanners record pages like http://block.xyz/careers/jobs/5425346008?gh_jid=5425346008.
// resolveAtsApi used to reject every non-https URL, so these fell to the browser,
// which timed out (block.xyz) or followed a redirect that dropped the id
// (stability.ai) and answered `uncertain` for live postings. The embed provider's
// API hosts are fixed, so the page's scheme carries no risk. Tencent opts in for
// the same reason (the zh-cn suite pins it); every other provider still rejects
// plain http (the LinkedIn suite pins that for its own rung).
//
// Run:  node --test tests/liveness-api-gh-jid-http.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtsApi } from '../liveness-api.mjs';

test('plain-http gh_jid pages resolve to the fixed Greenhouse embed API', () => {
  for (const [url, id] of [
    ['http://stability.ai/careers?gh_jid=4966000101', '4966000101'],
    ['http://block.xyz/careers/jobs/5425346008?gh_jid=5425346008', '5425346008'],
  ]) {
    const r = resolveAtsApi(url);
    assert.equal(r?.ats, 'greenhouse-embedded', url);
    assert.equal(r.apiUrl, `https://boards.greenhouse.io/embed/job_app?token=${id}`);
  }
});

test('plain http stays rejected for every provider that does not opt in', () => {
  for (const url of [
    'http://job-boards.greenhouse.io/acme/jobs/123',
    'http://jobs.ashbyhq.com/acme/2f4f6cd5-2ad8-4a0c-847b-5b3c12cc63e9',
    'http://jobs.lever.co/acme/2f4f6cd5-2ad8-4a0c-847b-5b3c12cc63e9',
    'http://www.linkedin.com/jobs/view/4402976479',
  ]) {
    assert.equal(resolveAtsApi(url), null, url);
  }
});

test('a non-numeric or missing gh_jid never resolves, on either scheme', () => {
  for (const url of ['http://acme.com/careers?gh_jid=abc', 'http://acme.com/careers', 'ftp://acme.com/?gh_jid=1']) {
    assert.equal(resolveAtsApi(url), null, url);
  }
});
