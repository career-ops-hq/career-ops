// tests/providers/landingjobs.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — landingjobs');

try {
  const ljModule = await import(pathToFileURL(join(ROOT, 'providers/landingjobs.mjs')).href);
  const landingjobs = ljModule.default;
  const { normalizeLandingJob, companyFromUrl } = ljModule;

  if (landingjobs.id === 'landingjobs') pass('landingjobs.id is "landingjobs"');
  else fail(`landingjobs.id is ${JSON.stringify(landingjobs.id)}`);

  // companyFromUrl — humanizes the /at/<slug>/ segment; '' for other shapes.
  if (companyFromUrl('https://landing.jobs/at/damia-group-portugal/some-job') === 'Damia Group Portugal'
      && companyFromUrl('https://landing.jobs/at/inscale/x') === 'Inscale'
      && companyFromUrl('https://landing.jobs/jobs/123') === ''
      && companyFromUrl('not a url') === '') {
    pass('companyFromUrl humanizes the /at/<slug>/ segment and returns "" for other shapes');
  } else {
    fail(`companyFromUrl = ${JSON.stringify([
      companyFromUrl('https://landing.jobs/at/damia-group-portugal/some-job'),
      companyFromUrl('https://landing.jobs/jobs/123'),
    ])}`);
  }

  // normalizeLandingJob — full mapping.
  const full = normalizeLandingJob(
    { title: '  Senior Java Dev  ', url: 'https://landing.jobs/at/inscale/senior-java-dev', locations: [{ city: 'Lisbon', country_code: 'PT' }], remote: false, published_at: '2025-02-26T09:38:38.127Z' },
    'Fallback',
  );
  if (full && full.title === 'Senior Java Dev' && full.url === 'https://landing.jobs/at/inscale/senior-java-dev'
      && full.company === 'Inscale' && full.location === 'Lisbon, PT'
      && full.postedAt === Date.parse('2025-02-26T09:38:38.127Z')) {
    pass('normalizeLandingJob maps title/url, derives company from slug, builds location, parses published_at');
  } else {
    fail(`normalizeLandingJob full row = ${JSON.stringify(full)}`);
  }

  // remote:true appends "Remote".
  const remoteJob = normalizeLandingJob({ title: 'R', url: 'https://landing.jobs/at/acme/r', locations: [{ city: 'Berlin', country_code: 'DE' }], remote: true });
  if (remoteJob?.location === 'Berlin, DE, Remote') pass('normalizeLandingJob appends "Remote" when remote is true');
  else fail(`normalizeLandingJob remote location = ${JSON.stringify(remoteJob?.location)}`);

  // company fallback: url is landing.jobs but not /at/<slug>/ → entry name, then "Landing.jobs".
  const coEntry = normalizeLandingJob({ title: 'T', url: 'https://landing.jobs/jobs/99' }, 'Entry Name');
  const coDefault = normalizeLandingJob({ title: 'T', url: 'https://landing.jobs/jobs/100' });
  const coBlank = normalizeLandingJob({ title: 'T', url: 'https://landing.jobs/jobs/101' }, '   '); // whitespace-only → "Landing.jobs"
  if (coEntry?.company === 'Entry Name' && coDefault?.company === 'Landing.jobs' && coBlank?.company === 'Landing.jobs') {
    pass('normalizeLandingJob falls back company → entry name → "Landing.jobs" (whitespace-only entry name ignored)');
  } else {
    fail(`normalizeLandingJob company fallbacks = ${JSON.stringify({ a: coEntry?.company, b: coDefault?.company, c: coBlank?.company })}`);
  }

  // postedAt falls back to created_at; omitted when both absent.
  const fromCreated = normalizeLandingJob({ title: 'T', url: 'https://landing.jobs/at/acme/cd', created_at: '2025-02-26T08:53:02.254Z' });
  const noDate = normalizeLandingJob({ title: 'T', url: 'https://landing.jobs/at/acme/nd' });
  if (fromCreated?.postedAt === Date.parse('2025-02-26T08:53:02.254Z') && noDate && !('postedAt' in noDate)) {
    pass('normalizeLandingJob falls back to created_at and omits postedAt when both dates are absent');
  } else {
    fail(`normalizeLandingJob date handling = ${JSON.stringify({ created: fromCreated?.postedAt, none: noDate })}`);
  }

  // host-lock + drops: off-host, non-https, missing url, empty title, non-object.
  const drops = [
    normalizeLandingJob({ title: 'Off host', url: 'https://evil.example/at/acme/x' }),
    normalizeLandingJob({ title: 'Insecure', url: 'http://landing.jobs/at/acme/x' }),
    normalizeLandingJob({ title: 'No URL' }),
    normalizeLandingJob({ title: '', url: 'https://landing.jobs/at/acme/x' }),
    normalizeLandingJob(null),
  ];
  if (drops.every(r => r === null)) {
    pass('normalizeLandingJob host-locks url to landing.jobs and drops off-host/non-https/no-url/empty-title/non-object');
  } else {
    fail(`normalizeLandingJob drops = ${JSON.stringify(drops)}`);
  }

  // fetch(): single call to the feed URL, normalized, with the SSRF guard.
  const sample = [
    { title: 'Role A', url: 'https://landing.jobs/at/acme/role-a', locations: [{ city: 'Porto', country_code: 'PT' }], remote: false, published_at: '2025-02-26T09:38:38.127Z' },
    { title: '', url: 'https://landing.jobs/at/acme/bad' }, // dropped: empty title
  ];
  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await landingjobs.fetch(
    { name: 'Landing.jobs' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://landing.jobs/api/v1/jobs') pass('landingjobs.fetch() requests the v1 feed URL');
  else fail(`landingjobs.fetch() requested ${JSON.stringify(capturedUrl)}`);

  if (capturedOpts && capturedOpts.redirect === 'error') pass('landingjobs.fetch() passes redirect:"error" (SSRF guard)');
  else fail(`landingjobs.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);

  if (fetched.length === 1 && fetched[0]?.company === 'Acme') {
    pass('landingjobs.fetch() returns normalized jobs (drops the empty-title row, derives company)');
  } else {
    fail(`landingjobs.fetch() returned ${fetched.length} jobs, row 0 = ${JSON.stringify(fetched[0])}`);
  }

  // unexpected (non-array) response → throws.
  let badThrew = false;
  try {
    await landingjobs.fetch({ name: 'X' }, { fetchJson: async () => ({ jobs: [] }) });
  } catch (e) {
    badThrew = /unexpected API response/.test(e.message);
  }
  if (badThrew) pass('landingjobs.fetch() throws on a non-array API response');
  else fail('landingjobs.fetch() should throw when the response is not an array');

} catch (e) {
  fail(`landingjobs provider tests crashed: ${e.message}`);
}
