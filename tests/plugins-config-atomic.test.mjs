import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync, statSync, symlinkSync, lstatSync, readlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cjsFs = require('node:fs');
const PLUGINS = new URL('../plugins.mjs', import.meta.url).href;

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
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./plugins-config-mode-check.mjs', import.meta.url))], {
      cwd: join(fileURLToPath(new URL('..', import.meta.url))),
      env: { ...process.env, CO_PLUGINS_DIR: dir },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saving through a symlink updates the target and leaves the link', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'co-plugins-yml-target-'));
  const target = join(outside, 'plugins.yml');
  const link = join(dir, 'config', 'plugins.yml');
  try {
    writeFileSync(target, 'plugins: {}\n');
    chmodSync(target, 0o600);
    mkdirSync(join(dir, 'config'));
    symlinkSync(target, link);
    const { setPluginEnabled } = await import(`${PLUGINS}?link=${Date.now()}`);
    setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.match(readFileSync(target, 'utf8'), /enabled: true/);
    assert.equal(statSync(target).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a dangling symlink chain creates the missing final file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-chain-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  const intermediate = join(config, 'intermediate.yml');
  const finalFile = join(config, 'final.yml');
  try {
    mkdirSync(config);
    symlinkSync('final.yml', intermediate);
    symlinkSync('intermediate.yml', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?chain=${Date.now()}`);
    setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(lstatSync(intermediate).isSymbolicLink(), true);
    assert.equal(lstatSync(finalFile).isFile(), true);
    assert.match(readFileSync(finalFile, 'utf8'), /enabled: true/);
    assert.equal(readdirSync(config).some((name) => name.endsWith('.tmp')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a relative link through a symlinked config directory updates the file the reader loads', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const data = mkdtempSync(join(tmpdir(), 'co-plugins-yml-data-'));
  const shared = mkdtempSync(join(tmpdir(), 'co-plugins-yml-shared-'));
  const sharedConfig = join(shared, 'config');
  const link = join(sharedConfig, 'plugins.yml');
  try {
    mkdirSync(sharedConfig);
    symlinkSync(sharedConfig, join(data, 'config'));
    symlinkSync('../plugins.yml', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?dirlink=${Date.now()}`);
    setPluginEnabled(data, 'h1b-sponsor', true, { region: 'us' });
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(existsSync(join(data, 'plugins.yml')), false);
    assert.match(readFileSync(join(shared, 'plugins.yml'), 'utf8'), /enabled: true/);
    assert.match(readFileSync(join(data, 'config', 'plugins.yml'), 'utf8'), /enabled: true/);
  } finally {
    rmSync(data, { recursive: true, force: true });
    rmSync(shared, { recursive: true, force: true });
  }
});

