// tests/rejection-latency-missing-file.test.mjs — an explicit --file or
// --tracker that does not exist is an error, not an empty report.
//
// readNormalized() returns '' for a path that does not exist, so a mistyped
// --file printed zero flags at exit 0: a clean result on data the script never
// opened. process-quality.mjs had the same gap (#7781). The default paths may
// still be absent: a new user with no interviews yet gets zero rows at exit 0.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const dir = mkdtempSync(join(tmpdir(), 'rejection-latency-missing-file-'));
try {
  const interviews = join(dir, 'active-interviews.md');
  const tracker = join(dir, 'applications.md');
  writeFileSync(interviews, [
    '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |',
    '|---|---|---|---|---|---|---|',
    '',
  ].join('\n'));
  writeFileSync(tracker, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '',
  ].join('\n'));
  const missing = join(dir, 'does-not-exist.md');
  // CAREER_OPS_ROOT points at the temp dir so the default paths never reach the
  // caller's real workspace.
  const run = (args) => spawnSync(NODE, [join(ROOT, 'rejection-latency.mjs'), ...args], {
    encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir },
  });

  console.log('\nrejection-latency CLI — an explicit path must exist');

  for (const [flag, args] of [
    ['--file', ['--file', missing, '--tracker', tracker]],
    ['--tracker', ['--file', interviews, '--tracker', missing]],
  ]) {
    ok(`a missing ${flag} exits 1 and names the file`, () => {
      const r = run(args);
      assert.strictEqual(r.status, 1);
      assert.ok(r.stderr.includes(`rejection-latency: file not found: ${missing}`), r.stderr);
      assert.strictEqual(r.stdout, '');
    });
  }

  ok('existing files still report at exit 0', () => {
    const r = run(['--file', interviews, '--tracker', tracker]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).metadata.interviewRows, 0);
  });

  ok('absent default paths still report zero rows at exit 0', () => {
    const empty = mkdtempSync(join(tmpdir(), 'rejection-latency-empty-root-'));
    try {
      const r = spawnSync(NODE, [join(ROOT, 'rejection-latency.mjs')], {
        encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: empty },
      });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(JSON.parse(r.stdout).metadata.interviewRows, 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
