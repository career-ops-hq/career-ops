import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-5663-'));
const dataDir = join(dataRoot, 'data');
mkdirSync(dataDir);
writeFileSync(join(dataDir, 'applications.md'), [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 2 | 2026-10-02 | Globex | Data Engineer | 4.5/5 | Evaluated | ❌ | [002](reports/002-globex-2026-10-02.md) | |',
  '| 3 | 2026-10-02 | Globex | Data Engineer | 3.0/5 | Applied | ❌ | [002](reports/002-globex-2026-10-02.md) | |',
  '',
].join('\n'));
writeFileSync(join(dataDir, 'status-log.tsv'), '3\t2026-10-04\tEvaluated\tApplied\tset-status\t\n');
writeFileSync(join(dataDir, 'follow-ups.md'), [
  '| # | App # | Date | Company | Role | Channel | Contact | Notes |',
  '|---|-------|------|---------|------|---------|---------|-------|',
  '| 1 | 3 | 2026-10-10 | Globex | Data Engineer | Email | Pat | first nudge |',
  '',
].join('\n'));

const env = {
  ...process.env,
  CAREER_OPS_ROOT: dataRoot,
  CAREER_OPS_DATA_DIR: '',
  CAREER_OPS_TRACKER: '',
};

try {
  const dedup = spawnSync(process.execPath, [join(ROOT, 'dedup-tracker.mjs')], {
    cwd: ROOT, env, encoding: 'utf8',
  });
  assert.equal(dedup.status, 0, dedup.stderr || dedup.stdout);

  const cadence = spawnSync(process.execPath, [join(ROOT, 'followup-cadence.mjs'), '--json'], {
    cwd: ROOT, env, encoding: 'utf8',
  });
  assert.equal(cadence.status, 0, cadence.stderr || cadence.stdout);
  const entry = JSON.parse(cadence.stdout).entries.find((item) => item.num === 2);

  assert.deepEqual(
    { appliedDate: entry.appliedDate, followupCount: entry.followupCount },
    { appliedDate: '2026-10-04', followupCount: 1 },
  );
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
}
