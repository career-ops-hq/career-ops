// tests/providers/usajobs.test.mjs — USAJobs provider: field mapping, credential
// gating and pagination, against a fixture shaped like the documented Search API
// response. No network: ctx.fetchJson is a stub.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — usajobs');

const mod = await import(pathToFileURL(join(ROOT, 'providers/usajobs.mjs')).href);
const provider = mod.default;
const { mapItem } = mod;

const item = {
  MatchedObjectId: '123456',
  MatchedObjectDescriptor: {
    PositionID: 'DE-2026-0001',
    PositionTitle: 'Data Science Intern',
    PositionURI: 'https://www.usajobs.gov/job/123456',
    OrganizationName: 'Department of Example',
    PositionLocation: [{ LocationName: 'Washington, District of Columbia' }],
    PublicationStartDate: '2026-10-01',
    QualificationSummary: 'Currently enrolled in a degree program.',
  },
};

if (provider.id === 'usajobs') pass('usajobs.id is "usajobs"');
else fail(`usajobs.id is ${JSON.stringify(provider.id)}`);

if (provider.detect === undefined) pass('usajobs has no detect(): explicit-only, never claims a URL');
else fail('usajobs must not define detect()');

const job = mapItem(item);
if (job?.title === 'Data Science Intern' && job.url === 'https://www.usajobs.gov/job/123456'
  && job.company === 'Department of Example' && job.location === 'Washington, District of Columbia'
  && job.requisitionId === 'DE-2026-0001' && Number.isFinite(job.postedAt)) {
  pass('mapItem maps title, public URL, agency, location, posting date and requisition id');
} else {
  fail(`mapItem produced ${JSON.stringify(job)}`);
}


// The live API returns the default port in PositionURI; it must still map.
const withPort = mapItem({ MatchedObjectDescriptor: { PositionTitle: 'Software Engineer', PositionURI: 'https://www.usajobs.gov:443/job/883691200' } });
if (withPort?.url === 'https://www.usajobs.gov/job/883691200') pass('mapItem accepts the :443 port the live API returns and strips it');
else fail(`mapItem with :443 produced ${JSON.stringify(withPort)}`);
if (mapItem({ MatchedObjectDescriptor: { PositionTitle: 'X', PositionURI: 'http://evil.example/job/1' } }) === null) {
  pass('mapItem drops items whose URL is not a usajobs.gov https link');
} else {
  fail('mapItem accepted a non-usajobs URL');
}

// Credential gating: no key or email means no request and an empty result.
const savedKey = process.env.USAJOBS_API_KEY;
const savedEmail = process.env.USAJOBS_CONTACT_EMAIL;
let calls = 0;
const ctxStub = { fetchJson: async () => { calls++; return { SearchResult: { SearchResultItems: [], SearchResultCountAll: 0 } }; } };

delete process.env.USAJOBS_API_KEY;
delete process.env.USAJOBS_CONTACT_EMAIL;
const withoutCreds = await provider.fetch({ name: 'USAJobs' }, ctxStub);
if (withoutCreds.length === 0 && calls === 0) pass('usajobs makes no request without credentials');
else fail(`usajobs made ${calls} request(s) without credentials`);

// Pagination and dedup across terms, with credentials set.
process.env.USAJOBS_API_KEY = 'test-key';
process.env.USAJOBS_CONTACT_EMAIL = 'test@example.invalid';
const seenHeaders = [];
const pagedCtx = {
  fetchJson: async (url, opts) => {
    seenHeaders.push(opts?.headers);
    const page = Number(new URL(url).searchParams.get('Page'));
    if (page === 1) {
      const items = Array.from({ length: 500 }, (_, i) => ({
        MatchedObjectDescriptor: { PositionTitle: `Intern ${i}`, PositionURI: `https://www.usajobs.gov/job/${i}` },
      }));
      return { SearchResult: { SearchResultItems: items, SearchResultCountAll: 501 } };
    }
    return { SearchResult: { SearchResultItems: [item], SearchResultCountAll: 501 } };
  },
  sleep: async () => {},
};
const paged = await provider.fetch({ name: 'USAJobs', search_terms: ['data science intern'] }, pagedCtx);
if (paged.length === 501) pass('usajobs follows pages until the reported total is reached');
else fail(`usajobs returned ${paged.length} jobs, expected 501`);

if (seenHeaders.every((h) => h['Authorization-Key'] === 'test-key' && h['User-Agent'] === 'test@example.invalid')) {
  pass('usajobs sends the key in Authorization-Key and the contact email in User-Agent');
} else {
  fail(`usajobs headers were ${JSON.stringify(seenHeaders[0])}`);
}

if (savedKey === undefined) delete process.env.USAJOBS_API_KEY; else process.env.USAJOBS_API_KEY = savedKey;
if (savedEmail === undefined) delete process.env.USAJOBS_CONTACT_EMAIL; else process.env.USAJOBS_CONTACT_EMAIL = savedEmail;
