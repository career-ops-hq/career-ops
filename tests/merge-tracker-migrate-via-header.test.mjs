// tests/merge-tracker-migrate-via-header.test.mjs — `--migrate-via` labels the
// new column `Via` on any header the readers recognize.
//
// The migration told the header row apart by `parts[colmap.num] === '#'`. A
// header whose first column is labelled `Num`, which detectColumns accepts,
// was therefore treated as a data row and got `—` where `Via` belongs. The
// migrated tracker then had no Via column for any reader to detect, and a
// second run inserted another.
import { pass, fail, rmSync, ROOT, NODE, isolatedBatchStatePath } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

function migrate(header) {
  const dir = mkdtempSync(join(tmpdir(), 'migrate-via-header-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, ['# Applications Tracker', '', header, '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-10-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | — | n |', ''].join('\n'));
    const run = () => spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs'), '--migrate-via'], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: join(dir, 'none'), CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(join(dir, 'none')) },
    });
    const first = run();
    assert.strictEqual(first.status, 0, `${first.stdout}${first.stderr}`);
    const after = readFileSync(tracker, 'utf-8').split('\n');
    const second = run();
    return { headerLine: after[2], rowLine: after[4], second: `${second.stdout}${second.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nmerge-tracker --migrate-via — the header gets `Via`');

for (const first of ['#', 'Num']) {
  ok(`a "${first}" header gets the Via label, and a re-run finds it`, () => {
    const { headerLine, rowLine, second } = migrate(`| ${first} | Date | Company | Role | Score | Status | PDF | Report | Notes |`);
    assert.match(headerLine, /\| Company \| Via \| Role \|/, headerLine);
    assert.match(rowLine, /\| Acme \| — \| Engineer \|/, rowLine);
    assert.match(second, /Via column already present/, second);
  });
}
