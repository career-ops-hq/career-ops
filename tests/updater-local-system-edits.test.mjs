/**
 * updater-local-system-edits.test.mjs — BEHAVIORAL coverage for the #2337
 * detector.
 *
 * apply() is ROOT-bound with heavy side effects, so the detection is exported
 * and ctx-injectable and driven here against a throwaway repo — the same shape
 * as updater-rollback-behavior.test.mjs. What is verified is the property that
 * protects the user's work: a local fix upstream has NOT adopted is reported
 * before it is overwritten, and nothing else is.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, locallyModifiedSystemFiles } from '../update-system.mjs';

// A repo with an `upstream` branch standing in for FETCH_HEAD, and `main` as
// the install. Both start from a shared base commit, which is what gives
// merge-base a meaningful baseline.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'co-local-edits-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  // A developer or CI image with commit.gpgsign or a global core.hooksPath
  // would make every commit below fail, and all cases would go red for a
  // reason that has nothing to do with the detector (CodeRabbit review).
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  // Same reasoning for line endings: the cases below write LF and later compare
  // exact strings against files git CHECKED OUT, so a global core.autocrlf=true
  // (the default on GitHub's Windows images) would hand back CRLF and fail them
  // for a reason unrelated to the detector (CodeRabbit review).
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'shipped pdf\n');
  writeFileSync(join(dir, 'modes', 'cover.md'), 'shipped cover\n');
  writeFileSync(join(dir, 'generate-cover-letter.mjs'), 'shipped script\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');
  // `root` lets the detector check whether a path still exists on disk; without
  // it every case below would resolve against the real career-ops checkout.
  return { dir, g, ctx: { git: g, root: dir } };
}

/** Commit a change on the upstream branch and return to main. */
function upstreamChange(repo, file, content) {
  repo.g('checkout', '-q', 'upstream');
  writeFileSync(join(repo.dir, ...file.split('/')), content);
  repo.g('commit', '-qam', `upstream: ${file}`);
  repo.g('checkout', '-q', 'main');
}

/**
 * Replay what apply() does with an update: check the content out of the
 * upstream ref and record it with an ordinary commit. NOT a merge — that is
 * the whole point of case 14, so this must stay a raw checkout.
 */
function replayUpdate(repo, version) {
  repo.g('checkout', 'upstream', '--', ...PATHS);
  repo.g('commit', '-qm', `chore: auto-update system files to v${version}`);
}

const PATHS = ['modes/', 'generate-cover-letter.mjs'];

