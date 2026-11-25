import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { describeCliFailure } from '../rank-pipeline.mjs';

test('a CLI that fails every batch exits 1 with a one-line reason and no prompt echo', t => {
  const root = mkdtempSync(join(tmpdir(), 'rank-fail-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'cv.md'), '# Jordan Rivera\n\nFICTIONAL-CV-MARKER senior engineer\n');
  const pipeline = join(root, 'data', 'pipeline.md');
  const original = Array.from({ length: 12 }, (_, i) => `- [ ] https://example.test/${i} | Example | Engineer`).join('\n') + '\n';
  writeFileSync(pipeline, original);
  // `node -p <prompt>` evaluates the prompt as JavaScript and fails with a
  // SyntaxError, an offline stand-in for a CLI whose login has expired.
  const result = spawnSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--cli', process.execPath], {
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /FICTIONAL-CV-MARKER/);
  assert.doesNotMatch(result.stderr, /Command failed/);
  assert.equal(result.stderr.match(/CLI call failed \(.* exited with code 1: SyntaxError/g)?.length, 2, result.stderr);
  assert.match(result.stderr, /Every call to .* failed/);
  assert.equal(readFileSync(pipeline, 'utf8'), original);
});

test('describeCliFailure picks the error line and strips color codes', () => {
  const err = { status: 1, stderr: '\x1b[0m\n> build · some-model\n\x1b[0m\n\x1b[91m\x1b[1mError: \x1b[0mAPI key expired.\n', message: 'Command failed: opencode run SECRET PROMPT' };
  assert.equal(describeCliFailure(err, 'opencode'), 'opencode exited with code 1: Error: API key expired.');
  assert.equal(describeCliFailure({ code: 'ETIMEDOUT', message: 'spawnSync opencode ETIMEDOUT' }, 'opencode'), 'opencode timed out');
  assert.equal(describeCliFailure({ status: 2, stderr: '' }, 'codex'), 'codex exited with code 2');
});
