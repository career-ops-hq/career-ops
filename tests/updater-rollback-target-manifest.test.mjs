/**
 * updater-rollback-target-manifest.test.mjs — BEHAVIORAL coverage for #3780.
 *
 * rollback() is ROOT-bound with heavy side effects, so the path list it
 * restores/removes is extracted into rollbackSystemPaths() and driven here,
 * same shape as updater-local-system-edits.test.mjs's pathFullyPreserved
 * cases. What is verified: a file the TARGET release added is not invisible
 * to rollback() just because apply() failed before checking out its own
 * update-system.mjs, which is what left the on-disk SYSTEM_PATHS constant
 * still describing the OLD release.
 */

import { pass, fail } from './helpers.mjs';
import { rollbackSystemPaths } from '../update-system.mjs';

const fakeTargetSource = (paths) =>
  `const SYSTEM_PATHS = [\n${paths.map((p) => `  '${p}',`).join('\n')}\n];\n`;

// ── 1. A file the TARGET release added is included via FETCH_HEAD ──
{
  const targetOnlyFile = 'plugins/h1b-sponsor/index.mjs';
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', targetOnlyFile]);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };

  const paths = rollbackSystemPaths(ctx);
  if (paths.includes(targetOnlyFile)) {
    pass('a file only the TARGET release\'s manifest lists is included (#3780)');
  } else {
    fail(`#1 expected ${targetOnlyFile} in the merged list, got ${JSON.stringify(paths)}`);
  }
}

// ── 2. FETCH_HEAD unreadable degrades to the current manifest, never throws ──
{
  const ctx = { git: () => { throw new Error('no FETCH_HEAD (consumed by a later fetch)'); } };

  let threw = false;
  let paths = null;
  try {
    paths = rollbackSystemPaths(ctx);
  } catch {
    threw = true;
  }
  if (!threw && Array.isArray(paths) && paths.includes('AGENTS.md')) {
    pass('an unreadable FETCH_HEAD degrades to the current manifest instead of throwing');
  } else {
    fail(`#2 threw=${threw} paths=${JSON.stringify(paths)}`);
  }
}

// ── 3. A target predating update-system.mjs (empty SYSTEM_PATHS match) also degrades ──
{
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return 'this file predates update-system.mjs having a SYSTEM_PATHS array at all\n';
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };

  const paths = rollbackSystemPaths(ctx);
  if (Array.isArray(paths) && paths.includes('AGENTS.md')) {
    pass('a target with no SYSTEM_PATHS array still returns the current manifest');
  } else {
    fail(`#3 expected the current manifest, got ${JSON.stringify(paths)}`);
  }
}

// ── 4. Entries the current manifest and the target manifest share are not duplicated ──
{
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', 'modes/pdf.md']);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };

  const paths = rollbackSystemPaths(ctx);
  const agentsMdCount = paths.filter((p) => p === 'AGENTS.md').length;
  if (agentsMdCount === 1) {
    pass('an entry present in both the current and target manifest appears exactly once');
  } else {
    fail(`#4 expected AGENTS.md exactly once, appeared ${agentsMdCount} times`);
  }
}
