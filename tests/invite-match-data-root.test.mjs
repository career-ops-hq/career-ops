// invite-match regression coverage for split code/data roots (#3867, finding 4).
//
// applyRejectionStatus() spawns set-status.mjs, a sibling in the *code*
// checkout. It used to resolve that path off CAREER_OPS — the *data* root —
// so with an external data root the child died with
// `Cannot find module <data-root>/set-status.mjs`.
//
// The CLI is exercised as a child process because importing invite-match.mjs
// resolves its roots at module load. Every path points at a disposable
// external data root; no test reads or writes the repository's user-layer
// fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
].join('\n');

/** Seed a disposable data root outside the code checkout and return its tracker path. */
function seedDataRoot() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-invite-root-'));
  const tracker = join(dataRoot, 'data', 'applications.md');
  mkdirSync(dirname(tracker), { recursive: true });
  writeFileSync(
    tracker,
    `${TRACKER_HEADER}\n| 1 | 2026-01-01 | Fabrikam | Engineer | 4.0/5 | Applied | ❌ | [1](../reports/001-fabrikam.md) | seeded |\n`,
  );
  return { dataRoot, tracker };
}

/** Run invite-match.mjs with the data root detached from the code checkout. */
function runInviteMatchApply(dataRoot, tracker, stdin) {
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_TRACKER: tracker };
  delete env.CAREER_OPS_DATA_DIR;
  const result = spawnSync(process.execPath, [join(CODE_ROOT, 'invite-match.mjs'), '--apply', '--id', '1'], {
    cwd: CODE_ROOT,
    env,
    input: stdin,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, `invite-match failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `invite-match was killed by ${result.signal}`);
  return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// `Company: <name>` is the first of invite-match's COMPANY_LINE_PATTERNS, so
// this pins the tracker row deterministically instead of relying on prose
// phrasing that the matcher may tighten later.
const REJECTION = [
  'Subject: Your application',
  'Company: Fabrikam',
  '',
  'Thank you for your interest in the Engineer role.',
  'After careful consideration we have decided not to move forward with your application.',
].join('\n');

test('--apply resolves set-status.mjs from the code root, not the data root', () => {
  const { dataRoot, tracker } = seedDataRoot();
  try {
    const result = runInviteMatchApply(dataRoot, tracker, REJECTION);

    // The specific pre-fix failure: the sibling script was looked up under the
    // data root. Asserted by name so a future regression is unmistakable.
    assert.doesNotMatch(
      result.output,
      /Cannot find module/,
      `invite-match resolved a sibling script off the data root:\n${result.output}`,
    );
    assert.equal(result.status, 0, result.output);
    assert.match(readFileSync(tracker, 'utf-8'), /\| Rejected \|/, 'tracker row was not advanced to Rejected');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
