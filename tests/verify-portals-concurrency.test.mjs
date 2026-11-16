// tests/verify-portals-concurrency.test.mjs — verifyCompanies probes entries
// through a bounded pool and still returns one row per enabled entry, in input
// order.
//
// One entry at a time, a large portals.yml (or a few boards that answer only at
// the 10 s probe timeout) outlasted the web Portals page's 110 s budget, so the
// health check timed out instead of naming the broken boards. The pool is the
// same width audit-portals.mjs uses against these boards.
//
// Run:  node --test tests/verify-portals-concurrency.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { verifyCompanies } = await import(pathToFileURL(join(ROOT, 'verify-portals.mjs')).href);

const entries = (n) => Array.from({ length: n }, (_, i) => ({
  name: `Company ${i}`,
  api: `https://boards-api.greenhouse.io/v1/boards/company${i}/jobs`,
}));

/** A Greenhouse stub that records how many probes are in flight at once. */
function trackingFetch({ delayMs = 20 } = {}) {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  const fetchJson = async () => {
    state.calls++;
    state.inFlight++;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((r) => setTimeout(r, delayMs));
    state.inFlight--;
    return { jobs: [{ id: 1, title: 'Engineer' }] };
  };
  return { state, fetchJson };
}

test('probes several entries at once, bounded by the default width', async () => {
  const { state, fetchJson } = trackingFetch();
  const rows = await verifyCompanies(entries(20), { fetchJson });
  assert.equal(rows.length, 20);
  assert.equal(state.calls, 20);
  assert.ok(state.peak > 1, `expected concurrent probes, peak in flight was ${state.peak}`);
  assert.ok(state.peak <= 6, `expected at most 6 probes in flight, saw ${state.peak}`);
});

test('rows keep input order even when later probes finish first', async () => {
  // The first entry answers last; its row must still come first.
  const fetchJson = async (url) => {
    await new Promise((r) => setTimeout(r, url.includes('/company0/') ? 60 : 5));
    return { jobs: [{ id: 1, title: 'Engineer' }] };
  };
  const rows = await verifyCompanies(entries(8), { fetchJson });
  assert.deepEqual(rows.map((r) => r.name), entries(8).map((e) => e.name));
  assert.ok(rows.every((r) => r.status === 'live'));
});

test('disabled and non-object entries are still left out', async () => {
  const { fetchJson } = trackingFetch({ delayMs: 1 });
  const list = [...entries(3), { name: 'Off', enabled: false, api: entries(1)[0].api }, null, 'x'];
  const rows = await verifyCompanies(list, { fetchJson });
  assert.deepEqual(rows.map((r) => r.name), ['Company 0', 'Company 1', 'Company 2']);
});

test('concurrency: 1 restores one probe at a time', async () => {
  const { state, fetchJson } = trackingFetch({ delayMs: 2 });
  await verifyCompanies(entries(5), { fetchJson, concurrency: 1 });
  assert.equal(state.peak, 1);
});

test('an empty list makes no probe', async () => {
  const { state, fetchJson } = trackingFetch();
  assert.deepEqual(await verifyCompanies([], { fetchJson }), []);
  assert.equal(state.calls, 0);
});
