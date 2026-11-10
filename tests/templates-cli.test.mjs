// tests/templates-cli.test.mjs — install, list and remove for template packs
// (#5951). The clone is injected, so nothing here touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, chmodSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installPack, removePack, installedPacks, readLock } from '../lib/templates-install.mjs';
import { runCommand } from '../templates.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHA = 'b'.repeat(40);
const CV = '<html><body><h1>{{NAME}}</h1><h2>{{SECTION_EXPERIENCE}}</h2>{{EXPERIENCE}}<h2>{{SECTION_EDUCATION}}</h2>{{EDUCATION}}</body></html>';
const COVER = '<html><body><h1>{{NAME}}</h1><p>{{ROLE_TITLE}}</p>{{OPENING}}</body></html>';
const URL_ = 'https://github.com/someone/career-ops-template-demo';

const manifest = (over = {}) => ({
  packVersion: 1, id: 'demo', name: 'career-ops-template-demo', displayName: 'Demo', description: 'd',
  author: 'a', license: 'MIT', version: '0.1.0',
  templates: [{
    id: 'plain', displayName: 'Plain', kind: 'both', ats: true, atsRisk: 'none',
    files: { cv: 'templates/cv-template.plain.html', cover: 'templates/cover-letter-template.plain.html' },
    previews: { cv: 'previews/a.png', cover: 'previews/b.png' },
  }],
  ...over,
});

const tmp = [];
const mk = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); tmp.push(d); return d; };
test.after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

