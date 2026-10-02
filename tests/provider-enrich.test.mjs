/** Keep iCIMS detail enrichment a host-guarded raw provider tool. */

import assert from 'node:assert/strict';
import { enrich } from '../adapters/node/providers/_enrich.mjs';

const url = 'https://careers-acme.icims.com/jobs/123/engineer/job';
const completed = [];
const jobs = await enrich({ jobs: [{ url, title: 'Engineer' }] }, {
  fetchText: async requested => {
    assert.equal(requested, `${url}?in_iframe=1`);
    return '<script type="application/ld+json">{"@type":"JobPosting","datePosted":"2026-09-27"}</script>';
  },
}, (index, job) => completed.push({ index, job }));
assert.equal(jobs[0].postedAt, Date.parse('2026-09-27'));
assert.equal(jobs[0].url, url);
assert.deepEqual(completed, [{ index: 0, job: jobs[0] }]);
assert.deepEqual(await enrich({ jobs: [{ url: 'https://evil.example/jobs/123/engineer/job' }] }),
  [{ url: 'https://evil.example/jobs/123/engineer/job' }]);
