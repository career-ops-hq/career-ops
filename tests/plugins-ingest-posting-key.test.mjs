import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPipelineJobs } from '../plugins.mjs';

const job = (url, title = 'Senior AI Engineer') => ({ title, url });

test('a LinkedIn alert link and the plain job link add one pipeline row', () => {
  const found = [
    job('https://www.linkedin.com/comm/jobs/view/4100000001/?trackingId=abc&refId=x1&trk=eml-email_job_alert'),
    job('https://www.linkedin.com/jobs/view/senior-ai-engineer-at-hooli-4100000001?refId=zz'),
    job('https://www.linkedin.com/jobs/view/4100000002/', 'Staff ML Engineer'),
  ];
  assert.deepEqual(newPipelineJobs(found, new Set()).map((j) => j.url), [
    'https://www.linkedin.com/comm/jobs/view/4100000001/?trackingId=abc&refId=x1&trk=eml-email_job_alert',
    'https://www.linkedin.com/jobs/view/4100000002/',
  ]);
});

test('a posting already in the pipeline under another URL is not added again', () => {
  const known = new Set(['https://www.linkedin.com/jobs/view/4100000001/']);
  const found = [
    job('https://www.linkedin.com/comm/jobs/view/4100000001/?trackingId=def'),
    job('https://job-boards.greenhouse.io/hooli/jobs/7700001'),
  ];
  assert.deepEqual(newPipelineJobs(found, known).map((j) => j.url), ['https://job-boards.greenhouse.io/hooli/jobs/7700001']);
});

test('greenhouse board and company-page gh_jid add one pipeline row', () => {
  const found = [
    job('https://boards.greenhouse.io/hooli/jobs/7700001?gh_src=abc'),
    job('https://job-boards.greenhouse.io/hooli/jobs/7700001'),
    job('https://careers.hooli.example/jobs?gh_jid=7700001&utm_source=li'),
    job('https://boards.greenhouse.io/hooli/jobs/7700002', 'Another Role'),
  ];
  assert.deepEqual(newPipelineJobs(found, new Set()).map((j) => j.url), [
    'https://boards.greenhouse.io/hooli/jobs/7700001?gh_src=abc',
    'https://boards.greenhouse.io/hooli/jobs/7700002',
  ]);
});

test('two different LinkedIn postings both stay', () => {
  const found = [job('https://www.linkedin.com/jobs/view/4100000001/'), job('https://www.linkedin.com/jobs/view/4100000009/')];
  assert.equal(newPipelineJobs(found, new Set()).length, 2);
});