function packDir(m = manifest(), files = {}) {
  const dir = mk('tpl-src-');
  const all = {
    'pack.json': JSON.stringify(m),
    'templates/cv-template.plain.html': CV,
    'templates/cover-letter-template.plain.html': COVER,
    'previews/a.png': 'x', 'previews/b.png': 'y',
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
// A clone that hands back a fresh copy of a prepared pack and records its call.
function cloner(dirFn) {
  const calls = [];
  const fn = (url, sha) => { calls.push({ url, sha }); return dirFn(); };
  fn.calls = calls;
  return fn;
}
function root(withTemplates = true) {
  const r = mk('tpl-root-');
  if (withTemplates) mkdirSync(join(r, 'templates'));
  return r;
}
const reg = (over = {}) => ({ name: 'career-ops-template-demo', id: 'demo', repo: URL_, kind: ['cv', 'cover'], themes: 1, ats: true, license: 'MIT', version: '0.1.0', sha: SHA, ...over });

test('installs only the declared files into templates/<id>/ and records a lock entry', () => {
  const r = root();
  const clone = cloner(() => packDir(manifest(), { 'templates/extra.html': 'not declared', 'README.md': 'x' }));
  const res = installPack(r, { entry: reg(), clone });
  assert.deepEqual(clone.calls, [{ url: URL_, sha: SHA }]);
  assert.deepEqual(readdirSync(join(r, 'templates', 'demo')).sort(), ['cover-letter-template.plain.html', 'cv-template.plain.html']);
  assert.equal(readFileSync(join(r, 'templates/demo/cv-template.plain.html'), 'utf-8'), CV);
  const lock = readLock(r).packs.demo;
  assert.equal(lock.sha, SHA);
  assert.equal(lock.source, 'registry');
  assert.equal(lock.version, '0.1.0');
  assert.deepEqual(Object.keys(lock.files).sort(), ['templates/demo/cover-letter-template.plain.html', 'templates/demo/cv-template.plain.html']);
  assert.match(lock.files['templates/demo/cv-template.plain.html'], /^sha256-[0-9a-f]{64}$/);
  assert.equal(res.id, 'demo');
});

test('a pack that fails validation is refused and nothing is written', () => {
  const r = root();
  const bad = () => packDir(manifest(), { 'templates/cv-template.plain.html': CV.replace('<body>', '<body><script>x()</script>') });
  assert.throws(() => installPack(r, { entry: reg(), clone: cloner(bad) }), /failed validation[\s\S]*script-element/);
  assert.equal(existsSync(join(r, 'templates', 'demo')), false);
  assert.deepEqual(readLock(r).packs, {});
});

const MISMATCH = [
  ['version', { version: '9.9.9' }, /version/],
  ['theme count', { themes: 5 }, /themes/],
  ['ats flag', { ats: false }, /ats/],
  ['kind', { kind: ['cv'] }, /kind/],
  ['id', { id: 'other', name: 'career-ops-template-other' }, /id/],
];
for (const [label, over, re] of MISMATCH) {
  test(`a registry entry that disagrees with pack.json on ${label} is refused`, () => {
    const r = root();
    assert.throws(() => installPack(r, { entry: reg(over), clone: cloner(() => packDir()) }), re);
    assert.equal(existsSync(join(r, 'templates', 'demo')), false);
  });
}

test('a template name already claimed by a flat template is refused', () => {
  const r = root();
  writeFileSync(join(r, 'templates', 'cv-template.plain.html'), CV);
  assert.throws(() => installPack(r, { entry: reg(), clone: cloner(() => packDir()) }), /plain.*already/);
  assert.equal(existsSync(join(r, 'templates', 'demo')), false);
});

test('an existing templates/<id>/ the lock does not attribute to the pack is refused, even with force', () => {
  const r = root();
  mkdirSync(join(r, 'templates', 'demo'));
  writeFileSync(join(r, 'templates', 'demo', 'mine.html'), 'mine');
  assert.throws(() => installPack(r, { entry: reg(), clone: cloner(() => packDir()), force: true }), /not installed by templates\.mjs/);
  assert.equal(readFileSync(join(r, 'templates/demo/mine.html'), 'utf-8'), 'mine');
});

test('reinstalling needs force, and force replaces the pack cleanly', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  assert.throws(() => installPack(r, { entry: reg(), clone: cloner(() => packDir()) }), /already installed/);
  const res = installPack(r, { entry: reg({ version: '0.2.0' }), clone: cloner(() => packDir(manifest({ version: '0.2.0' }))), force: true });
  assert.equal(res.version, '0.2.0');
  assert.equal(readLock(r).packs.demo.version, '0.2.0');
});

test('a failed forced reinstall leaves the installed pack untouched', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  const bad = () => packDir(manifest({ version: '0.2.0' }), { 'templates/cv-template.plain.html': CV.replace('<body>', '<body><script>x()</script>') });
  assert.throws(() => installPack(r, { entry: reg({ version: '0.2.0' }), clone: cloner(bad), force: true }), /failed validation/);
  assert.equal(readLock(r).packs.demo.version, '0.1.0');
  assert.equal(readFileSync(join(r, 'templates/demo/cv-template.plain.html'), 'utf-8'), CV);
  // And a name collision found after validation must not cost the old install either.
  writeFileSync(join(r, 'templates', 'cv-template.other.html'), CV);
  const clash = () => packDir(manifest({ version: '0.3.0', templates: [{ ...manifest().templates[0], id: 'other', files: { cv: 'templates/cv-template.other.html', cover: 'templates/cover-letter-template.other.html' } }] }), { 'templates/cv-template.other.html': CV, 'templates/cover-letter-template.other.html': COVER });
  assert.throws(() => installPack(r, { entry: reg({ version: '0.3.0' }), clone: cloner(clash), force: true }), /already taken/);
  assert.equal(readLock(r).packs.demo.version, '0.1.0');
  assert.equal(existsSync(join(r, 'templates/demo/cv-template.plain.html')), true);
});

test('an unregistered pack installs only with a sha, and is recorded as unverified', () => {
  const r = root();
  const res = installPack(r, { repoUrl: URL_, sha: SHA, clone: cloner(() => packDir()) });
  assert.equal(readLock(r).packs.demo.source, 'unverified');
  assert.equal(res.source, 'unverified');
  assert.throws(() => installPack(root(), { repoUrl: URL_, clone: cloner(() => packDir()) }), /40-hex/);
});

test('a repo that is not named career-ops-template-<id> or not on GitHub is refused', () => {
  assert.throws(() => installPack(root(), { repoUrl: 'https://github.com/a/other', sha: SHA, clone: cloner(() => packDir()) }), /career-ops-template-/);
  assert.throws(() => installPack(root(), { repoUrl: 'https://example.com/a/career-ops-template-x', sha: SHA, clone: cloner(() => packDir()) }), /GitHub/);
});

test('an unregistered repo URL with a dot-segment owner or repo is refused', () => {
  for (const repoUrl of ['https://github.com/../career-ops-template-x', 'https://github.com/./career-ops-template-x', 'https://github.com/a/..']) {
    assert.throws(() => installPack(root(), { repoUrl, sha: SHA, clone: cloner(() => packDir()) }), /GitHub|career-ops-template-/, repoUrl);
  }
});

