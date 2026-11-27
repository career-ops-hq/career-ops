/**
 * updater-local-overlay.test.mjs — system files declared in
 * config/system-overlay.txt are three-way merged with upstream on update
 * instead of being frozen or overwritten (#4326).
 *
 * apply() is not exported and fetches the canonical repo, so it cannot run
 * here (see updater-failed-checkout-restore.test.mjs). The overlay decisions
 * live in exported functions that apply() calls unchanged:
 * localOverlayPaths, mergeSystemOverlays (with overlayBaseBlob),
 * recordOverlayBase, restoreOverlayBase and updateCommitMessage. Sections 1 to
 * 9 drive them against throwaway repos through several updates, replaying only
 * the checkout and commit apply() performs for every system file. Section 10
 * asserts against apply()'s source that it calls them in that order.
 */

import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo, sealProcessGitEnv, rmSync, ROOT } from './helpers.mjs';
import {
  SYSTEM_OVERLAY_FILE,
  OVERLAY_BASE_REF,
  localOverlayPaths,
  mergeSystemOverlays,
  overlayBaseBlob,
  overlayBaseRefForBackup,
  recordOverlayBase,
  restoreOverlayBase,
  updateCommitMessage,
} from '../update-system.mjs';

// mergeSystemOverlays runs git with the process environment.
sealProcessGitEnv();

const FILE = 'sys/a.txt';
const BACKUP = 'backup-pre-update-1.0.0-20260101T000000Z';
const BACKUP_2 = 'backup-pre-update-2.0.0-20260102T000000Z';

function write(dir, rel, text) {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
}
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf-8');
const lines = (...l) => `${l.join('\n')}\n`;

