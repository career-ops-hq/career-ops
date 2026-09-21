// tests/providers/yer.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — YER');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/yer.mjs')).href);
  const provider = mod.default;
  const { normalizeYerJob } = mod;

  if (provider.id === 'yer') pass('yer.id is "yer"');
  else fail(`yer.id is ${JSON.stringify(provider.id)}`);

  const full = normalizeYerJob({
    uid: 3204,
    title: '  Junior QA Engineer (m/w/d)  ',
    urlAbsolute: 'https://www.yer.de/de/jobangebote/junior-qa-engineer-3204/',
    location: '  Aachen  ',
  }, 'YER');
  if (full?.title === 'Junior QA Engineer (m/w/d)'
      && full.url === 'https://www.yer.de/de/jobangebote/junior-qa-engineer-3204/'
      && full.company === 'YER' && full.location === 'Aachen') {
    pass('normalizeYerJob maps and trims title, canonical YER URL, source company, and location');
  } else {
    fail(`normalizeYerJob full row = ${JSON.stringify(full)}`);
  }

  const relative = normalizeYerJob({
    title: 'Software Tester',
    url: '/de/jobangebote/software-tester-3205/',
    workplace: 'Berlin',
  }, 'YER');
  if (relative?.url === 'https://www.yer.de/de/jobangebote/software-tester-3205/' && relative.location === 'Berlin') {
    pass('normalizeYerJob resolves a relative posting URL and falls back to workplace');
  } else {
    fail(`normalizeYerJob relative row = ${JSON.stringify(relative)}`);
  }

  const drops = [
    normalizeYerJob({ title: '', urlAbsolute: 'https://www.yer.de/de/jobangebote/x-1/' }),
    normalizeYerJob({ title: 'No URL' }),
    normalizeYerJob({ title: 'Insecure', urlAbsolute: 'http://www.yer.de/de/jobangebote/x-2/' }),
    normalizeYerJob({ title: 'Off host', urlAbsolute: 'https://evil.example/de/jobangebote/x-3/' }),
    normalizeYerJob({ title: 'Wrong path', urlAbsolute: 'https://www.yer.de/de/ueber-uns/' }),
    normalizeYerJob(null),
  ];
  if (drops.every(row => row === null)) pass('normalizeYerJob drops invalid, insecure, off-host, and non-posting rows');
  else fail(`normalizeYerJob drops = ${JSON.stringify(drops)}`);

  const requested = [];
  const page0 = Array.from({ length: 10 }, (_, i) => ({
    title: `Role ${i}`,
    urlAbsolute: `https://www.yer.de/de/jobangebote/role-${i}-${i}/`,
    location: 'Aachen',
  }));
  const page1 = [{ title: 'Last role', urlAbsolute: 'https://www.yer.de/de/jobangebote/last-11/', location: 'Berlin' }];
  const jobs = await provider.fetch(
    { name: 'YER', max_pages: 5 },
    { fetchJson: async (url, options) => {
      requested.push({ url, redirect: options?.redirect });
      return requested.length === 1 ? { jobs: page0 } : { jobs: page1 };
    } },
  );
  if (requested.length === 2
      && requested[0].url === 'https://www.yer.de/de/api/jobs?recommendations=0&offset=0'
      && requested[1].url === 'https://www.yer.de/de/api/jobs?recommendations=0&offset=1') {
    pass('fetch() pages through offset=0,1 and stops after a short page');
  } else {
    fail(`fetch() requested = ${JSON.stringify(requested.map(r => r.url))}`);
  }
  if (requested.every(r => r.redirect === 'error')) pass('fetch() passes redirect:"error" on every page');
  else fail(`fetch() redirect options = ${JSON.stringify(requested)}`);
  if (jobs.length === 11 && jobs.every(job => job.company === 'YER')) pass('fetch() aggregates normalized jobs with YER as the source company');
  else fail(`fetch() returned = ${JSON.stringify(jobs)}`);

  let badThrew = false;
  try {
    await provider.fetch({ name: 'YER' }, { fetchJson: async () => ({ wrong: true }) });
  } catch (error) {
    badThrew = /unexpected API response/.test(error.message);
  }
  if (badThrew) pass('fetch() throws on an unexpected API response shape');
  else fail('fetch() should throw when the jobs array is absent');
} catch (error) {
  fail(`yer provider tests crashed: ${error.message}`);
}
