// tests/remember-cli.test.mjs — setup records the agent CLI once, and doctor and
// the ranker both use it.
//
// Nothing wrote CAREER_OPS_CLI, so doctor fell back to claude even where claude
// was not installed, and rank-pipeline.mjs ran the first CLI on PATH instead of
// the one the user set up in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'co-remember-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  return dir;
}

function baseEnv(dir, extra = {}) {
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_RANK_CLI: '', ...extra };
  delete env.CAREER_OPS_CLI;
  delete env.OPENCODE;
  return env;
}

function node(dir, args, extra) {
  const result = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', timeout: 30_000, env: baseEnv(dir, extra) });
  assert.ifError(result.error);
  return result;
}

test('remember-cli writes CAREER_OPS_CLI to the data root .env and keeps other lines', (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, '.env'), 'OPENROUTER_MODEL=example/model\nCAREER_OPS_CLI=claude\n');
  const result = node(dir, [join(ROOT, 'remember-cli.mjs'), 'grok']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'OPENROUTER_MODEL=example/model\nCAREER_OPS_CLI=grok\n');
});

test('remember-cli creates .env when there is none', (t) => {
  const dir = sandbox(t);
  assert.equal(node(dir, [join(ROOT, 'remember-cli.mjs'), 'codex']).status, 0);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'CAREER_OPS_CLI=codex\n');
});

test('remember-cli refuses an unknown CLI and writes nothing', (t) => {
  const dir = sandbox(t);
  const result = node(dir, [join(ROOT, 'remember-cli.mjs'), 'not-a-cli']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not-a-cli/);
  assert.equal(existsSync(join(dir, '.env')), false);
});

test('remember-cli keeps the .env file mode', {
  skip: process.platform === 'win32' && 'POSIX file modes',
}, (t) => {
  const dir = sandbox(t);
  writeFileSync(join(dir, '.env'), 'EXAMPLE_API_KEY=fake\n', { mode: 0o600 });
  chmodSync(join(dir, '.env'), 0o600);
  assert.equal(node(dir, [join(ROOT, 'remember-cli.mjs'), 'codex']).status, 0);
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'EXAMPLE_API_KEY=fake\nCAREER_OPS_CLI=codex\n');
});

test('doctor reports the remembered CLI', (t) => {
  const dir = sandbox(t);
  node(dir, [join(ROOT, 'remember-cli.mjs'), 'grok']);
  const result = node(dir, [join(ROOT, 'doctor.mjs'), '--json', '--target', dir]);
  const state = JSON.parse(result.stdout);
  assert.equal(state.active_cli, 'grok');
});

for (const [remembered, bin, call] of [['opencode', 'opencode', 'opencode run'], ['antigravity', 'agy', 'agy -p']]) {
  test(`rank-pipeline runs the remembered CLI (${remembered}) when several are installed`, {
    skip: process.platform === 'win32' && 'POSIX executable fixture',
  }, (t) => {
    const dir = sandbox(t);
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'data', 'pipeline.md'), '- [ ] https://example.test/job | Example | Engineer');
    for (const cli of ['claude', bin]) {
      const binary = join(dir, 'bin', cli);
      writeFileSync(binary, `#!${process.execPath}\n`
        + `if (process.argv[2] !== '--version') require('node:fs').writeFileSync(process.env.RANK_CALL, ${JSON.stringify(cli)} + ' ' + process.argv[2]);\n`
        + `console.log('[{"id":0,"score":3,"reason":"Fixture match"}]');\n`);
      chmodSync(binary, 0o755);
    }
    node(dir, [join(ROOT, 'remember-cli.mjs'), remembered]);
    const callFile = join(dir, 'call.txt');
    const result = node(dir, [join(ROOT, 'rank-pipeline.mjs'), '--dry-run'], {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      RANK_CALL: callFile,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(callFile, 'utf8'), call);
  });
}