// ── 1. The reported case: a committed local fix upstream has not adopted ──
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  writeFileSync(join(repo.dir, 'generate-cover-letter.mjs'), 'local linkedin fix\n');
  repo.g('commit', '-qam', 'local fix');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'generate-cover-letter.mjs') {
    pass('a committed local fix upstream has not adopted is reported (#2337)');
  } else {
    fail(`#1 expected ['generate-cover-letter.mjs'], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 2. An uncommitted local edit counts too — it is just as overwritable ──
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  writeFileSync(join(repo.dir, 'generate-cover-letter.mjs'), 'uncommitted fix\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'generate-cover-letter.mjs') {
    pass('an uncommitted local edit is reported too');
  } else {
    fail(`#2 expected ['generate-cover-letter.mjs'], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 3. A file only UPSTREAM changed is not a local edit — no false alarm ──
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 0) {
    pass('a file changed only upstream raises no warning');
  } else {
    fail(`#3 expected [], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 4. A local fix upstream adopted independently is NOT reported ──
//    The #2337 reporter isolated exactly this: one of their two fixes survived
//    an update because upstream had picked it up. Byte-identical content means
//    the checkout costs nothing, so warning about it would be noise.
{
  const repo = makeRepo();
  upstreamChange(repo, 'generate-cover-letter.mjs', 'the same fix\n');
  writeFileSync(join(repo.dir, 'generate-cover-letter.mjs'), 'the same fix\n');
  repo.g('commit', '-qam', 'local fix, same content');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 0) {
    pass('a local fix upstream adopted independently is not reported');
  } else {
    fail(`#4 expected [], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 5. Only manifest paths are inspected — user-layer files never appear ──
{
  const repo = makeRepo();
  writeFileSync(join(repo.dir, 'cv.md'), 'my cv\n');
  repo.g('add', '-A');
  repo.g('commit', '-qm', 'user file');
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  writeFileSync(join(repo.dir, 'cv.md'), 'my edited cv\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (!atRisk.includes('cv.md')) {
    pass('a user-layer file outside the manifest is never listed');
  } else {
    fail(`#5 cv.md leaked into the system-file warning: ${JSON.stringify(atRisk)}`);
  }
}

// ── 6. Several local edits are all reported, sorted ──
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  upstreamChange(repo, 'modes/cover.md', 'shipped cover v2\n');
  writeFileSync(join(repo.dir, 'modes', 'pdf.md'), 'local pdf fix\n');
  writeFileSync(join(repo.dir, 'modes', 'cover.md'), 'local cover fix\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (JSON.stringify(atRisk) === JSON.stringify(['modes/cover.md', 'modes/pdf.md'])) {
    pass('every locally edited system file is reported, in a stable order');
  } else {
    fail(`#6 expected both modes files sorted, got ${JSON.stringify(atRisk)}`);
  }
}

// ── 7. An unreadable ref degrades the warning, never the update ──
{
  const repo = makeRepo();
  writeFileSync(join(repo.dir, 'modes', 'pdf.md'), 'local edit\n');

  let threw = false;
  let atRisk = null;
  try {
    atRisk = locallyModifiedSystemFiles(PATHS, 'no-such-ref', repo.ctx);
  } catch {
    threw = true;
  }
  if (!threw && Array.isArray(atRisk)) {
    pass('an unreadable upstream ref returns a list instead of throwing');
  } else {
    fail('#7 a bad ref must not throw — it would abort the whole update');
  }
}

// ── 7b. An untracked local file the upstream ref ships is at risk too ──
//    `git diff` never lists untracked files, so this one escaped the two diff
//    sets entirely and would have been overwritten with no warning and no .bak.
{
  const repo = makeRepo();
  // Ships upstream, absent from the install's baseline.
  repo.g('checkout', '-q', 'upstream');
  writeFileSync(join(repo.dir, 'modes', 'new-mode.md'), 'upstream new mode\n');
  repo.g('add', '-A');
  repo.g('commit', '-qm', 'upstream: new mode');
  repo.g('checkout', '-q', 'main');
  // The user wrote their own file at that exact path before updating.
  writeFileSync(join(repo.dir, 'modes', 'new-mode.md'), 'my own notes\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.includes('modes/new-mode.md')) {
    pass('an untracked local file the upstream ref ships is reported');
  } else {
    fail(`#7b expected modes/new-mode.md, got ${JSON.stringify(atRisk)}`);
  }
}

// ── 7c. An untracked file absent upstream is NOT reported ──
//    The checkout cannot touch it, so listing it would be pure noise.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  writeFileSync(join(repo.dir, 'modes', 'my-scratch.md'), 'purely local\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (!atRisk.includes('modes/my-scratch.md')) {
    pass('a purely local untracked file is left out of the warning');
  } else {
    fail(`#7c my-scratch.md should not be listed: ${JSON.stringify(atRisk)}`);
  }
}

// ── 8. The exclude pathspec keeps the local content, index included ──
//    This is the mechanism apply() uses instead of checking out and restoring:
//    a restore would leave the INDEX holding the upstream blob, so the scoped
//    commit would record exactly the content the user asked to keep out.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  upstreamChange(repo, 'modes/cover.md', 'shipped cover v2\n');
  writeFileSync(join(repo.dir, 'modes', 'cover.md'), 'local cover fix\n');
  repo.g('commit', '-qam', 'local fix');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  repo.g('checkout', 'upstream', '--', 'modes/', ...atRisk.map((f) => `:(exclude)${f}`));

  const cover = readFileSync(join(repo.dir, 'modes', 'cover.md'), 'utf-8');
  const pdf = readFileSync(join(repo.dir, 'modes', 'pdf.md'), 'utf-8');
  const staged = repo.g('diff', '--cached', '--name-only', 'HEAD').split('\n').filter(Boolean);
  if (cover === 'local cover fix\n' && pdf === 'shipped pdf v2\n' && !staged.includes('modes/cover.md')) {
    pass('the excluded file keeps its local content in the worktree AND the index');
  } else {
    fail(`#8 cover=${JSON.stringify(cover)} pdf=${JSON.stringify(pdf)} staged=${JSON.stringify(staged)}`);
  }
}

// ── 9. Exclusions that cancel the WHOLE pathspec make git fail ──
//    Why apply() skips such an entry outright instead of passing the excludes:
//    the resulting error is indistinguishable from a real checkout failure at
//    the call site, so it would abort the entire update over a file the user
//    asked to keep. Pinning git's behaviour here means a future git that stops
//    erroring — or a refactor that drops the skip — is caught.
{
  const repo = makeRepo();
  upstreamChange(repo, 'generate-cover-letter.mjs', 'upstream script v2\n');
  writeFileSync(join(repo.dir, 'generate-cover-letter.mjs'), 'local fix\n');
  repo.g('commit', '-qam', 'local fix');

  let errored = false;
  try {
    repo.g('checkout', 'upstream', '--', 'generate-cover-letter.mjs', ':(exclude)generate-cover-letter.mjs');
  } catch {
    errored = true;
  }
  const content = readFileSync(join(repo.dir, 'generate-cover-letter.mjs'), 'utf-8');
  if (errored && content === 'local fix\n') {
    pass('a fully-excluded pathspec errors — hence the skip in apply() (#2337)');
  } else {
    fail(`#9 errored=${errored} content=${JSON.stringify(content)}`);
  }
}

