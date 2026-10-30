// tests/run-bounded.test.mjs — lib/run-bounded.mjs must start the script it
// bounds without a console window.
//
// set-status.mjs --detach-jd-archive starts the runner with detached: true. On
// Windows that is DETACHED_PROCESS, so the runner has no console at all, and a
// console program it starts without windowsHide gets a new console of its
// own: a visible window for as long as archive-posting runs. Each web or
// dashboard move to Interview opened one, and so did the detached cases in
// tests/set-status-archives-jd.test.mjs.
//
// A preload records the options the runner hands execFileSync, so this runs
// the same on every platform. windowsHide is a no-op off Windows.
//
// Run:  node --test tests/run-bounded.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUNNER = join(ROOT, 'lib', 'run-bounded.mjs');

const RECORDER = [
  "import childProcess from 'node:child_process';",
  "import { syncBuiltinESMExports } from 'node:module';",
  "import { writeFileSync } from 'node:fs';",
  'const real = childProcess.execFileSync;',
  'childProcess.execFileSync = function recordingExecFileSync(file, args, options) {',
  '  writeFileSync(process.env.RUN_BOUNDED_RECORD, JSON.stringify({ file, args, options }));',
  '  return real.call(this, file, args, options);',
  '};',
  'syncBuiltinESMExports();',
].join('\n');

test('run-bounded starts the bounded script with windowsHide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-run-bounded-'));
  try {
    const recorder = join(dir, 'recorder.mjs');
    const script = join(dir, 'script.mjs');
    const record = join(dir, 'record.json');
    const ran = join(dir, 'ran');
    writeFileSync(recorder, RECORDER);
    writeFileSync(script, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(ran)}, '1');`);

    const r = spawnSync(process.execPath, ['--import', pathToFileURL(recorder).href, RUNNER, '20000', script], {
      encoding: 'utf-8',
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, RUN_BOUNDED_RECORD: record },
    });

    assert.equal(r.status, 0, describeSpawn(r));
    assert.ok(existsSync(record), 'the recorder never saw an execFileSync call');
    assert.ok(existsSync(ran), 'the bounded script never ran');
    const { file, args, options } = JSON.parse(readFileSync(record, 'utf-8'));
    assert.equal(file, process.execPath);
    assert.deepEqual(args, [script]);
    assert.equal(options.windowsHide, true, 'the bounded script is started without windowsHide');
    assert.equal(options.timeout, 20000);
    assert.equal(options.stdio, 'ignore');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
