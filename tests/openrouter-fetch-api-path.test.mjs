// tests/openrouter-fetch-api-path.test.mjs — openrouter-runner's ATS API path
// returns what fetch-jd.mjs would: the posting title ahead of the text, with the
// text fetched under the runner's own 16,000-char cap.
//
// The normalizers keep `title` apart from `text`, and a description need not
// repeat it, so the runner dropped the title from the model input and the
// archive. fetchJdViaKnownApi also defaults to a 12,000-char cap, so the
// runner's 16,000 slice never reached the last 4,000 chars of a long posting.
//
// Run:  node --test tests/openrouter-fetch-api-path.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJobPage } from '../openrouter-runner.mjs';
import { normalizeSmartRecruitersJob, normalizeWorkdayJob } from '../browser-extract.mjs';

const URL_ = 'https://boards.greenhouse.io/acme/jobs/48213';

const TEXT = [
  'You will own the internal deploy pipeline across three regions, review infrastructure changes,',
  'and mentor two engineers. We are looking for five or more years of experience running',
  'production systems on Kubernetes, solid Go or Rust, and a habit of writing things down.',
  'The role is remote within Europe and reports to the Head of Infrastructure. Apply now.',
].join(' ');

test('the API title leads the returned content', async () => {
  const content = await fetchJobPage(URL_, {
    fetchApi: async () => ({ url: URL_, title: 'Senior Platform Engineer', text: TEXT, ats: 'greenhouse' }),
  });
  assert.equal(content, `Senior Platform Engineer\n\n${TEXT}`);
});

test('a posting without a title returns the text alone', async () => {
  const content = await fetchJobPage(URL_, {
    fetchApi: async () => ({ url: URL_, title: '', text: TEXT, ats: 'greenhouse' }),
  });
  assert.equal(content, TEXT);
});

test('the API fetcher is asked for the runner cap, and the result stays within it', async () => {
  let askedFor;
  const long = (TEXT + ' ').repeat(200); // far over 16,000
  const content = await fetchJobPage(URL_, {
    fetchApi: async (_url, cap) => {
      askedFor = cap;
      return { url: URL_, title: 'Senior Platform Engineer', text: long, ats: 'greenhouse' };
    },
  });
  assert.equal(askedFor, 16_000);
  assert.equal(content.length, 16_000);
  assert.ok(content.startsWith('Senior Platform Engineer\n\n'));
});

// A closed posting keeps its closure: the ATS text carries "Applications
// closed", and the runner stops on that verdict instead of reading the page,
// which would lose it. fetch is stubbed to fail, and the URLs are .invalid hosts,
// so with the fix missing the page read fails fast and no real site is reached.
const CLOSED_JD = (TEXT + ' ').repeat(12);

async function rejectsClosed(url, apiResult) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { throw new Error(`unexpected network call: ${u}`); };
  try {
    await assert.rejects(
      fetchJobPage(url, { fetchApi: async () => apiResult }),
      /No job description to evaluate at .*expired/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('a closed Workday posting is rejected instead of read in the browser', async () => {
  const url = 'https://workday.example.invalid/Careers/job/Engineer_R1';
  const wd = normalizeWorkdayJob({ jobPostingInfo: { title: 'Engineer', jobDescription: `<p>${CLOSED_JD}</p>`, canApply: false } }, url);
  await rejectsClosed(url, { ...wd, ats: 'workday' });
});

test('an inactive SmartRecruiters posting is rejected instead of read in the browser', async () => {
  const url = 'https://smartrecruiters.example.invalid/acme/744000151772990-engineer';
  const sr = normalizeSmartRecruitersJob({
    name: 'Engineer',
    active: false,
    jobAd: { sections: { jobDescription: { title: 'Job Description', text: `<p>${CLOSED_JD}</p>` } } },
  }, url);
  await rejectsClosed(url, { ...sr, ats: 'smartrecruiters' });
});
