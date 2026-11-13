import { test } from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseGetInItPage } from '../../providers/get-in-it.mjs';

const row = (n = 101, over = {}) => ({ title: 'R&amp;D Engineer', url: `/jobsuche/p${n}?utm=x`, company: { title: 'Acme &amp; Co' }, locations: [{ name: 'Berlin' }, { name: 'Remote' }], ...over });
const page = (jobs, jobsCount = 999) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { initialState: { jobSearchJobs: { jobs, jobsCount } } } })}</script>`;

test('get-in-it: id and explicit-only detect()', () => {
  assert.equal(provider.id, 'get-in-it');
  assert.equal(provider.detect({ provider: 'get-in-it' }).url, 'https://www.get-in-it.de/jobsuche');
  for (const entry of [null, undefined, 42, {}, { provider: 'other' }, { careers_url: 'https://www.get-in-it.de/jobsuche' }]) assert.equal(provider.detect(entry), null);
});

test('get-in-it: normalizes a row, decodes entities, strips query, drops off-host and malformed rows', () => {
  const { jobs, rawCount, total } = parseGetInItPage(page([row(), row(102, { url: 'https://evil.example/jobsuche/p102' }), row(103, { title: ' ' }), row(104, { url: '/other/p104' }), null], 7));
  assert.equal(rawCount, 5);
  assert.equal(total, 7);
  assert.deepEqual(jobs, [{ title: 'R&D Engineer', url: 'https://www.get-in-it.de/jobsuche/p101', company: 'Acme & Co', location: 'Berlin, Remote' }]);
});

test('get-in-it: empty list is [], a changed page throws', async () => {
  assert.deepEqual(await provider.fetch({}, { sleep: async () => {}, fetchText: async () => page([]) }), []);
  for (const body of ['<html></html>', '<script id="__NEXT_DATA__">{</script>', page(null).replace('"jobs":null', '"jobs":"x"'), '', null]) {
    await assert.rejects(provider.fetch({}, { sleep: async () => {}, fetchText: async () => body }), /get-in-it/);
  }
});

test('get-in-it: redirect:error, own default cap, stops at the reported total and on a page that adds nothing', async () => {
  const urls = [];
  const original = console.warn; const warnings = []; console.warn = m => warnings.push(m);
  try {
    const walk = body => ({ sleep: async () => {}, fetchText: async (url, opts) => { urls.push(url); assert.equal(opts.redirect, 'error'); return body(urls.length); } });
    assert.equal((await provider.fetch({ max_pages: Number.MAX_SAFE_INTEGER }, walk(n => page([row(n)])))).length, 100);
    urls.length = 0;
    assert.equal((await provider.fetch({}, walk(n => page([row(n)])))).length, 10, 'default cap');
    assert.equal(warnings.filter(w => /max_pages/.test(w)).length, 2);
    urls.length = 0; warnings.length = 0;
    assert.equal((await provider.fetch({ max_pages: 5 }, walk(n => page([row(n)], 2)))).length, 2, 'total reached');
    urls.length = 0;
    assert.equal((await provider.fetch({ max_pages: 5 }, walk(() => page([row(1)])))).length, 1);
    assert.equal(urls.length, 2);
    assert.equal(warnings.length, 1);
  } finally { console.warn = original; }
  assert.equal(urls[0], 'https://www.get-in-it.de/jobsuche?page=1');
});

test('get-in-it: ctx.maxPages probe fetches one page and propagates a rejection unwrapped', async () => {
  let calls = 0;
  await provider.fetch({ max_pages: 10 }, { maxPages: 1, sleep: async () => {}, fetchText: async () => { calls++; return page([row(calls)]); } });
  assert.equal(calls, 1);
  const sentinel = new Error('ProbePageBudgetReached');
  await assert.rejects(provider.fetch({}, { maxPages: 1, sleep: async () => {}, fetchText: async () => { throw sentinel; } }), e => e === sentinel);
});
