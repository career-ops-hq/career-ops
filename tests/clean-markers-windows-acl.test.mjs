import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, realpathSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ROOT } from './helpers.mjs';

test('Windows cleanup keeps the original file instead of replacing its security descriptor', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-win-identity-')));
  const cv = join(root, "cv [private] ' ;.md");
  const hook = join(root, 'windows.mjs');
  const original = 'Fictional CV\u200b\n';
  try {
    writeFileSync(cv, original);
    const before = statSync(cv);
    writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
Object.defineProperty(process, 'platform', { value: 'win32' });
fs.renameSync = () => { throw new Error('Windows replacement would lose the original ACL'); };
syncBuiltinESMExports();
`);
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'clean-markers.mjs'), 'clean', cv], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(cv, 'utf8'), 'Fictional CV\n');
    const after = statSync(cv);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(readdirSync(root).some(name => name.endsWith('.tmp')), false);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});

test('native Windows cleanup retains a protected access ACL with an explicit deny', { skip: process.platform !== 'win32' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-native-win-acl-')));
  const cv = join(root, "cv [private] ' ;.md");
  const command = (file, args, env = {}) => {
    const result = spawnSync(file, args, { encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout.trim();
  };
  const acl = () => command('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference = "Stop"; (Get-Acl -LiteralPath $env:MARKER_NATIVE_CV).Sddl'], { MARKER_NATIVE_CV: cv });
  try {
    writeFileSync(cv, 'Fictional CV\u200b\n');
    command('icacls.exe', [cv, '/inheritancelevel:d']);
    command('icacls.exe', [cv, '/deny', '*S-1-5-32-546:R']);
    const before = acl();
    assert.match(before, /D:P/);
    assert.match(before, /\(D;[^)]*;;;BG\)|\(D;[^)]*;;;S-1-5-32-546\)/);
    command(process.execPath, [join(ROOT, 'clean-markers.mjs'), 'clean', cv]);
    assert.equal(readFileSync(cv, 'utf8'), 'Fictional CV\n');
    assert.equal(acl(), before);
    assert.deepEqual(readdirSync(root), ["cv [private] ' ;.md"]);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});