test('the pack id must match the repo name for an unregistered pack', () => {
  const r = root();
  assert.throws(() => installPack(r, { repoUrl: 'https://github.com/a/career-ops-template-other', sha: SHA, clone: cloner(() => packDir()) }), /repo.*other.*demo/);
});

test('installedPacks lists packs and flags a changed or missing file', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  assert.deepEqual(installedPacks(r).map((p) => [p.id, p.modified]), [['demo', []]]);
  writeFileSync(join(r, 'templates/demo/cv-template.plain.html'), 'edited');
  rmSync(join(r, 'templates/demo/cover-letter-template.plain.html'));
  assert.deepEqual(installedPacks(r)[0].modified.sort(), ['templates/demo/cover-letter-template.plain.html', 'templates/demo/cv-template.plain.html']);
});

test('remove deletes exactly the lock-attributed files and the empty directory, and keeps user templates', () => {
  const r = root();
  writeFileSync(join(r, 'templates', 'cv-template.mine.html'), CV);
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  const res = removePack(r, 'demo');
  assert.equal(existsSync(join(r, 'templates', 'demo')), false);
  assert.equal(existsSync(join(r, 'templates', 'cv-template.mine.html')), true);
  assert.deepEqual(readLock(r).packs, {});
  assert.equal(res.removed.length, 2);
});

test('remove keeps a directory that still holds files the pack did not install', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  writeFileSync(join(r, 'templates/demo/mine.html'), 'mine');
  removePack(r, 'demo');
  assert.deepEqual(readdirSync(join(r, 'templates', 'demo')), ['mine.html']);
});

test('remove refuses a modified file without force, and force removes it', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  writeFileSync(join(r, 'templates/demo/cv-template.plain.html'), 'edited');
  assert.throws(() => removePack(r, 'demo'), /modified[\s\S]*cv-template\.plain\.html/);
  assert.equal(existsSync(join(r, 'templates/demo/cv-template.plain.html')), true);
  removePack(r, 'demo', { force: true });
  assert.equal(existsSync(join(r, 'templates', 'demo')), false);
});

test('remove of an unknown pack is refused', () => {
  assert.throws(() => removePack(root(), 'ghost'), /not installed/);
});

test('a relative data root works: lock paths are checked against the resolved templates directory', (t) => {
  const r = root();
  // A temp directory on another drive than the checkout (C: and D: on Windows CI) has no relative path.
  const rel = relative(process.cwd(), r);
  if (isAbsolute(rel)) return t.skip(`no relative path from ${process.cwd()} to ${r}`);
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  const res = installPack(rel, { entry: reg({ version: '0.2.0' }), clone: cloner(() => packDir(manifest({ version: '0.2.0' }))), force: true });
  assert.equal(res.version, '0.2.0');
  removePack(rel, 'demo');
  assert.equal(existsSync(join(r, 'templates', 'demo')), false);
});

test('remove never follows a lock path out of templates/<id>/', () => {
  const r = root();
  const victim = join(r, 'victim.txt');
  writeFileSync(victim, 'keep');
  writeFileSync(join(r, 'templates.lock'), JSON.stringify({ lockfileVersion: 1, packs: { demo: { files: { '../victim.txt': 'sha256-x' } } } }));
  assert.throws(() => removePack(r, 'demo', { force: true }), /outside/);
  assert.equal(existsSync(victim), true);
});

test('a forced reinstall refuses, before deleting anything, when it cannot back up a locked file', (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('chmod 000 does not block reads here');
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  const f = join(r, 'templates/demo/cv-template.plain.html');
  const other = join(r, 'templates/demo/cover-letter-template.plain.html');
  chmodSync(f, 0o000);
  try {
    assert.throws(
      () => installPack(r, { entry: reg({ version: '0.2.0' }), clone: cloner(() => packDir(manifest({ version: '0.2.0' }))), force: true }),
      /cannot back up[\s\S]*cv-template\.plain\.html/,
    );
    assert.equal(existsSync(f), true);
    assert.equal(existsSync(other), true);
  } finally {
    chmodSync(f, 0o644);
  }
});

