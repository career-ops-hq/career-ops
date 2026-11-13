// tests/aggregate-tokens-answer-help.test.mjs — batch/aggregate-tokens.mjs
// answers --help and -h with its usage.
//
// It read no arguments, so --help fell through and the script printed the last
// batch's token breakdown, or "No state file found." without one. It was on
// KNOWN_WITHOUT_HELP in tests/help-flag-handled.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('aggregate-tokens answers --help and -h with its usage, without reading the batch state', () => {
  for (const flag of ['--help', '-h']) {
    const r = spawnSync(process.execPath, [join(ROOT, 'batch', 'aggregate-tokens.mjs'), flag], { cwd: tmpdir(), encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 0, `${flag}: ${r.stderr}`);
    assert.match(r.stdout, /^Usage: node batch\/aggregate-tokens\.mjs/, flag);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /No state file found|No worker logs found|Per-Worker Token Breakdown/, `${flag} must not read the batch`);
  }
});
