/*
 * updater-apply-manifest-guards.test.mjs — apply() target manifest validation,
 * .env user protection, and literal pathspecs (#3825).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  USER_PATHS,
  assertSafeManifestPaths,
  fallbackCheckoutSpecs,
  isSafeManifestPath,
  rejectUserLayerPaths,
} from '../update-system.mjs';
import assert from 'node:assert/strict';
import { pass } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const updaterSource = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8').replace(/\r\n/g, '\n');

function check(condition, ok, bad) {
  // Must throw, not only count: node --test runs this file as a single test
  // and just incrementing helpers' fail counter leaves it green (exit 0).
  if (condition) { pass(ok); return; }
  assert.fail(bad);
}

console.log('\n🧪 Testing updater apply target manifest guards (#3825)...');

// ── 1. .env is protected as user-owned; .env.example remains safe ──
{
  check(
    USER_PATHS.includes('.env'),
    'USER_PATHS includes ".env"',
    '.env is missing from USER_PATHS',
  );

  check(
    isSafeManifestPath('.env') === false,
    'isSafeManifestPath(".env") is false',
    '.env was unexpectedly accepted as a safe manifest path',
  );

  check(
    isSafeManifestPath('.env.example') === true,
    'isSafeManifestPath(".env.example") is true',
    '.env.example was unexpectedly rejected',
  );

  const envVariants = [
    ['.ENV', false, 'case-folded alias'],
    ['.env/nested', false, 'child path under .env'],
    ['./.env', false, 'leading dot-slash alias'],
    ['.env.example', true, 'example scaffold file'],
    ['.env.sample', true, 'sample scaffold file'],
    ['.env.local', true, 'unrelated non-overlapping sibling file'],
  ];

  for (const [path, expected, desc] of envVariants) {
    const actual = isSafeManifestPath(path);
    check(
      actual === expected,
      `isSafeManifestPath(${JSON.stringify(path)}) is ${expected} (${desc})`,
      `isSafeManifestPath(${JSON.stringify(path)}) was ${actual}, expected ${expected} (${desc})`,
    );
  }
}

// ── 2. assertSafeManifestPaths rejects user-layer paths and .env ──
{
  let threwEnv = false;
  let envError = '';
  try {
    assertSafeManifestPaths(['.env', 'lib/update-manifest.mjs'], USER_PATHS, 'Target manifest');
  } catch (err) {
    threwEnv = true;
    envError = err.message;
  }
  check(
    threwEnv && envError.includes('Target manifest contains unsafe manifest path(s): ".env"')
      && envError.includes('it overlaps protected user path ".env"'),
    'assertSafeManifestPaths rejects .env naming the protected user path',
    `assertSafeManifestPaths did not reject .env as expected: threw=${threwEnv}, message=${envError}`,
  );

  let threwUser = false;
  let userError = '';
  try {
    assertSafeManifestPaths(['data/private.json', 'lib/update-manifest.mjs'], USER_PATHS, 'Target manifest');
  } catch (err) {
    threwUser = true;
    userError = err.message;
  }
  check(
    threwUser && userError.includes('Target manifest contains unsafe manifest path(s): "data/private.json"')
      && userError.includes('it overlaps protected user path "data/"'),
    'assertSafeManifestPaths rejects user directory descendants (data/private.json)',
    `assertSafeManifestPaths did not reject user directory as expected: threw=${threwUser}, message=${userError}`,
  );

  let allowed = false;
  try {
    const safe = assertSafeManifestPaths(['.env.example', 'lib/update-manifest.mjs'], USER_PATHS, 'Target manifest');
    allowed = safe.length === 2 && safe[0] === '.env.example';
  } catch {
    allowed = false;
  }
  check(
    allowed,
    'assertSafeManifestPaths permits safe paths including .env.example',
    'assertSafeManifestPaths unexpectedly rejected safe paths',
  );
}

// ── 3. rejectUserLayerPaths refuses .env from manifest entries ──
{
  const testManifest = [
    '.env',
    'cv.md',
    'modes/update.md',
    'lib/update-manifest.mjs',
    'data/rogue-user-file.json',
  ];

  const { kept, refused } = rejectUserLayerPaths(testManifest, USER_PATHS, {
    tracked: () => false,
    exists: () => false,
    claimsSubtree: (p) => p.startsWith('data/'),
  });

  check(
    refused.includes('.env'),
    'rejectUserLayerPaths refuses .env',
    `rejectUserLayerPaths failed to refuse .env: refused=${JSON.stringify(refused)}`,
  );
  check(
    refused.includes('cv.md') && refused.includes('data/rogue-user-file.json'),
    'rejectUserLayerPaths refuses cv.md and data/rogue-user-file.json',
    `rejectUserLayerPaths failed to refuse user layer paths: refused=${JSON.stringify(refused)}`,
  );
  check(
    kept.includes('modes/update.md') && kept.includes('lib/update-manifest.mjs'),
    'rejectUserLayerPaths keeps non-user-layer system paths',
    `rejectUserLayerPaths dropped system paths: kept=${JSON.stringify(kept)}`,
  );
}

// ── 4. Trust model documentation beside isSafeManifestPath ──
{
  const trustModelDoc = updaterSource.includes('Trust model:')
    && updaterSource.includes('A self-updater that re-execs the fetched update-system.mjs trusts upstream')
    && updaterSource.includes('defend against a mis-authored')
    && updaterSource.includes('or corrupted manifest')
    && updaterSource.includes('.env is protected as user-owned');
  check(
    trustModelDoc,
    'update-system.mjs documents the updater trust model beside isSafeManifestPath()',
    'missing trust model documentation beside isSafeManifestPath()',
  );
}

// ── 5. Checkout literal pathspecs symmetry across updater checkouts ──
{
  const applyStart = updaterSource.indexOf('async function apply() {');
  const applyEnd = updaterSource.indexOf('\nfunction rollback(', applyStart);
  check(
    applyStart !== -1 && applyEnd !== -1,
    'located apply() in update-system.mjs',
    'could not locate apply() in update-system.mjs',
  );

  const applyBody = updaterSource.slice(applyStart, applyEnd);

  // Batched checkout passes --literal-pathspecs
  const batchedPattern = /fixedArgs\s*=\s*\[\s*['"]--literal-pathspecs['"],\s*['"]checkout['"],\s*targetCommit,\s*['"]--['"]\s*\]/;
  check(
    batchedPattern.test(updaterSource),
    'batched checkout passes "--literal-pathspecs"',
    'batched checkout does not pass "--literal-pathspecs"',
  );

  // Re-exec checkout passes --literal-pathspecs
  const reexecCheckoutPattern = /git\(\s*['"]--literal-pathspecs['"],\s*['"]checkout['"],\s*targetCommit,\s*['"]--['"],\s*\.\.\.reexecFiles\s*\)/;
  check(
    reexecCheckoutPattern.test(applyBody),
    're-exec checkout passes "--literal-pathspecs"',
    're-exec checkout does not pass --literal-pathspecs',
  );

  // Rollback restore checkout passes --literal-pathspecs
  const rollbackBody = updaterSource.slice(applyEnd);
  const rollbackCheckoutPattern = /git\(\s*['"]--literal-pathspecs['"],\s*['"]checkout['"],\s*latest,\s*['"]--['"],\s*file\s*\)/;
  check(
    rollbackCheckoutPattern.test(rollbackBody),
    'rollback restore checkout passes "--literal-pathspecs"',
    'rollback restore checkout does not pass --literal-pathspecs',
  );

  // Fallback per-path checkout is literal too, fed by fallbackCheckoutSpecs,
  // and no :(exclude) expression reaches it: with --literal-pathspecs git
  // would read an exclusion as a literal filename and fail the checkout.
  const fallbackLiteralPattern = /gitQuiet\(\s*['"]--literal-pathspecs['"],\s*['"]checkout['"],\s*targetCommit,\s*['"]--['"],\s*\.\.\.fallbackSpecs\s*\)/;
  check(
    fallbackLiteralPattern.test(applyBody),
    'per-path fallback checkout passes "--literal-pathspecs" over fallbackCheckoutSpecs',
    'per-path fallback checkout is not the literal fallbackCheckoutSpecs form',
  );
  const fallbackExcludePattern = /gitQuiet\(\s*['"]checkout['"],\s*targetCommit,\s*['"]--['"],\s*path,\s*\.\.\.preserveSpecs\s*\)/;
  check(
    !fallbackExcludePattern.test(applyBody),
    'no :(exclude) expression reaches the fallback checkout',
    'fallback checkout still passes preserveSpecs exclusion expressions',
  );
}

// ── 6. apply() validates the target and merged manifests against user paths ──
{
  const applyStart = updaterSource.indexOf('async function apply() {');
  const applyEnd = updaterSource.indexOf('\nfunction rollback(', applyStart);
  const applyBody = updaterSource.slice(applyStart, applyEnd);

  const targetValidation = /assertSafeManifestPaths\(\s*remoteSystemPaths,\s*manifestUserPaths,/;
  check(
    targetValidation.test(applyBody),
    'apply() validates the target SYSTEM_PATHS against effective user paths',
    'apply() does not validate the target SYSTEM_PATHS against user paths',
  );

  const mergedValidation = /assertSafeManifestPaths\(\s*validatedManifestPaths,\s*manifestUserPaths,\s*['"]Merged updater manifest['"]/;
  check(
    mergedValidation.test(applyBody),
    'apply() validates the merged updater manifest against effective user paths before checkout',
    'apply() does not validate the merged manifest against user paths',
  );
}

// ── 7. fallbackCheckoutSpecs names concrete files, never exclusion magic ──
{
  const upstream = ['lib/a.mjs', 'lib/sub/b.mjs', 'lib/c.mjs', 'VERSION'];

  check(
    JSON.stringify(fallbackCheckoutSpecs('VERSION', [], upstream)) === JSON.stringify(['VERSION']),
    'fallbackCheckoutSpecs names a file entry as itself',
    `file entry expanded unexpectedly: ${JSON.stringify(fallbackCheckoutSpecs('VERSION', [], upstream))}`,
  );
  check(
    JSON.stringify(fallbackCheckoutSpecs('lib/', [], upstream)) === JSON.stringify(['lib/']),
    'fallbackCheckoutSpecs names a directory without preserved files as itself',
    `plain directory expanded unexpectedly: ${JSON.stringify(fallbackCheckoutSpecs('lib/', [], upstream))}`,
  );
  check(
    JSON.stringify(fallbackCheckoutSpecs('lib/', ['lib/sub/b.mjs'], upstream)) === JSON.stringify(['lib/a.mjs', 'lib/c.mjs']),
    'fallbackCheckoutSpecs expands a directory with a preserved file to its other upstream files',
    `preserved directory expanded unexpectedly: ${JSON.stringify(fallbackCheckoutSpecs('lib/', ['lib/sub/b.mjs'], upstream))}`,
  );
  check(
    fallbackCheckoutSpecs('lib/', ['lib/a.mjs', 'lib/sub/b.mjs', 'lib/c.mjs'], upstream).length === 0,
    'fallbackCheckoutSpecs leaves nothing when every upstream file under the entry is preserved',
    'a fully preserved directory should expand to no specs',
  );
  check(
    JSON.stringify(fallbackCheckoutSpecs('lib/', ['lib/a.mjs'], [])) === JSON.stringify(['lib/']),
    'fallbackCheckoutSpecs names the entry itself when the target tree listing is unavailable',
    `unavailable tree listing expanded unexpectedly: ${JSON.stringify(fallbackCheckoutSpecs('lib/', ['lib/a.mjs'], []))}`,
  );
}
