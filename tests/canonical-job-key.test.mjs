// One posting, one key. Variants of the same job compare equal. Two jobs do not.
// The web copy is loaded with import(), and only when web/src exists. A static
// import crashes a checkout that has no web/ (#3269).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJobKey } from '../url-key.mjs';
import { ROOT } from './helpers.mjs';

const WEB_MIRROR = join(ROOT, 'web', 'src', 'lib', 'core', 'url-key.mjs');
let webKey = null;
if (!existsSync(join(ROOT, 'web', 'src'))) {
  // Core-only install. The CLI key is still tested.
} else if (!existsSync(WEB_MIRROR)) {
  throw new Error('web/ exists but web/src/lib/core/url-key.mjs is missing');
} else {
  ({ canonicalJobKey: webKey } = await import(pathToFileURL(WEB_MIRROR).href));
}

function assertWeb(url, expected, label) {
  if (!webKey) return;
  assert.equal(webKey(url), expected, label);
}

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
    'smartrecruiters posting page with and without its title slug, and the API ref',
    [
      // The slug the page links to keeps a trailing hyphen after "(m/f/d)"; the
      // scanner rebuilds the slug from the title and drops it. One posting.
      'https://jobs.smartrecruiters.com/ACME/744000000000042-security-analyst-m-f-d-',
      'https://jobs.smartrecruiters.com/acme/744000000000042-security-analyst-m-f-d',
      'https://jobs.smartrecruiters.com/ACME/744000000000042',
      'https://jobs.smartrecruiters.com/ACME/744000000000042/?trid=abc&utm_source=li',
      'https://api.smartrecruiters.com/v1/companies/ACME/postings/744000000000042',
    ],
    'smartrecruiters:acme/744000000000042',
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
  ['https://jobs.smartrecruiters.com/Acme/744000000000001-analyst', 'https://jobs.smartrecruiters.com/Acme/744000000000002-analyst'],
  ['https://jobs.smartrecruiters.com/Acme/744000000000001-analyst', 'https://jobs.smartrecruiters.com/Other/744000000000001-analyst'],
  ['https://jobs.lever.co/acme/111', 'https://jobs.lever.co/acme/222'],
  ['https://jobs.example.com/careers#/jobs/123', 'https://jobs.example.com/careers#/jobs/456'],
];

test('variants of one posting share one key, on the CLI and the web copy', () => {
  for (const [label, urls, expected] of SAME) {
    for (const url of urls) {
      assert.equal(canonicalJobKey(url), expected, label);
      assertWeb(url, expected, `web ${label}`);
    }
  }
});

test('two postings do not share a key', () => {
  for (const [a, b] of DIFFERENT) {
    assert.notEqual(canonicalJobKey(a), canonicalJobKey(b), `${a} vs ${b}`);
    assertWeb(a, canonicalJobKey(a), a);
    assertWeb(b, canonicalJobKey(b), b);
  }
});

test('a missing posting is not a key, and a repeated call on a URL is stable', () => {
  for (const bad of ['', '   ', 'N/A', 'local:jds/acme.md', 'not a url', null, undefined]) {
    assert.equal(canonicalJobKey(bad), '');
    assertWeb(bad, '', String(bad));
  }
  const once = canonicalJobKey('https://Jobs.Example.com/Role/9?utm_source=y');
  assert.equal(canonicalJobKey(once), once);
  assertWeb(once, once, 'stable');
});
