import { test } from 'node:test';
import assert from 'node:assert/strict';

export function boardTests(p, { fixture, empty, broken, full, defaultPages = 100, hardCap = 1000, delayMs = 250, count = 1, entryConfig = {} }) {
  const fetch = (entry, ctx) => p.fetch({ ...entryConfig, ...entry }, ctx);
  const method = p.id === 'karriere-at' ? 'fetchJson' : 'fetchText';
  const ctx = body => ({ sleep: async () => {}, [method]: async (_url, opts) => { assert.equal(opts.redirect, 'error'); return body; } });
  test(`${p.id}: explicit-only selection, fixed HTTPS host, normalized fixture`, async () => {
    assert.ok(p.id);
    assert.ok(p.detect({ provider: p.id }));
    for (const entry of [null, {}, 1, { provider: 'other' }, { careers_url: p.detect({ provider: p.id }).url }]) assert.equal(p.detect(entry), null);
    const calls = [];
    const jobs = await fetch({ api: 'http://127.0.0.1/private', careers_url: 'https://evil.example', name: 'ExampleCo' }, {
      maxPages: 1, sleep: async () => {}, [method]: async (url, opts) => { assert.equal(opts.redirect, 'error'); calls.push(url); return fixture; },
    });
    assert.equal(jobs.length, count);
    assert.equal(jobs[0].title, 'R&D Engineer');
    assert.equal(jobs[0].company, p.id === 'surge' ? 'Surge AI' : 'Acme & Co');
    assert.equal(calls.length, 1);
    for (const url of calls) {
      assert.equal(new URL(url).protocol, 'https:');
      assert.equal(new URL(url).origin, new URL(p.detect({ provider: p.id }).url).origin);
    }
  });
  test(`${p.id}: empty vs changed envelope and probe failures`, async () => {
    assert.deepEqual(await fetch({}, ctx(empty)), []);
    for (const body of broken) await assert.rejects(fetch({}, ctx(body)), new RegExp(p.id));
    const sentinel = new Error('ProbePageBudgetReached');
    await assert.rejects(fetch({}, { ...ctx(fixture), maxPages: 1, [method]: async () => { throw sentinel; } }), error => error === sentinel);
  });
  if (!full) return;
  test(`${p.id}: defaults, user ceiling, hard ceiling, raw-count pagination and pacing`, async () => {
    const warnings = [], delays = [];
    const original = console.warn;
    console.warn = message => warnings.push(message);
    try {
      for (const [entry, expected] of [[{}, defaultPages], [{ max_pages: 2 }, 2], [{ max_pages: Number.MAX_SAFE_INTEGER }, hardCap]]) {
        let calls = 0;
        delays.length = 0;
        const jobs = await fetch(entry, { sleep: async ms => delays.push(ms), [method]: async (_url, opts) => { assert.equal(opts.redirect, 'error'); calls++; return full; } });
        assert.equal(calls, expected);
        assert.equal(jobs.length, 1, 'dedup does not stop the page walk');
        assert.equal(delays.length, expected - 1);
        assert.ok(delays.every(ms => ms >= delayMs));
      }
      assert.equal(warnings.length, 3);
      assert.ok(warnings.every(w => /raise max_pages/.test(w)));
      warnings.length = 0;
      let calls = 0;
      await fetch({ max_pages: 10 }, { maxPages: 1, sleep: async () => {}, [method]: async (_url, opts) => { assert.equal(opts.redirect, 'error'); calls++; return full; } });
      assert.equal(calls, 1);
      assert.equal(warnings.length, 0);
      calls = 0;
      await fetch({ max_pages: 2 }, { sleep: async () => {}, [method]: async () => ++calls === 1 ? full : empty });
      assert.equal(calls, 2);
      assert.equal(warnings.length, 0, 'empty boundary page completes naturally');
      const outage = Object.assign(new Error('outage'), { status: 503 });
      calls = 0;
      await assert.rejects(fetch({ max_pages: 2 }, { sleep: async () => {}, [method]: async () => { if (++calls === 1) return full; throw outage; } }), error => error === outage);
      assert.equal(calls, 4, 'page two is retried twice');
      assert.equal(warnings.length, 0, 'fetch errors never masquerade as a page ceiling');
    } finally { console.warn = original; }
  });
}
