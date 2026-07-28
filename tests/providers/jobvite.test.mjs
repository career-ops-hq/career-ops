// tests/providers/jobvite.test.mjs — unit tests for the Jobvite provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — Jobvite');

try {
  const {
    default: jobvite,
    resolveCompanyId,
    parseJobviteResponse,
  } = await import(pathToFileURL(join(ROOT, 'providers/jobvite.mjs')).href);

  // id
  if (jobvite.id === 'jobvite') {
    pass('jobvite.id is "jobvite"');
  } else {
    fail(`jobvite.id is "${jobvite.id}"`);
  }

  // ── resolveCompanyId ───────────────────────────────────────────

  // careers_url bare slug
  if (resolveCompanyId({ careers_url: 'https://jobs.jobvite.com/stripe' }) === 'stripe') {
    pass('resolveCompanyId extracts slug from bare careers_url');
  } else {
    fail(`resolveCompanyId bare: ${resolveCompanyId({ careers_url: 'https://jobs.jobvite.com/stripe' })}`);
  }

  // careers_url with /jobs path
  if (resolveCompanyId({ careers_url: 'https://jobs.jobvite.com/stripe/jobs' }) === 'stripe') {
    pass('resolveCompanyId extracts slug from careers_url with /jobs suffix');
  } else {
    fail(`resolveCompanyId /jobs suffix: ${resolveCompanyId({ careers_url: 'https://jobs.jobvite.com/stripe/jobs' })}`);
  }

  // explicit api: URL takes precedence over careers_url
  const apiEntry = {
    api: 'https://jobs.jobvite.com/api/company/acme-corp/jobs',
    careers_url: 'https://jobs.jobvite.com/other',
  };
  if (resolveCompanyId(apiEntry) === 'acme-corp') {
    pass('resolveCompanyId prefers api: over careers_url');
  } else {
    fail(`resolveCompanyId api preference: ${resolveCompanyId(apiEntry)}`);
  }

  // null / wrong host / http / non-string
  if (resolveCompanyId({}) === null) {
    pass('resolveCompanyId returns null for empty entry');
  } else {
    fail('resolveCompanyId should return null for empty entry');
  }
  if (resolveCompanyId({ careers_url: 'https://evil.example.com/stripe' }) === null) {
    pass('resolveCompanyId returns null for wrong host');
  } else {
    fail('resolveCompanyId should return null for wrong host (SSRF guard)');
  }
  if (resolveCompanyId({ careers_url: 'http://jobs.jobvite.com/stripe' }) === null) {
    pass('resolveCompanyId returns null for non-https URL');
  } else {
    fail('resolveCompanyId should return null for non-https URL');
  }
  if (resolveCompanyId({ careers_url: null }) === null && resolveCompanyId({ careers_url: 42 }) === null) {
    pass('resolveCompanyId returns null for non-string careers_url');
  } else {
    fail('resolveCompanyId should return null for non-string careers_url');
  }

  // ── detect() ───────────────────────────────────────────────────

  const detectedUrl = jobvite.detect({ careers_url: 'https://jobs.jobvite.com/stripe' })?.url;
  if (detectedUrl === 'https://jobs.jobvite.com/api/company/stripe/jobs') {
    pass('jobvite.detect() builds correct API URL from careers_url');
  } else {
    fail(`jobvite.detect() url: ${JSON.stringify(detectedUrl)}`);
  }

  if (jobvite.detect({ careers_url: 'https://lever.co/stripe' }) === null) {
    pass('jobvite.detect() returns null for non-Jobvite careers_url');
  } else {
    fail('jobvite.detect() should return null for non-Jobvite URL');
  }

  if (jobvite.detect({}) === null) {
    pass('jobvite.detect() returns null for empty entry');
  } else {
    fail('jobvite.detect() should return null for empty entry');
  }

  // ── parseJobviteResponse ───────────────────────────────────────

  // 6 jobs in the fixture; 3 are dropped (no-title, non-https, missing URL).
  const SAMPLE_RESPONSE = {
    jobs: [
      {
        id: 'jv-1',
        title: 'Senior Software Engineer',
        location: 'San Francisco, CA',
        country: 'US',
        date: 'Mon, 02 Jun 2025 10:00:00 +0000',
        applyURL: 'https://jobs.jobvite.com/stripe/job/senior-swe',
        category: 'Engineering',
        jobType: 'Full-Time',
      },
      {
        id: 'jv-2',
        title: 'Product Manager',
        location: '',
        country: 'UK',
        date: 'Mon, 02 Jun 2025 11:00:00 +0000',
        applyURL: 'https://jobs.jobvite.com/stripe/job/pm',
      },
      {
        // no title — must be dropped
        id: 'jv-3',
        title: '',
        location: 'Remote',
        applyURL: 'https://jobs.jobvite.com/stripe/job/no-title',
      },
      {
        // non-https applyURL — must be dropped
        id: 'jv-4',
        title: 'Bad URL Role',
        location: 'Remote',
        applyURL: 'http://jobs.jobvite.com/stripe/job/bad-url',
      },
      {
        // missing applyURL — must be dropped
        id: 'jv-5',
        title: 'No URL Role',
        location: 'Remote',
      },
      {
        // branded domain applyURL — must be accepted (display-only, never fetched)
        id: 'jv-6',
        title: 'Branded Domain Role',
        location: 'New York, NY',
        country: 'US',
        date: 'Mon, 02 Jun 2025 12:00:00 +0000',
        applyURL: 'https://careers.stripe.com/jobs/branded-role',
      },
    ],
  };

  const jobs = parseJobviteResponse(SAMPLE_RESPONSE, 'Stripe');

  // count — dropped: no title, non-https URL, missing URL → 3 valid
  if (jobs.length === 3) {
    pass('parseJobviteResponse returns 3 jobs (drops no-title, non-https, missing URL)');
  } else {
    fail(`parseJobviteResponse count: ${jobs.length} (expected 3)`);
  }

  // job 0 — full field mapping
  if (jobs[0]?.title === 'Senior Software Engineer') {
    pass('parseJobviteResponse maps title correctly');
  } else {
    fail(`parseJobviteResponse title: ${JSON.stringify(jobs[0]?.title)}`);
  }
  if (jobs[0]?.url === 'https://jobs.jobvite.com/stripe/job/senior-swe') {
    pass('parseJobviteResponse maps applyURL to url');
  } else {
    fail(`parseJobviteResponse url: ${JSON.stringify(jobs[0]?.url)}`);
  }
  if (jobs[0]?.company === 'Stripe') {
    pass('parseJobviteResponse sets company from entry.name');
  } else {
    fail(`parseJobviteResponse company: ${JSON.stringify(jobs[0]?.company)}`);
  }
  if (jobs[0]?.location === 'San Francisco, CA') {
    pass('parseJobviteResponse maps location field');
  } else {
    fail(`parseJobviteResponse location: ${JSON.stringify(jobs[0]?.location)}`);
  }
  if (Number.isInteger(jobs[0]?.postedAt)) {
    pass('parseJobviteResponse parses date to postedAt epoch ms');
  } else {
    fail(`parseJobviteResponse postedAt: ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  // job 1 — location fallback to country when location is empty string
  if (jobs[1]?.location === 'UK') {
    pass('parseJobviteResponse falls back to country when location is empty');
  } else {
    fail(`parseJobviteResponse location fallback: ${JSON.stringify(jobs[1]?.location)}`);
  }

  // job 2 — branded domain applyURL accepted
  if (jobs[2]?.url === 'https://careers.stripe.com/jobs/branded-role') {
    pass('parseJobviteResponse accepts branded-domain applyURL (display-only)');
  } else {
    fail(`parseJobviteResponse branded URL: ${JSON.stringify(jobs[2]?.url)}`);
  }

  // null / bad input
  if (parseJobviteResponse(null, 'X').length === 0) {
    pass('parseJobviteResponse returns [] for null input');
  } else {
    fail('parseJobviteResponse should return [] for null input');
  }
  if (parseJobviteResponse({ jobs: 'not-an-array' }, 'X').length === 0) {
    pass('parseJobviteResponse returns [] when jobs field is not an array');
  } else {
    fail('parseJobviteResponse returns [] when jobs is not an array');
  }

  // ── fetch() integration ────────────────────────────────────────

  let capturedUrl = null;
  let capturedOpts = null;
  const mockCtx = {
    async fetchJson(url, opts) {
      capturedUrl = url;
      capturedOpts = opts;
      return SAMPLE_RESPONSE;
    },
  };

  const fetched = await jobvite.fetch(
    { name: 'Stripe', careers_url: 'https://jobs.jobvite.com/stripe' },
    mockCtx,
  );

  if (capturedUrl === 'https://jobs.jobvite.com/api/company/stripe/jobs') {
    pass('jobvite.fetch() requests the correct API URL');
  } else {
    fail(`jobvite.fetch() fetched: ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts?.redirect === 'error') {
    pass('jobvite.fetch() passes redirect:"error" to fetchJson');
  } else {
    fail(`jobvite.fetch() redirect option: ${JSON.stringify(capturedOpts?.redirect)}`);
  }

  if (fetched.length === 3) {
    pass('jobvite.fetch() returns normalized jobs array');
  } else {
    fail(`jobvite.fetch() returned ${fetched.length} jobs (expected 3)`);
  }

  // fetch() throws when company ID cannot be resolved
  let threw = false;
  try {
    await jobvite.fetch({ name: 'NoSlug' }, { async fetchJson() { return {}; } });
  } catch {
    threw = true;
  }
  if (threw) {
    pass('jobvite.fetch() throws when company ID cannot be resolved');
  } else {
    fail('jobvite.fetch() should throw when company ID is missing');
  }

} catch (e) {
  fail(`jobvite provider tests crashed: ${e.message}`);
}
