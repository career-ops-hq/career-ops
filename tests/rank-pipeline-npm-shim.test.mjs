// tests/rank-pipeline-npm-shim.test.mjs — the ranker runs an agent CLI that npm
// installed, on Windows too.
//
// npm installs a global CLI on Windows as `<name>.cmd`, `<name>.ps1` and an
// extensionless POSIX script. execFileSync('<name>') runs none of them there, so
// before this the ranker reported every installed CLI as missing: "No supported
// agent CLI found", or "<name> not found" with --cli. The fixture below is that
// layout around a fake CLI, and the prompt carries a posting title with `&` and
// quotes, which a shell would have split or run as a command.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { describeCliFailure } from '../rank-pipeline.mjs';
import { resolveCliLaunch } from '../lib/agent-launch.mjs';

const TITLE = 'R&D "Labs" & Ops';

// What npm leaves in its global bin directory for a package named fake-<bin>.
function npmShims(dir, bin, cliBody) {
  const cli = join(dir, 'node_modules', `fake-${bin}`, 'cli.js');
  mkdirSync(join(dir, 'node_modules', `fake-${bin}`), { recursive: true });
  writeFileSync(cli, cliBody);
  writeFileSync(join(dir, `${bin}.cmd`), `@ECHO off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\fake-${bin}\\cli.js" %*\r\n`);
  writeFileSync(join(dir, `${bin}.ps1`), [
    '#!/usr/bin/env pwsh',
    '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent',
    `& "$basedir/node$exe"  "$basedir/node_modules/fake-${bin}/cli.js" $args`,
    'exit $LASTEXITCODE',
    '',
  ].join('\n'));
  writeFileSync(join(dir, bin), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
  chmodSync(join(dir, bin), 0o755);
  return cli;
}

function sandbox(t, bin) {
  const root = mkdtempSync(join(tmpdir(), 'rank-npm-shim-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'npm'));
  writeFileSync(join(root, 'data', 'pipeline.md'), `- [ ] https://example.test/0 | ${TITLE} | Engineer\n`);
  const argvLog = join(root, 'argv.json');
  // Answers every posting and records the argv it was given.
  npmShims(join(root, 'npm'), bin, [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));`,
    "const prompt = process.argv.find(a => a.includes('POSTINGS:')) || '';",
    "const n = (prompt.match(/^\\d+\\./gm) || []).length;",
    "console.log(JSON.stringify(Array.from({ length: n }, (_, id) => ({ id, score: 4, reason: 'Fixture match' }))));",
    '',
  ].join('\n'));
  return { root, argvLog };
}

// PATH holds only the npm directory, so auto-detection can find nothing else.
// On Windows the variable is spelled Path, and two spellings in one block would
// leave which one the child reads up to chance.
function rank(root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !/^path$/i.test(k) && !/^CAREER_OPS_(CLI|RANK_CLI|DATA_DIR)$/.test(k)));
  const result = spawnSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--dry-run', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...env, CAREER_OPS_ROOT: root, PATH: join(root, 'npm') },
  });
  assert.ifError(result.error);
  return result;
}

test('--cli runs an npm-installed CLI and hands it the prompt as one argument', (t) => {
  const { root, argvLog } = sandbox(t, 'grok');
  const result = rank(root, ['--cli', 'grok']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /would annotate 1 of 1/);
  const argv = JSON.parse(readFileSync(argvLog, 'utf8'));
  assert.equal(argv[0], '-p');
  assert.ok(argv[1].includes(TITLE), `the prompt lost the posting title: ${JSON.stringify(argv[1]).slice(0, 200)}`);
  assert.equal(argv[2], '--disable-web-search');
});

test('auto-detection finds an npm-installed CLI', (t) => {
  const { root } = sandbox(t, 'codex');
  const result = rank(root, []);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /No supported agent CLI found/);
  assert.match(result.stdout, /would annotate 1 of 1/);
});

// The resolution itself, simulated as Windows on every platform so a POSIX CI
// leg checks it too.
test('on Windows the shim resolves to the script npm wrapped, run by this node', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rank-npm-resolve-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = npmShims(dir, 'codex', '');
  // The shim's directory sits between two that do not exist, so splitting PATH
  // on anything but `;` leaves no entry that names it.
  const PATH = [join(dir, 'missing'), dir, join(dir, 'missing-too')].join(win32.delimiter);
  const env = { PATH, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.deepEqual(resolveCliLaunch('codex', ['exec', 'p'], { platform: 'win32', env }),
    { command: process.execPath, args: [cli, 'exec', 'p'] });
  // Not on PATH: the bare name is kept, so the caller still reports "not found".
  assert.deepEqual(resolveCliLaunch('claude', ['-p'], { platform: 'win32', env }), { command: 'claude', args: ['-p'] });
  // Elsewhere nothing changes.
  assert.deepEqual(resolveCliLaunch('codex', ['exec'], { platform: 'linux', env }), { command: 'codex', args: ['exec'] });
});

test('a .cmd with no npm wrapper beside it fails with the reason, not "not found"', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rank-npm-bare-cmd-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'qwen.cmd'), '@echo off\r\n');
  let err;
  try {
    resolveCliLaunch('qwen', ['-p', 'x'], { platform: 'win32', env: { PATH: dir, PATHEXT: '.CMD' } });
  } catch (e) { err = e; }
  assert.equal(err?.code, 'ERR_CLI_LAUNCH');
  assert.match(describeCliFailure(err, 'qwen'), /Cannot launch .*qwen\.cmd without a shell/);
});
