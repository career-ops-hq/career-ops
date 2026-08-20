import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jsearch');

try {
  const jsearchModule = await import(pathToFileURL(join(ROOT, 'providers/jsearch.mjs')).href);
  const jsearch = jsearchModule.default;
  const { parseJSearchResponse } = jsearchModule;

  if (jsearch.id === 'jsearch') pass('jsearch.id is "jsearch"');
  else fail(`jsearch.id is ${JSON.stringify(jsearch.id)}`);

  const hit = jsearch.detect({ name: 'JSearch', provider: 'jsearch' });
  if (hit && hit.url.includes('jsearch.p.rapidapi.com')) {
    pass('jsearch.detect() claims explicit provider config');
  } else {
    fail(`jsearch.detect() returned ${JSON.stringify(hit)}`);
  }

  if (jsearch.detect({ name: 'Other', provider: 'other' }) === null) {
    pass('jsearch.detect() ignores other provider ids');
  } else {
    fail('jsearch.detect() should only claim provider: jsearch');
  }

  const sample = {
    status: 'OK',
    data: [
      {
        job_id: 'js101',
        job_title: 'Full Stack Engineer',
        employer_name: 'Acme Corp',
        job_apply_link: 'https://example.com/jobs/js101',
        job_description: 'Building React and Node applications',
        job_city: 'Bengaluru',
        job_state: 'Karnataka',
        job_country: 'IN',
        job_is_remote: true,
        job_posted_at_datetime_utc: '2026-08-12T09:00:00.000Z'
      },
      {
        job_id: 'js102',
        job_title: 'DevOps Specialist',
        employer_name: 'CloudWorks',
        job_google_link: 'https://google.com/jobs/js102',
        job_city: 'Austin',
        job_state: 'TX',
        job_country: 'US',
        job_is_remote: false,
        job_posted_at_timestamp: 1723456789
      },
      {
        job_id: 'js103',
        job_title: 'No URL Role',
      },
      {
        job_id: 'js104',
        job_title: '',
        job_apply_link: 'https://example.com/jobs/js104'
      }
    ]
  };

  const jobs = parseJSearchResponse(sample, 'JSearch');

  if (jobs.length === 2) pass('parseJSearchResponse keeps 2 valid jobs');
  else fail(`parseJSearchResponse returned ${jobs.length} jobs (expected 2)`);

  if (jobs[0]?.company === 'Acme Corp' && jobs[0]?.title === 'Full Stack Engineer') {
    pass('parseJSearchResponse maps title & employer_name correctly');
  } else {
    fail(`row 0 title/company = ${JSON.stringify({ title: jobs[0]?.title, company: jobs[0]?.company })}`);
  }

  if (jobs[0]?.url === 'https://example.com/jobs/js101') {
    pass('parseJSearchResponse maps job_apply_link -> url');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.location === 'Remote (Bengaluru, Karnataka, IN)') {
    pass('parseJSearchResponse formats remote location correctly');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('2026-08-12T09:00:00.000Z')) {
    pass('parseJSearchResponse parses job_posted_at_datetime_utc -> postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  process.env.JSEARCH_API_KEY = 'test_jsearch_key';

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await jsearch.fetch(
    { name: 'JSearch Board', provider: 'jsearch', query: 'Full Stack' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl && capturedUrl.includes('jsearch.p.rapidapi.com') && capturedUrl.includes('query=Full%20Stack')) {
    pass('jsearch.fetch() constructs correct RapidAPI URL');
  } else {
    fail(`jsearch.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.headers && capturedOpts.headers['x-rapidapi-key'] === 'test_jsearch_key') {
    pass('jsearch.fetch() sets x-rapidapi-key header');
  } else {
    fail(`jsearch.fetch() headers = ${JSON.stringify(capturedOpts?.headers)}`);
  }

  if (fetched.length === 2 && fetched[0].company === 'Acme Corp') {
    pass('jsearch.fetch() returns normalized jobs');
  } else {
    fail(`jsearch.fetch() returned ${JSON.stringify(fetched)}`);
  }

  delete process.env.JSEARCH_API_KEY;

  const skipped = await jsearch.fetch(
    { name: 'JSearch Board', provider: 'jsearch' },
    { fetchJson: async () => sample }
  );
  if (Array.isArray(skipped) && skipped.length === 0) {
    pass('jsearch.fetch() gracefully returns [] when key is unset');
  } else {
    fail('jsearch.fetch() should return [] when key missing');
  }

} catch (e) {
  fail(`jsearch provider tests crashed: ${e.message}`);
}
