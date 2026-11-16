import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cjsFs = require('node:fs');
const PLUGINS = new URL('../plugins.mjs', import.meta.url).href;

// Own process so umask 0077 does not leak into the other tests.
if (process.env.CO_PLUGINS_MODE_CHECK === '1') {
  process.umask(0o077);
  const dir = process.env.CO_PLUGINS_DIR;
  const file = join(dir, 'config', 'plugins.yml');
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(file, 'plugins: {}\n');
  chmodSync(file, 0o640);
  const { setPluginEnabled } = await import(`${PLUGINS}?umask=${Date.now()}`);
  setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
  const mode = statSync(file).mode & 0o777;
  if (mode !== 0o640) {
    console.error(`mode ${mode.toString(8)}`);
    process.exit(1);
  }
  process.exit(0);
}

test('a failed publish leaves the previous plugins.yml and no temp file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-'));
  mkdirSync(join(dir, 'config'));
  try {
    const { setPluginEnabled } = await import(`${PLUGINS}?atomic=${Date.now()}`);
    setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
    const file = join(dir, 'config', 'plugins.yml');
    const before = readFileSync(file, 'utf8');
    assert.match(before, /enabled: true/);

    const realRename = cjsFs.renameSync;
    cjsFs.renameSync = () => {
      throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
    };
    syncBuiltinESMExports();
    try {
      const again = await import(`${PLUGINS}?atomic-fail=${Date.now()}`);
      assert.throws(
        () => again.setPluginEnabled(dir, 'h1b-sponsor', false),
        /no space/,
      );
      assert.equal(readFileSync(file, 'utf8'), before);
      assert.equal(readdirSync(join(dir, 'config')).some((name) => name.endsWith('.tmp')), false);
    } finally {
      cjsFs.renameSync = realRename;
      syncBuiltinESMExports();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saving keeps the existing plugins.yml mode', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows does not apply POSIX permission bits');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-mode-'));
  mkdirSync(join(dir, 'config'));
  const file = join(dir, 'config', 'plugins.yml');
  try {
    writeFileSync(file, 'plugins: {}\n');
    chmodSync(file, 0o600);
    const { setPluginEnabled } = await import(`${PLUGINS}?mode=${Date.now()}`);
    setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
    assert.match(readFileSync(file, 'utf8'), /enabled: true/);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saving keeps mode 0640 when the umask is 0077', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows does not apply POSIX permission bits');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-umask-'));
  mkdirSync(join(dir, 'config'));
  try {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: join(fileURLToPath(new URL('..', import.meta.url))),
      env: { ...process.env, CO_PLUGINS_MODE_CHECK: '1', CO_PLUGINS_DIR: dir },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
