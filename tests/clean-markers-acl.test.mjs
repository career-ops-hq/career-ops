import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, realpathSync, mkdirSync, symlinkSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ROOT } from './helpers.mjs';

for (const restricted of [false, true]) {
  test(`cleanup preserves ${restricted ? 'an explicit access ACL' : 'the absence of an access ACL'} under an inheriting directory`, { skip: process.platform !== 'darwin' }, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-acl-')));
    const cv = join(root, 'cv.md');
    const command = (file, args) => {
      const result = spawnSync(file, args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    const acl = () => command('/bin/ls', ['-len', cv]).split('\n').slice(1).join('\n');
    try {
      command('/bin/chmod', ['+a', 'everyone allow read,file_inherit', root]);
      writeFileSync(cv, 'Fictional CV\u200b\n');
      command('/bin/chmod', ['-N', cv]);
      if (restricted) command('/bin/chmod', ['+a', 'user:nobody deny read', cv]);
      command('/bin/chmod', ['640', cv]);
      const before = acl();
      command(process.execPath, [join(ROOT, 'clean-markers.mjs'), 'clean', cv]);
      assert.equal(readFileSync(cv, 'utf8'), 'Fictional CV\n');
      assert.equal(acl(), before);
      assert.deepEqual(readdirSync(root), ['cv.md']);
    } finally {
      spawnSync('/bin/chmod', ['-RN', root]);
      rmSync(root, { recursive: true, force: true, maxRetries: 10 });
    }
  });
}

for (const acl of ['absent', 'restricted', 'missing-utility']) {
  test(`cleanup preserves Linux access ACLs (${acl})`, { skip: process.platform !== 'linux' }, t => {
    if (spawnSync('setfacl', ['--version']).error?.code === 'ENOENT'
      || spawnSync('getfacl', ['--version']).error?.code === 'ENOENT') {
      t.skip('requires the native acl tools'); return;
    }
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-linux-acl-')));
    const cv = join(root, 'cv.md');
    const command = (file, args) => {
      const result = spawnSync(file, args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    try {
      const inherited = spawnSync('setfacl', ['-m', 'd:u:nobody:r', root], { encoding: 'utf8' });
      if (inherited.status !== 0) {
        t.skip('requires default ACL support and the nobody account'); return;
      }
      writeFileSync(cv, 'Fictional CV\u200b\n');
      command('setfacl', ['-b', cv]);
      if (acl === 'restricted') command('setfacl', ['-m', 'u:nobody:---', cv]);
      const before = command('getfacl', ['-cp', cv]);
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const tools = acl === 'missing-utility' ? ['cp', 'ls'] : ['cp', 'ls', 'setfacl'];
      for (const tool of tools) symlinkSync(command('/bin/sh', ['-c', 'command -v "$1"', 'sh', tool]).trim(), join(bin, tool));
      const cleaned = spawnSync(process.execPath, [join(ROOT, 'clean-markers.mjs'), 'clean', cv], { encoding: 'utf8', env: { ...process.env, PATH: bin } });
      assert.equal(cleaned.status, acl === 'missing-utility' ? 1 : 0, cleaned.stderr);
      if (acl === 'missing-utility') assert.match(cleaned.stderr, /setfacl.*ENOENT/);
      assert.equal(readFileSync(cv, 'utf8'), acl === 'missing-utility' ? 'Fictional CV\u200b\n' : 'Fictional CV\n');
      assert.equal(command('getfacl', ['-cp', cv]), before);
      assert.deepEqual(readdirSync(root).sort(), ['bin', 'cv.md']);
    } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
  });
}

test('failed metadata copy preserves the original document', { skip: process.platform === 'win32' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-acl-failure-')));
  const cv = join(root, 'cv.md');
  const original = 'Fictional CV\u200b\n';
  const hook = join(root, 'fail-copy.mjs');
  try {
    writeFileSync(cv, original);
    writeFileSync(hook, `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const exec = childProcess.execFileSync;
childProcess.execFileSync = (file, ...args) => {
  if (file === 'cp') throw new Error('metadata copy refused');
  return exec(file, ...args);
};
syncBuiltinESMExports();\n`);
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'clean-markers.mjs'), 'clean', cv], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /metadata copy refused/);
    assert.equal(readFileSync(cv, 'utf8'), original);
    assert.deepEqual(readdirSync(root).sort(), ['cv.md', 'fail-copy.mjs']);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});

test('uncertain Linux access controls preserve the original document', { skip: process.platform === 'win32' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-unknown-acl-')));
  const cv = join(root, 'cv.md');
  const hook = join(root, 'unknown-acl.mjs');
  const original = 'Fictional CV\u200b\n';
  try {
    writeFileSync(cv, original);
    writeFileSync(hook, `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
Object.defineProperty(process, 'platform', { value: 'linux' });
const exec = childProcess.execFileSync;
childProcess.execFileSync = (file, ...args) => file === 'ls' ? '-rw-------? 1 owner group 0 temporary\\n' : exec(file, ...args);
syncBuiltinESMExports();\n`);
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'clean-markers.mjs'), 'clean', cv], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Cannot determine temporary document access controls/);
    assert.equal(readFileSync(cv, 'utf8'), original);
    assert.deepEqual(readdirSync(root).sort(), ['cv.md', 'unknown-acl.mjs']);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});

// macOS needs an explicit inherited ACL reset; a failure must retain the source.
test('failed macOS inherited ACL reset preserves the original document', { skip: process.platform !== 'darwin' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-acl-reset-failure-')));
  const cv = join(root, 'cv.md');
  const original = 'Fictional CV\u200b\n';
  const hook = join(root, 'fail-reset.mjs');
  try {
    writeFileSync(cv, original);
    writeFileSync(hook, `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const exec = childProcess.execFileSync;
childProcess.execFileSync = (file, args, ...rest) => {
  if ((file === 'chmod' && args[0] === '-N') || file === 'setfacl') throw new Error('ACL reset refused');
  return exec(file, args, ...rest);
};
syncBuiltinESMExports();\n`);
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'clean-markers.mjs'), 'clean', cv], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /ACL reset refused/);
    assert.equal(readFileSync(cv, 'utf8'), original);
    assert.deepEqual(readdirSync(root).sort(), ['cv.md', 'fail-reset.mjs']);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});

test('Linux cleanup needs no standalone ACL utility for an ordinary file', { skip: process.platform !== 'linux' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-no-acl-tools-')));
  const cv = join(root, 'cv.md');
  const bin = join(root, 'bin');
  try {
    writeFileSync(cv, 'Fictional CV\u200b\n', { mode: 0o640 });
    const before = statSync(cv);
    mkdirSync(bin);
    for (const tool of ['cp', 'ls']) {
      const executable = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', tool], { encoding: 'utf8' });
      assert.equal(executable.status, 0, executable.stderr);
      symlinkSync(executable.stdout.trim(), join(bin, tool));
    }
    const result = spawnSync(process.execPath, [join(ROOT, 'clean-markers.mjs'), 'clean', cv], { encoding: 'utf8', env: { ...process.env, PATH: bin } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(cv, 'utf8'), 'Fictional CV\n');
    const after = statSync(cv);
    assert.equal(after.mode & 0o777, before.mode & 0o777);
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, before.gid);
    assert.deepEqual(readdirSync(root).sort(), ['bin', 'cv.md']);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
});
