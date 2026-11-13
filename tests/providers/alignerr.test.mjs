// tests/providers/alignerr.test.mjs — provider-contract tests for the Alignerr
// AI-training contract board (providers/alignerr.mjs). Inline fixtures only.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — alignerr');

const row = (id, extra = {}) => ({
  id,
  title: `AI Trainer ${id}`,
  description: 'Help train models...',
  pay: '$40-80/hr',
  location: 'Remote',
  applyUrl: `/jobs/${id}`,
  category: 'Coding',
  ...extra,
});
const pageOf = (n, start, total = 1000, limit = 120) => ({
  jobs: Array.from({ length: n }, (_, i) => row(`id-${start + i}`)),
  total,
  offset: start,
  limit,
});

/** Stub ctx: records every call, asserts redirect:'error', serves pages by offset. */
function stubCtx(serve, extra = {}) {
  const calls = [];
  const ctx = {
    transport: 'http',
    sleep: async () => {},
    fetchText: async () => { throw new Error('fetchText should not be called'); },
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const offset = Number(new URL(url).searchParams.get('offset'));
      return serve(offset, calls.length);
    },
    ...extra,
  };
  return { ctx, calls };
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/alignerr.mjs')).href);
  const alignerr = mod.default;
  const { parseAlignerrPage, normalizeAlignerrJob } = mod;

  if (alignerr.id === 'alignerr') pass('alignerr.id is "alignerr"');
  else fail(`alignerr.id is ${JSON.stringify(alignerr.id)}`);

  // detect() — explicit-only
  const hit = alignerr.detect({ name: 'Alignerr', provider: 'alignerr' });
  if (hit && hit.url === 'https://www.alignerr.com/jobs') pass('detect() resolves provider:alignerr with no careers_url');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  let junkOk = true;
  for (const junk of [null, undefined, {}, 42, 'alignerr', { careers_url: 'https://www.alignerr.com/jobs' }, { provider: 'ashby' }]) {
    try { if (alignerr.detect(junk) !== null) junkOk = false; } catch { junkOk = false; }
  }
  if (junkOk) pass('detect() returns null (no throw) for junk and for entries not naming the provider');
  else fail('detect() claimed or threw on a non-alignerr entry');

  // normalization
  const j = normalizeAlignerrJob(row('abc-1'));
  if (j && j.title === 'AI Trainer abc-1' && j.url === 'https://www.alignerr.com/jobs/abc-1'
      && j.company === 'Alignerr' && j.location === 'Remote' && j.externalId === 'abc-1') {
    pass('normalizeAlignerrJob maps id/title/location and builds the posting URL');
  } else fail(`normalized = ${JSON.stringify(j)}`);
  if (j && /Pay: \$40-80\/hr/.test(j.description) && /Category: Coding/.test(j.description) && j.salary === undefined) {
    pass('hourly pay goes to description, never salary');
  } else fail(`description/salary = ${JSON.stringify([j?.description, j?.salary])}`);
  if (normalizeAlignerrJob(row('x', { location: undefined }))?.location === '') pass('missing location stays empty (not invented)');
  else fail('missing location should stay empty');
  const dropped = [null, {}, row(''), row('x', { title: '  ' }), row('\uD800')].map(normalizeAlignerrJob);
  if (dropped.every(v => v === null)) pass('rows missing id/title or with a lone-surrogate id are dropped');
  else fail(`malformed rows = ${JSON.stringify(dropped)}`);

  // empty vs broken envelope
  const empty = parseAlignerrPage({ jobs: [], total: 0, offset: 0, limit: 120 });
  if (empty.jobs.length === 0 && empty.rawCount === 0) pass('present-and-empty jobs[] → empty page');
  else fail(`empty page = ${JSON.stringify(empty)}`);
  let thrown = 0;
  for (const bad of [{}, { jobs: null }, { jobs: {} }, { results: [] }, '', 7, null]) {
    try { parseAlignerrPage(bad); } catch (e) { if (/alignerr: unexpected response/.test(e.message)) thrown++; }
  }
  if (thrown === 7) pass('missing / mistyped jobs[] envelope throws a descriptive error');
  else fail(`only ${thrown}/7 broken envelopes threw`);
  const mixed = parseAlignerrPage({ jobs: [row('a'), {}, row('b')], total: 3 });
  if (mixed.jobs.length === 2 && mixed.rawCount === 3) pass('one malformed row is skipped; rawCount keeps the source count');
  else fail(`mixed page = ${JSON.stringify(mixed)}`);

  // pagination: walks by offset, stops on a short page, passes redirect:'error'
  {
    const { ctx, calls } = stubCtx(off => (off < 240 ? pageOf(120, off) : pageOf(5, off)));
    const jobs = await alignerr.fetch({ name: 'Alignerr', provider: 'alignerr' }, ctx);
    const offsets = calls.map(c => new URL(c.url).searchParams.get('offset'));
    if (jobs.length === 245 && calls.length === 3 && offsets.join() === '0,120,240') pass('fetch() walks offsets and stops on a short page');
    else fail(`walk: ${jobs.length} jobs, offsets ${offsets.join()}`);
    if (calls.every(c => c.opts?.redirect === 'error' && new URL(c.url).hostname === 'www.alignerr.com')) {
      pass("every request is pinned to www.alignerr.com with redirect:'error'");
    } else fail(`request opts = ${JSON.stringify(calls.map(c => c.opts))}`);
  }

  // server clamping limit below PAGE_SIZE: a "full" page is judged by the server's limit
  {
    const { ctx, calls } = stubCtx(off => (off < 120 ? pageOf(60, off, 1000, 60) : pageOf(10, off, 1000, 60)));
    const jobs = await alignerr.fetch({}, ctx);
    if (jobs.length === 130 && calls.length === 3) pass('a server-clamped limit is not mistaken for a short final page');
    else fail(`clamped walk: ${jobs.length} jobs over ${calls.length} calls`);
  }

  // max_pages ceiling + warning; ctx.maxPages probe = exactly one request
  {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const { ctx, calls } = stubCtx(off => pageOf(120, off, 999_999));
      await alignerr.fetch({ max_pages: 2 }, ctx);
      if (calls.length === 2 && warns.some(w => /raise max_pages/.test(w))) pass('entry.max_pages caps the walk and warns');
      else fail(`max_pages: ${calls.length} calls, warns ${JSON.stringify(warns)}`);

      warns.length = 0;
      const probe = stubCtx(off => pageOf(120, off, 999_999), { maxPages: 1 });
      await alignerr.fetch({ max_pages: 50 }, probe.ctx);
      if (probe.calls.length === 1 && warns.length === 0) pass('ctx.maxPages:1 issues exactly one list request, no cap warning');
      else fail(`probe: ${probe.calls.length} calls, warns ${JSON.stringify(warns)}`);

      // default ceiling holds even when the source claims endless rows
      const big = stubCtx(off => pageOf(120, off, 999_999));
      await alignerr.fetch({}, big.ctx);
      if (big.calls.length === 60) pass('DEFAULT_MAX_PAGES (60) bounds the walk when the source reports more');
      else fail(`default ceiling: ${big.calls.length} calls`);

      // total stops the walk once reached
      const exact = stubCtx(off => pageOf(120, off, 240));
      await alignerr.fetch({}, exact.ctx);
      if (exact.calls.length === 2) pass('walk stops once offset reaches the reported total');
      else fail(`total stop: ${exact.calls.length} calls`);

      // page-2 failure in a real scan keeps page 1, warns, and does NOT claim a cap
      warns.length = 0;
      const outage = Object.assign(new Error('HTTP 404'), { status: 404 });
      const flaky = stubCtx((off, n) => { if (n === 1) return pageOf(120, off); throw outage; });
      const kept = await alignerr.fetch({}, flaky.ctx);
      if (kept.length === 120 && warns.some(w => /page 2 failed/.test(w)) && !warns.some(w => /raise max_pages/.test(w))) {
        pass('a failed later page keeps earlier pages and does not fire the max_pages warning');
      } else fail(`flaky: ${kept.length} jobs, warns ${JSON.stringify(warns)}`);
    } finally {
      console.warn = origWarn;
    }
  }

  // probe: rejection propagates unwrapped
  {
    const sentinel = new Error('ProbePageBudgetReached');
    const { ctx } = stubCtx(() => { throw sentinel; }, { maxPages: 1 });
    let got;
    try { await alignerr.fetch({}, ctx); } catch (e) { got = e; }
    if (got === sentinel) pass('a ctx.fetchJson rejection during a probe propagates unwrapped');
    else fail(`probe rejection = ${got}`);
  }

  // empty board
  {
    const { ctx, calls } = stubCtx(() => ({ jobs: [], total: 0, offset: 0, limit: 120 }));
    const jobs = await alignerr.fetch({}, ctx);
    if (jobs.length === 0 && calls.length === 1) pass('an empty board returns [] after one request');
    else fail(`empty board: ${jobs.length} jobs, ${calls.length} calls`);
  }
} catch (e) {
  fail(`alignerr provider tests crashed: ${e.message}`);
}
