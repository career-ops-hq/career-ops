// tests/providers/glints.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — glints');


try {
  const glintsModule = await import(pathToFileURL(join(ROOT, 'providers/glints.mjs')).href);
  const glints = glintsModule.default;
  const { parseGlintsItem } = glintsModule;

  // id check
  if (glints.id === 'glints') pass('glints.id is "glints"');
  else fail(`glints.id is ${JSON.stringify(glints.id)}`);

  // detect() always returns null (job board, not ATS)
  if (glints.detect({ name: 'X', careers_url: 'https://glints.com/id/jobs' }) === null) {
    pass('glints.detect() returns null — explicit provider only, no URL auto-detection');
  } else {
    fail('glints.detect() should return null for any URL');
  }

  // parseGlintsItem — valid item (new searchJobsV3 shape)
  const sampleItem = {
    id: 'abc123',
    title: 'Backend Engineer',
    company: { name: 'StartupCorp', brandName: 'StartupCorp Brand' },
    city: { name: 'Jakarta, Indonesia' },
    country: { code: 'ID', name: 'Indonesia' },
    createdAt: '2026-06-10T00:00:00Z',
  };
  const parsed = parseGlintsItem(sampleItem, 'https://glints.com', 'FallbackCo');
  if (parsed && parsed.title === 'Backend Engineer'
      && parsed.url === 'https://glints.com/id/opportunities/jobs/abc123'
      && parsed.company === 'StartupCorp'
      && parsed.location === 'Jakarta, Indonesia'
      && parsed.postedAt != null) {
    pass('parseGlintsItem extracts title, url, company, location, postedAt correctly');
  } else {
    fail(`parseGlintsItem returned ${JSON.stringify(parsed)}`);
  }

  // parseGlintsItem — uses brandName when name is absent
  const brandItem = {
    id: 'def456',
    title: 'Data Scientist',
    company: { brandName: 'BrandCorp' },
    city: { name: 'Singapore' },
    createdAt: '2026-06-15T00:00:00Z',
  };
  const brandParsed = parseGlintsItem(brandItem, 'https://glints.com', 'FallbackCo');
  if (brandParsed && brandParsed.company === 'BrandCorp') {
    pass('parseGlintsItem falls back to brandName when company.name is missing');
  } else {
    fail(`parseGlintsItem brandName fallback: ${JSON.stringify(brandParsed)}`);
  }

  // parseGlintsItem — rejects items without title
  if (parseGlintsItem({ id: '1' }, 'https://glints.com', 'Co') === null) {
    pass('parseGlintsItem returns null for title-less items');
  } else {
    fail('parseGlintsItem should return null for items without title');
  }

  // parseGlintsItem — rejects items without id (URL cannot be built)
  if (parseGlintsItem({ title: 'Role' }, 'https://glints.com', 'Co') === null) {
    pass('parseGlintsItem returns null for items without id');
  } else {
    fail('parseGlintsItem should return null for items without id');
  }

  // parseGlintsItem — rejects off-domain via URL validation
  const offDomain = parseGlintsItem(
    { id: '1', title: 'Role' },
    'https://evil.example.com', 'Co'
  );
  if (offDomain === null) pass('parseGlintsItem rejects off-domain base URLs');
  else fail(`parseGlintsItem should reject off-domain base URLs, got ${JSON.stringify(offDomain)}`);

  // parseGlintsItem — handles null/malformed input
  if (parseGlintsItem(null, 'https://glints.com', 'Co') === null) pass('parseGlintsItem(null) → null');
  else fail('parseGlintsItem(null) should return null');
  if (parseGlintsItem(42, 'https://glints.com', 'Co') === null) pass('parseGlintsItem(number) → null');
  else fail('parseGlintsItem(number) should return null');

  // parseGlintsItem — fallback company when both company.name and brandName are missing
  const noCompany = parseGlintsItem(
    { id: '99', title: 'Engineer' },
    'https://glints.com', 'PortalName'
  );
  if (noCompany && noCompany.company === 'PortalName') {
    pass('parseGlintsItem uses fallback company when company info is absent');
  } else {
    fail(`parseGlintsItem fallback company: ${JSON.stringify(noCompany)}`);
  }

  // parseGlintsItem — parseGlintsItem allows www.glints.com subdomain via baseUrl
  const wwwItem = parseGlintsItem(
    { id: 'x', title: 'Role' },
    'https://www.glints.com', 'Co'
  );
  if (wwwItem && wwwItem.url.startsWith('https://www.glints.com/')) {
    pass('parseGlintsItem accepts www.glints.com base URL (subdomain)');
  } else {
    fail(`parseGlintsItem www subdomain: ${JSON.stringify(wwwItem)}`);
  }

  // fetch() — happy path with mock context (searchJobsV3 response shape)
  const mockCtx = {
    transport: 'http',
    fetchJson: async (url, opts) => {
      if (opts?.method !== 'POST') throw new Error('Expected POST');
      const body = JSON.parse(opts.body || '{}');
      if (!body.query) throw new Error('Expected GraphQL query');
      if (body.operationName !== 'searchJobsV3') throw new Error('Expected searchJobsV3 operation');
      return {
        data: {
          searchJobsV3: {
            jobsInPage: [
              {
                id: 'job1',
                title: 'AI PM',
                company: { name: 'TechCo', brandName: 'TechCo Brand' },
                city: { name: 'Remote' },
                country: { code: 'ID', name: 'Indonesia' },
                salaries: [],
                createdAt: '2026-01-01T00:00:00Z',
              },
            ],
            expInfo: null,
            hasMore: false,
          },
        },
      };
    },
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const jobs = await glints.fetch(
    { name: 'Glints ID', provider: 'glints', searchKeywords: 'AI' },
    mockCtx,
  );
  if (jobs.length === 1 && jobs[0].title === 'AI PM') pass('glints.fetch() returns parsed jobs via searchJobsV3');
  else fail(`glints.fetch() returned ${JSON.stringify(jobs)}`);

  // fetch() — handles empty results
  const emptyCtx = {
    transport: 'http',
    fetchJson: async () => ({ data: { searchJobsV3: { jobsInPage: [], hasMore: false } } }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const emptyJobs = await glints.fetch(
    { name: 'Glints ID', provider: 'glints', searchKeywords: 'nonexistent' },
    emptyCtx,
  );
  if (emptyJobs.length === 0) pass('glints.fetch() handles empty results');
  else fail(`glints.fetch() should return empty array for no results, got ${emptyJobs.length}`);

  // fetch() — stops when hasMore is false (single page)
  const singlePageCtx = {
    transport: 'http',
    fetchJson: async () => ({ data: { searchJobsV3: { jobsInPage: [{ id: '1', title: 'Dev' }], hasMore: false } } }),
    fetchText: async () => { throw new Error('should not be called'); },
  };
  const singleJobs = await glints.fetch(
    { name: 'Glints ID', provider: 'glints', searchKeywords: 'dev' },
    singlePageCtx,
  );
  if (singleJobs.length === 1) pass('glints.fetch() stops when hasMore is false');
  else fail(`glints.fetch() single page: ${JSON.stringify(singleJobs)}`);

  // fetch() — rejects invalid hostname
  let hostRejected = false;
  try {
    await glints.fetch(
      { name: 'Bad', provider: 'glints', api: 'https://evil.example.com/graphql' },
      { transport: 'http', fetchJson: async () => ({}), fetchText: async () => '' },
    );
  } catch (e) {
    if (e.message.includes('untrusted hostname')) hostRejected = true;
    else fail(`glints.fetch() host rejection wrong error: ${e.message}`);
  }
  if (hostRejected) pass('glints.fetch() rejects untrusted hostnames');
  else fail('glints.fetch() should reject non-glints hostnames');

  // fetch() — throws on missing searchJobsV3 in response
  let missingThrew = false;
  try {
    await glints.fetch(
      { name: 'Glints ID', provider: 'glints', searchKeywords: 'test' },
      {
        transport: 'http',
        fetchJson: async () => ({ data: { somethingElse: [] } }),
        fetchText: async () => { throw new Error('should not be called'); },
      },
    );
  } catch (e) {
    if (e.message.includes('unexpected API response')) missingThrew = true;
    else fail(`glints.fetch() missing searchJobsV3 wrong error: ${e.message}`);
  }
  if (missingThrew) pass('glints.fetch() throws on unexpected API response shape');
  else fail('glints.fetch() should throw when searchJobsV3 is missing');

} catch (e) {
  fail(`glints provider tests crashed: ${e.message}`);
}

