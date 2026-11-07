// tests/scan-history-headerless-readers.test.mjs — every scan-history reader
// keeps the first row of a headerless file.
//
// scan-history.tsv gets its header only when the writer creates the file, so
// a legacy file can start straight with a data row. #4807 made collectSeenUrls
// drop line 0 only when it is the header. The other readers kept a blind
// `.slice(1)`, so the same file was read with its first row by the URL dedup
// and without it by everything else: the recorded-status check re-recorded it,
// the company+role and requisition indexes lost it, and the expired-row
// planner did not know the URL and so recorded nothing for it. One helper,
// scanHistoryDataLines(), now reads line 0 the #4807 way for all of them.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { scanHistoryDataLines, SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';
import { unrecordedOffers, collectSeenCompanyRoles, collectPostingAttributes, normalizeUrlForDedup } from '../scan.mjs';
import { planExpiredHistoryRows } from '../liveness-core.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = SCAN_HISTORY_COLUMNS.join('\t');
const row = (cells) => SCAN_HISTORY_COLUMNS.map((c) => cells[c] ?? '').join('\t');
const FIRST = 'https://job-boards.greenhouse.io/acme/jobs/1001';
const SECOND = 'https://job-boards.greenhouse.io/acme/jobs/2002';
const rows = [
  row({ url: FIRST, first_seen: '2026-09-01', portal: 'greenhouse', title: 'Platform Engineer', company: 'Acme', status: 'added', location: 'Remote', requisition_id: 'R-1001' }),
  row({ url: SECOND, first_seen: '2026-09-02', portal: 'greenhouse', title: 'Data Engineer', company: 'Acme', status: 'skipped_title', location: 'Remote' }),
];
const headerless = [...rows, ''].join('\n');
const headed = [HEADER, ...rows, ''].join('\n');

console.log('\nscan history — a headerless file keeps its first row everywhere');

ok('scanHistoryDataLines drops line 0 only when it is the header', () => {
  assert.strictEqual(scanHistoryDataLines(headed)[0], rows[0]);
  assert.strictEqual(scanHistoryDataLines(headerless)[0], rows[0]);
  assert.deepStrictEqual(scanHistoryDataLines(''), ['']);
  assert.deepStrictEqual(scanHistoryDataLines(undefined), ['']);
});

for (const [label, text] of [['headed', headed], ['headerless', headerless]]) {
  ok(`${label}: unrecordedOffers sees the first row's status`, () => {
    assert.deepStrictEqual(unrecordedOffers([{ url: FIRST }], 'added', text), []);
  });
  ok(`${label}: the company+role index has the first row`, () => {
    const seen = collectSeenCompanyRoles({ scanHistoryText: text });
    assert.ok([...seen].some((k) => k.includes('platform engineer')), `keys: ${JSON.stringify([...seen])}`);
  });
  ok(`${label}: the posting attributes include the first row's requisition`, () => {
    const attrs = collectPostingAttributes(text);
    assert.ok(JSON.stringify([...attrs]).includes('R-1001'), JSON.stringify([...attrs]));
  });
  ok(`${label}: an expired verdict for the first row's URL is planned`, () => {
    const planned = planExpiredHistoryRows(text, [{ url: FIRST, result: 'expired', code: 'http_gone' }], normalizeUrlForDedup);
    assert.deepStrictEqual(planned.map((r) => r.url), [FIRST]);
  });
}