test('remove treats a locked file it cannot read as modified', (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('chmod 000 does not block reads here');
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  const f = join(r, 'templates/demo/cv-template.plain.html');
  chmodSync(f, 0o000);
  try {
    assert.throws(() => removePack(r, 'demo'), /modified[\s\S]*cv-template\.plain\.html/);
    assert.equal(existsSync(f), true);
  } finally {
    chmodSync(f, 0o644);
  }
});

test('remove does not count a locked file that is already gone as modified', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  rmSync(join(r, 'templates/demo/cv-template.plain.html'));
  assert.equal(removePack(r, 'demo').id, 'demo');
});

test('remove refuses a pack id that is not a pack id, before reading any path', () => {
  // A lock entry keyed `..` would make templates/.. the pack directory, so
  // root/victim.txt would pass the templates/<id>/ bounds check.
  for (const id of ['..', '.', 'a/../..', '../x', 'Demo', '', 'a\\b']) {
    const r = root();
    const victim = join(r, 'victim.txt');
    writeFileSync(victim, 'keep');
    writeFileSync(join(r, 'templates.lock'), JSON.stringify({ lockfileVersion: 1, packs: { [id]: { files: { 'victim.txt': 'sha256-x' } } } }));
    assert.throws(() => removePack(r, id, { force: true }), /invalid pack id/, JSON.stringify(id));
    assert.equal(readFileSync(victim, 'utf-8'), 'keep', JSON.stringify(id));
  }
  assert.throws(() => removePack(root(), 7), /invalid pack id/);
});

test('remove of a name only Object.prototype has is "not installed"', () => {
  // `constructor` is a valid pack id, and lock.packs inherits it.
  assert.throws(() => removePack(root(), 'constructor'), /not installed/);
});

test('remove never deletes through a symlinked templates/<id>', (t) => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  const outside = mk('tpl-out-');
  writeFileSync(join(outside, 'cv-template.plain.html'), 'keep');
  writeFileSync(join(outside, 'cover-letter-template.plain.html'), 'keep');
  rmSync(join(r, 'templates/demo'), { recursive: true });
  try {
    symlinkSync(outside, join(r, 'templates/demo'));
  } catch (err) {
    if (err?.code === 'EPERM' || err?.code === 'EACCES') return t.skip(`cannot create symlinks here: ${err.code}`);
    throw err;
  }
  assert.throws(() => removePack(r, 'demo', { force: true }), /symlink/);
  assert.equal(readFileSync(join(outside, 'cv-template.plain.html'), 'utf-8'), 'keep');
  assert.equal(readFileSync(join(outside, 'cover-letter-template.plain.html'), 'utf-8'), 'keep');
});

test('a forced reinstall refuses a symlink in place of a locked file the new version drops', (t) => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  const outside = join(mk('tpl-out-'), 'planted.html');
  writeFileSync(outside, 'keep');
  const locked = join(r, 'templates/demo/cover-letter-template.plain.html');
  rmSync(locked);
  try {
    symlinkSync(outside, locked);
  } catch (err) {
    if (err?.code === 'EPERM' || err?.code === 'EACCES') return t.skip(`cannot create symlinks here: ${err.code}`);
    throw err;
  }
  const cvOnly = () => packDir(manifest({ version: '0.2.0', templates: [{ ...manifest().templates[0], kind: 'cv', files: { cv: 'templates/cv-template.plain.html' } }] }));
  assert.throws(() => installPack(r, { entry: reg({ version: '0.2.0', kind: ['cv'] }), clone: cloner(cvOnly), force: true }), /symlink/);
  assert.equal(lstatSync(locked).isSymbolicLink(), true);
  assert.equal(readLock(r).packs.demo.version, '0.1.0');
});

