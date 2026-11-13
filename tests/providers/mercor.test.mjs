// tests/providers/mercor.test.mjs — provider-contract tests for the Mercor
// work-marketplace explore page (providers/mercor.mjs). Inline fixtures only.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — mercor');

const listing = (id, extra = {}) => ({
  listingId: id,
  title: `Expert ${id}`,
  description: 'Evaluate model output &amp; write rubrics',
  commitment: 'hourly',
  status: 'active',
  rateMin: 40,
  rateMax: 80,
  payRateFrequency: 'hourly',
  location: 'Remote',
  workArrangement: 'remote',
  eligibleLocation: [],
  isPrivate: false,
  deletedAt: null,
  companyBrandVisible: false,
  companyName: null,
  postedAt: '2026-10-28T10:14:25',
  createdAt: '2026-10-27T00:00:00',
  ...extra,
});
const page = (listings, { key = 'listings-explore-page' } = {}) => {
  const data = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            { queryKey: ['other'], state: { data: { user: null } } },
            { queryKey: [key], state: { data: listings === undefined ? {} : { listings } } },
          ],
        },
      },
    },
  };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/mercor.mjs')).href);
  const mercor = mod.default;
  const { parseMercorExplorePage, normalizeMercorListing } = mod;

  if (mercor.id === 'mercor') pass('mercor.id is "mercor"');
  else fail(`mercor.id is ${JSON.stringify(mercor.id)}`);

  // detect() — explicit-only
  const hit = mercor.detect({ name: 'Mercor', provider: 'mercor' });
  if (hit && hit.url === 'https://work.mercor.com/explore') pass('detect() resolves provider:mercor with no careers_url');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  let junkOk = true;
  for (const junk of [null, undefined, {}, 42, { careers_url: 'https://jobs.ashbyhq.com/mercor' }, { careers_url: 'https://work.mercor.com/explore' }, { provider: 'ashby' }]) {
    try { if (mercor.detect(junk) !== null) junkOk = false; } catch { junkOk = false; }
  }
  if (junkOk) pass('detect() returns null (no throw) for junk, and never claims the Ashby Mercor board');
  else fail('detect() claimed or threw on a non-mercor entry');

  // normalization
  const j = normalizeMercorListing(listing('list_A1'));
  if (j && j.title === 'Expert list_A1' && j.url === 'https://work.mercor.com/jobs/list_A1'
      && j.company === 'Mercor' && j.location === 'Remote' && j.externalId === 'list_A1') {
    pass('normalizeMercorListing maps title/location and builds the bare-id posting URL');
  } else fail(`normalized = ${JSON.stringify(j)}`);
  if (j && j.postedAt === Date.parse('2026-10-28T10:14:25Z')) pass('offset-less timestamps are read as UTC');
  else fail(`postedAt = ${j?.postedAt}`);
  if (j && /Rate: \$40-80 \(hourly\)/.test(j.description) && j.salary === undefined) pass('hourly rate goes to description, never salary');
  else fail(`description/salary = ${JSON.stringify([j?.description, j?.salary])}`);
  if (normalizeMercorListing(listing('x', { postedAt: 'garbage', createdAt: 'nope' }))?.postedAt === undefined) {
    pass('an unparseable date leaves postedAt unset (NaN-safe)');
  } else fail('bad date should leave postedAt undefined');

  // company never comes from the client codename; it goes to description
  const branded = normalizeMercorListing(listing('b', { companyBrandVisible: true, companyName: 'Neon' }));
  const hidden = normalizeMercorListing(listing('h', { companyBrandVisible: false, companyName: 'Secret' }));
  if (branded?.company === 'Mercor' && /Client project: Neon/.test(branded.description) && !/Secret/.test(hidden?.description ?? '')) {
    pass('a visible client name is noted in description; a hidden one is not exposed; company stays Mercor');
  } else fail(`branded/hidden = ${JSON.stringify([branded, hidden])}`);

  // location: stated eligibility appended, nothing invented
  const usOnly = normalizeMercorListing(listing('u', { eligibleLocation: ['USA'] }));
  const usNamed = normalizeMercorListing(listing('n', { location: 'United States (Remote)', eligibleLocation: ['USA'] }));
  const noLoc = normalizeMercorListing(listing('z', { location: null, workArrangement: 'remote' }));
  const nothing = normalizeMercorListing(listing('y', { location: null, workArrangement: null }));
  if (usOnly?.location === 'Remote (eligible: USA)' && usNamed?.location === 'United States (Remote)'
      && noLoc?.location === 'Remote' && nothing?.location === '') {
    pass('eligibleLocation is appended only when unstated; a missing location is never invented');
  } else fail(`locations = ${JSON.stringify([usOnly?.location, usNamed?.location, noLoc?.location, nothing?.location])}`);

  // drops
  const dropped = [
    null, {}, listing(''), listing('t', { title: '' }), listing('\uD800'),
    listing('c', { status: 'closed' }), listing('p', { isPrivate: true }), listing('d', { deletedAt: '2026-10-01T00:00:00' }),
  ].map(normalizeMercorListing);
  if (dropped.every(v => v === null)) pass('malformed, non-active, private, deleted and lone-surrogate listings are dropped');
  else fail(`dropped = ${JSON.stringify(dropped)}`);

  // page parsing: empty vs broken
  const jobs = parseMercorExplorePage(page([listing('a'), {}, listing('b'), listing('a')]));
  if (jobs.length === 2 && jobs[0].url.endsWith('/jobs/a') && jobs[1].url.endsWith('/jobs/b')) {
    pass('parseMercorExplorePage finds the listings query, skips bad rows and de-dupes by URL');
  } else fail(`parsed = ${JSON.stringify(jobs)}`);
  if (parseMercorExplorePage(page([])).length === 0) pass('present-and-empty listings[] → []');
  else fail('empty listings should yield []');
  const broken = [
    ['', /empty/],
    [null, /empty/],
    ['<html><body>Just a moment...</body></html>', /no __NEXT_DATA__/],
    ['<script id="__NEXT_DATA__" type="application/json">{not json</script>', /not valid JSON/],
    ['<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>', /dehydratedState/],
    [page(undefined), /listings\[\]/],
    [page({}), /listings\[\]/],
  ];
  let thrown = 0;
  for (const [body, re] of broken) {
    try { parseMercorExplorePage(body); } catch (e) { if (re.test(e.message)) thrown++; }
  }
  if (thrown === broken.length) pass('missing blob / envelope / listings array throws a descriptive error');
  else fail(`only ${thrown}/${broken.length} broken pages threw as expected`);

  // fetch(): one request, pinned URL, redirect:'error'
  {
    const calls = [];
    const ctx = {
      transport: 'http',
      maxPages: 1,
      sleep: async () => {},
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
      fetchText: async (url, opts) => { calls.push({ url, opts }); return page([listing('a'), listing('b')]); },
    };
    const out = await mercor.fetch({ name: 'Mercor', provider: 'mercor' }, ctx);
    if (out.length === 2 && calls.length === 1 && calls[0].url === 'https://work.mercor.com/explore' && calls[0].opts?.redirect === 'error') {
      pass("fetch() issues exactly one request to work.mercor.com/explore with redirect:'error'");
    } else fail(`fetch calls = ${JSON.stringify(calls)}, jobs ${out.length}`);
  }

  // probe rejection propagates unwrapped
  {
    const sentinel = new Error('ProbePageBudgetReached');
    let got;
    try {
      await mercor.fetch({}, { maxPages: 1, sleep: async () => {}, fetchText: async () => { throw sentinel; } });
    } catch (e) { got = e; }
    if (got === sentinel) pass('a ctx.fetchText rejection during a probe propagates unwrapped');
    else fail(`probe rejection = ${got}`);
  }
} catch (e) {
  fail(`mercor provider tests crashed: ${e.message}`);
}
