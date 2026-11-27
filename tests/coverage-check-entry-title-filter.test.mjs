// tests/coverage-check-entry-title-filter.test.mjs — coverage-check judges a
// tracked company's posting by the title_filter the scanner uses for it.
//
// A tracked_companies entry may carry its own title_filter, which replaces the
// global one for that entry's postings (#7244, resolveEntryTitleGate() in
// scan.mjs). diagnose() always used the global filter, so it blamed the global
// title_filter for a title the entry's own filter keeps, and called a posting
// the entry's own filter drops "newer than the last scan".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../coverage-check.mjs';

const providers = new Map([
  ['greenhouse', { id: 'greenhouse', fetch() {}, detect: (e) => /greenhouse\.io/.test(e.careers_url || '') }],
]);
const config = { title_filter: { positive: ['Rust'], negative: ['Intern'] } };
const entries = [
  { name: 'Acme', careers_url: 'https://job-boards.greenhouse.io/acme', title_filter: { positive: ['Solutions Architect'] } },
  { name: 'Beta', careers_url: 'https://job-boards.greenhouse.io/beta', title_filter: { positive: ['Rust'], negative: ['Senior'] } },
  { name: 'Gamma', careers_url: 'https://job-boards.greenhouse.io/gamma', title_filter: { negative: ['Staff'] } },
  { name: 'Delta', careers_url: 'https://job-boards.greenhouse.io/delta' },
];
const ctx = {
  config, entries, providers,
  history: new Map(), historyCompanies: new Map(), pipelineText: '', datasets: new Map(),
};
const run = (slug, title) => diagnose({ url: `https://job-boards.greenhouse.io/${slug}/jobs/1`, company: slug, title, location: '' }, ctx);

test('a title the entry\'s own positives keep is not blamed on title_filter', () => {
  const r = run('acme', 'Solutions Architect');
  assert.equal(r.gap, 'tracked-not-seen', JSON.stringify(r));
  assert.ok(r.evidence.some((e) => e.includes('"Acme" has its own title_filter')), JSON.stringify(r.evidence));
});

test('a title the entry\'s own filter drops is a title-filter miss, and the fix names the entry', () => {
  const r = run('beta', 'Senior Rust Engineer');
  assert.equal(r.gap, 'tracked-title-filter', JSON.stringify(r));
  assert.match(r.fix, /title_filter of "Beta" drops "Senior Rust Engineer"/);
  // The entry's positives replace the global ones: a global keyword alone does not keep a title.
  assert.equal(run('acme', 'Rust Engineer').gap, 'tracked-title-filter');
});

test('an entry with negatives only keeps the global positives, as the scanner does', () => {
  assert.equal(run('gamma', 'Rust Engineer').gap, 'tracked-not-seen');
  assert.equal(run('gamma', 'Staff Rust Engineer').gap, 'tracked-title-filter');
  assert.equal(run('gamma', 'Head of Sales').gap, 'tracked-title-filter');
});

test('control: an entry without a title_filter is judged by the global one, as before', () => {
  assert.equal(run('delta', 'Rust Engineer').gap, 'tracked-not-seen');
  const r = run('delta', 'Solutions Architect');
  assert.equal(r.gap, 'tracked-title-filter');
  assert.match(r.fix, /no title_filter keyword matches/);
  assert.ok(!r.evidence.some((e) => e.includes('its own title_filter')));
});