for (const live of [false, true]) {
  test(`a forced reinstall refuses a ${live ? 'live' : 'dangling'} symlink in place of a locked file`, (t) => {
    const r = root();
    installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
    const outside = join(mk('tpl-out-'), 'planted.html');
    if (live) writeFileSync(outside, 'keep');
    const locked = join(r, 'templates/demo/cv-template.plain.html');
    rmSync(locked);
    try {
      symlinkSync(outside, locked);
    } catch (err) {
      if (err?.code === 'EPERM' || err?.code === 'EACCES') return t.skip(`cannot create symlinks here: ${err.code}`);
      throw err;
    }
    assert.throws(() => installPack(r, { entry: reg({ version: '0.2.0' }), clone: cloner(() => packDir(manifest({ version: '0.2.0' }))), force: true }), /symlink/);
    // Nothing was read, deleted or written: the link, its target and the lock are as they were.
    assert.equal(lstatSync(locked).isSymbolicLink(), true);
    assert.equal(existsSync(outside), live);
    if (live) assert.equal(readFileSync(outside, 'utf-8'), 'keep');
    assert.equal(readLock(r).packs.demo.version, '0.1.0');
  });
}

test('a forced reinstall never overwrites a file in templates/<id>/ the lock does not own', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  const mine = join(r, 'templates/demo/cv-template.mine.html');
  writeFileSync(mine, 'user-owned');
  const entry = { ...manifest().templates[0], id: 'mine', files: { cv: 'templates/cv-template.mine.html', cover: 'templates/cover-letter-template.mine.html' } };
  const v2 = () => packDir(manifest({ version: '0.2.0', templates: [entry] }), { 'templates/cv-template.mine.html': CV, 'templates/cover-letter-template.mine.html': COVER });
  assert.throws(() => installPack(r, { entry: reg({ version: '0.2.0' }), clone: cloner(v2), force: true }), /not installed by templates\.mjs|not owned/);
  assert.equal(readFileSync(mine, 'utf-8'), 'user-owned');
  assert.equal(readLock(r).packs.demo.version, '0.1.0');
  assert.equal(readFileSync(join(r, 'templates/demo/cv-template.plain.html'), 'utf-8'), CV);
});

test('the CLI prints usage for --help and exits 2 for an unknown command', () => {
  const h = spawnSync('node', ['templates.mjs', '--help'], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(h.status, 0);
  assert.match(h.stdout, /Usage: node templates\.mjs/);
  const bad = spawnSync('node', ['templates.mjs', 'frobnicate'], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(bad.status, 2);
});

test('available and list answer with a zero exit against a scratch root', async () => {
  // A scratch root and an injected log: the shipped registry and a developer's
  // own templates.lock must not decide whether this passes.
  const e = addEnv();
  assert.equal(await runCommand(e.r, 'list', [], { log: e.log }), 0);
  assert.equal(await runCommand(e.r, 'available', [], { log: e.log }), 0);
  assert.ok(e.out.some((l) => /demo/.test(l)), e.out.join('\n'));
  assert.equal(await runCommand(e.r, 'add', ['demo'], { clone: e.clone, log: e.log }), 0);
  e.out.length = 0;
  assert.equal(await runCommand(e.r, 'list', [], { log: e.log }), 0);
  assert.ok(e.out.some((l) => /demo/.test(l)), e.out.join('\n'));
});

test('a corrupt templates.lock is reported and never overwritten', () => {
  const r = root();
  writeFileSync(join(r, 'templates.lock'), '{ "packs": { "keep": ');
  assert.throws(() => readLock(r), /templates\.lock/);
  assert.throws(() => installPack(r, { entry: reg(), clone: cloner(() => packDir()) }), /templates\.lock/);
  assert.throws(() => removePack(r, 'keep'), /templates\.lock/);
  assert.equal(readFileSync(join(r, 'templates.lock'), 'utf-8'), '{ "packs": { "keep": ');
  assert.equal(existsSync(join(r, 'templates', 'demo')), false);
});

test('a lock with the wrong shape is reported, an absent lock is empty', () => {
  const r = root();
  assert.deepEqual(readLock(r).packs, {});
  writeFileSync(join(r, 'templates.lock'), '[]');
  assert.throws(() => readLock(r), /templates\.lock/);
});

test('the lock is written through a temp file that is renamed into place', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  assert.deepEqual(readdirSync(r).filter((f) => f.endsWith('.tmp')), []);
  assert.ok(JSON.parse(readFileSync(join(r, 'templates.lock'), 'utf-8')).packs.demo);
});

// A directory squatting on the temp lock path makes the lock write fail after
// the files are copied, which is the late failure the installer has to undo.
const squatTmpLock = (r) => mkdirSync(join(r, `templates.lock.${process.pid}.tmp`));

test('a failure after the copy removes the files it wrote and leaves nothing behind', () => {
  const r = root();
  squatTmpLock(r);
  // The write's own error surfaces, not the error from cleaning up after it.
  assert.throws(() => installPack(r, { entry: reg(), clone: cloner(() => packDir()) }), { code: 'EISDIR' });
  assert.equal(existsSync(join(r, 'templates', 'demo')), false);
  assert.equal(existsSync(join(r, 'templates.lock')), false);
  // The retry is not blocked by a half install.
  rmSync(join(r, `templates.lock.${process.pid}.tmp`), { recursive: true });
  assert.equal(installPack(r, { entry: reg(), clone: cloner(() => packDir()) }).id, 'demo');
});

test('a late failure during a forced reinstall restores the previous version', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  squatTmpLock(r);
  const v2 = () => packDir(manifest({ version: '0.2.0' }), { 'templates/cv-template.plain.html': CV + '<!-- v2 -->' });
  assert.throws(() => installPack(r, { entry: reg({ version: '0.2.0' }), clone: cloner(v2), force: true }), { code: 'EISDIR' });
  assert.equal(readFileSync(join(r, 'templates/demo/cv-template.plain.html'), 'utf-8'), CV);
  assert.equal(existsSync(join(r, 'templates/demo/cover-letter-template.plain.html')), true);
  assert.equal(readLock(r).packs.demo.version, '0.1.0');
});

