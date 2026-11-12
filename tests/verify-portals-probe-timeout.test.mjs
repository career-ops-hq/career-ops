// tests/verify-portals-probe-timeout.test.mjs — verify-portals probes a board
// with the same timeout the scanner's provider uses for it.
//
// The Lever and Ashby providers fetch with a 30 s timeout, not _http.mjs's 10 s
// default: Lever returns the whole board in one response (#4284), and Ashby's
// posting API has a server-side latency floor of about 10 s. probeSlug() called
// fetchJson with no options, so the health check gave up on a board at 10 s
// that `scan` reads, and reported it as a network error.
//
// Run:  node --test tests/verify-portals-probe-timeout.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const { probeSlug } = await load('verify-portals.mjs');
const { LEVER_TIMEOUT_MS } = await load('providers/lever.mjs');
const { ASHBY_MAX_BYTES, ASHBY_TIMEOUT_MS } = await load('providers/ashby.mjs');

/** Probe one slug against a stub and return the options the probe passed. */
async function probeOptions(ats, body) {
  let seen;
  const fetchJson = async (_url, opts) => {
    seen = opts;
    return body;
  };
  const result = await probeSlug(ats, 'some-board', { fetchJson });
  return { result, opts: seen };
}

test('the providers export the timeouts they fetch with', () => {
  assert.equal(LEVER_TIMEOUT_MS, 30_000);
  assert.equal(ASHBY_TIMEOUT_MS, 30_000);
});

test('a Lever probe uses the Lever provider timeout', async () => {
  const { result, opts } = await probeOptions('lever', [{ id: 'a' }]);
  assert.equal(result.status, 'live');
  assert.equal(opts?.timeoutMs, LEVER_TIMEOUT_MS);
});

test('an Ashby probe uses the Ashby provider timeout', async () => {
  const { result, opts } = await probeOptions('ashby', { jobs: [{ id: 'a' }] });
  assert.equal(result.status, 'live');
  assert.equal(opts?.timeoutMs, ASHBY_TIMEOUT_MS);
  // Same body ceiling as the provider, so a board the scan reads is never 'missing' here.
  assert.equal(opts?.maxBytes, ASHBY_MAX_BYTES);
});

test('a Greenhouse probe keeps the default timeout, as its provider does', async () => {
  const { result, opts } = await probeOptions('greenhouse', { jobs: [{ id: 'a' }] });
  assert.equal(result.status, 'live');
  assert.equal(opts?.timeoutMs, undefined);
});

test('an Ashby probe over the body ceiling counts the board from its embed listing', async () => {
  const tooLarge = async () => { throw Object.assign(new Error('HTTP body exceeded maxBytes'), { code: 'response_too_large' }); };
  const embedHtml = '<script>window.__appData = ' + JSON.stringify({ jobBoard: { jobPostings: [{ id: 'p1' }, { id: 'p2' }] } }) + ';</script>';
  let embedOpts = null;
  const live = await probeSlug('ashby', 'big', { fetchJson: tooLarge, fetchEmbed: async (_url, opts) => { embedOpts = opts; return embedHtml; } });
  assert.equal(live.status, 'live');
  assert.equal(live.jobCount, 2);
  assert.equal(embedOpts?.redirect, 'error');

  const gone = await probeSlug('ashby', 'big', { fetchJson: tooLarge, fetchEmbed: async () => { throw new Error('HTTP 503'); } });
  assert.equal(gone.status, 'missing');
  assert.match(gone.reason, /maxBytes/);
});
