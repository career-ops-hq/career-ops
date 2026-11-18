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
  pathFullyPreserved,
  planSystemCheckout,
  preservedCheckoutCollision,
  rejectUserLayerPaths,
  preservedSpecCollision,
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
    '.env/config',
    '.env.example',
    'cv.md',
    'modes/update.md',
    'lib/update-manifest.mjs',
    'data/rogue-user-file.json',
    'documents/readme.md',
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
  check(
    refused.includes('.env/config'),
    'rejectUserLayerPaths refuses a child of the fixed user file .env (git would replace the file with a directory)',
    `rejectUserLayerPaths failed to refuse .env/config: refused=${JSON.stringify(refused)}`,
  );
  check(
    kept.includes('.env.example'),
    'rejectUserLayerPaths keeps .env.example (a sibling, not a child of .env)',
    `rejectUserLayerPaths dropped .env.example: kept=${JSON.stringify(kept)}`,
  );
  check(
    kept.includes('documents/readme.md'),
    'rejectUserLayerPaths still adjudicates a single file under a directory declaration',
    `rejectUserLayerPaths refused documents/readme.md: refused=${JSON.stringify(refused)}`,
  );
}

// ── 3c. overlapping declarations: every ancestor adjudicates, not the first
//    match — a subtree claim listed earlier must not soften a fixed user file
//    listed later, and the reverse order refuses the same way (#7250 review).
{
  const probes = {
    tracked: () => true,
    exists: () => false,
    // data/ claims a subtree; data/secrets is a fixed file.
    claimsSubtree: (p) => p === 'data/' || p === 'data',
  };
  const subtreeFirst = rejectUserLayerPaths(['data/secrets/config.yml'], ['data/', 'data/secrets'], probes);
  check(
    subtreeFirst.refused.includes('data/secrets/config.yml'),
    'a child of a fixed user file is refused even when a subtree declaration matches first',
    `subtree-first order kept the child: kept=${JSON.stringify(subtreeFirst.kept)}`,
  );
  const fileFirst = rejectUserLayerPaths(['data/secrets/config.yml'], ['data/secrets', 'data/'], probes);
  check(
    fileFirst.refused.includes('data/secrets/config.yml'),
    'a child of a fixed user file is refused in either declaration order',
    `file-first order kept the child: kept=${JSON.stringify(fileFirst.kept)}`,
  );
  const allSubtree = rejectUserLayerPaths(['data/notes/readme.md'], ['data/', 'data/notes/'], probes);
  check(
    allSubtree.kept.includes('data/notes/readme.md'),
    'an unbroken chain of subtree claims still adjudicates a single file',
    `subtree-only chain refused the file: refused=${JSON.stringify(allSubtree.refused)}`,
  );
}

// ── 3b. preservedSpecCollision: the entry-level check at write depth ──
{
  check(
    preservedSpecCollision('lib/nested', ['lib/nested/local.md']) !== null,
    'preservedSpecCollision refuses a target file over a preserved local directory',
    'preservedSpecCollision missed the file-over-directory shape',
  );
  check(
    preservedSpecCollision('lib/blob/x.md', ['lib/blob']) !== null,
    'preservedSpecCollision refuses a target directory over a preserved local file',
    'preservedSpecCollision missed the directory-over-file shape',
  );
  check(
    preservedSpecCollision('lib/a.mjs', ['lib/nested/local.md', 'lib/blob']) === null,
    'preservedSpecCollision lets an ordinary sibling update',
    'preservedSpecCollision refused an ordinary sibling',
  );
}