test('one file that cannot be removed does not stop the rest, and the lock keeps only it', () => {
  const r = root();
  installPack(r, { entry: reg(), clone: cloner(() => packDir()) });
  const stuck = join(r, 'templates/demo/cv-template.plain.html');
  rmSync(stuck);
  mkdirSync(stuck);
  writeFileSync(join(stuck, 'inner'), 'x');
  assert.throws(() => removePack(r, 'demo', { force: true }), /could not remove[\s\S]*cv-template\.plain\.html/);
  assert.equal(existsSync(join(r, 'templates/demo/cover-letter-template.plain.html')), false);
  assert.deepEqual(Object.keys(readLock(r).packs.demo.files), ['templates/demo/cv-template.plain.html']);
});

// ---- the add command, through the CLI's own wiring ----
function addEnv() {
  const r = root();
  mkdirSync(join(r, 'templates-registry'));
  writeFileSync(join(r, 'templates-registry', 'demo.json'), JSON.stringify(reg()));
  const calls = [];
  const clone = (url, sha) => { calls.push({ url, sha }); return packDir(); };
  const out = [];
  const log = { log: (m) => out.push(String(m)), error: (m) => out.push(String(m)) };
  return { r, calls, clone, out, log };
}

test('add <id> sends the registry entry URL and pinned SHA to the clone', async () => {
  const e = addEnv();
  const code = await runCommand(e.r, 'add', ['demo'], { clone: e.clone, log: e.log });
  assert.equal(code, 0, e.out.join('\n'));
  assert.deepEqual(e.calls, [{ url: URL_, sha: SHA }]);
  assert.ok(readLock(e.r).packs.demo);
});

test('add refuses --sha for a registered pack, and a --sha with no operand', async () => {
  const e = addEnv();
  assert.equal(await runCommand(e.r, 'add', ['demo', '--sha', SHA], { clone: e.clone, log: e.log }), 2);
  assert.equal(await runCommand(e.r, 'add', ['demo', '--sha'], { clone: e.clone, log: e.log }), 2);
  assert.equal(await runCommand(e.r, 'add', ['someone/career-ops-template-x', '--sha'], { clone: e.clone, log: e.log }), 2);
  assert.equal(await runCommand(e.r, 'add', ['demo', '--sha', 'zzz'], { clone: e.clone, log: e.log }), 2);
  assert.deepEqual(e.calls, []);
});

test('add rejects an unknown flag such as --sha=<commit>', async () => {
  const e = addEnv();
  assert.equal(await runCommand(e.r, 'add', ['demo', `--sha=${SHA}`], { clone: e.clone, log: e.log }), 2);
  assert.deepEqual(e.calls, []);
});

test('add of an unregistered owner/repo needs --sha and --confirm', async () => {
  const e = addEnv();
  assert.equal(await runCommand(e.r, 'add', ['someone/career-ops-template-demo2', '--sha', SHA], { clone: e.clone, log: e.log }), 2);
  assert.deepEqual(e.calls, []);
});
