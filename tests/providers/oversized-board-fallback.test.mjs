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
    fetchJson: async (url) => {
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
  const ctx = { fetchJson: async () => { throw new Error('HTTP 500'); } };
  await assert.rejects(() => greenhouse.fetch({ name: 'X', careers_url: 'https://job-boards.greenhouse.io/x' }, ctx), /HTTP 500/);
});

const posting = (i) => ({ id: `id-${i}`, text: `Role ${i}`, hostedUrl: `https://jobs.lever.co/x/id-${i}`, categories: {} });

test('lever pages with limit/skip when the single response is too large', async () => {
  const total = 230;
  const calls = [];
  const ctx = {
    fetchJson: async (url) => {
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
    fetchJson: async (url) => {
      if (!new URL(url).searchParams.has('limit')) throw tooLarge();
      return Array.from({ length: 101 }, (_, i) => posting(i));
    },
  };
  await assert.rejects(() => lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx), /limit=100/);
});

test('lever honors ctx.maxPages in the paging fallback', async () => {
  let pages = 0;
  const ctx = {
    maxPages: 1,
    fetchJson: async (url) => {
      if (!new URL(url).searchParams.has('limit')) throw tooLarge();
      pages++;
      return Array.from({ length: 100 }, (_, i) => posting(i));
    },
  };
  await lever.fetch({ name: 'X', careers_url: 'https://jobs.lever.co/x' }, ctx);
  assert.equal(pages, 1);
});
