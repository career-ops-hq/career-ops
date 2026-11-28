/**
 * updater-local-overlay.test.mjs — system files declared in
 * config/system-overlay.txt are three-way merged with upstream on update
 * instead of being frozen or overwritten (#4326).
 *
 * apply() is not exported and fetches the canonical repo, so it cannot run
 * here (see updater-failed-checkout-restore.test.mjs). The overlay decisions
 * live in exported functions that apply() calls unchanged. Sections 1 to 14
 * drive them against throwaway repos through several updates, replaying only
 * the checkout and commit apply() performs for every system file. Section 15
 * asserts against apply()'s source that it calls them in that order.
 */

import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, utimesSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo, sealProcessGitEnv, rmSync, ROOT } from './helpers.mjs';
import {
  SYSTEM_OVERLAY_FILE,
  OVERLAY_BASE_REF,
  localOverlayPaths,
  mergeSystemOverlays,
  overlayBaseBlob,
  overlayBaseRefForBackup,
  overlayArtifactRoot,
  saveOverlayArtifact,
  readOverlayPending,
  writeOverlayPending,
  bootstrapOverlaySources,
  nextOverlayBase,
  writeOverlayBase,
  pairOverlayBase,
  restoreOverlayBase,
  pruneOverlayRuns,
  updateCommitMessage,
} from '../update-system.mjs';

// mergeSystemOverlays runs git with the process environment.
sealProcessGitEnv();

const FILE = 'sys/a.txt';
const BACKUP_1 = 'backup-pre-update-1.0.0-20260101T000000Z';
const BACKUP_2 = 'backup-pre-update-2.0.0-20260102T000000Z';
const BACKUP_3 = 'backup-pre-update-3.0.0-20260103T000000Z';

function write(dir, rel, text) {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
}
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf-8');
const lines = (...l) => `${l.join('\n')}\n`;
const threw = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
};

/**
 * An install on `main` at upstream v1, plus upstream versions as commits on
 * the `upstream` branch: the objects a real update has after its fetch.
 */
function makeInstall(versions) {
  const repo = makeUpdaterRepo({ prefix: 'co-overlay-', includeRoot: true });
  const { dir, g } = repo;
  write(dir, FILE, versions[0]);
  write(dir, 'sys/other.txt', 'other\n');
  g('add', '-A');
  g('commit', '-qm', 'upstream v1');
  const commits = [g('rev-parse', 'HEAD')];
  g('checkout', '-q', '-b', 'upstream');
  for (const [i, text] of versions.slice(1).entries()) {
    write(dir, FILE, text);
    g('commit', '-qam', `upstream v${i + 2}`);
    commits.push(g('rev-parse', 'HEAD'));
  }
  g('checkout', '-q', 'main');
  return { ...repo, commits };
}

/**
 * What apply() does around a planned merge: pair the base with the backup,
 * check out, write the merges, commit, record the next bases.
 */
function replayUpdate({ dir, g }, target, results, backupBranch) {
  pairOverlayBase(backupBranch, { root: dir });
  g('checkout', target, '--', 'sys/');
  const merged = results.filter((r) => r.status === 'merged');
  for (const { file, content } of merged) writeFileSync(join(dir, file), content);
  g('add', '-A', 'sys/');
  g('commit', '-qm', updateCommitMessage('x', merged.map((r) => r.file)));
  writeOverlayBase(nextOverlayBase(results, new Set(), target, { git: g }), { root: dir });
}

// The local edit is on G. Upstream edits stay at least one unchanged line
// away from it, since git merges adjacent edits as a conflict.
const V1 = lines('A', 'B', 'C', 'D', 'E', 'F', 'G');
const V2 = lines('A up1', 'B', 'C up1', 'D', 'E', 'F', 'G');
// Re-edits line A, which v2 already changed: a stale base would conflict here.
const V3 = lines('A up2', 'B', 'C up1', 'D', 'E up3', 'F', 'G');
const V4 = lines('A up2', 'B', 'C up1', 'D', 'E up3', 'F', 'G up4');
const LOCAL1 = lines('A', 'B', 'C', 'D', 'E', 'F', 'G local');
const MERGED2 = lines('A up1', 'B', 'C up1', 'D', 'E', 'F', 'G local');
const MERGED3 = lines('A up2', 'B', 'C up1', 'D', 'E up3', 'F', 'G local');
const RESOLVED4 = lines('A up2', 'B', 'C up1', 'D', 'E up3', 'F', 'G local and up4');

