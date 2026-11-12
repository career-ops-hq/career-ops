// tests/validators-answer-help.test.mjs — validate-plugin-registry.mjs and
// validate-untrusted-content-coverage.mjs answer --help and -h with their usage.
//
// Neither read --help, so the flag fell through and the full check ran and
// printed its verdict ("✓ plugin registry is valid", "OK: canonical directive
// present ..."), which reads as an answer to a question nobody asked. Both were
// on KNOWN_WITHOUT_HELP in tests/help-flag-handled.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

for (const [script, verdict] of [
  ['validate-plugin-registry.mjs', /plugin registry is valid|✗/],
  ['validate-untrusted-content-coverage.mjs', /canonical directive|FAIL/],
]) {
  test(`${script} answers --help and -h with its usage, without running the check`, () => {
    for (const flag of ['--help', '-h']) {
      const r = spawnSync(process.execPath, [join(ROOT, script), flag], { cwd: tmpdir(), encoding: 'utf8', timeout: 30_000 });
      assert.equal(r.status, 0, `${flag}: ${r.stderr}`);
      assert.match(r.stdout, new RegExp(`^Usage: node ${script.replace('.', '\\.')}`), flag);
      assert.doesNotMatch(`${r.stdout}${r.stderr}`, verdict, `${flag} must not run the check`);
    }
  });
}
