// tests/data-root-guard.test.mjs — the fingerprint behind the "your data is
// untouched" check sees every kind of change it is there to catch (#5113).
//
// tests/suite-data-root-sandbox.test.mjs proves the guard is wired into a run.
// This is the half underneath: a snapshot that missed a class of path would
// leave the wiring reporting a clean run over a changed tracker.
import { pass, fail, rmSync } from './helpers.mjs';
import { GUARDED_PATHS, MARKER_FILE, UNGUARDED_USER_PATHS, describeDrift, diffSnapshots, snapshotDataRoot } from './data-root-guard.mjs';
import { USER_PATHS } from '../update-system.mjs';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\ndata-root guard — a snapshot sees every change to the user layer');

const check = (ok, label, detail) => (ok ? pass(label) : fail(`${label}: ${JSON.stringify(detail)}`));

const dir = mkdtempSync(join(tmpdir(), 'co-data-root-guard-'));
try {
  const dataRoot = join(dir, 'data-root');
  const codeRoot = join(dir, 'code');
  mkdirSync(join(dataRoot, 'data', 'outcomes'), { recursive: true });
  mkdirSync(join(dataRoot, 'reports'));
  mkdirSync(join(dataRoot, 'config'));
  mkdirSync(codeRoot);
  writeFileSync(join(dataRoot, 'data', 'applications.md'), 'tracker\n');
  writeFileSync(join(dataRoot, 'data', 'follow-ups.md'), 'follow-ups\n');
  writeFileSync(join(dataRoot, 'data', 'outcomes', 'posting.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]));
  writeFileSync(join(dataRoot, 'reports', '001-acme-2026-01-01.md'), 'report\n');
  writeFileSync(join(dataRoot, 'cv.md'), 'cv\n');
  writeFileSync(join(dataRoot, 'config', 'profile.yml'), 'name: x\n');
  // Not user layer: a change here is none of the guard's business.
  writeFileSync(join(dataRoot, 'scan.mjs'), '// code\n');

  const snap = () => snapshotDataRoot(dataRoot, codeRoot);
  const before = snap();

  check(
    ['data/applications.md', 'data/follow-ups.md', 'data/outcomes/posting.pdf',
      'reports/001-acme-2026-01-01.md', 'cv.md', 'config/profile.yml'].every((p) => before.has(p))
      && !before.has('scan.mjs') && !before.has(MARKER_FILE),
    'a snapshot covers the user layer at any depth, and nothing else',
    [...before.keys()],
  );
  check(diffSnapshots(before, snap()).length === 0, 'an unchanged root has no drift', diffSnapshots(before, snap()));

  // The three shapes a stray write takes, and the marker beside the code.
  writeFileSync(join(dataRoot, 'data', 'applications.md'), 'fixture\n');
  rmSync(join(dataRoot, 'data', 'follow-ups.md'));
  writeFileSync(join(dataRoot, 'data', 'assessments.tsv'), 'row\n');
  writeFileSync(join(codeRoot, MARKER_FILE), '/tmp/gone\n');
  writeFileSync(join(dataRoot, 'scan.mjs'), '// edited code\n');
  const drift = diffSnapshots(before, snap());
  check(
    JSON.stringify(drift) === JSON.stringify([
      { path: MARKER_FILE, change: 'added' },
      { path: 'data/applications.md', change: 'modified' },
      { path: 'data/assessments.tsv', change: 'added' },
      { path: 'data/follow-ups.md', change: 'removed' },
    ]),
    'a modified, a removed and an added file are each named, with the marker, sorted by path',
    drift,
  );

  // Same length, same mtime resolution, different bytes: content decides.
  const sameSizeBefore = snap();
  writeFileSync(join(dataRoot, 'data', 'applications.md'), 'fixturE\n');
  check(
    diffSnapshots(sameSizeBefore, snap()).some((d) => d.path === 'data/applications.md' && d.change === 'modified'),
    'a same-size rewrite is a modification',
    diffSnapshots(sameSizeBefore, snap()),
  );

  // A user's data is not this repository's tree. walkTree skips a nested
  // checkout and a scratch-named directory by default; here that would be a
  // place to write unseen.
  const nestedBefore = snap();
  mkdirSync(join(dataRoot, 'data', 'vault', '.git'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'vault', 'notes.md'), 'notes\n');
  mkdirSync(join(dataRoot, 'data', '.tmp-script-test-abc123'));
  writeFileSync(join(dataRoot, 'data', '.tmp-script-test-abc123', 'x.md'), 'x\n');
  const nested = diffSnapshots(nestedBefore, snap()).map((d) => d.path);
  check(
    nested.includes('data/vault/notes.md') && nested.includes('data/.tmp-script-test-abc123/x.md'),
    'a nested checkout and a scratch-named directory inside the data root are still covered',
    nested,
  );

  // A guarded directory that is a link to where the data really lives.
  let linked = true;
  const linkedRoot = join(dir, 'linked-root');
  mkdirSync(linkedRoot);
  try {
    symlinkSync(join(dataRoot, 'reports'), join(linkedRoot, 'reports'), 'dir');
  } catch {
    // No symlink privilege (Windows without developer mode).
    linked = false;
  }
  if (linked) {
    const linkBefore = snapshotDataRoot(linkedRoot, codeRoot);
    writeFileSync(join(dataRoot, 'reports', '001-acme-2026-01-01.md'), 'rewritten\n');
    const viaLink = diffSnapshots(linkBefore, snapshotDataRoot(linkedRoot, codeRoot));
    check(
      viaLink.length === 1 && viaLink[0].path === 'reports/001-acme-2026-01-01.md' && viaLink[0].change === 'modified',
      'a guarded directory that is a symlink is followed',
      viaLink,
    );
  } else {
    pass('symlinked-directory check skipped: this platform refused the symlink');
  }

  // A root with none of it — a fresh clone, or a path that does not exist.
  check(snapshotDataRoot(join(dir, 'absent'), join(dir, 'absent')).size === 0,
    'a missing data root snapshots to nothing instead of throwing', null);

  const lines = describeDrift(dataRoot, drift);
  check(
    lines[0].includes(dataRoot) && lines.some((l) => /modified\s+data\/applications\.md/.test(l)),
    'the report names the root and each path',
    lines,
  );
  const many = Array.from({ length: 45 }, (_, i) => ({ path: `reports/${String(i).padStart(3, '0')}.md`, change: 'added' }));
  const longReport = describeDrift(dataRoot, many);
  check(
    longReport.filter((l) => /^\s+added\s/.test(l)).length === 20 && longReport.some((l) => l.includes('25 more')),
    'a long drift list is capped and says how much it left out',
    longReport,
  );

  check(
    ['data', 'reports', 'interview-prep'].every((p) => GUARDED_PATHS.includes(p)),
    'the tracker, report and interview-prep directories are guarded',
    GUARDED_PATHS,
  );

  // GUARDED_PATHS calls itself the content half of USER_PATHS. Held to that
  // here, in both directions, because a comment does not notice the next
  // edit: a user-layer path added to update-system.mjs and to neither list
  // would be a place to write unseen, in the module whose job is to see.
  const userPaths = USER_PATHS.map((p) => p.replace(/\/$/, ''));
  const unguarded = Object.keys(UNGUARDED_USER_PATHS);
  const unclassified = userPaths.filter((p) => !GUARDED_PATHS.includes(p) && !unguarded.includes(p));
  check(
    unclassified.length === 0,
    'every USER_PATHS entry is either guarded or listed as unguarded with a reason',
    unclassified,
  );
  const notUserLayer = [...GUARDED_PATHS, ...unguarded].filter((p) => !userPaths.includes(p));
  check(
    notUserLayer.length === 0,
    'neither list names a path that is not in USER_PATHS',
    notUserLayer,
  );
  const inBoth = GUARDED_PATHS.filter((p) => unguarded.includes(p));
  check(inBoth.length === 0, 'no path is both guarded and listed as unguarded', inBoth);
  const noReason = unguarded.filter((p) => String(UNGUARDED_USER_PATHS[p] ?? '').trim().length < 20);
  check(noReason.length === 0, 'every unguarded path says why', noReason);
} catch (err) {
  fail(`data-root guard test could not run: ${err.message}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
