/**
 * Explore result list: fit-band filter and multi-key sort.
 *
 * Pure-function tests for src/lib/results-view.mjs. No browser, network or data root.
 *
 * Run from web/: node --experimental-strip-types --test tests/lib/results-view.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SORT,
  applyResultsView,
  availableSortKeys,
  countBands,
  dirLabel,
  flipSortDir,
  normalizeSort,
  sortSummary,
  toggleBand,
  toggleSortKey,
} from '../../src/lib/results-view.mjs';

const o = (company, title, postedAt, band) => ({ company, title, postedAt, ...(band ? { fit: { band, score: 1 } } : {}) });

// Deliberately not in any sorted order.
const OFFERS = [
  o('Bravo', 'Writer', '2026-11-10', 'related'),
  o('Alpha', 'Analyst', '2026-11-12', 'strong'),
  o('Delta', 'Manager', '', 'weak'),
  o('Charlie', 'Engineer', '2026-11-11'),
  o('Echo', 'Analyst II', '2026-11-09', 'strong'),
];
const names = (list) => list.map((x) => x.company).join(',');

test('defaults reproduce the existing order: newest first, undated last', () => {
  assert.deepEqual(normalizeSort(undefined), [{ key: 'fresh', dir: 'desc' }]);
  assert.equal(names(applyResultsView(OFFERS)), 'Alpha,Charlie,Bravo,Echo,Delta');
});

test('oldest first still puts undated offers last', () => {
  const view = applyResultsView(OFFERS, { sort: [{ key: 'fresh', dir: 'asc' }] });
  assert.equal(names(view), 'Echo,Bravo,Charlie,Alpha,Delta');
});

test('title and company sort in both directions', () => {
  assert.equal(names(applyResultsView(OFFERS, { sort: [{ key: 'company', dir: 'asc' }] })), 'Alpha,Bravo,Charlie,Delta,Echo');
  assert.equal(names(applyResultsView(OFFERS, { sort: [{ key: 'company', dir: 'desc' }] })), 'Echo,Delta,Charlie,Bravo,Alpha');
  assert.equal(names(applyResultsView(OFFERS, { sort: [{ key: 'title', dir: 'asc' }] })), 'Alpha,Echo,Charlie,Delta,Bravo');
  assert.equal(names(applyResultsView(OFFERS, { sort: [{ key: 'title', dir: 'desc' }] })), 'Bravo,Delta,Charlie,Echo,Alpha');
});

test('fit sorts strong, related, weak, then offers with no band, in either direction', () => {
  const desc = applyResultsView(OFFERS, { sort: [{ key: 'fit', dir: 'desc' }] });
  assert.deepEqual(desc.map((x) => x.fit?.band ?? 'none'), ['strong', 'strong', 'related', 'weak', 'none']);
  const asc = applyResultsView(OFFERS, { sort: [{ key: 'fit', dir: 'asc' }] });
  assert.deepEqual(asc.map((x) => x.fit?.band ?? 'none'), ['weak', 'related', 'strong', 'strong', 'none']);
});

test('several keys apply in the order picked, each in its own direction', () => {
  const view = applyResultsView(OFFERS, {
    sort: [{ key: 'fit', dir: 'desc' }, { key: 'company', dir: 'desc' }],
  });
  // strong: Echo before Alpha (company Z-A); then related, weak, no band.
  assert.equal(names(view), 'Echo,Alpha,Bravo,Delta,Charlie');
});

test('offers tied on every key keep their incoming order', () => {
  const tied = [o('Same', 'Role', '2026-11-01', 'weak'), o('Same', 'Role', '2026-11-01', 'weak')];
  tied[0].id = 1;
  tied[1].id = 2;
  assert.deepEqual(applyResultsView(tied).map((x) => x.id), [1, 2]);
});

test('hiding a band removes only that band, never offers without one', () => {
  const view = applyResultsView(OFFERS, { hiddenBands: new Set(['weak']) });
  assert.equal(view.length, 4);
  assert.ok(view.every((x) => x.fit?.band !== 'weak'));
  assert.ok(view.some((x) => !x.fit), 'the offer with no band stays');
});

test('hiding every band leaves only offers with no band', () => {
  const view = applyResultsView(OFFERS, { hiddenBands: new Set(['strong', 'related', 'weak']) });
  assert.equal(names(view), 'Charlie');
});

test('text filter and band filter combine', () => {
  const view = applyResultsView(OFFERS, { query: ' analyst ', hiddenBands: new Set(['strong']) });
  assert.equal(view.length, 0);
  assert.equal(names(applyResultsView(OFFERS, { query: 'analyst' })), 'Alpha,Echo');
});

test('the input array is not changed', () => {
  const copy = OFFERS.map((x) => x.company);
  applyResultsView(OFFERS, { sort: [{ key: 'company', dir: 'asc' }], hiddenBands: new Set(['weak']) });
  assert.deepEqual(OFFERS.map((x) => x.company), copy);
});

test('toggleSortKey adds a key last in its default direction', () => {
  assert.deepEqual(toggleSortKey(DEFAULT_SORT, 'fit'), [{ key: 'fresh', dir: 'desc' }, { key: 'fit', dir: 'desc' }]);
  assert.deepEqual(toggleSortKey(DEFAULT_SORT, 'title'), [{ key: 'fresh', dir: 'desc' }, { key: 'title', dir: 'asc' }]);
});

test('toggleSortKey removes a key but never the last one', () => {
  const two = [{ key: 'fit', dir: 'desc' }, { key: 'company', dir: 'asc' }];
  assert.deepEqual(toggleSortKey(two, 'fit'), [{ key: 'company', dir: 'asc' }]);
  assert.deepEqual(toggleSortKey([{ key: 'company', dir: 'asc' }], 'company'), [{ key: 'company', dir: 'asc' }]);
  assert.deepEqual(toggleSortKey(DEFAULT_SORT, 'bogus'), [{ key: 'fresh', dir: 'desc' }]);
});

test('flipSortDir flips one key and keeps priority', () => {
  const spec = [{ key: 'fit', dir: 'desc' }, { key: 'company', dir: 'asc' }];
  assert.deepEqual(flipSortDir(spec, 'company'), [{ key: 'fit', dir: 'desc' }, { key: 'company', dir: 'desc' }]);
  assert.deepEqual(flipSortDir(spec, 'fit'), [{ key: 'fit', dir: 'asc' }, { key: 'company', dir: 'asc' }]);
});

test('normalizeSort drops unavailable keys, duplicates and bad directions', () => {
  const noFit = ['fresh', 'title', 'company'];
  assert.deepEqual(normalizeSort([{ key: 'fit', dir: 'desc' }], noFit), [{ key: 'fresh', dir: 'desc' }]);
  assert.deepEqual(
    normalizeSort([{ key: 'title', dir: 'sideways' }, { key: 'title', dir: 'desc' }, null, { key: 'nope' }]),
    [{ key: 'title', dir: 'asc' }],
  );
});

test('availableSortKeys offers Fit only when some offer has a band', () => {
  assert.ok(availableSortKeys(OFFERS).includes('fit'));
  assert.ok(!availableSortKeys([o('A', 'T', '2026-11-01')]).includes('fit'));
});

test('countBands counts per band and ignores offers with none', () => {
  assert.deepEqual(countBands(OFFERS), { strong: 2, related: 1, weak: 1 });
});

test('toggleBand returns a new set and flips membership', () => {
  const start = new Set();
  const hidden = toggleBand(start, 'weak');
  assert.ok(hidden.has('weak'));
  assert.equal(start.size, 0);
  assert.ok(!toggleBand(hidden, 'weak').has('weak'));
});

test('labels read naturally', () => {
  assert.equal(sortSummary([{ key: 'fit', dir: 'desc' }, { key: 'company', dir: 'asc' }]), 'Fit ↓ › Company ↑');
  assert.equal(sortSummary(DEFAULT_SORT), 'Fresh ↓');
  assert.equal(dirLabel('fit', 'desc'), 'Strongest first');
  assert.equal(dirLabel('fresh', 'asc'), 'Oldest first');
  assert.equal(dirLabel('title', 'desc'), 'Z–A');
});
