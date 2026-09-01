#!/usr/bin/env node
/**
 * upgrade-tests.mjs — dynamic upgrade regression harness (Layer 1: PR gate).
 *
 * Proves the commit under test can be upgraded TO from an old install
 * without touching user data. The old install's `apply` self-reexecs into
 * the target updater, so this exercises the PR's own migration code.
 *
 * Hermetic: a temp GIT_CONFIG_GLOBAL rewrites the canonical GitHub URL to a
 * local bare mirror whose `main` ref is forced to the commit under test.
 * `apply` is pure git (curl lives only in check()), verified by spike
 * 2026-07-17. Oracle is blob equality on a changed system file — never
 * VERSION (apply has no version gate; equal-VERSION content drift is normal).
 *
 * Usage:
 *   node upgrade-tests.mjs --pr-gate     # newest old tag -> HEAD, one leg per
 *                                        # dismiss-marker state (untracked/tracked)
 *   node upgrade-tests.mjs --canary      # planted user-file clobber must go RED
 *   node upgrade-tests.mjs --local-paths # a declared fork-local path survives (#2421)
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { seedFixture, loadExpectations } from './seed-fixture.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CANONICAL = 'https://github.com/career-ops-hq/career-ops.git';
// Tags cut before the move to career-ops-hq ship an updater that still
// fetches the old address; both must resolve to the local mirror or an
// upgrade-from-old-tag scenario silently reaches the real network.
const CANONICAL_LEGACY = 'https://github.com/santifer/career-ops.git';
const TAG_RE = /^career-ops-v(\d+)\.(\d+)\.(\d+)$/;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const semverKey = (t) => TAG_RE.exec(t).slice(1).map(Number);
export function releaseTags(cwd = ROOT) {
  return git(cwd, 'tag', '--list', 'career-ops-v*').split('\n').filter((t) => TAG_RE.test(t))
    .sort((a, b) => { const [x, y] = [semverKey(a), semverKey(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
}

// v1.18.0 is the user-data format boundary (via / Machine Summary / salary).
export function fixtureStateFor(tag) {
  const [maj, min] = semverKey(tag);
  return maj > 1 || min >= 18 ? 'state-v1.18' : 'state-v1.16';
}

function sha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

/** Bare mirror of this checkout with refs/heads/main forced to targetSha —
 *  the "fake GitHub" the old install fetches from. */
function buildMirror(work, targetSha) {
  const mirror = join(work, 'mirror.git');
  git(ROOT, 'clone', '--quiet', '--bare', ROOT, mirror);
  git(mirror, 'update-ref', 'refs/heads/main', targetSha);
  return mirror;
}

function writeGitConfig(work, mirror) {
  const cfg = join(work, 'gitconfig');
  const url = pathToFileURL(mirror).href;
  writeFileSync(cfg, `[user]\n\tname = upgrade-tests\n\temail = upgrade-tests@career-ops.test\n[url "${url}"]\n\tinsteadOf = ${CANONICAL}\n\tinsteadOf = ${CANONICAL_LEGACY}\n[safe]\n\tdirectory = *\n`);
  return cfg;
}

/** Environment for a subprocess that must see ONLY the temp gitconfig.
 *
 *  GIT_CONFIG_GLOBAL alone does not make the run hermetic, which the header
 *  comment above claims it does. Two other channels survive it: a system
 *  /etc/gitconfig (or the Git-for-Windows equivalent), and any inherited
 *  GIT_CONFIG_COUNT/GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n triple, which git
 *  applies at higher precedence than every config file. Either can rewrite a
 *  URL out from under the mirror, and the failure looks like a real regression
 *  rather than a poisoned harness. Close both. */
function hermeticEnv(cfg) {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: cfg,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '0',
  };
}

/** A system file whose blob differs between oldTag and target — the non-vacuity
 *  oracle. Restricted to files `apply` actually manages (SYSTEM_PATHS: an exact
 *  entry, or any file under a `dir/` prefix entry); a changed USER-layer or
 *  meta file would never be rewritten by apply, so its blob could never match
 *  the target and the leg would go spuriously RED. */
