/*
 * updater-rollback-target-manifest.test.mjs — rollback target pairing and
 * manifest-boundary coverage (#3782).
 *
 * The pure checks pin the canonical path policy and the concrete-file helper.
 * The final five cases execute the real rollback CLI in throwaway repositories:
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
  MANIFEST_USER_PATH_OVERLAPS,
  gitIn,
  isSafeManifestPath,
  manifestTreeFiles,
  targetRefForBackup,
} from '../update-system.mjs';
import { fail, makeUpdaterRepo, pass, rmSync } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const updaterSource = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8');
const protectedUserPaths = [
  'cv.md',
  'data/',
  'documents/',
  'interview-prep/',
  'writing-samples/',
];
const expectedOverlaps = [
  'writing-samples/README.md',
  'interview-prep/sessions/.gitkeep',
  'interview-prep/sessions/README.md',
  'documents/.gitkeep',
  'documents/README.md',
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
    'the exact user/system overlap constant contains only the five documented scaffolds',
    `overlap constant drifted: ${JSON.stringify(actual)}`,
  );

  const allowed = expectedOverlaps.every((path) =>
    isSafeManifestPath(path, protectedUserPaths));
  check(
    allowed,
    'all five byte-exact overlap paths are allowed inside protected user directories',
    'one or more documented overlap paths were rejected',
  );

  const nearOverlaps = [
    'Writing-samples/README.md',
    'writing-samples/readme.md',
    'writing-samples/README.md/',
    'writing-samples/README.md.bak',
    'interview-prep/sessions/README.md/child',
    'documents/readme.md',
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

// ── 5. Tree expansion yields concrete, safe files only ──
{
  const { dir, g, ctx } = makeUpdaterRepo(gitIn, {
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

function sourceWithManifest(paths) {
  const declaration = /((?:export\s+)?const SYSTEM_PATHS\s*=\s*)\[[\s\S]*?\n\];/;
  if (!declaration.test(updaterSource)) {
    throw new Error('fixture could not locate the SYSTEM_PATHS declaration');
  }
  const body = `[\n${paths.map((path) => `  ${JSON.stringify(path)},`).join('\n')}\n];`;
  return updaterSource.replace(declaration, `$1${body}`);
}

function put(dir, path, bytes) {
  const destination = join(dir, ...path.split('/'));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

function runRollback(dir) {
  return spawnSync(process.execPath, ['update-system.mjs', 'rollback'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      CAREER_OPS_GIT_TIMEOUT_MS: '10000',
    },
  });
}

function seedRollbackRepo(prefix, { paired, fetchTarget }) {
  const fixture = makeUpdaterRepo(gitIn, { prefix });
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
  const targetManifest = [...commonManifest, 'target-only.mjs'];

  try {
    put(dir, 'update-system.mjs', sourceWithManifest(commonManifest));
    put(dir, 'system/root.txt', 'backup root\n');
    put(dir, 'system/nested/keep.txt', 'backup nested\n');
    put(dir, 'writing-samples/README.md', 'backup scaffold\n');
    put(dir, 'writing-samples/private.md', 'user sibling base\n');
    put(dir, 'cv.md', 'user cv base\n');
    g('add', '-A');
    g('commit', '-qm', 'backup state');
    const backupCommit = g('rev-parse', 'HEAD');
    g('branch', backup, backupCommit);

    put(dir, 'update-system.mjs', sourceWithManifest(targetManifest));
    put(dir, 'system/root.txt', 'target root\n');
    put(dir, 'system/nested/keep.txt', 'target nested\n');
    put(dir, 'system/nested/target-only.txt', 'target-only nested\n');
    put(dir, 'target-only.mjs', 'target-only top-level\n');
    put(dir, 'writing-samples/README.md', 'target scaffold\n');
    g('add', '-A');
    g('commit', '-qm', 'target state');
    const targetCommit = g('rev-parse', 'HEAD');

    if (paired) g('update-ref', targetRefForBackup(backup), targetCommit);

    // These are user-owned bytes present before rollback. Both are tracked and
    // modified, so recursive checkout/removal of a protected ancestor destroys
    // them immediately and observably.
    put(dir, 'writing-samples/private.md', 'user sibling current\n');
    put(dir, 'cv.md', 'user cv current\n');

    // FETCH_HEAD is deliberately wrong for the paired case and maximally
    // tempting in the missing-pair case. Either way rollback's decision must be
    // a function of the durable pair, never this mutable process-global ref.
    const distractorCommit = fetchTarget ? targetCommit : backupCommit;
    g('branch', 'rollback-fetch-distractor', distractorCommit);
    g('fetch', '.', 'rollback-fetch-distractor');

    return { ...fixture, backup, backupCommit, targetCommit };
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

    const result = runRollback(dir);
    const userCv = readMaybe(join(dir, 'cv.md'));
    const userSibling = readMaybe(join(dir, 'writing-samples/private.md'));
    check(
      result.status === 0 && !result.error,
      'real rollback CLI succeeds with a readable paired target ref',
      `paired rollback failed (status ${result.status}): ${outputOf(result)}`,
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
      userCv === 'user cv current\n' && userSibling === 'user sibling current\n',
      'rollback preserves changed user files and protected siblings byte-for-byte',
      `rollback changed user bytes: cv=${JSON.stringify(userCv)} sibling=${JSON.stringify(userSibling)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 7. Real CLI: no paired ref means warn + conservative leftovers ──
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

// ── 8. Real CLI: symlinked parents cannot redirect rollback outside ROOT ──
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

// ── 9. Real CLI: a dangling symlinked parent is still left untouched ──
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

// ── 10. Real CLI: a target-only file replaced by a directory is preserved ──
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
