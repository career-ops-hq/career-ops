// tests/merge-tracker-backfill-row-width.test.mjs — `--backfill-urls` must leave
// every row it touches at the header's full width, including rows it cannot fill.
//
// A row written before the URL column existed is one cell short of the header.
// #3016 established that a short row is exactly what parseTrackerRow must
// reject — "a row must span the full header width, otherwise a missing interior
// cell would silently shift every later column one position left". The guard is
// correct; the backfill was returning such rows unchanged, so they stayed
// permanently unreadable to every reader built on tracker-parse.mjs.
//
// Driven as a CLI integration test through the CAREER_OPS_TRACKER /
// CAREER_OPS_ADDITIONS overrides, matching tests/merge-tracker.test.mjs:
// importing merge-tracker.mjs runs the CLI at import time.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolveColumns, parseTrackerRow } from '../tracker-parse.mjs';

console.log('\nmerge-tracker.mjs — --backfill-urls row width');

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|------|---------|------|-------|--------|-----|--------|-------|-----|';

// A row as written before the URL column existed: nine cells, no URL delimiter.
const SHORT_ROW = (n, note) =>
  `| ${n} | 2026-08-01 | Acme | Director, Test | 4.5/5 | Evaluated | ✅ | [${n}](reports/${n}-acme.md) | ${note} |`;

