// A display name is not the SmartRecruiters company slug. All responses here
// are fictional fixtures; fetchJson never makes a network request.
import assert from 'node:assert/strict';
import { pass, fail } from '../helpers.mjs';
import provider, { parseSmartRecruitersResponse } from '../../providers/smartrecruiters.mjs';
import { normalizeUrl } from '../../url-key.mjs';

const entry = {
  name: 'Example Research & Design',
  careers_url: 'https://careers.smartrecruiters.com/ExampleLabs42',
};
const posting = { id: '12345', name: 'Research Engineer', location: { city: 'Example City' } };
const ref = 'https://api.smartrecruiters.com/v1/companies/ExampleLabs42/postings/12345';
const expectedUrl = 'https://jobs.smartrecruiters.com/ExampleLabs42/12345-research-engineer';

async function check(label, fn) {
  try { await fn(); pass(label); }
  catch (e) { fail(`${label}: ${e.message}`); }
}

async function fetchPosting(config, row) {
  const calls = [];
  const jobs = await provider.fetch(config, {
    fetchJson: async (url, opts) => {
      calls.push(url);
      assert.equal(opts.redirect, 'error');
      return { content: [row] };
    },
  });
  assert.equal(calls.length, 1);
  return { job: jobs[0], calls };
}

await check('SmartRecruiters missing-ref link uses the configured company slug', async () => {
  const { job, calls } = await fetchPosting(entry, posting);
  assert.match(calls[0], /\/companies\/ExampleLabs42\/postings\?/);
  assert.equal(job.url, expectedUrl);
  assert.equal(job.company, entry.name);
  assert.equal(job.location, 'Example City');
  assert.equal(job.title, posting.name);
  assert.equal('id' in job, false);
});

await check('SmartRecruiters ref and missing-ref forms have the same URL key', async () => {
  const withRef = await fetchPosting(entry, { ...posting, ref });
  const withoutRef = await fetchPosting(entry, posting);
  assert.equal(normalizeUrl(withoutRef.job.url), normalizeUrl(withRef.job.url));
});

await check('SmartRecruiters fallback honors api slug ahead of careers_url', async () => {
  const { job, calls } = await fetchPosting({
    ...entry,
    api: 'https://jobs.smartrecruiters.com/ApiTenant7',
  }, posting);
  assert.match(calls[0], /\/companies\/ApiTenant7\/postings\?/);
  assert.equal(job.url, 'https://jobs.smartrecruiters.com/ApiTenant7/12345-research-engineer');
});

await check('SmartRecruiters fallback works with a branded careers URL', async () => {
  const { job } = await fetchPosting({
    ...entry,
    careers_url: 'https://example.test/careers',
    api: entry.careers_url,
  }, posting);
  assert.equal(job.url, expectedUrl);
});

await check('SmartRecruiters malformed ref falls back to the configured slug', async () => {
  const { job } = await fetchPosting(entry, { ...posting, ref: 'not a URL' });
  assert.equal(job.url, expectedUrl);
});

await check('SmartRecruiters untrusted ref falls back to the configured slug', async () => {
  const { job } = await fetchPosting(entry, { ...posting, ref: 'https://example.test/posting' });
  assert.equal(job.url, expectedUrl);
});

await check('SmartRecruiters trusted ref retains precedence over the fallback slug', () => {
  const jobs = parseSmartRecruitersResponse({ content: [{ ...posting, ref }] }, entry.name, 'OtherTenant');
  assert.equal(jobs[0].url, expectedUrl);
});

await check('SmartRecruiters parser keeps the legacy two-argument fallback', () => {
  const jobs = parseSmartRecruitersResponse({ content: [posting] }, entry.name);
  assert.equal(jobs[0].url, 'https://jobs.smartrecruiters.com/example-research-design/12345-research-engineer');
});

await check('SmartRecruiters missing ref and id still yields no job URL', async () => {
  const { job } = await fetchPosting(entry, { name: posting.name });
  assert.equal(job.url, '');
});
