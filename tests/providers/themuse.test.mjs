// tests/providers/themuse.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — themuse');


try {
  const museModule = await import(pathToFileURL(join(ROOT, 'providers/themuse.mjs')).href);
  const themuse = museModule.default;
  const { normalizeMuseJob } = museModule;

  if (themuse.id === 'themuse') pass('themuse.id is "themuse"');
  else fail(`themuse.id is ${JSON.stringify(themuse.id)}`);

  // normalizeMuseJob — field mapping
  const job = normalizeMuseJob({
    name: 'Staff AI Engineer',
    refs: { landing_page: 'https://www.themuse.com/jobs/acme/staff-ai-engineer' },
    company: { name: 'Acme Corp' },
    locations: [{ name: 'Remote' }],
  });
  if (job?.title === 'Staff AI Engineer') pass('normalizeMuseJob maps name → title');
  else fail(`normalizeMuseJob title = ${JSON.stringify(job?.title)}`);

  if (job?.url === 'https://www.themuse.com/jobs/acme/staff-ai-engineer')
    pass('normalizeMuseJob maps refs.landing_page → url');
  else fail(`normalizeMuseJob url = ${JSON.stringify(job?.url)}`);

  if (job?.company === 'Acme Corp') pass('normalizeMuseJob maps company.name → company');
  else fail(`normalizeMuseJob company = ${JSON.stringify(job?.company)}`);

  if (job?.location === 'Remote') pass('normalizeMuseJob maps locations[0].name → location');
  else fail(`normalizeMuseJob location = ${JSON.stringify(job?.location)}`);

  // Missing/invalid field handling
  if (normalizeMuseJob({ name: '', refs: { landing_page: 'https://www.themuse.com/jobs/x' }, company: { name: 'X' }, locations: [] }) === null)
    pass('normalizeMuseJob drops entries with empty title');
  else fail('normalizeMuseJob should return null for empty title');

  if (normalizeMuseJob({ name: 'Role', refs: { landing_page: '/relative' }, company: { name: 'X' }, locations: [] }) === null)
    pass('normalizeMuseJob drops entries with a non-absolute landing_page URL');
  else fail('normalizeMuseJob should return null for a relative URL');

  const noLoc = normalizeMuseJob({
    name: 'Role', refs: { landing_page: 'https://www.themuse.com/jobs/x' }, company: { name: 'X' }, locations: [],
  });
  if (noLoc?.location === '') pass('normalizeMuseJob returns empty location when locations array is empty');
  else fail(`normalizeMuseJob location for empty locations = ${JSON.stringify(noLoc?.location)}`);

  const noCompany = normalizeMuseJob({
    name: 'Role', refs: { landing_page: 'https://www.themuse.com/jobs/x' }, company: null, locations: [{ name: 'NYC' }],
  });
  if (noCompany?.company === 'The Muse') pass('normalizeMuseJob falls back to "The Muse" when company.name is missing');
  else fail(`normalizeMuseJob company fallback = ${JSON.stringify(noCompany?.company)}`);

  if (normalizeMuseJob(null) === null && normalizeMuseJob('string') === null)
    pass('normalizeMuseJob returns null for non-object inputs');
  else fail('normalizeMuseJob should return null for null/non-object input');

  // fetch() — mock ctx
  const sampleResults = [
    {
      name: 'Staff AI Engineer',
      refs: { landing_page: 'https://www.themuse.com/jobs/acme/staff-ai-engineer' },
      company: { name: 'Acme Corp' },
      locations: [{ name: 'Remote' }],
    },
    {
      name: 'Platform Engineer',
      refs: { landing_page: 'https://www.themuse.com/jobs/beta/platform-engineer' },
      company: { name: 'Beta Inc' },
      locations: [],
    },
    {
      name: '',
      refs: { landing_page: 'https://www.themuse.com/jobs/bad/role' },
      company: { name: 'Bad Co' },
      locations: [],
    },
  ];

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await themuse.fetch(
    { name: 'The Muse Board', provider: 'themuse' },
    {
      fetchJson: async (url, opts) => {
        capturedUrl = url; capturedOpts = opts;
        return { results: sampleResults, page: 0, page_count: 1 };
      },
    },
  );

  if (capturedUrl === 'https://www.themuse.com/api/public/jobs?page=0')
    pass('themuse.fetch() requests the correct API endpoint');
  else fail(`themuse.fetch() requested ${JSON.stringify(capturedUrl)}`);

  if (capturedOpts && capturedOpts.redirect === 'error')
    pass('themuse.fetch() passes redirect:"error" to fetchJson');
  else fail(`themuse.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 2)
    pass('themuse.fetch() normalizes 2 valid jobs (drops the empty-title entry)');
  else fail(`themuse.fetch() returned ${fetched.length} jobs (expected 2)`);

  if (fetched[0]?.title === 'Staff AI Engineer' && fetched[0]?.company === 'Acme Corp')
    pass('themuse.fetch() returns correct title and company for first result');
  else fail(`themuse.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  // Pagination: page_count > 1 causes all pages to be fetched and aggregated.
  const paginationCalls = [];
  const page1Result = { name: 'Data Engineer', refs: { landing_page: 'https://www.themuse.com/jobs/acme/de' }, company: { name: 'Acme' }, locations: [] };
  const paginatedJobs = await themuse.fetch(
    { name: 'The Muse Board', provider: 'themuse' },
    {
      fetchJson: async (url, opts) => {
        paginationCalls.push(url);
        const page = parseInt(new URL(url).searchParams.get('page') ?? '0', 10);
        if (page === 0) return { results: [sampleResults[0]], page: 0, page_count: 2 };
        return { results: [page1Result], page: 1, page_count: 2 };
      },
    },
  );
  if (paginationCalls.length === 2 &&
      paginationCalls[0] === 'https://www.themuse.com/api/public/jobs?page=0' &&
      paginationCalls[1] === 'https://www.themuse.com/api/public/jobs?page=1')
    pass('themuse.fetch() iterates all pages when page_count > 1');
  else fail(`themuse.fetch() pagination calls = ${JSON.stringify(paginationCalls)}`);

  if (paginatedJobs.length === 2 && paginatedJobs[1]?.title === 'Data Engineer')
    pass('themuse.fetch() aggregates results from all pages');
  else fail(`themuse.fetch() paginated results = ${JSON.stringify(paginatedJobs.map(j => j.title))}`);

  // page_count cap: a huge value must be clamped to 100, not cause unbounded requests.
  let cappedCalls = 0;
  await themuse.fetch(
    { name: 'X', provider: 'themuse' },
    { fetchJson: async () => { cappedCalls++; return { results: [], page: 0, page_count: 99999 }; } },
  );
  if (cappedCalls === 100) pass('themuse.fetch() clamps page_count to 100 (prevents unbounded requests)');
  else fail(`themuse.fetch() made ${cappedCalls} requests for page_count=99999 (expected 100)`);

  // Non-integer page_count must be ignored (NaN passes typeof==='number' but not Number.isInteger).
  let nonIntCalls = 0;
  await themuse.fetch(
    { name: 'X', provider: 'themuse' },
    { fetchJson: async () => { nonIntCalls++; return { results: [], page: 0, page_count: 1.5 }; } },
  );
  if (nonIntCalls === 1) pass('themuse.fetch() ignores non-integer page_count (fetches only page 0)');
  else fail(`themuse.fetch() made ${nonIntCalls} requests for page_count=1.5 (expected 1)`);

  let badResponseThrew = false;
  try {
    await themuse.fetch(
      { name: 'X', provider: 'themuse' },
      { fetchJson: async () => ({ wrong: true }) },
    );
  } catch (e) {
    badResponseThrew = /unexpected API response/.test(e.message);
  }
  if (badResponseThrew) pass('themuse.fetch() throws on unexpected API response shape');
  else fail('themuse.fetch() should throw when results array is absent');

} catch (e) {
  fail(`themuse provider tests crashed: ${e.message}`);
}

