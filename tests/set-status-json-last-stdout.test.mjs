// tests/set-status-json-last-stdout.test.mjs — set-status.mjs must keep stdout
// clean so that --json output stays machine-parseable (issue #3855).
//
// The contract with web/src/lib/parseCliJson is that the JSON document is the
// last thing printed on stdout. A single console.log added after the result
// (a farewell line, a hint, a debug print) makes every successful status
// write come back to the web as a 500, while the write itself lands in
// applications.md and status-log.tsv.
//
// Run:  node --test tests/set-status-json-last-stdout.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-json-stdout-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 7 | 2026-02-01 | Acme | Backend Engineer | 4.4/5 | Evaluated | ✅ | [7](../reports/007-acme-2026-02-01.md) | notes |',
    '',
  ].join('\n'));
  return dir;
}

function setStatus(dir, args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md') },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return r;
}

test('success: JSON result is the last thing on stdout', () => {
  const dir = sandbox();
  try {
    const r = setStatus(dir, ['--row', '7', 'Applied', '--json']);
    assert.equal(r.status, 0, `set-status failed: ${r.stderr}`);

    // Find the JSON object in stdout
    const jsonStart = r.stdout.indexOf('{');
    assert.notEqual(jsonStart, -1, 'no JSON object found in stdout');

    // Extract everything after the closing brace
    const jsonEnd = r.stdout.lastIndexOf('}');
    assert.notEqual(jsonEnd, -1, 'no closing brace found in stdout');

    const afterJson = r.stdout.slice(jsonEnd + 1);

    // Assert that nothing follows the JSON but whitespace
    assert.equal(
      afterJson.trim(),
      '',
      `stdout has content after the JSON closing brace: ${JSON.stringify(afterJson)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('failure: JSON error is the last thing on stdout', () => {
  const dir = sandbox();
  try {
    // Trigger a usage error (missing arguments) with --json
    const r = setStatus(dir, ['--json']);
    assert.notEqual(r.status, 0, 'expected non-zero exit for usage error');

    // Find the JSON object in stdout
    const jsonStart = r.stdout.indexOf('{');
    assert.notEqual(jsonStart, -1, 'no JSON object found in stdout');

    // Extract everything after the closing brace
    const jsonEnd = r.stdout.lastIndexOf('}');
    assert.notEqual(jsonEnd, -1, 'no closing brace found in stdout');

    const afterJson = r.stdout.slice(jsonEnd + 1);

    // Assert that nothing follows the JSON but whitespace
    assert.equal(
      afterJson.trim(),
      '',
      `stdout has content after the JSON closing brace: ${JSON.stringify(afterJson)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
