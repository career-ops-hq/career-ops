import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseAtsSlug, verifyCompanies } = await import(pathToFileURL(join(ROOT, 'verify-portals.mjs')).href);

test('parseAtsSlug extracts the real board slug from Greenhouse embed URLs', () => {
  for (const url of [
    'https://boards.greenhouse.io/embed/job_board?for=stripe',
    'https://boards.eu.greenhouse.io/embed/job_board?for=stripe',
    'https://job-boards.greenhouse.io/embed/job_board?for=stripe',
    'https://job-boards.eu.greenhouse.io/embed/job_board?for=stripe',
    'https://job-boards.greenhouse.io/embed/job_board?for=stripe&offices%5B%5D=4002841002',
    'https://boards.greenhouse.io/?for=stripe',
  ]) {
    assert.deepEqual(parseAtsSlug(url), { ats: 'greenhouse', slug: 'stripe' }, url);
  }
});

test('parseAtsSlug rejects Greenhouse embed URLs with missing or unsafe ?for= values', () => {
  for (const url of [
    'https://boards.greenhouse.io/embed/job_board',
    'https://job-boards.greenhouse.io/embed/job_board?for=',
    'https://boards.greenhouse.io/embed/job_board?for=embed',
    'https://boards.greenhouse.io/embed/job_board?for=acme%2Fprivate',
    'https://boards.greenhouse.io/embed/job_board?for=..',
  ]) {
    assert.equal(parseAtsSlug(url), null, url);
  }
});

test('parseAtsSlug recognizes legacy EU Greenhouse boards', () => {
  assert.deepEqual(
    parseAtsSlug('https://boards.eu.greenhouse.io/acme-eu'),
    { ats: 'greenhouse', slug: 'acme-eu' },
  );
  assert.deepEqual(
    parseAtsSlug('https://boards.eu.greenhouse.io/acme-eu/jobs/12345'),
    { ats: 'greenhouse', slug: 'acme-eu' },
  );
});

test('parseAtsSlug pins Greenhouse and Ashby hostnames instead of matching substrings', () => {
  for (const url of [
    'https://evil.example/boards.greenhouse.io/acme',
    'https://evil.example/job-boards.greenhouse.io/acme',
    'https://evil.example/boards-api.greenhouse.io/v1/boards/acme/jobs',
    'https://example.com/careers?next=https://job-boards.greenhouse.io/othercorp',
    'https://example.com/job-boards.greenhouse.io/embed/job_board?for=stripe',
    'https://boards.greenhouse.io.evil.example/acme',
    'https://not-boards.greenhouse.io/acme',
    'https://evil.example/jobs.ashbyhq.com/acme',
    'https://evil.example/api.ashbyhq.com/posting-api/job-board/acme',
    'https://example.com/careers?next=https://jobs.ashbyhq.com/othercorp',
    'https://jobs.ashbyhq.com.evil.example/acme',
    'javascript://boards.greenhouse.io/acme',
    'ftp://jobs.ashbyhq.com/acme',
  ]) {
    assert.equal(parseAtsSlug(url), null, url);
  }
});

test('parseAtsSlug preserves valid Greenhouse, Ashby, and Lever URLs', () => {
  assert.deepEqual(parseAtsSlug('https://boards-api.greenhouse.io/v1/boards/acme/jobs'), { ats: 'greenhouse', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('https://job-boards.greenhouse.io/acme'), { ats: 'greenhouse', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('http://job-boards.greenhouse.io/acme'), { ats: 'greenhouse', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('https://job-boards.eu.greenhouse.io/acme'), { ats: 'greenhouse', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('https://boards.greenhouse.io/acme'), { ats: 'greenhouse', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('https://api.ashbyhq.com/posting-api/job-board/acme'), { ats: 'ashby', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('https://jobs.ashbyhq.com/acme'), { ats: 'ashby', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('http://jobs.ashbyhq.com/acme'), { ats: 'ashby', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('https://jobs.lever.co/acme'), { ats: 'lever', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('https://jobs.eu.lever.co/acme-eu'), { ats: 'lever', slug: 'acme-eu', eu: true });
  assert.deepEqual(parseAtsSlug('https://api.lever.co/v0/postings/acme'), { ats: 'lever', slug: 'acme' });
  assert.deepEqual(parseAtsSlug('https://api.eu.lever.co/v0/postings/acme-eu'), { ats: 'lever', slug: 'acme-eu', eu: true });
});

test('verifyCompanies probes Greenhouse embed and EU slugs and ignores foreign redirect URLs', async () => {
  const probed = [];
  const fetchJson = async (url) => {
    probed.push(url);
    if (url === 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs') return { jobs: [{ id: 1 }] };
    if (url === 'https://boards-api.greenhouse.io/v1/boards/acme-eu/jobs') return { jobs: [{ id: 2 }] };
    const err = new Error('HTTP 404');
    err.status = 404;
    throw err;
  };
  let tier2Called = false;
  const customProvider = {
    id: 'custom',
    detect: () => null,
    fetch: async () => {
      tier2Called = true;
      return [{ title: 'Engineer' }];
    },
  };

  const rows = await verifyCompanies(
    [
      { name: 'Stripe', careers_url: 'https://boards.greenhouse.io/embed/job_board?for=stripe' },
      { name: 'Acme EU', careers_url: 'https://boards.eu.greenhouse.io/acme-eu' },
      { name: 'Redirected', provider: 'custom', careers_url: 'https://example.com/careers?next=https://job-boards.greenhouse.io/othercorp' },
    ],
    { fetchJson, fetchText: async () => '', providers: new Map([['custom', customProvider]]), httpCtx: { fetchJson, fetchText: async () => '' }, concurrency: 1 },
  );

  assert.equal(rows[0].status, 'live');
  assert.equal(rows[0].slug, 'stripe');
  assert.equal(rows[1].status, 'live');
  assert.equal(rows[1].slug, 'acme-eu');
  assert.equal(rows[2].status, 'live');
  assert.equal(rows[2].provider, 'custom');
  assert.equal(tier2Called, true);
  assert.deepEqual(probed, [
    'https://boards-api.greenhouse.io/v1/boards/stripe/jobs',
    'https://boards-api.greenhouse.io/v1/boards/acme-eu/jobs',
  ]);
});
