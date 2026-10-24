// A failed cleanup must leave the user's original CV or letter intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, statSync, chmodSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
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
  if (process.env.MARKER_FAIL === 'write' && dirname(resolve(file)) === process.env.MARKER_DOCS) {
    write(file, String(data).slice(0, 8), options);
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
  test(`failed ${failure} preserves the original document and removes temporary output`, () => fixture(({ root, docs, cv }) => {
    const result = run(cv, { MARKER_DOCS: docs, MARKER_FAIL: failure }, inject(root));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, failure === 'write' ? /ENOSPC/ : /EBUSY/);
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
