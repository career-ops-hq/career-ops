/** Verify MTR Taleo list parsing and form-backed pagination. */

import assert from 'node:assert/strict';
import mtr, { parseList } from '../../../adapters/node/providers/mtr-taleo.mjs';

function page(number, id) {
  const fields = Array(43).fill('');
  fields[3] = String(id);
  fields[4] = `AI Engineer ${id}`;
  fields[12] = `260000${id}`;
  fields[13] = 'Hong Kong';
  fields[20] = '28/Sep/26';
  return `<form><input type="hidden" name="rlPager.currentPage" value="${number}" />
<input type="hidden" name="ftlpageid" value="reqListAllJobsPage" /></form>
Job Openings (2 jobs found)
<script>api.fillList('requisitionListInterface', 'listRequisition', [${fields.map((value) => `'${value}'`).join(',')}]);</script>`;
}

assert.equal(mtr.detect({ careers_url: 'https://careers.mtr.com.hk/careersection/mtr_external/joblist.ftl?lang=en' })?.url,
  'https://careers.mtr.com.hk/careersection/mtr_external/joblist.ftl?lang=en');
assert.equal(mtr.detect({ careers_url: 'https://careers.mtr.com.hk.evil.example/careersection/mtr_external/joblist.ftl' }), null);
assert.equal(parseList(page(1, 1)).jobs[0].postedAt, Date.UTC(2026, 8, 28));
const calls = [];
const jobs = await mtr.fetch({ name: 'MTR Corporation', careers_url: 'https://careers.mtr.com.hk/careersection/mtr_external/joblist.ftl?lang=en' },
  { fetchText: async (_url, options) => {
    calls.push(options);
    return calls.length === 1 ? page(1, 1) : page(2, 2);
  } });
assert.equal(jobs.length, 2);
assert.equal(jobs.collectionTruncated, false);
assert.equal(calls[1].method, 'POST');
assert.equal(new URLSearchParams(calls[1].body).get('rlPager.currentPage'), '2');
let requests = 0;
const repeated = await mtr.fetch({ name: 'MTR Corporation', careers_url: 'https://careers.mtr.com.hk/careersection/mtr_external/joblist.ftl?lang=en' },
  { fetchText: async () => { requests++; return page(1, 1); } });
assert.equal(requests, 2);
assert.equal(repeated.collectionTruncated, true);
assert.equal(repeated.collectionTruncationKind, 'coverage_gap');
let duplicatePage = 0;
const duplicates = await mtr.fetch({ name: 'MTR Corporation', careers_url: 'https://careers.mtr.com.hk/careersection/mtr_external/joblist.ftl?lang=en' },
  { fetchText: async () => page(++duplicatePage, 1) });
assert.equal(duplicates.length, 1);
assert.equal(duplicates.collectionTruncated, false);
