// Pin IBM's official search contract, URL trust boundary, and incomplete-page signal.
import assert from 'node:assert/strict';
import provider, { parseIbmPage } from '../../providers/ibm-careers.mjs';

const entry = { name: 'IBM', careers_url: 'https://www.ibm.com/careers/search' };
const row = (id) => ({ _source: { title: 'Software Engineer',
  url: `https://careers.ibm.com/careers/JobDetail?jobId=${id}`,
  field_keyword_19: 'Shanghai', field_keyword_05: 'China', description: 'Build software' } });
const page = (total, rows) => ({ timed_out: false, _shards: { failed: 0 },
  hits: { total: { value: total, relation: 'eq' }, hits: rows } });

assert.equal(provider.detect(entry)?.url, 'https://www-api.ibm.com/search/api/v2');
assert.equal(provider.detect({ careers_url: 'https://example.com/careers/search' }), null);
assert.deepEqual(parseIbmPage(page(1, [row(123)])).jobs[0], {
  title: 'Software Engineer', url: 'https://careers.ibm.com/careers/JobDetail?jobId=123',
  location: 'Shanghai, China', description: 'Build software',
});
assert.throws(() => parseIbmPage(page(1, [{ _source: { title: 'X', url: 'https://evil.com/careers/JobDetail?jobId=1' } }])), /untrusted/);
assert.throws(() => parseIbmPage({ ...page(1, [row(1)]), timed_out: true }), /incomplete/);

const complete = await provider.fetch(entry, { fetchJson: async (_url, options) => {
  assert.deepEqual(JSON.parse(options.body).sort, [{ _id: 'asc' }]);
  return page(1, [row(1)]);
} });
assert.equal(complete.length, 1);
assert.equal(complete.collectionTruncated, false);
const capped = await provider.fetch({ ...entry, max_pages: 1 }, { fetchJson: async () => page(31, [row(1)]) });
assert.equal(capped.collectionTruncated, true);
assert.equal(capped.collectionTruncationKind, 'page_cap');
let driftPage = 0;
const drift = await provider.fetch(entry, { fetchJson: async () => ++driftPage === 1
  ? page(31, [row(1)]) : page(32, [row(31)]) });
assert.equal(drift.length, 1);
assert.equal(drift.collectionTruncated, true);
assert.equal(drift.collectionTruncationKind, 'coverage_gap');
await assert.rejects(provider.fetch(entry, { fetchJson: async () => page(30, []) }), /changed/);
console.log('IBM careers provider: official routing, parsing, URL guard, and coverage passed');
