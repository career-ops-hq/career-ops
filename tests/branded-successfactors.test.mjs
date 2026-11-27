import assert from 'assert/strict';
import { detectBrandedSuccessFactors, classifyUnknownHostSeeds, makeHeadProbe } from '../branded-successfactors.mjs';
import { runHistorySeedScan, parseArgs } from '../scan-ats-full.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nBranded SuccessFactors detection (#5739)');

const RMK_PAGE = `<html><head><script src="https://rmkcdn.successfactors.com/abc/app.js"></script></head>
<body><ul><li class="job-tile job-id-1"><a class="jobTitle-link" href="/job/x/1">Analyst</a></li></ul></body></html>`;
const CSB_PAGE = `<html><head><script src="/platform/js/search/searchResultsUnify.min.js"></script></head><body></body></html>`;
const SAPSF_ASSET = `<link rel="stylesheet" href="//career5.sapsf.eu/sf/css/site.css">`;
const JOBS2WEB = `<img src="https://images.jobs2web.com/logo.png">`;
const TILE_ENDPOINT = `<form action="/tile-search-results/?q=">`;
const UNRELATED = `<html><body><h1>Careers</h1>
<script src="https://cdn.example.com/app.js"></script>
<p>Our HR team uses SuccessFactors internally. See <a href="https://www.successfactors.com/">their site</a>.</p>
<ul class="jobs"><li class="job-card"><a href="/jobs/1">Analyst</a></li></ul></body></html>`;

try {
  for (const [name, html] of [['RMK', RMK_PAGE], ['CSB', CSB_PAGE], ['sapsf asset', SAPSF_ASSET], ['jobs2web asset', JOBS2WEB], ['tile endpoint', TILE_ENDPOINT]]) {
    assert.equal(detectBrandedSuccessFactors(html), true, `${name} page must be detected`);
  }
  assert.equal(detectBrandedSuccessFactors(UNRELATED), false, 'prose mention and anchor link are not evidence');
  assert.equal(detectBrandedSuccessFactors('<script src="https://notsuccessfactors.com.evil.test/a.js"></script>'), false);
  assert.equal(detectBrandedSuccessFactors(''), false);
  assert.equal(detectBrandedSuccessFactors(undefined), false);
  assert.equal(detectBrandedSuccessFactors(null, null), false);
  assert.equal(detectBrandedSuccessFactors('<html></html>', { link: '<https://rmkcdn.successfactors.com/x.css>; rel=preload' }), true);
  assert.equal(detectBrandedSuccessFactors('<html></html>', new Headers({ link: '<https://cdn.example.com/x.css>; rel=preload' })), false);
  pass('detector matches SuccessFactors markers and rejects unrelated pages');

  const seeds = [
    { company: 'A', vendor: 'jobs.branded.test', careersUrl: 'https://jobs.branded.test/job/Ottawa-Analyst/123', source: 'tracker' },
    { company: 'A2', vendor: 'jobs.branded.test', careersUrl: 'https://jobs.branded.test/job/Toronto-Clerk/456', source: 'scan-history' },
    { company: 'B', vendor: 'careers.other.test', careersUrl: 'https://careers.other.test', source: 'tracker' },
    { company: 'C', vendor: 'careers.blocked.test', careersUrl: 'https://careers.blocked.test', source: 'tracker' },
    { company: 'D', vendor: 'greenhouse', careersUrl: 'https://job-boards.greenhouse.io/acme', source: 'tracker' },
  ];
  const calls = [];
  const cache = new Map();
  const probe = async (url) => {
    calls.push(url);
    if (url.includes('branded')) return { html: RMK_PAGE };
    if (url.includes('other')) return UNRELATED;
    throw new Error('403 captcha');
  };
  const out = await classifyUnknownHostSeeds(seeds, { probe, cache });
  assert.deepEqual([...calls].sort(), [
    'https://careers.blocked.test/', 'https://careers.other.test/', 'https://jobs.branded.test/job/Ottawa-Analyst/123',
  ], 'one probe per distinct unknown host, on the first seed career URL (not the bare origin); known vendors are never probed');
  const sf = out.filter((s) => s.vendor === 'successfactors');
  assert.equal(sf.length, 1, 'two postings on one branded host collapse to one board');
  assert.equal(sf[0].careersUrl, 'https://jobs.branded.test');
  assert.equal(sf[0].probeConfirmed, true);
  assert.ok(out.some((s) => s.vendor === 'careers.other.test'), 'non-SF host keeps its label');
  assert.ok(out.some((s) => s.vendor === 'careers.blocked.test'), 'failed probe never changes a label');
  assert.ok(out.some((s) => s.vendor === 'greenhouse'));
  assert.equal(cache.get('jobs.branded.test'), true);
  assert.equal(cache.get('careers.other.test'), false);
  assert.equal(cache.get('careers.blocked.test'), null);

  await classifyUnknownHostSeeds(seeds, { probe, cache });
  assert.equal(calls.length, 3, 'cached verdicts (including failures) are not re-probed');
  assert.equal(await classifyUnknownHostSeeds(seeds, {}), seeds, 'no probe injected means no change');
  pass('seed classification probes each unknown host once, caches verdicts, and fails closed');

  // Header-only marker: body is clean, the Link header carries the SF host.
  let seenOpts = null;
  const headProbe = makeHeadProbe(async (url, opts) => {
    seenOpts = opts;
    opts.onResponse({ headers: new Headers({ link: '<https://rmkcdn.successfactors.com/x.css>; rel=preload' }) });
    return '<html><body>Careers</body></html>';
  });
  const headerSeeds = [{ company: 'H', vendor: 'careers.headeronly.test', careersUrl: 'https://careers.headeronly.test', source: 'tracker' }];
  const headerOut = await classifyUnknownHostSeeds(headerSeeds, { probe: headProbe });
  assert.equal(seenOpts.maxBytes, 262144, 'body limit is preserved');
  assert.equal(headerOut[0].vendor, 'successfactors', 'a header-only marker is seen by the default probe');
  pass('default probe captures response headers alongside the capped body');

  assert.equal(parseArgs(['node', 'scan-ats-full.mjs', '--history-seeds', '--probe-unknown-hosts']).probeUnknownHosts, true);
  assert.equal(parseArgs(['node', 'scan-ats-full.mjs', '--history-seeds']).probeUnknownHosts, false);
  assert.equal(parseArgs(['node', 'scan-ats-full.mjs', '--probe-unknown-hosts']).probeUnknownHosts, false, 'probing needs --history-seeds');

  const fetched = [];
  const provider = {
    id: 'successfactors',
    detect: () => null, // URL-only detection cannot claim a branded host
    async fetch(entry) { fetched.push(entry.careers_url); return []; },
  };
  const run = (seed) => runHistorySeedScan(
    [seed], new Map([['successfactors', provider]]),
    { atsExplicit: false, ats: [], limit: Infinity, shuffle: false, verbose: false },
    {}, async () => {},
  );
  await run(sf[0]);
  await run({ ...sf[0], probeConfirmed: undefined });
  assert.deepEqual(fetched, ['https://jobs.branded.test'], 'only the probe-confirmed seed reaches the provider');
  pass('probe-confirmed seeds reach the provider; unconfirmed ones still need detect()');
} catch (error) {
  fail(`branded SuccessFactors regression: ${error.stack || error.message}`);
}
