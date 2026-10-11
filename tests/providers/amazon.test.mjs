// tests/providers/amazon.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — amazon (amazon.jobs search.json)');

try {
  const amazon = (await import(pathToFileURL(join(ROOT, 'providers/amazon.mjs')).href)).default;

  if (amazon.id === 'amazon') pass('amazon.id is "amazon"');
  else fail(`amazon.id is ${JSON.stringify(amazon.id)}`);

  // detect() — host match, not path-spoof, https + non-string safe
  if (amazon.detect({ name: 'X', careers_url: 'https://www.amazon.jobs/en/search' })) pass('amazon.detect() claims an amazon.jobs URL');
  else fail('amazon.detect() should claim amazon.jobs');
  if (amazon.detect({ name: 'X', careers_url: 'https://evil.example/www.amazon.jobs/x' }) === null) pass('amazon.detect() rejects a path-spoofed URL');
  else fail('amazon.detect() must reject path-spoofed URLs');
  if (amazon.detect({ name: 'X', careers_url: 42 }) === null) pass('amazon.detect() returns null for non-string careers_url');
  else fail('amazon.detect() should return null for non-string careers_url');

  // fetch() with a mock ctx — captures the request URL (to assert facet
  // bracket-encoding) and returns a canned page, exercising the real mapping.
  const calls = [];
  const page1 = {
    jobs: [
      { title: '  Automation Engineer  ', job_path: '/en/jobs/111/automation-engineer', normalized_location: 'Erfurt, Thuringia, DEU', posted_date: 'July  1, 2026', updated_time: '10 minutes', company_name: 'Amazon' },
      { title: 'SDE', job_path: 'https://www.amazon.jobs/en/jobs/222/sde', location: 'Berlin, DEU', posted_date: 'June 29, 2026' },
      { title: 'No Path', normalized_location: 'X' }, // dropped — no job_path
    ],
  };
  const mockCtx = {
    transport: 'http',
    async fetchJson(url) { calls.push(url); return calls.length === 1 ? page1 : { jobs: [] }; },
    async fetchText() { return ''; },
  };
  const jobs = await amazon.fetch({ name: 'Amazon', amazon: { normalized_country_code: ['DEU'], base_query: 'engineer' } }, mockCtx);

  if (jobs.length === 2) pass('amazon.fetch maps valid jobs, drops job_path-less entries');
  else fail(`amazon.fetch returned ${jobs.length} jobs, expected 2`);
  if (calls[0] && calls[0].includes('normalized_country_code%5B%5D=DEU')) pass('amazon.fetch bracket-encodes array facets (normalized_country_code[]=DEU)');
  else fail(`amazon.fetch facet encoding wrong: ${calls[0]}`);
  if (calls[0] && calls[0].includes('result_limit=100')) pass('amazon.fetch requests result_limit=100');
  else fail('amazon.fetch should set result_limit=100');
  const j1 = jobs.find((j) => j.url.includes('/111/'));
  if (j1 && j1.title === 'Automation Engineer') pass('amazon.fetch trims the title');
  else fail(`amazon.fetch title wrong: ${JSON.stringify(j1 && j1.title)}`);
  if (j1 && j1.url === 'https://www.amazon.jobs/en/jobs/111/automation-engineer') pass('amazon.fetch builds an absolute URL from job_path');
  else fail(`amazon.fetch url wrong: ${JSON.stringify(j1 && j1.url)}`);
  if (j1 && j1.postedAt === Date.parse('July 1, 2026')) pass('amazon.fetch parses posted_date (ignores relative updated_time)');
  else fail(`amazon.fetch postedAt wrong: ${JSON.stringify(j1 && j1.postedAt)}`);
  const j2 = jobs.find((j) => j.url.includes('/222/'));
  if (j2 && j2.url === 'https://www.amazon.jobs/en/jobs/222/sde') pass('amazon.fetch keeps an already-absolute job_path');
  else fail(`amazon.fetch absolute url wrong: ${JSON.stringify(j2 && j2.url)}`);
  if (j2 && j2.location === 'Berlin, DEU') pass('amazon.fetch falls back to location when there is no locations array');
  else fail(`amazon.fetch fallback location wrong: ${JSON.stringify(j2 && j2.location)}`);

  // A multi-city req names one city in normalized_location; the rest are only
  // in `locations`, an array of JSON-encoded strings.
  const loc = (city, raw) => JSON.stringify({ normalizedLocation: city, location: raw });
  const multiPage = {
    jobs: [{
      title: 'Solutions Architect',
      job_path: '/en/jobs/333/solutions-architect',
      normalized_location: 'Seattle, Washington, USA',
      locations: [
        loc('Seattle, Washington, USA', 'US, WA, Seattle'), loc('Arlington, Virginia, USA', 'US, VA, Arlington'), '{not json',
        // A non-string normalizedLocation falls back to the raw spelling, and
        // the same city's later normalized entry is not listed a second time.
        JSON.stringify({ normalizedLocation: 123, location: 'US, CO, Denver' }),
        loc('Denver, Colorado, USA', 'US, CO, Denver'),
        // No usable string in either field: skipped.
        JSON.stringify({ normalizedLocation: null, location: 42 }),
      ],
    }, {
      // No normalized_location: the primary is the raw spelling, which must
      // still dedupe against the same city's normalized entry.
      title: 'Account Manager',
      job_path: '/en/jobs/444/account-manager',
      location: 'US, VA, Arlington',
      locations: [loc('Arlington, Virginia, USA', 'US, VA, Arlington'), loc('Herndon, Virginia, USA', 'US, VA, Herndon')],
    }],
  };
  let multiCalls = 0;
  const multiJobs = await amazon.fetch({ name: 'Amazon' }, {
    transport: 'http',
    async fetchJson(_url, opts) {
      if (opts?.redirect !== 'error') throw new Error(`fetchJson without redirect:'error': ${JSON.stringify(opts)}`);
      multiCalls++;
      return multiCalls === 1 ? multiPage : { jobs: [] };
    },
    async fetchText() { return ''; },
  });
  const j3 = multiJobs[0];
  if (j3 && j3.location === 'Seattle, Washington, USA · Arlington, Virginia, USA · US, CO, Denver') pass('amazon.fetch lists every city of a multi-city req, primary first, deduped, malformed and non-string entries handled');
  else fail(`amazon.fetch multi-city location wrong: ${JSON.stringify(j3 && j3.location)}`);
  const j4 = multiJobs[1];
  if (j4 && j4.location === 'US, VA, Arlington · Herndon, Virginia, USA') pass('amazon.fetch dedupes a raw-spelled primary against its normalized entry');
  else fail(`amazon.fetch raw-primary dedupe wrong: ${JSON.stringify(j4 && j4.location)}`);
} catch (e) {
  fail(`amazon provider tests crashed: ${e.message}`);
}

