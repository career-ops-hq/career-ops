// tests/cv-sync-check-code-root.test.mjs — cv-sync-check.mjs must resolve the
// system prompt files it scans for hardcoded metrics (_shared.md, _writing.md,
// batch-prompt.md) from the code root, not from an undeclared identifier.
//
// The script defined CODE_ROOT and DATA_ROOT but built `filesToCheck` from a
// `projectRoot` that no longer existed, so every invocation died at module
// load with `ReferenceError: projectRoot is not defined` — before a single
// check ran. `_shared.md` tells the agent to run this on the first evaluation
// of every session, so the crash fired on every session that honoured it.
//
// Run:  node --test tests/cv-sync-check-code-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function runWithDataRoot() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'cv-sync-check-'));
  mkdirSync(join(dataRoot, 'config'));
  writeFileSync(join(dataRoot, 'cv.md'), '# Test Candidate\n');
  writeFileSync(
    join(dataRoot, 'config', 'profile.yml'),
    'candidate:\n  full_name: "Test Candidate"\n  email: "test@example.com"\n  location: "Nowhere"\n',
  );
  return spawnSync(process.execPath, [join(CODE_ROOT, 'cv-sync-check.mjs')], {
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
    encoding: 'utf-8',
  });
}

test('cv-sync-check.mjs loads and runs its checks instead of throwing at module load', () => {
  const result = runWithDataRoot();
  assert.doesNotMatch(result.stderr, /ReferenceError/, result.stderr);
  assert.doesNotMatch(result.stderr, /projectRoot/, result.stderr);
  assert.match(result.stdout, /=== career-ops sync check ===/);
  assert.equal(result.status, 0, `exit ${result.status}\n${result.stdout}\n${result.stderr}`);
});
