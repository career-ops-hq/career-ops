// One posting, one key. Variants of the same job compare equal. Two jobs do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJobKey } from '../url-key.mjs';
import { canonicalJobKey as webKey } from '../web/src/lib/core/url-key.mjs';

const SAME = [
  [
    'greenhouse board, job-boards, EU host, and a company page gh_jid',
    [
      'https://boards.greenhouse.io/acme/jobs/8028783',
      'https://boards.greenhouse.io/acme/jobs/8028783/',
      'http://JOB-BOARDS.greenhouse.io/acme/jobs/8028783?gh_src=abc&utm_source=li',
      'https://job-boards.eu.greenhouse.io/acme/jobs/8028783?ref=newsletter&source=email',
      'https://boards.eu.greenhouse.io/acme/jobs/8028783',
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs/8028783',
      'https://careers.acme.example/positions/8028783?gh_jid=8028783&utm_medium=cpc&lever-origin=applied',
      'https://careers.other.example/open?gh_jid=8028783',
    ],
    'greenhouse:8028783',
  ],
  [
    'linkedin view, slug, comm, and currentJobId',
    [
      'https://www.linkedin.com/jobs/view/4100000001',
      'https://www.linkedin.com/jobs/view/4100000001/',
      'https://uk.linkedin.com/jobs/view/senior-ai-engineer-at-hooli-4100000001?refId=zz&trk=public_jobs',
      'https://www.linkedin.com/comm/jobs/view/4100000001/?trackingId=abc&utm_source=email',
      'https://www.linkedin.com/jobs/search/?currentJobId=4100000001&keywords=ai',
      'http://linkedin.com/jobs/view/4100000001',
    ],
    'linkedin.com:4100000001',
  ],
  [
    'indeed job page and results focus',
    [
      'https://www.indeed.com/viewjob?jk=abc123&utm_source=x',
      'https://uk.indeed.com/jobs?q=engineer&vjk=abc123',
    ],
    'indeed.com:abc123',
  ],
  [
    'tracking params on an ordinary posting',
    [
      'https://jobs.example.com/j/7',
      'https://jobs.example.com/j/7/',
      'https://Jobs.Example.com/J/7?utm_source=x&utm_medium=y&gh_src=abc&ref=li&src=board&source=alert&lever-origin=applied&lever-source=LinkedIn&rltr=1',
      'http://jobs.example.com/j/7?lang=de',
    ],
    'https://jobs.example.com/j/7',
  ],
];

const DIFFERENT = [
  ['https://boards.greenhouse.io/acme/jobs/8028783', 'https://boards.greenhouse.io/acme/jobs/8028784'],
  ['https://careers.acme.example/a?gh_jid=1', 'https://careers.acme.example/a?gh_jid=2'],
  ['https://boards.greenhouse.io/acme/jobs/1?gh_jid=1', 'https://boards.greenhouse.io/acme/jobs/1?gh_jid=2'],
  ['https://www.linkedin.com/jobs/view/4100000001', 'https://www.linkedin.com/jobs/view/4100000002'],
  ['https://www.indeed.com/viewjob?jk=aaa', 'https://www.indeed.com/viewjob?jk=bbb'],
  ['https://jobs.lever.co/acme/111', 'https://jobs.lever.co/acme/222'],
  ['https://jobs.example.com/careers#/jobs/123', 'https://jobs.example.com/careers#/jobs/456'],
];

test('variants of one posting share one key, on the CLI and the web copy', () => {
  for (const [label, urls, expected] of SAME) {
    for (const url of urls) {
      assert.equal(canonicalJobKey(url), expected, label);
      assert.equal(webKey(url), expected, `web ${label}`);
    }
  }
});

test('two postings do not share a key', () => {
  for (const [a, b] of DIFFERENT) {
    assert.notEqual(canonicalJobKey(a), canonicalJobKey(b), `${a} vs ${b}`);
    assert.equal(webKey(a), canonicalJobKey(a));
    assert.equal(webKey(b), canonicalJobKey(b));
  }
});

test('a missing posting is not a key, and a repeated call on a URL is stable', () => {
  for (const bad of ['', '   ', 'N/A', 'local:jds/acme.md', 'not a url', null, undefined]) {
    assert.equal(canonicalJobKey(bad), '');
    assert.equal(webKey(bad), '');
  }
  const once = canonicalJobKey('https://Jobs.Example.com/Role/9?utm_source=y');
  assert.equal(canonicalJobKey(once), once);
  assert.equal(webKey(once), once);
});
