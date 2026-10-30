// tests/data-root-guard.test.mjs — the fingerprint behind the "your data is
// untouched" check sees every kind of change it is there to catch (#5113).
//
// tests/suite-data-root-sandbox.test.mjs proves the guard is wired into a run.
// This is the half underneath: a snapshot that missed a class of path would
// leave the wiring reporting a clean run over a changed tracker.
import { pass, fail, rmSync } from './helpers.mjs';
import { CHECKOUT_GUARDED_PATHS, CHECKOUT_KEY_PREFIX, GUARDED_PATHS, MARKER_FILE, UNGUARDED_USER_PATHS, describeDrift, diffSnapshots, snapshotDataRoot } from './data-root-guard.mjs';
import { USER_PATHS } from '../update-system.mjs';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'fs';
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

  // The user files resolved from the checkout rather than the data root
  // (#5207). The pinned scratch root does not move them, so the snapshot has
  // to read them where they are.
  {
    const checkout = join(dir, 'checkout');
    mkdirSync(join(checkout, 'plugins.local', 'acme', '.git'), { recursive: true });
    mkdirSync(join(checkout, '.claude', 'hooks'), { recursive: true });
    writeFileSync(join(checkout, 'plugins.local', 'acme', 'index.mjs'), 'export default {};\n');
    writeFileSync(join(checkout, 'plugins.local', 'acme', '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(checkout, 'plugins.lock'), '{}\n');
    writeFileSync(join(checkout, 'opencode.json'), '{}\n');
    writeFileSync(join(checkout, '.claude', 'settings.json'), '{}\n');
    writeFileSync(join(checkout, '.claude', 'hooks', 'pre.sh'), '#!/bin/sh\n');
    // Beside them, not user layer: no business of the guard's.
    writeFileSync(join(checkout, '.claude', 'settings.local.json'), '{}\n');
    writeFileSync(join(checkout, 'scan.mjs'), '// code\n');

    // The common layout: the checkout is its own data root.
    const same = () => snapshotDataRoot(checkout, checkout);
    const sameBefore = same();
    const expected = ['plugins.local/acme/index.mjs', 'plugins.local/acme/.git/HEAD', 'plugins.lock',
      'opencode.json', '.claude/settings.json', '.claude/hooks/pre.sh'];
    check(
      expected.every((p) => sameBefore.has(p))
        && !sameBefore.has('.claude/settings.local.json') && !sameBefore.has('scan.mjs'),
      'a snapshot covers the user files resolved from the checkout, and nothing beside them',
      [...sameBefore.keys()],
    );

    writeFileSync(join(checkout, 'plugins.lock'), '{"probe":true}\n');
    rmSync(join(checkout, 'opencode.json'));
    writeFileSync(join(checkout, 'plugins.local', 'acme', 'index.mjs'), 'export default { evil: true };\n');
    writeFileSync(join(checkout, '.claude', 'settings.json'), '{"hooks":{}}\n');
    writeFileSync(join(checkout, '.claude', 'hooks', 'post.sh'), '#!/bin/sh\n');
    writeFileSync(join(checkout, '.claude', 'settings.local.json'), '{"x":1}\n');
    const sameDrift = diffSnapshots(sameBefore, same());
    check(
      JSON.stringify(sameDrift) === JSON.stringify([
        { path: '.claude/hooks/post.sh', change: 'added' },
        { path: '.claude/settings.json', change: 'modified' },
        { path: 'opencode.json', change: 'removed' },
        { path: 'plugins.local/acme/index.mjs', change: 'modified' },
        { path: 'plugins.lock', change: 'modified' },
      ]),
      'a write to each checkout-resolved user file is named',
      sameDrift,
    );

    // A data root elsewhere: the same files are still read from the checkout,
    // under keys that cannot be taken for a path under the data root.
    const elsewhere = join(dir, 'elsewhere');
    mkdirSync(elsewhere);
    const apart = () => snapshotDataRoot(elsewhere, checkout);
    const apartBefore = apart();
    check(
      apartBefore.has(`${CHECKOUT_KEY_PREFIX}plugins.lock`) && !apartBefore.has('plugins.lock'),
      'with a separate data root, checkout files are keyed apart from data-root paths',
      [...apartBefore.keys()],
    );
    writeFileSync(join(checkout, 'plugins.lock'), '{"probe":2}\n');
    // The same name under the data root is not a user file there.
    writeFileSync(join(elsewhere, 'plugins.lock'), '{}\n');
    const apartDrift = diffSnapshots(apartBefore, apart());
    check(
      JSON.stringify(apartDrift) === JSON.stringify([{ path: `${CHECKOUT_KEY_PREFIX}plugins.lock`, change: 'modified' }]),
      'with a separate data root, a write in the checkout is named and one in the data root is not',
      apartDrift,
    );
    const apartReport = describeDrift(elsewhere, apartDrift, checkout);
    check(
      apartReport.some((l) => l.includes(`${CHECKOUT_KEY_PREFIX}plugins.lock`))
        && apartReport.some((l) => l.includes(CHECKOUT_KEY_PREFIX.replace(/\/$/, '')) && l.includes(checkout)),
      'the report says which directory the checkout key stands for',
      apartReport,
    );
    check(
      !describeDrift(elsewhere, drift, checkout).some((l) => l.includes(checkout)),
      'a report with no checkout paths does not mention the checkout',
      describeDrift(elsewhere, drift, checkout),
    );

    // The same directory reached by two spellings is one root, not two.
    let aliased = true;
    const alias = join(dir, 'checkout-alias');
    try { symlinkSync(checkout, alias, 'dir'); } catch { aliased = false; }
    if (aliased) {
      const keys = [...snapshotDataRoot(alias, realpathSync(checkout)).keys()];
      check(keys.includes('plugins.lock') && !keys.some((k) => k.startsWith(CHECKOUT_KEY_PREFIX)),
        'a data root that is a link to the checkout counts as the checkout', keys);
    } else {
      pass('aliased-checkout check skipped: this platform refused the symlink');
    }
  }

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
  const lists = [GUARDED_PATHS, CHECKOUT_GUARDED_PATHS, unguarded];
  const unclassified = userPaths.filter((p) => !lists.some((list) => list.includes(p)));
  check(
    unclassified.length === 0,
    'every USER_PATHS entry is guarded (from the data root or the checkout) or listed as unguarded with a reason',
    unclassified,
  );
  const notUserLayer = lists.flat().filter((p) => !userPaths.includes(p));
  check(
    notUserLayer.length === 0,
    'no list names a path that is not in USER_PATHS',
    notUserLayer,
  );
  const inTwo = userPaths.filter((p) => lists.filter((list) => list.includes(p)).length > 1);
  check(inTwo.length === 0, 'no path is in more than one list', inTwo);
  const checkoutOnly = ['plugins.local', 'plugins.lock', 'opencode.json', '.claude/settings.json', '.claude/hooks']
    .filter((p) => !CHECKOUT_GUARDED_PATHS.includes(p));
  check(checkoutOnly.length === 0, 'the five user files resolved from the checkout are guarded there (#5207)', checkoutOnly);
  const noReason = unguarded.filter((p) => String(UNGUARDED_USER_PATHS[p] ?? '').trim().length < 20);
  check(noReason.length === 0, 'every unguarded path says why', noReason);
} catch (err) {
  fail(`data-root guard test could not run: ${err.message}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