// ── 3c. Update-owned file detection uses the expanded staging list ──
{
  const stagedCall = /stagedPathsOutside\(\s*\[\.\.\.expandedPathsToStage, \.\.\.materializedSkillEntrypoints\]/;
  const unstagedCall = /unstagedPathsOutside\(\s*\[\.\.\.expandedPathsToStage, \.\.\.materializedSkillEntrypoints\]/;
  check(
    stagedCall.test(updaterSource),
    'the staged-ownership check judges the expanded staging list, not the manifest spelling',
    'stagedPathsOutside is not called with expandedPathsToStage',
  );
  check(
    unstagedCall.test(updaterSource),
    'the unstaged-ownership check judges the expanded staging list, not the manifest spelling',
    'unstagedPathsOutside is not called with expandedPathsToStage',
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

// ── 6. apply() refuses user-layer manifest entries without aborting (#3782) ──
// A poisoned entry (cv.md, data/, .env in SYSTEM_PATHS) is a manifest error,
// but aborting the whole update bricks every install's updates for one bad
// entry: the established contract is per-entry refusal, out loud, before any
// checkout, with the rest of the update completing.
{
  const applyStart = updaterSource.indexOf('async function apply() {');
  const applyEnd = updaterSource.indexOf('\nfunction rollback(', applyStart);
  const applyBody = updaterSource.slice(applyStart, applyEnd);

  const fatalTargetValidation = /assertSafeManifestPaths\(\s*remoteSystemPaths,\s*manifestUserPaths,/;
  check(
    !fatalTargetValidation.test(applyBody),
    'apply() does not abort on a target SYSTEM_PATHS entry naming the user layer (#3782)',
    'apply() still aborts on a user-layer target manifest entry instead of refusing it per entry',
  );

  const fatalMergedValidation = /assertSafeManifestPaths\(\s*validatedManifestPaths,\s*manifestUserPaths,\s*['"]Merged updater manifest['"]/;
  check(
    !fatalMergedValidation.test(applyBody),
    'apply() does not abort on a merged-manifest entry naming the user layer (#3782)',
    'apply() still aborts on a user-layer merged manifest entry instead of refusing it per entry',
  );

  const refusal = /rejectUserLayerPaths\(\s*mergePathLists\(SYSTEM_PATHS, remoteSystemPaths, BOOTSTRAP_PATHS\),\s*effectiveUserPaths\(\)/;
  const refusalAt = applyBody.search(refusal);
  check(
    refusalAt !== -1,
    'apply() refuses user-layer entries from the merged manifest, against the effective user paths, before checkout (#3782)',
    'apply() no longer refuses merged-manifest entries against the effective user paths',
  );

  const checkoutAt = applyBody.indexOf('checkoutSystemPathsBatched(updatePaths, preservedPaths, upstreamFiles, targetCommit');
  check(
    refusalAt !== -1 && checkoutAt > refusalAt,
    'the batched checkout consumes only the refused-filtered updatePaths',
    'the batched checkout does not clearly consume the refused-filtered updatePaths',
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

  const probeTreePattern = /ls-tree', '-z', '-t'/;
  check(
    probeTreePattern.test(updaterSource),
    'the slashless staging probe keeps parent tree records (-t)',
    'the slashless staging probe lost -t: a parent+nested manifest drops the parent tree record',
  );
  const probeBatchPattern = /argvBatches\(\s*slashless,\s*\{\s*budget:\s*ARGV_BUDGET - fixed\s*\}\s*\)/;
  check(
    probeBatchPattern.test(updaterSource),
    'the slashless staging probe batches under ARGV_BUDGET minus the fixed arguments',
    'the slashless staging probe is one unbudgeted ls-tree call',
  );
  const literalCommitPattern = /commitPathspecs\(\s*`chore: auto-update system files to v\$\{remote\}`,\s*expandedPathsToStage,\s*\{\s*literal:\s*true\s*\}\s*\)/;
  check(
    literalCommitPattern.test(updaterSource),
    'the scoped update commit passes { literal: true }',
    'the scoped update commit lost literal pathspec handling',
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
  // The validators accept a directory entry without its trailing slash, so the
  // same preserved-file rule must hold for that spelling (#7250 review).
  check(
    JSON.stringify(fallbackCheckoutSpecs('lib', ['lib/sub/b.mjs'], upstream)) === JSON.stringify(['lib/a.mjs', 'lib/c.mjs']),
    'fallbackCheckoutSpecs expands a slashless directory entry with a preserved file under it',
    `slashless directory expanded unexpectedly: ${JSON.stringify(fallbackCheckoutSpecs('lib', ['lib/sub/b.mjs'], upstream))}`,
  );
  check(
    fallbackCheckoutSpecs('lib', ['lib/a.mjs', 'lib/sub/b.mjs', 'lib/c.mjs'], upstream).length === 0,
    'fallbackCheckoutSpecs leaves nothing when a slashless directory entry is fully preserved',
    'a fully preserved slashless directory should expand to no specs',
  );
  check(
    JSON.stringify(fallbackCheckoutSpecs('lib', [], upstream)) === JSON.stringify(['lib']),
    'fallbackCheckoutSpecs names a slashless directory without preserved files as itself',
    `slashless directory without preserved files expanded unexpectedly: ${JSON.stringify(fallbackCheckoutSpecs('lib', [], upstream))}`,
  );
  check(
    JSON.stringify(fallbackCheckoutSpecs('mode', ['modes/b.mjs'], ['modes/a.mjs', 'modes/b.mjs'])) === JSON.stringify(['mode']),
    'fallbackCheckoutSpecs does not let a slashless entry claim a sibling directory by name prefix',
    `name prefix over-claimed: ${JSON.stringify(fallbackCheckoutSpecs('mode', ['modes/b.mjs'], ['modes/a.mjs', 'modes/b.mjs']))}`,
  );
}

// ── 7b. cross-version file/directory collisions are refused, not resolved ──
{
  // preservedPaths describe the LOCAL tree, the listing the TARGET's: across
  // versions an entry can be a directory locally and a file in the target, or
  // the reverse. Neither checkout may sweep the preserved side or silently
  // drop the shipped side (#7250 review).
  check(
    JSON.stringify(fallbackCheckoutSpecs('lib', ['lib/local.txt'], ['lib'])) === JSON.stringify(['lib']),
    'fallbackCheckoutSpecs names a shipped file even when preserved local children sit under its name',
    `shipped file with preserved local children mishandled: ${JSON.stringify(fallbackCheckoutSpecs('lib', ['lib/local.txt'], ['lib']))}`,
  );
  check(
    typeof preservedCheckoutCollision('lib', ['lib/local.txt'], ['lib']) === 'string',
    'preservedCheckoutCollision refuses a target file over preserved local children',
    'target file over preserved local children was not refused',
  );
  check(
    preservedCheckoutCollision('lib', [], ['lib']) === null,
    'preservedCheckoutCollision passes a shipped file with nothing preserved under its name',
    'shipped file without preserved children was refused',
  );
  check(
    preservedCheckoutCollision('lib', ['lib/a.mjs'], ['lib/a.mjs', 'lib/b.mjs']) === null,
    'preservedCheckoutCollision passes a directory with preserved children (normal expansion)',
    'directory with preserved children was refused',
  );
  check(
    preservedCheckoutCollision('lib', ['lib'], ['lib']) === null,
    'preservedCheckoutCollision passes a shipped file preserved exactly (the skip case)',
    'exactly preserved file was refused',
  );
  check(
    typeof preservedCheckoutCollision('lib', ['lib'], ['lib/a.mjs']) === 'string',
    'preservedCheckoutCollision refuses a target directory over a preserved local file (slashless entry)',
    'slashless target directory over preserved local file was not refused',
  );
  check(
    typeof preservedCheckoutCollision('lib/', ['lib'], ['lib/a.mjs']) === 'string',
    'preservedCheckoutCollision refuses a target directory over a preserved local file (dir/ entry)',
    'dir/ target directory over preserved local file was not refused',
  );
  check(
    typeof preservedCheckoutCollision('lib/', ['lib/local.txt'], ['lib']) === 'string',
    'preservedCheckoutCollision refuses a target file over preserved local children (dir/ entry)',
    'dir/ target file over preserved local children was not refused',
  );
  check(
    preservedCheckoutCollision('lib', ['lib/x.mjs'], []) === null,
    'preservedCheckoutCollision passes an entry absent from an unavailable listing',
    'absent entry was refused',
  );

  const seam = (listing) => ({ git: () => listing });
  const boom = { git: () => { throw new Error('unreadable'); } };
  const ps = (...files) => files;
  const set = (files) => new Set(files);
  check(
    pathFullyPreserved('lib', ps('lib'), set(['lib']), 'ref', seam('lib')) === true,
    'pathFullyPreserved skips a slashless entry the target ships as a preserved file',
    'preserved target file was not skipped',
  );
  {
    // The exact-preserve skip costs no listing call (#2337 / test 9b in
    // updater-local-system-edits): the string match proves the local content
    // stays. A target directory in the file's place is refused by the
    // caller's preservedCheckoutCollision() check, which runs first wherever
    // a checkout can happen — so this skip can never hide shipped content.
    let seamCalls = 0;
    const countingSeam = { git: () => { seamCalls++; return 'lib/a.mjs\nlib/b.mjs'; } };
    check(
      pathFullyPreserved('lib', ps('lib'), set(['lib']), 'ref', countingSeam) === true && seamCalls === 0,
      'pathFullyPreserved skips an exactly preserved file without a listing call; the shipped-directory collision is the caller\'s refusal',
      `exact-preserve skip consulted the listing (${seamCalls} call(s))`,
    );
  }
  check(
    pathFullyPreserved('lib', ps('lib'), set(['lib']), 'ref', boom) === true,
    'pathFullyPreserved never lists an exactly preserved file, so an unreadable target cannot break the skip',
    'unlistable target changed the exact-preserve skip',
  );
  check(
    planSystemCheckout(['lib'], ['lib'], ['lib/a.mjs']).checkout.includes('lib')
      && !planSystemCheckout(['lib'], ['lib'], ['lib/a.mjs']).preserved.includes('lib'),
    'planSystemCheckout routes a colliding entry to checkout (where the refusal throws), never to preserved',
    `colliding entry misrouted: ${JSON.stringify(planSystemCheckout(['lib'], ['lib'], ['lib/a.mjs']))}`,
  );
  check(
    pathFullyPreserved('lib', ps('lib/a.mjs', 'lib/b.mjs'), set(['lib/a.mjs', 'lib/b.mjs']), 'ref', seam('lib/a.mjs\nlib/b.mjs')) === true,
    'pathFullyPreserved skips a fully preserved slashless directory entry',
    'fully preserved slashless directory was not skipped',
  );
  check(
    pathFullyPreserved('lib', ps('lib/a.mjs'), set(['lib/a.mjs']), 'ref', seam('lib/a.mjs\nlib/b.mjs')) === false,
    'pathFullyPreserved does not skip a partly preserved slashless directory entry',
    'partly preserved slashless directory was skipped',
  );
  check(
    pathFullyPreserved('lib', ps('lib/local.txt'), set(['lib/local.txt']), 'ref', seam('lib')) === false,
    'pathFullyPreserved proceeds when the target ships a file over preserved local children',
    'target file over preserved local children was skipped',
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
