// tests/providers/agentic-jobs.test.mjs — Agentic Engineering Jobs provider
// (public REST API at agentic-engineering-jobs.com/api/v1/jobs, #2143 —
// the previous HTML scraper broke when the site's markup changed). Follows
// the discovered-test layout from #1440.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — agentic-jobs (agentic-engineering-jobs.com REST API)');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/agentic-jobs.mjs')).href);
  const agentic = mod.default;
  const { countryName, stripHtml, normalizeAgenticLocation, normalizeAgenticSalary, normalizeAgenticJob } = mod;

  if (agentic.id === 'agentic-jobs') pass('agentic-jobs.id is "agentic-jobs"');
  else fail(`agentic-jobs.id is ${JSON.stringify(agentic.id)}`);

  const hit = agentic.detect({ name: 'Agentic Engineering Jobs', provider: 'agentic-jobs' });
  if (hit && hit.url === 'https://agentic-engineering-jobs.com') {
    pass('agentic-jobs.detect() claims entries with provider: agentic-jobs');
  } else {
    fail(`agentic-jobs.detect() returned ${JSON.stringify(hit)}`);
  }

  if (agentic.detect({ name: 'X', provider: 'remoteok' }) === null) {
    pass('agentic-jobs.detect() returns null for other providers');
  } else {
    fail('agentic-jobs.detect() should return null for other providers');
  }

  if (agentic.detect({ name: 'X', careers_url: 'https://agentic-engineering-jobs.com/' }) === null) {
    pass('agentic-jobs.detect() does not URL-autodetect (explicit provider: only)');
  } else {
    fail('agentic-jobs.detect() should not claim entries by careers_url');
  }

  // countryName — ISO alpha-2 code → English name
  if (countryName('US') === 'United States' && countryName('de') === 'Germany') {
    pass('countryName() resolves ISO alpha-2 codes case-insensitively');
  } else {
    fail(`countryName('US')=${JSON.stringify(countryName('US'))} countryName('de')=${JSON.stringify(countryName('de'))}`);
  }
  if (countryName('XX') === '' && countryName('USA') === '' && countryName(null) === '' && countryName(42) === '') {
    pass('countryName() returns "" for unresolvable/non-two-letter/non-string input');
  } else {
    fail('countryName() should return "" for invalid input');
  }

  // stripHtml — tags dropped (script/style content removed entirely), entities decoded
  const html = '<script>var x = 1;</script><style>.a{}</style><p>Ship &amp; iterate</p><ul><li>Node.js</li><li>Go</li></ul>';
  if (stripHtml(html) === 'Ship & iterate Node.js Go') {
    pass('stripHtml() drops tags/script/style content, decodes entities, collapses whitespace');
  } else {
    fail(`stripHtml() = ${JSON.stringify(stripHtml(html))}`);
  }
  if (stripHtml('') === '' && stripHtml(null) === '' && stripHtml(undefined) === '') {
    pass('stripHtml() returns "" for empty/non-string input');
  } else {
    fail('stripHtml() should return "" for empty/non-string input');
  }

  // normalizeAgenticLocation — prefers the API's own location string; falls
  // back to decoded countries, then geoRegion, when it's absent.
  if (normalizeAgenticLocation({ location: 'Remote (EU)', countries: ['DE'] }) === 'Remote (EU)') {
    pass('normalizeAgenticLocation() uses the API location string when present');
  } else {
    fail(`normalizeAgenticLocation() with location wrong: ${JSON.stringify(normalizeAgenticLocation({ location: 'Remote (EU)', countries: ['DE'] }))}`);
  }
  if (normalizeAgenticLocation({ location: '', countries: ['CA', 'GB'] }) === 'Canada / United Kingdom') {
    pass('normalizeAgenticLocation() falls back to deduped decoded countries when location is empty');
  } else {
    fail(`normalizeAgenticLocation() countries-fallback wrong: ${JSON.stringify(normalizeAgenticLocation({ location: '', countries: ['CA', 'GB'] }))}`);
  }
  if (normalizeAgenticLocation({ location: null, countries: [], geoRegion: 'global' }) === 'global') {
    pass('normalizeAgenticLocation() falls back to geoRegion when countries is empty too');
  } else {
    fail(`normalizeAgenticLocation() geoRegion-fallback wrong: ${JSON.stringify(normalizeAgenticLocation({ location: null, countries: [], geoRegion: 'global' }))}`);
  }
  if (normalizeAgenticLocation({}) === '') {
    pass('normalizeAgenticLocation() returns "" when nothing is usable');
  } else {
    fail('normalizeAgenticLocation() should return "" when nothing is usable');
  }

  // normalizeAgenticSalary — flat salaryMin/Max/Currency → {min, max, currency},
  // never coercing a null bound to 0.
  const bothBounds = normalizeAgenticSalary({ salaryMin: 196875, salaryMax: 246094, salaryCurrency: 'usd' });
  if (bothBounds && bothBounds.min === 196875 && bothBounds.max === 246094 && bothBounds.currency === 'USD') {
    pass('normalizeAgenticSalary() maps both bounds and uppercases currency');
  } else {
    fail(`normalizeAgenticSalary() both-bounds wrong: ${JSON.stringify(bothBounds)}`);
  }
  const minOnly = normalizeAgenticSalary({ salaryMin: 100000, salaryMax: null, salaryCurrency: 'USD' });
  if (minOnly && minOnly.min === 100000 && !('max' in minOnly)) {
    pass('normalizeAgenticSalary() omits a null bound instead of coercing it to 0');
  } else {
    fail(`normalizeAgenticSalary() min-only wrong: ${JSON.stringify(minOnly)}`);
  }
  if (normalizeAgenticSalary({ salaryMin: null, salaryMax: null, salaryCurrency: null }) === null) {
    pass('normalizeAgenticSalary() returns null when neither bound is present');
  } else {
    fail('normalizeAgenticSalary() should return null when neither bound is present');
  }

  // normalizeAgenticJob — full API record → normalized Job
  const record = {
    title: 'Senior Backend Engineer (Ruby)',
    companyName: 'Acme AI',
    slug: 'senior-backend-engineer-ruby-acme',
    location: 'Remote - Canada; Remote - United Kingdom',
    countries: ['CA', 'GB'],
    description: '<p>Ship &amp; iterate with <strong>Ruby on Rails</strong>.</p>',
    postedAt: '2026-07-01T12:00:00.000Z',
    salaryMin: 120000,
    salaryMax: 160000,
    salaryCurrency: 'usd',
  };
  const job = normalizeAgenticJob(record);
  if (
    job &&
    job.title === 'Senior Backend Engineer (Ruby)' &&
    job.company === 'Acme AI' &&
    job.url === 'https://agentic-engineering-jobs.com/jobs/senior-backend-engineer-ruby-acme' &&
    job.location === 'Remote - Canada; Remote - United Kingdom'
  ) {
    pass('normalizeAgenticJob() maps title/company/url/location');
  } else {
    fail(`normalizeAgenticJob() core fields wrong: ${JSON.stringify(job)}`);
  }
  if (job && job.description === 'Ship & iterate with Ruby on Rails .') {
    pass('normalizeAgenticJob() strips HTML from the description');
  } else {
    fail(`normalizeAgenticJob() description wrong: ${JSON.stringify(job && job.description)}`);
  }
  if (job && job.postedAt === Date.parse('2026-07-01T12:00:00.000Z')) {
    pass('normalizeAgenticJob() parses the ISO postedAt timestamp');
  } else {
    fail(`normalizeAgenticJob() postedAt wrong: ${job && job.postedAt}`);
  }
  if (job && job.salary && job.salary.min === 120000 && job.salary.max === 160000 && job.salary.currency === 'USD') {
    pass('normalizeAgenticJob() attaches the normalized salary');
  } else {
    fail(`normalizeAgenticJob() salary wrong: ${JSON.stringify(job && job.salary)}`);
  }

  const unsafeSlugs = ['bad slug!', '../admin', 'a/b', 'x?y=1', 'x#frag'];
  if (unsafeSlugs.every((slug) => normalizeAgenticJob({ title: 'X', companyName: 'Y', slug }) === null)) {
    pass('normalizeAgenticJob() rejects path-unsafe / traversal / URL-injection slugs (feeds straight into a URL path)');
  } else {
    fail(`normalizeAgenticJob() should reject every unsafe slug: ${JSON.stringify(unsafeSlugs.map((slug) => [slug, normalizeAgenticJob({ title: 'X', companyName: 'Y', slug })]))}`);
  }
  if (
    normalizeAgenticJob({ companyName: 'Y', slug: 'x' }) === null &&
    normalizeAgenticJob({ title: 'X', slug: 'x' }) === null &&
    normalizeAgenticJob({ title: 'X', companyName: 'Y' }) === null &&
    normalizeAgenticJob(null) === null
  ) {
    pass('normalizeAgenticJob() returns null when title/companyName/slug is missing');
  } else {
    fail('normalizeAgenticJob() should return null when a required field is missing');
  }
  const noExtras = normalizeAgenticJob({ title: 'X', companyName: 'Y', slug: 'x-y', location: 'Remote' });
  if (noExtras && !('description' in noExtras) && !('postedAt' in noExtras) && !('salary' in noExtras)) {
    pass('normalizeAgenticJob() omits description/postedAt/salary when the record carries none');
  } else {
    fail(`normalizeAgenticJob() should omit absent optional fields: ${JSON.stringify(noExtras)}`);
  }

  // fetch() — pagination, cross-page dedup, and the zero-jobs canary (mocked ctx)
  const mkJob = (n) => ({ title: `Engineer ${n}`, companyName: `Company ${n}`, slug: `engineer-${n}`, location: 'Remote' });
  const mkCtx = (pages, { sleep = true } = {}) => {
    const calls = [];
    return {
      calls,
      ctx: {
        fetchJson: async (url, opts) => {
          calls.push({ url, opts });
          const pageNum = Number(new URL(url).searchParams.get('page'));
          return pages[pageNum - 1] ?? { data: [], meta: { total: 0, page: pageNum, per_page: 50 } };
        },
        ...(sleep ? { sleep: async () => {} } : {}),
      },
    };
  };

  const onePage = mkCtx([{ data: [mkJob(1), mkJob(2)], meta: { total: 2, page: 1, per_page: 50 } }]);
  const onePageJobs = await agentic.fetch({ name: 'Agentic Engineering Jobs', provider: 'agentic-jobs' }, onePage.ctx);
  if (
    onePageJobs.length === 2 &&
    onePage.calls.length === 1 &&
    onePage.calls[0].url === 'https://agentic-engineering-jobs.com/api/v1/jobs?page=1' &&
    onePage.calls[0].opts.redirect === 'error'
  ) {
    pass('agentic-jobs.fetch() stops after a short (< PAGE_SIZE) page');
  } else {
    fail(`agentic-jobs.fetch() one-page: ${onePageJobs.length} jobs, calls=${JSON.stringify(onePage.calls.map((c) => c.url))}`);
  }

  const fullPage = Array.from({ length: 50 }, (_, i) => mkJob(i + 1));
  const twoPages = mkCtx([
    { data: fullPage, meta: { total: 51, page: 1, per_page: 50 } },
    { data: [mkJob(51)], meta: { total: 51, page: 2, per_page: 50 } },
  ]);
  const twoPageJobs = await agentic.fetch({ name: 'X', provider: 'agentic-jobs' }, twoPages.ctx);
  if (twoPageJobs.length === 51 && twoPages.calls.length === 2) {
    pass('agentic-jobs.fetch() pages until meta.total is covered');
  } else {
    fail(`agentic-jobs.fetch() two-page: ${twoPageJobs.length} jobs, ${twoPages.calls.length} calls`);
  }

  const dupePage = mkCtx([{ data: [mkJob(1), mkJob(1)], meta: { total: 2, page: 1, per_page: 50 } }]);
  const dupeJobs = await agentic.fetch({ name: 'X', provider: 'agentic-jobs' }, dupePage.ctx);
  if (dupeJobs.length === 1) {
    pass('agentic-jobs.fetch() dedups by URL within a page');
  } else {
    fail(`agentic-jobs.fetch() dedup: expected 1 job, got ${dupeJobs.length}`);
  }

  // Cross-page dedup: a job re-appearing on the next page (a live listing can
  // shift rank between requests) must not be double-counted.
  const crossPageDupe = mkCtx([
    { data: [mkJob(1), mkJob(2)], meta: { total: 3, page: 1, per_page: 2 } },
    { data: [mkJob(2), mkJob(3)], meta: { total: 3, page: 2, per_page: 2 } },
  ]);
  const crossPageJobs = await agentic.fetch({ name: 'X', provider: 'agentic-jobs' }, crossPageDupe.ctx);
  if (crossPageJobs.length === 3 && new Set(crossPageJobs.map((j) => j.url)).size === 3) {
    pass('agentic-jobs.fetch() dedups a job repeated across two different pages');
  } else {
    fail(`agentic-jobs.fetch() cross-page dedup: expected 3 unique jobs, got ${JSON.stringify(crossPageJobs.map((j) => j.url))}`);
  }

  // A malformed page (missing/non-array `data`) after already collecting real
  // jobs must fail loudly, not silently truncate the run as if it were a
  // legitimate short/last page.
  const malformedMidPagination = mkCtx([
    { data: [mkJob(1), mkJob(2)], meta: { total: 99, page: 1, per_page: 2 } },
    { meta: { total: 99, page: 2, per_page: 2 } }, // "data" missing entirely
  ]);
  let malformedThrew = false;
  try {
    await agentic.fetch({ name: 'X', provider: 'agentic-jobs' }, malformedMidPagination.ctx);
  } catch (e) {
    if (e instanceof Error && e.message.includes('unexpected API response shape on page 2')) malformedThrew = true;
    else throw e;
  }
  if (malformedThrew) {
    pass('agentic-jobs.fetch() throws on a malformed mid-pagination page instead of silently truncating');
  } else {
    fail('agentic-jobs.fetch() should throw when a later page has a missing/non-array "data" field');
  }

  let zeroJobsThrew = false;
  try {
    await agentic.fetch({ name: 'X', provider: 'agentic-jobs' }, mkCtx([{ data: [], meta: { total: 0, page: 1, per_page: 50 } }]).ctx);
  } catch (e) {
    // Match the specific canary message — an unrelated error (e.g. a bug
    // elsewhere) must not make this assertion pass by accident.
    if (e instanceof Error && e.message.includes('parsed 0 jobs from the API')) zeroJobsThrew = true;
    else throw e;
  }
  if (zeroJobsThrew) {
    pass('agentic-jobs.fetch() throws when the API yields zero jobs (response-shape-change canary)');
  } else {
    fail('agentic-jobs.fetch() should throw when no jobs parse');
  }
} catch (e) {
  fail(`agentic-jobs provider tests crashed: ${e.message}`);
}
