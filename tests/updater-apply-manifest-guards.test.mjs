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
  fallbackCheckoutBatched,
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
  const fallbackBatchedPattern = /fallbackCheckoutBatched\(\s*fallbackSpecs,\s*targetCommit\s*\)/;
  check(
    fallbackBatchedPattern.test(applyBody),
    'per-path fallback checkout runs through fallbackCheckoutBatched(fallbackSpecs, targetCommit)',
    'per-path fallback checkout is not the batched fallbackCheckoutBatched form',
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


  const helperLiteralPattern = /const fixedArgs = \[\s*'--literal-pathspecs',\s*'checkout',\s*targetCommit,\s*'--'\s*\]/;
  check(
    helperLiteralPattern.test(updaterSource),
    'fallbackCheckoutBatched passes "--literal-pathspecs" with the pinned target and "--"',
    'fallbackCheckoutBatched lost its literal-pathspecs fixed arguments',
  );
  const helperBudgetPattern = /argvBatches\(\s*fallbackSpecs,\s*\{\s*budget:\s*ARGV_BUDGET - fixed\s*\}\s*\)/;
  check(
    helperBudgetPattern.test(updaterSource),
    'fallbackCheckoutBatched batches fallbackSpecs under ARGV_BUDGET minus the fixed arguments',
    'fallbackCheckoutBatched does not batch fallbackSpecs under the ARGV budget',
  );

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

// ── 8. fallbackCheckoutBatched batches a long expansion under the argv budget ──
{
  // Reviewer-measured shape: a directory entry expanding to ~1500 preserved-
  // sibling files (~64,500 argv chars) must not ride on one git call.
  const specs = [];
  for (let i = 0; i < 1500; i++) specs.push(`lib/generated/module-${String(i).padStart(4, '0')}.mjs`);
  const TARGET = 'a'.repeat(40);
  const calls = [];
  const recordingGit = (...args) => { calls.push(args); return ''; };

  fallbackCheckoutBatched(specs, TARGET, { git: recordingGit });

  check(calls.length > 1, `long expansion splits into multiple git runs (${calls.length})`, 'long expansion still runs as a single git call');
  const seen = [];
  for (const call of calls) {
    check(
      call[0] === '--literal-pathspecs' && call[1] === 'checkout' && call[2] === TARGET && call[3] === '--',
      'each batch passes --literal-pathspecs, checkout, the pinned target, and --',
      `batch lost its fixed arguments: ${call.slice(0, 5).join(' ')}`,
    );
    const argvChars = call.reduce((total, arg) => total + arg.length + 1, 0);
    check(argvChars <= 8000, `batch stays within the argv budget (${argvChars} chars)`, `batch exceeds the argv budget: ${argvChars} chars`);
    check(!call.some((arg) => arg.includes(':(exclude')), 'no :(exclude) expression reaches any batch', 'a batch carried an exclusion expression');
    seen.push(...call.slice(4));
  }
  check(
    JSON.stringify(seen) === JSON.stringify(specs),
    'every expanded spec is checked out exactly once, in order',
    `batched specs diverge from the expansion (${seen.length} of ${specs.length})`,
  );

  // A small expansion still makes exactly one call with identical argv.
  const small = ['lib/a.mjs', 'lib/c.mjs'];
  const smallCalls = [];
  fallbackCheckoutBatched(small, TARGET, { git: (...args) => { smallCalls.push(args); return ''; } });
  check(
    smallCalls.length === 1 && JSON.stringify(smallCalls[0]) === JSON.stringify(['--literal-pathspecs', 'checkout', TARGET, '--', ...small]),
    'a small expansion keeps the previous single-call argv exactly',
    `small expansion changed shape: ${JSON.stringify(smallCalls)}`,
  );
}

// ── 9. fallbackCheckoutBatched propagates batch failures for caller restore ──
{
  const specs = [];
  for (let i = 0; i < 300; i++) specs.push(`lib/generated/module-${String(i).padStart(4, '0')}.mjs`);
  const TARGET = 'b'.repeat(40);

  // Forced initial-batch failure: nothing is written, the error reaches the
  // caller's per-path restore.
  let firstCalls = 0;
  let firstErr = null;
  try {
    fallbackCheckoutBatched(specs, TARGET, { git: () => { firstCalls++; throw new Error('forced initial failure'); } });
  } catch (err) { firstErr = err; }
  check(firstErr && firstErr.message === 'forced initial failure', 'an initial batch failure propagates', 'initial batch failure was swallowed');
  check(firstCalls === 1, 'no later batch runs after the first fails', `unexpected extra batches after initial failure: ${firstCalls}`);

  // Second-batch failure: the first batch WAS written before the failure, so
  // the caller must restore the path - the helper surfaces the error with the
  // earlier writes already done.
  const written = [];
  let secondErr = null;
  try {
    fallbackCheckoutBatched(specs, TARGET, { git: (...args) => { if (written.length > 0) throw new Error('forced second-batch failure'); written.push(args.slice(4)); return ''; } });
  } catch (err) { secondErr = err; }
  check(secondErr && secondErr.message === 'forced second-batch failure', 'a second-batch failure propagates after earlier writes', 'second-batch failure was swallowed');
  check(written.length === 1 && written[0].length > 0, 'the first batch landed before the failure (caller restores it)', 'first batch did not complete before the forced failure');
}
