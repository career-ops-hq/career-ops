// tests/providers/apple.test.mjs — apple provider contract.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nProvider — apple');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/apple.mjs')).href);
  const provider = mod.default;

  if (provider.id === 'apple') pass('apple.id is "apple"');
  else fail(`apple.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'X', careers_url: 'https://jobs.apple.com/en-us/search' });
  if (hit && hit.url) pass('apple.detect() resolves its careers host to an endpoint');
  else fail(`apple.detect() returned ${JSON.stringify(hit)}`);

  // The host must be compared exactly. A substring match would let
  // https://evil.example.com/jobs.apple.com/ and https://jobs.apple.com.evil.example.com/
  // both claim this provider and point the scanner at an attacker's server.
  const pathHijack = provider.detect({ name: 'X', careers_url: 'https://evil.example.com/jobs.apple.com/careers' });
  const suffixHijack = provider.detect({ name: 'X', careers_url: 'https://jobs.apple.com.evil.example.com/careers' });
  if (pathHijack === null && suffixHijack === null) {
    pass('apple.detect() compares the host exactly (path and suffix hijacks rejected)');
  } else {
    fail(`apple.detect() hijackable: path=${JSON.stringify(pathHijack)} suffix=${JSON.stringify(suffixHijack)}`);
  }

  if (provider.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('apple.detect() returns null for an unrelated host');
  } else {
    fail('apple.detect() should return null for an unrelated host');
  }

  if (provider.detect({ name: 'X', careers_url: null }) === null && provider.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('apple.detect() treats a non-string careers_url as missing');
  } else {
    fail('apple.detect() should treat a non-string careers_url as missing');
  }

  if (typeof provider.fetch === 'function') pass('apple.fetch() is callable');
  else fail('apple.fetch() is not a function');

  // Following a redirect lets a compromised host bounce the scanner to an
  // internal address and have the response parsed as job data.
  // ── behaviour, not source greps: every assertion below drives fetch() ──────
  // One page of Apple's SSR hydration blob, built the way the live page embeds
  // it: a JSON string literal inside JSON.parse("...").
  const hydration = (rows, totalRecords) => {
    const blob = JSON.stringify({ loaderData: { search: { searchResults: rows, totalRecords } } });
    return `<!doctype html><script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(blob)});</script>`;
  };
  const row = (id, title) => ({
    id,
    postingTitle: title,
    transformedPostingTitle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    locations: [{ name: 'Cupertino, California, United States' }],
    postDateInGMT: '2026-09-10T00:00:00Z',
    team: { teamCode: 'OPMFG-BPM' },
  });

  /** Recording ctx: every request and its options are kept for assertions. */
  const recordingCtx = (respond, extra = {}) => {
    const calls = [];
    const fetchText = async (url, opts = {}) => {
      const call = { url, opts, n: calls.length };
      calls.push(call);
      return respond(call);
    };
    return { calls, ctx: { transport: 'http', sleep: async () => {}, fetchText, fetchJson: async () => { throw new Error('apple must not call fetchJson'); }, ...extra } };
  };
  const ENTRY = { name: 'Apple', careers_url: 'https://jobs.apple.com/en-us/search', apple: { queries: ['corporate strategy'], teams: [] } };

  // Parse: a realistic page yields literal field values, not just "some jobs".
  {
    const { ctx, calls } = recordingCtx(() => hydration([row('200613455', 'Business Process Re-Engineering Manager')], 1));
    const jobs = await provider.fetch(ENTRY, ctx);
    const j = jobs[0];
    j && jobs.length === 1
      && j.title === 'Business Process Re-Engineering Manager'
      && j.url === 'https://jobs.apple.com/en-us/details/200613455/business-process-re-engineering-manager?team=OPMFG-BPM'
      && j.company === 'Apple'
      && j.location === 'Cupertino, California, United States'
      && j.externalId === '200613455'
      && j.postedAt === Date.parse('2026-09-10T00:00:00Z')
      ? pass('apple.fetch() maps title/url/company/location/externalId/postedAt from the hydration blob')
      : fail(`apple.fetch() mapping: ${JSON.stringify(jobs)}`);
    calls.every((c) => c.opts?.redirect === 'error')
      ? pass('apple.fetch() passes redirect:"error" on every recorded request')
      : fail(`apple redirect opts: ${JSON.stringify(calls.map((c) => c.opts))}`);
    calls.every((c) => !Object.keys(c.opts?.headers || {}).some((h) => h.toLowerCase() === 'user-agent'))
      ? pass('apple.fetch() sets no provider User-Agent — _http.mjs supplies the shared identifying one')
      : fail(`apple sent its own UA: ${JSON.stringify(calls.map((c) => c.opts?.headers))}`);
  }

  // The detail URL is built from host-supplied strings: each segment is encoded,
  // and a posting whose segment cannot be encoded is dropped, not the board.
  {
    const slashed = { ...row('300000001', 'Strategy Lead'), transformedPostingTitle: 'strategy/lead?x#y' };
    const surrogate = { ...row('300000002', 'Ops Lead'), transformedPostingTitle: 'ops-\uD800-lead' };
    const plain = row('300000003', 'Finance Lead');
    const { ctx } = recordingCtx(() => hydration([slashed, surrogate, plain], 3));
    const jobs = await provider.fetch(ENTRY, ctx);
    const byId = Object.fromEntries(jobs.map((j) => [j.externalId, j.url]));
    byId['300000001'] === 'https://jobs.apple.com/en-us/details/300000001/strategy%2Flead%3Fx%23y?team=OPMFG-BPM'
      ? pass('apple.fetch() encodes the title segment, so "/", "?" and "#" cannot restructure the URL')
      : fail(`apple slashed slug: ${byId['300000001']}`);
    !('300000002' in byId) && byId['300000003'] && jobs.length === 2
      ? pass('apple.fetch() drops a posting whose segment cannot be URI-encoded and keeps the rest')
      : fail(`apple surrogate handling: ${JSON.stringify(byId)}`);
  }

  // Probe: verify-portals sets ctx.maxPages, which must cost exactly one request
  // across every query and team axis, not one per axis.
  {
    const { ctx, calls } = recordingCtx(() => hydration(Array.from({ length: 20 }, (_, i) => row(String(i), `Role ${i}`)), 999));
    await provider.fetch({ ...ENTRY, apple: { queries: ['a', 'b', 'c'], teams: ['t1', 't2'] } }, { ...ctx, maxPages: 1 });
    calls.length === 1
      ? pass('apple.fetch() honours ctx.maxPages: one request for the whole probe')
      : fail(`apple probe made ${calls.length} requests: ${JSON.stringify(calls.map((c) => c.url))}`);
  }

  // Probe errors must propagate unwrapped, or verify-portals reads its own
  // request-budget sentinel as a dead board.
  {
    class ProbeBudget extends Error {}
    const { ctx } = recordingCtx(() => { throw new ProbeBudget('budget'); });
    let caught = null;
    await provider.fetch(ENTRY, { ...ctx, maxPages: 1 }).catch((e) => { caught = e; });
    caught instanceof ProbeBudget
      ? pass('apple.fetch() propagates a probe fetch rejection unwrapped')
      : fail(`apple probe swallowed the rejection: ${caught && caught.constructor.name}`);
  }

  // During a real scan the opposite holds: one failing axis must not cost the
  // postings the other axes already produced.
  {
    const { ctx, calls } = recordingCtx((call) => {
      if (call.url.includes('q=alpha') || call.url.includes('search=alpha')) throw new Error('HTTP 500');
      return hydration([row('9', 'Kept Role')], 1);
    });
    const jobs = await provider.fetch({ ...ENTRY, apple: { queries: ['alpha', 'beta'], teams: [] } }, ctx);
    jobs.length === 1 && jobs[0].title === 'Kept Role' && calls.length >= 2
      ? pass('apple.fetch() keeps other axes when one search fails during a scan')
      : fail(`apple scan recall: ${JSON.stringify(jobs)} in ${calls.length} requests`);
  }

  // A layout change must be loud. Returning [] would read as "no matching roles"
  // forever, which is how a dead provider hides.
  {
    const { ctx } = recordingCtx(() => '<!doctype html><p>no blob here</p>');
    let msg = '';
    await provider.fetch(ENTRY, ctx).catch((e) => { msg = e.message; });
    /hydration blob/.test(msg)
      ? pass('apple.fetch() throws a descriptive error when the hydration blob is gone')
      : fail(`apple missing-blob error was ${JSON.stringify(msg)}`);
  }

  // max_pages belongs on the ENTRY and is clamped, so one portals.yml line
  // cannot start an unbounded walk against an endless board.
  {
    const { ctx, calls } = recordingCtx(() => hydration(Array.from({ length: 20 }, (_, i) => row(String(i), `R${i}`)), 100000));
    await provider.fetch({ ...ENTRY, max_pages: 3 }, ctx);
    calls.length === 3
      ? pass('apple.fetch() honours entry.max_pages against an endless board')
      : fail(`apple max_pages=3 made ${calls.length} requests`);

    const { ctx: cappedCtx, calls: cappedCalls } = recordingCtx(() => hydration(Array.from({ length: 20 }, (_, i) => row(String(i), `R${i}`)), 100000));
    await provider.fetch({ ...ENTRY, max_pages: 9999 }, cappedCtx);
    cappedCalls.length === 50
      ? pass('apple.fetch() clamps an oversized max_pages to the hard ceiling (50)')
      : fail(`apple max_pages=9999 made ${cappedCalls.length} requests, expected the 50-page cap`);
  }

  // Pages after the first are paced through ctx.sleep.
  {
    let slept = 0;
    const { ctx } = recordingCtx(() => hydration(Array.from({ length: 20 }, (_, i) => row(String(i), `R${i}`)), 100000), { sleep: async () => { slept++; } });
    await provider.fetch({ ...ENTRY, max_pages: 3 }, ctx);
    slept === 2
      ? pass('apple.fetch() paces pages after the first (2 sleeps across 3 pages)')
      : fail(`apple paced ${slept} times across 3 pages`);
  }

} catch (e) {
  fail(`apple provider tests crashed: ${e.message}`);
}
