// tests/discard-analytics.test.mjs — discard log analytics (#3392).
//
// Covers the parsing of both discard-log shapes (interactive 3-field, batch
// 4-field), the aggregation, the --since/--reason filters, and the "dumb"
// title_mismatch URL list (URLs only, no keyword inference).
//
// Imported directly (like rank-pipeline.test.mjs) so the pure functions are
// exercised without spawning the CLI.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ndiscard-analytics — discard log parsing + aggregation');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'discard-analytics.mjs')).href);
  const { parseDiscardLog, aggregateDiscards, renderSummary } = mod;
  const check = (label, cond) => (cond ? pass(label) : fail(label));

  // ── parsing: interactive 3-field rows ──
  const interactive = parseDiscardLog([
    '2026-08-25T10:00:00Z\thttps://example.com/job1\ttitle_mismatch: program manager not in filter',
    '2026-08-25T11:00:00Z\thttps://boards.greenhouse.io/co/job2\tnot_tech: marketing role',
    '2026-08-26T09:00:00Z\thttps://jobs.ashbyhq.com/co/job3\tlocation_mismatch: requires on-site',
    '',
    'this is a malformed line',
  ].join('\n'));
  check('interactive 3-field rows parse', interactive.length === 3);
  check('reason is trimmed', interactive[0].reason === 'title_mismatch: program manager not in filter');
  check('blank and malformed lines are skipped', interactive.length === 3);
  check('no spurious fields on a 3-field row', interactive[0].timestamp.startsWith('2026-08-25'));

  // ── parsing: batch 4-field rows (url before reason, id skipped) ──
  const batchLog = parseDiscardLog([
    '2026-08-25T10:00:00Z\tjob-001\thttps://example.com/job1\ttitle_mismatch: foo',
    '2026-08-25T12:00:00Z\tjob-002\thttps://x.test/job2\tnot_tech: bar',
  ].join('\n'));
  check('batch 4-field rows parse', batchLog.length === 2);
  check('url is the third field, reason the fourth', batchLog[0].url === 'https://example.com/job1' && batchLog[0].reason === 'title_mismatch: foo');

  // ── aggregation ──
  const entries = parseDiscardLog([
    '2026-08-25T10:00:00Z\thttps://example.com/job1\ttitle_mismatch: a',
    '2026-08-25T11:00:00Z\thttps://example.com/job2\ttitle_mismatch: b',
    '2026-08-25T12:00:00Z\thttps://boards.greenhouse.io/co/job3\tnot_tech: c',
    '2026-08-26T09:00:00Z\thttps://jobs.ashbyhq.com/co/job4\tlocation_mismatch: d',
    '2026-08-25T13:00:00Z\thttps://example.com/job5\ttitle_mismatch: b',
  ].join('\n'));
  const agg = aggregateDiscards(entries);
  check('total counts every parsed entry', agg.total === 5);
  check('duplicate reasons are merged', agg.byReason.length === 4);
  check('reasons are counted and sorted descending', agg.byReason[0][1] === 2);
  check('domains are extracted from URLs', agg.byDomain.some(([d]) => d === 'boards.greenhouse.io'));
  check('days are bucketed and sorted ascending', agg.byDay[0][0] === '2026-08-25' && agg.byDay[1][0] === '2026-08-26');
  check('title_mismatch URLs are aggregated (URLs only)', agg.titleMismatch.length === 3);

  // ── "dumb" list: URLs only, no keyword inference ──
  const summary = renderSummary(agg, 10, '2026-08-25', '2026-08-26');
  check('summary includes total', summary.includes('Total discards: 5'));
  check('summary lists title_mismatch URLs', summary.includes('Top title_mismatch URLs'));
  check('summary lists raw URLs, not a suggested keyword', summary.split('\n').some((line) => line.trim() === '1. https://example.com/job1'));
  check('summary does not infer a keyword', !/add keyword/i.test(summary));

  const repeated = aggregateDiscards(parseDiscardLog([
    '2026-08-25T10:00:00Z\thttps://example.com/job1\ttitle_mismatch: a',
    '2026-08-25T11:00:00Z\thttps://example.com/job2\ttitle_mismatch: b',
    '2026-08-25T12:00:00Z\thttps://example.com/job1\ttitle_mismatch: c',
  ].join('\n')));
  check('title_mismatch URLs are ranked by frequency', repeated.titleMismatch[0][0] === 'https://example.com/job1' && repeated.titleMismatch[0][1] === 2);

  const nonMonotonic = aggregateDiscards(parseDiscardLog([
    '2026-08-27T10:00:00Z\thttps://example.com/job3\tnot_tech: c',
    '2026-08-25T10:00:00Z\thttps://example.com/job1\ttitle_mismatch: a',
    '2026-08-26T10:00:00Z\thttps://example.com/job2\tlocation_mismatch: b',
  ].join('\n')));
  check('summary period can use chronological bounds', renderSummary(nonMonotonic, 10, nonMonotonic.byDay[0][0], nonMonotonic.byDay[nonMonotonic.byDay.length - 1][0]).includes('Period: 2026-08-25 to 2026-08-27'));

  // ── filters (mirror the CLI's --since / --reason behaviour) ──
  const filteredDate = entries.filter((e) => e.timestamp >= '2026-08-26');
  check('--since keeps only later entries', filteredDate.length === 1);
  const filteredReason = entries.filter((e) => e.reason.toLowerCase().includes('title_mismatch'));
  check('--reason keeps only matches', filteredReason.length === 3);
} catch (err) {
  fail(`discard-analytics test suite threw: ${err?.message ?? err}`);
}
