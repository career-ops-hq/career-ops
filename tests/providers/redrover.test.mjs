// tests/providers/redrover.test.mjs — Red Rover K12 provider.
// One GraphQL POST to a fixed API host; covers detect() host/path gating, the response
// parser (public-only, closed rows, GraphQL errors, hasMoreData) and the request guards.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — redrover');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/redrover.mjs')).href);
  const redrover = mod.default;
  const { parseRedRoverResponse } = mod;

  if (redrover.id === 'redrover') pass('redrover.id is "redrover"');
  else fail(`redrover.id is ${JSON.stringify(redrover.id)}`);

  // ── detect() ──────────────────────────────────────────────────────
  for (const url of ['https://jobs.redroverk12.com/org/4242', 'https://jobs.redroverk12.com/org/4242/opening/9', 'https://JOBS.redroverk12.com/org/4242/']) {
    const hit = redrover.detect({ name: 'Acme', careers_url: url });
    if (hit && hit.url === 'https://jobs.redroverk12.com/org/4242') pass(`redrover.detect() resolves ${url}`);
    else fail(`redrover.detect(${url}) returned ${JSON.stringify(hit)}`);
  }
  const negatives = {
    'a non-Red Rover host': { careers_url: 'https://example.com/org/4242' },
    'a path-spoofed URL': { careers_url: 'https://evil.example/jobs.redroverk12.com/org/4242' },
    'a lookalike host': { careers_url: 'https://jobs.redroverk12.com.evil.example/org/4242' },
    'http': { careers_url: 'http://jobs.redroverk12.com/org/4242' },
    'no org path': { careers_url: 'https://jobs.redroverk12.com/' },
    'a non-numeric org id': { careers_url: 'https://jobs.redroverk12.com/org/abc' },
    'an org id with trailing junk': { careers_url: 'https://jobs.redroverk12.com/org/42x' },
    'a malformed URL': { careers_url: 'not a url' },
    'null careers_url': { careers_url: null },
    'a non-string careers_url': { careers_url: 7 },
    'no careers_url': {},
  };
  for (const [label, extra] of Object.entries(negatives)) {
    let got;
    try { got = redrover.detect({ name: 'X', ...extra }); } catch (e) { got = `threw ${e.message}`; }
    if (got === null) pass(`redrover.detect() returns null for ${label}`);
    else fail(`redrover.detect() for ${label} returned ${JSON.stringify(got)}`);
  }

  // ── parser ────────────────────────────────────────────────────────
  const ORIGIN = 'https://jobs.redroverk12.com';
  const wrap = (results, extra = {}) => ({ data: { jobSeekerSiteUnauthenticated: { jobPostingSearch: { results, hasMoreData: false, ...extra } } } });
  const posting = (over) => ({ id: '9001', name: 'Math Teacher', organizationName: 'Example SD', location: { name: 'Example High' }, activePublicOnDateUtc: '2026-09-09T07:00:00Z', closedOnDateUtc: null, allowsRemote: false, ...over });
  const json = wrap([
    posting({}),
    posting({ id: 9002, name: 'Remote Tutor', allowsRemote: true, activePublicOnDateUtc: 'garbage' }),
    posting({ id: '9003', name: 'Internal Only', activePublicOnDateUtc: null }),         // internal → dropped
    posting({ id: '9004', name: 'Closed', closedOnDateUtc: '2026-09-01T00:00:00Z' }),    // closed → dropped
    posting({ id: 'abc', name: 'Non-numeric id' }),                                       // dropped
    posting({ id: '9005', name: '' }),                                                    // no name → dropped
    null,                                                                                  // junk → dropped
  ]);
  const jobs = parseRedRoverResponse(json, 'Acme', ORIGIN, '4242');
  if (jobs.length === 2) pass('parseRedRoverResponse keeps public open postings with a numeric id + name, drops the rest');
  else fail(`parseRedRoverResponse returned ${jobs.length} jobs (expected 2): ${JSON.stringify(jobs)}`);
  if (!jobs.some((j) => j.title === 'Internal Only')) pass('parseRedRoverResponse drops internal-only postings (no public activation date)');
  else fail('parseRedRoverResponse leaked an internal-only posting');
  if (jobs[0]?.url === `${ORIGIN}/org/4242/opening/9001` && jobs[0]?.company === 'Acme') pass('parseRedRoverResponse builds /org/<org>/opening/<id> and sets company');
  else fail(`parseRedRoverResponse url/company was ${JSON.stringify(jobs[0])}`);
  if (jobs[0]?.location === 'Example High - Example SD') pass('parseRedRoverResponse joins location and organization');
  else fail(`parseRedRoverResponse location was ${JSON.stringify(jobs[0]?.location)}`);
  if (jobs[1]?.url.endsWith('/opening/9002') && jobs[1]?.location.endsWith('(Remote)')) pass('parseRedRoverResponse coerces a numeric id and tags allowsRemote');
  else fail(`parseRedRoverResponse remote row was ${JSON.stringify(jobs[1])}`);
  if (jobs[0]?.postedAt === Date.parse('2026-09-09T07:00:00Z') && !('postedAt' in jobs[1])) pass('parseRedRoverResponse sets postedAt from the public date and omits it when unparseable (NaN-safe)');
  else fail(`parseRedRoverResponse postedAt: ${jobs[0]?.postedAt} / ${jobs[1]?.postedAt}`);

  for (const [label, empty] of [['null', null], ['{}', {}], ['{data: null}', { data: null }], ['no results', wrap(undefined)], ['results: []', wrap([])]]) {
    if (parseRedRoverResponse(empty, 'X', ORIGIN, '1').length === 0) pass(`parseRedRoverResponse ${label} → []`);
    else fail(`parseRedRoverResponse ${label} should be []`);
  }
  for (const [label, bad, re] of [
    ['a GraphQL errors array', { errors: [{ message: 'Org not found' }] }, /Org not found/],
    ['a site envelope with no jobPostingSearch', { data: { jobSeekerSiteUnauthenticated: { somethingElse: 1 } } }, /unexpected response shape.*somethingElse/],
    ['hasMoreData: true', wrap([posting({})], { hasMoreData: true }), /more postings than one response holds/],
  ]) {
    try { parseRedRoverResponse(bad, 'X', ORIGIN, '1'); fail(`parseRedRoverResponse should throw for ${label}`); }
    catch (e) { if (re.test(e.message)) pass(`parseRedRoverResponse throws a descriptive error for ${label}`); else fail(`parseRedRoverResponse ${label} threw: ${e.message}`); }
  }

  // ── fetch() ───────────────────────────────────────────────────────
  const noSleep = async () => {};
  const entry = { name: 'Acme', careers_url: 'https://jobs.redroverk12.com/org/4242' };
  let calls = [];
  let ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return json; }, sleep: noSleep };
  let out = await redrover.fetch(entry, ctx);
  if (out.length === 2 && calls.length === 1) pass('redrover.fetch() makes one request and returns the parsed jobs');
  else fail(`redrover.fetch() made ${calls.length} calls, ${out.length} jobs`);
  const c = calls[0];
  if (c.url === 'https://api.redroverk12.com/graphql' && c.opts.method === 'POST' && c.opts.redirect === 'error') pass("redrover.fetch() POSTs to the fixed API host with redirect: 'error'");
  else fail(`redrover.fetch() request was ${c.url} ${JSON.stringify({ method: c.opts.method, redirect: c.opts.redirect })}`);
  const sent = JSON.parse(c.opts.body);
  if (sent.variables?.search?.orgId === '4242' && /jobPostingSearch/.test(sent.query)) pass('redrover.fetch() sends the org id from careers_url in the GraphQL variables');
  else fail(`redrover.fetch() body was ${c.opts.body}`);

  calls = [];
  try { await redrover.fetch({ name: 'Evil', careers_url: 'https://evil.example/org/4242' }, ctx); fail('redrover.fetch() should throw for a bad careers_url'); }
  catch (e) { if (calls.length === 0 && /cannot derive org id/.test(e.message)) pass('redrover.fetch() throws on a bad careers_url before any request'); else fail(`redrover.fetch() bad-url: ${calls.length} calls, ${e.message}`); }

  // a transient failure is retried; a 4xx is not
  let attempts = 0;
  ctx = { fetchJson: async () => { attempts++; if (attempts < 2) { const e = new Error('HTTP 502'); e.status = 502; throw e; } return json; }, sleep: noSleep };
  out = await redrover.fetch(entry, ctx);
  if (out.length === 2 && attempts === 2) pass('redrover.fetch() retries a 502 and recovers');
  else fail(`redrover.fetch() flaky: ${attempts} attempts, ${out.length} jobs`);
  let hard = 0;
  ctx = { fetchJson: async () => { hard++; const e = new Error('HTTP 400'); e.status = 400; throw e; }, sleep: noSleep };
  try { await redrover.fetch(entry, ctx); fail('redrover.fetch() should throw on a 400'); }
  catch { if (hard === 1) pass('redrover.fetch() does not retry a 400'); else fail(`redrover.fetch() retried a 400 ${hard} times`); }

  // probe cooperation: a single request, and a rejection propagates unwrapped
  class ProbeSentinel extends Error {}
  const sentinel = new ProbeSentinel('budget');
  try {
    await redrover.fetch(entry, { fetchJson: async () => { throw sentinel; }, sleep: noSleep, maxPages: 1 });
    fail('redrover.fetch() should reject when ctx.fetchJson rejects');
  } catch (e) {
    if (e === sentinel) pass('redrover.fetch() propagates a ctx.fetchJson rejection unwrapped during a probe');
    else fail(`redrover.fetch() wrapped the rejection: ${e?.constructor?.name}: ${e?.message}`);
  }
  calls = [];
  ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return json; }, sleep: noSleep, maxPages: 1 };
  await redrover.fetch(entry, ctx);
  if (calls.length === 1) pass('redrover.fetch() makes exactly one request under ctx.maxPages: 1');
  else fail(`redrover.fetch() under ctx.maxPages made ${calls.length} requests`);
} catch (e) {
  fail(`redrover provider tests crashed: ${e.stack || e.message}`);
}
