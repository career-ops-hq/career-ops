// doctor warns when web/ has no dependencies installed, because `npm run ui`
// cannot start without them. The web UI is optional, so this is a warning.
//
// Driven through --target, as in tests/doctor-dependency-resolution.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCTOR = join(ROOT, 'doctor.mjs');
const WEB_DEP = 'co-doctor-fake-web-framework';

function checkout({ web, installed }) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-web-deps-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: {} }));
  if (web) {
    mkdirSync(join(dir, 'web'));
    writeFileSync(join(dir, 'web', 'package.json'), JSON.stringify({ name: 'web', dependencies: { [WEB_DEP]: '^1.0.0' } }));
  }
  if (installed) {
    const pkg = join(dir, 'web', 'node_modules', WEB_DEP);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: WEB_DEP, version: '1.0.0' }));
  }
  return dir;
}

function doctorOutput(dir) {
  const run = spawnSync(process.execPath, [DOCTOR, '--target', dir], { cwd: dir, encoding: 'utf-8' });
  assert.equal(run.stderr, '', `doctor wrote to stderr: ${run.stderr}`);
  return run.stdout;
}

function withCheckout(shape, fn) {
  const dir = checkout(shape);
  try {
    fn(doctorOutput(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('missing web dependencies warn and give the install command', () => {
  withCheckout({ web: true, installed: false }, (out) => {
    assert.match(out, /⚠ Web UI dependencies are not installed/);
    assert.match(out, /npm --prefix web ci/);
  });
});

test('installed web dependencies pass', () => {
  withCheckout({ web: true, installed: true }, (out) => {
    assert.match(out, /✓ Web UI dependencies installed/);
  });
});

test('a checkout without web/ reports nothing about it', () => {
  withCheckout({ web: false, installed: false }, (out) => {
    assert.doesNotMatch(out, /Web UI dependencies/);
  });
});
