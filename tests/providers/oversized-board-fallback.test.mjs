// Boards whose single response exceeds the body cap: Greenhouse falls back to the bare
// list, Lever pages with limit/skip. Network is stubbed through the provider ctx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import greenhouse from '../../providers/greenhouse.mjs';
import lever from '../../providers/lever.mjs';

const tooLarge = () => Object.assign(new Error('HTTP body exceeded maxBytes'), { code: 'response_too_large' });

test('greenhouse falls back to the list without content=true when too large', async () => {
  const urls = [];
  const ctx = {
    fetchJson: async (url, opts) => {
      assert.equal(opts?.redirect, 'error');
      urls.push(url);
      if (new URL(url).searchParams.get('content') === 'true') throw tooLarge();
      return { jobs: [{ id: 1, title: 'Engineer', absolute_url: 'https://job-boards.greenhouse.io/x/jobs/1', location: { name: 'Remote' } }] };
    },
  };
  const out = await greenhouse.fetch({ name: 'X', careers_url: 'https://job-boards.greenhouse.io/x' }, ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Engineer');
  assert.equal(new URL(urls.at(-1)).searchParams.has('content'), false);
});

test('greenhouse still rethrows other errors', async () => {
  const ctx = { fetchJson: async (_url, opts) => { assert.equal(opts?.redirect, 'error'); throw new Error('HTTP 500'); } };
  await assert.rejects(() => greenhouse.fetch({ name: 'X', careers_url: 'https://job-boards.greenhouse.io/x' }, ctx), /HTTP 500/);
});

const posting = (i) => ({ id: `id-${i}`, text: `Role ${i}`, hostedUrl: `https://jobs.lever.co/x/id-${i}`, categories: {} });

test('lever pages with limit/skip when the single response is too large', async () => {
  const total = 230;
  const calls = [];
  const ctx = {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      assert.equal(opts?.redirect, 'error');
      const u = new URL(url);
      if (!u.searchParams.has('limit')) throw tooLarge();
      const limit = Number(u.searchParams.get('limit')), skip = Number(u.searchParams.get('skip'));
      calls.push(skip);
      return Array.from({ length: Math.max(0, Math.min(limit, total - skip)) }, (_, k) => posting(skip + k));
    },
  };
  const out = await lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx);
  assert.equal(out.length, total);
  assert.deepEqual(calls, [0, 100, 200]);
});

test('lever refuses a page larger than the requested limit', async () => {
  const ctx = {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      assert.equal(opts?.redirect, 'error');
      if (!new URL(url).searchParams.has('limit')) throw tooLarge();
      return Array.from({ length: 101 }, (_, i) => posting(i));
    },
  };
  await assert.rejects(() => lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx), /limit=100/);
});

test('lever one-page probe requests a single bounded page and never the full response', async () => {
  const calls = [];
  const ctx = {
    maxPages: 1,
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      assert.equal(opts?.redirect, 'error');
      calls.push(url);
      assert.ok(new URL(url).searchParams.has('limit'));
      return Array.from({ length: 100 }, (_, i) => posting(i));
    },
  };
  await lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx);
  assert.equal(calls.length, 1);
});

test('lever throws a descriptive error on a non-array page', async () => {
  const ctx = {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      assert.equal(opts?.redirect, 'error');
      if (!new URL(url).searchParams.has('limit')) throw tooLarge();
      return { error: 'nope' };
    },
  };
  await assert.rejects(() => lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx), /non-array page/);
});

test('lever warns when the page ceiling stops on a full page, not on a short final page', async () => {
  const run = async (total) => {
    const warns = [];
    const orig = console.warn;
    console.warn = (m) => warns.push(String(m));
    try {
      const ctx = {
        sleep: async () => {},
        fetchJson: async (url, opts) => {
          assert.equal(opts?.redirect, 'error');
          const u = new URL(url);
          if (!u.searchParams.has('limit')) throw tooLarge();
          const skip = Number(u.searchParams.get('skip'));
          return Array.from({ length: Math.max(0, Math.min(100, total - skip)) }, (_, k) => posting(skip + k));
        },
      };
      await lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx);
    } finally { console.warn = orig; }
    return warns;
  };
  assert.equal((await run(3500)).length, 1);
  assert.equal((await run(230)).length, 0);
});

const pagedCtx = (total, extra = {}) => ({
  sleep: async () => {},
  fetchJson: async (url, opts) => {
    assert.equal(opts?.redirect, 'error');
    const u = new URL(url);
    if (!u.searchParams.has('limit')) throw tooLarge();
    const skip = Number(u.searchParams.get('skip'));
    if (extra.failAtSkip === skip) throw Object.assign(new Error('HTTP 400'), { status: 400 });
    return Array.from({ length: Math.max(0, Math.min(100, total - skip)) }, (_, k) => posting(skip + k));
  },
  ...extra,
});

