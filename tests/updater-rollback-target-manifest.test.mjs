/*
 * updater-rollback-target-manifest.test.mjs — rollback target pairing and
 * manifest-boundary coverage (#3782).
 *
 * The pure checks pin the canonical path policy and the concrete-file helper.
 * The final seven cases execute the real rollback CLI in throwaway repositories:
 * paired and missing target refs, ordinary and dangling symlinked parents, and
 * a target-only file replaced by a directory.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_MODULE,
  MANIFEST_USER_PATH_OVERLAPS,
  isSafeManifestPath,
  manifestTreeFiles,
  pruneStaleTargetRefs,
  targetRefForBackup,
} from '../update-system.mjs';
import { fail, makeUpdaterRepo, pass, rmSync } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const updaterSource = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8');
const protectedUserPaths = [
  'cv.md',
  'data/',
  'documents/',
  'jds/',
  'output/',
  'reports/',
  'interview-prep/',
  'writing-samples/',
];
const expectedOverlaps = [
  'writing-samples/README.md',
  'interview-prep/sessions/.gitkeep',
  'interview-prep/sessions/README.md',
  'documents/.gitkeep',
  'documents/README.md',
  'data/.gitkeep',
  'data/offers/.gitkeep',
  'data/parser-output/.gitkeep',
  'jds/.gitkeep',
  'output/.gitkeep',
  'reports/.gitkeep',
];

console.log('\n🧪 Testing updater rollback target manifests (#3782)...');

function check(condition, ok, bad) {
  if (condition) pass(ok);
  else fail(bad);
}

function rejectedBy(fn) {
  try {
    return !fn();
  } catch {
    return true;
  }
}

// ── 1. The overlap escape hatch is exact, small, and reviewable ──
{
  const actual = [...MANIFEST_USER_PATH_OVERLAPS];
  check(
    actual.length === expectedOverlaps.length
      && expectedOverlaps.every((path) => actual.includes(path)),
    'the exact user/system overlap constant contains only the documented scaffolds',
    `overlap constant drifted: ${JSON.stringify(actual)}`,
  );

  const allowed = expectedOverlaps.every((path) =>
    isSafeManifestPath(path, protectedUserPaths));
  check(
    allowed,
    'all byte-exact overlap paths are allowed inside protected user directories',
    'one or more documented overlap paths were rejected',
  );

  const nearOverlaps = [
    'Writing-samples/README.md',
    'writing-samples/readme.md',
    'writing-samples/README.md/',
    'writing-samples/README.md.bak',
    'interview-prep/sessions/README.md/child',
    'documents/readme.md',
    'data/.GITKEEP',
    'data/offers/.gitkeep/child',
    'reports/.gitkeep.bak',
  ];
  check(
    nearOverlaps.every((path) => !isSafeManifestPath(path, protectedUserPaths)),
    'case, suffix, slash, and descendant aliases do not inherit the overlap exception',
    `near-overlap escaped: ${nearOverlaps.filter((path) => isSafeManifestPath(path, protectedUserPaths)).join(', ')}`,
  );
}

// ── 2. User paths are protected in all three directions ──
{
  const cases = [
    ['cv.md', ['cv.md'], 'exact file'],
    ['data/', ['data/'], 'exact directory'],
    ['data/applications.md', ['data/'], 'descendant'],
    ['data/', ['data/applications.md'], 'ancestor directory'],
    ['interview-prep/', ['interview-prep/sessions/private.md'], 'ancestor of nested file'],
    ['CV.md', ['cv.md'], 'case alias'],
    ['DATA/applications.md', ['data/'], 'case-folded descendant'],
  ];
  const escaped = cases.filter(([path, users]) => isSafeManifestPath(path, users));
  check(
    escaped.length === 0,
    'exact user paths, descendants, ancestors, and case aliases are rejected',
    `user path cases escaped: ${escaped.map((entry) => entry[2]).join(', ')}`,
  );

  const nfc = `caf${String.fromCodePoint(0xe9)}.md`;
  const nfd = `caf${String.fromCodePoint(0x65, 0x301)}.md`;
  check(
    nfc !== nfd
      && !isSafeManifestPath(nfd, [nfc])
      && !isSafeManifestPath(nfc, [nfd]),
    'NFC/NFD aliases are rejected in both comparison directions',
    'Unicode-normalization aliases did not resolve to the protected path',
  );
}

// ── 3. Non-canonical and pathspec-active spellings never reach git ──
{
  const malformed = [
    '', null, 42,
    '/etc/passwd', 'C:/Windows/System32/config', 'C:\\Windows\\System32',
    '\\\\server\\share\\file', '\\rooted',
    './modes/pdf.md', 'modes\\pdf.md', 'modes//pdf.md', 'modes/pdf.md//',
    'modes/./pdf.md', 'modes/../cv.md',
    'modes/control\u0000name.md', 'modes/line\nbreak.md',
    ':(glob)modes/*.md', 'modes/a:b.md', 'modes/*.md', 'modes/?.md', 'modes/[ab].md',
    '.git', '.GIT/hooks/pre-commit', 'modes/.gIt/config',
  ];
  const accepted = malformed.filter((path) => isSafeManifestPath(path, []));
  check(
    accepted.length === 0,
    'empty/non-string, absolute, alias, control, pathspec-magic, and .git paths are rejected',
    `unsafe spellings accepted: ${accepted.map((path) => JSON.stringify(path)).join(', ')}`,
  );

  check(
    isSafeManifestPath('modes/pdf.md', protectedUserPaths)
      && isSafeManifestPath('providers/', protectedUserPaths),
    'canonical system file and directory entries remain valid',
    'ordinary canonical system paths were rejected',
  );
}

// ── 4. A backup branch has one strict, durable target-ref identity ──
{
  const backup = 'backup-pre-update-1.2.3-20260907T120000Z';
  const expected = `refs/backup-pre-update-target/${backup}`;
  check(
    targetRefForBackup(backup) === expected,
    'a strict backup branch maps to its durable paired target ref',
    `paired ref mismatch: ${String(targetRefForBackup(backup))}`,
  );

  const invalid = [
    'backup-pre-update-1.2-20260907T120000Z',
    'backup-pre-update-1.2.3-20260907T120000Z/child',
    'refs/heads/backup-pre-update-1.2.3-20260907T120000Z',
    '../backup-pre-update-1.2.3-20260907T120000Z',
  ];
  check(
    invalid.every((branch) => rejectedBy(() => targetRefForBackup(branch))),
    'malformed backup names cannot manufacture a paired ref',
    'the paired-ref helper accepted a malformed backup branch',
  );
}

// ── 5. Target refs are retained only while their strict backup branch exists ──
{
  const { dir, g, ctx } = makeUpdaterRepo({ prefix: 'co-target-ref-prune-' });
  try {
    writeFileSync(join(dir, 'seed.txt'), 'seed\n');
    g('add', 'seed.txt');
    g('commit', '-qm', 'seed');
    const commit = g('rev-parse', 'HEAD');
    const live = 'backup-pre-update-1.2.3-20260907T120000Z';
    const stale = 'backup-pre-update-1.2.3-20260907T130000Z';
    const liveRef = targetRefForBackup(live);
    const staleRef = targetRefForBackup(stale);
    const manualRef = 'refs/backup-pre-update-target/manual-retain';
    g('branch', live, commit);
    g('branch', stale, commit);
    g('update-ref', liveRef, commit);
    g('update-ref', staleRef, commit);
    g('update-ref', manualRef, commit);
    g('branch', '-D', stale);

    const pruned = pruneStaleTargetRefs(ctx);
    const hasRef = (ref) => {
      try { g('show-ref', '--verify', '--quiet', ref); return true; }
      catch { return false; }
    };
    check(
      pruned.length === 1 && pruned[0] === staleRef && !hasRef(staleRef),
      'stale paired target refs are pruned when their backup branch is gone',
      `stale paired ref was not pruned: ${JSON.stringify(pruned)}`,
    );
    check(
      hasRef(liveRef) && hasRef(manualRef),
      'live backup pairs and unrecognised namespace refs are retained',
      'target-ref pruning removed a live pair or manual namespace ref',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 6. Tree expansion yields concrete, safe files only ──
{
  const { dir, g, ctx } = makeUpdaterRepo({
    prefix: 'co-rollback-manifest-files-',
    includeRoot: true,
  });
  try {
    mkdirSync(join(dir, 'system', 'nested'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'writing-samples'), { recursive: true });
    writeFileSync(join(dir, 'system', 'root.txt'), 'root\n');
    writeFileSync(join(dir, 'system', 'nested', 'keep.txt'), 'keep\n');
    writeFileSync(join(dir, 'system', 'nested', 'second.txt'), 'second\n');
    writeFileSync(join(dir, 'data', 'private.txt'), 'private\n');
    writeFileSync(join(dir, 'writing-samples', 'README.md'), 'scaffold\n');
    g('add', '-A');
    g('commit', '-qm', 'tree');

    const files = manifestTreeFiles(
      [
        'system/root.txt',
        'system/nested/',
        'system/nested/keep.txt', // duplicate coverage must de-duplicate
        'absent-direct.txt',      // unlike expandToShippedFiles, must not pass through
        'data/',                  // protected before expansion
        'writing-samples/README.md',
      ],
      'HEAD',
      protectedUserPaths,
      ctx,
    );
    const expected = new Set([
      'system/root.txt',
      'system/nested/keep.txt',
      'system/nested/second.txt',
      'writing-samples/README.md',
    ]);
    check(
      files.length === expected.size && files.every((path) => expected.has(path)),
      'manifest tree expansion returns de-duplicated concrete safe files and exact overlaps',
      `concrete manifest files were wrong: ${JSON.stringify(files)}`,
    );
    check(
      !files.includes('absent-direct.txt')
        && !files.includes('data/private.txt'),
      'absent and protected files never pass through concrete expansion',
      `unsafe/nonexistent concrete entry survived: ${JSON.stringify(files)}`,
    );

    // Windows cannot materialize control characters in a filename. Inject a
    // raw NUL-delimited tree response so this policy check remains portable
    // while still proving manifestTreeFiles filters every concrete tree name.
    const synthetic = manifestTreeFiles(
      ['system/nested/'],
      'HEAD',
      protectedUserPaths,
      {
        git: () => 'system/nested/keep.txt\0system/nested/line\nbreak.txt\0',
      },
    );
    check(
      synthetic.length === 1 && synthetic[0] === 'system/nested/keep.txt',
      'control-character tree filenames are rejected without filesystem-dependent fixtures',
      `control-character concrete entry survived: ${JSON.stringify(synthetic)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const manifestBody = (paths) => `[\n${paths.map((path) => `  ${JSON.stringify(path)},`).join('\n')}\n];`;

/**
 * Write a commit's updater and SYSTEM_PATHS in the given layout.
 *
 * 'module' is the layout since #5554: the real updater beside a
 * lib/update-manifest.mjs that lists `paths` and, like the real one, itself.
 * 'legacy' is the layout before it: no module, and the list as the first
 * SYSTEM_PATHS literal in update-system.mjs, which is what an older updater's
 * manifest looks like to extractArrayFromSource.
 */
