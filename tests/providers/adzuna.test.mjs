import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — adzuna');

try {
  const adzunaModule = await import(pathToFileURL(join(ROOT, 'providers/adzuna.mjs')).href);
  const adzuna = adzunaModule.default;
  const { parseAdzunaResponse } = adzunaModule;

  if (adzuna.id === 'adzuna') pass('adzuna.id is "adzuna"');
  else fail(`adzuna.id is ${JSON.stringify(adzuna.id)}`);

  const hit = adzuna.detect({ name: 'Adzuna', provider: 'adzuna' });
  if (hit && hit.url === 'https://api.adzuna.com') {
    pass('adzuna.detect() claims explicit provider config');
  } else {
    fail(`adzuna.detect() returned ${JSON.stringify(hit)}`);
  }

  if (adzuna.detect({ name: 'Other', provider: 'other' }) === null) {
    pass('adzuna.detect() ignores other provider ids');
  } else {
    fail('adzuna.detect() should only claim provider: adzuna');
  }

  const sample = {
    results: [
      {
        id: '101',
        title: 'Senior Software Engineer',
        company: { display_name: 'Tech Corp' },
        location: { display_name: 'San Francisco, CA' },
        redirect_url: 'https://www.adzuna.com/land/ad/101',
        description: 'Building backend services in Node.js',
        created: '2026-08-10T12:00:00Z',
      },
      {
        id: '102',
        title: 'Frontend Engineer',
        company: { display_name: 'Web Labs' },
        location: { display_name: 'London, UK' },
        redirect_url: 'https://www.adzuna.co.uk/land/ad/102',
        created: '2026-08-11T10:00:00Z',
      },
      {
        id: '103',
        title: 'Invalid URL Role',
        redirect_url: 'invalid-url-string',
      },
      {
        id: '104',
        title: '',
        redirect_url: 'https://www.adzuna.com/land/ad/104',
      }
    ]
  };

  const jobs = parseAdzunaResponse(sample, 'Adzuna');

  if (jobs.length === 2) pass('parseAdzunaResponse keeps 2 valid jobs');
  else fail(`parseAdzunaResponse returned ${jobs.length} jobs (expected 2)`);

  if (jobs[0]?.company === 'Tech Corp' && jobs[0]?.title === 'Senior Software Engineer') {
    pass('parseAdzunaResponse maps title & company correctly');
  } else {
    fail(`row 0 title/company = ${JSON.stringify({ title: jobs[0]?.title, company: jobs[0]?.company })}`);
  }

  if (jobs[0]?.url === 'https://www.adzuna.com/land/ad/101') {
    pass('parseAdzunaResponse maps redirect_url -> url');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.description === 'Building backend services in Node.js') {
    pass('parseAdzunaResponse maps description correctly');
  } else {
    fail(`row 0 description = ${JSON.stringify(jobs[0]?.description)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('2026-08-10T12:00:00Z')) {
    pass('parseAdzunaResponse parses created -> postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  // Test fetch behavior when env vars are present vs missing
  process.env.ADZUNA_APP_ID = 'test_app_id';
  process.env.ADZUNA_APP_KEY = 'test_app_key';

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await adzuna.fetch(
    { name: 'Adzuna Search', provider: 'adzuna', country: 'us', query: 'software' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl && capturedUrl.includes('api.adzuna.com') && capturedUrl.includes('app_id=test_app_id')) {
    pass('adzuna.fetch() constructs correct Adzuna API URL');
  } else {
    fail(`adzuna.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('adzuna.fetch() passes redirect:"error" to fetchJson');
  } else {
    fail(`adzuna.fetch() redirect opt = ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 2 && fetched[0].company === 'Tech Corp') {
    pass('adzuna.fetch() returns normalized jobs');
  } else {
    fail(`adzuna.fetch() returned ${JSON.stringify(fetched)}`);
  }

  // Cleanup env
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;

  const skipped = await adzuna.fetch(
    { name: 'Adzuna Search', provider: 'adzuna' },
    { fetchJson: async () => sample }
  );
  if (Array.isArray(skipped) && skipped.length === 0) {
    pass('adzuna.fetch() gracefully returns [] when credentials are unset');
  } else {
    fail('adzuna.fetch() should return [] when credentials missing');
  }

} catch (e) {
  fail(`adzuna provider tests crashed: ${e.message}`);
}
