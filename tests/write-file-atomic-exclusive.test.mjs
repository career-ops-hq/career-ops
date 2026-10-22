/** Exclusive publication refuses a winner created before or during a write. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileAtomic } from '../tracker-utils.mjs';

function withDirectory(run) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'career-ops-atomic-exclusive-'));
  try { run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function noTemporaryFiles(directory) {
  assert.deepEqual(fs.readdirSync(directory).filter(name => name.endsWith('.tmp')), []);
}

// Named imports of built-in fs functions are live after this synchronization.
// Restore immediately: these synchronous calls must not affect another suite.
function withFsMethod(name, replacement, run) {
  const original = fs[name];
  fs[name] = replacement(original);
  syncBuiltinESMExports();
  try { run(); }
  finally {
    fs[name] = original;
    syncBuiltinESMExports();
  }
}

test('noReplace publishes all bytes and requested permissions to a new name', () => withDirectory(directory => {
  const target = join(directory, 'cv.pdf');
  const bytes = Buffer.from('%PDF-1.7\ncomplete content\n');
  writeFileAtomic(target, bytes, { mode: 0o600, noReplace: true });
  assert.deepEqual(fs.readFileSync(target), bytes);
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  noTemporaryFiles(directory);
}));

test('noReplace preserves an existing regular file', () => withDirectory(directory => {
  const target = join(directory, 'cv.pdf');
  fs.writeFileSync(target, 'previous reviewed CV');
  const before = fs.statSync(target);
  assert.throws(() => writeFileAtomic(target, 'replacement', { noReplace: true }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'previous reviewed CV');
  assert.equal(fs.statSync(target).ino, before.ino);
  noTemporaryFiles(directory);
}));

test('noReplace preserves an existing hard link and its source', () => withDirectory(directory => {
  const source = join(directory, 'source.md');
  const target = join(directory, 'cv.pdf');
  fs.writeFileSync(source, 'primary source');
  fs.linkSync(source, target);
  assert.throws(() => writeFileAtomic(target, 'replacement', { noReplace: true }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(source, 'utf8'), 'primary source');
  assert.equal(fs.readFileSync(target, 'utf8'), 'primary source');
  assert.equal(fs.statSync(source).ino, fs.statSync(target).ino);
  noTemporaryFiles(directory);
}));

for (const dangling of [false, true]) {
  test(`noReplace preserves an existing ${dangling ? 'dangling ' : ''}symlink`, t => withDirectory(directory => {
    const source = join(directory, 'source.md');
    const target = join(directory, 'cv.pdf');
    if (!dangling) fs.writeFileSync(source, 'primary source');
    try { fs.symlinkSync(source, target, 'file'); }
    catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error;
      t.skip(`symlinks unavailable (${error.code})`);
      return;
    }
    assert.throws(() => writeFileAtomic(target, 'replacement', { noReplace: true }), { code: 'EEXIST' });
    assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(target), source);
    if (dangling) assert.equal(fs.existsSync(source), false);
    else assert.equal(fs.readFileSync(source, 'utf8'), 'primary source');
    noTemporaryFiles(directory);
  }));
}

test('a destination created after the temporary write wins without being overwritten', () => withDirectory(directory => {
  const target = join(directory, 'cv.pdf');
  let publications = 0;
  withFsMethod('linkSync', original => (temporary, destination) => {
    publications++;
    assert.equal(destination, target);
    assert.equal(fs.readFileSync(temporary, 'utf8'), 'complete new PDF');
    fs.writeFileSync(destination, 'concurrent winner', { flag: 'wx' });
    return original(temporary, destination);
  }, () => {
    assert.throws(() => writeFileAtomic(target, 'complete new PDF', { noReplace: true }), { code: 'EEXIST' });
  });
  assert.equal(publications, 1);
  assert.equal(fs.readFileSync(target, 'utf8'), 'concurrent winner');
  noTemporaryFiles(directory);
}));

test('an incomplete exclusive write cleans only its temporary file', () => withDirectory(directory => {
  const target = join(directory, 'cv.pdf');
  const diskFull = Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' });
  withFsMethod('writeFileSync', original => (destination, content, options) => {
    assert.equal(typeof destination, 'number', 'the temporary file is exclusively opened first');
    original(destination, 'partial content');
    throw diskFull;
  }, () => {
    assert.throws(() => writeFileAtomic(target, 'complete new PDF', { noReplace: true }), error => error === diskFull);
  });
  assert.equal(fs.existsSync(target), false);
  noTemporaryFiles(directory);
}));

test('default atomic replacement keeps an old hard link unchanged', () => withDirectory(directory => {
  const target = join(directory, 'cv.pdf');
  const previous = join(directory, 'previous.pdf');
  fs.writeFileSync(target, 'previous reviewed CV');
  fs.linkSync(target, previous);
  writeFileAtomic(target, 'replacement');
  assert.equal(fs.readFileSync(target, 'utf8'), 'replacement');
  assert.equal(fs.readFileSync(previous, 'utf8'), 'previous reviewed CV');
  noTemporaryFiles(directory);
}));