// ── 10. A system file the user DELETED locally is not "at risk" ──
//    `git diff --name-only` lists deletions, so a deleted file landed in BOTH
//    sets and therefore in atRisk. From there apply() preserved it — excluded
//    it from the checkout — so the file was never restored, `Keeping your
//    versions` named a file that does not exist, and the update exited 1. The
//    printed remedy ("run apply again") could not work, because re-running
//    reproduces the same state. A path that is not on disk cannot be
//    overwritten, so it is not at risk.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  rmSync(join(repo.dir, 'modes', 'cover.md'));

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (!atRisk.includes('modes/cover.md')) {
    pass('a locally deleted system file is not reported as at risk');
  } else {
    fail(`#10 deleted file still at risk: ${JSON.stringify(atRisk)}`);
  }
}

// ── 11. ...so the update RESTORES it ──
//    The property the suite never asserted (santifer's review): nothing pinned
//    that apply() brings back a system file the user deleted. Before the #2337
//    detector the raw checkout did it for free; the detector is what could take
//    it away, so the case belongs with the detector. Same shape as case 8: the
//    real checkout, driven by the real atRisk exclusions.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  rmSync(join(repo.dir, 'modes', 'cover.md'));
  // A genuine local edit alongside it — the deletion must not disturb it.
  writeFileSync(join(repo.dir, 'generate-cover-letter.mjs'), 'local linkedin fix\n');
  repo.g('commit', '-qam', 'local fix');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  repo.g('checkout', 'upstream', '--', 'modes/', ...atRisk.map((f) => `:(exclude)${f}`));

  const restored = existsSync(join(repo.dir, 'modes', 'cover.md'))
    && readFileSync(join(repo.dir, 'modes', 'cover.md'), 'utf-8') === 'shipped cover\n';
  const localEdit = readFileSync(join(repo.dir, 'generate-cover-letter.mjs'), 'utf-8');
  if (restored && localEdit === 'local linkedin fix\n') {
    pass('the update restores a deleted system file and still keeps a real local edit');
  } else {
    fail(`#11 restored=${restored} localEdit=${JSON.stringify(localEdit)} atRisk=${JSON.stringify(atRisk)}`);
  }
}

// ── 12. Guard: the existence filter must not swallow a real local edit ──
//    Case 10 removes entries from atRisk, so pin that it removes ONLY missing
//    ones — a modified file that still exists stays reported.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/cover.md', 'shipped cover v2\n');
  writeFileSync(join(repo.dir, 'modes', 'cover.md'), 'local cover fix\n');
  repo.g('commit', '-qam', 'local fix');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.includes('modes/cover.md')) {
    pass('a modified file that still exists is still reported');
  } else {
    fail(`#12 real local edit lost from atRisk: ${JSON.stringify(atRisk)}`);
  }
}

