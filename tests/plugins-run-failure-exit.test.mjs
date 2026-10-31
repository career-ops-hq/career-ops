import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkNodeModules } from './helpers.mjs';

// A plugin run that throws was reported as "0 found, 0 new" and exit 0.
// An agent treating that as an empty inbox never sees the bad setting.
//
// `plugins.mjs run` pins plugins.lock beside the checkout it is started from,
// and a local plugin has to live in that checkout's plugins.local/. The
// data-root guard fingerprints both. This test copies plugins.mjs and its
// imports into a temp checkout and runs there, the same way
// plugins-remove-id-guard.test.mjs does. The real checkout is not the write target.

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  const spec = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    if (!existsSync(file)) continue;
    seen.add(file);
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(spec)) {
      const s = m[1];
      if (!s.startsWith('.')) continue;
      queue.push(join(dirname(file), s));
    }
  }
  return [...seen];
}

const DATA_FILES = ['tracker-aliases.json'];

function disposableCheckout() {
  const checkout = mkdtempSync(join(tmpdir(), 'plugin-run-fail-checkout-'));
  for (const file of importClosure(join(ROOT, 'plugins.mjs'))) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('..')) continue;
    const dest = join(checkout, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(file, dest);
  }
  for (const name of DATA_FILES) {
    cpSync(join(ROOT, name), join(checkout, name));
  }
  const linkReason = linkNodeModules(checkout, ROOT);
  if (linkReason) throw new Error(`linkNodeModules could not give the fixture a dependency tree: ${linkReason}`);

  const plugin = join(checkout, 'plugins.local', 'fixture-run');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'manifest.json'), JSON.stringify({
    id: 'fixture-run',
    name: 'Fixture run',
    version: '0.0.0',
    apiVersion: 1,
    description: 'Throws unless settings.mode is list.',
    hooks: ['ingest'],
    requiredEnv: [],
    allowedHosts: [],
    humanInTheLoop: true,
    entry: 'index.mjs',
  }));
  writeFileSync(join(plugin, 'index.mjs'), `export default { async ingest(ctx) {
  if (ctx.settings?.mode !== 'list') {
    throw new Error('settings.mode must be list. Set plugins.fixture-run.mode: list in config/plugins.yml.');
  }
  return [];
}};
`);
  return checkout;
}

function dataRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fixture-run-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n');
  writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n');
  return root;
}

function run(checkout, root) {
  return spawnSync(process.execPath, [join(checkout, 'plugins.mjs'), 'run', 'fixture-run'], {
    cwd: checkout,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, CAREER_OPS_ROOT: root, NO_COLOR: '1' },
  });
}

test('a plugin run that rejects its settings exits 1 and does not claim zero jobs', (t) => {
  const lockPath = join(ROOT, 'plugins.lock');
  const lockBefore = existsSync(lockPath) ? readFileSync(lockPath) : null;
  const fixtureInRepo = join(ROOT, 'plugins.local', 'fixture-run');
  const checkout = disposableCheckout();
  t.after(() => {
    rmSync(checkout, { recursive: true, force: true });
    assert.equal(existsSync(fixtureInRepo), false, 'the fixture must not be written into the real checkout');
    const lockAfter = existsSync(lockPath) ? readFileSync(lockPath) : null;
    assert.deepEqual(lockAfter, lockBefore, 'plugins.lock in the real checkout must be unchanged');
  });

  const bad = dataRoot();
  t.after(() => rmSync(bad, { recursive: true, force: true }));
  writeFileSync(join(bad, 'config', 'plugins.yml'), 'plugins:\n  fixture-run:\n    enabled: true\n    mode: nope\n');
  const failed = run(checkout, bad);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /settings\.mode must be list/);
  assert.match(failed.stderr, /config\/plugins\.yml/);
  assert.doesNotMatch(failed.stdout, /0 found/);

  const good = dataRoot();
  t.after(() => rmSync(good, { recursive: true, force: true }));
  writeFileSync(join(good, 'config', 'plugins.yml'), 'plugins:\n  fixture-run:\n    enabled: true\n    mode: list\n');
  const ok = run(checkout, good);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /0 found, 0 new/);
});