/** One --backfill-urls run in an isolated workspace. Returns the tracker text. */
function runBackfill({ rows, reports }) {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-width-'));
  try {
    mkdirSync(join(dir, 'reports'), { recursive: true });
    for (const [name, body] of Object.entries(reports || {})) {
      writeFileSync(join(dir, 'reports', name), body);
    }
    const tracker = join(dir, 'applications.md');
    writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
    const out = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs'), '--backfill-urls'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: join(dir, 'none') },
    });
    return { tracker: readFileSync(tracker, 'utf-8'), output: out, dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rowFor = (text, n) => text.split('\n').find((l) => l.startsWith(`| ${n} |`)) || '';
const readable = (text, n) => {
  const lines = text.split('\n');
  const row = rowFor(text, n);
  return row ? parseTrackerRow(row, resolveColumns(lines)) : null;
};

// parseTrackerRow deliberately exposes no `url` field, so asserting on
// `parsed.url` would pass vacuously (undefined ?? '' === ''). Read the cell.
const urlCell = (text, n) => {
  const cols = resolveColumns(text.split('\n'));
  const row = rowFor(text, n);
  if (!row || cols.url == null) return null;
  return (row.split('|').map((c) => c.trim())[cols.url]) ?? null;
};

// ── PATH 1: report exists and carries **URL:** — the already-covered fill path.
// Asserted here only as a control, so a regression in the fix cannot pass by
// breaking the path it was not supposed to touch.
{
  const r = runBackfill({
    rows: [SHORT_ROW(1, 'has a url')],
    reports: { '1-acme.md': '# Eval\n\n**URL:** https://example.com/jobs/1\n' },
  });
  const row = rowFor(r.tracker, 1);
  if (/https:\/\/example\.com\/jobs\/1/.test(row) && readable(r.tracker, 1)) {
    pass('control: a fillable row is still filled and is readable');
  } else {
    fail(`fillable row mishandled: ${row.trim()}`);
  }
}

// ── PATH 2: the report has no **URL:** — `no-url`. The defect under test.
{
  const r = runBackfill({
    rows: [SHORT_ROW(2, 'warm contact, no public posting')],
    reports: { '2-acme.md': '# Eval\n\n**URL:** none — confidential pre-posting enquiry\n' },
  });
  const row = rowFor(r.tracker, 2);
  const parsed = readable(r.tracker, 2);
  if (parsed && parsed.num === 2) {
    pass('a row whose report has no **URL:** is padded to header width and stays readable');
  } else {
    fail(`no-url row left unreadable by parseTrackerRow: ${row.trim()}`);
  }
  if (parsed && urlCell(r.tracker, 2) === '') {
    pass('the padded cell is EMPTY — a delimiter, not a fabricated value');
  } else {
    fail(`padded row carries a fabricated url: ${JSON.stringify(urlCell(r.tracker, 2))}`);
  }
}

// ── PATH 3: no report link at all — `no-report`. Second unfillable branch.
{
  const r = runBackfill({ rows: ['| 3 | 2026-08-01 | Acme | Director, Test | N/A | Evaluated | ❌ | — | referral |'] });
  if (readable(r.tracker, 3)) {
    pass('a row with no report link is padded to header width and stays readable');
  } else {
    fail(`no-report row left unreadable: ${rowFor(r.tracker, 3).trim()}`);
  }
}

// ── PATH 4: the row's other cells must survive the rebuild unchanged.
{
  const r = runBackfill({ rows: [SHORT_ROW(4, 'keep me verbatim')] });
  const parsed = readable(r.tracker, 4);
  if (parsed && parsed.company === 'Acme' && parsed.role === 'Director, Test'
      && parsed.score === '4.5/5' && parsed.status === 'Evaluated' && parsed.notes === 'keep me verbatim') {
    pass('padding preserves every other cell verbatim');
  } else {
    fail(`padding altered other cells: ${JSON.stringify(parsed)}`);
  }
}

// ── PATH 5: idempotence. A second run must not widen the row again.
{
  const rows = [SHORT_ROW(5, 'run twice')];
  const first = runBackfill({ rows });
  const firstRow = rowFor(first.tracker, 5);
  const second = runBackfill({ rows: [firstRow] });
  const secondRow = rowFor(second.tracker, 5);
  if (firstRow === secondRow) {
    pass('re-running --backfill-urls is idempotent on an already-padded row');
  } else {
    fail(`second run changed the row:\n  1: ${firstRow.trim()}\n  2: ${secondRow.trim()}`);
  }
}

// ── PATH 6: the counters still report the row as unfilled, not as filled.
{
  const r = runBackfill({
    rows: [SHORT_ROW(6, 'no url')],
    reports: { '6-acme.md': '# Eval\n\nno url header here\n' },
  });
  if (/0 filled/.test(r.output) && /report has no \*\*URL:\*\*/.test(r.output)) {
    pass('an unfillable row is still counted as unfilled, not as filled');
  } else {
    fail(`counters misreport the unfillable row: ${r.output.trim()}`);
  }
}

// ── PATH 7: `already set` — a row can carry a URL and STILL be short of the
// header when the layout has user-owned columns AFTER `URL`. That branch also
// returned the line verbatim, leaving the same unreadable row.
{
  const dir = mkdtempSync(join(tmpdir(), 'backfill-width-wide-'));
  try {
    mkdirSync(join(dir, 'reports'), { recursive: true });
    const tracker = join(dir, 'applications.md');
    writeFileSync(tracker, [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL | Follow-up |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|-----|-----------|',
      '| 7 | 2026-08-01 | Acme | Director, Test | 4.5/5 | Evaluated | ✅ | [7](reports/7-acme.md) | has a url | https://example.com/j/7 |',
      '',
    ].join('\n'));
    const out = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs'), '--backfill-urls'], {
      cwd: dir, encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: join(dir, 'none') },
    });
    const text = readFileSync(tracker, 'utf-8');
    const parsed = readable(text, 7);
    if (parsed && /1 already set/.test(out)) {
      pass('an already-set row short of a wider header is padded and stays readable');
    } else {
      fail(`already-set short row left unreadable: ${rowFor(text, 7).trim()}`);
    }
    if (parsed && urlCell(text, 7) === 'https://example.com/j/7') {
      pass('padding an already-set row preserves its URL');
    } else {
      fail(`already-set row lost its URL: ${JSON.stringify(urlCell(text, 7))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
