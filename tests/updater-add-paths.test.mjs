/**
 * updater-add-paths.test.mjs — BEHAVIORAL staging tests for apply()'s commit step.
 *
 * apply() stages its checked-out system paths and commits them. Two ways that
 * `git add` call could fail leave the update half-done — files on disk, nothing
 * committed — and the user is told to finish it by hand:
 *
 *   1. A tracked system file shadowed by a local DIRECTORY-level ignore rule.
 *      `git add` refuses explicitly-named ignored paths (exit 1). .gitignore is
 *      deliberately not in SYSTEM_PATHS, so any user's rule can cause this at
 *      any time; a blanket `writing-samples/` over the tracked
 *      writing-samples/README.md is the shape seen in the wild. A file-level
 *      rule over the same tracked path does NOT trigger it — git only consults
 *      ignore rules for a tracked file when the match is an ignored directory.
 *   2. The .update-dismissed marker. It is gitignored by default and therefore
 *      never in the index, so staging it after deletion is a fatal unmatched
 *      pathspec (exit 128) that -f does NOT rescue. Reproduces in a stock
 *      checkout with no customization: dismiss an update, then apply one.
 *
 * Follows updater-rollback-behavior.test.mjs: drive the real exports against a
 * throwaway repo through the git-runner seam, so the property is verified rather
 * than the source merely pattern-matched.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, addPaths, isTracked } from '../update-system.mjs';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'co-addpaths-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  return { dir, g, ctx: { git: g } };
}

const stagedPaths = g =>
  new Set(g('diff', '--cached', '--name-only', 'HEAD').split('\n').filter(Boolean));

console.log('\n🧪 Testing updater staging behavior (ignored + never-tracked paths)...');

// ── 1. a tracked system file shadowed by a user ignore rule still stages ──
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'writing-samples'));
  writeFileSync(join(dir, 'writing-samples/README.md'), 'shipped by upstream');
  writeFileSync(join(dir, 'AGENTS.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // The user hardens their own .gitignore with a blanket rule over a directory
  // that contains a tracked system file.
  writeFileSync(join(dir, '.gitignore'), 'writing-samples/\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'user hardening');

  // An update rewrites both files and stages them together.
  writeFileSync(join(dir, 'writing-samples/README.md'), 'updated by v-next');
  writeFileSync(join(dir, 'AGENTS.md'), 'v2');

  let threw = null;
  try {
    addPaths(['AGENTS.md', 'writing-samples/README.md'], ctx);
  } catch (err) {
    threw = err;
  }

  if (!threw) {
    pass('staging succeeds when an ignore rule shadows a tracked system file');
  } else {
    fail(`staging threw on an ignored-but-tracked system path: ${threw.message.split('\n')[0]}`);
  }

  const staged = stagedPaths(g);
  if (staged.has('writing-samples/README.md') && staged.has('AGENTS.md')) {
    pass('both the shadowed path and its batch-mates reach the index');
  } else {
    fail(`incomplete staging: ${[...staged].join(', ') || '(nothing)'}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 2. only a DIRECTORY-level rule triggers this; a file-level one never did ──
//    Pins the actual boundary, so nobody "simplifies" the fix after seeing that
//    an ignored tracked file sometimes stages fine. git consults ignore rules
//    for a tracked file only when the match comes from an ignored directory.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'dirlevel'));
  mkdirSync(join(dir, 'filelevel'));
  writeFileSync(join(dir, 'dirlevel/F.md'), 'v1');
  writeFileSync(join(dir, 'filelevel/F.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, '.gitignore'), 'dirlevel/\nfilelevel/F.md\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignores');

  writeFileSync(join(dir, 'dirlevel/F.md'), 'v2');
  writeFileSync(join(dir, 'filelevel/F.md'), 'v2');

  let fileLevelThrew = null;
  try {
    addPaths(['filelevel/F.md'], ctx);
  } catch (err) {
    fileLevelThrew = err;
  }
  if (!fileLevelThrew) {
    pass('a file-level ignore rule over a tracked path was never the problem');
  } else {
    fail('file-level ignore rule now blocks staging — the boundary moved');
  }

  let dirLevelThrew = null;
  try {
    addPaths(['dirlevel/F.md'], ctx);
  } catch (err) {
    dirLevelThrew = err;
  }
  if (!dirLevelThrew && stagedPaths(g).has('dirlevel/F.md')) {
    pass('a directory-level ignore rule over a tracked path stages under -f');
  } else {
    fail(`directory-level rule still blocks staging: ${dirLevelThrew?.message.split('\n')[0] ?? 'not staged'}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 3. isTracked separates "ignored but in the index" from "never tracked" ──
{
  const { dir, g, ctx } = makeRepo();
  writeFileSync(join(dir, 'seed.txt'), 'x');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, '.gitignore'), '.update-dismissed\nkept.txt\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignores');

  // Ignored AND tracked (force-added at some point) → stageable.
  writeFileSync(join(dir, 'kept.txt'), 'k');
  g('add', '-f', 'kept.txt');
  g('commit', '-qm', 'track an ignored file');

  // Ignored and never tracked — the .update-dismissed shape.
  writeFileSync(join(dir, '.update-dismissed'), new Date(0).toISOString());

  if (isTracked('kept.txt', ctx)) {
    pass('isTracked: true for an ignored-but-tracked path');
  } else {
    fail('isTracked said false for a tracked path — the marker guard would skip real work');
  }
  if (!isTracked('.update-dismissed', ctx)) {
    pass('isTracked: false for an ignored, never-tracked path');
  } else {
    fail('isTracked said true for a never-tracked path — apply() would stage an unmatched pathspec');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 4. the never-tracked marker is fatal if staged after deletion ──
//    Pins WHY apply() guards with isTracked rather than relying on -f.
{
  const { dir, g, ctx } = makeRepo();
  writeFileSync(join(dir, 'seed.txt'), 'x');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, '.gitignore'), '.update-dismissed\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignore marker');

  // dismiss() writes it, apply() deletes it — then it is an unmatched pathspec.
  writeFileSync(join(dir, '.update-dismissed'), 'ts');
  unlinkSync(join(dir, '.update-dismissed'));

  // git writes its own diagnostic to stderr here; the "fatal: pathspec" line
  // printed next is the expected failure, not a broken test.
  console.log('     ↓ the following git "fatal: pathspec" line is expected');

  let threw = null;
  try {
    addPaths(['.update-dismissed'], ctx);
  } catch (err) {
    threw = err;
  }
  if (threw) {
    pass('staging a deleted, never-tracked marker still fails (-f is no rescue)');
  } else {
    fail('expected an unmatched-pathspec failure; the isTracked guard would be pointless');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 5. the marker takes the WHOLE batch down, which is the production shape ──
//    apply() batches the marker together with the real system paths. A fatal
//    pathspec is rejected before git stages anything, so unlike cause 1 (which
//    exits non-zero having staged what it could) this leaves an empty index —
//    the update is neither committed nor staged.
{
  const { dir, g, ctx } = makeRepo();
  writeFileSync(join(dir, 'AGENTS.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, '.gitignore'), '.update-dismissed\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignore marker');

  writeFileSync(join(dir, 'AGENTS.md'), 'v2');              // a real system update
  writeFileSync(join(dir, '.update-dismissed'), 'ts');
  unlinkSync(join(dir, '.update-dismissed'));               // apply() deletes it

  console.log('     ↓ the following git "fatal: pathspec" line is expected');
  try {
    addPaths(['AGENTS.md', '.update-dismissed'], ctx);
  } catch {
    /* expected — asserting on the index below, not the throw */
  }
  if (stagedPaths(g).size === 0) {
    pass('an unmatched pathspec strands the entire batch, not just the marker');
  } else {
    fail(`expected an empty index; got: ${[...stagedPaths(g)].join(', ')}`);
  }

  // And with the guard applied (marker filtered out), the same batch stages.
  addPaths(['AGENTS.md'], ctx);
  if (stagedPaths(g).has('AGENTS.md')) {
    pass('the same batch stages once the untracked marker is filtered out');
  } else {
    fail('filtering the marker did not restore staging');
  }
  rmSync(dir, { recursive: true, force: true });
}
