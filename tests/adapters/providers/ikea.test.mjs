/** Verify IKEA's bounded public search pagination and result parsing. */

import assert from 'node:assert/strict';
import ikea, { parseSearchPage } from '../../../adapters/node/providers/ikea.mjs';

const page = (number, pages, id) => `<section data-total-job-results="2" data-total-pages="${pages}" data-current-page="${number}">
<li class="job-list__item"><a href="/en/job/shanghai/ai-engineer/24107/${id}" data-job-id="${id}" class="job-list__anchor">
<span class="job-list__title">AI &#45; Engineer</span><span class="job-list__location">Shanghai, China</span></a></li></section>`;
assert.deepEqual(parseSearchPage(page(1, 2, 1)).jobs, [{
  title: 'AI - Engineer', url: 'https://jobs.ikea.com/en/job/shanghai/ai-engineer/24107/1', location: 'Shanghai, China',
}]);
assert.equal(ikea.detect({ careers_url: 'https://jobs.ikea.com/' })?.url, 'https://jobs.ikea.com/en/search-jobs?l=China');
assert.equal(ikea.detect({ careers_url: 'https://jobs.ikea.com.evil.example/' }), null);
const calls = [];
const ctx = { fetchText: async (url) => {
  calls.push(url);
  return page(calls.length, 2, calls.length);
} };
const complete = await ikea.fetch({ name: 'IKEA China', careers_url: 'https://jobs.ikea.com/' }, ctx);
assert.equal(complete.length, 2);
assert.equal(complete.collectionTruncated, false);
assert.equal(calls.length, 2);
const capped = await ikea.fetch({ name: 'IKEA China', careers_url: 'https://jobs.ikea.com/', max_pages: 1 }, ctx);
assert.equal(capped.collectionTruncated, true);
const repeated = await ikea.fetch({ name: 'IKEA China', careers_url: 'https://jobs.ikea.com/' },
  { fetchText: async () => page(1, 2, 1) });
assert.equal(repeated.length, 1);
assert.equal(repeated.collectionTruncated, true);
assert.equal(repeated.collectionTruncationKind, 'coverage_gap');
let partialPage = 0;
const partial = await ikea.fetch({ name: 'IKEA China', careers_url: 'https://jobs.ikea.com/' },
  { fetchText: async () => ++partialPage === 1 ? page(1, 2, 1)
    : '<section data-total-job-results="2" data-total-pages="2"></section>' });
assert.equal(partial.length, 1);
assert.equal(partial.collectionTruncated, true);
assert.equal(partial.collectionTruncationKind, 'coverage_gap');
await assert.rejects(ikea.fetch({ name: 'IKEA China', careers_url: 'https://jobs.ikea.com/' },
  { fetchText: async () => '<section data-total-job-results="2" data-total-pages="2"></section>' }), /empty page/);
