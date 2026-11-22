// tests/providers/lever.test.mjs — direct provider-contract tests (#1499).
// Covers the id/detect/fetch contract scan.mjs calls: hostname-anchored
// detection for both jobs.lever.co and jobs.eu.lever.co, normalization from
// the v0 postings shape (including the free description text for
// content_filter), and malformed-input tolerance.
// (Indirect coverage elsewhere: tests/providers/ats-ssrf-hardening.test.mjs
// asserts the redirect:'error' guard per instance; liveness tests cover URL
// resolution. This file tests the provider module contract itself.)
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — lever');

try {
  const leverModule = await import(pathToFileURL(join(ROOT, 'providers/lever.mjs')).href);
  const lever = leverModule.default;

  if (lever.id === 'lever') pass('lever.id is "lever"');
  else fail(`lever.id is ${JSON.stringify(lever.id)}`);

  // detect() — positive cases, both instances.
  const hit = lever.detect({ name: 'Acme', careers_url: 'https://jobs.lever.co/acme' });
  if (hit && hit.url === 'https://api.lever.co/v0/postings/acme') {
    pass('lever.detect() resolves jobs.lever.co/<slug> → api.lever.co postings endpoint');
  } else {
    fail(`lever.detect() returned ${JSON.stringify(hit)}`);
  }

  const hitEu = lever.detect({ name: 'EuCo', careers_url: 'https://jobs.eu.lever.co/euco/some-posting' });
  if (hitEu && hitEu.url === 'https://api.eu.lever.co/v0/postings/euco') {
    pass('lever.detect() resolves jobs.eu.lever.co → api.eu.lever.co and takes the first path segment as slug');
  } else {
    fail(`lever.detect(eu) returned ${JSON.stringify(hitEu)}`);
  }

  // detect() — negative / spoof / degenerate cases.
  if (lever.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('lever.detect() returns null for a non-lever careers_url');
  } else {
    fail('lever.detect() should return null for non-lever URLs');
  }

  if (lever.detect({ name: 'Spoof', careers_url: 'https://jobs.lever.co.evil.example/acme' }) === null) {
    pass('lever.detect() rejects a hostname-suffix spoof (jobs.lever.co.evil.example)');
  } else {
    fail('lever.detect() must NOT detect hostname-suffix spoofs');
  }

  if (lever.detect({ name: 'PathSpoof', careers_url: 'https://evil.example/jobs.lever.co/acme' }) === null) {
    pass('lever.detect() rejects a path-spoofed URL (lever host in path, not hostname)');
  } else {
    fail('lever.detect() must NOT detect path-spoofed URLs');
  }

  if (lever.detect({ name: 'NoSlug', careers_url: 'https://jobs.lever.co/' }) === null) {
    pass('lever.detect() returns null when the URL has no board slug');
  } else {
    fail('lever.detect() should return null for a slug-less lever URL');
  }

  if (lever.detect({ name: 'X' }) === null
      && lever.detect({ name: 'X', careers_url: null }) === null
      && lever.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('lever.detect() returns null for missing / null / non-string careers_url');
  } else {
    fail('lever.detect() should treat non-string careers_url as missing');
  }

  // detect() — api: takes precedence over careers_url and is used verbatim
  // when its host is on the allowlist. Lets an entry keep a human-facing
  // corporate careers_url (e.g. https://www.coalfire.com/careers) while
  // pinning the Lever board explicitly.
  const hitApi = lever.detect({
    name: 'Pinned',
    careers_url: 'https://www.coalfire.com/careers',
    api: 'https://api.lever.co/v0/postings/coalfire',
  });
  if (hitApi && hitApi.url === 'https://api.lever.co/v0/postings/coalfire') {
    pass('lever.detect() honors an allowlisted api: over a branded careers_url');
  } else {
    fail(`lever.detect(api-pinned) returned ${JSON.stringify(hitApi)}`);
  }

  // detect() — api: on the EU host is also allowlisted.
  const hitApiEu = lever.detect({ name: 'PinnedEu', api: 'https://api.eu.lever.co/v0/postings/euco' });
  if (hitApiEu && hitApiEu.url === 'https://api.eu.lever.co/v0/postings/euco') {
    pass('lever.detect() honors an allowlisted api: on the EU host');
  } else {
    fail(`lever.detect(api-pinned-eu) returned ${JSON.stringify(hitApiEu)}`);
  }

  // detect() — api: with an untrusted host must NOT be claimed (SSRF guard).
  if (lever.detect({ name: 'Evil', api: 'https://evil.example/v0/postings/acme' }) === null) {
    pass('lever.detect() returns null for an api: on an untrusted host');
  } else {
    fail('lever.detect() must reject an untrusted api: host');
  }

  // detect() — api: must be HTTPS.
  if (lever.detect({ name: 'Insecure', api: 'http://api.lever.co/v0/postings/acme' }) === null) {
    pass('lever.detect() returns null for a non-HTTPS api:');
  } else {
    fail('lever.detect() must reject an http:// api:');
  }

  // detect() — malformed api: URL → null, not a crash.
  if (lever.detect({ name: 'Broken', api: 'not a url' }) === null) {
    pass('lever.detect() returns null for a malformed api: URL');
  } else {
    fail('lever.detect() must reject a malformed api: URL');
  }

  // fetch() — request URL, SSRF guard, and normalization from the real v0
  // postings shape: [{ text, hostedUrl, categories: {location}, descriptionPlain, createdAt }].
  const sample = [
    {
      id: 'lever-posting-1111',
      text: 'Staff Platform Engineer',
      hostedUrl: 'https://jobs.lever.co/acme/1111-staff-platform-engineer',
      categories: { location: 'Remote — Europe', team: 'Platform', commitment: 'Full-time' },
      descriptionPlain: 'Build the platform that powers everything.',
      createdAt: 1751328000000,
    },
    {
      // no text/hostedUrl → '' ; no categories → location '' ;
      // descriptionPlain non-string → '' ; createdAt non-number → undefined
      descriptionPlain: { html: true },
      createdAt: '2026-07-01',
    },
    {},                                                                   // fully empty posting object
    {
      // multi-location posting: `location` carries only the primary city,
      // `allLocations` carries the full set. Both must survive into location.
      text: 'Technical Lead - Java',
      hostedUrl: 'https://jobs.lever.co/acme/2222-technical-lead-java',
      categories: {
        location: 'Barcelona',
        allLocations: ['Barcelona', 'Madrid', 'Montevideo (Hybrid)'],
      },
    },
    {
      // allLocations junk: non-strings, blanks, and a case-variant dupe of the
      // primary must all be dropped without losing the real extra location.
      text: 'Cloud Architect',
      hostedUrl: 'https://jobs.lever.co/acme/3333-cloud-architect',
      categories: {
        location: 'Madrid',
        allLocations: ['  madrid  ', '', null, 42, 'Sao Paulo'],
      },
    },
    {
      // allLocations present but location absent → still resolves.
      text: 'DevOps Engineer',
      hostedUrl: 'https://jobs.lever.co/acme/4444-devops',
      categories: { allLocations: ['Montevideo'] },
    },
    {
      // allLocations not an array → ignored, primary preserved.
      text: 'Security Engineer',
      hostedUrl: 'https://jobs.lever.co/acme/5555-security',
      categories: { location: 'Lisbon', allLocations: 'Lisbon' },
    },
  ];

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await lever.fetch(
    { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://api.lever.co/v0/postings/acme' && capturedOpts?.redirect === 'error') {
    pass('lever.fetch() hits the derived api.lever.co URL with redirect:"error" (SSRF guard)');
  } else {
    fail(`lever.fetch() url=${JSON.stringify(capturedUrl)} opts=${JSON.stringify(capturedOpts)}`);
  }

  // A board-wide feed with inlined descriptions: a large board (jobgether,
  // 42.8 MB) outgrows the 10s _http.mjs default (#4177).
  if (capturedOpts?.timeoutMs === 30_000) {
    pass('lever.fetch() passes the 30s Lever feed timeout, not the 10s default');
  } else {
    fail(`lever.fetch() timeoutMs = ${JSON.stringify(capturedOpts?.timeoutMs)}`);
  }

  if (fetched.length === 7)
    pass('lever.fetch() returns one normalized row per posting (no silent drops)');
  else fail(`lever.fetch() returned ${fetched.length} rows (expected 7)`);

  if (fetched[0]?.title === 'Staff Platform Engineer'
      && fetched[0]?.url === 'https://jobs.lever.co/acme/1111-staff-platform-engineer'
      && fetched[0]?.company === 'Acme'
      && fetched[0]?.listingIdentity?.ats_provider === 'lever'
      && fetched[0]?.listingIdentity?.board_slug === 'acme'
      && fetched[0]?.listingIdentity?.posting_id === 'lever-posting-1111'
      && fetched[0]?.location === 'Remote — Europe'
      && fetched[0]?.description === 'Build the platform that powers everything.'
      && fetched[0]?.postedAt === 1751328000000)
    pass('lever.fetch() maps ATS identity, title/URL/company/location/body/date');
  else fail(`lever.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[1]?.description === '' && fetched[1]?.postedAt === undefined)
    pass('lever.fetch() coerces a non-string descriptionPlain to "" and a non-number createdAt to undefined');
  else fail(`lever.fetch() row 1 = ${JSON.stringify(fetched[1])}`);

  if (fetched[2]?.title === '' && fetched[2]?.url === '' && fetched[2]?.location === ''
      && fetched[2]?.company === 'Acme' && fetched[2]?.description === '' && fetched[2]?.postedAt === undefined)
    pass('lever.fetch() maps an empty posting object to empty-string fields without crashing');
  else fail(`lever.fetch() row 2 = ${JSON.stringify(fetched[2])}`);

  // description = intro + labeled lists + additional, in page order. The
  // content filters only see what lands here, and on a real board the
  // requirements in `lists` are most of the posting.
  const full = leverModule.leverDescription({
    descriptionPlain: 'Build the vaults.',
    lists: [
      { text: 'Requirements', content: '&lt;li&gt;Solidity&lt;/li&gt;&lt;li&gt;Foundry&lt;/li&gt;' },
      { text: 'Nice to have', content: '<li>Rust</li>' },
      { text: '', content: '' },
    ],
    additionalPlain: 'Remote across Europe.',
  });
  const at = (needle) => full.indexOf(needle);
  if (at('Build the vaults.') === 0 && at('Requirements') > 0 && at('Solidity') > at('Requirements')
      && at('Nice to have') > at('Foundry') && at('Rust') > at('Nice to have') && at('Remote across Europe.') > at('Rust'))
    pass('leverDescription appends the labeled lists and additionalPlain after the intro, in page order');
  else fail(`leverDescription => ${JSON.stringify(full)}`);

  // Lever leaves descriptionPlain empty on some boards while description holds
  // the HTML; an empty intro would let every posting pass a positive content gate.
  const htmlOnly = leverModule.leverDescription({ descriptionPlain: '', description: '<div><b>On-chain</b> lending &amp; vaults</div>' });
  if (htmlOnly === 'On-chain lending & vaults')
    pass('leverDescription falls back to the description HTML when descriptionPlain is empty');
  else fail(`leverDescription html fallback => ${JSON.stringify(htmlOnly)}`);

  const [viaFetch] = await lever.fetch(
    { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' },
    { fetchJson: async () => [{ text: 'X', hostedUrl: 'https://jobs.lever.co/acme/6', descriptionPlain: 'Intro.', lists: [{ text: 'Requirements', content: '<li>EVM</li>' }] }] },
  );
  if (viaFetch?.description === 'Intro.\n\nRequirements\nEVM')
    pass('lever.fetch() puts the full posting text in description');
  else fail(`lever.fetch() description => ${JSON.stringify(viaFetch?.description)}`);

  // categories.allLocations — the multi-location fix. Lever puts a single
  // primary city in `location`; reading only that hides every other eligible
  // location from scan.mjs's location_filter (a Barcelona+Montevideo req looks
  // Barcelona-only, so a Montevideo-based filter silently drops it).
  if (fetched[3]?.location === 'Barcelona; Madrid; Montevideo (Hybrid)')
    pass('lever.fetch() folds categories.allLocations into location (multi-location postings stay visible to location_filter)');
  else fail(`lever.fetch() row 3 location = ${JSON.stringify(fetched[3]?.location)}`);

  if (fetched[4]?.location === 'Madrid; Sao Paulo')
    pass('lever.fetch() drops blank/non-string allLocations entries and case-insensitive duplicates of the primary');
  else fail(`lever.fetch() row 4 location = ${JSON.stringify(fetched[4]?.location)}`);

  if (fetched[5]?.location === 'Montevideo')
    pass('lever.fetch() resolves allLocations when categories.location is absent');
  else fail(`lever.fetch() row 5 location = ${JSON.stringify(fetched[5]?.location)}`);

  if (fetched[6]?.location === 'Lisbon')
    pass('lever.fetch() ignores a non-array allLocations and preserves the primary location');
  else fail(`lever.fetch() row 6 location = ${JSON.stringify(fetched[6]?.location)}`);

  // Empty vs broken (#6906, ADDING_A_PROVIDER.md "Defensive parsing"): a bare
  // [] is an empty board. Any other body throws on the single-response path,
  // naming the keys (or the type) it got, as the paged path already does.
  const leverEntry = { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' };
  const leverEmpty = await lever.fetch(leverEntry, { fetchJson: async () => [] });
  if (Array.isArray(leverEmpty) && leverEmpty.length === 0) pass('lever.fetch() returns [] for an empty postings array');
  else fail(`lever.fetch() [] → ${JSON.stringify(leverEmpty)}`);

  const leverBroken = [
    [{}, '[]'],
    [{ error: 'rate limited' }, '[error]'],
    [{ postings: [] }, '[postings]'],
    ['oops', '[string]'],
    [null, '[null]'],
  ];
  let leverBrokenOk = true;
  for (const [body, got] of leverBroken) {
    let out;
    let err = null;
    try { out = await lever.fetch(leverEntry, { fetchJson: async () => body }); } catch (e) { err = e; }
    const msg = String(/** @type {any} */ (err)?.message || '');
    if (!err || !msg.startsWith('lever: unexpected response for Acme') || !msg.includes(`got: ${got}`)) {
      leverBrokenOk = false;
      fail(`lever.fetch() body=${JSON.stringify(body)} should throw naming ${got}; got ${err ? JSON.stringify(msg) : `a return of ${JSON.stringify(out)}`}`);
      break;
    }
  }
  if (leverBrokenOk) pass('lever.fetch() throws, naming what it got, for a body that is not an array of postings');

  // fetch() — a pinned api: is used verbatim, bypassing careers_url parsing entirely.
  let pinnedUrl = null;
  await lever.fetch(
    { name: 'Coalfire', careers_url: 'https://www.coalfire.com/careers', api: 'https://api.lever.co/v0/postings/coalfire' },
    { fetchJson: async (url) => { pinnedUrl = url; return []; } },
  );
  if (pinnedUrl === 'https://api.lever.co/v0/postings/coalfire') {
    pass('lever.fetch() honors a pinned api: over a non-lever careers_url');
  } else {
    fail(`lever.fetch() pinned api: requested ${JSON.stringify(pinnedUrl)}`);
  }

  // fetch() — an untrusted api: host throws before any request (SSRF guard).
  let evilFetchCalled = false;
  try {
    await lever.fetch(
      { name: 'Evil', api: 'https://evil.example/v0/postings/acme' },
      { fetchJson: async () => { evilFetchCalled = true; return []; } },
    );
    fail('lever.fetch() should throw for an untrusted api: host');
  } catch (e) {
    if (!evilFetchCalled && /untrusted hostname/.test(e.message)) {
      pass('lever.fetch() rejects an untrusted api: host before fetching');
    } else {
      fail(`lever.fetch() untrusted api: fetchCalled=${evilFetchCalled}, error=${e.message}`);
    }
  }

  // Underivable entry → typed error before any request.
  try {
    await lever.fetch(
      { name: 'NoBoard', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => { throw new Error('must not be called'); } },
    );
    fail('lever.fetch() should throw when no API URL can be derived');
  } catch (e) {
    if (/cannot derive API URL for NoBoard/.test(e.message)) {
      pass('lever.fetch() throws "cannot derive API URL" before fetching for an undetectable entry');
    } else {
      fail(`lever.fetch() threw the wrong error: ${e.message}`);
    }
  }

  // workplaceType is a top-level flag. categories.location is the city only,
  // so a remote London posting looks onsite to a location filter that allows
  // "Remote". Hybrid and onsite stay city-only. A location that already says
  // remote is not doubled.
  const remoteRows = await lever.fetch(
    { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' },
    { fetchJson: async () => [
      { text: 'Ops Lead', hostedUrl: 'https://jobs.lever.co/acme/r1', id: 'r1', categories: { location: 'Oslo' }, workplaceType: 'remote' },
      { text: 'Ops Lead', hostedUrl: 'https://jobs.lever.co/acme/r2', id: 'r2', categories: { location: 'Oslo' }, workplaceType: 'hybrid' },
      { text: 'Ops Lead', hostedUrl: 'https://jobs.lever.co/acme/r3', id: 'r3', categories: { location: 'Remote — Europe' }, workplaceType: 'remote' },
      { text: 'Ops Lead', hostedUrl: 'https://jobs.lever.co/acme/r4', id: 'r4', categories: { location: 'Bend, OR', allLocations: ['Bend, OR', 'Oslo'] }, workplaceType: 'Remote' },
      { text: 'Ops Lead', hostedUrl: 'https://jobs.lever.co/acme/r5', id: 'r5', categories: { location: 'Oslo' }, workplaceType: 'onsite' },
      { text: 'Ops Lead', hostedUrl: 'https://jobs.lever.co/acme/r6', id: 'r6', categories: { location: 'Oslo' }, workplaceType: '  remote  ' },
      { text: 'Ops Lead', hostedUrl: 'https://jobs.lever.co/acme/r7', id: 'r7', categories: {}, workplaceType: 'remote' },
      { text: 'Ops Lead', hostedUrl: 'https://jobs.lever.co/acme/r8', id: 'r8', categories: { location: 'Remotely in Europe' }, workplaceType: 'remote' },
    ] },
  );
  const workplaceLocs = remoteRows.map(r => r.location);
  if (workplaceLocs[0] === 'Oslo; Remote'
      && workplaceLocs[1] === 'Oslo'
      && workplaceLocs[2] === 'Remote — Europe'
      && workplaceLocs[3] === 'Bend, OR; Oslo; Remote'
      && workplaceLocs[4] === 'Oslo'
      && workplaceLocs[5] === 'Oslo; Remote'
      && workplaceLocs[6] === 'Remote'
      && workplaceLocs[7] === 'Remotely in Europe; Remote') {
    pass('lever.fetch() appends Remote when workplaceType is remote and the location does not already say so');
  } else {
    fail(`lever.fetch() workplaceType locations = ${JSON.stringify(workplaceLocs)}`);
  }

  // workplaceType (#6909): dedicated field mapped to 'remote' | 'hybrid' | 'onsite'.
  // Case/whitespace trimmed and folded, 'on-site' mapped to 'onsite'. Blank/unspecified/unknown omitted.
  const leverWtJobs = await lever.fetch(
    { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' },
    {
      fetchJson: async () => [
        { text: 'Remote', hostedUrl: 'https://jobs.lever.co/acme/w1', workplaceType: 'remote' },
        { text: 'Remote caps', hostedUrl: 'https://jobs.lever.co/acme/w2', workplaceType: '  Remote  ' },
        { text: 'Hybrid', hostedUrl: 'https://jobs.lever.co/acme/w3', workplaceType: 'hybrid' },
        { text: 'Onsite', hostedUrl: 'https://jobs.lever.co/acme/w4', workplaceType: 'onsite' },
        { text: 'On-site hyphen', hostedUrl: 'https://jobs.lever.co/acme/w5', workplaceType: 'on-site' },
        { text: 'Blank', hostedUrl: 'https://jobs.lever.co/acme/w6', workplaceType: '   ' },
        { text: 'Unspecified', hostedUrl: 'https://jobs.lever.co/acme/w7', workplaceType: 'unspecified' },
        { text: 'Unknown', hostedUrl: 'https://jobs.lever.co/acme/w8', workplaceType: 'flexible' },
        { text: 'None', hostedUrl: 'https://jobs.lever.co/acme/w9' },
      ],
    },
  );
  if (
    leverWtJobs[0]?.workplaceType === 'remote'
    && leverWtJobs[1]?.workplaceType === 'remote'
    && leverWtJobs[2]?.workplaceType === 'hybrid'
    && leverWtJobs[3]?.workplaceType === 'onsite'
    && leverWtJobs[4]?.workplaceType === 'onsite'
    && !('workplaceType' in leverWtJobs[5])
    && !('workplaceType' in leverWtJobs[6])
    && !('workplaceType' in leverWtJobs[7])
    && !('workplaceType' in leverWtJobs[8])
  ) {
    pass('lever.fetch() maps workplaceType (remote/hybrid/onsite), trims/lowercases, normalizes on-site, and omits unknown/blank');
  } else {
    fail(`lever.fetch() workplaceType = ${JSON.stringify(leverWtJobs.map(j => [j.title, j.workplaceType]))}`);
  }

  // salaryRange (#6907) — Lever's public postings API documents an optional
  // salaryRange ({ currency, interval, min, max }) on each posting. It maps
  // to Job.salary annualized, the way parseCompensation() in ashby.mjs does:
  // only a real number counts, an unrecognised interval leaves salary off
  // rather than guessing, and no extra request is made.
  const salaryRows = await lever.fetch(
    { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' },
    { fetchJson: async () => [
      { text: 'Yearly', hostedUrl: 'https://jobs.lever.co/acme/y1', salaryRange: { currency: 'USD', interval: 'per-year-salary', min: 80000, max: 165000 } },
      { text: 'Hourly', hostedUrl: 'https://jobs.lever.co/acme/h1', salaryRange: { currency: 'USD', interval: 'per-hour-wage', min: 47, max: 47 } },
      { text: 'Monthly', hostedUrl: 'https://jobs.lever.co/acme/m1', salaryRange: { currency: 'EUR', interval: 'per-month-salary', min: 5000, max: 6000 } },
      { text: 'Unknown interval', hostedUrl: 'https://jobs.lever.co/acme/u1', salaryRange: { currency: 'USD', interval: 'per-fortnight-wage', min: 1000, max: 2000 } },
      { text: 'No range', hostedUrl: 'https://jobs.lever.co/acme/n1' },
      { text: 'Min only', hostedUrl: 'https://jobs.lever.co/acme/mo1', salaryRange: { currency: 'USD', interval: 'per-year-salary', min: 120000 } },
      { text: 'Max only', hostedUrl: 'https://jobs.lever.co/acme/ma1', salaryRange: { currency: 'USD', interval: 'per-year-salary', max: 90000 } },
      { text: 'Non-numeric', hostedUrl: 'https://jobs.lever.co/acme/nn1', salaryRange: { currency: 'USD', interval: 'per-year-salary', min: '100000', max: null } },
      { text: 'No interval', hostedUrl: 'https://jobs.lever.co/acme/ni1', salaryRange: { currency: 'USD', min: 1, max: 2 } },
      { text: 'Lowercase currency', hostedUrl: 'https://jobs.lever.co/acme/lc1', salaryRange: { currency: 'usd', interval: 'per-year-salary', min: 100000, max: 120000 } },
      { text: 'Inverted', hostedUrl: 'https://jobs.lever.co/acme/i1', salaryRange: { currency: 'USD', interval: 'per-year-salary', min: 200000, max: 150000 } },
      { text: 'Inherited name', hostedUrl: 'https://jobs.lever.co/acme/hn1', salaryRange: { currency: 'USD', interval: 'constructor', min: 100000, max: 120000 } },
      { text: 'Inherited name 2', hostedUrl: 'https://jobs.lever.co/acme/hn2', salaryRange: { currency: 'USD', interval: 'toString', min: 100000, max: 120000 } },
    ] },
  );
  const salaryEq = (a, b) => a?.min === b?.min && a?.max === b?.max && a?.currency === b?.currency;
  if (salaryEq(salaryRows[0]?.salary, { min: 80000, max: 165000, currency: 'USD' })
      && salaryEq(salaryRows[1]?.salary, { min: 97760, max: 97760, currency: 'USD' })
      && salaryEq(salaryRows[2]?.salary, { min: 60000, max: 72000, currency: 'EUR' })) {
    pass('lever.fetch() maps salaryRange to annualized Job.salary (yearly as-is, hourly x2080, monthly x12)');
  } else {
    fail(`lever.fetch() salary rows 0-2 = ${JSON.stringify(salaryRows.slice(0, 3).map(r => r.salary))}`);
  }

  if (salaryRows[3]?.salary === undefined && salaryRows[4]?.salary === undefined) {
    pass('lever.fetch() leaves salary off for an unrecognised interval and for a posting with no salaryRange');
  } else {
    fail(`lever.fetch() unknown-interval salary = ${JSON.stringify(salaryRows[3]?.salary)}, no-range salary = ${JSON.stringify(salaryRows[4]?.salary)}`);
  }

  if (salaryEq(salaryRows[5]?.salary, { min: 120000, max: 120000, currency: 'USD' })
      && salaryEq(salaryRows[6]?.salary, { min: 90000, max: 90000, currency: 'USD' })) {
    pass('lever.fetch() fills the missing bound of a one-sided salaryRange from the other (Ashby pattern)');
  } else {
    fail(`lever.fetch() one-sided salaries = ${JSON.stringify([salaryRows[5]?.salary, salaryRows[6]?.salary])}`);
  }

  if (salaryRows[7]?.salary === undefined && salaryRows[8]?.salary === undefined) {
    pass('lever.fetch() leaves salary off when min/max are not real numbers and when the interval is missing');
  } else {
    fail(`lever.fetch() non-numeric salary = ${JSON.stringify(salaryRows[7]?.salary)}, no-interval salary = ${JSON.stringify(salaryRows[8]?.salary)}`);
  }

  if (salaryEq(salaryRows[9]?.salary, { min: 100000, max: 120000, currency: 'USD' })
      && salaryEq(salaryRows[10]?.salary, { min: 150000, max: 200000, currency: 'USD' })) {
    pass('lever.fetch() upper-cases the salary currency and orders an inverted range');
  } else {
    fail(`lever.fetch() currency/inverted salaries = ${JSON.stringify([salaryRows[9]?.salary, salaryRows[10]?.salary])}`);
  }

  // An interval naming an inherited Object property ('constructor',
  // 'toString') resolves to a truthy non-number on a plain lookup, which
  // would annualize to NaN in Job.salary. The lookup must only accept own
  // properties of the multiplier table.
  if (salaryRows[11]?.salary === undefined && salaryRows[12]?.salary === undefined) {
    pass('lever.fetch() leaves salary off for an interval naming an inherited Object property');
  } else {
    fail(`lever.fetch() inherited-name salaries = ${JSON.stringify([salaryRows[11]?.salary, salaryRows[12]?.salary])}`);
  }

  // locations and country (#6910)
  const locRows = await lever.fetch(
    { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' },
    {
      fetchJson: async () => [
        { text: 'Austin Role', hostedUrl: 'https://jobs.lever.co/acme/l1', country: 'US', categories: { location: 'Austin' } },
        { text: 'Null Country', hostedUrl: 'https://jobs.lever.co/acme/l2', country: null, categories: { location: 'Austin' } },
        { text: 'Missing Country', hostedUrl: 'https://jobs.lever.co/acme/l3', categories: { location: 'Austin' } },
        { text: 'Multi Remote', hostedUrl: 'https://jobs.lever.co/acme/l4', categories: { location: 'Barcelona', allLocations: ['Barcelona', 'Madrid'] }, workplaceType: 'remote' },
        { text: 'Bare Remote', hostedUrl: 'https://jobs.lever.co/acme/l5', categories: { location: 'Remote' } },
        { text: 'London Remote', hostedUrl: 'https://jobs.lever.co/acme/l6', categories: { location: 'London', allLocations: ['London', 'Remote'] } },
      ],
    },
  );
  if (locRows[0]?.country === 'US'
      && Array.isArray(locRows[0]?.locations)
      && locRows[0]?.locations.length === 1
      && locRows[0]?.locations[0] === 'Austin'
      && locRows[0]?.location === 'Austin') {
    pass('lever.fetch() maps country "US" and categories.location "Austin" to country "US", locations ["Austin"], location "Austin"');
  } else {
    fail(`lever.fetch() country/location row 0 = ${JSON.stringify(locRows[0])}`);
  }

  if (!('country' in locRows[1]) && !('country' in locRows[2])) {
    pass('lever.fetch() omits country key when country is null or missing');
  } else {
    fail(`lever.fetch() null/missing country = ${JSON.stringify([locRows[1]?.country, locRows[2]?.country])}`);
  }

  if (locRows[3]?.location === 'Barcelona; Madrid; Remote'
      && JSON.stringify(locRows[3]?.locations) === JSON.stringify(['Barcelona', 'Madrid'])) {
    pass('lever.fetch() gives locations without "Remote" while location ends in "; Remote" on multi-location remote posting');
  } else {
    fail(`lever.fetch() multi-location remote = location: ${JSON.stringify(locRows[3]?.location)}, locations: ${JSON.stringify(locRows[3]?.locations)}`);
  }

  if (locRows[4]?.location === 'Remote' && !('locations' in locRows[4])) {
    pass('lever.fetch() gives location "Remote" and omits locations when categories.location is "Remote"');
  } else {
    fail(`lever.fetch() bare remote = location: ${JSON.stringify(locRows[4]?.location)}, locations: ${JSON.stringify(locRows[4]?.locations)}`);
  }

  if (locRows[5]?.location === 'London; Remote'
      && JSON.stringify(locRows[5]?.locations) === JSON.stringify(['London'])) {
    pass('lever.fetch() gives location "London; Remote" and locations ["London"] when allLocations has "Remote"');
  } else {
    fail(`lever.fetch() London remote = location: ${JSON.stringify(locRows[5]?.location)}, locations: ${JSON.stringify(locRows[5]?.locations)}`);
  }

} catch (e) {
  fail(`lever provider tests crashed: ${e.message}`);
}
