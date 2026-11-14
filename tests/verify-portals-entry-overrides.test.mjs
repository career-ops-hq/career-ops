// tests/verify-portals-entry-overrides.test.mjs — verify-portals checks a
// board with the entry's own timeout_ms and max_response_mb, as scan does.
//
// scan.mjs and audit-portals.mjs apply both per-entry keys to the fetchers a
// board is read with (#6009, #6510, #6582). verify-portals.mjs did not, so a
// board that needs them was scanned fine and reported unresolved by the health
// check: Jobgether's Lever board (about 44 MB) failed with "HTTP body exceeded
// maxBytes of 10485760" even with max_response_mb: 80 on its entry.
//
// Run:  node --test tests/verify-portals-entry-overrides.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const { verifyCompanies } = await load('verify-portals.mjs');
const { LEVER_TIMEOUT_MS } = await load('providers/lever.mjs');

const MB = 1024 * 1024;

/** A fetchJson stub that records the options of every call, by URL. */
function recordingFetchJson(body) {
  const calls = [];
  const fetchJson = async (url, opts = {}) => {
    calls.push({ url, opts });
    return typeof body === 'function' ? body(url) : body;
  };
  return { calls, fetchJson };
}

test('a Lever probe uses the entry timeout_ms and max_response_mb', async () => {
  const { calls, fetchJson } = recordingFetchJson([{ id: 'a' }]);
  const [row] = await verifyCompanies(
    [{ name: 'BigCo', careers_url: 'https://jobs.lever.co/bigco', timeout_ms: 60_000, max_response_mb: 80 }],
    { fetchJson, fetchText: async () => '' },
  );
  assert.equal(row.status, 'live');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.timeoutMs, 60_000);
  assert.equal(calls[0].opts.maxBytes, 80 * MB);
});

test('an entry without the keys keeps the provider timeout and the default cap', async () => {
  const { calls, fetchJson } = recordingFetchJson([{ id: 'a' }]);
  await verifyCompanies(
    [{ name: 'SmallCo', careers_url: 'https://jobs.lever.co/smallco' }],
    { fetchJson, fetchText: async () => '' },
  );
  assert.equal(calls[0].opts.timeoutMs, LEVER_TIMEOUT_MS);
  assert.equal(calls[0].opts.maxBytes, undefined);
});

test('one entry\'s keys do not reach the next entry', async () => {
  const { calls, fetchJson } = recordingFetchJson([{ id: 'a' }]);
  await verifyCompanies(
    [
      { name: 'BigCo', careers_url: 'https://jobs.lever.co/bigco', timeout_ms: 60_000, max_response_mb: 80 },
      { name: 'SmallCo', careers_url: 'https://jobs.lever.co/smallco' },
    ],
    { fetchJson, fetchText: async () => '', concurrency: 1 },
  );
  const small = calls.find((c) => c.url.endsWith('/smallco'));
  assert.equal(small.opts.timeoutMs, LEVER_TIMEOUT_MS);
  assert.equal(small.opts.maxBytes, undefined);
});

test('a cross-probe of other slugs does not take the entry keys', async () => {
  // The entry's own slug is gone, so verify-portals probes alternates. Those
  // are other boards, and the entry's limits describe only its own.
  const { calls, fetchJson } = recordingFetchJson((url) => {
    if (url.endsWith('/bigco')) throw Object.assign(new Error('HTTP 404'), { status: 404 });
    throw Object.assign(new Error('HTTP 404'), { status: 404 });
  });
  await verifyCompanies(
    [{ name: 'BigCo', careers_url: 'https://jobs.lever.co/bigco', timeout_ms: 60_000, max_response_mb: 80 }],
    { fetchJson, fetchText: async () => '' },
  );
  const own = calls.filter((c) => c.url === 'https://api.lever.co/v0/postings/bigco');
  const others = calls.filter((c) => c.url !== 'https://api.lever.co/v0/postings/bigco');
  assert.ok(own.length >= 1);
  assert.equal(own[0].opts.maxBytes, 80 * MB);
  assert.ok(others.length > 0, 'expected alternate probes');
  for (const c of others) {
    assert.notEqual(c.opts?.timeoutMs, 60_000, c.url);
    // An alternate may carry its own provider ceiling (Ashby's posting API
    // has one); what must not reach it is this entry's own 80 MB.
    assert.notEqual(c.opts?.maxBytes, 80 * MB, c.url);
  }
});

test('a provider-layer check uses the entry keys and leaves the shared ctx alone', async () => {
  const seen = [];
  const sharedFetchJson = async (_url, opts = {}) => { seen.push(opts); return {}; };
  const httpCtx = { fetchJson: sharedFetchJson, fetchText: async () => '' };
  const provider = {
    id: 'bigboard',
    detect: () => null,
    fetch: async (_entry, ctx) => {
      await ctx.fetchJson('https://careers.example.com/api', { timeoutMs: 15_000 });
      return [{ title: 'Engineer' }];
    },
  };
  const rows = await verifyCompanies(
    [
      { name: 'BigCo', provider: 'bigboard', careers_url: 'https://careers.example.com', timeout_ms: 60_000, max_response_mb: 80 },
      { name: 'SmallCo', provider: 'bigboard', careers_url: 'https://careers.example.com' },
    ],
    { providers: new Map([['bigboard', provider]]), httpCtx, concurrency: 1 },
  );
  assert.deepEqual(rows.map((r) => r.status), ['live', 'live']);
  assert.equal(seen[0].timeoutMs, 60_000);
  assert.equal(seen[0].maxBytes, 80 * MB);
  assert.equal(seen[1].timeoutMs, 15_000);
  assert.equal(seen[1].maxBytes, undefined);
  assert.equal(httpCtx.fetchJson, sharedFetchJson);
});
