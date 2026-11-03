// tests/batch-tailor-npm-claude.test.mjs — batch-tailor runs a claude that npm
// installed, on Windows too.
//
// npm installs claude on Windows as claude.cmd, claude.ps1 and an extensionless
// POSIX script, and spawnSync('claude') runs none of them there: before this,
// every job failed with "Error running claude: spawnSync claude ENOENT". The
// fake claude below is installed that way (tests/helpers/fake-cli.mjs) and
// records the argv it was given.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { envWithPathFirst, writeFakeCli } from './helpers/fake-cli.mjs';

test('an npm-installed claude is run once per selected job, with the prompt as one argument', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'batch-tailor-npm-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  mkdirSync(join(root, 'bin'));
  const state = join(root, 'batch-state.tsv');
  writeFileSync(state, 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
    + '1\thttps://example.com/jobs/1?a=1&b=2\tcompleted\t-\t-\t001\t4.5\t-\t0\n');
  const calls = join(root, 'calls.jsonl');
  writeFakeCli(join(root, 'bin'), 'claude',
    `require('node:fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);

  const result = spawnSync(process.execPath, [join(ROOT, 'batch-tailor.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: envWithPathFirst(join(root, 'bin'), { CAREER_OPS_ROOT: root, CAREER_OPS_BATCH_STATE: state }),
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Finished tailoring for Report 001/);
  const runs = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(runs.length, 1);
  const argv = runs[0];
  assert.equal(argv[0], '-p');
  assert.ok(argv.at(-1).includes('URL: https://example.com/jobs/1?a=1&b=2'),
    `the prompt lost its URL: ${JSON.stringify(argv.at(-1))}`);
});
