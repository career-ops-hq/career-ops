import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function setStatus(from, to) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-reopen-'));
  try {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      `| 7 | 2026-02-01 | Acme | Backend Engineer | 4.4/5 | ${from} | ❌ | | |`, '',
    ].join('\n'));
    return spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), '7', to], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md') },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('leaving a terminal state warns on stderr', () => {
  const r = setStatus('Rejected', 'Applied');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.match(r.stderr, /#7 was Rejected, a terminal state\. Reopened as Applied\./);
});

test('a forward move from an open state does not warn', () => {
  const r = setStatus('Evaluated', 'Applied');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.doesNotMatch(r.stderr, /terminal state/);
});
