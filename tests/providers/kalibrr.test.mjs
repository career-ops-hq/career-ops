// tests/providers/kalibrr.test.mjs — Kalibrr (Indonesia-heavy SEA board).
//
// The endpoint is public and unauthenticated, so this file is entirely offline:
// the payloads are the shapes observed live on 2026-09-23 (1,279 live postings,
// `company` an object, `google_location.address_components` carrying the city).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — kalibrr');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/kalibrr.mjs')).href);
  const kalibrr = mod.default;
  const { normalizeKalibrrJob } = mod;

  if (kalibrr.id === 'kalibrr') pass('kalibrr.id is "kalibrr"');
  else fail(`kalibrr.id is ${JSON.stringify(kalibrr.id)}`);

  if (kalibrr.detect({ name: 'X', careers_url: 'https://www.kalibrr.com/job-board/te' }) === null) {
    pass('kalibrr.detect() returns null — explicit provider only, no URL auto-detection');
  } else {
    fail('kalibrr.detect() should return null for any URL');
  }

  // A live row shape, trimmed to the fields the parser reads.
  const liveRow = {
    id: 272829,
    name: 'Investor Relations Intern',
    slug: 'investor-relations-intern',
    company: { code: 'agung-sedayu-group', name: 'Agung Sedayu Group' },
    company_name: 'Agung Sedayu Group',
    google_location: {
      address_components: { city: 'North Jakarta', region: 'DKI Jakarta', country: 'Indonesia' },
    },
    activation_date: '2026-09-23T11:55:37.266927+00:00',
    created_at: '2026-09-23T11:55:34.217691+00:00',
    description: '<ul><li>Support the preparation of <strong>Investor Relations</strong> materials.</li></ul>',
    qualifications: '<p>Fresh graduates welcome</p>',
    is_work_from_home: false,
    salary_interval: 'month',
    base_salary: 2300000,
  };

  const parsed = normalizeKalibrrJob(liveRow, 'Kalibrr');
  if (
    parsed
    && parsed.title === 'Investor Relations Intern'
    && parsed.url === 'https://www.kalibrr.com/c/agung-sedayu-group/jobs/272829/investor-relations-intern'
  ) {
    pass('normalizeKalibrrJob builds the canonical /c/{company code}/jobs/{id}/{slug} URL');
  } else {
    fail(`normalizeKalibrrJob returned ${JSON.stringify(parsed)}`);
  }

  if (parsed?.company === 'Agung Sedayu Group') pass('normalizeKalibrrJob reads company.name (an object, not a JSON string)');
  else fail(`normalizeKalibrrJob company = ${JSON.stringify(parsed?.company)}`);

  if (parsed?.location === 'North Jakarta, DKI Jakarta, Indonesia') {
    pass('normalizeKalibrrJob joins city/region/country from google_location');
  } else {
    fail(`normalizeKalibrrJob location = ${JSON.stringify(parsed?.location)}`);
  }

  if (parsed?.postedAt === Date.parse('2026-09-23T11:55:37.266927+00:00')) {
    pass('normalizeKalibrrJob prefers activation_date for postedAt');
  } else {
    fail(`normalizeKalibrrJob postedAt = ${JSON.stringify(parsed?.postedAt)}`);
  }

  if (parsed?.description === 'Support the preparation of Investor Relations materials. Fresh graduates welcome') {
    pass('normalizeKalibrrJob flattens description + qualifications HTML to plain text');
  } else {
    fail(`normalizeKalibrrJob description = ${JSON.stringify(parsed?.description)}`);
  }

  if (parsed?.salary === undefined) {
    pass('normalizeKalibrrJob never attaches salary — the board publishes a monthly figure, the Job contract is annual');
  } else {
    fail(`normalizeKalibrrJob attached salary ${JSON.stringify(parsed?.salary)} (must stay unset)`);
  }

  // created_at is the fallback before activation.
  const createdOnly = normalizeKalibrrJob(
    { id: 1, name: 'Role', slug: 'role', created_at: '2026-01-02T03:04:05+00:00' },
    'Kalibrr',
  );
  if (createdOnly?.postedAt === Date.parse('2026-01-02T03:04:05+00:00')) {
    pass('normalizeKalibrrJob falls back to created_at when activation_date is absent');
  } else {
    fail(`normalizeKalibrrJob created_at fallback = ${JSON.stringify(createdOnly?.postedAt)}`);
  }

  // The company-code segment is cosmetic: a row without one still resolves.
  const noCode = normalizeKalibrrJob({ id: 7, name: 'Role', slug: 'role' }, 'PortalName');
  if (noCode?.url === 'https://www.kalibrr.com/c/-/jobs/7/role') {
    pass('normalizeKalibrrJob falls back to the cosmetic "-" company segment when code is missing');
  } else {
    fail(`normalizeKalibrrJob no-code URL = ${JSON.stringify(noCode?.url)}`);
  }

  if (noCode?.company === 'PortalName') pass('normalizeKalibrrJob falls back to the portal entry name for company');
  else fail(`normalizeKalibrrJob fallback company = ${JSON.stringify(noCode?.company)}`);

  // Remote flag becomes a location token, as other providers do.
  const remote = normalizeKalibrrJob({ id: 9, name: 'Role', slug: 'r', is_work_from_home: true }, 'X');
  if (remote?.location === 'Remote') pass('normalizeKalibrrJob appends "Remote" when is_work_from_home is set');
  else fail(`normalizeKalibrrJob remote location = ${JSON.stringify(remote?.location)}`);

  // Drop rules.
  if (normalizeKalibrrJob({ id: 1, slug: 'x' }, 'X') === null) pass('normalizeKalibrrJob returns null for title-less rows');
  else fail('normalizeKalibrrJob should return null for a row without a title');
  if (normalizeKalibrrJob({ name: 'Role', slug: 'x' }, 'X') === null) pass('normalizeKalibrrJob returns null for id-less rows (no URL to dedup on)');
  else fail('normalizeKalibrrJob should return null for a row without an id');
  if (normalizeKalibrrJob(null, 'X') === null && normalizeKalibrrJob(42, 'X') === null) {
    pass('normalizeKalibrrJob handles null/number input safely');
  } else {
    fail('normalizeKalibrrJob should return null for null/non-object input');
  }

  // ── fetch() ────────────────────────────────────────────────────────────
  const onePage = {
    count: 2,
    jobs: [
      { id: 1, name: 'Data Engineer', slug: 'data-engineer', company: { code: 'acme', name: 'Acme' } },
      { id: 2, name: 'Analyst', slug: 'analyst', company: { code: 'acme', name: 'Acme' } },
    ],
  };
  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await kalibrr.fetch(
    { name: 'Kalibrr ID', provider: 'kalibrr', pageSize: 100 },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return onePage; } },
  );

  if (capturedUrl === 'https://www.kalibrr.com/kjs/job_board/search?limit=100&offset=0') {
    pass('kalibrr.fetch() requests the job-board search with limit/offset');
  } else {
    fail(`kalibrr.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts?.redirect === 'error') pass('kalibrr.fetch() passes redirect:"error" to fetchJson (SSRF guard)');
  else fail(`kalibrr.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2) pass('kalibrr.fetch() returns both rows and stops at count');
  else fail(`kalibrr.fetch() returned ${fetched.length} jobs (expected 2)`);

  // searchKeywords maps to the API's own `text` param.
  let kwUrl = null;
  await kalibrr.fetch(
    { name: 'Kalibrr', provider: 'kalibrr', searchKeywords: 'engineer' },
    { fetchJson: async (url) => { kwUrl = url; return { count: 0, jobs: [] }; } },
  );
  if (kwUrl === 'https://www.kalibrr.com/kjs/job_board/search?limit=100&offset=0&text=engineer') {
    pass('kalibrr.fetch() maps searchKeywords onto the API\'s `text` filter');
  } else {
    fail(`kalibrr.fetch() keyword URL = ${JSON.stringify(kwUrl)}`);
  }

  // Pagination: count (not the page size) drives the stop.
  const pages = [];
  const paged = await kalibrr.fetch(
    { name: 'Kalibrr', provider: 'kalibrr', pageSize: 2, maxPages: 5 },
    {
      fetchJson: async (url) => {
        pages.push(new URL(url).searchParams.get('offset'));
        return { count: 3, jobs: [1, 2].slice(0, 3 - Number(pages[pages.length - 1])).map((i) => ({ id: Number(pages[pages.length - 1]) + i, name: `Role ${i}`, slug: `r${i}`, company: { code: 'c', name: 'C' } })) };
      },
    },
  );
  if (pages.join(',') === '0,2' && paged.length === 3) {
    pass('kalibrr.fetch() walks pages until it has counted past `count`');
  } else {
    fail(`kalibrr.fetch() pagination = offsets [${pages.join(',')}] rows ${paged.length} (expected offsets 0,2 and 3 rows)`);
  }

  // An empty board is an empty result, not an error.
  const emptyBoard = await kalibrr.fetch(
    { name: 'Kalibrr', provider: 'kalibrr' },
    { fetchJson: async () => ({ count: 0, jobs: [] }) },
  );
  if (Array.isArray(emptyBoard) && emptyBoard.length === 0) pass('kalibrr.fetch() returns [] for an empty board');
  else fail(`kalibrr.fetch() empty board = ${JSON.stringify(emptyBoard)}`);

  // The provider's own page cap stops a source that reports endless results.
  let capCalls = 0;
  await kalibrr.fetch(
    { name: 'Kalibrr', provider: 'kalibrr' },
    {
      fetchJson: async () => {
        capCalls += 1;
        return {
          count: 999999,
          jobs: Array.from({ length: 100 }, (_, i) => ({
            id: capCalls * 1000 + i,
            name: `Role ${i}`,
            slug: `r-${capCalls}-${i}`,
            company: { code: 'c', name: 'C' },
          })),
        };
      },
    },
  );
  if (capCalls === 20) pass('kalibrr.fetch() stops at its own DEFAULT_MAX_PAGES (20) when the board never runs out');
  else fail(`kalibrr.fetch() page cap = ${capCalls} call(s) (expected 20)`);

  // Malformed payloads fail loudly rather than reporting an empty board.
  let threw = false;
  try {
    await kalibrr.fetch({ name: 'X', provider: 'kalibrr' }, { fetchJson: async () => ({ wrong: true }) });
  } catch (e) {
    threw = /unexpected API response/.test(e.message);
  }
  if (threw) pass('kalibrr.fetch() throws on an unexpected API response shape');
  else fail('kalibrr.fetch() should throw when the jobs array is absent');

  // SSRF allowlist runs before any network call.
  let guardThrew = false;
  let called = false;
  try {
    await kalibrr.fetch(
      { name: 'X', provider: 'kalibrr', api: 'https://evil.example.com/kjs/job_board/search' },
      { fetchJson: async () => { called = true; return { count: 0, jobs: [] }; } },
    );
  } catch (e) {
    guardThrew = /untrusted hostname/.test(e.message);
  }
  if (guardThrew && !called) pass('kalibrr.fetch() rejects an untrusted api host before fetching');
  else fail(`kalibrr.fetch() host guard: threw=${guardThrew} fetched=${called}`);
} catch (e) {
  fail(`kalibrr suite crashed: ${e.message}`);
}
