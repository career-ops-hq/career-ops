// Check the retained doctor CLI rejects missing flag values without accessing data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function runScript(script, ...args) {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(r.error, undefined, `${script} failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `${script} was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// --- missing operand for a RECOGNIZED value-taking flag (#3087) ------------
//
// A different defect than an unrecognized flag: the flag is spelled right,
// but nothing (or another flag) follows it, so flagValue()/indexOf() reads
// the wrong thing as the value and the script proceeds on it silently at
// exit 0 — doctor.mjs diagnosing a directory literally named "--json" is the
// sharpest case. validateFlags's `requireOperand` option closes this for
// callers that opt in; each case below fails inside validateFlags itself,
// before any data/ access, so — like the --today/--summary case above — no
// fixture is needed.

test('doctor: --target --json does not diagnose a directory named "--json"', () => {
  const r = runScript('doctor.mjs', '--target', '--json');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--target requires a value/);
});
