// tests/providers/remotli.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — remotli');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/remotli.mjs')).href);
  const remotli = mod.default;
  const { normalizeRemotliJob } = mod;

  if (remotli.id === 'remotli') pass('remotli.id is "remotli"');
  else fail(`remotli.id is ${JSON.stringify(remotli.id)}`);

  // --- detect() -------------------------------------------------------------
  const hit = remotli.detect({ name: 'X', careers_url: 'https://remotli.ch/' });
  if (hit && /^https:\/\/remotli\.ch\/api\/jobs\?page=1&limit=50$/.test(hit.url)) {
    pass('detect() claims a remotli.ch careers_url and points at the paged API');
  } else {
    fail(`detect() returned ${JSON.stringify(hit)}`);
  }

  const misses = [
    remotli.detect({ name: 'X', careers_url: 'https://evil.example/remotli.ch' }),
    remotli.detect({ name: 'X', careers_url: 'http://remotli.ch/' }), // non-HTTPS
    remotli.detect({ name: 'X', careers_url: 'https://remotli.ch.evil.example/' }),
    remotli.detect({ name: 'X' }),
  ];
  if (misses.every(m => m === null)) pass('detect() rejects off-host, look-alike, non-HTTPS and missing careers_url');
  else fail(`detect() misses = ${JSON.stringify(misses)}`);

  // --- normalizeRemotliJob() -------------------------------------------------
  const row = (jobs, companies) => ({ jobs, companies: companies || {} });

  const full = normalizeRemotliJob(row({
    title: '  Head of Finance  ',
    slug: 'head-of-finance-at-acme',
    status: 'active',
    company: '  Acme AG  ',
    location: 'Zürich, Switzerland',
    allLocations: ['Zürich, Switzerland', 'Remote'],
    description: '<p>Own the <b>numbers</b>.</p><li>FP&amp;A</li>',
    publishedAt: '2026-08-01T10:00:00.000Z',
    salaryMin: 180000, salaryMax: 220000, salaryCurrency: 'chf',
  }));
  if (full
      && full.title === 'Head of Finance'
      && full.url === 'https://remotli.ch/jobs/head-of-finance-at-acme'
      && full.company === 'Acme AG'
      && full.location === 'Zürich, Switzerland; Remote'
      && full.postedAt === Date.parse('2026-08-01T10:00:00.000Z')) {
    pass('normalizeRemotliJob maps title/url/company, folds allLocations, parses publishedAt');
  } else {
    fail(`normalizeRemotliJob full = ${JSON.stringify(full)}`);
  }

  if (full && /Own the numbers/.test(full.description) && !/[<>]/.test(full.description) && /FP&A/.test(full.description)) {
    pass('normalizeRemotliJob strips HTML and decodes entities in description (feeds the #1597 fingerprint)');
  } else {
    fail(`normalizeRemotliJob description = ${JSON.stringify(full?.description)}`);
  }

  // Double-encoded markup (&lt;p&gt;) must not survive as literal "<p>" text.
  // A single strip-then-decode leaves it behind — it hit 38 of 50 rows on a
  // live page and would poison the cross-listing fingerprint.
  const doubleEncoded = normalizeRemotliJob(row({
    title: 'T', slug: 'de', status: 'active',
    description: '&lt;p&gt;Own the numbers&lt;/p&gt;&lt;li&gt;FP&amp;amp;A&lt;/li&gt;',
  }));
  if (doubleEncoded && !/<[a-z/]/i.test(doubleEncoded.description) && /Own the numbers/.test(doubleEncoded.description)) {
    pass('normalizeRemotliJob strips markup that only appears after entity decoding (double-encoded rows)');
  } else {
    fail(`normalizeRemotliJob double-encoded description = ${JSON.stringify(doubleEncoded?.description)}`);
  }

  if (full && full.salary && full.salary.min === 180000 && full.salary.max === 220000 && full.salary.currency === 'CHF') {
    pass('normalizeRemotliJob maps salaryMin/Max/Currency to the {min,max,currency} shape scan.mjs expects');
  } else {
    fail(`normalizeRemotliJob salary = ${JSON.stringify(full?.salary)}`);
  }

  // Inverted salary bounds are normalized, not emitted backwards.
  const inverted = normalizeRemotliJob(row({ title: 'T', slug: 's1', salaryMin: 200, salaryMax: 100, salaryCurrency: 'CHF' }));
  if (inverted?.salary?.min === 100 && inverted?.salary?.max === 200) pass('normalizeRemotliJob orders inverted salary bounds');
  else fail(`normalizeRemotliJob inverted salary = ${JSON.stringify(inverted?.salary)}`);

  // Only `active` rows survive — this is the built-in liveness guarantee.
  const closed = [
    normalizeRemotliJob(row({ title: 'Closed', slug: 'c1', status: 'closed' })),
    normalizeRemotliJob(row({ title: 'Draft', slug: 'c2', status: 'draft' })),
    normalizeRemotliJob(row({ title: 'Expired', slug: 'c3', status: 'EXPIRED' })),
  ];
  if (closed.every(c => c === null)) pass('normalizeRemotliJob drops non-active rows (built-in liveness)');
  else fail(`normalizeRemotliJob non-active = ${JSON.stringify(closed)}`);

  // A missing status is treated as open (don't penalize missing data).
  const noStatus = normalizeRemotliJob(row({ title: 'T', slug: 'ns' }));
  if (noStatus && noStatus.url === 'https://remotli.ch/jobs/ns') pass('normalizeRemotliJob keeps rows with no status field');
  else fail(`normalizeRemotliJob no-status = ${JSON.stringify(noStatus)}`);

  // Company fallbacks: job.company → companies.name → entry name → "Remotli".
  const fromJoin = normalizeRemotliJob(row({ title: 'T', slug: 'f1' }, { name: 'Join Co' }));
  const fromEntry = normalizeRemotliJob(row({ title: 'T', slug: 'f2' }), 'Entry Name');
  const fallback = normalizeRemotliJob(row({ title: 'T', slug: 'f3' }));
  if (fromJoin?.company === 'Join Co' && fromEntry?.company === 'Entry Name' && fallback?.company === 'Remotli') {
    pass('normalizeRemotliJob falls back company → companies.name → entry name → "Remotli"');
  } else {
    fail(`normalizeRemotliJob company fallbacks = ${JSON.stringify({ a: fromJoin?.company, b: fromEntry?.company, c: fallback?.company })}`);
  }

  // Slug is the only thing interpolated into the URL — keep it path-safe.
  const badSlugs = [
    normalizeRemotliJob(row({ title: 'T', slug: '../../etc/passwd' })),
    normalizeRemotliJob(row({ title: 'T', slug: 'a/b' })),
    normalizeRemotliJob(row({ title: 'T', slug: 'a?b=c' })),
    normalizeRemotliJob(row({ title: 'T', slug: '' })),
    normalizeRemotliJob(row({ title: '', slug: 'ok' })),
    normalizeRemotliJob({ companies: {} }),
    normalizeRemotliJob(null),
  ];
  if (badSlugs.every(b => b === null)) pass('normalizeRemotliJob drops path-unsafe slugs, empty title and malformed rows');
  else fail(`normalizeRemotliJob bad rows = ${JSON.stringify(badSlugs)}`);

  // Out-of-range numeric entities must not throw. String.fromCodePoint raises
  // RangeError above 0x10FFFF and Number.isFinite does not catch it, so an
  // unguarded decode let one malformed description abort the entire page fetch
  // and drop every job on the board.
  let entityThrew = null;
  try {
    const dec = normalizeRemotliJob(row({ title: 'T', slug: 'ent', status: 'active', description: 'pay &#99999999; and &#xFFFFFFF; ok' }));
    entityThrew = dec && !/�?\d{8}/.test(dec.description) ? false : false;
  } catch (e) {
    entityThrew = e;
  }
  if (entityThrew === false) pass('normalizeRemotliJob survives out-of-range numeric/hex entities (no RangeError)');
  else fail(`normalizeRemotliJob threw on an out-of-range entity: ${entityThrew}`);

  // …and the same must hold through fetch(), where one bad row previously
  // killed every other job on the page.
  let pageSurvived = false;
  try {
    const mixed = await remotli.fetch({ name: 'R' }, {
      fetchJson: async () => ({
        jobs: [
          { jobs: { title: 'Good', slug: 'good', status: 'active' } },
          { jobs: { title: 'Bad', slug: 'bad', status: 'active', description: '&#99999999;' } },
        ],
        pagination: { totalPages: 1 },
      }),
    });
    pageSurvived = mixed.length === 2;
  } catch {
    pageSurvived = false;
  }
  if (pageSurvived) pass('fetch() keeps the whole page when one description carries a malformed entity');
  else fail('fetch() lost the page over a single malformed entity');

  // Missing date → no postedAt key at all.
  const noDate = normalizeRemotliJob(row({ title: 'T', slug: 'nd' }));
  if (noDate && !('postedAt' in noDate)) pass('normalizeRemotliJob omits postedAt when no date is present');
  else fail(`normalizeRemotliJob postedAt presence = ${JSON.stringify(noDate)}`);

  // --- fetch() ---------------------------------------------------------------
  const mk = (i) => ({ jobs: { title: `Role ${i}`, slug: `role-${i}`, status: 'active' }, companies: { name: `Co ${i}` } });

  const requested = [];
  const pagedFetch = async (url, opts) => {
    requested.push({ url, redirect: opts?.redirect });
    const page = Number(new URL(url).searchParams.get('page'));
    if (page === 1) return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), pagination: { page: 1, limit: 50, total: 60, totalPages: 2 } };
    return { jobs: Array.from({ length: 10 }, (_, i) => mk(50 + i)), pagination: { page: 2, limit: 50, total: 60, totalPages: 2 } };
  };

  const paged = await remotli.fetch({ name: 'Remotli' }, { fetchJson: pagedFetch });
  if (paged.length === 60) pass('fetch() walks pages and aggregates all rows (50 + 10)');
  else fail(`fetch() returned ${paged.length} jobs (expected 60)`);

  if (requested.length === 2
      && requested[0].url === 'https://remotli.ch/api/jobs?page=1&limit=50'
      && requested[1].url === 'https://remotli.ch/api/jobs?page=2&limit=50') {
    pass('fetch() builds ?page=N&limit=50 URLs and stops after the short page');
  } else {
    fail(`fetch() requested = ${JSON.stringify(requested.map(r => r.url))}`);
  }

  if (requested.every(r => r.redirect === 'error')) pass('fetch() passes redirect:"error" on every page (SSRF guard)');
  else fail(`fetch() redirect opts = ${JSON.stringify(requested.map(r => r.redirect))}`);

  // ctx.maxPages (verify-portals health probe) caps the walk at one page.
  const capped = [];
  await remotli.fetch({ name: 'Remotli' }, {
    maxPages: 1,
    fetchJson: async (url) => {
      capped.push(url);
      return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), pagination: { page: 1, limit: 50, total: 500, totalPages: 10 } };
    },
  });
  if (capped.length === 1) pass('fetch() honors ctx.maxPages (health probe reads one page only)');
  else fail(`fetch() with maxPages:1 requested ${capped.length} pages`);

  // Unexpected shape → throws rather than silently returning nothing.
  let threw = false;
  try {
    await remotli.fetch({ name: 'X' }, { fetchJson: async () => ({ wrong: true }) });
  } catch (e) {
    threw = /unexpected API response/.test(e.message);
  }
  if (threw) pass('fetch() throws on an unexpected API response shape (no silent empty result)');
  else fail('fetch() should throw when the jobs array is absent');

} catch (e) {
  fail(`remotli provider tests crashed: ${e.message}`);
}
