// `npm run ui` on a checkout where web/ has no dependencies installed must say
// so before printing a URL, and a server that dies on startup must not be
// blamed on the port.
//
// The launcher finds web/ next to its own directory, so each test copies it and
// the modules it imports into a throwaway tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const COPIED = [
  'scripts/ui-server.mjs',
  'path-resolver.mjs',
  'web/src/lib/bind-host.mjs',
  'web/src/lib/origin-guard.mjs',
];

function launcherTree() {
  const dir = mkdtempSync(join(tmpdir(), 'co-ui-server-'));
  for (const rel of COPIED) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(dir, rel));
  }
  writeFileSync(join(dir, 'web', 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^15.0.0' } }));
  return dir;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function launch(dir) {
  const port = await freePort();
  const run = spawnSync(process.execPath, [join(dir, 'scripts', 'ui-server.mjs'), '--no-open', `--port=${port}`], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_WEB_ALLOWED_HOSTS: '' },
  });
  return { ...run, port };
}

test('missing web dependencies are named, with the install command, before any URL', async () => {
  const dir = launcherTree();
  try {
    const run = await launch(dir);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Web UI dependencies are not installed/);
    assert.match(run.stderr, /npm --prefix web ci/);
    assert.doesNotMatch(run.stdout, /Web UI:/);
    assert.doesNotMatch(run.stderr, /Port may be occupied/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a server that exits during startup is not blamed on the port', async () => {
  const dir = launcherTree();
  try {
    const nextDir = join(dir, 'web', 'node_modules', 'next');
    mkdirSync(nextDir, { recursive: true });
    writeFileSync(join(nextDir, 'package.json'), JSON.stringify({ name: 'next', version: '15.0.0', bin: { next: 'cli.js' } }));
    writeFileSync(join(dir, 'web', 'server.mjs'), 'process.exitCode = 3;\n');
    const run = await launch(dir);
    assert.equal(run.status, 3);
    assert.doesNotMatch(run.stderr, /Port may be occupied/);
    assert.match(run.stderr, /exited with code 3 before it was ready/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