function pickOracle(mirror, oldTag, targetSha, systemPaths) {
  const changed = git(mirror, 'diff', '--name-only', `${oldTag}..${targetSha}`).split('\n').filter(Boolean);
  if (changed.includes('update-system.mjs')) return { oracle: 'update-system.mjs', changed };
  const managed = (f) => systemPaths.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));
  const candidate = changed.find((f) => {
    if (!managed(f)) return false;
    try { git(mirror, 'cat-file', '-e', `${targetSha}:${f}`); return true; } catch { return false; }
  });
  // No managed file changed. That is NOT a failure by itself: a web-only PR
  // (web/ is deliberately outside SYSTEM_PATHS) legitimately changes nothing
  // `apply` manages, so there is nothing to qualify. Returning null lets the
  // caller SKIP. Throwing here made the gate red for every web-only PR, which
  // on 11-ago blocked three at once — including the fix for a HIGH severity
  // advisory. "I cannot test this" and "this is broken" must not share an exit.
  //
  // The caller still fails loudly when ROOT files changed and none is managed:
  // that shape means the SYSTEM_PATHS read is probably wrong, which is exactly
  // what this oracle exists to catch.
  if (!candidate) return { oracle: null, changed };
  return { oracle: candidate, changed };
}

function isAncestor(cwd, tag, sha) {
  try { git(cwd, 'merge-base', '--is-ancestor', tag, sha); return true; } catch { return false; }
}

