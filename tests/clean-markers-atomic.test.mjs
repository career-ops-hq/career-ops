// A failed cleanup must leave the user's original CV or letter intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, statSync, chmodSync, chownSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const original = '# Fictional CV\nExperience\u200b: customer support\n';
function fixture(fn) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-marker-write-')));
  const docs = join(root, 'documents');
  mkdirSync(docs);
  const cv = join(docs, 'cv.md');
  writeFileSync(cv, original);
  try { fn({ root, docs, cv }); }
  finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
}
function run(file, env = {}, preload) {
  return spawnSync(process.execPath, [
    ...(preload ? ['--import', pathToFileURL(preload).href] : []),
    join(ROOT, 'clean-markers.mjs'), 'clean', file,
  ], { encoding: 'utf8', env: { ...process.env, ...env } });
}
function inject(root) {
  const preload = join(root, 'fail-write.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const write = fs.writeFileSync;
const rename = fs.renameSync;
fs.writeFileSync = (file, data, options) => {
  if (process.env.MARKER_FAIL === 'write' && String(data).length > 0 && dirname(resolve(file)) === process.env.MARKER_DOCS) {
    write(file, String(data).slice(0, 8), options);
    process.stderr.write('partial cleanup bytes: ' + fs.statSync(file).size + '\\n');
    throw Object.assign(new Error('simulated disk full after partial write'), { code: 'ENOSPC' });
  }
  return write(file, data, options);
};
fs.renameSync = (from, to) => {
  if (process.env.MARKER_FAIL === 'rename' && dirname(resolve(to)) === process.env.MARKER_DOCS) {
    throw Object.assign(new Error('simulated destination contention'), { code: 'EBUSY' });
  }
  return rename(from, to);
};
syncBuiltinESMExports();
`);
  return preload;
}

for (const failure of ['write', 'rename']) {
  test(`failed ${failure} preserves the original document and removes temporary output`, { skip: process.platform === 'win32' ? 'Windows retains in-place writes to preserve its security descriptor; atomic failure recovery is POSIX only' : false }, () => fixture(({ root, docs, cv }) => {
    const result = run(cv, { MARKER_DOCS: docs, MARKER_FAIL: failure }, inject(root));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, failure === 'write' ? /ENOSPC/ : /EBUSY/);
    if (failure === 'write') assert.match(result.stderr, /partial cleanup bytes: 8/);
    assert.equal(readFileSync(cv, 'utf8'), original);
    assert.deepEqual(readdirSync(docs), ['cv.md']);
  }));
}

test('successful cleanup preserves HTML code blocks and file permissions', () => fixture(({ docs }) => {
  const html = join(docs, 'cv.html');
  const code = '<style>.x::after { content: "\u200b"; }</style><script>const x = "\u200b";</script>';
  writeFileSync(html, `${code}<p>Fictional\u200b candidate</p>`);
  chmodSync(html, 0o640);
  const result = run(html);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(html, 'utf8'), `${code}<p>Fictional candidate</p>`);
  if (process.platform !== 'win32') assert.equal(statSync(html).mode & 0o777, 0o640);
  assert.deepEqual(readdirSync(docs).sort(), ['cv.html', 'cv.md']);
}));

test('cleanup through a symlink updates its target while retaining the link', { skip: process.platform === 'win32' }, () => fixture(({ docs, cv }) => {
  const link = join(docs, 'cv-link.md');
  symlinkSync(cv, link);
  const result = run(link);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(cv, 'utf8'), original.replace('\u200b', ''));
  assert.equal(lstatSync(link).isSymbolicLink(), true);
}));


test('cleanup retains a restricted target group', { skip: process.platform === 'win32' }, t => fixture(({ docs, cv }) => {
  const gid = process.getgroups().find(g => g !== statSync(docs).gid);
  if (gid === undefined) { t.skip('requires membership in a second group'); return; }
  chownSync(cv, -1, gid);
  chmodSync(cv, 0o640);
  const result = run(cv);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(cv).gid, gid);
  assert.equal(statSync(cv).mode & 0o777, 0o640);
  assert.equal(readFileSync(cv, 'utf8'), original.replace('\u200b', ''));
}));

test('a refused group change preserves the original document and removes temporary output', { skip: process.platform === 'win32' }, () => fixture(({ root, docs, cv }) => {
  const preload = join(root, 'fail-group.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const stat = fs.statSync;
fs.statSync = (file, ...args) => {
  const result = stat(file, ...args);
  // Model a target with a group that differs from newly created siblings.
  return String(file) === process.env.MARKER_CV ? Object.assign(result, { gid: result.gid + 1 }) : result;
};
fs.chownSync = () => { throw Object.assign(new Error('simulated group change refusal'), { code: 'EPERM' }); };
syncBuiltinESMExports();
`);
  const result = run(cv, { MARKER_CV: cv }, preload);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /EPERM/);
  assert.equal(readFileSync(cv, 'utf8'), original);
  assert.deepEqual(readdirSync(docs), ['cv.md']);
}));

for (const viaSymlink of [false, true]) {
  test(`cleanup refuses a read-only document${viaSymlink ? ' through a symlink' : ''} in a writable directory`, {
    skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'requires an unprivileged POSIX user' : false,
  }, () => fixture(({ docs, cv }) => {
    chmodSync(cv, 0o444);
    const file = viaSymlink ? join(docs, 'cv-link.md') : cv;
    if (viaSymlink) symlinkSync(cv, file);
    const result = run(file);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /EACCES/);
    assert.equal(readFileSync(cv, 'utf8'), original);
    assert.equal(statSync(cv).mode & 0o777, 0o444);
    assert.deepEqual(readdirSync(docs).sort(), viaSymlink ? ['cv-link.md', 'cv.md'] : ['cv.md']);
    if (viaSymlink) assert.equal(lstatSync(file).isSymbolicLink(), true);
  }));
}


test('cleanup retains the sticky permission bit', { skip: process.platform === 'win32' }, () => fixture(({ cv }) => {
  chmodSync(cv, 0o1640);
  const result = run(cv);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(cv).mode & 0o7777, 0o1640);
  assert.equal(readFileSync(cv, 'utf8'), original.replace('\u200b', ''));
}));

test('Linux cleanup retains document extended attributes', { skip: process.platform !== 'linux' }, t => fixture(({ cv }) => {
  for (const tool of ['setfattr', 'getfattr']) {
    if (spawnSync(tool, ['--version']).status !== 0) { t.skip(`requires ${tool}`); return; }
  }
  const set = spawnSync('setfattr', ['-n', 'user.career_ops_test', '-v', 'fictional metadata', cv], { encoding: 'utf8' });
  if (set.status !== 0 && /Operation not supported/.test(set.stderr)) { t.skip('filesystem does not support user extended attributes'); return; }
  assert.equal(set.status, 0, set.stderr);
  const result = run(cv);
  assert.equal(result.status, 0, result.stderr);
  const attribute = spawnSync('getfattr', ['--only-values', '-n', 'user.career_ops_test', cv], { encoding: 'utf8' });
  assert.equal(attribute.status, 0, attribute.stderr);
  assert.equal(attribute.stdout, 'fictional metadata');
  assert.equal(readFileSync(cv, 'utf8'), original.replace('\u200b', ''));
}));
