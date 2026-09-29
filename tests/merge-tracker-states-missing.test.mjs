// merge-tracker must still merge when templates/states.yml is missing (#3561).
//
// The canonical states load at startup, so a broken install used to kill the
// run on a raw ENOENT. It now warns once and keeps each status as written:
// never an "Evaluated" the row did not claim.
//
// states.yml resolves beside the script (System Layer), so the only way to take
// it away without touching the checkout is a throwaway code root: the flat
// scripts plus lib/, node_modules linked (as in verifiers-plugin-providers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('merge-tracker merges with the status as written when templates/states.yml is missing', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-no-states-'));
  try {
    const codeRoot = join(tmp, 'code');
    const dataRoot = join(tmp, 'user');
    mkdirSync(codeRoot, { recursive: true });
    for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
      if (entry.isFile() && /\.(mjs|json)$/.test(entry.name)) cpSync(join(ROOT, entry.name), join(codeRoot, entry.name));
    }
    cpSync(join(ROOT, 'lib'), join(codeRoot, 'lib'), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(codeRoot, 'node_modules'), 'junction');
    // No templates/ at all: neither states.yml candidate exists.

    const tracker = join(dataRoot, 'data', 'applications.md');
    mkdirSync(dirname(tracker), { recursive: true });
    mkdirSync(join(dataRoot, 'batch', 'tracker-additions'), { recursive: true });
    writeFileSync(tracker, [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-01 | Acme | PM | 4.0/5 | Evaluated | ❌ | — | seeded |',
      '',
    ].join('\n'));
    writeFileSync(join(dataRoot, 'batch', 'tracker-additions', '002-globex.tsv'),
      '2\t2026-01-02\tGlobex\tEngineer\tApplied\t4.1/5\t❌\t—\tqueued\n');

    const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
    for (const k of ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_ADDITIONS', 'CAREER_OPS_BATCH_STATE']) delete env[k];
    const r = spawnSync(process.execPath, [join(codeRoot, 'merge-tracker.mjs')], {
      cwd: tmp, env, encoding: 'utf-8', timeout: 60_000,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    assert.equal(r.status, 0, `merge-tracker died without states.yml:\n${out}`);
    assert.match(out, /Cannot read canonical states/, 'the broken install must be reported');
    const row = readFileSync(tracker, 'utf-8').split('\n').find(l => l.includes('Globex'));
    assert.ok(row, `the addition was not merged:\n${out}`);
    assert.match(row, /\|\s*Applied\s*\|/, `status was rewritten instead of kept: ${row}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
