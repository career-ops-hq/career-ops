// tests/gitignore-user-dir-symlink.test.mjs
// User-layer directories may be symlinked to storage outside the checkout.
// Their child globs do not match the link itself, so `git add -A` would stage
// a mode-120000 link containing a local filesystem path.

import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, warn, rmSync, ROOT } from './helpers.mjs';

console.log('\n🔗 user-layer directory rules cover symlinks without hiding placeholders');

const names = ['data', 'output', 'jds', 'documents'];
const lines = readFileSync(join(ROOT, '.gitignore'), 'utf-8').split(/\r?\n/).map((line) => line.trim());

// The un-slashed, root-anchored rule catches both directories and symlinks.
// A trailing-slash negation would also match a symlink to a directory and
// cancel the protection, so these paths must not be re-included.
for (const name of names) {
  const ignore = lines.indexOf(`/${name}`);
  const dirOnly = lines.includes(`/${name}/`);
  if (ignore !== -1 && !dirOnly) pass(`${name} ignores the root entry without a directory-only rule`);
  else fail(`${name} needs an un-slashed /${name} rule`);
}

const dir = mkdtempSync(join(tmpdir(), 'gitignore-user-dir-link-'));
try {
  spawnSync('git', ['init', '-q', '.'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), readFileSync(join(ROOT, '.gitignore'), 'utf-8'));
  mkdirSync(join(dir, 'target'));
  const ask = (path) => spawnSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: dir }).status;

  if (ask('definitely-not-ignored.txt') === 1) pass('control: check-ignore reports an unignored path as unignored');
  else fail('control failed: check-ignore did not report an unignored path as unignored');

  for (const name of names) {
    let linked = true;
    try {
      symlinkSync('target', join(dir, name), 'junction');
    } catch (err) {
      linked = false;
      warn(`${name} symlink probe skipped (${err.code}) — static rule check still applies`);
    }
    if (linked) {
      if (ask(name) === 0) pass(`symlink named ${name} is ignored`);
      else fail(`symlink named ${name} is NOT ignored — git add could stage it`);
    }
  }

  // .gitignore does not untrack existing files, so these system scaffolds stay
  // in the index even though their paths are now ignored for new files.
  const trackedPlaceholders = [
    'data/.gitkeep', 'data/offers/.gitkeep', 'data/parser-output/.gitkeep',
    'output/.gitkeep', 'jds/.gitkeep', 'documents/.gitkeep', 'documents/README.md',
  ];
  for (const path of trackedPlaceholders) {
    const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd: ROOT, encoding: 'utf-8' });
    if (result.status === 0) pass(`${path} remains tracked`);
    else fail(`${path} is no longer tracked`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Probe content paths in real directories. Git cannot resolve paths beneath a
// symlinked directory in this check-ignore invocation (it exits 128), so keep
// this independent from the symlink probes above.
const contentDir = mkdtempSync(join(tmpdir(), 'gitignore-user-dir-content-'));
try {
  spawnSync('git', ['init', '-q', '.'], { cwd: contentDir });
  writeFileSync(join(contentDir, '.gitignore'), readFileSync(join(ROOT, '.gitignore'), 'utf-8'));
  const contentProbes = [
    ['data', 'generated.json'],
    ['output', 'generated.txt'],
    ['jds', 'generated.md'],
    ['documents', 'private.pdf'],
  ];
  for (const [name, filename] of contentProbes) {
    mkdirSync(join(contentDir, name));
    writeFileSync(join(contentDir, name, filename), 'generated');
    const path = `${name}/${filename}`;
    const result = spawnSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: contentDir });
    if (result.status === 0) pass(`${path} is ignored`);
    else fail(`${path} has unexpected ignore status ${result.status}`);
  }
} finally {
  rmSync(contentDir, { recursive: true, force: true });
}
