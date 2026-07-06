// tests/providers/arbeitnow.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — arbeitnow');

try {
  const arbeitnowModule = await import(pathToFileURL(join(ROOT, 'providers/arbeitnow.mjs')).href);
  const arbeitnow = arbeitnowModule.default;
  const { normalizeArbeitnowJob } = arbeitnowModule;

  if (arbeitnow.id === 'arbeitnow') pass('arbeitnow.id is "arbeitnow"');
  else fail(`arbeitnow.id is ${JSON.stringify(arbeitnow.id)}`);

  // normalizeArbeitnowJob — field mapping.
  const full = normalizeArbeitnowJob(
    { title: '  Staff AI Engineer  ', url: '  https://www.arbeitnow.com/jobs/x1  ', company_name: '  Acme Co  ', location: '  Berlin  ', remote: false, created_at: 1782693032 },
    'Fallback',
  );
  if (full && full.title === 'Staff AI Engineer' && full.url === 'https://www.arbeitnow.com/jobs/x1'
      && full.company === 'Acme Co' && full.location === 'Berlin' && full.postedAt === 1782693032000) {
    pass('normalizeArbeitnowJob maps + trims title/url/company/location and converts created_at seconds → ms');
  } else {
    fail(`normalizeArbeitnowJob full row = ${JSON.stringify(full)}`);
  }

  // remote:true appends "Remote" to the location.
  const remoteJob = normalizeArbeitnowJob({ title: 'R', url: 'https://www.arbeitnow.com/jobs/r', location: 'Munich', remote: true }, 'X');
  if (remoteJob?.location === 'Munich, Remote') pass('normalizeArbeitnowJob appends "Remote" when remote is true');
  else fail(`normalizeArbeitnowJob remote location = ${JSON.stringify(remoteJob?.location)}`);

  // remote-only (no base location) → "Remote".
  const remoteOnly = normalizeArbeitnowJob({ title: 'R', url: 'https://www.arbeitnow.com/jobs/r2', remote: true }, 'X');
  if (remoteOnly?.location === 'Remote') pass('normalizeArbeitnowJob yields "Remote" when remote is true and location is absent');
  else fail(`normalizeArbeitnowJob remote-only location = ${JSON.stringify(remoteOnly?.location)}`);

  // company fallbacks: entry name, then "Arbeitnow".
  const coFromEntry = normalizeArbeitnowJob({ title: 'T', url: 'https://www.arbeitnow.com/jobs/c1', company_name: '' }, 'Entry Name');
  const coDefault = normalizeArbeitnowJob({ title: 'T', url: 'https://www.arbeitnow.com/jobs/c2' });
  if (coFromEntry?.company === 'Entry Name' && coDefault?.company === 'Arbeitnow') {
    pass('normalizeArbeitnowJob falls back company → entry name → "Arbeitnow"');
  } else {
    fail(`normalizeArbeitnowJob company fallbacks = ${JSON.stringify({ a: coFromEntry?.company, b: coDefault?.company })}`);
  }

  // drops: empty title, missing url, non-https url, malformed url, non-object.
  const drops = [
    normalizeArbeitnowJob({ title: '', url: 'https://www.arbeitnow.com/jobs/d1' }),
    normalizeArbeitnowJob({ title: 'No URL' }),
    normalizeArbeitnowJob({ title: 'Insecure', url: 'http://www.arbeitnow.com/jobs/d3' }),
    normalizeArbeitnowJob({ title: 'Relative', url: '/jobs/d4' }),
    normalizeArbeitnowJob({ title: 'Off host', url: 'https://evil.example/jobs/d5' }), // host-lock: external https dropped
    normalizeArbeitnowJob(null),
  ];
  if (drops.every(r => r === null)) pass('normalizeArbeitnowJob drops empty-title / no-url / non-https / relative / off-host / non-object');
  else fail(`normalizeArbeitnowJob drops = ${JSON.stringify(drops)}`);

  // missing created_at → no postedAt key.
  const noDate = normalizeArbeitnowJob({ title: 'T', url: 'https://www.arbeitnow.com/jobs/nd' });
  if (noDate && !('postedAt' in noDate)) pass('normalizeArbeitnowJob omits postedAt when created_at is absent');
  else fail(`normalizeArbeitnowJob postedAt presence = ${JSON.stringify(noDate)}`);

  // fetch(): pagination by self-built ?page=N, stop on a short page.
  const mk = (i) => ({ title: `Role ${i}`, url: `https://www.arbeitnow.com/jobs/x${i}`, company_name: `Co ${i}`, location: 'Berlin', remote: false, created_at: 1782693032 + i });
  const page1 = Array.from({ length: 100 }, (_, i) => mk(i));            // full page → continue
  const page2 = [mk(100), mk(101), { title: '', url: 'https://www.arbeitnow.com/jobs/bad' }]; // short page (3 < 100) → stop; 1 drop
  const requested = [];
  const pagedFetch = async (url, opts) => {
    requested.push({ url, redirect: opts?.redirect });
    const u = new URL(url);
    const page = Number(u.searchParams.get('page'));
    // links.next deliberately points at a featured ?search= URL to prove we DON'T follow it.
    if (page === 1) return { data: page1, links: { next: 'https://www.arbeitnow.com/api/job-board-api?search=foo&page=2' }, meta: {} };
    if (page === 2) return { data: page2, links: { next: null }, meta: {} };
    return { data: [], links: {}, meta: {} };
  };

  const paged = await arbeitnow.fetch({ name: 'Arbeitnow' }, { fetchJson: pagedFetch });

  if (requested.length === 2
      && requested[0].url === 'https://www.arbeitnow.com/api/job-board-api?page=1'
      && requested[1].url === 'https://www.arbeitnow.com/api/job-board-api?page=2') {
    pass('arbeitnow.fetch() builds ?page=N URLs itself (ignores links.next) and stops after the short page');
  } else {
    fail(`arbeitnow.fetch() requested = ${JSON.stringify(requested.map(r => r.url))}`);
  }

  if (requested.every(r => r.redirect === 'error')) pass('arbeitnow.fetch() passes redirect:"error" on every page (SSRF guard)');
  else fail(`arbeitnow.fetch() redirect opts = ${JSON.stringify(requested.map(r => r.redirect))}`);

  if (paged.length === 102) pass('arbeitnow.fetch() aggregates valid jobs across pages (100 + 2, dropping the empty-title row)');
  else fail(`arbeitnow.fetch() returned ${paged.length} jobs (expected 102)`);

  // max_pages cap: only the first page is requested even though it is full.
  const capRequested = [];
  await arbeitnow.fetch(
    { name: 'Arbeitnow', max_pages: 1 },
    { fetchJson: async (url, opts) => { capRequested.push(url); return { data: Array.from({ length: 100 }, (_, i) => mk(i)) }; } },
  );
  if (capRequested.length === 1 && capRequested[0] === 'https://www.arbeitnow.com/api/job-board-api?page=1') {
    pass('arbeitnow.fetch() honors max_pages (stops at the cap even on a full page)');
  } else {
    fail(`arbeitnow.fetch() max_pages:1 requested ${JSON.stringify(capRequested)}`);
  }

  // unexpected API response → throws.
  let badThrew = false;
  try {
    await arbeitnow.fetch({ name: 'X' }, { fetchJson: async () => ({ wrong: true }) });
  } catch (e) {
    badThrew = /unexpected API response/.test(e.message);
  }
  if (badThrew) pass('arbeitnow.fetch() throws on unexpected API response shape');
  else fail('arbeitnow.fetch() should throw when the data array is absent');

} catch (e) {
  fail(`arbeitnow provider tests crashed: ${e.message}`);
}
