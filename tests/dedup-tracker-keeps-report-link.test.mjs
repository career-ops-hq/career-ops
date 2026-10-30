// tests/dedup-tracker-keeps-report-link.test.mjs: merging a repost that was
// evaluated twice keeps a link to the removed row's report in the keeper's Notes.
import { pass, fail, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEDUP = join(HERE, '..', 'dedup-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

function dedup(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-report-test-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, ['# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n'));
    execFileSync(process.execPath, [DEDUP], { encoding: 'utf-8', env: { ...process.env, CAREER_OPS_TRACKER: tracker } });
    return readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

ok('removed repost report link lands in the keeper notes', () => {
  const rows = dedup([
    '| 1 | 2026-03-02 | ExampleCorp | Platform Engineer | 4.1/5 | Evaluated | ❌ | [1](reports/001-examplecorp-2026-03-02.md) | Remote US |',
    '| 2 | 2026-08-20 | ExampleCorp | Platform Engineer | 3.8/5 | Evaluated | ❌ | [2](reports/002-examplecorp-2026-08-20.md) | Reposted |',
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].split('|')[9].trim(), 'Remote US; also evaluated in [2](reports/002-examplecorp-2026-08-20.md); Reposted');
});

ok('rows sharing one report add no link', () => {
  const rows = dedup([
    '| 1 | 2026-03-02 | ExampleCorp | Platform Engineer | 4.1/5 | Evaluated | ❌ | [1](reports/001-examplecorp-2026-03-02.md) | Remote US |',
    '| 2 | 2026-03-02 | ExampleCorp | Platform Engineer | 4.1/5 | Evaluated | ❌ | [1](reports/001-examplecorp-2026-03-02.md) | |',
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].split('|')[9].trim(), 'Remote US');
});
