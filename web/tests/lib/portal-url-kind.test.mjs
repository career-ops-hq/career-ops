import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestPortalUrlKind } from '../../src/lib/portal-url-kind.mjs';

test('Add URL suggests individual job versus board without assuming every URL is a board', () => {
  for (const url of [
    'https://www.linkedin.com/jobs/view/software-engineer-1234567890/',
    'https://www.linkedin.com/jobs/search/?currentJobId=1234567890',
    'https://jobs.ashbyhq.com/acme/7d74b90e-a12a-40a1-89ca-438bc68cce28',
    'https://jobs.lever.co/acme/f5c24bd3-a71b-4fa1-a68c-50a81cd9d219',
    'https://boards.greenhouse.io/acme/jobs/12345',
  ]) assert.equal(suggestPortalUrlKind(url), 'job', url);
  for (const url of [
    'https://boards.greenhouse.io/example-company', 'https://jobs.ashbyhq.com/acme',
    'https://www.linkedin.com/jobs/search/?keywords=engineer', 'https://careers.example.com/jobs',
  ]) assert.equal(suggestPortalUrlKind(url), 'website', url);
  assert.equal(suggestPortalUrlKind('not a url'), null);
  assert.equal(suggestPortalUrlKind(''), null);
  assert.equal(suggestPortalUrlKind('https://www.linkedin.com/jobs/view/12345\nhttps://example.com/jobs/234'), 'job');
});
