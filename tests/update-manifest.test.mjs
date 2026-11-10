/**
 * update-manifest.test.mjs — the system manifest lives in lib/update-manifest.mjs
 * and every client can still upgrade to it (#5554).
 *
 * The updater never imports the module: it reads the file's source with
 * extractArrayFromSource(), locally and at the target, backup and paired
 * target refs. So the first check here is that the parse and the import agree;
 * an entry the parser cannot read would otherwise stop shipping without any
 * error (#2235).
 *
 * The rest is the upgrade path. Before #5554 every installed updater found
 * the target's list in the target's update-system.mjs, and v1.37 reads it
 * there in the parent, before the re-exec, refusing the update when the
 * list is empty or does not cover the target's import closure. That file now
 * keeps a short list for it, legacyParentManifest(), and the last case runs
 * v1.37's own code, from the release tag, against this checkout.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pass, fail, warn, rmSync } from './helpers.mjs';
import { SYSTEM_PATHS } from '../lib/update-manifest.mjs';
import {
  MANIFEST_MODULE,
  REEXEC_FALLBACK_FILES,
  USER_PATHS,
  extractArrayFromSource,
  isSafeManifestPath,
  legacyParentManifest,
  manifestSystemPathsAt,
  resolveReexecCheckout,
} from '../update-system.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFileSync(join(ROOT, ...file.split('/')), 'utf8');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const covers = (paths, file) => paths.some((entry) => (
  entry.endsWith('/') ? file.startsWith(entry) : file === entry
));
const manifestSource = read('lib/update-manifest.mjs');
const updaterSource = read('update-system.mjs');

console.log('\n🧪 Testing lib/update-manifest.mjs (#5554)...');

// ── 1. The parse is the list ──
{
  const parsed = extractArrayFromSource(manifestSource, 'SYSTEM_PATHS');
  if (parsed.length > 0 && eq(parsed, [...SYSTEM_PATHS])) {
    pass(`extractArrayFromSource reads the same ${parsed.length} entries the module exports`);
  } else {
    const missing = SYSTEM_PATHS.filter((path) => !parsed.includes(path));
    fail(`the parsed manifest differs from the exported one (parsed ${parsed.length}, exported ${SYSTEM_PATHS.length}; unparsed: ${JSON.stringify(missing.slice(0, 5))})`);
  }
  if (Object.isFrozen(SYSTEM_PATHS)) {
    pass('SYSTEM_PATHS is frozen');
  } else {
    fail('SYSTEM_PATHS is not frozen');
  }
  if (MANIFEST_MODULE === 'lib/update-manifest.mjs' && SYSTEM_PATHS.includes(MANIFEST_MODULE)) {
    pass('the manifest ships itself');
  } else {
    fail(`SYSTEM_PATHS does not list ${MANIFEST_MODULE}, so installs would never receive a new list`);
  }
  if (SYSTEM_PATHS[0] === '.gitattributes') {
    pass('.gitattributes stays the first entry');
  } else {
    fail(`.gitattributes must be checked out before every other path; first entry is ${JSON.stringify(SYSTEM_PATHS[0])}`);
  }
  const unsafe = SYSTEM_PATHS.filter((path) => !isSafeManifestPath(path, USER_PATHS));
  if (unsafe.length === 0) {
    pass('every entry is canonical and clear of the user layer');
  } else {
    fail(`unsafe manifest entries: ${JSON.stringify(unsafe)}`);
  }
  if (!/^\s*(?:import\b|export\b[^\n]*\bfrom\b)/m.test(manifestSource)) {
    pass('the manifest module imports nothing');
  } else {
    fail('lib/update-manifest.mjs grew an import; it must load wherever it is read');
  }
}

// ── 2. update-system.mjs holds no second copy ──
{
  const declarations = updaterSource
    .replace(/(['"])(?:\\.|(?!\1)[\s\S])*\1|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token) => (/^['"]/.test(token) ? token : ' '))
    .match(/const\s+SYSTEM_PATHS\s*=\s*\[/g) || [];
  if (declarations.length === 1) {
    pass('update-system.mjs declares one SYSTEM_PATHS literal (legacyParentManifest)');
  } else {
    fail(`update-system.mjs declares ${declarations.length} SYSTEM_PATHS literals; system paths belong in ${MANIFEST_MODULE}`);
  }
  if (eq(extractArrayFromSource(updaterSource, 'SYSTEM_PATHS'), legacyParentManifest())) {
    pass('an installed updater reading update-system.mjs finds legacyParentManifest()');
  } else {
    fail('extractArrayFromSource(update-system.mjs) does not return legacyParentManifest(); a v1.37 parent would read something else');
  }
}

// ── 3. legacyParentManifest() covers what a parent checks out ──
{
  const closure = resolveReexecCheckout('HEAD', 'update-system.mjs', read);
  const legacy = legacyParentManifest();
  const uncovered = closure.filter((file) => !covers(legacy, file));
  if (uncovered.length === 0) {
    pass(`legacyParentManifest() covers the re-exec closure (${closure.length} files)`);
  } else {
    fail(`legacyParentManifest() misses re-exec closure file(s): ${uncovered.join(', ')}`);
  }
  const notShipped = legacy.filter((file) => !covers(SYSTEM_PATHS, file) || !existsSync(join(ROOT, file)));
  if (notShipped.length === 0) {
    pass('every legacyParentManifest() entry is a shipped file');
  } else {
    fail(`legacyParentManifest() names file(s) the manifest does not ship: ${notShipped.join(', ')}`);
  }
  if (REEXEC_FALLBACK_FILES.includes(MANIFEST_MODULE) && closure.includes(MANIFEST_MODULE)) {
    pass('the re-exec checks the manifest out for the child');
  } else {
    fail(`${MANIFEST_MODULE} is not in the re-exec checkout, so the child would run on the old list`);
  }
}

// ── 4. manifestSystemPathsAt picks the file by layout ──
{
  const newLayout = {
    // Like legacyParentManifest(): the short list names the module.
    'update-system.mjs': `const SYSTEM_PATHS = [\n  'update-system.mjs',\n  '${MANIFEST_MODULE}',\n];`,
    [MANIFEST_MODULE]: "export const SYSTEM_PATHS = [\n  'update-system.mjs',\n  'a.mjs',\n];\nObject.freeze(SYSTEM_PATHS);",
  };
  const oldLayout = { 'update-system.mjs': "const SYSTEM_PATHS = [\n  'update-system.mjs',\n  'b.mjs',\n];" };
  const emptyModule = { ...newLayout, [MANIFEST_MODULE]: 'export const SYSTEM_PATHS = [\n];' };
  const at = (tree) => manifestSystemPathsAt('ref', {
    has: (path) => path in tree,
    show: (path) => {
      if (!(path in tree)) throw new Error(`no ${path}`);
      return tree[path];
    },
  });

  const fromNew = at(newLayout);
  if (fromNew.file === MANIFEST_MODULE && eq(fromNew.paths, ['update-system.mjs', 'a.mjs'])) {
    pass('a ref with the module is read from the module, not the legacy list');
  } else {
    fail(`new layout read wrong: ${JSON.stringify(fromNew)}`);
  }
  const fromOld = at(oldLayout);
  if (fromOld.file === 'update-system.mjs' && eq(fromOld.paths, ['update-system.mjs', 'b.mjs'])) {
    pass('a ref from before the split is read from its update-system.mjs');
  } else {
    fail(`old layout read wrong: ${JSON.stringify(fromOld)}`);
  }
  // A failed probe on a commit that has the module must not yield the short
  // list: `has` answers false on any git error, and that list is non-empty.
  let probeFailure = null;
  try {
    manifestSystemPathsAt('ref', {
      has: () => false,
      show: (path) => {
        if (!(path in newLayout)) throw new Error(`no ${path}`);
        return newLayout[path];
      },
    });
  } catch (err) {
    probeFailure = err;
  }
  if (probeFailure && probeFailure.message.includes(MANIFEST_MODULE)) {
    pass('a failed module probe on a new-layout ref throws rather than returning the short legacy list');
  } else {
    fail('a failed module probe fell back to the short list in update-system.mjs');
  }
  const fromEmpty = at(emptyModule);
  if (fromEmpty.file === MANIFEST_MODULE && fromEmpty.paths.length === 0) {
    pass('an empty module comes back empty for the caller to refuse, with no fallback to the legacy list');
  } else {
    fail(`an empty module fell back: ${JSON.stringify(fromEmpty)}`);
  }
}

// ── 5. v1.37's own pre-re-exec gate accepts this checkout ──
//
// v1.37.0 is the one release whose parent reads the target's manifest before
// re-execing (#5554's compatibility constraint). Its update-system.mjs is
// self-loading, so it imports standalone from a temp directory, and its exports
// are what the parent ran: extractArrayFromSource, resolveReexecCheckout with
// its own REEXEC_FALLBACK_FILES. This repeats that gate against the files on
// disk, the same check upgrade-tests.mjs makes end to end from the tag.
{
  const tag = 'career-ops-v1.37.0';
  let legacySource = null;
  try {
    legacySource = execFileSync('git', ['show', `${tag}:update-system.mjs`], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    warn(`${tag} is not fetched (CI checks out with fetch-depth: 0); skipped the v1.37 parent simulation`);
  }
  if (legacySource !== null) {
    const dir = mkdtempSync(join(tmpdir(), 'co-v137-parent-'));
    try {
      const file = join(dir, 'update-system.mjs');
      writeFileSync(file, legacySource);
      const v137 = await import(pathToFileURL(file).href);
      const localSystem = v137.extractArrayFromSource(legacySource, 'SYSTEM_PATHS');
      const localBootstrap = v137.extractArrayFromSource(legacySource, 'BOOTSTRAP_PATHS');
      const remote = v137.extractArrayFromSource(updaterSource, 'SYSTEM_PATHS');
      const merged = [...new Set([...localSystem, ...remote, ...localBootstrap])];
      const closure = v137.resolveReexecCheckout('HEAD', 'update-system.mjs', read);
      const uncovered = closure.filter((path) => !covers(merged, path));
      if (remote.length > 0 && remote.every((path) => v137.isSafeManifestPath(path, []))) {
        pass('v1.37 finds a non-empty, canonical target SYSTEM_PATHS in update-system.mjs');
      } else {
        fail(`v1.37 would refuse the update: target SYSTEM_PATHS is ${JSON.stringify(remote)}`);
      }
      if (uncovered.length === 0) {
        pass(`v1.37's merged manifest covers the target import closure it checks out (${closure.length} files)`);
      } else {
        fail(`v1.37 would refuse: "Target updater import closure is outside the validated manifest: ${uncovered.join(', ')}"`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
