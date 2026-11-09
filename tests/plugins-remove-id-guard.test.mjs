// tests/plugins-remove-id-guard.test.mjs — `plugins.mjs remove` must reject a
// traversal-shaped id inside the usage gate, before rmSync/lock/config touch
// anything.
//
// cmdRemove joined the raw argv id into `path.join(ROOT, 'plugins.local', id)`
// and rmSync'd it with {recursive, force}. `path.join` normalizes `..`, so
// `remove ../cv.md` or `remove ..` escaped plugins.local — up to deleting the
// checkout root or user-layer files (DATA_CONTRACT boundary violation). The
// engine already pins ids to ^[a-z0-9][a-z0-9-]*$ (plugins/_engine.mjs ID_RE);
// remove never applied it.
//
// Every case runs against a DISPOSABLE CHECKOUT: the transitive import closure
// of plugins.mjs copied into a temp dir, with the repo's dependency tree linked
// in through linkNodeModules() (tests/helpers.mjs — junction on Windows, the
// inherited-tree walk, and a failure reason instead of a silent catch). A guard
// regression that re-opens
// the hole can only delete that fixture — a test that destroys the files it is
// testing is worse than no test. CAREER_OPS_ROOT points at a separate temp dir,
// so config writes never reach the developer's data root either.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';
import { linkNodeModules } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The relative-file import graph the fixture must carry for `node
// plugins.mjs` to load. Bare specifiers resolve through the junctioned
// node_modules; dynamic imports inside never run on the remove path.
function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  const spec = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    if (!existsSync(file)) continue; // regex also sees doc-comment examples like ./anything.mjs
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

// Root data files some closure modules read at load time (tracker-parse.mjs
// throws without its alias table). Not importable, so the walker can't see them.
const DATA_FILES = ['tracker-aliases.json'];

let checkout = null;
let dataRoot = null;

before(() => {
  checkout = mkdtempSync(join(tmpdir(), 'plugins-remove-checkout-'));
  for (const file of importClosure(join(ROOT, 'plugins.mjs'))) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('..')) continue; // never escape the fixture by copy
    const dest = join(checkout, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(file, dest);
  }
  for (const name of DATA_FILES) {
    cpSync(join(ROOT, name), join(checkout, name));
  }
  // destDir is the sandbox root: the helper places <destDir>/node_modules itself.
  const linkReason = linkNodeModules(checkout, ROOT);
  assert.equal(linkReason, null, `linkNodeModules could not give the fixture a dependency tree: ${linkReason}`);
  dataRoot = mkdtempSync(join(tmpdir(), 'plugins-remove-guard-'));
});

after(() => {
  for (const dir of [checkout, dataRoot]) {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function run(...args) {
  const r = spawnSync(process.execPath, [join(checkout, 'plugins.mjs'), ...args], {
    cwd: checkout,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
  });
  assert.equal(r.error, undefined, `plugins.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `plugins.mjs was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('the disposable checkout loads plugins.mjs end to end', () => {
  const r = run('remove'); // no id: usage path, but the whole module graph loads first
  assert.equal(r.status, 1, describeSpawn(r, `usage guard exited ${r.status}, want 1\n`));
  assert.match(r.all, /Usage:/, `expected the usage line, got:\n${r.all}`);
});

test('remove rejects a parent-relative probe id before touching the checkout', () => {
  const id = '../plugins-remove-red-probe';
  const probe = join(checkout, 'plugins-remove-red-probe'); // path.join(checkout,'plugins.local','../plugins-remove-red-probe')
  writeFileSync(probe, 'sentinel'); // present, so an rmSync-before-validate regression deletes it
  // Seed lock and config with an entry keyed by the invalid id: a regression
  // that runs removeLockEntry/setEnabled before the guard would rewrite them.
  const lockFile = join(checkout, 'plugins.lock');
  const lockSeed = JSON.stringify({ lockfileVersion: 1, plugins: { [id]: { version: '9.9.9' } } }, null, 2) + '\n';
  writeFileSync(lockFile, lockSeed);
  const cfgDir = join(dataRoot, 'config');
  mkdirSync(cfgDir, { recursive: true });
  const cfgFile = join(cfgDir, 'plugins.yml');
  const cfgSeed = `plugins:\n  ${JSON.stringify(id)}:\n    enabled: true\n`;
  writeFileSync(cfgFile, cfgSeed);
  const r = run('remove', id);
  assert.ok(exitedNonZero(r), describeSpawn(r, `exited ${r.status} — traversal id must be refused, not processed\n`));
  assert.match(r.all, /[Ii]nvalid plugin id/, `expected an invalid-id error, got:\n${r.all}`);
  assert.equal(existsSync(probe), true, 'the sentinel at the traversal target must survive');
  assert.equal(readFileSync(lockFile, 'utf8'), lockSeed, 'plugins.lock must be untouched by an invalid id');
  assert.equal(readFileSync(cfgFile, 'utf8'), cfgSeed, 'config/plugins.yml must be untouched by an invalid id');
});

test('remove rejects an id containing a path separator', () => {
  const sepDir = join(checkout, 'plugins.local', 'foo');
  mkdirSync(sepDir, { recursive: true });
  const sepSentinel = join(sepDir, 'bar');
  writeFileSync(sepSentinel, 'sentinel');
  const r = run('remove', 'foo/bar');
  assert.ok(exitedNonZero(r), describeSpawn(r, `exited ${r.status} — a slash in the id must be refused\n`));
  assert.match(r.all, /[Ii]nvalid plugin id/, `expected an invalid-id error, got:\n${r.all}`);
  assert.equal(existsSync(sepSentinel), true, 'the sentinel under plugins.local must survive');
});

// The destructive shapes, pinned against the disposable checkout: if the
// guard ever regresses, these delete the fixture and fail loudly — the real
// checkout is never the rmSync target.
test('remove rejects the bare parent id', () => {
  const r = run('remove', '..');
  assert.ok(exitedNonZero(r), describeSpawn(r, `exited ${r.status} — "remove .." must be refused\n`));
  assert.match(r.all, /[Ii]nvalid plugin id/, `expected an invalid-id error, got:\n${r.all}`);
  assert.equal(existsSync(checkout), true, 'the disposable checkout root must still exist');
});

test('remove rejects the current-directory id', () => {
  const localDir = join(checkout, 'plugins.local');
  mkdirSync(localDir, { recursive: true });
  const localSentinel = join(localDir, 'sentinel');
  writeFileSync(localSentinel, 'sentinel');
  const r = run('remove', '.');
  assert.ok(exitedNonZero(r), describeSpawn(r, `exited ${r.status} — "remove ." must be refused\n`));
  assert.match(r.all, /[Ii]nvalid plugin id/, `expected an invalid-id error, got:\n${r.all}`);
  assert.equal(existsSync(localSentinel), true, 'plugins.local contents must survive');
});
