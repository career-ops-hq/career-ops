// tests/providers/prevueaps.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — prevueaps');

try {
  const prevueapsModule = await import(pathToFileURL(join(ROOT, 'providers/prevueaps.mjs')).href);
  const prevueaps = prevueapsModule.default;
  const { parsePrevueapsResponse, extractDomainId } = prevueapsModule;

  if (prevueaps.id === 'prevueaps') pass('prevueaps.id is "prevueaps"');
  else fail(`prevueaps.id is ${JSON.stringify(prevueaps.id)}`);

  // ── detect() ──
  const hit = prevueaps.detect({ name: 'ExampleCo', careers_url: 'https://examplecoca.prevueaps.ca/jobs/' });
  if (hit && hit.url === 'https://examplecoca.prevueaps.ca/jobs/') {
    pass('prevueaps.detect() resolves <tenant>.prevueaps.ca → /jobs/');
  } else {
    fail(`prevueaps.detect() returned ${JSON.stringify(hit)}`);
  }

  if (prevueaps.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('prevueaps.detect() returns null for non-prevueaps URLs');
  } else {
    fail('prevueaps.detect() should return null for non-prevueaps URLs');
  }

  if (prevueaps.detect({ name: 'X', careers_url: null }) === null && prevueaps.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('prevueaps.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('prevueaps.detect() should treat non-string careers_url as missing');
  }

  if (prevueaps.detect(null) === null && prevueaps.detect(undefined) === null) {
    pass('prevueaps.detect() returns null for a null/undefined entry (no throw)');
  } else {
    fail('prevueaps.detect() should return null for a null/undefined entry');
  }

  // SSRF: prevueaps.ca appearing in the PATH (not host) must not be detected.
  if (prevueaps.detect({ name: 'Spoof', careers_url: 'https://evil.example/examplecoca.prevueaps.ca/foo' }) === null) {
    pass('prevueaps.detect() rejects path-spoofed URLs');
  } else {
    fail('prevueaps.detect() must NOT misdetect path-spoofed URLs');
  }

  if (prevueaps.detect({ name: 'X', careers_url: 'http://examplecoca.prevueaps.ca/jobs/' }) === null) {
    pass('prevueaps.detect() rejects non-https URLs');
  } else {
    fail('prevueaps.detect() must reject non-https URLs');
  }

  if (prevueaps.detect({ name: 'X', careers_url: 'not a url' }) === null) {
    pass('prevueaps.detect() returns null for malformed URLs (no throw)');
  } else {
    fail('prevueaps.detect() should return null for malformed URLs');
  }

  // ── extractDomainId() ──
  const htmlWithApiPath = '<script>fetch("/core/jobs/889?getParams=%7B%7D")</script>';
  if (extractDomainId(htmlWithApiPath) === '889') {
    pass('extractDomainId() finds a literal /core/jobs/<digits> path');
  } else {
    fail(`extractDomainId() (api path) returned ${JSON.stringify(extractDomainId(htmlWithApiPath))}`);
  }

  const htmlWithDataAttr = '<div data-domain-id="813" id="jobs-widget"></div>';
  if (extractDomainId(htmlWithDataAttr) === '813') {
    pass('extractDomainId() falls back to data-domain-id attribute');
  } else {
    fail(`extractDomainId() (data attr) returned ${JSON.stringify(extractDomainId(htmlWithDataAttr))}`);
  }

  const htmlWithDomainIdVar = '<script>var config = { domainId: 1024, showDate: true };</script>';
  if (extractDomainId(htmlWithDomainIdVar) === '1024') {
    pass('extractDomainId() falls back to a domainId JS identifier');
  } else {
    fail(`extractDomainId() (domainId var) returned ${JSON.stringify(extractDomainId(htmlWithDomainIdVar))}`);
  }

  const htmlWithSiteIdVar = '<script>window.siteId = "42";</script>';
  if (extractDomainId(htmlWithSiteIdVar) === '42') {
    pass('extractDomainId() falls back to a siteId JS identifier');
  } else {
    fail(`extractDomainId() (siteId var) returned ${JSON.stringify(extractDomainId(htmlWithSiteIdVar))}`);
  }

  if (extractDomainId('<html><body>No jobs widget here</body></html>') === null) {
    pass('extractDomainId() returns null when no pattern matches');
  } else {
    fail('extractDomainId() should return null for unrecognized markup');
  }

  if (extractDomainId(null) === null && extractDomainId(undefined) === null && extractDomainId('') === null) {
    pass('extractDomainId() returns null for null/undefined/empty input (no throw)');
  } else {
    fail('extractDomainId() should return null for null/undefined/empty input');
  }

  // ── parsePrevueapsResponse() — real observed shape (tbca.prevueaps.ca) ──
  const realShape = {
    success: true,
    data: {
      jobs: [
        {
          id: 31380,
          title: 'Accounting & Finance Assistant Manager',
          city: 'Woodstock',
          subdomain: 'tbca',
          iso3: 'CAN',
          abbreviation: 'ON',
          classification: 'Finance',
          siteId: 889,
          startDateRef: 'Aug 17, 2026',
          endDateRef: 'Aug 17, 2031',
          untilFilled: 1,
          orgTitle: 'Woodstock',
          parentTitle: null,
          domainName: 'prevueaps.ca',
          stateName: 'Ontario',
          workplaceType: 'Onsite',
          employmentType: 'Full Time',
          jobCategory: null,
          customCategory: null,
          payRate: '',
          payType: 'Salary',
          payTypeFrame: 'per year',
          payDetails: '',
          minSalary: '91,000',
          maxSalary: '136,500',
          jobLocation: 'Woodstock, ON, Canada',
          streetAddress: '',
          chatToApplyEnabled: '0',
          jobUrl: 'https://tbca.prevueaps.ca/jobs/31380',
        },
      ],
      jobCount: 1,
      displayText: '<p>Below is a list...</p>',
    },
  };
  const jobs = parsePrevueapsResponse(realShape, 'ExampleCo');
  if (jobs.length === 1) pass('parsePrevueapsResponse extracts 1 job from the real observed shape');
  else fail(`parsePrevueapsResponse returned ${jobs.length} jobs`);

  if (jobs[0]?.title === 'Accounting & Finance Assistant Manager' && jobs[0]?.company === 'ExampleCo' && jobs[0]?.url === 'https://tbca.prevueaps.ca/jobs/31380') {
    pass('parsePrevueapsResponse maps title/company/url correctly');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.location === 'Woodstock, ON, Canada') {
    pass('parsePrevueapsResponse uses the explicit jobLocation field');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}`);
  }

  if (typeof jobs[0]?.description === 'string' && /Full Time/.test(jobs[0].description) && /91,000/.test(jobs[0].description)) {
    pass('parsePrevueapsResponse folds employmentType + salary range into description');
  } else {
    fail(`row 0 description = ${JSON.stringify(jobs[0]?.description)}`);
  }

  // ── Zero-jobs response ──
  const zeroJobsShape = { success: true, message: 'No job found', data: { jobs: [], jobCount: 0 } };
  if (parsePrevueapsResponse(zeroJobsShape, 'X').length === 0) {
    pass('parsePrevueapsResponse handles the zero-jobs shape → []');
  } else {
    fail('zero-jobs response should yield an empty array');
  }

  // ── Malformed / missing envelope — must throw, never silently → [] ──
  // Only a genuinely valid envelope with `data.jobs` as an array (including
  // an empty array — the real "no job found" shape) may return [] cleanly.
  // Anything that doesn't match that shape at all (missing `data`, missing
  // `jobs`, or `jobs` present but not an array) is a malformed/unexpected
  // API response and must surface as a descriptive error.
  try {
    parsePrevueapsResponse({}, 'X');
    fail('empty {} should throw (malformed envelope), not return []');
  } catch (e) {
    if (/unexpected response shape for X/.test(e.message)) {
      pass('empty {} throws a descriptive error');
    } else {
      fail(`empty {} threw the wrong error: ${e.message}`);
    }
  }

  try {
    parsePrevueapsResponse({ data: { jobs: null } }, 'X');
    fail('null jobs should throw (malformed envelope), not return []');
  } catch (e) {
    if (/unexpected response shape for X/.test(e.message)) {
      pass('null jobs throws a descriptive error');
    } else {
      fail(`null jobs threw the wrong error: ${e.message}`);
    }
  }

  try {
    parsePrevueapsResponse(null, 'X');
    fail('null response should throw (malformed envelope), not return []');
  } catch (e) {
    if (/unexpected response shape for X/.test(e.message)) {
      pass('null response throws a descriptive error');
    } else {
      fail(`null response threw the wrong error: ${e.message}`);
    }
  }

  try {
    parsePrevueapsResponse(undefined, 'X');
    fail('undefined response should throw (malformed envelope), not return []');
  } catch (e) {
    if (/unexpected response shape for X/.test(e.message)) {
      pass('undefined response throws a descriptive error');
    } else {
      fail(`undefined response threw the wrong error: ${e.message}`);
    }
  }

  // The real, documented zero-openings shape must still return [] cleanly —
  // covered again here alongside the malformed-envelope cases for contrast.
  if (parsePrevueapsResponse({ success: true, message: 'No job found', data: { jobs: [], jobCount: 0 } }, 'X').length === 0) {
    pass('a valid envelope with jobs: [] still returns [] cleanly (not an error)');
  } else {
    fail('a valid empty-jobs envelope should return [] without throwing');
  }

  const malformedRows = parsePrevueapsResponse(
    {
      data: {
        jobs: [
          { title: 'No URL' },
          { title: 'Insecure URL', jobUrl: 'http://tbca.prevueaps.ca/jobs/1' },
          { title: 'Malformed URL', jobUrl: 'not a url' },
          { jobUrl: 'https://tbca.prevueaps.ca/jobs/2' }, // no title
          { title: '', jobUrl: 'https://tbca.prevueaps.ca/jobs/4' }, // empty title
          { title: '   ', jobUrl: 'https://tbca.prevueaps.ca/jobs/5' }, // whitespace-only title
          { title: 42, jobUrl: 'https://tbca.prevueaps.ca/jobs/6' }, // non-string title
          { title: 'Good row', jobUrl: 'https://tbca.prevueaps.ca/jobs/3', city: 'Toronto', abbreviation: 'ON' },
        ],
      },
    },
    'X',
  );
  if (malformedRows.length === 1 && malformedRows[0]?.title === 'Good row') {
    pass('parsePrevueapsResponse filters rows missing title/url, non-https/malformed url, or empty/whitespace/non-string title');
  } else {
    fail(`malformedRows = ${JSON.stringify(malformedRows)}`);
  }

  const trimmedTitleRows = parsePrevueapsResponse(
    {
      data: {
        jobs: [
          { title: '  Padded Title  ', jobUrl: 'https://tbca.prevueaps.ca/jobs/7' },
        ],
      },
    },
    'X',
  );
  if (trimmedTitleRows[0]?.title === 'Padded Title') {
    pass('parsePrevueapsResponse trims surrounding whitespace from title');
  } else {
    fail(`trimmed title = ${JSON.stringify(trimmedTitleRows[0]?.title)}`);
  }

  if (malformedRows[0]?.location === 'Toronto, ON') {
    pass('parsePrevueapsResponse assembles location from city/abbreviation when jobLocation is absent');
  } else {
    fail(`assembled location = ${JSON.stringify(malformedRows[0]?.location)}`);
  }

  // ── fetch() — resolves domainId, hits the API with redirect:'error' ──
  let fetchTextUrl = null;
  let fetchTextOpts = null;
  let fetchJsonUrl = null;
  let fetchJsonOpts = null;
  const fetchJobs = await prevueaps.fetch(
    { name: 'ExampleCo', careers_url: 'https://examplecoca.prevueaps.ca/jobs/' },
    {
      fetchText: async (url, opts) => {
        fetchTextUrl = url;
        fetchTextOpts = opts;
        return '<script>fetch("/core/jobs/889?getParams=%7B%7D")</script>';
      },
      fetchJson: async (url, opts) => {
        fetchJsonUrl = url;
        fetchJsonOpts = opts;
        return { data: { jobs: [{ title: 'Good Job', jobUrl: 'https://examplecoca.prevueaps.ca/jobs/1' }] } };
      },
    },
  );
  if (fetchTextUrl === 'https://examplecoca.prevueaps.ca/jobs/' && fetchTextOpts?.redirect === 'error') {
    pass('prevueaps.fetch() fetches the tenant /jobs/ page with redirect:"error"');
  } else {
    fail(`fetchText call: url=${JSON.stringify(fetchTextUrl)} opts=${JSON.stringify(fetchTextOpts)}`);
  }
  if (fetchJsonUrl === 'https://examplecoca.prevueaps.ca/core/jobs/889?getParams=%7B%22showDate%22%3Atrue%2C%22showLocation%22%3Atrue%2C%22showEmploymentType%22%3Atrue%2C%22showCategory%22%3Atrue%2C%22showClassification%22%3Atrue%2C%22showWorkplaceType%22%3Atrue%2C%22customCategoryTitle%22%3A%22%22%7D'
    && fetchJsonOpts?.redirect === 'error' && fetchJobs.length === 1) {
    pass('prevueaps.fetch() resolves domainId and hits /core/jobs/{id} with redirect:"error"');
  } else {
    fail(`fetchJson call: url=${JSON.stringify(fetchJsonUrl)} opts=${JSON.stringify(fetchJsonOpts)} jobs=${fetchJobs.length}`);
  }

  // fetch() refuses entries whose careers_url can't derive a trusted origin —
  // the guard chain must run before any request.
  try {
    await prevueaps.fetch(
      { name: 'Evil', careers_url: 'https://evil.example.com/careers' },
      {
        fetchText: async () => { throw new Error('must not be called'); },
        fetchJson: async () => { throw new Error('must not be called'); },
      },
    );
    fail('prevueaps.fetch() should throw for an untrusted careers_url');
  } catch (e) {
    if (/cannot derive tenant origin for Evil/.test(e.message)) {
      pass('prevueaps.fetch() throws before fetching when the host is untrusted');
    } else {
      fail(`prevueaps.fetch() threw the wrong error: ${e.message}`);
    }
  }

  // fetch() throws a descriptive error when domainId cannot be resolved from
  // the /jobs/ page (a real API-shape change, not a malformed job row).
  try {
    await prevueaps.fetch(
      { name: 'NoDomainId', careers_url: 'https://examplecoca.prevueaps.ca/jobs/' },
      {
        fetchText: async () => '<html><body>nothing recognizable here</body></html>',
        fetchJson: async () => { throw new Error('must not be called'); },
      },
    );
    fail('prevueaps.fetch() should throw when domainId cannot be resolved');
  } catch (e) {
    if (/could not resolve domainId for NoDomainId/.test(e.message)) {
      pass('prevueaps.fetch() throws a descriptive error when domainId resolution fails');
    } else {
      fail(`prevueaps.fetch() threw the wrong error: ${e.message}`);
    }
  }

} catch (e) {
  fail(`prevueaps provider tests crashed: ${e.message}`);
}
