// Explicit submitted-CV selection must fail closed before artifact or tracker writes.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
const root = mkdtempSync(join(tmpdir(), 'career-ops-outcome-commit-'));
mkdirSync(join(root, 'data'), { recursive: true });
const tracker = join(root, 'data', 'applications.md');
const initial = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-05 | Fictional | Engineer | 4/5 | Applied | — | — | notes |\n';
writeFileSync(tracker, initial);
writeFileSync(join(root, 'cv.md'), '# Fictional master CV\n');
const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '100', CAREER_OPS_TRACKER_LOCK_RETRY_MS: '10' };
const run = args => spawnSync(process.execPath, [join(ROOT, 'outcome.mjs'), '1', 'hired', '--json', ...args], { env, encoding: 'utf8' });
function check(label, fn) { try { fn(); pass(label); } catch (e) { fail(`${label}: ${e.message}`); process.exitCode = 1; } }

try {
  for (const path of [join(root, 'missing.pdf'), root]) {
    for (const flags of [[], ['--dry-run']]) {
      const r = run(['--cv', path, ...flags]);
      check('missing/non-file explicit CV fails without mutation' + flags.join(' '), () => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stdout + r.stderr, /CV.*(read|file|invalid)|invalid-cv/i);
        assert.equal(readFileSync(tracker, 'utf8'), initial);
        assert.equal(existsSync(join(root, 'data', 'outcomes')), false);
      });
    }
  }
  const pdf = join(root, 'submitted.pdf');
  const bytes = '%PDF-fictional selected submission';
  writeFileSync(pdf, bytes);
  const selected = run(['--cv', pdf]);
  check('existing explicit PDF is archived rather than the master CV', () => {
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(readFileSync(join(root, 'data', 'outcomes', '1_fictional_engineer', 'submitted_cv.pdf'), 'utf8'), bytes);
  });
  rmSync(join(root, 'data', 'outcomes'), { recursive: true, force: true });
  const automatic = run([]);
  check('omitted --cv retains automatic master-CV fallback', () => {
    assert.equal(automatic.status, 0, automatic.stderr);
    assert.equal(readFileSync(join(root, 'data', 'outcomes', '1_fictional_engineer', 'submitted_cv.md'), 'utf8'), '# Fictional master CV\n');
  });
} finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
