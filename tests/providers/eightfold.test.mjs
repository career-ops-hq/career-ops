// tests/providers/eightfold.test.mjs — contract test for the Eightfold AI
// provider. Auto-discovered by test-all.mjs under tests/**; no registration.
// Run alone with: node test-all.mjs --only providers/eightfold
//
// Every fixture here is synthetic (acme/other/big.eightfold.ai). Nothing in
// this file touches the network.

import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — eightfold');

// Validate derived URLs by PARSED hostname, never by substring-matching the
// URL string — a trusted host fragment can appear in a hostile URL's
// path/query/userinfo (CodeQL js/incomplete-url-substring-sanitization).
// Mirrors the discipline in tests/providers/oraclecloud.test.mjs.
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };

// A ctx that records every URL + options it is asked for and replays canned
// pages keyed by the `start` offset.
function mockCtx(pages) {
  const calls = [];
  return {
    calls,
    ctx: {
      transport: 'http',
      fetchText: async () => '',
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        calls.push({ url, opts });
        const start = Number(new URL(url).searchParams.get('start') || '0');
        return pages[start] ?? { positions: [], count: 0 };
      },
    },
  };
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/eightfold.mjs')).href);
  const ef = mod.default;
  const { resolveTenant, buildApiUrl, buildJobUrl, parseEightfoldResponse } = mod;

  // ── id ──────────────────────────────────────────────────────────────
  if (ef.id === 'eightfold') pass('eightfold.id is "eightfold"');
  else fail(`eightfold.id is ${JSON.stringify(ef.id)}`);

  // ── detect ──────────────────────────────────────────────────────────
  const hit = ef.detect({ name: 'Acme', careers_url: 'https://acme.eightfold.ai/careers' });
  if (hit && hostOf(hit.url) === 'acme.eightfold.ai'
      && new URL(hit.url).pathname === '/api/apply/v2/jobs'
      && new URL(hit.url).searchParams.get('start') === '0') {
    pass('eightfold.detect() derives the /api/apply/v2/jobs URL from a tenant careers_url');
  } else {
    fail(`eightfold.detect(careers) returned ${JSON.stringify(hit)}`);
  }

  // `domain` is optional — the server infers it from the tenant host — but is
  // forwarded when the entry supplies one, since multi-brand tenants scope by it.
  if (!new URL(hit.url).searchParams.has('domain')) {
    pass('eightfold.detect() omits domain= when the entry does not supply one');
  } else {
    fail(`eightfold.detect() should omit domain=, got ${hit.url}`);
  }

  const withDomain = ef.detect({ name: 'Acme', careers_url: 'https://acme.eightfold.ai/careers?domain=acme.example' });
  if (new URL(withDomain.url).searchParams.get('domain') === 'acme.example') {
    pass('eightfold.detect() carries domain= through from the careers_url query');
  } else {
    fail(`domain passthrough returned ${JSON.stringify(withDomain?.url)}`);
  }

  const overridden = ef.detect({
    name: 'Acme',
    careers_url: 'https://acme.eightfold.ai/careers?domain=from-url.example',
    domain: 'explicit.example',
  });
  if (new URL(overridden.url).searchParams.get('domain') === 'explicit.example') {
    pass('eightfold.detect() lets an explicit entry.domain override the URL query');
  } else {
    fail(`domain override returned ${JSON.stringify(overridden?.url)}`);
  }

  // api: takes precedence over careers_url (greenhouse/ashby/oraclecloud house rule).
  const apiFirst = ef.detect({
    name: 'Branded',
    api: 'https://pinned.eightfold.ai/api/apply/v2/jobs',
    careers_url: 'https://other.eightfold.ai/careers',
  });
  if (hostOf(apiFirst?.url) === 'pinned.eightfold.ai') {
    pass('eightfold.detect() honors api: over careers_url');
  } else {
    fail(`api precedence returned ${JSON.stringify(apiFirst)}`);
  }

  // ── detect: SSRF pin (do not delete) ────────────────────────────────
  // The host regex is what stands between a portals.yml entry and an arbitrary
  // outbound fetch. Every one of these must produce a null detect().
  const badEntries = [
    // branded CNAME — a real tenant's board, but not *.eightfold.ai
    { name: 'B', careers_url: 'https://careers.acme.example/careers' },
    { name: 'B', careers_url: 'https://evil.example/careers' },
    // the apex itself and multi-label subdomains are not tenant hosts
    { name: 'B', careers_url: 'https://eightfold.ai/careers' },
    { name: 'B', careers_url: 'https://a.b.eightfold.ai/careers' },
    // lookalike suffix
    { name: 'B', careers_url: 'https://acme.eightfold.ai.evil.example/careers' },
    // trusted host relegated to the path / hidden in userinfo
    { name: 'B', careers_url: 'https://evil.example/acme.eightfold.ai/careers' },
    { name: 'B', careers_url: 'https://acme.eightfold.ai@evil.example/careers' },
    // plaintext
    { name: 'B', careers_url: 'http://acme.eightfold.ai/careers' },
    // nothing to go on
    {}, { name: 'B' }, { name: 'B', careers_url: null }, { name: 'B', careers_url: 42 },
    { name: 'B', careers_url: 'not a url' },
  ];
  const detectLeaks = badEntries.filter((e) => ef.detect(e) !== null);
  if (detectLeaks.length === 0) {
    pass(`eightfold.detect() returns null for all ${badEntries.length} untrusted / unusable entries (SSRF pin)`);
  } else {
    fail(`eightfold.detect() accepted: ${detectLeaks.map((e) => e.careers_url).join(' | ')}`);
  }

  // ── resolveTenant / buildApiUrl / buildJobUrl ───────────────────────
  const tenant = resolveTenant({ name: 'Acme', careers_url: 'https://ACME.eightfold.ai/careers' });
  if (tenant?.host === 'acme.eightfold.ai' && tenant.domain === null) {
    pass('resolveTenant() lowercases the host and reports a null domain when absent');
  } else {
    fail(`resolveTenant returned ${JSON.stringify(tenant)}`);
  }

  const paged = buildApiUrl({ host: 'acme.eightfold.ai', domain: 'acme.example' }, 30, 10);
  const pp = new URL(paged).searchParams;
  if (pp.get('start') === '30' && pp.get('num') === '10' && pp.get('domain') === 'acme.example') {
    pass('buildApiUrl() sets domain/start/num');
  } else {
    fail(`buildApiUrl returned ${paged}`);
  }

  const fallbackUrl = buildJobUrl({ host: 'acme.eightfold.ai', domain: 'acme.example' }, '99');
  if (hostOf(fallbackUrl) === 'acme.eightfold.ai' && new URL(fallbackUrl).searchParams.get('pid') === '99') {
    pass('buildJobUrl() builds the tenant fallback posting URL from a pid');
  } else {
    fail(`buildJobUrl returned ${fallbackUrl}`);
  }

  // ── parseEightfoldResponse (pure) ───────────────────────────────────
  const T = { host: 'acme.eightfold.ai', domain: 'acme.example' };
  const fixture = {
    count: 6,
    positions: [
      // 0: full row, canonical URL on a branded host (accepted — display-only)
      {
        id: 1001,
        name: 'Staff Backend Engineer',
        location: 'Berlin,Germany',
        locations: ['Berlin,Germany', 'Munich,Germany'],
        t_create: 1_780_000_000,
        t_update: 1_781_000_000,
        canonicalPositionUrl: 'https://careers.acme.example/careers/job/1001',
      },
      // 1: no canonicalPositionUrl → tenant fallback built from id
      { id: 1002, name: 'Data Platform Lead', location: 'Berlin,Germany', t_create: 1_780_500_000 },
      // 2: title only under posting_name
      { id: 1003, posting_name: 'Product Manager', location: 'Munich,Germany' },
      // 3: DROP — no title at all
      { id: 1004, location: 'Berlin,Germany', canonicalPositionUrl: 'https://careers.acme.example/careers/job/1004' },
      // 4: DROP — no id and no usable URL
      { name: 'Ghost Role', location: 'Berlin,Germany' },
      // 5: DROP — non-https canonical URL and no id to fall back on
      { name: 'Insecure Role', location: 'Berlin', canonicalPositionUrl: 'http://careers.acme.example/careers/job/1005' },
      // 6: not an object
      null,
    ],
  };
  const parsed = parseEightfoldResponse(fixture, T, 'Acme');

  if (parsed.length === 3) {
    pass('parseEightfoldResponse() drops rows with no title / no id / no https URL (7 in → 3 out)');
  } else {
    fail(`drop rules: expected 3 kept, got ${parsed.length}: ${JSON.stringify(parsed.map((j) => j.title))}`);
  }

  const first = parsed[0];
  if (first?.title === 'Staff Backend Engineer'
      && first.url === 'https://careers.acme.example/careers/job/1001'
      && first.company === 'Acme'
      && first.location === 'Berlin,Germany · Munich,Germany') {
    pass('parseEightfoldResponse() maps title/url/company and folds locations[] into location');
  } else {
    fail(`row mapping: ${JSON.stringify(first)}`);
  }

  // t_create is epoch SECONDS — not ms, and not an ISO string like every
  // other provider's date field. Getting this wrong dates postings to 1970.
  if (first?.postedAt === 1_780_000_000_000) {
    pass('parseEightfoldResponse() converts t_create (epoch seconds) to epoch ms');
  } else {
    fail(`postedAt = ${first?.postedAt} (expected 1780000000000)`);
  }

  if (parsed[1]?.url === buildJobUrl(T, '1002')) {
    pass('parseEightfoldResponse() falls back to the tenant posting URL when canonicalPositionUrl is absent');
  } else {
    fail(`fallback url = ${parsed[1]?.url}`);
  }

  if (parsed[2]?.title === 'Product Manager' && parsed[2]?.postedAt === undefined) {
    pass('parseEightfoldResponse() reads posting_name as a title fallback and omits postedAt when undated');
  } else {
    fail(`posting_name row = ${JSON.stringify(parsed[2])}`);
  }

  // Degenerate payloads must return [] rather than throw.
  const degenerate = [null, undefined, {}, [], 'nope', { positions: null }, { positions: 'x' }];
  if (degenerate.every((j) => {
    const r = parseEightfoldResponse(j, T, 'X');
    return Array.isArray(r) && r.length === 0;
  })) {
    pass('parseEightfoldResponse() returns [] for null/{}/[]/non-array payloads (no crash)');
  } else {
    fail('parseEightfoldResponse() should return [] for degenerate payloads');
  }

  // ── fetch: pagination, page-size cap, redirect:"error" ──────────────
  const full = (n, offset) => Array.from({ length: n }, (_, i) => ({
    id: offset + i, name: `Role ${offset + i}`, location: 'Berlin,Germany',
  }));
  const { calls, ctx } = mockCtx({
    0: { count: 25, positions: full(10, 0) },
    10: { count: 25, positions: full(10, 10) },
    20: { count: 25, positions: full(5, 20) },   // short page → stop
  });
  const jobs = await ef.fetch({ name: 'Acme', careers_url: 'https://acme.eightfold.ai/careers' }, ctx);

  if (calls.length === 3 && jobs.length === 25) {
    pass('eightfold.fetch() paginates by start= and aggregates (3 pages → 25 jobs)');
  } else {
    fail(`pagination: ${calls.length} requests, ${jobs.length} jobs (expected 3 / 25)`);
  }

  // The server caps a page at 10 regardless of what `num` asks for, so
  // pagination is mandatory rather than an optimization.
  if (calls.every((c) => new URL(c.url).searchParams.get('num') === '10')) {
    pass('eightfold.fetch() requests num=10 — the server caps a page at 10 regardless');
  } else {
    fail(`page size: ${calls.map((c) => new URL(c.url).searchParams.get('num')).join(',')}`);
  }

  if (calls.every((c) => c.opts?.redirect === 'error')) {
    pass('eightfold.fetch() passes redirect:"error" on every page (SSRF via redirect)');
  } else {
    fail(`redirect option: ${JSON.stringify(calls.map((c) => c.opts?.redirect))}`);
  }

  if (calls.every((c) => c.opts?.headers?.['User-Agent'] && c.opts.headers.Accept === 'application/json')) {
    pass('eightfold.fetch() sends browser UA + Accept: application/json');
  } else {
    fail(`fetch headers = ${JSON.stringify(calls[0]?.opts?.headers)}`);
  }

  if (calls.every((c) => hostOf(c.url) === 'acme.eightfold.ai')) {
    pass('eightfold.fetch() only ever requests the pinned tenant host');
  } else {
    fail(`hosts requested: ${calls.map((c) => hostOf(c.url)).join(',')}`);
  }

  // An empty board is a valid answer, not an error.
  const empty = mockCtx({ 0: { count: 0, positions: [] } });
  const none = await ef.fetch({ name: 'Acme', careers_url: 'https://acme.eightfold.ai/careers' }, empty.ctx);
  if (Array.isArray(none) && none.length === 0 && empty.calls.length === 1) {
    pass('eightfold.fetch() returns [] after a single request for an empty board');
  } else {
    fail(`empty board: ${none.length} jobs in ${empty.calls.length} requests`);
  }

  // max_pages caps the loop even when the board claims more.
  const bigPages = {};
  for (let s = 0; s <= 500; s += 10) bigPages[s] = { count: 500, positions: full(10, s) };
  const capped = mockCtx(bigPages);
  const cappedJobs = await ef.fetch(
    { name: 'Big', careers_url: 'https://big.eightfold.ai/careers', max_pages: 4 },
    capped.ctx,
  );
  if (capped.calls.length === 4 && cappedJobs.length === 40) {
    pass('eightfold.fetch() honors max_pages on the entry (4 pages → 40 jobs)');
  } else {
    fail(`max_pages: ${capped.calls.length} requests, ${cappedJobs.length} jobs (expected 4 / 40)`);
  }

  // ctx.maxPages is verify-portals.mjs's health-probe hint — it must narrow further.
  const probe = mockCtx(bigPages);
  await ef.fetch({ name: 'Big', careers_url: 'https://big.eightfold.ai/careers' }, { ...probe.ctx, maxPages: 1 });
  if (probe.calls.length === 1) {
    pass('eightfold.fetch() honors the ctx.maxPages probe hint (1 page)');
  } else {
    fail(`ctx.maxPages hint: ${probe.calls.length} requests (expected 1)`);
  }

  // An undetectable entry must throw BEFORE any network call.
  let touched = false;
  try {
    await ef.fetch(
      { name: 'BadCo', careers_url: 'https://example.com/careers' },
      { transport: 'http', fetchText: async () => '', fetchJson: async () => { touched = true; return {}; } },
    );
    fail('eightfold.fetch() should throw for an undetectable entry');
  } catch (e) {
    if (/cannot derive API URL for BadCo/.test(e.message) && !touched) {
      pass('eightfold.fetch() throws "cannot derive API URL" before any request');
    } else {
      fail(`unexpected fetch error / fetchJson called=${touched}: ${e.message}`);
    }
  }
  // ── PCSX tenants: same host, other endpoint ───────────────────────────────
  // Eightfold is moving tenants from /api/apply/v2/jobs to /api/pcsx/search. A
  // migrated tenant answers 403 on the classic path, which this provider used to
  // read as the WAF case: the board returned zero postings on every run, with no
  // error. Microsoft (2,395 postings) was dark for 3+ scans that way.
  const httpErr = (status, message) => Object.assign(new Error(`HTTP ${status}`), { status, body: JSON.stringify({ message }) });
  const pcsxPage = (rows, count) => ({ data: { count, positions: rows } });
  const position = (id, name) => ({ id, name, canonicalPositionUrl: `https://microsoft.eightfold.ai/careers/job/${id}`, locations: ['Redmond, WA'] });
  const TENANT = { name: 'Microsoft', careers_url: 'https://microsoft.eightfold.ai/careers' };
  const recording = (respond) => {
    const calls = [];
    return { calls, ctx: { transport: 'http', sleep: async () => {}, fetchText: async () => { throw new Error('no fetchText'); }, fetchJson: async (url, opts) => { const c = { url, opts, n: calls.length }; calls.push(c); return respond(c); } } };
  };

  // v2 403 -> one PCSX probe on the same host -> paging continues on PCSX.
  {
    const { ctx, calls } = recording((c) => {
      if (c.url.includes('/api/apply/v2/jobs')) throw httpErr(403, 'Not authorized for PCSX');
      const start = Number(new URL(c.url).searchParams.get('start') || 0);
      const rows = start === 0 ? Array.from({ length: 10 }, (_, i) => position(String(i), `Role ${i}`)) : [position('90', 'Last Role')];
      return pcsxPage(rows, 11);
    });
    const jobs = await ef.fetch(TENANT, ctx);
    const v2Calls = calls.filter((c) => c.url.includes('/api/apply/v2/jobs'));
    const pcsxCalls = calls.filter((c) => c.url.includes('/api/pcsx/search'));
    jobs.length === 11 && v2Calls.length === 1 && pcsxCalls.length === 2
      ? pass('eightfold switches to /api/pcsx/search after one 403 and pages there (1 v2 + 2 pcsx requests, 11 jobs)')
      : fail(`pcsx switch: ${jobs.length} jobs, ${v2Calls.length} v2 + ${pcsxCalls.length} pcsx requests`);
    pcsxCalls.every((c) => new URL(c.url).hostname === 'microsoft.eightfold.ai' && c.opts?.redirect === 'error')
      ? pass('eightfold PCSX requests stay on the pinned tenant host with redirect:"error"')
      : fail(`pcsx request targets: ${JSON.stringify(pcsxCalls.map((c) => [c.url, c.opts?.redirect]))}`);
    jobs[0]?.title === 'Role 0' && jobs[0]?.company === 'Microsoft' && jobs[0]?.url.includes('/careers/job/0')
      ? pass('eightfold maps PCSX positions through the same Job normalizer as v2')
      : fail(`pcsx mapping: ${JSON.stringify(jobs[0])}`);
  }

  // A classic tenant must never pay for the probe.
  {
    const { ctx, calls } = recording(() => ({ positions: [position('1', 'Classic Role')], count: 1 }));
    const jobs = await ef.fetch({ name: 'Netflix', careers_url: 'https://netflix.eightfold.ai/careers' }, ctx);
    jobs.length === 1 && calls.every((c) => c.url.includes('/api/apply/v2/jobs'))
      ? pass('eightfold makes zero PCSX requests when the classic endpoint answers')
      : fail(`classic tenant made ${calls.length} requests: ${calls.map((c) => c.url).join(' ')}`);
  }

  // Both endpoints refusing is the WAF case, and the ORIGINAL 403 has to survive
  // — a 403 wrapped in a new Error stops reading as a deterministic failure.
  {
    const { ctx } = recording((c) => { throw httpErr(403, c.url.includes('pcsx') ? 'PCSX is not enabled for this user.' : 'Forbidden'); });
    let caught = null;
    await ef.fetch(TENANT, ctx).catch((e) => { caught = e; });
    caught && caught.status === 403 && /HTTP 403/.test(caught.message)
      ? pass('eightfold rethrows the ORIGINAL 403 when PCSX refuses too (WAF case unchanged)')
      : fail(`double-403: ${caught && caught.message} status=${caught && caught.status}`);
  }

  // Any OTHER probe failure is reported as itself. Swapping in the v2 403 turned a
  // busy (429), broken (5xx) or unreachable PCSX endpoint into what reads as a
  // deterministic WAF block (CodeRabbit, #4297).
  for (const [label, probeErr] of [
    ['a 500', httpErr(500, 'Internal Server Error')],
    ['a 429', httpErr(429, 'slow down')],
    ['a network error', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
  ]) {
    const { ctx } = recording((c) => {
      if (c.url.includes('/api/apply/v2/jobs')) throw httpErr(403, 'Not authorized for PCSX');
      throw probeErr;
    });
    let caught = null;
    await ef.fetch(TENANT, ctx).catch((e) => { caught = e; });
    caught === probeErr
      ? pass(`eightfold surfaces ${label} on the PCSX probe as itself, not as the v2 403`)
      : fail(`pcsx probe ${label}: got ${caught && caught.message} status=${caught && caught.status}`);
  }

  // A later PCSX page that decodes to null must fail with the descriptive error,
  // not a TypeError from `'positions' in null`.
  {
    const { ctx } = recording((c) => {
      if (c.url.includes('/api/apply/v2/jobs')) throw httpErr(403, 'Not authorized for PCSX');
      const start = Number(new URL(c.url).searchParams.get('start') || 0);
      return start === 0 ? pcsxPage(Array.from({ length: 10 }, (_, i) => position(String(i), `R${i}`)), 25) : null;
    });
    let caught = null;
    await ef.fetch(TENANT, ctx).catch((e) => { caught = e; });
    caught && !(caught instanceof TypeError) && /unrecognized \/api\/pcsx\/search body at start=10/.test(caught.message)
      ? pass('eightfold reports a null PCSX page as an unrecognized body, not a TypeError')
      : fail(`null pcsx page: ${caught && caught.constructor.name}: ${caught && caught.message}`);
  }

  // A 200 from PCSX that is not a PCSX page means the endpoint moved again.
  {
    const { ctx } = recording((c) => {
      if (c.url.includes('/api/apply/v2/jobs')) throw httpErr(403, 'Not authorized for PCSX');
      return { message: 'hello' };
    });
    let msg = '';
    await ef.fetch(TENANT, ctx).catch((e) => { msg = e.message; });
    /neither API is readable/.test(msg)
      ? pass('eightfold throws when the PCSX body is unrecognizable instead of returning zero jobs')
      : fail(`unrecognized pcsx body error: ${JSON.stringify(msg)}`);
  }

  // A `data` envelope without a positions array is equally unrecognizable — an
  // empty board and a changed schema must not look the same.
  {
    const { ctx } = recording((c) => {
      if (c.url.includes('/api/apply/v2/jobs')) throw httpErr(403, 'Not authorized for PCSX');
      return { data: { count: 5 } };
    });
    let msg = '';
    await ef.fetch(TENANT, ctx).catch((e) => { msg = e.message; });
    /neither API is readable/.test(msg)
      ? pass('eightfold throws when the PCSX data envelope carries no positions array')
      : fail(`pcsx data-without-positions error: ${JSON.stringify(msg)}`);
  }

  // A 429 is transient, not a migration signal: no PCSX probe, and the pages
  // already collected survive with a loud "partial" warning.
  {
    const { ctx, calls } = recording((c) => {
      const start = Number(new URL(c.url).searchParams.get('start') || 0);
      if (start === 0) return { positions: Array.from({ length: 10 }, (_, i) => position(String(i), `R${i}`)), count: 500 };
      throw httpErr(429, 'slow down');
    });
    const jobs = await ef.fetch(TENANT, ctx);
    jobs.length === 10 && calls.every((c) => c.url.includes('/api/apply/v2/jobs'))
      ? pass('eightfold keeps collected pages on a mid-walk 429 and never probes PCSX for it')
      : fail(`429 handling: ${jobs.length} jobs, urls=${[...new Set(calls.map((c) => c.url.split('?')[0]))].join(' ')}`);
  }

} catch (e) {
  fail(`eightfold provider tests crashed: ${e.message}`);
}
