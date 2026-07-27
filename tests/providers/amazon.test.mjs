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
} catch (e) {
  fail(`amazon provider tests crashed: ${e.message}`);
}