test('lever shrinks the page limit when a page exceeds the body cap and advances skip by accepted postings', async () => {
  const calls = [];
  const total = 130;
  const ctx = {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      assert.equal(opts?.redirect, 'error');
      const u = new URL(url);
      if (!u.searchParams.has('limit')) throw tooLarge();
      const limit = Number(u.searchParams.get('limit')), skip = Number(u.searchParams.get('skip'));
      calls.push([skip, limit]);
      if (limit > 50) throw tooLarge();
      return Array.from({ length: Math.max(0, Math.min(limit, total - skip)) }, (_, k) => posting(skip + k));
    },
  };
  const out = await lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx);
  assert.equal(out.length, total);
  assert.deepEqual(calls.slice(0, 3), [[0, 100], [0, 50], [50, 50]]);
  assert.equal(new Set(out.map(j => j.url)).size, total);
});

test('lever marks the result truncated at the ceiling, not for short pages or probes', async () => {
  const entry = { name: 'X', careers_url: 'https://jobs.lever.co/x' };
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await lever.fetch(entry, pagedCtx(3500))).leverTruncated, true);
    assert.equal((await lever.fetch(entry, pagedCtx(230))).leverTruncated, undefined);
    assert.equal((await lever.fetch(entry, pagedCtx(3500, { maxPages: 1 }))).leverTruncated, undefined);
  } finally { console.warn = warn; }
});

test('lever keeps postings when a later page exhausts retries on a 429, with count, marker and warning', async () => {
  const warns = [];
  const warn = console.warn; console.warn = (m) => warns.push(String(m));
  const requests = [];
  try {
    const ctx = pagedCtx(500);
    const inner = ctx.fetchJson;
    ctx.fetchJson = async (url, opts) => {
      const u = new URL(url);
      if (u.searchParams.has('limit')) requests.push(Number(u.searchParams.get('skip')));
      if (u.searchParams.get('skip') === '200') throw Object.assign(new Error('HTTP 429'), { status: 429 });
      return inner(url, opts);
    };
    const out = await lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx);
    assert.equal(out.length, 200);
    assert.equal(out.leverTruncated, true);
    // pages 0 and 100 once each, then the default policy: 1 attempt + 2 retries at skip=200
    assert.deepEqual(requests, [0, 100, 200, 200, 200]);
    assert.equal(warns.filter((m) => m.includes('keeping the 200 posting(s)')).length, 1);
    assert.equal(warns.filter((m) => m.includes('ceiling')).length, 0);
  } finally { console.warn = warn; }
});

test('lever keeps postings already read when a later page fails, flagged truncated', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const out = await lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, pagedCtx(500, { failAtSkip: 200 }));
    assert.equal(out.length, 200);
    assert.equal(out.leverTruncated, true);
    // the first page failing still propagates
    await assert.rejects(() => lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, pagedCtx(500, { failAtSkip: 0 })), /HTTP 400/);
  } finally { console.warn = warn; }
});

test('lever probe over an unreadably large first page throws instead of reading as empty', async () => {
  const ctx = {
    maxPages: 1,
    sleep: async () => {},
    fetchJson: async () => { throw tooLarge(); },
  };
  await assert.rejects(() => lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx), /exceeded maxBytes/);
});

test('lever scales the per-response byte cap with the page limit', async () => {
  const caps = [];
  const ctx = {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      const u = new URL(url);
      if (!u.searchParams.has('limit')) throw tooLarge();
      caps.push([Number(u.searchParams.get('limit')), opts.maxBytes]);
      if (Number(u.searchParams.get('limit')) > 25) throw tooLarge();
      return [];
    },
  };
  await lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx);
  assert.deepEqual(caps, [[100, 4194304], [50, 2097152], [25, 1048576]]);
});

test('lever warns and marks truncated when shrink retries spend the request budget', async () => {
  const warns = [];
  const warn = console.warn; console.warn = (m) => warns.push(String(m));
  try {
    // Every page of 100 or 50 is too large, so the budget is mostly burnt on shrinks;
    // pages of 25 or less succeed full, so the board never ends on its own.
    const ctx = {
      maxPages: 2,
      sleep: async () => {},
      fetchJson: async (url) => {
        const u = new URL(url);
        if (!u.searchParams.has('limit')) throw tooLarge();
        const limit = Number(u.searchParams.get('limit')), skip = Number(u.searchParams.get('skip'));
        if (limit > 25) throw tooLarge();
        return Array.from({ length: limit }, (_, k) => posting(skip + k));
      },
    };
    const out = await lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx);
    assert.ok(out.length > 0 && out.length < 200);
    assert.equal(out.leverTruncated, true);
    assert.equal(warns.filter((m) => m.includes('request budget')).length, 1);
  } finally { console.warn = warn; }
});

test('lever probe that exhausts shrink retries with nothing read throws, quietly otherwise', async () => {
  const ctx = { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw tooLarge(); } };
  await assert.rejects(() => lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx), /exceeded maxBytes/);
});