console.log('\n🧪 Testing local system-file overlays (#4326)...');

// ── 1. The declaration file is read from the data root and validated ──
{
  const { dir } = makeUpdaterRepo({ prefix: 'co-overlay-decl-' });
  const { dir: data } = makeUpdaterRepo({ prefix: 'co-overlay-data-' });
  try {
    const system = ['sys/', 'update-system.mjs'];
    if (localOverlayPaths(dir, system).length === 0) pass('no declaration file: no overlays');
    else fail('an absent declaration file must declare nothing');

    write(data, SYSTEM_OVERLAY_FILE, '# mine\r\n\r\nsys/a.txt\r\nupdate-system.mjs\r\nsys/a.txt\r\n');
    const declared = localOverlayPaths(dir, system, data);
    if (JSON.stringify(declared) === JSON.stringify(['sys/a.txt', 'update-system.mjs'])
        && localOverlayPaths(dir, system).length === 0) {
      pass('the declaration is read from the data root, not the checkout');
    } else {
      fail(`unexpected declaration: ${JSON.stringify(declared)}`);
    }

    mkdirSync(join(dir, 'sys', 'nested'), { recursive: true });
    for (const [entry, why] of [
      ['sys/', /not directories/],
      ['sys/nested', /is a directory/],
      ['/etc/passwd', /absolute/],
      ['sys/../cv.md', /segments are forbidden/],
      ['./sys/a.txt', /"\.\/" aliases/],
      ['cv.md', /protected user path/],
      ['notes/todo.txt', /not a system file/],
    ]) {
      write(data, SYSTEM_OVERLAY_FILE, `${entry}\n`);
      const err = threw(() => localOverlayPaths(dir, system, data));
      if (err && why.test(err.message) && err.message.includes(`"${entry}"`)) pass(`refuses "${entry}", naming it`);
      else fail(`"${entry}" refused wrongly or not at all: ${err?.message}`);
    }
    write(data, SYSTEM_OVERLAY_FILE, 'sys\n');
    const dirEntry = threw(() => localOverlayPaths(dir, ['sys/'], data));
    if (dirEntry && /is a directory/.test(dirEntry.message)) pass('refuses a manifest directory named without its slash');
    else fail(`"sys" must be refused as a directory: ${dirEntry?.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
}

// ── 2-6. Three updates, a conflict and its resolution, rollback ──
{
  const install = makeInstall([V1, V2, V3, V4]);
  const { dir, g, commits } = install;
  const [c1, c2, c3, c4] = commits;
  try {
    // An uncommitted edit, as most local fixes are.
    write(dir, FILE, LOCAL1);

    // 2. First update: no recorded base yet, so the ancestor is what the
    //    install started from (v1), never an empty file.
    const first = mergeSystemOverlays([FILE], c2, { root: dir });
    if (first[0].status === 'merged' && String(first[0].content) === MERGED2) {
      pass('first update: upstream changes and the uncommitted local edit both land');
    } else {
      fail(`first update: ${first[0].status} ${JSON.stringify(String(first[0].content))}`);
    }
    if (read(dir, FILE) === LOCAL1) pass('planning the merge leaves the worktree file untouched');
    else fail('mergeSystemOverlays wrote to the worktree');
    replayUpdate(install, c2, first, BACKUP_1);
    if (g('rev-parse', `${OVERLAY_BASE_REF}:${FILE}`) === g('rev-parse', `${c2}:${FILE}`)) {
      pass('the update records the target\'s blob as the file\'s next merge base');
    } else {
      fail('OVERLAY_BASE_REF does not hold the delivered blob');
    }
    if (g('ls-tree', '-r', '--name-only', overlayBaseRefForBackup(BACKUP_1)) === '') {
      pass('"no base yet" is paired with the backup explicitly, as an empty tree');
    } else {
      fail('the first backup must pair an empty base');
    }

    // 3. Second update re-edits a line the first one changed. Its ancestor
    //    must be v2 as upstream shipped it, not v1 and not the merged file.
    const second = mergeSystemOverlays([FILE], c3, { root: dir });
    if (second[0].status === 'merged' && String(second[0].content) === MERGED3) {
      pass('second update: merges against the version the first one installed');
    } else {
      fail(`second update: ${second[0].status} ${JSON.stringify(String(second[0].content))}`);
    }
    const afterFirst = g('rev-parse', OVERLAY_BASE_REF);
    replayUpdate(install, c3, second, BACKUP_2);
    if (read(dir, FILE) === MERGED3 && g('rev-parse', overlayBaseRefForBackup(BACKUP_2)) === afterFirst) {
      pass('the replaced base is paired with the backup branch for rollback');
    } else {
      fail('second update did not pair the previous base');
    }

    // 4. A file the update kept at its local version keeps its old base, so
    //    the upstream change it skipped is not read as a local revert later.
    const kept = nextOverlayBase(
      [{ file: FILE, base: g('rev-parse', `${c2}:${FILE}`) }], new Set([FILE]), c3, { git: g },
    );
    const received = nextOverlayBase(
      [{ file: FILE, base: g('rev-parse', `${c2}:${FILE}`) }], new Set(), c3, { git: g },
    );
    if (kept.get(FILE) === g('rev-parse', `${c2}:${FILE}`) && received.get(FILE) === g('rev-parse', `${c3}:${FILE}`)) {
      pass('per-file base: advances only for a file that received the target');
    } else {
      fail(`per-file base: kept ${kept.get(FILE)}, received ${received.get(FILE)}`);
    }

    // 5. Upstream edits the locally edited line: a conflict, with markers,
    //    and nothing in the worktree changes.
    const before = read(dir, FILE);
    const [third] = mergeSystemOverlays([FILE], c4, { root: dir });
    const text = String(third.content);
    if (third.status === 'conflict' && third.conflicts === 1
        && text.includes('<<<<<<< yours') && text.includes('||||||| previous upstream')
        && text.includes('>>>>>>> new upstream') && text.includes('G local') && text.includes('G up4')) {
      pass('conflict: diff3 markers name all three sides');
    } else {
      fail(`conflict not reported: ${third.status} ${JSON.stringify(text)}`);
    }
    if (read(dir, FILE) === before) pass('conflict: the local file is untouched');
    else fail('a conflicting merge changed the local file');

    //    The run records the conflict. Unchanged, the file conflicts again;
    //    with markers left in, the update says so; resolved, the resolution
    //    is taken as merged with v4 instead of conflicting again.
    const pending = { [FILE]: { local: third.local, upstream: third.upstream } };
    const [again] = mergeSystemOverlays([FILE], c4, { root: dir, pending });
    if (again.status === 'conflict' && again.content !== undefined) pass('an unresolved conflict conflicts again');
    else fail(`unresolved conflict: ${again.status}`);
    write(dir, FILE, text);
    const [markers] = mergeSystemOverlays([FILE], c4, { root: dir, pending });
    if (markers.status === 'conflict' && markers.content === undefined && /conflict markers/.test(markers.reason)) {
      pass('a file still holding conflict markers is reported, not merged');
    } else {
      fail(`markers left in: ${JSON.stringify(markers)}`);
    }
    write(dir, FILE, RESOLVED4);
    const [resolved] = mergeSystemOverlays([FILE], c4, { root: dir, pending });
    if (resolved.status === 'merged' && String(resolved.content) === RESOLVED4) {
      pass('a resolved conflict is accepted on the next run, without --force');
    } else {
      fail(`resolved conflict: ${resolved.status} ${JSON.stringify(String(resolved.content))}`);
    }
    const [forced] = mergeSystemOverlays([FILE], c4, { root: dir, planOnly: true });
    if (forced.status === 'changed' && forced.content === undefined) pass('--force plans without running a merge');
    else fail(`planOnly: ${JSON.stringify(forced)}`);
    write(dir, FILE, MERGED3);

    // 6. Rollback restores the base each backup replaced, including "none
    //    yet"; a backup with no pair predates overlays and removes the ref.
    if (restoreOverlayBase(BACKUP_2, { git: g }) === afterFirst && g('rev-parse', OVERLAY_BASE_REF) === afterFirst) {
      pass('rollback puts back the previous merge base');
    } else {
      fail('rollback did not restore the paired base');
    }
    restoreOverlayBase(BACKUP_1, { git: g });
    if (overlayBaseBlob(FILE, c4, { git: g }) === g('rev-parse', `${c1}:${FILE}`)) {
      pass('rollback to "no base yet" returns to history, which skips merged update commits');
    } else {
      fail(`after rollback to the first backup: ${overlayBaseBlob(FILE, c4, { git: g })}`);
    }
    if (restoreOverlayBase(BACKUP_3, { git: g }) === null && g('for-each-ref', OVERLAY_BASE_REF) === '') {
      pass('a backup with no pair removes the ref');
    } else {
      fail('a backup with no pair must delete OVERLAY_BASE_REF');
    }
    const failing = (...args) => {
      if (args[0] === 'update-ref') throw new Error('cannot lock ref');
      return g(...args);
    };
    if (threw(() => restoreOverlayBase(BACKUP_2, { git: failing }))?.message === 'cannot lock ref') {
      pass('a failed base write is reported, not taken for a missing pair');
    } else {
      fail('restoreOverlayBase must throw when it cannot write the ref');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 7. An install from before overlays: its last update delivered upstream ──
{
  const install = makeInstall([V1, V2, V3]);
  const { dir, g, commits } = install;
  const [, c2, c3] = commits;
  try {
    g('checkout', c2, '--', 'sys/');
    g('commit', '-qm', 'chore: auto-update system files to v2');
    write(dir, FILE, MERGED2);
    const [result] = mergeSystemOverlays([FILE], c3, { root: dir });
    if (result.status === 'merged' && String(result.content) === MERGED3) {
      pass('first overlay update on an updated install merges against the delivered version');
    } else {
      fail(`pre-overlay install: ${result.status} ${JSON.stringify(String(result.content))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 8. Line endings, missing sides ──
{
  const install = makeInstall([V1, V2]);
  const { dir, g, commits } = install;
  const [, c2] = commits;
  try {
    g('config', 'core.autocrlf', 'true');
    write(dir, FILE, LOCAL1.replace(/\n/g, '\r\n'));
    const [crlf] = mergeSystemOverlays([FILE], c2, { root: dir });
    if (crlf.status === 'merged' && String(crlf.content) === MERGED2) {
      pass('a CRLF worktree merges line by line, not as one whole-file conflict');
    } else {
      fail(`CRLF worktree: ${crlf.status} ${JSON.stringify(String(crlf.content))}`);
    }
    g('config', 'core.autocrlf', 'false');

    write(dir, FILE, V1);
    const [unedited] = mergeSystemOverlays([FILE], c2, { root: dir });
    if (unedited.status === 'none') pass('an unedited overlay is left to the ordinary checkout');
    else fail(`unedited overlay: ${unedited.status}`);

    rmSync(join(dir, FILE));
    const [gone] = mergeSystemOverlays([FILE], c2, { root: dir });
    if (gone.status === 'none') pass('a locally deleted overlay is left to the local-edit check');
    else fail(`deleted overlay: ${gone.status}`);

    write(dir, 'sys/new.txt', 'mine\n');
    const [noBase] = mergeSystemOverlays(['sys/new.txt'], c2, { root: dir });
    if (noBase.status === 'kept' && /no earlier upstream version/.test(noBase.reason)) {
      pass('a file no ancestor has is kept, not merged');
    } else {
      fail(`no base: ${JSON.stringify(noBase)}`);
    }

    g('checkout', '-q', 'upstream');
    g('rm', '-q', 'sys/other.txt');
    g('commit', '-qm', 'upstream removes other');
    const removed = g('rev-parse', 'HEAD');
    g('checkout', '-q', 'main');
    write(dir, 'sys/other.txt', 'other, edited\n');
    const [dropped] = mergeSystemOverlays(['sys/other.txt'], removed, { root: dir });
    if (dropped.status === 'kept' && /no longer ships/.test(dropped.reason)) {
      pass('an overlay upstream deleted is kept as a local edit');
    } else {
      fail(`upstream deletion: ${JSON.stringify(dropped)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 9-10. Where an overlaid updater file's local version comes from ──
{
  const install = makeInstall([V1, V2]);
  const { dir, g, commits } = install;
  const [, c2] = commits;
  try {
    // 9. A parent that knows overlays copies the file into the run directory
    //    and lists it; the child merges from that copy.
    const runDir = join(overlayArtifactRoot(dir), BACKUP_1);
    write(dir, FILE, LOCAL1);
    saveOverlayArtifact(runDir, FILE, { from: join(dir, FILE) });
    g('checkout', c2, '--', FILE);
    const listed = bootstrapOverlaySources([FILE, 'sys/other.txt'], {
      handoff: JSON.stringify([FILE]), runDir, backupBranch: BACKUP_1, targetRef: c2, root: dir,
    });
    const [boot] = mergeSystemOverlays([FILE], c2, { root: dir, localSources: listed });
    if (listed.size === 1 && listed.get(FILE) === join(runDir, 'sys', 'a.txt')
        && boot.status === 'merged' && String(boot.content) === MERGED2) {
      pass('an overlaid updater file merges from the copy saved before the bootstrap checkout');
    } else {
      fail(`handoff: ${JSON.stringify([...listed])} ${boot.status}`);
    }

    // 10. A parent from before overlays passes nothing but saved <file>.bak
    //     (#2337). Only a copy this run wrote is used.
    copyFileSync(join(runDir, 'sys', 'a.txt'), join(dir, `${FILE}.bak`));
    const fresh = bootstrapOverlaySources([FILE], { runDir, backupBranch: BACKUP_1, targetRef: c2, root: dir });
    if (fresh.get(FILE) === join(dir, 'sys', 'a.txt.bak')) pass('without a handoff, a .bak this run wrote is the local version');
    else fail(`legacy parent: ${JSON.stringify([...fresh])}`);
    const past = new Date('2025-06-01T00:00:00Z');
    utimesSync(join(dir, `${FILE}.bak`), past, past);
    const stale = bootstrapOverlaySources([FILE], { runDir, backupBranch: BACKUP_1, targetRef: c2, root: dir });
    if (stale.size === 0) pass('an older .bak is never taken for this run\'s copy');
    else fail('a .bak older than the run must be ignored');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 11-13. Recovery files live under the git dir and are never replaced ──
{
  const { dir, g } = makeUpdaterRepo({ prefix: 'co-overlay-artifacts-', includeRoot: true });
  try {
    const root = overlayArtifactRoot(dir);
    if (root.startsWith(join(dir, '.git'))) pass('overlay artifacts live inside the git directory');
    else fail(`artifact root outside .git: ${root}`);

    const runDir = join(root, BACKUP_1);
    const merge = saveOverlayArtifact(runDir, FILE, { content: 'x\n', suffix: '.merge' });
    const again = threw(() => saveOverlayArtifact(runDir, FILE, { content: 'y\n', suffix: '.merge' }));
    if (merge === join(runDir, 'sys', 'a.txt.merge') && again && readFileSync(merge, 'utf-8') === 'x\n') {
      pass('an artifact is created exclusively, never replacing an existing file');
    } else {
      fail(`exclusive creation: ${merge} ${again?.message}`);
    }

    writeOverlayPending(root, { [FILE]: { local: 'a'.repeat(40), upstream: 'b'.repeat(40) } });
    const roundTrip = readOverlayPending(root);
    writeOverlayPending(root, {});
    if (roundTrip[FILE]?.upstream === 'b'.repeat(40) && Object.keys(readOverlayPending(root)).length === 0) {
      pass('pending conflicts are recorded and cleared');
    } else {
      fail(`pending round trip: ${JSON.stringify(roundTrip)}`);
    }

    // 13. A run directory goes when its backup branch goes.
    write(dir, 'x.txt', 'x\n');
    g('add', 'x.txt');
    g('commit', '-qm', 'x');
    g('branch', BACKUP_2);
    mkdirSync(join(root, BACKUP_2), { recursive: true });
    const pruned = pruneOverlayRuns({ root: dir, git: g });
    if (JSON.stringify(pruned) === JSON.stringify([BACKUP_1]) && existsSync(join(root, BACKUP_2)) && !existsSync(runDir)) {
      pass('run directories are pruned with their backup branches');
    } else {
      fail(`prune: ${JSON.stringify(pruned)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 14. The commit names merged files; a plain update keeps its subject ──
{
  const plain = updateCommitMessage('1.2.3');
  const merged = updateCommitMessage('1.2.3', ['b.mjs', 'a.mjs']);
  if (plain === 'chore: auto-update system files to v1.2.3'
      && merged === 'chore: auto-update system files to v1.2.3\n\nCareer-Ops-Overlay-Merged: ["a.mjs","b.mjs"]') {
    pass('update commit message: subject unchanged, merged overlays in a trailer');
  } else {
    fail(`unexpected messages: ${JSON.stringify([plain, merged])}`);
  }
}

// ── 15. apply() calls the helpers in the order the guarantees need ──
{
  const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  const body = source.slice(source.indexOf('async function apply() {'), source.indexOf('function rollback() {'));
  const at = (needle, from = 0) => body.indexOf(needle, from);

  const targetPair = at("git('update-ref', pairedTargetRef, targetCommit)");
  const basePair = at('pairOverlayBase(backupBranch)', targetPair);
  const dataRoot = at('dataRoot = getCareerOpsRoot()', basePair);
  const bootstrapCopy = at('saveOverlayArtifact(overlayRunDir, file, { from: source })', dataRoot);
  const copyFailStop = at('Could not save your overlaid', bootstrapCopy);
  const bootstrapCheckout = at("git('--literal-pathspecs', 'checkout', targetCommit, '--', ...reexecFiles)", copyFailStop);
  const copyRestore = at('for (const { file, copy } of overlayCopies)', bootstrapCheckout);
  if (targetPair !== -1 && basePair > targetPair && dataRoot > basePair && bootstrapCopy > dataRoot
      && copyFailStop > bootstrapCopy && bootstrapCheckout > copyFailStop && copyRestore > bootstrapCheckout) {
    pass('parent: pairs the base, reads the data root, copies overlays (or stops) before its checkout, restores them on failure');
  } else {
    fail(`parent order broken: ${JSON.stringify({ targetPair, basePair, dataRoot, bootstrapCopy, copyFailStop, bootstrapCheckout, copyRestore })}`);
  }

  const plan = at('mergeSystemOverlays(overlayFiles, targetCommit');
  const bootstrapStop = at('Overlaid updater file(s) cannot be merged', plan);
  const localEdits = at('locallyModifiedSystemFiles(updatePaths, targetCommit)', bootstrapStop);
  const configured = at('snapshotConfiguredTemplateVariantsAcrossProfiles(', localEdits);
  const conflictStop = at('throw new Error(`Overlay merge conflict', configured);
  const checkout = at('checkoutSystemPathsBatched(', conflictStop);
  const writeMerged = at('for (const { file, content } of overlayMerges)', checkout);
  const writeRestore = at('restoreAfterFailedUpdate(mergePathLists(updated, batchAttempted)', writeMerged);
  const commit = at('updateCommitMessage(remote, overlayMerges', writeRestore);
  const record = at('writeOverlayBase(nextOverlayBase(overlayResults, preservedSet, targetCommit))', commit);
  if (plan !== -1 && bootstrapStop > plan && localEdits > bootstrapStop && configured > localEdits
      && conflictStop > configured && checkout > conflictStop && writeMerged > checkout
      && writeRestore > writeMerged && commit > writeRestore && record > commit) {
    pass('child: plan, stop, keep configured templates, stop on conflict, check out, write (or restore), commit, record');
  } else {
    fail(`child order broken: ${JSON.stringify({ plan, bootstrapStop, localEdits, configured, conflictStop, checkout, writeMerged, writeRestore, commit, record })}`);
  }
  if (/planOnly: updateForce/.test(body)) pass('--force skips running merges');
  else fail('mergeSystemOverlays must get planOnly: updateForce');
  if (/handoff: authenticatedReexec \? process\.env\.CAREER_OPS_UPDATE_OVERLAY_SOURCES : undefined/.test(body)) {
    pass('the child trusts the overlay handoff only from an authenticated parent');
  } else {
    fail('CAREER_OPS_UPDATE_OVERLAY_SOURCES must be read only under authenticatedReexec');
  }

  const rollbackBody = source.slice(source.indexOf('function rollback() {'));
  if (/try \{\s*restoreOverlayBase\(latest\);\s*\} catch/.test(rollbackBody) && rollbackBody.includes('Rollback incomplete. ${summary} The overlay merge base')) {
    pass('rollback restores the overlay base and reports a failure to');
  } else {
    fail('rollback must call restoreOverlayBase and report its failure');
  }
  if (readFileSync(join(ROOT, '.gitignore'), 'utf-8').split(/\r?\n/).includes(SYSTEM_OVERLAY_FILE)) {
    pass(`${SYSTEM_OVERLAY_FILE} is gitignored`);
  } else {
    fail(`${SYSTEM_OVERLAY_FILE} must be gitignored`);
  }
}
