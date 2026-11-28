import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { ROOT } from './helpers.mjs';

const applied = '| 7 | 2026-10-01 | Example Corp | Platform Engineer | 4.0/5 | Applied | ✅ | [9](reports/018-example.md) | sent |';
const evaluated = '| 9 | 2026-10-02 | Example Corp | Platform Engineer | 4.5/5 | Evaluated | ❌ | [9](reports/009-example.md) | newer |';

function deduplicate(...rows) {
  const workspace = mkdtempSync(join(tmpdir(), 'career-ops-dedup-report-'));
  const tracker = join(workspace, 'applications.md');
  try {
    writeFileSync(tracker, [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      ...rows, '',
    ].join('\n'));
    execFileSync(process.execPath, [join(ROOT, 'dedup-tracker.mjs')], {
      cwd: workspace,
      env: { ...process.env, CAREER_OPS_ROOT: workspace, CAREER_OPS_TRACKER: tracker },
      encoding: 'utf8', timeout: 30_000,
    });
    return readFileSync(tracker, 'utf8').split('\n').filter(line => /^\| \d+ \|/.test(line));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

test('identical report labels do not delete an applied row with a different report target', () => {
  assert.deepEqual(deduplicate(applied, evaluated), [applied, evaluated]);
});

test('the same report target still merges rows whose labels differ', () => {
  const rows = deduplicate(applied, evaluated.replace('009-example.md', '018-example.md').replace('[9]', '[18]'));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /\| Applied \|.*\[18\]\(reports\/018-example\.md\)/);
});
