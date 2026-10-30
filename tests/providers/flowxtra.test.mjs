// tests/providers/flowxtra.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — flowxtra');

try {
  const flowxtraModule = await import(pathToFileURL(join(ROOT, 'providers/flowxtra.mjs')).href);
  const flowxtra = flowxtraModule.default;
  const { normalizeFlowxtraJob } = flowxtraModule;

  if (flowxtra.id === 'flowxtra') pass('flowxtra.id is "flowxtra"');
  else fail(`flowxtra.id is ${JSON.stringify(flowxtra.id)}`);

  // normalizeFlowxtraJob — field mapping (real API shape verified live 2026-07-25).
  const full = normalizeFlowxtraJob(
    {
      title: '  Staff AI Engineer  ',
      urlJobApplay: '  https://flowxtra.com/apply/AB12C  ',
      name_company: '  Acme Co  ',
      city_company: 'Barcelona',
      state_company: 'Catalonia',
      country_company: 'Spain',
      workplace: 'On-site',
      date_share: '2026-07-23T16:22:27.000000Z',
    },
    'Fallback',
  );
  if (
    full &&
    full.title === 'Staff AI Engineer' &&
    full.url === 'https://flowxtra.com/apply/AB12C' &&
    full.company === 'Acme Co' &&
    full.location === 'Barcelona, Catalonia, Spain' &&
    full.postedAt === Date.parse('2026-07-23T16:22:27.000000Z')
  ) {
    pass('normalizeFlowxtraJob maps + trims title/url/company/location and converts date_share to epoch ms');
  } else {
    fail(`normalizeFlowxtraJob full row = ${JSON.stringify(full)}`);
  }

  // workplace:"Remote" appends "Remote" to the assembled location.
  const remoteJob = normalizeFlowxtraJob(
    { title: 'R', urlJobApplay: 'https://flowxtra.com/apply/R1', city_company: 'Munich', country_company: 'Germany', workplace: 'Remote' },
    'X',
  );
  if (remoteJob?.location === 'Munich, Germany, Remote') pass('normalizeFlowxtraJob appends "Remote" when workplace is "Remote"');
  else fail(`normalizeFlowxtraJob remote location = ${JSON.stringify(remoteJob?.location)}`);

  // remote-only (no city/state/country) → "Remote".
  const remoteOnly = normalizeFlowxtraJob({ title: 'R', urlJobApplay: 'https://flowxtra.com/apply/R2', workplace: 'Remote' }, 'X');
  if (remoteOnly?.location === 'Remote') pass('normalizeFlowxtraJob yields "Remote" when workplace is "Remote" and no location fields are set');
  else fail(`normalizeFlowxtraJob remote-only location = ${JSON.stringify(remoteOnly?.location)}`);

  // workplace:"On-site" does not append anything extra.
  const onSite = normalizeFlowxtraJob({ title: 'O', urlJobApplay: 'https://flowxtra.com/apply/O1', city_company: 'Vienna', workplace: 'On-site' }, 'X');
  if (onSite?.location === 'Vienna') pass('normalizeFlowxtraJob does not append "Remote" for non-remote workplace values');
  else fail(`normalizeFlowxtraJob on-site location = ${JSON.stringify(onSite?.location)}`);

  // company fallbacks: entry name, then "Flowxtra".
  const coFromEntry = normalizeFlowxtraJob({ title: 'T', urlJobApplay: 'https://flowxtra.com/apply/C1', name_company: '' }, 'Entry Name');
  const coDefault = normalizeFlowxtraJob({ title: 'T', urlJobApplay: 'https://flowxtra.com/apply/C2' });
  if (coFromEntry?.company === 'Entry Name' && coDefault?.company === 'Flowxtra') {
    pass('normalizeFlowxtraJob falls back company → entry name → "Flowxtra"');
  } else {
    fail(`normalizeFlowxtraJob company fallbacks = ${JSON.stringify({ a: coFromEntry?.company, b: coDefault?.company })}`);
  }

  // drops: empty title, missing url, non-https url, off-host url, malformed url, non-object.
  const drops = [
    normalizeFlowxtraJob({ title: '', urlJobApplay: 'https://flowxtra.com/apply/D1' }),
    normalizeFlowxtraJob({ title: 'No URL' }),
    normalizeFlowxtraJob({ title: 'Insecure', urlJobApplay: 'http://flowxtra.com/apply/D3' }),
    normalizeFlowxtraJob({ title: 'Off host', urlJobApplay: 'https://evil.example/apply/D4' }), // host-lock: external https dropped
    normalizeFlowxtraJob({ title: 'Relative', urlJobApplay: '/apply/D5' }),
    normalizeFlowxtraJob(null),
  ];
  if (drops.every(r => r === null)) pass('normalizeFlowxtraJob drops empty-title / no-url / non-https / off-host / relative / non-object');
  else fail(`normalizeFlowxtraJob drops = ${JSON.stringify(drops)}`);

  // missing date_share → no postedAt key.
  const noDate = normalizeFlowxtraJob({ title: 'T', urlJobApplay: 'https://flowxtra.com/apply/ND' });
  if (noDate && !('postedAt' in noDate)) pass('normalizeFlowxtraJob omits postedAt when date_share is absent');
  else fail(`normalizeFlowxtraJob postedAt presence = ${JSON.stringify(noDate)}`);

  // fetch(): pagination via ?page=N, stop when next_page_url is null.
  const mk = i => ({
    title: `Role ${i}`,
    urlJobApplay: `https://flowxtra.com/apply/X${i}`,
    name_company: `Co ${i}`,
    city_company: 'Berlin',
    country_company: 'Germany',
    workplace: 'On-site',
    date_share: '2026-07-23T16:22:27.000000Z',
  });
  const page1 = Array.from({ length: 100 }, (_, i) => mk(i)); // full page → continue
  const page2 = [mk(100), mk(101), { title: '' }]; // short page (3 < 100) → stop; 1 drop
  const requested = [];
  const pagedFetch = async (url, opts) => {
    requested.push({ url, redirect: opts?.redirect });
    const u = new URL(url);
    const page = Number(u.searchParams.get('page'));
    if (page === 1) return { success: true, data: { data: page1, next_page_url: 'https://app.flowxtra.com/api/central/jobs?page=2' } };
    if (page === 2) return { success: true, data: { data: page2, next_page_url: null } };
    return { success: true, data: { data: [], next_page_url: null } };
  };

  const paged = await flowxtra.fetch({ name: 'Flowxtra' }, { fetchJson: pagedFetch });

  if (
    requested.length === 2 &&
    requested[0].url === 'https://app.flowxtra.com/api/central/jobs?status=Live&per_page=100&page=1' &&
    requested[1].url === 'https://app.flowxtra.com/api/central/jobs?status=Live&per_page=100&page=2'
  ) {
    pass('flowxtra.fetch() builds ?status=Live&per_page=100&page=N URLs and stops after next_page_url is null');
  } else {
    fail(`flowxtra.fetch() requested = ${JSON.stringify(requested.map(r => r.url))}`);
  }

  if (requested.every(r => r.redirect === 'error')) pass('flowxtra.fetch() passes redirect:"error" on every page (SSRF guard)');
  else fail(`flowxtra.fetch() redirect opts = ${JSON.stringify(requested.map(r => r.redirect))}`);

  if (paged.length === 102) pass('flowxtra.fetch() aggregates valid jobs across pages (100 + 2, dropping the empty-title row)');
  else fail(`flowxtra.fetch() returned ${paged.length} jobs (expected 102)`);

  // max_pages cap: only the first page is requested even though it is full.
  const capRequested = [];
  await flowxtra.fetch(
    { name: 'Flowxtra', max_pages: 1 },
    {
      fetchJson: async url => {
        capRequested.push(url);
        return { success: true, data: { data: Array.from({ length: 100 }, (_, i) => mk(i)), next_page_url: 'https://app.flowxtra.com/api/central/jobs?page=2' } };
      },
    },
  );
  if (capRequested.length === 1 && capRequested[0] === 'https://app.flowxtra.com/api/central/jobs?status=Live&per_page=100&page=1') {
    pass('flowxtra.fetch() honors max_pages (stops at the cap even when next_page_url is present)');
  } else {
    fail(`flowxtra.fetch() max_pages:1 requested ${JSON.stringify(capRequested)}`);
  }

  // unexpected API response → throws.
  let badThrew = false;
  try {
    await flowxtra.fetch({ name: 'X' }, { fetchJson: async () => ({ wrong: true }) });
  } catch (e) {
    badThrew = /unexpected API response/.test(e.message);
  }
  if (badThrew) pass('flowxtra.fetch() throws on unexpected API response shape');
  else fail('flowxtra.fetch() should throw when data.data is absent');
} catch (e) {
  fail(`flowxtra provider tests crashed: ${e.message}`);
}
