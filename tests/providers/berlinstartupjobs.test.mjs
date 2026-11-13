import { test } from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseBerlinStartupJobsFeed } from '../../providers/berlinstartupjobs.mjs';

const item = (slug = 'engineering/r-d-engineer-acme', title = 'R&amp;D Engineer // Acme &amp; Co') =>
  `<item><title><![CDATA[${title}]]></title><link>https://berlinstartupjobs.com/${slug}/</link><dc:creator>wp-user</dc:creator><pubDate>Mon, 02 Nov 2026 10:00:00 +0000</pubDate><description><![CDATA[<p>Build &amp; ship.</p>]]></description></item>`;
const feed = (...items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join('')}</channel></rss>`;

test('berlinstartupjobs: id and explicit-only detect()', () => {
  assert.equal(provider.id, 'berlinstartupjobs');
  assert.equal(provider.detect({ provider: 'berlinstartupjobs' }).url, 'https://berlinstartupjobs.com/feed/');
  for (const entry of [null, undefined, 42, {}, { provider: 'other' }, { careers_url: 'https://berlinstartupjobs.com/feed/' }]) assert.equal(provider.detect(entry), null);
});

test('berlinstartupjobs: title // company split, entities decoded, creator ignored, bad rows dropped', () => {
  const { jobs, rawCount } = parseBerlinStartupJobsFeed(feed(item(), item('x/y', ' '), item('', 'No Link // Acme').replace('https://berlinstartupjobs.com//', 'https://evil.example/')));
  assert.equal(rawCount, 3);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'R&D Engineer');
  assert.equal(jobs[0].company, 'Acme & Co');
  assert.equal(jobs[0].location, '');
  assert.equal(jobs[0].description, 'Build & ship.');
  assert.ok(jobs[0].postedAt > 0);
});

test('berlinstartupjobs: empty channel is [], a non-feed body throws', async () => {
  assert.deepEqual(await provider.fetch({}, { sleep: async () => {}, fetchText: async () => feed() }), []);
  for (const body of ['<html>blocked</html>', '', null]) await assert.rejects(provider.fetch({}, { sleep: async () => {}, fetchText: async () => body }), /berlinstartupjobs/);
});

test('berlinstartupjobs: redirect:error on every request, own page cap, 404 after the last page ends the walk', async () => {
  const calls = [];
  const full = { sleep: async () => {}, fetchText: async (url, opts) => { calls.push(url); assert.equal(opts.redirect, 'error'); return feed(item(`engineering/p${calls.length}`)); } };
  assert.equal((await provider.fetch({ max_pages: 2 }, full)).length, 2);
  assert.deepEqual(calls, ['https://berlinstartupjobs.com/feed/', 'https://berlinstartupjobs.com/feed/?paged=2']);
  calls.length = 0;
  const endless = { ...full, fetchText: async (url, opts) => { calls.push(url); return feed(item(`engineering/p${calls.length}`)); } };
  await provider.fetch({ max_pages: Number.MAX_SAFE_INTEGER }, endless);
  assert.equal(calls.length, 100, 'hard ceiling');
  calls.length = 0;
  await provider.fetch({}, endless);
  assert.equal(calls.length, 20, 'default cap');
  const warnings = [];
  const original = console.warn; console.warn = m => warnings.push(m);
  try {
    let n = 0;
    const jobs = await provider.fetch({ max_pages: 5 }, { sleep: async () => {}, fetchText: async () => { if (++n === 3) throw Object.assign(new Error('nf'), { status: 404 }); return feed(item(`engineering/q${n}`)); } });
    assert.equal(jobs.length, 2);
    assert.equal(warnings.length, 0, 'a 404 after the last page is not a truncation');
  } finally { console.warn = original; }
});

test('berlinstartupjobs: ctx.maxPages probe fetches one page and propagates a rejection unwrapped', async () => {
  let calls = 0;
  await provider.fetch({ max_pages: 10 }, { maxPages: 1, sleep: async () => {}, fetchText: async () => { calls++; return feed(item()); } });
  assert.equal(calls, 1);
  const sentinel = Object.assign(new Error('ProbePageBudgetReached'), { status: 404 });
  await assert.rejects(provider.fetch({}, { maxPages: 2, sleep: async () => {}, fetchText: async url => { if (url.includes('paged')) throw sentinel; return feed(item()); } }), e => e === sentinel);
});
