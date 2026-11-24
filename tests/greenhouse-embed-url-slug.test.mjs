import { test } from 'node:test';
import assert from 'node:assert/strict';
import greenhouse from '../providers/greenhouse.mjs';

test('greenhouse.detect() resolves EU legacy embed URLs and case-variant /embed paths', () => {
  for (const [careers_url, expectedSlug] of [
    ['https://boards.eu.greenhouse.io/embed/job_board?for=euco', 'euco'],
    ['https://boards.eu.greenhouse.io/embed/job_app?for=euco&token=12345', 'euco'],
    ['https://job-boards.eu.greenhouse.io/embed/job_board?for=euco', 'euco'],
    ['https://boards.greenhouse.io/EMBED/job_board?for=acme', 'acme'],
    ['http://job-boards.greenhouse.io/embed/job_board?for=acme', 'acme'],
  ]) {
    assert.deepEqual(
      greenhouse.detect({ name: 'Acme', careers_url }),
      { url: `https://boards-api.greenhouse.io/v1/boards/${expectedSlug}/jobs` },
      `failed to detect ${careers_url}`,
    );
  }
});

test('greenhouse.detect() refuses http: on legacy embed hosts and ?for= on boards-api careers_url', () => {
  for (const careers_url of [
    'http://boards.greenhouse.io/embed/job_board?for=acme',
    'http://boards.eu.greenhouse.io/embed/job_board?for=euco',
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs?for=other',
  ]) {
    assert.equal(
      greenhouse.detect({ name: 'Acme', careers_url }),
      null,
      `should not claim ${careers_url}`,
    );
  }
});

test('greenhouse.detect() rejects traversal, delimiter, and blank board slugs in ?for= and path', () => {
  for (const careers_url of [
    'https://job-boards.greenhouse.io/embed/job_board?for=../../evil',
    'https://job-boards.greenhouse.io/embed/job_board?for=acme%2Fother',
    'https://job-boards.greenhouse.io/embed/job_board?for=acme?x=1',
    'https://job-boards.greenhouse.io/embed/job_board?for=acme%23frag',
    'https://job-boards.greenhouse.io/embed/job_board?for=..',
    'https://job-boards.greenhouse.io/embed/job_board?for=.',
    'https://job-boards.greenhouse.io/embed/job_board?for=%20%20',
    'https://job-boards.greenhouse.io/embed/job_board?for=EMBED',
    'https://job-boards.greenhouse.io/acme%2Fother',
  ]) {
    assert.equal(
      greenhouse.detect({ name: 'Acme', careers_url }),
      null,
      `should reject malformed slug in ${careers_url}`,
    );
  }
});

test('greenhouse.fetch() fetches the EU legacy embed board without calling fetchJson for invalid slugs', async () => {
  let fetchedUrl = null;
  const jobs = await greenhouse.fetch(
    { name: 'EuCo', careers_url: 'https://boards.eu.greenhouse.io/embed/job_board?for=euco' },
    {
      fetchJson: async (url) => {
        fetchedUrl = url;
        return {
          jobs: [{ id: 1, title: 'Engineer', absolute_url: 'https://job-boards.eu.greenhouse.io/euco/jobs/1' }],
        };
      },
    },
  );
  assert.equal(fetchedUrl, 'https://boards-api.greenhouse.io/v1/boards/euco/jobs?content=true');
  assert.equal(jobs.length, 1);

  let called = false;
  await assert.rejects(
    () => greenhouse.fetch(
      { name: 'Bad', careers_url: 'https://job-boards.greenhouse.io/embed/job_board?for=../../evil' },
      { fetchJson: async () => { called = true; return { jobs: [] }; } },
    ),
    /cannot derive API URL/,
  );
  assert.equal(called, false);
});