function putManifest(dir, paths, layout = 'module') {
  if (layout === 'legacy') {
    const declaration = /(const SYSTEM_PATHS\s*=\s*)\[[\s\S]*?\n\s*\];/;
    if (!declaration.test(updaterSource)) {
      throw new Error('fixture could not locate the SYSTEM_PATHS declaration');
    }
    put(dir, 'update-system.mjs', updaterSource.replace(declaration, `$1${manifestBody(paths)}`));
    rmSync(join(dir, ...MANIFEST_MODULE.split('/')), { force: true });
    return;
  }
  const listed = paths.includes(MANIFEST_MODULE) ? paths : [...paths, MANIFEST_MODULE];
  put(dir, 'update-system.mjs', updaterSource);
  put(dir, MANIFEST_MODULE, `export const SYSTEM_PATHS = ${manifestBody(listed)}\nObject.freeze(SYSTEM_PATHS);\n`);
}

function put(dir, path, bytes) {
  const destination = join(dir, ...path.split('/'));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

/** Child git must not inherit GIT_DIR / GIT_INDEX_FILE / the rest of GIT_*. */
function rollbackChildEnv() {
  const env = { ...process.env, CAREER_OPS_GIT_TIMEOUT_MS: '10000' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

function runRollback(dir, timeout = 30_000) {
  return spawnSync(process.execPath, ['update-system.mjs', 'rollback'], {
    cwd: dir,
    encoding: 'utf8',
    timeout,
    env: rollbackChildEnv(),
  });
}

// Long names, so a couple of hundred files overflow the 32,767-character
// Windows command line when passed as one argv. Rollback restores one file per
// git call, so the count is kept low and the length is carried by the names.
const bulkFile = (i) => `system/nested/bulk/${'argv-length-'.repeat(11)}${String(i).padStart(4, '0')}.txt`;

function seedRollbackRepo(prefix, { paired, fetchTarget, targetChangesPreExisting = false, bulkFiles = 0, backupLayout = 'module' }) {
  const fixture = makeUpdaterRepo({ prefix });
  const { dir, g } = fixture;
  const backup = paired
    ? 'backup-pre-update-1.2.3-20260907T120000Z'
    : 'backup-pre-update-1.2.3-20260907T130000Z';
  const commonManifest = [
    'update-system.mjs',
    'system/root.txt',
    'system/nested/',
    'writing-samples/README.md',
  ];
  const targetManifest = [
    ...commonManifest,
    ' pre-existing-outside-backup-manifest.mjs',
    ' leading-target-only.mjs',
    'target-only.mjs',
  ];

  try {
    putManifest(dir, commonManifest, backupLayout);
    put(dir, 'system/root.txt', 'backup root\n');
    put(dir, 'system/nested/keep.txt', 'backup nested\n');
    put(dir, 'writing-samples/README.md', 'backup scaffold\n');
    put(dir, ' pre-existing-outside-backup-manifest.mjs', 'pre-existing backup bytes\n');
    put(dir, 'writing-samples/private.md', 'user sibling base\n');
    put(dir, 'cv.md', 'user cv base\n');
    for (let i = 0; i < bulkFiles; i++) put(dir, bulkFile(i), `backup ${i}\n`);
    g('add', '-A');
    g('commit', '-qm', 'backup state');
    const backupCommit = g('rev-parse', 'HEAD');
    g('branch', backup, backupCommit);

    putManifest(dir, targetManifest);
    put(dir, 'system/root.txt', 'target root\n');
    put(dir, 'system/nested/keep.txt', 'target nested\n');
    put(dir, 'system/nested/target-only.txt', 'target-only nested\n');
    put(dir, ' leading-target-only.mjs', 'leading-space target-only\n');
    put(dir, 'target-only.mjs', 'target-only top-level\n');
    if (targetChangesPreExisting) {
      put(dir, ' pre-existing-outside-backup-manifest.mjs', 'target bytes over a pre-existing file\n');
    }
    put(dir, 'writing-samples/README.md', 'target scaffold\n');
    for (let i = 0; i < bulkFiles; i++) put(dir, bulkFile(i), `target ${i}\n`);
    g('add', '-A');
    g('commit', '-qm', 'target state');
    const targetCommit = g('rev-parse', 'HEAD');

    if (paired) g('update-ref', targetRefForBackup(backup), targetCommit);

    // These are user-owned bytes present before rollback. Both are tracked and
    // modified, so recursive checkout/removal of a protected ancestor destroys
    // them immediately and observably.
    put(dir, 'writing-samples/private.md', 'user sibling current\n');
    put(dir, 'cv.md', 'user cv current\n');
    put(dir, 'leading-target-only.mjs', 'unrelated untracked bytes\n');

    // FETCH_HEAD is deliberately wrong for the paired case and maximally
    // tempting in the missing-pair case. Either way rollback's decision must be
    // a function of the durable pair, never this mutable process-global ref.
    const distractorCommit = fetchTarget ? targetCommit : backupCommit;
    g('branch', 'rollback-fetch-distractor', distractorCommit);
    g('fetch', '.', 'rollback-fetch-distractor');

    return { ...fixture, backup, backupCommit, targetCommit, commonManifest };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function readMaybe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

// ── 6. Real CLI: paired target wins over a distractor FETCH_HEAD ──
{
  const fixture = seedRollbackRepo('co-rollback-paired-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir, g, backupCommit } = fixture;
  try {
    check(
      g('rev-parse', 'FETCH_HEAD') === backupCommit,
      'paired-ref fixture mutates FETCH_HEAD to a non-target distractor',
      'paired-ref fixture did not arrange its FETCH_HEAD distractor',
    );

    // A withheld update leaves a durable baseline that rollback must clear.
    g('update-ref', 'refs/career-ops/staged-update', 'HEAD');

    const result = runRollback(dir);
    const userCv = readMaybe(join(dir, 'cv.md'));
    const userSibling = readMaybe(join(dir, 'writing-samples/private.md'));
    check(
      result.status === 0 && !result.error,
      'real rollback CLI succeeds with a readable paired target ref',
      `paired rollback failed (status ${result.status}): ${outputOf(result)}`,
    );
    check(
      g('for-each-ref', '--format=%(refname)', 'refs/career-ops/staged-update') === '',
      'successful rollback clears the withheld update baseline',
      'rollback left the withheld update baseline behind',
    );
    check(
      readMaybe(join(dir, 'system/root.txt')) === 'backup root\n'
        && readMaybe(join(dir, 'system/nested/keep.txt')) === 'backup nested\n'
        && readMaybe(join(dir, 'writing-samples/README.md')) === 'backup scaffold\n',
      'rollback restores backup system files and the exact-overlap scaffold',
      'rollback did not restore the complete backup system/scaffold state',
    );
    check(
      !existsSync(join(dir, 'target-only.mjs'))
        && !existsSync(join(dir, 'system/nested/target-only.txt')),
      'rollback removes target-only top-level and nested concrete files despite distractor FETCH_HEAD',
      'rollback left a target-only file behind or consulted the FETCH_HEAD distractor',
    );
    check(
      !existsSync(join(dir, ' leading-target-only.mjs'))
        && readMaybe(join(dir, 'leading-target-only.mjs')) === 'unrelated untracked bytes\n',
      'NUL-delimited tree paths preserve leading whitespace and never alias an unrelated file',
      'rollback trimmed a target path, removed the wrong file, or left the exact target behind',
    );
    check(
      userCv === 'user cv current\n' && userSibling === 'user sibling current\n',
      'rollback preserves changed user files and protected siblings byte-for-byte',
      `rollback changed user bytes: cv=${JSON.stringify(userCv)} sibling=${JSON.stringify(userSibling)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 7. Real CLI: complete backup-tree membership prevents false deletion ──
{
  const fixture = seedRollbackRepo('co-rollback-backup-membership-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir, commonManifest } = fixture;
  try {
    // Simulate local/current manifest drift after apply. The file is covered by
    // the paired target, but not by either updater consulted for restoration;
    // its presence in the backup tree is the only proof that it is not new.
    putManifest(dir, commonManifest);

    const result = runRollback(dir);
    check(
      result.status === 0 && !result.error,
      'real rollback succeeds when current and backup manifests omit a pre-existing target path',
      `backup-membership rollback failed (status ${result.status}): ${outputOf(result)}`,
    );
    check(
      readMaybe(join(dir, ' pre-existing-outside-backup-manifest.mjs'))
        === 'pre-existing backup bytes\n',
      'rollback retains a target-covered file that already existed in the complete backup tree',
      'rollback deleted or changed a pre-existing file omitted from both restore manifests',
    );
    check(
      !existsSync(join(dir, 'target-only.mjs')),
      'complete backup membership still permits removal of genuinely target-only files',
      'backup membership made target-only removal overly conservative',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 7b. Real CLI: a target-covered file the update overwrote is restored ──
{
  const fixture = seedRollbackRepo('co-rollback-backup-restore-', {
    paired: true,
    fetchTarget: false,
    targetChangesPreExisting: true,
  });
  const { dir, commonManifest } = fixture;
  try {
    // Same manifest drift as section 7, but here the target changed the file.
    // Neither restore manifest lists it; only the paired target claims it.
    putManifest(dir, commonManifest);

    const result = runRollback(dir);
    check(
      result.status === 0 && !result.error,
      'real rollback succeeds when the target changed a file outside both restore manifests',
      `backup-restore rollback failed (status ${result.status}): ${outputOf(result)}`,
    );
    check(
      readMaybe(join(dir, ' pre-existing-outside-backup-manifest.mjs'))
        === 'pre-existing backup bytes\n',
      'rollback restores the backup bytes of a target-covered file that was already in the backup tree',
      'rollback left the update\'s bytes in a pre-existing file omitted from both restore manifests',
    );
    check(
      !existsSync(join(dir, 'target-only.mjs')),
      'restoring target-covered backup files still removes genuinely target-only files',
      'restoring target-covered backup files blocked target-only removal',
    );
    check(
      readMaybe(join(dir, 'cv.md')) === 'user cv current\n',
      'restoring target-covered backup files leaves user data untouched',
      'restoring target-covered backup files changed user data',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 8. Real CLI: file/directory transitions are not misclassified as new ──
{
  const fixture = makeUpdaterRepo({ prefix: 'co-rollback-tree-shape-' });
  const { dir, g } = fixture;
  const backup = 'backup-pre-update-1.2.3-20260907T140000Z';
  const backupManifest = [
    'update-system.mjs',
    'shape-dir/',
    'shape-leaf',
    'CaseExisting.mjs',
  ];
  const targetManifest = [
    'update-system.mjs',
    'shape-dir',
    'shape-leaf/new.txt',
    'caseexisting.mjs',
  ];
  try {
    putManifest(dir, backupManifest);
    put(dir, 'shape-dir/backup.txt', 'backup directory child\n');
    put(dir, 'shape-leaf', 'backup leaf\n');
    put(dir, 'CaseExisting.mjs', 'backup alias bytes\n');
    g('add', '-A');
    g('commit', '-qm', 'backup shape state');
    const backupCommit = g('rev-parse', 'HEAD');
    g('branch', backup, backupCommit);

    putManifest(dir, targetManifest);
    rmSync(join(dir, 'shape-dir'), { recursive: true, force: true });
    put(dir, 'shape-dir', 'target file\n');
    rmSync(join(dir, 'shape-leaf'), { recursive: true, force: true });
    put(dir, 'shape-leaf/new.txt', 'target directory child\n');
    g('mv', 'CaseExisting.mjs', 'case-rename-temp.mjs');
    g('mv', 'case-rename-temp.mjs', 'caseexisting.mjs');
    put(dir, 'caseexisting.mjs', 'target alias bytes\n');
    g('add', '-A');
    g('commit', '-qm', 'target shape state');
    g('update-ref', targetRefForBackup(backup), g('rev-parse', 'HEAD'));

    // Both manifests accurately claim the transitioned paths. Unknown/private
    // directory children make destructive type conversion unsafe, so rollback
    // must retain the current shape with a warning instead of deleting it.
    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status === 0 && !result.error,
      'real rollback degrades safely across file/directory shape transitions',
      `tree-shape rollback failed (status ${result.status}): ${output}`,
    );
    check(
      readMaybe(join(dir, 'shape-dir')) === 'target file\n'
        && readMaybe(join(dir, 'shape-leaf/new.txt')) === 'target directory child\n',
      'rollback does not delete target leaves that conflict with a pre-existing backup tree shape',
      'rollback deleted a file/directory transition path as if it were wholly target-only',
    );
    check(
      readMaybe(join(dir, 'CaseExisting.mjs')) === 'backup alias bytes\n',
      'filesystem-equivalent target aliases cannot delete the restored backup path',
      'case-only target removal deleted the restored backup alias',
    );
    check(
      /conflicts with the backup tree/i.test(output)
        && /filesystem-equivalent backup path/i.test(output)
        && /non-directory parent|is now a directory/i.test(output),
      'rollback visibly warns for tree-shape and filesystem-alias leftovers',
      `tree-shape or alias warning was absent: ${JSON.stringify(output)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 8b. Real CLI: a non-directory ancestor several levels up is skipped ──
// With only one level between the replaced directory and the backup file,
// symlinkedAncestor stops at the file and nonDirectoryAncestor reports it.
// Two or more levels down, lstat on the next segment fails with ENOTDIR, which
// must not abort a half-applied rollback.
{
  const fixture = makeUpdaterRepo({ prefix: 'co-rollback-deep-shape-' });
  const { dir, g } = fixture;
  const backup = 'backup-pre-update-1.2.3-20260907T150000Z';
  try {
    putManifest(dir, ['update-system.mjs', 'deep-shape/']);
    put(dir, 'deep-shape/nested/deeper/backup.txt', 'backup deep child\n');
    g('add', '-A');
    g('commit', '-qm', 'backup deep shape state');
    g('branch', backup, g('rev-parse', 'HEAD'));

    putManifest(dir, ['update-system.mjs', 'deep-shape']);
    rmSync(join(dir, 'deep-shape'), { recursive: true, force: true });
    put(dir, 'deep-shape', 'target file\n');
    g('add', '-A');
    g('commit', '-qm', 'target deep shape state');
    g('update-ref', targetRefForBackup(backup), g('rev-parse', 'HEAD'));

    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status === 0 && !result.error,
      'real rollback completes when a non-directory ancestor sits two levels above a backup file',
      `deep tree-shape rollback failed (status ${result.status}): ${output}`,
    );
    check(
      readMaybe(join(dir, 'deep-shape')) === 'target file\n'
        && /deep-shape\/nested\/deeper\/backup\.txt has non-directory parent deep-shape/.test(output),
      'deep backup file under a replaced directory is reported and left untouched',
      `deep non-directory ancestor was not reported: ${JSON.stringify(output)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 9. Real CLI: no paired ref means warn + conservative leftovers ──
{
  const fixture = seedRollbackRepo('co-rollback-unpaired-', {
    paired: false,
    fetchTarget: true,
  });
  const { dir, g, targetCommit, backup } = fixture;
  try {
    let pairExists = true;
    try {
      g('show-ref', '--verify', '--quiet', targetRefForBackup(backup));
    } catch {
      pairExists = false;
    }
    check(
      !pairExists && g('rev-parse', 'FETCH_HEAD') === targetCommit,
      'missing-pair fixture points FETCH_HEAD at the tempting target commit',
      'missing-pair fixture did not isolate the no-fallback condition',
    );

    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status === 0 && !result.error,
      'real rollback CLI degrades conservatively when the paired target ref is missing',
      `unpaired rollback failed (status ${result.status}): ${output}`,
    );
    check(
      /(?:target|paired)[^\n]*(?:missing|unavailable|could not)/i.test(output)
        && /(?:leftover|left behind|may remain)/i.test(output),
      'missing-pair rollback visibly warns that target-only leftovers may remain',
      `missing-pair rollback warning was absent or unclear: ${JSON.stringify(output)}`,
    );
    check(
      existsSync(join(dir, 'target-only.mjs'))
        && existsSync(join(dir, 'system/nested/target-only.txt')),
      'missing-pair rollback leaves target-only files, proving it did not fall back to FETCH_HEAD',
      'missing-pair rollback removed a target-only file via mutable FETCH_HEAD',
    );
    check(
      readMaybe(join(dir, 'system/root.txt')) === 'backup root\n'
        && readMaybe(join(dir, 'writing-samples/README.md')) === 'backup scaffold\n'
        && readMaybe(join(dir, 'cv.md')) === 'user cv current\n'
        && readMaybe(join(dir, 'writing-samples/private.md')) === 'user sibling current\n',
      'degraded rollback still restores known backup files without touching user bytes',
      'degraded rollback failed its safe known-backup restore contract',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 10. Real CLI: symlinked parents cannot redirect rollback outside ROOT ──
{
  const fixture = seedRollbackRepo('co-rollback-symlink-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir } = fixture;
  const external = mkdtempSync(join(tmpdir(), 'co-rollback-external-'));
  try {
    rmSync(join(dir, 'system/nested'), { recursive: true, force: true });
    writeFileSync(join(external, 'keep.txt'), 'external keep\n');
    writeFileSync(join(external, 'target-only.txt'), 'external target-only\n');
    let symlinkUnavailable = false;
    try {
      symlinkSync(external, join(dir, 'system/nested'), 'dir');
    } catch (err) {
      if (err?.code !== 'EPERM') throw err;
      symlinkUnavailable = true;
      console.log('  SKIP: symlink-parent rollback guard (symlink creation returned EPERM)');
    }

    if (!symlinkUnavailable) {
      const result = runRollback(dir);
      const output = outputOf(result);
      check(
        result.status === 0 && !result.error,
        'rollback degrades safely when a concrete path has a symlinked parent',
        `symlink-parent rollback failed (status ${result.status}): ${output}`,
      );
      check(
        readMaybe(join(external, 'keep.txt')) === 'external keep\n'
          && readMaybe(join(external, 'target-only.txt')) === 'external target-only\n',
        'rollback never restores or removes through a symlinked parent',
        'rollback followed a symlinked parent and changed bytes outside the repository',
      );
      check(
        /symlinked parent/i.test(output),
        'rollback visibly warns when leaving a symlink-rerouted path untouched',
        `symlink-parent warning was absent: ${JSON.stringify(output)}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
}

// ── 11. Real CLI: a dangling symlinked parent is still left untouched ──
{
  const fixture = seedRollbackRepo('co-rollback-broken-symlink-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir } = fixture;
  const external = mkdtempSync(join(tmpdir(), 'co-rollback-broken-external-'));
  const nested = join(dir, 'system/nested');
  try {
    rmSync(nested, { recursive: true, force: true });
    let symlinkUnavailable = false;
    try {
      symlinkSync(join(external, 'missing-target'), nested, 'dir');
    } catch (err) {
      if (err?.code !== 'EPERM') throw err;
      symlinkUnavailable = true;
      console.log('  SKIP: broken-symlink rollback guard (symlink creation returned EPERM)');
    }

    if (!symlinkUnavailable) {
      const result = runRollback(dir);
      const output = outputOf(result);
      check(
        result.status === 0 && !result.error,
        'rollback degrades safely when a concrete path has a dangling symlinked parent',
        `broken-symlink rollback failed (status ${result.status}): ${output}`,
      );
      check(
        lstatSync(nested).isSymbolicLink(),
        'rollback leaves a dangling symlinked parent in place',
        'rollback changed the dangling symlinked parent',
      );
      check(
        /symlinked parent/i.test(output),
        'rollback visibly warns when a dangling symlinked parent is left untouched',
        `broken-symlink warning was absent: ${JSON.stringify(output)}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
}

// ── 12. Real CLI: a target-only file replaced by a directory is preserved ──
{
  const fixture = seedRollbackRepo('co-rollback-became-dir-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir } = fixture;
  try {
    rmSync(join(dir, 'target-only.mjs'), { force: true });
    mkdirSync(join(dir, 'target-only.mjs'));
    writeFileSync(join(dir, 'target-only.mjs/private.txt'), 'private child\n');

    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status === 0 && !result.error,
      'rollback degrades safely when a target-only file became a directory',
      `became-directory rollback failed (status ${result.status}): ${output}`,
    );
    check(
      readMaybe(join(dir, 'target-only.mjs/private.txt')) === 'private child\n',
      'rollback leaves every child of a replacement directory untouched',
      'rollback recursively removed a directory that replaced a target-only file',
    );
    check(
      /became a directory|is now a directory/i.test(output),
      'rollback visibly warns when a target-only file became a directory',
      `replacement-directory warning was absent: ${JSON.stringify(output)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 13. Real CLI: a target-only file whose parent became a regular file ──
// The backup tree cannot see this: system/nested is a directory there, so
// system/nested/target-only.txt is a genuine removal candidate. Only the
// worktree knows the parent is now a file, and without the guard the path is
// reported as removed although nothing at it was ever touched.
{
  const fixture = seedRollbackRepo('co-rollback-parent-became-file-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir, g } = fixture;
  try {
    rmSync(join(dir, 'system/nested'), { recursive: true, force: true });
    writeFileSync(join(dir, 'system/nested'), 'replacement file\n');

    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status === 0 && !result.error,
      'rollback degrades safely when a target-only file\'s parent became a regular file',
      `parent-became-file rollback failed (status ${result.status}): ${output}`,
    );
    check(
      readMaybe(join(dir, 'system/nested')) === 'replacement file\n',
      'rollback leaves the regular file that replaced a parent directory untouched',
      'rollback altered or removed the file that replaced a parent directory',
    );
    check(
      /system\/nested\/target-only\.txt has non-directory parent system\/nested/.test(output),
      'rollback visibly warns when a target-only file has a non-directory parent',
      `non-directory-parent warning was absent for the removal candidate: ${JSON.stringify(output)}`,
    );
    check(
      g('ls-files', '--', 'system/nested/target-only.txt') === 'system/nested/target-only.txt',
      'a blocked target-only path is not recorded as removed',
      'rollback staged the removal of a target-only path it could not reach',
    );
    check(
      !existsSync(join(dir, 'target-only.mjs')),
      'reachable target-only files are still removed alongside a blocked one',
      'a blocked target-only path stopped rollback from removing the reachable ones',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 14. Real CLI: an untracked file at a target-only path is the user's ──
// The target ships target-only.mjs and the backup does not, so tree membership
// alone makes it a removal candidate. Here the update never wrote it: the file
// on disk is untracked local content, which no backup holds.
{
  const fixture = seedRollbackRepo('co-rollback-untracked-target-only-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir, g } = fixture;
  try {
    g('rm', '-q', '--cached', '--', 'target-only.mjs');
    g('commit', '-qm', 'target-only.mjs was never written by the update');
    writeFileSync(join(dir, 'target-only.mjs'), 'untracked local bytes\n');

    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status === 0 && !result.error,
      'rollback succeeds with an untracked file at a target-only path',
      `untracked-target-only rollback failed (status ${result.status}): ${output}`,
    );
    check(
      readMaybe(join(dir, 'target-only.mjs')) === 'untracked local bytes\n',
      'rollback leaves an untracked file at a target-only path byte-identical',
      'rollback deleted or changed an untracked file the update never wrote',
    );
    check(
      /target-only\.mjs is not tracked/.test(output),
      'rollback visibly warns when it leaves an untracked target-only path alone',
      `untracked warning was absent: ${JSON.stringify(output)}`,
    );
    check(
      !existsSync(join(dir, ' leading-target-only.mjs')),
      'tracked target-only files are still removed alongside an untracked one',
      'an untracked target-only path stopped rollback from removing the tracked ones',
    );
    check(
      /rollback system files/.test(g('log', '-1', '--format=%s')),
      'the rollback commit still lands when an untracked target-only path is skipped',
      `rollback did not commit: ${g('log', '-1', '--format=%s')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 15. Real CLI: the rollback commit does not depend on argv length ──
// Enough restored files that naming each one on a single command line exceeds
// the Windows limit. The commit has to land from the index instead.
{
  const BULK = 240;
  const fixture = seedRollbackRepo('co-rollback-bulk-commit-', {
    paired: true,
    fetchTarget: false,
    bulkFiles: BULK,
  });
  const { dir, g } = fixture;
  try {
    const argvChars = Array.from({ length: BULK }, (_, i) => bulkFile(i).length + 1).reduce((a, b) => a + b, 0);
    check(
      argvChars > 32767,
      'the bulk fixture is longer than the Windows command-line limit',
      `bulk fixture is only ${argvChars} characters`,
    );
    const result = runRollback(dir, 180_000);
    const output = outputOf(result);
    check(
      result.status === 0 && !result.error,
      'rollback succeeds with more restored files than one command line can name',
      `bulk rollback failed (status ${result.status}): ${output.slice(-600)}`,
    );
    check(
      /rollback system files/.test(g('log', '-1', '--format=%s')),
      'the rollback commit lands with a restore list longer than the Windows argv limit',
      `rollback did not commit: ${g('log', '-1', '--format=%s')}`,
    );
    check(
      g('diff', '--cached', '--name-only') === '',
      'no restored file is left staged after the rollback commit',
      `files left staged: ${g('diff', '--cached', '--name-only').split('\n').length}`,
    );
    check(
      readMaybe(join(dir, bulkFile(0))) === 'backup 0\n'
        && readMaybe(join(dir, bulkFile(BULK - 1))) === `backup ${BULK - 1}\n`,
      'the bulk files carry their backup bytes after rollback',
      'bulk files were not restored from the backup',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 16. Real CLI: unrelated staged work stays out of the rollback commit ──
{
  const fixture = seedRollbackRepo('co-rollback-unrelated-staged-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir, g } = fixture;
  try {
    put(dir, 'my-own-notes.txt', 'staged by the user before rollback\n');
    g('add', '--', 'my-own-notes.txt');

    const result = runRollback(dir);
    check(
      result.status === 0 && !result.error,
      'rollback succeeds with unrelated work staged',
      `unrelated-staged rollback failed (status ${result.status}): ${outputOf(result)}`,
    );
    check(
      /rollback system files/.test(g('log', '-1', '--format=%s'))
        && !g('show', '--name-only', '--format=', 'HEAD').split('\n').includes('my-own-notes.txt'),
      'the rollback commit excludes a file the user had staged',
      `rollback commit contents: ${g('show', '--name-only', '--format=', 'HEAD')}`,
    );
    check(
      g('diff', '--cached', '--name-only') === 'my-own-notes.txt',
      'the unrelated file is still staged after rollback',
      `staged after rollback: ${JSON.stringify(g('diff', '--cached', '--name-only'))}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 17. Real CLI: a newer unpaired backup does not hide an older paired one ──
{
  const fixture = seedRollbackRepo('co-rollback-offline-retry-', {
    paired: true,
    fetchTarget: true,
  });
  const { dir, g, backup, backupCommit } = fixture;
  const decoy = 'backup-pre-update-1.2.3-20260907T140000Z';
  try {
    g('branch', decoy, backupCommit);
    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status === 0 && new RegExp(`Rolling back to: ${backup}`).test(output),
      'rollback uses the older paired backup when a newer one has no target',
      `offline-retry rollback did not select ${backup}: ${output}`,
    );
    check(
      !existsSync(join(dir, 'target-only.mjs'))
        && !existsSync(join(dir, 'system/nested/target-only.txt')),
      'rollback removes target-only files using that older paired target',
      'offline-retry rollback left a target-only file behind',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 18. Real CLI: a failed rollback commit is reported, not hidden ──
{
  const fixture = seedRollbackRepo('co-rollback-commit-fails-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir, g } = fixture;
  try {
    const hooks = join(dir, '.git', 'failing-hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    g('config', 'core.hooksPath', hooks);

    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status !== 0,
      'rollback exits non-zero when its commit fails',
      `rollback reported success although the commit failed: ${output.slice(-400)}`,
    );
    check(
      /rollback commit failed/.test(output) && !/Rollback complete/.test(output),
      'rollback names the failed commit and does not print "Rollback complete"',
      `unexpected output for a failed commit: ${JSON.stringify(output.slice(-400))}`,
    );
    check(
      readMaybe(join(dir, 'system/root.txt')) === 'backup root\n',
      'the restored files are still on disk when the commit fails',
      'a failed commit left the worktree unrestored',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 18b. Real CLI: with unrelated work staged, the recovery hint stays scoped ──
//    A bare `git commit` here would take the user's staged file along with the
//    rollback, so the hint has to name the pathspec file the failed commit left.
{
  const fixture = seedRollbackRepo('co-rollback-commit-fails-scoped-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir, g } = fixture;
  try {
    put(dir, 'my-own-notes.txt', 'staged by the user before rollback\n');
    g('add', '--', 'my-own-notes.txt');
    const hooks = join(dir, '.git', 'failing-hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    g('config', 'core.hooksPath', hooks);

    const output = outputOf(runRollback(dir));
    const hint = output.match(/git --literal-pathspecs commit -m "([^"]+)" "--pathspec-from-file=([^"]+)" --pathspec-file-nul/);
    check(
      Boolean(hint),
      'a failed scoped rollback commit prints a scoped recovery command',
      `no scoped recovery command in: ${JSON.stringify(output.slice(-400))}`,
    );
    if (hint) {
      g('config', '--unset', 'core.hooksPath');
      g('--literal-pathspecs', 'commit', '-m', hint[1], `--pathspec-from-file=${hint[2]}`, '--pathspec-file-nul');
      check(
        !g('show', '--name-only', '--format=', 'HEAD').split('\n').includes('my-own-notes.txt')
          && g('diff', '--cached', '--name-only') === 'my-own-notes.txt',
        "running the printed command commits the rollback and leaves the user's file staged",
        `commit: ${g('show', '--name-only', '--format=', 'HEAD')}; staged: ${g('diff', '--cached', '--name-only')}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 19. Real CLI: a backup from before #5554 rolls back from the module layout ──
//    The first update to the module layout leaves a backup whose manifest is
//    in its update-system.mjs and a target whose manifest is in
//    lib/update-manifest.mjs. Each must be read from its own file: the backup
//    from update-system.mjs (no "backup manifest is unavailable" fallback),
//    the target from the module, which lists itself, so the module is a
//    target-only file and goes away with the rest of the update.
{
  const fixture = seedRollbackRepo('co-rollback-legacy-backup-', {
    paired: true,
    fetchTarget: false,
    backupLayout: 'legacy',
  });
  const { dir, g, backupCommit } = fixture;
  try {
    let backupHasModule = true;
    try {
      g('cat-file', '-e', `${backupCommit}:${MANIFEST_MODULE}`);
    } catch {
      backupHasModule = false;
    }
    check(
      !backupHasModule && existsSync(join(dir, ...MANIFEST_MODULE.split('/'))),
      'legacy-backup fixture: the backup has no manifest module and the target does',
      'legacy-backup fixture did not arrange the two layouts',
    );

    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status === 0 && !result.error,
      'rollback from the module layout to a pre-#5554 backup succeeds',
      `legacy-backup rollback failed (status ${result.status}): ${output}`,
    );
    check(
      !output.includes('backup manifest is unavailable') && !output.includes('paired target is missing or unavailable'),
      "both manifests were read: the backup's from update-system.mjs, the target's from the module",
      `rollback fell back on a manifest: ${JSON.stringify(output)}`,
    );
    check(
      readMaybe(join(dir, 'system/root.txt')) === 'backup root\n'
        && readMaybe(join(dir, 'system/nested/keep.txt')) === 'backup nested\n'
        && readMaybe(join(dir, 'update-system.mjs')) === g('show', `${backupCommit}:update-system.mjs`) + '\n',
      "rollback restores the backup's system files, its legacy updater included",
      'rollback did not restore the legacy backup state',
    );
    check(
      !existsSync(join(dir, ...MANIFEST_MODULE.split('/')))
        && !existsSync(join(dir, 'target-only.mjs'))
        && !existsSync(join(dir, 'system/nested/target-only.txt')),
      `rollback removes ${MANIFEST_MODULE} and the other target-only files`,
      `rollback left a target-only file behind: module=${existsSync(join(dir, ...MANIFEST_MODULE.split('/')))}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20. Real CLI: without the local manifest, rollback refuses ──
//    The current manifest is part of the restore set. Running without it would
//    restore only what the backup's manifest names, so rollback stops before
//    touching anything and says how to put the file back.
{
  const fixture = seedRollbackRepo('co-rollback-no-local-manifest-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir } = fixture;
  try {
    rmSync(join(dir, ...MANIFEST_MODULE.split('/')), { force: true });
    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status !== 0 && output.includes(`git checkout HEAD -- ${MANIFEST_MODULE}`),
      'rollback without lib/update-manifest.mjs fails closed and names the restore command',
      `rollback without the local manifest: status ${result.status}, output ${JSON.stringify(output)}`,
    );
    check(
      readMaybe(join(dir, 'system/root.txt')) === 'target root\n' && existsSync(join(dir, 'target-only.mjs')),
      'nothing was rolled back',
      'rollback changed files after refusing',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 20b. Real CLI: on a HEAD from before #5554 the hint restores the updater ──
//    A failed first upgrade can leave the new updater on disk over a HEAD that
//    has no lib/update-manifest.mjs. Checking that file out of HEAD would fail,
//    so the hint names update-system.mjs, whose HEAD copy holds the full list.
{
  const fixture = seedRollbackRepo('co-rollback-pre-split-head-', {
    paired: true,
    fetchTarget: false,
  });
  const { dir, g } = fixture;
  try {
    putManifest(dir, ['update-system.mjs', 'system/root.txt'], 'legacy');
    g('add', '-A');
    g('commit', '-qm', 'pre-split HEAD');
    put(dir, 'update-system.mjs', updaterSource);
    const result = runRollback(dir);
    const output = outputOf(result);
    check(
      result.status !== 0
        && output.includes('git checkout HEAD -- update-system.mjs')
        && !output.includes(`git checkout HEAD -- ${MANIFEST_MODULE}`),
      'on a pre-split HEAD, rollback names the updater to restore, not the missing module',
      `pre-split HEAD rollback hint: status ${result.status}, output ${JSON.stringify(output)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