export function runLeg({ oldTag, targetSha, label = oldTag, mutateMirror = null, dismissMarker = 'untracked' }) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-leg-')));
  const failures = [];
  const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} [${label}] ${msg}`); if (!cond) failures.push(msg); };
  try {
    const mirror = buildMirror(work, targetSha);
    if (mutateMirror) targetSha = mutateMirror(mirror, work);
    const cfg = writeGitConfig(work, mirror);

    // The target's SYSTEM_PATHS — the set apply manages. Drives both the oracle
    // selection (a changed file apply actually rewrites) and the #1998-class
    // new-path assertion below. A refactor that renames the constant would make
    // the regex miss; fail loud rather than dereference null.
    const targetUpdater = git(mirror, 'show', `${targetSha}:update-system.mjs`);
    const sysMatch = targetUpdater.match(/const\s+SYSTEM_PATHS\s*=\s*\[([\s\S]*?)\];/);
    if (!sysMatch) throw new Error(`Could not locate SYSTEM_PATHS in the target's update-system.mjs (constant renamed?) — refusing to run a leg with no managed-path set`);
    const targetSystemPaths = Array.from(sysMatch[1].matchAll(/['"]([^'"]+)['"]/g), (m) => m[1]);

    const { oracle, changed } = pickOracle(mirror, oldTag, targetSha, targetSystemPaths);
    if (!oracle) {
      const rootChanged = changed.filter((f) => !f.includes('/'));
      if (rootChanged.length > 0) {
        throw new Error(`Root files changed (${rootChanged.join(', ')}) but none is in SYSTEM_PATHS — refusing to skip: the managed-path set may be wrong`);
      }
      console.log(`  SKIP [${label}] no SYSTEM_PATHS file changed between ${oldTag} and target (${changed.length} file(s) changed, all outside the managed set) — nothing to qualify`);
      return { failures: [], skipped: true };
    }
    const oracleBlob = git(mirror, 'rev-parse', `${targetSha}:${oracle}`);

    const install = join(work, 'install');
    git(ROOT, 'clone', '--quiet', '--branch', oldTag, ROOT, install);
    git(install, 'remote', 'set-url', 'origin', CANONICAL);
    const state = fixtureStateFor(oldTag);
    const { manifest } = seedFixture(install, { state });

    // Dismiss an update before applying one — the shape a user reaches by
    // running `update-system.mjs dismiss` and then `apply`. Both marker states
    // have to be exercised, because apply() branches on trackedness and each
    // branch fails differently:
    //
    //   'untracked' (every stock install) — the marker is gitignored, so
    //     staging it after apply() deletes it is a fatal unmatched pathspec and
    //     the update never commits. Without the guard, `apply exits 0` and the
    //     oracle-blob assertion below both go RED.
    //   'tracked' (legacy repos that committed it before it was gitignored) —
    //     the deletion MUST be staged, or the update commits without it and
    //     leaves an unstaged deletion behind. Nothing else in the suite covers
    //     this: dropping the push is invisible to the untracked leg, since that
    //     leg skips the push anyway.
    if (dismissMarker) {
      writeFileSync(join(install, '.update-dismissed'), new Date(0).toISOString());
      if (dismissMarker === 'tracked') {
        git(install, 'add', '-f', '--', '.update-dismissed');
        // Identity must be supplied inline, the way canary() does. Signing is
        // additionally disabled here, so a contributor's global commit.gpgsign
        // cannot break the fixture.
        // The isolated GIT_CONFIG_GLOBAL below is handed to apply() only, and
        // the upgrade CI job configures no author identity — so relying on
        // ambient config passes on a developer box and aborts the leg with
        // "Author identity unknown" on a clean runner, before apply() ever runs.
        git(install, '-c', 'user.name=upgrade-tests', '-c', 'user.email=upgrade-tests@career-ops.test',
          '-c', 'commit.gpgsign=false', 'commit', '-qm', 'legacy: track the dismiss marker');
      }
    }

    // New-path delta for the #1998-class assertion: concrete files in the
    // target's SYSTEM_PATHS that don't exist at the old tag but do at target.
    const newConcrete = targetSystemPaths.filter((p) => !p.endsWith('/'))
      .filter((p) => { try { git(mirror, 'cat-file', '-e', `${oldTag}:${p}`); return false; } catch { return true; } })
      .filter((p) => { try { git(mirror, 'cat-file', '-e', `${targetSha}:${p}`); return true; } catch { return false; } });

    let exitCode = 0, output = '';
    try {
      output = execFileSync(process.execPath, ['update-system.mjs', 'apply'], {
        cwd: install, encoding: 'utf-8', timeout: 300000,
        env: hermeticEnv(cfg),
      });
    } catch (e) { exitCode = e.status ?? 1; output = `${e.stdout ?? ''}${e.stderr ?? ''}`; }

    // Ordered assertions — user-layer manifest BEFORE any repo script runs
    // (doctor's autoCopy writes user-layer files).
    ok(exitCode === 0, `apply exits 0 (got ${exitCode})`);
    let installOracle = null;
    try { installOracle = git(install, 'rev-parse', `HEAD:${oracle}`); } catch { /* leave null */ }
    ok(installOracle === oracleBlob, `upgrade executed: ${oracle} blob matches target (non-vacuity oracle)`);
    if (dismissMarker) {
      // Both legs, because the on-disk check is the only one the untracked leg
      // can make: an untracked marker never appears in HEAD or in `git status`,
      // so a regression that left it sitting on disk — and re-suppressed every
      // later update check — would otherwise pass silently.
      ok(!existsSync(join(install, '.update-dismissed')),
        'dismiss marker removed from disk');
    }
    if (dismissMarker === 'tracked') {
      // The marker was committed before the upgrade, so apply() had to stage its
      // deletion for the update commit to carry it. Two independent oracles,
      // because dropping that push shows up in two places: the deletion is
      // missing from the commit, AND it is left behind as an unstaged worktree
      // deletion (the file is gone from disk but still in the index).
      let stillInHead = true;
      try { git(install, 'cat-file', '-e', 'HEAD:.update-dismissed'); } catch { stillInHead = false; }
      ok(!stillInHead, 'tracked dismiss marker: its deletion reached the update commit');

      const dirty = git(install, 'status', '--porcelain', '--', '.update-dismissed');
      ok(dirty === '', `tracked dismiss marker: no deletion left behind (git status: ${dirty || 'clean'})`);
    }
    for (const [f, hash] of Object.entries(manifest)) {
      const p = join(install, f);
      ok(existsSync(p) && sha256(p) === hash, `user file byte-identical: ${f}`);
    }
    for (const p of newConcrete) {
      ok(existsSync(join(install, p)), `new system path present after upgrade (#1998 class): ${p}`);
    }
    // Pinned consumption checks — harness-owned parsing, never the PR's scripts.
    // A missing/unreadable tracker or a header the era's format doesn't match is
    // itself a leg failure, not a harness crash — report it through ok() so the
    // gate goes cleanly RED with a diagnostic instead of throwing out of runLeg.
    const exp = loadExpectations(state);
    let tracker = null;
    try { tracker = readFileSync(join(install, 'data/applications.md'), 'utf-8'); } catch (e) { /* handled below */ void e; }
    ok(tracker !== null, 'tracker data/applications.md is readable after upgrade');
    if (tracker !== null) {
      const rows = tracker.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
      ok(rows.length === exp.tracker_rows, `tracker rows: ${rows.length} == ${exp.tracker_rows}`);
      // Status column position differs between eras (the Via column shifts it) —
      // derive it from the header row instead of scanning every cell, so a Notes
      // cell that happens to equal a status word can never false-positive.
      const headerLine = tracker.split('\n').find((l) => /^\|\s*#\s*\|/.test(l));
      ok(headerLine !== undefined, 'tracker has a parseable header row');
      const statusCol = headerLine ? headerLine.split('|').map((c) => c.trim()).indexOf('Status') : -1;
      ok(statusCol > 0, `tracker header has a Status column`);
      if (statusCol > 0) {
        for (const [status, count] of Object.entries(exp.status_counts)) {
          const n = rows.filter((r) => r.split('|').map((c) => c.trim())[statusCol] === status).length;
          ok(n === count, `tracker status ${status}: ${n} == ${count}`);
        }
      }
    }
    if (exp.salary_observations !== null) {
      let so = null;
      try { so = readFileSync(join(install, 'data/salary-observations.tsv'), 'utf-8'); } catch (e) { /* handled below */ void e; }
      ok(so !== null, 'salary-observations.tsv is readable after upgrade');
      if (so !== null) {
        const n = so.split('\n').filter(Boolean).length;
        ok(n === exp.salary_observations, `salary observations: ${n} == ${exp.salary_observations}`);
      }
    }
    // Secondary smoke only (runs the PR's own code — never the sole oracle).
    let doctorOk = false, doctorReason = '';
    try {
      const d = JSON.parse(execFileSync(process.execPath, ['doctor.mjs', '--json'], { cwd: install, encoding: 'utf-8', timeout: 60000 }));
      doctorOk = d.onboardingNeeded === false;
      if (!doctorOk) doctorReason = ` (onboardingNeeded=${JSON.stringify(d.onboardingNeeded)}, missing=${JSON.stringify(d.missing ?? [])})`;
    } catch (e) { doctorReason = ` (${String(e.stderr || e.message || e).split('\n')[0].slice(0, 160)})`; }
    ok(doctorOk, `doctor.mjs --json smoke: onboardingNeeded false${doctorReason}`);
    if (failures.length && output) {
      console.log(`  --- apply output tail [${label}] ---`);
      console.log(output.split('\n').slice(-15).join('\n'));
    }
    return { label, failures, output };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function newestAncestorTag(targetSha) {
  const tags = releaseTags().filter((t) => isAncestor(ROOT, t, targetSha));
  return tags.length ? tags[tags.length - 1] : null;
}

function prGate() {
  const targetSha = git(ROOT, 'rev-parse', 'HEAD');
  const newestOld = newestAncestorTag(targetSha);
  if (!newestOld) { console.error('No release tag is an ancestor of HEAD — fetch tags first (CI: fetch-depth: 0)'); process.exit(1); }
  console.log(`PR gate: ${newestOld} -> ${targetSha.slice(0, 8)}`);
  // Two legs, one per dismiss-marker state. apply() branches on trackedness and
  // each branch has its own failure mode, so a single leg leaves the other one
  // ungated — dropping the tracked-marker push is invisible to the untracked
  // leg, which skips that push anyway.
  const failures = [];
  let ranAny = false;
  for (const dismissMarker of ['untracked', 'tracked']) {
    const leg = runLeg({ oldTag: newestOld, targetSha, label: `${newestOld} dismiss=${dismissMarker}`, dismissMarker });
    failures.push(...leg.failures);
    if (!leg.skipped) ranAny = true;
  }
  // THREE states, never two (#2697): a skipped leg qualified nothing, so calling
  // it GREEN would report a pass that never ran. Decided on whether any leg
  // actually ran — both legs share one target so in practice they skip
  // together, but deriving it from `ranAny` keeps that an observation rather
  // than an assumption a later third leg could quietly break.
  console.log(!ranAny ? 'SKIPPED: nothing in the managed set changed — this leg qualified nothing'
    : failures.length ? `RED: ${failures.length} failure(s)` : 'GREEN');
  process.exit(failures.length ? 1 : 0);
}

/** Canary: plant a user-file clobber in the mirror; the harness MUST go red.
 *  Proves the gate is capable of failing — a gate never seen red proves nothing. */
function canary() {
  const targetSha = git(ROOT, 'rev-parse', 'HEAD');
  const newestOld = newestAncestorTag(targetSha);
  if (!newestOld) { console.error('No release tag is an ancestor of HEAD'); process.exit(1); }
  const { failures } = runLeg({
    oldTag: newestOld, targetSha, label: 'canary',
    mutateMirror: (mirror, work) => {
      // Poison commit: track cv.md and add it to SYSTEM_PATHS so the old
      // updater checks it out over the user's CV.
      const wt = join(work, 'poison-wt');
      git(mirror, 'worktree', 'add', wt, 'main');
      writeFileSync(join(wt, 'cv.md'), '# CLOBBERED BY UPDATE\n');
      const updater = readFileSync(join(wt, 'update-system.mjs'), 'utf-8')
        .replace(/const\s+SYSTEM_PATHS\s*=\s*\[/, "const SYSTEM_PATHS = [\n  'cv.md',");
      writeFileSync(join(wt, 'update-system.mjs'), updater);
      // -f: cv.md is gitignored (user layer) — the poison must force-track it.
      git(wt, 'add', '-f', 'cv.md', 'update-system.mjs');
      git(wt, '-c', 'user.name=canary', '-c', 'user.email=canary@test', 'commit', '-qm', 'canary: poison');
      const sha = git(wt, 'rev-parse', 'HEAD');
      git(mirror, 'worktree', 'remove', '--force', wt);
      git(mirror, 'update-ref', 'refs/heads/main', sha);
      return sha;
    },
  });
  const clobbered = failures.some((f) => f.startsWith('user file byte-identical: cv.md'));
  if (clobbered) { console.log('CANARY GREEN: harness detected the planted user-file clobber'); process.exit(0); }
  console.error('CANARY RED: planted clobber was NOT detected — the harness cannot fail; do not trust its green');
  process.exit(1);
}

/** Local-paths leg (#2421): a file a fork DECLARED as its own must not be
 *  silently overwritten when upstream later starts shipping a file at that
 *  same path.
 *
 *  Poisons the mirror so the target ships `run-nightly.ps1` AND lists it in
 *  SYSTEM_PATHS — the future in which upstream adopts a filename some fork is
 *  already using. The install declares that path in config/local-paths.txt,
 *  which is what a fork does today under this feature.
 *
 *  Expected: `localUserPaths()` refuses the entry (it now collides with
 *  SYSTEM_PATHS), apply fails closed rather than proceeding on a safety
 *  invariant it could not evaluate, reverts the system-layer writes, and the
 *  fork's own content is still on disk afterwards.
 *
 *  Note what this does NOT claim. Without #2421, the fork's file survives this
 *  scenario anyway: apply's existing local-modification handling keeps the
 *  user's version, writes a .bak, and prints "Keeping your versions". The
 *  difference the feature makes here is honesty, not rescue — an unevaluable
 *  declaration stops the update instead of letting it proceed while the user
 *  believes a protection is in force that was never read.
 *
 *  Non-vacuity: on a tree WITHOUT #2421 this leg goes red — nothing reads the
 *  declaration, so apply exits 0 and never mentions the declaration file. A leg
 *  that cannot fail on the unfixed tree proves nothing about the fixed one.
 */
function localPathsLeg() {
  const FORK_FILE = 'run-nightly.ps1';
  const baseSha = git(ROOT, 'rev-parse', 'HEAD');
  const oldTag = newestAncestorTag(baseSha);
  if (!oldTag) { console.error('No release tag is an ancestor of HEAD — fetch tags first (CI: fetch-depth: 0)'); process.exit(1); }

  const work = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-localpaths-')));
  const failures = [];
  const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} [local-paths] ${msg}`); if (!cond) failures.push(msg); };
  const commit = (cwd, msg) => git(cwd, '-c', 'user.name=upgrade-tests', '-c', 'user.email=upgrade-tests@career-ops.test', 'commit', '-qm', msg);

  try {
    const mirror = buildMirror(work, baseSha);

    // Poison: upstream adopts the fork's filename as a managed system file.
    const wt = join(work, 'poison-wt');
    git(mirror, 'worktree', 'add', wt, 'main');
    writeFileSync(join(wt, FORK_FILE), '# UPSTREAM VERSION — must never land on top of the fork\n');
    const updater = readFileSync(join(wt, 'update-system.mjs'), 'utf-8')
      .replace(/const\s+SYSTEM_PATHS\s*=\s*\[/, `const SYSTEM_PATHS = [\n  '${FORK_FILE}',`);
    if (!updater.includes(`'${FORK_FILE}',`)) throw new Error('Could not inject the poisoned SYSTEM_PATHS entry (constant renamed?)');
    writeFileSync(join(wt, 'update-system.mjs'), updater);
    git(wt, 'add', '-f', FORK_FILE, 'update-system.mjs');
    commit(wt, 'poison: upstream adopts a path a fork already owns');
    const targetSha = git(wt, 'rev-parse', 'HEAD');
    git(mirror, 'worktree', 'remove', '--force', wt);
    git(mirror, 'update-ref', 'refs/heads/main', targetSha);

    const cfg = writeGitConfig(work, mirror);
    const install = join(work, 'install');
    git(ROOT, 'clone', '--quiet', '--branch', oldTag, ROOT, install);
    git(install, 'remote', 'set-url', 'origin', CANONICAL);
    seedFixture(install, { state: fixtureStateFor(oldTag) });

    // The fork's own file, tracked (that is the point — it is version
    // controlled locally), plus the declaration that says it is theirs.
    const forkContent = '# fork-local nightly runner — no upstream counterpart\n';
    writeFileSync(join(install, FORK_FILE), forkContent);
    mkdirSync(join(install, 'config'), { recursive: true });
    writeFileSync(join(install, 'config', 'local-paths.txt'), `# mine, not upstream\n${FORK_FILE}\n`);
    git(install, 'add', '-f', FORK_FILE);
    commit(install, 'fork: local nightly runner');
    const before = sha256(join(install, FORK_FILE));

    let exitCode = 0, output = '';
    try {
      output = execFileSync(process.execPath, ['update-system.mjs', 'apply'], {
        cwd: install, encoding: 'utf-8', timeout: 300000,
        env: hermeticEnv(cfg),
      });
    } catch (e) { exitCode = e.status ?? 1; output = `${e.stdout ?? ''}${e.stderr ?? ''}`; }

    ok(exitCode !== 0, `apply fails closed on an unevaluable declaration instead of proceeding (exit ${exitCode})`);
    const survived = existsSync(join(install, FORK_FILE)) && sha256(join(install, FORK_FILE)) === before;
    ok(survived, `declared fork-local file is byte-identical after apply: ${FORK_FILE}`);
    // Names BOTH the declaration file and the offending entry. The declaration
    // file is the half that flips: a tree without #2421 never reads it, so it
    // can never appear in the output no matter how apply handles the path.
    ok(output.includes('config/local-paths.txt'), 'apply names the declaration file as the reason');
    ok(output.includes(FORK_FILE), `apply names the offending entry (${FORK_FILE})`);

    if (failures.length && output) {
      console.log('  --- apply output tail [local-paths] ---');
      console.log(output.split('\n').slice(-15).join('\n'));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(failures.length ? `RED: ${failures.length} failure(s)` : 'GREEN');
  process.exit(failures.length ? 1 : 0);
}

if (isMainModule(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === '--pr-gate') prGate();
  else if (mode === '--canary') canary();
  else if (mode === '--local-paths') localPathsLeg();
  else { console.error('Usage: node upgrade-tests.mjs --pr-gate | --canary | --local-paths'); process.exit(1); }
}
