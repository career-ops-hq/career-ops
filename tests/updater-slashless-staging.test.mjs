/**
 * updater-slashless-staging.test.mjs — slashless directory manifest entries
 * during staging (#7250).
 *
 * The manifest can spell a directory without a trailing slash. Passed through
 * as a filename it reaches addPaths, whose rejectDirectories guard throws, and
 * the update stops at staging. expandToShippedFiles resolves the spelling
 * against the target tree; ordinary file entries pass through unchanged.
 *
 * Follows updater-rollback-behavior.test.mjs: drive the real exports against a
 * throwaway repo through the git-runner seam, so the property is verified
 * rather than the source merely pattern-matched.
 */

import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo } from './helpers.mjs';
import { addPaths, expandToShippedFiles, stagingFileList } from '../update-system.mjs';

// Shared with updater-add-paths.test.mjs: addPaths resolves paths against
// `root` to decide what is a directory, and without it the guard would lstat
// the real repository instead of this fixture.
const makeRepo = () => makeUpdaterRepo({ prefix: 'co-slashless-', includeRoot: true });

// -z for the same reason the expansion uses it: under core.quotePath (the
// default) git renders a non-ASCII name as "modes/\346\227\245...", so a
// newline-split assertion silently misses a path that staged perfectly well.
const stagedPaths = g =>
  new Set(g('diff', '--cached', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean));

console.log('\n🧪 Testing slashless directory staging expansion (#7250)...');

// ── 1. a slashless directory manifest entry expands during staging ──
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'lib/nested'), { recursive: true });
  writeFileSync(join(dir, 'lib/update-manifest.mjs'), 'v1');
  writeFileSync(join(dir, 'lib/nested/deep.mjs'), 'v1');
  writeFileSync(join(dir, 'AGENTS.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // The update lands new content under the slashless directory spelling; the
  // expansion reads the target tree for names, staging reads the worktree.
  writeFileSync(join(dir, 'lib/update-manifest.mjs'), 'v2');
  writeFileSync(join(dir, 'lib/nested/deep.mjs'), 'v2');
  writeFileSync(join(dir, 'AGENTS.md'), 'v2');

  const expanded = expandToShippedFiles(['lib', 'AGENTS.md'], 'HEAD', ctx);
  let threw = null;
  try {
    addPaths(expanded, ctx);
  } catch (err) {
    threw = err;
  }
  const staged = stagedPaths(g);
  if (!threw && !expanded.includes('lib') && expanded.includes('lib/update-manifest.mjs')
      && expanded.includes('lib/nested/deep.mjs') && expanded.includes('AGENTS.md')
      && staged.has('lib/update-manifest.mjs') && staged.has('lib/nested/deep.mjs') && staged.has('AGENTS.md')) {
    pass('slashless directory entry expands to shipped files and stages; file entries unchanged');
  } else {
    fail(`slashless expansion failed: threw=${threw?.message?.split('\n')[0]} expanded=${expanded.join(',')} staged=${[...staged].join(',')}`);
  }

  // Preserved files under the slashless directory stay out of staging.
  const derived = stagingFileList(['lib'], ['lib/nested/deep.mjs'], 'HEAD', ctx);
  if (!derived.includes('lib') && derived.includes('lib/update-manifest.mjs') && !derived.includes('lib/nested/deep.mjs')) {
    pass('stagingFileList expands the slashless directory and excludes the preserved file');
  } else {
    fail(`stagingFileList slashless handling wrong: ${derived.join(',')}`);
  }

  // A slashless entry absent from the tree still passes through: a stale
  // manifest entry, or a deletion restaged by name.
  const stale = expandToShippedFiles(['retired-dir'], 'HEAD', ctx);
  if (stale.length === 1 && stale[0] === 'retired-dir') {
    pass('slashless entry absent from the tree passes through unchanged');
  } else {
    fail(`absent slashless entry mishandled: ${stale.join(',')}`);
  }

  // Non-vacuity: without expansion the bare directory trips the guard.
  let guardThrew = null;
  try {
    addPaths(['lib'], ctx);
  } catch (err) {
    guardThrew = err;
  }
  g('reset', '-q');
  if (guardThrew && /directory pathspec/.test(guardThrew.message)) {
    pass('oracle holds: the bare slashless directory still trips rejectDirectories');
  } else {
    fail('oracle broken: addPaths accepted a bare directory pathspec');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 2. parent and nested directory entries expand in the same probe ──
//     Probing `lib` and `lib/nested` in one ls-tree descends into lib for the
//     nested pathspec; without -t git drops the lib tree record, the parent
//     reads as an ordinary file, and a bare directory reaches addPaths.
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'lib/nested'), { recursive: true });
  writeFileSync(join(dir, 'lib/core.mjs'), 'v1');
  writeFileSync(join(dir, 'lib/nested/deep.mjs'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // The update lands new content under both spellings; staging reads the worktree.
  writeFileSync(join(dir, 'lib/core.mjs'), 'v2');
  writeFileSync(join(dir, 'lib/nested/deep.mjs'), 'v2');

  const expanded = expandToShippedFiles(['lib', 'lib/nested'], 'HEAD', ctx);
  if (!expanded.includes('lib') && !expanded.includes('lib/nested')
      && expanded.includes('lib/core.mjs') && expanded.includes('lib/nested/deep.mjs')) {
    pass('parent and nested directory entries both expand in one probe');
  } else {
    fail(`parent+nested probe wrong: ${expanded.join(',')}`);
  }

  // Staging that expansion stays clean: no bare directory reaches the guard.
  let threw = null;
  try {
    addPaths(expanded, ctx);
  } catch (err) {
    threw = err;
  }
  const staged = stagedPaths(g);
  if (!threw && staged.has('lib/core.mjs') && staged.has('lib/nested/deep.mjs')) {
    pass('the parent+nested expansion stages cleanly');
  } else {
    fail(`parent+nested staging failed: threw=${threw?.message?.split('\n')[0]} staged=${[...staged].join(',')}`);
  }
  rmSync(dir, { recursive: true, force: true });
}
