// tests/providers/fourdayweek.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — 4dayweek');

try {
  const fdwModule = await import(pathToFileURL(join(ROOT, 'providers/4dayweek.mjs')).href);
  const fourdayweek = fdwModule.default;
  const { normalize4dwJob } = fdwModule;

  if (fourdayweek.id === '4dayweek') pass('4dayweek.id is "4dayweek"');
  else fail(`4dayweek.id is ${JSON.stringify(fourdayweek.id)}`);

  // normalize4dwJob — full mapping (url is BUILT from slug; feed has no url).
  const full = normalize4dwJob(
    { title: '  Financial Controller  ', slug: 'financial-controller-at-panzerglass-45369c18', company_name: '  PanzerGlass  ', locations: [{ city: 'Hinnerup', country: 'Denmark' }], work_arrangement: 'onsite', posted: 1782731975, is_expired: false },
    'Fallback',
  );
  if (full && full.title === 'Financial Controller'
      && full.url === 'https://4dayweek.io/job/financial-controller-at-panzerglass-45369c18'
      && full.company === 'PanzerGlass' && full.location === 'Hinnerup, Denmark'
      && full.postedAt === 1782731975 * 1000) {
    pass('normalize4dwJob maps title, builds /job/<slug> url, company_name, location, posted(seconds)→ms');
  } else {
    fail(`normalize4dwJob full row = ${JSON.stringify(full)}`);
  }

  // work_arrangement: remote → "Remote" appended.
  const remoteJob = normalize4dwJob({ title: 'R', slug: 'r-1', locations: [{ city: 'Berlin', country: 'Germany' }], work_arrangement: 'remote' });
  if (remoteJob?.location === 'Berlin, Germany, Remote') pass('normalize4dwJob appends "Remote" when work_arrangement is "remote"');
  else fail(`normalize4dwJob remote location = ${JSON.stringify(remoteJob?.location)}`);

  // company fallbacks: company.name → entry name → "4 Day Week" (whitespace-only ignored).
  const coNested = normalize4dwJob({ title: 'T', slug: 's-1', company: { name: 'Nested Co' } });
  const coEntry = normalize4dwJob({ title: 'T', slug: 's-2' }, 'Entry Name');
  const coDefault = normalize4dwJob({ title: 'T', slug: 's-3' });
  const coBlank = normalize4dwJob({ title: 'T', slug: 's-4' }, '   ');
  if (coNested?.company === 'Nested Co' && coEntry?.company === 'Entry Name'
      && coDefault?.company === '4 Day Week' && coBlank?.company === '4 Day Week') {
    pass('normalize4dwJob falls back company → company.name → entry name → "4 Day Week" (whitespace-only ignored)');
  } else {
    fail(`normalize4dwJob company fallbacks = ${JSON.stringify({ n: coNested?.company, e: coEntry?.company, d: coDefault?.company, b: coBlank?.company })}`);
  }

  // postedAt omitted when posted is absent / non-finite.
  const noDate = normalize4dwJob({ title: 'T', slug: 's-5' });
  const nanDate = normalize4dwJob({ title: 'T', slug: 's-6', posted: 'oops' });
  if (noDate && !('postedAt' in noDate) && nanDate && !('postedAt' in nanDate)) {
    pass('normalize4dwJob omits postedAt when posted is absent or non-numeric (NaN-safe)');
  } else {
    fail(`normalize4dwJob date handling = ${JSON.stringify({ none: noDate, nan: nanDate })}`);
  }

  // drops: expired, empty title, missing/unsafe slug, non-object.
  const drops = [
    normalize4dwJob({ title: 'Expired', slug: 'x-1', is_expired: true }),
    normalize4dwJob({ title: '', slug: 'x-2' }),
    normalize4dwJob({ title: 'No slug' }),
    normalize4dwJob({ title: 'Unsafe slug', slug: 'a/b' }),
    normalize4dwJob({ title: 'Spacey slug', slug: 'a b' }),
    normalize4dwJob(null),
  ];
  if (drops.every(r => r === null)) {
    pass('normalize4dwJob drops expired / empty-title / no-slug / unsafe-slug / non-object');
  } else {
    fail(`normalize4dwJob drops = ${JSON.stringify(drops)}`);
  }

  // fetch(): pagination by ?page=N, stop on has_more:false.
  const mk = (i) => ({ title: `Role ${i}`, slug: `role-${i}`, company_name: `Co ${i}`, locations: [{ city: 'Lisbon', country: 'Portugal' }], posted: 1782731975 + i, is_expired: false });
  const page1 = { jobs: Array.from({ length: 25 }, (_, i) => mk(i)), total: 50, page: 1, has_more: true };
  const page2 = { jobs: [mk(25), mk(26), { title: '', slug: 'bad' }], total: 50, page: 2, has_more: false }; // has_more:false → stop; 1 drop
  const requested = [];
  const pagedFetch = async (url, opts) => {
    requested.push({ url, redirect: opts?.redirect });
    return Number(new URL(url).searchParams.get('page')) === 1 ? page1 : page2;
  };
  const paged = await fourdayweek.fetch({ name: '4 Day Week' }, { fetchJson: pagedFetch });

  if (requested.length === 2
      && requested[0].url === 'https://4dayweek.io/api/jobs?page=1'
      && requested[1].url === 'https://4dayweek.io/api/jobs?page=2') {
    pass('4dayweek.fetch() builds ?page=N URLs and stops when has_more is false');
  } else {
    fail(`4dayweek.fetch() requested = ${JSON.stringify(requested.map(r => r.url))}`);
  }

  if (requested.every(r => r.redirect === 'error')) pass('4dayweek.fetch() passes redirect:"error" on every page (SSRF guard)');
  else fail(`4dayweek.fetch() redirect opts = ${JSON.stringify(requested.map(r => r.redirect))}`);

  if (paged.length === 27) pass('4dayweek.fetch() aggregates valid jobs across pages (25 + 2, dropping the empty-title row)');
  else fail(`4dayweek.fetch() returned ${paged.length} jobs (expected 27)`);

  // max_pages cap: only the first page is requested even though has_more is true.
  const capReq = [];
  await fourdayweek.fetch(
    { name: '4 Day Week', max_pages: 1 },
    { fetchJson: async (url) => { capReq.push(url); return { jobs: Array.from({ length: 25 }, (_, i) => mk(i)), total: 999, has_more: true }; } },
  );
  if (capReq.length === 1 && capReq[0] === 'https://4dayweek.io/api/jobs?page=1') {
    pass('4dayweek.fetch() honors max_pages (stops at the cap even when has_more is true)');
  } else {
    fail(`4dayweek.fetch() max_pages:1 requested ${JSON.stringify(capReq)}`);
  }

  // unexpected API response → throws.
  let badThrew = false;
  try {
    await fourdayweek.fetch({ name: 'X' }, { fetchJson: async () => ([]) });
  } catch (e) {
    badThrew = /unexpected API response/.test(e.message);
  }
  if (badThrew) pass('4dayweek.fetch() throws on unexpected API response shape (no jobs array)');
  else fail('4dayweek.fetch() should throw when the jobs array is absent');

} catch (e) {
  fail(`4dayweek provider tests crashed: ${e.message}`);
}