// ── 13. A file differing from the baseline ONLY by CRLF/LF is not a local edit ──
//    Reproduces #2817: installs synced before `.gitattributes` (80d104f9) have a
//    merge-base whose text blobs predate line-ending normalization, so an
//    untouched file reads as a local edit — inflating the flagged set to ~150
//    files and silently no-op'ing the whole update. The CR-only difference must
//    be ignored; a genuine content edit must still be reported.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-crlf-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  // Base blobs committed with CRLF, standing in for a pre-`.gitattributes` tree.
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'shipped pdf\r\nline two\r\n');
  writeFileSync(join(dir, 'generate-cover-letter.mjs'), 'shipped script\n');
  g('add', '-A');
  g('commit', '-qm', 'base (CRLF blobs)');
  g('branch', 'upstream');
  // Upstream changes the content of both files.
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'shipped pdf v2\r\nline two\r\n');
  writeFileSync(join(dir, 'generate-cover-letter.mjs'), 'shipped script v2\n');
  g('commit', '-qam', 'upstream changes');
  g('checkout', '-q', 'main');
  // main: pdf.md renormalized to LF (a CR-only diff from the base); the script
  // carries a genuine local edit.
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'shipped pdf\nline two\n');
  writeFileSync(join(dir, 'generate-cover-letter.mjs'), 'local real fix\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', { git: g, root: dir });
  if (atRisk.length === 1 && atRisk[0] === 'generate-cover-letter.mjs') {
    pass('a CRLF/LF-only difference from the baseline is not a local edit (#2817)');
  } else {
    fail(`#13 expected ['generate-cover-letter.mjs'], got ${JSON.stringify(atRisk)}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 14. The SECOND update: upstream's own last release is not a local edit ──
//    Every case above models an install at its FIRST update, where the
//    merge-base is still the commit the install was cloned at and therefore
//    still describes it. apply() never advances that merge-base: it installs
//    updates with a raw checkout plus an ordinary commit, neither of which
//    creates ancestry to the fetched commit. So from the second update on, the
//    baseline describes a state the install left behind, and every file
//    upstream changed in between reads as a local edit — preserved, backed up
//    to `.bak`, and never updated. `VERSION` is a system file too, so it is
//    preserved along with the rest and the run reports the version it just
//    failed to install (#3094).
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  replayUpdate(repo, '2');
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v3\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 0) {
    pass('content installed by a previous update is not a local edit (#3094)');
  } else {
    fail(`#14 expected [], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 15. ...and the fix must not cost us the warning it exists for ──
//    Case 14 removes files from atRisk, so pin that it removes ONLY the ones
//    upstream itself installed. A genuine local fix in a twice-updated install
//    is exactly the #2337 case, and it has to survive the second update too.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  replayUpdate(repo, '2');
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v3\n');
  writeFileSync(join(repo.dir, 'generate-cover-letter.mjs'), 'local linkedin fix\n');
  repo.g('commit', '-qam', 'local fix');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'generate-cover-letter.mjs') {
    pass('a real local fix is still reported after a second update (#2337)');
  } else {
    fail(`#15 expected ['generate-cover-letter.mjs'], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 16. History we cannot read degrades the warning, never the update ──
//    Same contract as case 7, one level down: the #3094 filter reads upstream
//    history, and a shallow clone does not have it. A history query that fails
//    must leave the detector reporting what it already knew rather than
//    throwing — a warning we cannot compute must never abort the checkout.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  writeFileSync(join(repo.dir, 'generate-cover-letter.mjs'), 'local linkedin fix\n');
  const blind = {
    root: repo.dir,
    git: (...args) => {
      if (args[0] === 'log') throw new Error('shallow clone: no history here');
      return repo.g(...args);
    },
  };

  let threw = false;
  let atRisk = null;
  try {
    atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', blind);
  } catch {
    threw = true;
  }
  if (!threw && Array.isArray(atRisk) && atRisk.includes('generate-cover-letter.mjs')) {
    pass('unreadable upstream history degrades the filter, not the update');
  } else {
    fail(`#16 threw=${threw} atRisk=${JSON.stringify(atRisk)}`);
  }
}

// ── 17. A deliberate revert to an older upstream version is a local edit ──
//    Case 14 filters out content a previous update installed. The bytes a user
//    checks back out themselves are also bytes upstream published, so a filter
//    that asks "did upstream ever ship this?" cannot tell the two apart and
//    drops the revert from atRisk — overwriting it with no warning and no
//    `.bak`, which is the protection #2337 exists for. Baselining on the last
//    installed snapshot separates them by origin instead: a revert made after
//    that snapshot sits between it and HEAD, so the diff still sees it (#3129).
//
//    Two updates are needed before the revert has anywhere to go: after a
//    single update the install still holds v2, so checking v2 back out changes
//    nothing and the case would pass without exercising anything.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  replayUpdate(repo, '2');
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v3\n');
  replayUpdate(repo, '3');
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v4\n');
  // The install is on v3 and prefers the v2 wording.
  writeFileSync(join(repo.dir, 'modes', 'pdf.md'), 'shipped pdf v2\n');
  repo.g('commit', '-qam', 'prefer the v2 wording of pdf.md');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'modes/pdf.md') {
    pass('a committed revert to an older upstream version is reported (#3129)');
  } else {
    fail(`#17 expected ['modes/pdf.md'], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 18. ...and uncommitted, which is the sharper edge ──
//    The detector diffs the worktree, so an uncommitted revert should be caught
//    the same way — and it matters more: there is no local commit to recover
//    the content from once the checkout overwrites it.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v2\n');
  replayUpdate(repo, '2');
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v3\n');
  replayUpdate(repo, '3');
  upstreamChange(repo, 'modes/pdf.md', 'shipped pdf v4\n');
  writeFileSync(join(repo.dir, 'modes', 'pdf.md'), 'shipped pdf v2\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'modes/pdf.md') {
    pass('an uncommitted revert to an older upstream version is reported too (#3129)');
  } else {
    fail(`#18 expected ['modes/pdf.md'], got ${JSON.stringify(atRisk)}`);
  }
}