test('a link target applies ".." after a directory symlink inside it', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const root = mkdtempSync(join(tmpdir(), 'co-plugins-yml-root-'));
  const shared = mkdtempSync(join(tmpdir(), 'co-plugins-yml-alias-'));
  const config = join(root, 'config');
  const link = join(config, 'plugins.yml');
  try {
    mkdirSync(join(shared, 'nested'));
    mkdirSync(config);
    symlinkSync(join(shared, 'nested'), join(config, 'alias'));
    symlinkSync('alias/../target.yml', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?alias=${Date.now()}`);
    setPluginEnabled(root, 'h1b-sponsor', true, { region: 'us' });
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(existsSync(join(config, 'target.yml')), false);
    assert.match(readFileSync(join(shared, 'target.yml'), 'utf8'), /enabled: true/);
    assert.match(readFileSync(link, 'utf8'), /enabled: true/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(shared, { recursive: true, force: true });
  }
});

test('a backslash in a link target stays part of the file name', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows treats a backslash as a separator');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-slash-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  const literal = join(config, 'team\\settings.yml');
  const decoy = join(config, 'team', 'settings.yml');
  try {
    mkdirSync(join(config, 'team'), { recursive: true });
    writeFileSync(decoy, 'decoy: true\n');
    symlinkSync('team\\settings.yml', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?slash=${Date.now()}`);
    setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.match(readFileSync(literal, 'utf8'), /enabled: true/);
    assert.equal(readFileSync(decoy, 'utf8'), 'decoy: true\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing intermediate link component does not choose another file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-missing-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  try {
    mkdirSync(config);
    symlinkSync('missing/../target.yml', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?missing=${Date.now()}`);
    assert.throws(
      () => setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' }),
      (err) => err?.code === 'ENOENT',
    );
    assert.equal(existsSync(join(config, 'target.yml')), false);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a dangling directory link does not climb out with ".."', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-dangle-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  const alias = join(config, 'alias');
  try {
    mkdirSync(config);
    symlinkSync('no-such-dir', alias);
    symlinkSync('alias/../target.yml', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?dangle=${Date.now()}`);
    assert.throws(
      () => setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' }),
      (err) => err?.code === 'ENOENT',
    );
    assert.equal(existsSync(join(config, 'target.yml')), false);
    assert.equal(lstatSync(alias).isSymbolicLink(), true);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a repeated directory link still reaches the final file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-repeat-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  const alias = join(config, 'alias');
  try {
    mkdirSync(config);
    symlinkSync('.', alias);
    symlinkSync('alias/alias/target.yml', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?repeat=${Date.now()}`);
    setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
    assert.equal(lstatSync(alias).isSymbolicLink(), true);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.match(readFileSync(join(config, 'target.yml'), 'utf8'), /enabled: true/);
    assert.match(readFileSync(link, 'utf8'), /enabled: true/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-directory step in a link target does not choose another file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-file-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  try {
    mkdirSync(config);
    writeFileSync(join(config, 'regular'), 'x');
    symlinkSync('regular/../target.yml', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?file=${Date.now()}`);
    assert.throws(
      () => setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' }),
      (err) => err?.code === 'ENOTDIR',
    );
    assert.equal(existsSync(join(config, 'target.yml')), false);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a dot after a file does not overwrite that file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-dot-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  const regular = join(config, 'regular');
  try {
    mkdirSync(config);
    writeFileSync(regular, 'keep\n');
    symlinkSync('regular/.', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?dot=${Date.now()}`);
    assert.throws(
      () => setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' }),
      (err) => err?.code === 'ENOTDIR',
    );
    assert.equal(readFileSync(regular, 'utf8'), 'keep\n');
    assert.equal(lstatSync(link).isSymbolicLink(), true);

    rmSync(link);
    mkdirSync(join(config, 'nested'));
    symlinkSync('nested/./target.yml', link);
    const again = await import(`${PLUGINS}?dotdir=${Date.now()}`);
    again.setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
    assert.match(readFileSync(join(config, 'nested', 'target.yml'), 'utf8'), /enabled: true/);
    assert.equal(readFileSync(regular, 'utf8'), 'keep\n');
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a trailing slash does not overwrite a file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-slashdir-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  const regular = join(config, 'regular');
  try {
    mkdirSync(config);
    writeFileSync(regular, 'keep\n');
    symlinkSync('regular/', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?slashdir=${Date.now()}`);
    assert.throws(
      () => setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' }),
      (err) => err?.code === 'ENOTDIR',
    );
    assert.equal(readFileSync(regular, 'utf8'), 'keep\n');
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory link with a trailing slash still reaches the next file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-middir-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  const alias = join(config, 'alias');
  const nested = join(config, 'nested');
  const target = join(nested, 'target.yml');
  try {
    mkdirSync(nested, { recursive: true });
    writeFileSync(target, 'plugins:\n  other:\n    enabled: false\n');
    symlinkSync('nested/', alias);
    symlinkSync('alias/target.yml', link);
    const { setPluginEnabled } = await import(`${PLUGINS}?middir=${Date.now()}`);
    setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' });
    const saved = readFileSync(target, 'utf8');
    assert.match(saved, /enabled: true/);
    assert.match(saved, /other:/);
    assert.equal(readFileSync(link, 'utf8'), saved);
    assert.equal(lstatSync(alias).isSymbolicLink(), true);
    assert.equal(readlinkSync(alias), 'nested/');
    assert.equal(lstatSync(link).isSymbolicLink(), true);

    rmSync(link);
    symlinkSync('nested/', link);
    assert.throws(
      () => setPluginEnabled(dir, 'h1b-sponsor', false, { region: 'us' }),
      (err) => err?.code === 'EISDIR',
    );
    assert.match(readFileSync(target, 'utf8'), /enabled: true/);
    assert.equal(lstatSync(nested).isDirectory(), true);

    rmSync(link);
    rmSync(alias);
    rmSync(nested, { recursive: true });
    symlinkSync('nested/', alias);
    symlinkSync('alias/target.yml', link);
    assert.throws(
      () => setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' }),
      (err) => err?.code === 'ENOENT',
    );
    assert.equal(existsSync(target), false);
    assert.equal(lstatSync(alias).isSymbolicLink(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a symlink chain past the lookup limit does not replace its target', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows may refuse an unprivileged symlink');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'co-plugins-yml-loop-'));
  const config = join(dir, 'config');
  const link = join(config, 'plugins.yml');
  const target = join(config, 'target.yml');
  try {
    mkdirSync(config);
    writeFileSync(target, 'keep: true\n');
    let name = 'target.yml';
    for (let i = 0; i < 64; i++) {
      const linkName = `s${i}`;
      symlinkSync(name, join(config, linkName));
      name = linkName;
    }
    symlinkSync(name, link);
    assert.throws(() => readFileSync(link, 'utf8'), (err) => err?.code === 'ELOOP');
    const { setPluginEnabled } = await import(`${PLUGINS}?loop=${Date.now()}`);
    assert.throws(
      () => setPluginEnabled(dir, 'h1b-sponsor', true, { region: 'us' }),
      (err) => err?.code === 'ELOOP',
    );
    assert.equal(readFileSync(target, 'utf8'), 'keep: true\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
