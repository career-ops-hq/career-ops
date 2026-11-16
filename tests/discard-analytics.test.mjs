// tests/discard-analytics.test.mjs — discard log analytics (#3392).
//
// Covers the parsing of both discard-log shapes (interactive 3-field, batch
// 4-field), the aggregation, the --since/--reason filters, and the "dumb"
// most-discarded URL list (URLs and their reason, no rule inference).
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

  // Fixture reasons are the shapes real writers produce: batch-runner.sh's
  // log_discard writes `dealbreaker: "{rule}"` and `below-min-score`, and the
  // interactive pipeline gate writes a free-text reason (modes/pipeline.md).

  // ── parsing: interactive 3-field rows ──
  const interactive = parseDiscardLog([
    '2026-08-25T10:00:00Z\thttps://example.com/job1\tpeople-management role, North Star is IC  ',
    '2026-08-25T11:00:00Z\thttps://boards.greenhouse.io/co/job2\twrong domain: marketing',
    '2026-08-26T09:00:00Z\thttps://jobs.ashbyhq.com/co/job3\trequires on-site in another country',
    '',
    'this is a malformed line',
  ].join('\n'));
  check('interactive 3-field rows parse', interactive.length === 3);
  check('reason is trimmed', interactive[0].reason === 'people-management role, North Star is IC');
  check('blank and malformed lines are skipped', interactive.length === 3);
  check('no spurious fields on a 3-field row', interactive[0].timestamp.startsWith('2026-08-25'));

  // ── parsing: batch 4-field rows (url before reason, id skipped) ──
  const batchLog = parseDiscardLog([
    '2026-08-25T10:00:00Z\t1\thttps://example.com/job1\tdealbreaker: "no on-site"',
    '2026-08-25T12:00:00Z\t2\thttps://x.test/job2\tbelow-min-score',
  ].join('\n'));
  check('batch 4-field rows parse', batchLog.length === 2);
  check('url is the third field, reason the fourth', batchLog[0].url === 'https://example.com/job1' && batchLog[0].reason === 'dealbreaker: "no on-site"');

  // ── aggregation ──
  const entries = parseDiscardLog([
    '2026-08-25T10:00:00Z\t1\thttps://example.com/job1\tbelow-min-score',
    '2026-08-25T11:00:00Z\t2\thttps://example.com/job2\tbelow-min-score',
    '2026-08-25T12:00:00Z\t3\thttps://boards.greenhouse.io/co/job3\tdealbreaker: "no on-site"',
    '2026-08-26T09:00:00Z\t4\thttps://jobs.ashbyhq.com/co/job4\tdealbreaker: "no crypto"',
    '2026-08-25T13:00:00Z\t5\thttps://example.com/job5\tbelow-min-score',
  ].join('\n'));
  const agg = aggregateDiscards(entries);
  check('total counts every parsed entry', agg.total === 5);
  check('duplicate reasons are merged', agg.byReason.length === 3);
  check('reasons are counted and sorted descending', agg.byReason[0][0] === 'below-min-score' && agg.byReason[0][1] === 3);
  check('domains are extracted from URLs', agg.byDomain.some(([d]) => d === 'boards.greenhouse.io'));
  check('days are bucketed and sorted ascending', agg.byDay[0][0] === '2026-08-25' && agg.byDay[1][0] === '2026-08-26');
  check('every discarded URL is listed, whatever its reason', agg.byUrl.length === 5);

  // ── "dumb" list: URLs with their reason, no rule inference ──
  const summary = renderSummary(agg, 10, '2026-08-25', '2026-08-26');
  check('summary includes total', summary.includes('Total discards: 5'));
  check('summary lists the most-discarded URLs', summary.includes('Most-discarded URLs'));
  check('summary no longer prints a section no writer feeds', !summary.includes('title_mismatch'));
  check('summary lists raw URLs with their reason', summary.split('\n').some((line) => /^\s+1\s+https:\/\/boards\.greenhouse\.io\/co\/job3\s+\(dealbreaker: "no on-site"\)$/.test(line)));
  check('summary does not infer a rule change', !/add keyword|change (the )?rule/i.test(summary));

  const repeated = aggregateDiscards(parseDiscardLog([
    '2026-08-25T10:00:00Z\thttps://example.com/job1\twrong seniority band',
    '2026-08-25T11:00:00Z\thttps://example.com/job2\twrong domain',
    '2026-08-25T12:00:00Z\thttps://example.com/job1\trequires relocation',
  ].join('\n')));
  check('URLs are ranked by how often they were discarded', repeated.byUrl[0].url === 'https://example.com/job1' && repeated.byUrl[0].count === 2);
  check('a repeated URL shows its latest reason', repeated.byUrl[0].lastReason === 'requires relocation');

  const outOfOrder = aggregateDiscards(parseDiscardLog([
    '2026-08-26T10:00:00Z\thttps://example.com/job1\tnewer reason',
    '2026-08-25T10:00:00Z\thttps://example.com/job1\tolder reason',
  ].join('\n')));
  check('latest reason follows the timestamp, not the line order', outOfOrder.byUrl[0].lastReason === 'newer reason');

  const fractional = aggregateDiscards(parseDiscardLog([
    '2026-08-25T10:00:00.500Z\thttps://example.com/job1\tlater, with fractional seconds',
    '2026-08-25T10:00:00Z\thttps://example.com/job1\tearlier',
  ].join('\n')));
  check('latest reason compares timestamps as instants, not text', fractional.byUrl[0].lastReason === 'later, with fractional seconds');

  const nonMonotonic = aggregateDiscards(parseDiscardLog([
    '2026-08-27T10:00:00Z\thttps://example.com/job3\tbelow-min-score',
    '2026-08-25T10:00:00Z\thttps://example.com/job1\tdealbreaker: "no on-site"',
    '2026-08-26T10:00:00Z\thttps://example.com/job2\twrong domain',
  ].join('\n')));
  check('summary period can use chronological bounds', renderSummary(nonMonotonic, 10, nonMonotonic.byDay[0][0], nonMonotonic.byDay[nonMonotonic.byDay.length - 1][0]).includes('Period: 2026-08-25 to 2026-08-27'));

  // ── filters (mirror the CLI's --since / --reason behaviour) ──
  const filteredDate = entries.filter((e) => e.timestamp >= '2026-08-26');
  check('--since keeps only later entries', filteredDate.length === 1);
  const filteredReason = entries.filter((e) => e.reason.toLowerCase().includes('dealbreaker'));
  check('--reason keeps only matches', filteredReason.length === 2);
} catch (err) {
  fail(`discard-analytics test suite threw: ${err?.message ?? err}`);
}
