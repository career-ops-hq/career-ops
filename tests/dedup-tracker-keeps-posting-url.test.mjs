// tests/dedup-tracker-keeps-posting-url.test.mjs — when dedup removes a row,
// a posting URL only that row carried moves to the kept row.
//
// dedup-tracker keeps the higher-scored row of a cluster and carries the
// removed rows' more advanced status and their notes onto it, but it never
// carried the URL cell. The URL is the tracker's deterministic dedup key
// (#3516), so when the keeper had none and the removed row had one (a
// re-evaluation scored higher than the applied row that carried the link), the
// URL was deleted with the row. The surviving row, Applied by then, matched
// only by fuzzy company+role on every later merge.
import { pass, fail, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEDUP = join(dirname(fileURLToPath(import.meta.url)), '..', 'dedup-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|';
const URL_CELL = '[greenhouse](https://job-boards.greenhouse.io/acme/jobs/1001)';
const row = (n, score, status, url) =>
  `| ${n} | 2026-10-0${n} | Acme | Platform Engineer | ${score} | ${status} | ❌ | [40](reports/040-acme.md) | row ${n} | ${url} |`;

function dedup(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-url-carry-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
    execFileSync(process.execPath, [DEDUP], { encoding: 'utf-8', env: { ...process.env, CAREER_OPS_TRACKER: tracker } });
    return readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => l.split('|').map(c => c.trim()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\ndedup-tracker — the kept row keeps the posting URL');

ok('a URL only the removed row carried moves to the kept row, link form intact', () => {
  // THE BUG: #2 is kept (higher score), #1 is removed, and #1's URL went with it.
  const rows = dedup([row(1, '3.9/5', 'Applied', URL_CELL), row(2, '4.4/5', 'Evaluated', '')]);
  assert.strictEqual(rows.length, 1, 'premise: the two rows are one report identity');
  assert.strictEqual(rows[0][1], '2', 'premise: the higher score is kept');
  assert.strictEqual(rows[0][6], 'Applied', 'premise: the status is promoted');
  assert.strictEqual(rows[0][10], URL_CELL);
});

ok('a placeholder URL on the kept row is replaced the same way', () => {
  const rows = dedup([row(1, '3.9/5', 'Applied', URL_CELL), row(2, '4.4/5', 'Evaluated', '—')]);
  assert.strictEqual(rows[0][10], URL_CELL);
});

ok('a URL the kept row already has is left alone', () => {
  const own = '[greenhouse](https://job-boards.greenhouse.io/acme/jobs/1001?gh_src=x)';
  const rows = dedup([row(1, '3.9/5', 'Applied', URL_CELL), row(2, '4.4/5', 'Evaluated', own)]);
  assert.strictEqual(rows.length, 1, 'premise: same posting, so one row');
  assert.strictEqual(rows[0][10], own);
});
