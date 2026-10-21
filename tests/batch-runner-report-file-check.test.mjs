// tests/batch-runner-report-file-check.test.mjs — the "did the worker write a
// report?" check must not depend on `compgen`.
//
// THE BUG THIS PINS
//
// batch-runner.sh verified each worker's report with
// `compgen -G "$REPORTS_DIR/${report_num}-*.md"`. compgen is a programmable-
// completion builtin, and some bash builds (NixOS among them) leave it out of
// non-interactive shells — the shebang case. There the call failed, its error
// went to /dev/null, the check saw no report, and EVERY worker was recorded as
// failed even with its report on disk. merge-tracker.mjs then refused those
// reports as possibly fabricated, so good evaluations were stranded.
//
// This test extracts the REAL has_report_file() out of batch/batch-runner.sh and
// runs it in a bash with compgen disabled, rather than restating it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash, rmSync } from './helpers.mjs';

const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');
const FN = SRC.match(/^has_report_file\(\) \{\n[\s\S]*?\n\}\n/m);

// Run has_report_file for `num` against a reports/ dir holding `files`, in a
// bash where `compgen` does not exist. Returns the function's exit status.
function check(files, num) {
  const root = mkdtempSync(join(tmpdir(), 'batch-report-check-'));
  try {
    for (const f of files) writeFileSync(join(root, f), 'x\n');
    const script = [
      'set -euo pipefail',
      'enable -n compgen 2>/dev/null || true',
      `REPORTS_DIR=${JSON.stringify(root)}`,
      FN[0],
      `if has_report_file ${JSON.stringify(num)}; then echo yes; else echo no; fi`,
    ].join('\n');
    const r = spawnSync(getBash(), ['-c', script], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('has_report_file is defined in batch-runner.sh', () => {
  assert.ok(FN, 'could not find has_report_file() in batch/batch-runner.sh — this test needs updating');
});

test('batch-runner.sh does not call compgen', () => {
  const code = SRC.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /\bcompgen\b/);
});

test('finds a real report without compgen', { skip: !FN }, () => {
  assert.equal(check(['042-acme-2026-01-01.md'], '042'), 'yes');
});

test('the reservation sentinel alone does not count as a report', { skip: !FN }, () => {
  assert.equal(check(['042-RESERVED.md'], '042'), 'no');
  assert.equal(check(['042-RESERVED.md', '042-acme-2026-01-01.md'], '042'), 'yes');
});

test('no report, or a report for another number, is a miss', { skip: !FN }, () => {
  assert.equal(check([], '042'), 'no');
  assert.equal(check(['043-acme-2026-01-01.md', '0420-acme-2026-01-01.md'], '042'), 'no');
});
