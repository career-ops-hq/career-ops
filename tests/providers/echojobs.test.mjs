// tests/providers/echojobs.test.mjs — provider-contract tests for the EchoJobs
// board-wide JSON aggregator (providers/echojobs.mjs).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — echojobs');

try {
  const echojobsModule = await import(pathToFileURL(join(ROOT, 'providers/echojobs.mjs')).href);
  const echojobs = echojobsModule.default;
  const { normalizeEchojobsJob } = echojobsModule;

  if (echojobs.id === 'echojobs') pass('echojobs.id is "echojobs"');
  else fail(`echojobs.id is ${JSON.stringify(echojobs.id)}`);

  // detect() — explicit provider selection only (board-wide feed)
  const hit = echojobs.detect({ name: 'EchoJobs', provider: 'echojobs' });
  if (hit && hit.url === 'https://echojobs.io/api/jobs') pass('echojobs.detect() resolves provider:echojobs → feed URL');
  else fail(`echojobs.detect() returned ${JSON.stringify(hit)}`);
  if (echojobs.detect({ name: 'X' }) === null) pass('echojobs.detect() returns null without provider:echojobs');
  else fail('echojobs.detect() should require provider:echojobs');

  // normalizeEchojobsJob — field mapping, external ATS url kept, postedAt (ms)
  const j = {
    title: '  Senior Go Engineer  ',
    url: 'https://jobs.ashbyhq.com/acme/abc-123',
    company_name: 'Acme',
    locations: ['San Francisco, CA', 'New York, NY'],
    remote_type: 'on_site',
    posted_at: 1783380913765,
  };
  const n = normalizeEchojobsJob(j, 'Fallback');
  if (n && n.title === 'Senior Go Engineer' && n.company === 'Acme' &&
      n.url === 'https://jobs.ashbyhq.com/acme/abc-123' && n.location === 'San Francisco, CA, New York, NY' &&
      n.postedAt === 1783380913765) {
    pass('normalizeEchojobsJob maps title/company/url/location/postedAt and keeps the external ATS URL');
  } else {
    fail(`normalizeEchojobsJob => ${JSON.stringify(n)}`);
  }

  // remote/hybrid fallback when no listed place — kept distinguishable (#2258)
  // so a location_filter.block: ["Hybrid"] rule can still catch a hybrid role;
  // collapsing both to "Remote" would make that block unmatchable.
  const remote = normalizeEchojobsJob({ title: 'X', url: 'https://jobs.lever.co/x/1', locations: [], remote_type: 'remote' });
  const hybrid = normalizeEchojobsJob({ title: 'X', url: 'https://jobs.lever.co/x/2', remote_type: 'hybrid' });
  if (remote?.location === 'Remote' && hybrid?.location === 'Hybrid') {
    pass('normalizeEchojobsJob falls back to "Remote" for a placeless remote role, "Hybrid" for a placeless hybrid one (#2258)');
  } else {
    fail(`remote/hybrid fallback => ${JSON.stringify([remote?.location, hybrid?.location])}`);
  }

  // on_site with no listed place gets no location fallback at all — only
  // remote/hybrid roles are placeless-tolerant.
  const onSiteNoPlace = normalizeEchojobsJob({ title: 'X', url: 'https://jobs.lever.co/x/3', remote_type: 'on_site' });
  if (onSiteNoPlace?.location === '') {
    pass('normalizeEchojobsJob leaves location empty for a placeless on_site role (no false Remote/Hybrid)');
  } else {
    fail(`on_site placeless fallback => ${JSON.stringify(onSiteNoPlace?.location)}`);
  }

  // a hybrid role that DOES list a city keeps the city and gains the marker,
  // so block: ["Hybrid"] is not half-working (#2258).
  const hybridWithCity = normalizeEchojobsJob({ title: 'X', url: 'https://jobs.lever.co/x/4', locations: ['Berlin'], remote_type: 'hybrid' });
  if (hybridWithCity?.location === 'Berlin · Hybrid') {
    pass('normalizeEchojobsJob appends the Hybrid marker to a hybrid role that lists a city (#2258)');
  } else {
    fail(`hybrid with city => ${JSON.stringify(hybridWithCity?.location)}`);
  }

  // the marker is never doubled when the board already spells it out
  const hybridSpelledOut = normalizeEchojobsJob({ title: 'X', url: 'https://jobs.lever.co/x/5', locations: ['Berlin (Hybrid)'], remote_type: 'hybrid' });
  if (hybridSpelledOut?.location === 'Berlin (Hybrid)') {
    pass('normalizeEchojobsJob does not double the marker when the location already says Hybrid');
  } else {
    fail(`hybrid already spelled out => ${JSON.stringify(hybridSpelledOut?.location)}`);
  }

  // a placed remote role is left alone — only hybrid gets a marker appended
  const remoteWithCity = normalizeEchojobsJob({ title: 'X', url: 'https://jobs.lever.co/x/6', locations: ['Berlin'], remote_type: 'remote' });
  if (remoteWithCity?.location === 'Berlin') {
    pass('normalizeEchojobsJob leaves a placed remote role untouched (no marker beyond the #2258 scope)');
  } else {
    fail(`remote with city => ${JSON.stringify(remoteWithCity?.location)}`);
  }

  // remote_type is a third-party field: casing/whitespace must not smuggle an
  // unmarked hybrid through.
  const hybridOddCasing = normalizeEchojobsJob({ title: 'X', url: 'https://jobs.lever.co/x/7', locations: ['Berlin'], remote_type: ' Hybrid ' });
  if (hybridOddCasing?.location === 'Berlin · Hybrid') {
    pass('normalizeEchojobsJob matches remote_type case/whitespace-insensitively');
  } else {
    fail(`hybrid odd casing => ${JSON.stringify(hybridOddCasing?.location)}`);
  }

  // company fallback to the entry name
  const bare = normalizeEchojobsJob({ title: 'X', url: 'https://jobs.lever.co/x/1' }, 'EntryName');
  if (bare?.company === 'EntryName') pass('normalizeEchojobsJob falls back to the entry name for company');
  else fail(`company fallback => ${JSON.stringify(bare?.company)}`);

  // drops: no title, non-https url, missing url
  if (normalizeEchojobsJob({ url: 'https://x/1' }) === null) pass('normalizeEchojobsJob drops a title-less item');
  else fail('title-less item should be dropped');
  if (normalizeEchojobsJob({ title: 'X', url: 'http://insecure/1' }) === null) pass('normalizeEchojobsJob drops a non-https url');
  else fail('non-https url should be dropped');
  if (normalizeEchojobsJob({ title: 'X' }) === null) pass('normalizeEchojobsJob drops an item with no url');
  else fail('url-less item should be dropped');

  // fetch() — pagination: accumulates across pages, stops on a short page, and
  // pins the feed request to echojobs.io with redirect:'error'.
  const page1 = { jobs: Array.from({ length: 100 }, (_, i) => ({ title: `Job ${i}`, url: `https://jobs.ashbyhq.com/acme/${i}`, company_name: 'Acme' })) };
  const page2 = { jobs: [{ title: 'Last', url: 'https://jobs.ashbyhq.com/acme/last', company_name: 'Acme' }] };
  const calls = [];
  const ctx = {
    transport: 'http',
    fetchJson: async (url, options) => {
      calls.push(url);
      if (options?.redirect !== 'error') throw new Error(`fetchJson without redirect:'error': ${JSON.stringify(options)}`);
      if (new URL(url).hostname !== 'echojobs.io') throw new Error(`fetchJson off-host: ${url}`);
      return new URL(url).searchParams.get('page') === '1' ? page1 : page2;
    },
    fetchText: async () => { throw new Error('fetchText should not be called'); },
  };
  const jobs = await echojobs.fetch({ name: 'EchoJobs', provider: 'echojobs' }, ctx);
  if (jobs.length === 101) pass('echojobs.fetch() accumulates across pages and stops on the short page (100 + 1)');
  else fail(`echojobs.fetch() returned ${jobs.length} jobs, expected 101`);
  if (calls.length === 2) pass('echojobs.fetch() stopped after the short second page (2 requests)');
  else fail(`echojobs.fetch() made ${calls.length} page requests, expected 2`);

  // max_pages override caps pagination
  const cappedCalls = [];
  await echojobs.fetch(
    { name: 'EchoJobs', provider: 'echojobs', max_pages: 1 },
    { transport: 'http', fetchJson: async (u) => { cappedCalls.push(u); return page1; }, fetchText: async () => {} },
  );
  if (cappedCalls.length === 1) pass('echojobs.fetch() respects max_pages (stops after 1 page)');
  else fail(`echojobs.fetch() max_pages=1 made ${cappedCalls.length} page calls`);

  // unexpected shape throws
  let threw = false;
  try {
    await echojobs.fetch({ name: 'EchoJobs', provider: 'echojobs' },
      { transport: 'http', fetchJson: async () => ({ oops: true }), fetchText: async () => {} });
  } catch { threw = true; }
  if (threw) pass('echojobs.fetch() throws on an unexpected API response shape');
  else fail('echojobs.fetch() should throw when the response has no jobs array');

} catch (e) {
  fail(`echojobs provider tests crashed: ${e.message}`);
}