/**
 * An install on `main` at upstream v1, plus upstream versions as commits on
 * the `upstream` branch: the objects a real update has after its fetch.
 * Returns each upstream version's commit.
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

/** What apply() does around a planned merge: checkout, write, commit, record. */
function replayUpdate({ dir, g }, target, results, backupBranch) {
  g('checkout', target, '--', 'sys/');
  const merged = results.filter((r) => r.status === 'merged');
  for (const { file, content } of merged) writeFileSync(join(dir, file), content);
  g('add', '-A', 'sys/');
  g('commit', '-qm', updateCommitMessage('x', merged.map((r) => r.file)));
  recordOverlayBase(target, backupBranch, { git: g });
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

console.log('\n🧪 Testing local system-file overlays (#4326)...');

// ── 1. The declaration file is validated, entry by entry ──
{
  const { dir } = makeUpdaterRepo({ prefix: 'co-overlay-decl-' });
  try {
    const system = ['sys/', 'update-system.mjs'];
    if (localOverlayPaths(dir, system).length === 0) pass('no declaration file: no overlays');
    else fail('an absent declaration file must declare nothing');

    write(dir, SYSTEM_OVERLAY_FILE, '# mine\r\n\r\nsys/a.txt\r\nupdate-system.mjs\r\nsys/a.txt\r\n');
    const declared = localOverlayPaths(dir, system);
    if (JSON.stringify(declared) === JSON.stringify(['sys/a.txt', 'update-system.mjs'])) {
      pass('system files are accepted; comments, blanks, CRLF and duplicates are ignored');
    } else {
      fail(`unexpected declaration: ${JSON.stringify(declared)}`);
    }

    for (const [entry, why] of [
      ['sys/', /not directories/],
      ['/etc/passwd', /absolute/],
      ['sys/../cv.md', /segments are forbidden/],
      ['./sys/a.txt', /"\.\/" aliases/],
      ['cv.md', /protected user path/],
      ['notes/todo.txt', /not a system file/],
    ]) {
      write(dir, SYSTEM_OVERLAY_FILE, `${entry}\n`);
      try {
        localOverlayPaths(dir, system);
        fail(`"${entry}" must be refused`);
      } catch (err) {
        if (why.test(err.message) && err.message.includes(`"${entry}"`)) pass(`refuses "${entry}", naming it`);
        else fail(`"${entry}" refused for the wrong reason: ${err.message}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2-4. Three updates: a first merge, a second, a conflict ──
{
  const install = makeInstall([V1, V2, V3, V4]);
  const { dir, g, commits } = install;
  const [, c2, c3, c4] = commits;
  try {
    // An uncommitted edit, as most local fixes are.
    write(dir, FILE, LOCAL1);

    // 2. First update: no recorded base yet, so the ancestor is what the
    //    install started from (v1), never an empty file.
    const first = mergeSystemOverlays([FILE], c2, { root: dir });
    const want2 = MERGED2;
    if (first[0].status === 'merged' && String(first[0].content) === want2) {
      pass('first update: upstream changes and the uncommitted local edit both land');
    } else {
      fail(`first update: ${first[0].status} ${JSON.stringify(String(first[0].content))}`);
    }
    if (read(dir, FILE) === LOCAL1) {
      pass('planning the merge leaves the worktree file untouched');
    } else {
      fail('mergeSystemOverlays wrote to the worktree');
    }
    replayUpdate(install, c2, first, BACKUP);
    if (g('rev-parse', OVERLAY_BASE_REF) === c2) pass('the update records the target as the next merge base');
    else fail('OVERLAY_BASE_REF was not recorded');

    // 3. Second update re-edits a line the first one changed. Its ancestor
    //    must be v2 as upstream shipped it, not v1 and not the merged file.
    const second = mergeSystemOverlays([FILE], c3, { root: dir });
    const want3 = MERGED3;
    if (second[0].status === 'merged' && String(second[0].content) === want3) {
      pass('second update: merges against the version the first one installed');
    } else {
      fail(`second update: ${second[0].status} ${JSON.stringify(String(second[0].content))}`);
    }
    replayUpdate(install, c3, second, BACKUP_2);
    if (read(dir, FILE) === want3 && g('rev-parse', overlayBaseRefForBackup(BACKUP_2)) === c2) {
      pass('the replaced base is paired with the backup branch for rollback');
    } else {
      fail('second update did not pair the previous base');
    }

    // 4. Upstream edits the locally edited line: a conflict, reported with
    //    markers, and nothing in the worktree changes.
    const before = read(dir, FILE);
    const third = mergeSystemOverlays([FILE], c4, { root: dir });
    const text = String(third[0].content);
    if (third[0].status === 'conflict' && third[0].conflicts === 1
        && text.includes('<<<<<<< yours') && text.includes('||||||| previous upstream')
        && text.includes('>>>>>>> new upstream') && text.includes('G local') && text.includes('G up4')) {
      pass('conflict: diff3 markers name all three sides');
    } else {
      fail(`conflict not reported: ${third[0].status} ${JSON.stringify(text)}`);
    }
    if (read(dir, FILE) === before) pass('conflict: the local file is untouched');
    else fail('a conflicting merge changed the local file');

    // 5. Rollback restores the base the rolled-back update replaced; the
    //    update that first recorded one leaves nothing to restore.
    if (restoreOverlayBase(BACKUP_2, { git: g }) === c2 && g('rev-parse', OVERLAY_BASE_REF) === c2) {
      pass('rollback puts back the previous merge base');
    } else {
      fail('rollback did not restore the paired base');
    }
    if (restoreOverlayBase(BACKUP, { git: g }) === null
        && g('for-each-ref', OVERLAY_BASE_REF) === '') {
      pass('rollback past the first recorded base removes the ref');
    } else {
      fail('rollback with no pair must delete OVERLAY_BASE_REF');
    }

    // 6. With no ref, history answers: an update commit that merged an
    //    overlay into the file is skipped, so the base is upstream's blob.
    const fallback = overlayBaseBlob(FILE, c4, { git: g });
    if (fallback === g('rev-parse', `${commits[0]}:${FILE}`)) {
      pass('history fallback skips update commits that merged an overlay');
    } else {
      fail(`history fallback returned ${fallback}`);
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
    // A pre-overlay update: plain checkout, plain message, no ref recorded.
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

// ── 8. Line endings, missing sides, and the bootstrap copy ──
{
  const install = makeInstall([V1, V2]);
  const { dir, g, commits } = install;
  const [, c2] = commits;
  try {
    // A CRLF checkout must not read as a change to every line.
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

    // The bootstrap checkout already replaced the file; the parent's copy
    // holds the install's version.
    write(dir, FILE, LOCAL1);
    copyFileSync(join(dir, FILE), join(dir, `${FILE}.bak`));
    g('checkout', c2, '--', FILE);
    const sources = new Map([[FILE, join(dir, `${FILE}.bak`)]]);
    const [boot] = mergeSystemOverlays([FILE], c2, { root: dir, localSources: sources });
    if (boot.status === 'merged' && String(boot.content) === MERGED2) {
      pass('an overlaid updater file merges from the copy saved before the bootstrap checkout');
    } else {
      fail(`bootstrap source: ${boot.status} ${JSON.stringify(String(boot.content))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 9. The commit names merged files; a plain update keeps its subject ──
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

// ── 10. apply() calls the helpers in the order the guarantees need ──
{
  const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  const body = source.slice(source.indexOf('async function apply() {'), source.indexOf('function rollback() {'));
  const at = (needle, from = 0) => body.indexOf(needle, from);
  const bootstrapSave = at('const overlayBootstrap = reexecFiles.filter(');
  const bootstrapCheckout = at("git('--literal-pathspecs', 'checkout', targetCommit, '--', ...reexecFiles)");
  const sourcesEnv = at('CAREER_OPS_UPDATE_OVERLAY_SOURCES: JSON.stringify(overlaySources)');
  const plan = at('mergeSystemOverlays(overlayFiles, targetCommit');
  const conflictStop = at('throw new Error(`Overlay merge conflict', plan);
  const localEdits = at('locallyModifiedSystemFiles(updatePaths, targetCommit)', plan);
  const checkout = at('checkoutSystemPathsBatched(', plan);
  const writeMerged = at('for (const { file, content } of overlayMerges)', checkout);
  const commit = at('updateCommitMessage(remote, overlayMerges', writeMerged);
  const record = at('recordOverlayBase(targetCommit, backupBranch)', commit);
  if (bootstrapSave !== -1 && bootstrapCheckout > bootstrapSave && sourcesEnv > bootstrapCheckout) {
    pass('the parent saves overlaid updater files before its bootstrap checkout');
  } else {
    fail('overlaid updater files must be saved before the bootstrap checkout');
  }
  if (plan !== -1 && conflictStop > plan && localEdits > conflictStop && checkout > localEdits
      && writeMerged > checkout && commit > writeMerged && record > commit) {
    pass('apply(): plan, stop on conflict, check out, write merges, commit, record the base');
  } else {
    fail(`apply() order broken: ${JSON.stringify({ plan, conflictStop, localEdits, checkout, writeMerged, commit, record })}`);
  }
  if (/if \(authenticatedReexec\) \{\s*try \{\s*bootstrapOverlays = JSON\.parse\(process\.env\.CAREER_OPS_UPDATE_OVERLAY_SOURCES/.test(body)) {
    pass('the child trusts the overlay sources only from an authenticated parent');
  } else {
    fail('CAREER_OPS_UPDATE_OVERLAY_SOURCES must be read only under authenticatedReexec');
  }
  const rollbackBody = source.slice(source.indexOf('function rollback() {'));
  if (rollbackBody.indexOf('restoreOverlayBase(latest)') !== -1) pass('rollback restores the overlay base');
  else fail('rollback must call restoreOverlayBase');
  if (readFileSync(join(ROOT, '.gitignore'), 'utf-8').split(/\r?\n/).includes(SYSTEM_OVERLAY_FILE)) {
    pass(`${SYSTEM_OVERLAY_FILE} is gitignored`);
  } else {
    fail(`${SYSTEM_OVERLAY_FILE} must be gitignored`);
  }
}
