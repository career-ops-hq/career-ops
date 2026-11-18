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
 *   node upgrade-tests.mjs --user-layer-refusal # a user-layer manifest entry is refused,
 *                                        # the update completes, rollback leaves it alone
 *   node upgrade-tests.mjs --failed-install # npm install fails: apply says so and exits 1,
 *                                        # rollback reinstalls the restored package.json
 *   node upgrade-tests.mjs --local-edit  # a system file this install changed is kept by
 *                                        # apply and replaced only by apply --force (#2337)
 *   node upgrade-tests.mjs --local-edit-canary # the same leg on an inverted --force
 *                                        # branch must go RED
 *   node upgrade-tests.mjs --fallback-batch-failure # a failed later fallback batch aborts
 *   node upgrade-tests.mjs --fallback-persistent-rewrite-blocker # the restore's own HEAD checkout is blocked too
 *                                        # the update and restores the earlier writes
 */
import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { seedFixture, loadExpectations } from './seed-fixture.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CANONICAL = 'https://github.com/career-ops-hq/career-ops.git';
// Tags cut before the move to career-ops-hq ship an updater that still
// fetches the old address; both must resolve to the local mirror or an
// upgrade-from-old-tag scenario silently reaches the real network.
const CANONICAL_LEGACY = 'https://github.com/santifer/career-ops.git';
const GITHUB_API_HOST = 'api.github.com';
// What apply() prints when its cross-check against the GitHub ref API gets no
// answer, so a leg can tell that the API stayed out of reach (see runLeg).
const REF_API_UNREACHED = 'could not reach the GitHub ref API';
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
// Every leg takes its old tag from newestAncestorTag(), which is past that
// boundary, so state-v1.18 is the only fixture any leg seeds. The pre-1.18
// state-v1.16 was removed (#6707): no leg seeded it, and its files did not
// match what a v1.16 install holds. An older tag fails loudly here rather
// than seeding a state from the wrong side of the boundary.
export function fixtureStateFor(tag) {
  const [maj, min] = semverKey(tag);
  if (maj > 1 || (maj === 1 && min >= 18)) return 'state-v1.18';
  throw new Error(`no upgrade fixture state for ${tag}: fixtures start at career-ops-v1.18.0`);
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
  // Read by curl through CURL_HOME (see hermeticEnv): sends api.github.com to a
  // closed local port, so the ref API cannot answer. Only that host, and only
  // curl: apply() also runs npm, which the leg needs and which curl config
  // never reaches.
  writeFileSync(join(work, '.curlrc'), `connect-to = "${GITHUB_API_HOST}:443:127.0.0.1:9"\n`);
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
    // Hermeticity is not only a git concern. #3845 made apply() resolve its
    // target through resolveTargetRef(), whose default 'release' channel
    // curls RELEASES_API. The redirects above rewrite git URLs onto the local
    // mirror and do nothing to a raw curl, so that call reaches the real
    // api.github.com and apply upgrades to whatever the live newest release
    // happens to be.
    //
    // Between releases that tag IS newestAncestorTag(), so the leg becomes a
    // no-op ("Update complete: vX → vX"), nothing is written, and the
    // non-vacuity oracle fails while naming whichever SYSTEM_PATHS file the PR
    // touched. The gate then reports a defect in unrelated changes, which is
    // the reading that costs the most time.
    //
    // The 'main' channel is what #2007 designed this harness around ("apply is
    // pure git (curl lives only in check()), so the whole flow runs
    // hermetically") and it is the only channel the mirror can actually serve.
    // Production behaviour is untouched: this pins the harness, not
    // resolveTargetRef().
    CAREER_OPS_UPDATE_CHANNEL: 'main',
    // The 'main' channel still curls. #3805 made apply() read main's SHA from
    // the GitHub ref API and refuse a target that does not descend from it.
    // The mirror's main is the commit under test, so once real main moves on
    // during a run (any merge elsewhere) the old install's apply() refuses the
    // PR with "does not descend from upstream main" and the gate goes RED on a
    // change that has nothing to do with it. That check is the old install's
    // own code, so no change to update-system.mjs can stop it here; only the
    // environment can. With the API unreachable, apply() prints its "could not
    // be cross-checked" note and goes on, which is the answer that is true of
    // a mirror: there is no upstream to compare the target with.
    CURL_HOME: dirname(cfg),
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

// Where a commit keeps its SYSTEM_PATHS: lib/update-manifest.mjs since #5554,
// update-system.mjs before it. Same rule as the updater's manifestSystemPathsAt.
const MANIFEST_MODULE = 'lib/update-manifest.mjs';
function manifestSourceAt(cwd, sha) {
  let file = MANIFEST_MODULE;
  try { git(cwd, 'cat-file', '-e', `${sha}:${file}`); } catch { file = 'update-system.mjs'; }
  return { file, source: git(cwd, 'show', `${sha}:${file}`) };
}

/** Prepend `entry` to the SYSTEM_PATHS in worktree `wt`; returns the file it edited. */
function injectManifestEntry(wt, entry) {
  const file = existsSync(join(wt, MANIFEST_MODULE)) ? MANIFEST_MODULE : 'update-system.mjs';
  const before = readFileSync(join(wt, file), 'utf-8');
  const after = before.replace(/((?:export\s+)?const\s+SYSTEM_PATHS\s*=\s*\[)/, `$1\n  '${entry}',`);
  if (after === before) throw new Error(`Could not inject the poisoned SYSTEM_PATHS entry into ${file} (constant renamed?)`);
  writeFileSync(join(wt, file), after);
  return file;
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
    const { file: manifestFile, source: targetManifest } = manifestSourceAt(mirror, targetSha);
    const sysMatch = targetManifest.match(/const\s+SYSTEM_PATHS\s*=\s*\[([\s\S]*?)\];/);
    if (!sysMatch) throw new Error(`Could not locate SYSTEM_PATHS in the target's ${manifestFile} (constant renamed?) — refusing to run a leg with no managed-path set`);
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

    // The updater that runs first and makes the cross-check is the old install's.
    const oldUpdater = git(mirror, 'show', `${oldTag}:update-system.mjs`);
    // The fixture is an explicit installation acceptance test, so pass the
    // same confirmation a user would provide after reviewing the preview.
    // spawnSync rather than execFileSync: the cross-check note below goes to
    // stderr, which execFileSync drops when the run succeeds.
    const run = spawnSync(process.execPath, ['update-system.mjs', 'apply', '--confirm'], {
      cwd: install, encoding: 'utf-8', timeout: 300000,
      env: { ...hermeticEnv(cfg), CAREER_OPS_UPDATE_CONFIRM: '1' },
    });
    const exitCode = run.status ?? 1;
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}`;

    // Ordered assertions — user-layer manifest BEFORE any repo script runs
    // (doctor's autoCopy writes user-layer files).
    ok(exitCode === 0, `apply exits 0 (got ${exitCode})`);
    // Proof that the ref API was out of reach, from an install whose apply()
    // asks it at all (#3805 onwards). If curl ever stops reading CURL_HOME, or
    // the API moves to another host, this fails on every run, instead of the
    // gate going RED only on the runs where main happened to move.
    if (oldUpdater.includes(REF_API_UNREACHED)) {
      ok(output.includes(REF_API_UNREACHED), `the GitHub ref API stayed out of reach (apply printed "${REF_API_UNREACHED}")`);
    }
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
  const { failures, output } = runLeg({
    oldTag: newestOld, targetSha, label: 'canary',
    mutateMirror: (mirror, work) => {
      // Poison only the throwaway target updater: after its own safety checks
      // and coherent-install verification have passed, write a sentinel over
      // the user's CV. This keeps the canary independent of manifest policy —
      // including when the old release already validates target manifests —
      // and asks whether the harness's byte-integrity oracle catches a clobber.
      const wt = join(work, 'poison-wt');
      git(mirror, 'worktree', 'add', wt, 'main');
      const completion = "    console.log(`\\nUpdate complete: v${local} → v${remote}`);";
      const updater = readFileSync(join(wt, 'update-system.mjs'), 'utf-8')
        .replace(
          completion,
          `    writeFileSync(join(ROOT, 'cv.md'), '# CLOBBERED BY UPDATE\\n');\n${completion}`,
        );
      if (updater === readFileSync(join(wt, 'update-system.mjs'), 'utf-8')) {
        throw new Error('Could not inject the canary user-file clobber');
      }
      writeFileSync(join(wt, 'update-system.mjs'), updater);
      git(wt, 'add', 'update-system.mjs');
      git(wt, '-c', 'user.name=canary', '-c', 'user.email=canary@test', 'commit', '-qm', 'canary: poison');
      const sha = git(wt, 'rev-parse', 'HEAD');
      git(mirror, 'worktree', 'remove', '--force', wt);
      git(mirror, 'update-ref', 'refs/heads/main', sha);
      return sha;
    },
  });
  const clobbered = failures.some((f) => f.startsWith('user file byte-identical: cv.md'));
  const refused = /Refused \d+ manifest entry\(ies\) naming the user layer:[\s\S]*\bcv\.md\b/.test(output || '');
  if (clobbered || refused) {
    console.log(clobbered
      ? 'CANARY GREEN: harness detected the planted user-file clobber'
      : 'CANARY GREEN: updater refused the planted user-layer manifest entry');
    process.exit(0);
  }
  console.error('CANARY RED: planted clobber was neither refused nor detected — do not trust this gate');
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
    const manifestFile = injectManifestEntry(wt, FORK_FILE);
    git(wt, 'add', '-f', FORK_FILE, manifestFile);
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
      output = execFileSync(process.execPath, ['update-system.mjs', 'apply', '--confirm'], {
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

/** User-layer refusal leg (#3782): a target manifest entry naming the user
 *  layer is refused entry by entry, never by aborting the update.
 *
 *  Poisons the mirror so the target ships `cv.md` AND lists it in SYSTEM_PATHS.
 *
 *  Expected: apply refuses that one entry out loud, completes the rest of the
 *  update, and leaves the user's CV byte-identical. A rollback of that update
 *  then leaves the same path alone too.
 *
 *  Non-vacuity: with a user-layer abort in front of the self-bootstrap
 *  checkout, apply exits non-zero here and nothing is updated.
 */
function userLayerRefusalLeg() {
  const USER_FILE = 'cv.md';
  const ENV_FILE = '.env';
  const baseSha = git(ROOT, 'rev-parse', 'HEAD');
  const oldTag = newestAncestorTag(baseSha);
  if (!oldTag) { console.error('No release tag is an ancestor of HEAD — fetch tags first (CI: fetch-depth: 0)'); process.exit(1); }

  const work = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-userlayer-')));
  const failures = [];
  const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} [user-layer-refusal] ${msg}`); if (!cond) failures.push(msg); };
  const run = (cwd, cfg, ...args) => {
    try {
      return { exitCode: 0, output: execFileSync(process.execPath, ['update-system.mjs', ...args], {
        cwd, encoding: 'utf-8', timeout: 300000, env: hermeticEnv(cfg), stdio: ['ignore', 'pipe', 'pipe'],
      }) };
    } catch (e) { return { exitCode: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
  };

  try {
    const mirror = buildMirror(work, baseSha);

    // Poison: upstream's manifest claims the user's CV and ships one.
    const wt = join(work, 'poison-wt');
    git(mirror, 'worktree', 'add', wt, 'main');
    writeFileSync(join(wt, USER_FILE), '# UPSTREAM VERSION — must never land on top of the user\n');
    const manifestFile = injectManifestEntry(wt, USER_FILE);
    // Same poison for .env: newly protected by this change, so the leg pins
    // its byte-identity through apply and rollback, not just cv.md's.
    writeFileSync(join(wt, ENV_FILE), 'UPSTREAM_SECRET=must-never-land\n');
    injectManifestEntry(wt, ENV_FILE);
    git(wt, 'add', '-f', USER_FILE, ENV_FILE, manifestFile);
    git(wt, '-c', 'user.name=upgrade-tests', '-c', 'user.email=upgrade-tests@career-ops.test', 'commit', '-qm', 'poison: manifest names the user layer');
    const targetSha = git(wt, 'rev-parse', 'HEAD');
    git(mirror, 'worktree', 'remove', '--force', wt);
    git(mirror, 'update-ref', 'refs/heads/main', targetSha);

    const cfg = writeGitConfig(work, mirror);
    const install = join(work, 'install');
    git(ROOT, 'clone', '--quiet', '--branch', oldTag, ROOT, install);
    git(install, 'remote', 'set-url', 'origin', CANONICAL);
    seedFixture(install, { state: fixtureStateFor(oldTag) });
    const userContent = '# my CV — no upstream counterpart\n';
    writeFileSync(join(install, USER_FILE), userContent);
    const before = sha256(join(install, USER_FILE));
    const intact = () => existsSync(join(install, USER_FILE)) && sha256(join(install, USER_FILE)) === before;
    const envContent = 'API_KEY=user-own-secret\n';
    writeFileSync(join(install, ENV_FILE), envContent);
    const envBefore = sha256(join(install, ENV_FILE));
    const envIntact = () => existsSync(join(install, ENV_FILE)) && sha256(join(install, ENV_FILE)) === envBefore;

    const applied = run(install, cfg, 'apply', '--confirm');
    ok(applied.exitCode === 0, `apply completes despite the user-layer manifest entry (exit ${applied.exitCode})`);
    ok(
      new RegExp(`Refused \\d+ manifest entry\\(ies\\) naming the user layer:[\\s\\S]*\\b${USER_FILE.replace('.', '\\.')}\\b`).test(applied.output),
      `apply refuses the entry out loud (${USER_FILE})`,
    );
    ok(
      applied.output.split('\n').some((line) => line.trim() === ENV_FILE),
      `apply refuses the entry out loud (${ENV_FILE})`,
    );
    ok(applied.output.includes('Update complete'), 'apply reports the update as complete');
    ok(
      git(install, 'rev-parse', 'HEAD:update-system.mjs') === git(mirror, 'rev-parse', `${targetSha}:update-system.mjs`),
      'the rest of the update landed (updater matches the target)',
    );
    ok(intact(), `user file is byte-identical after apply: ${USER_FILE}`);
    ok(envIntact(), `user file is byte-identical after apply: ${ENV_FILE}`);

    const rolledBack = run(install, cfg, 'rollback');
    ok(rolledBack.exitCode === 0, `rollback of that update succeeds (exit ${rolledBack.exitCode})`);
    ok(rolledBack.output.includes('Rollback complete'), 'rollback reports completion');
    ok(intact(), `user file is byte-identical after rollback: ${USER_FILE}`);
    ok(envIntact(), `user file is byte-identical after rollback: ${ENV_FILE}`);
    ok(
      git(install, 'status', '--porcelain', '--', USER_FILE).startsWith('??') || git(install, 'status', '--porcelain', '--', USER_FILE) === '',
      `rollback neither staged nor committed ${USER_FILE}`,
    );

    if (failures.length) {
      for (const [name, result] of [['apply', applied], ['rollback', rolledBack]]) {
        console.log(`  --- ${name} output tail [user-layer-refusal] ---`);
        console.log(result.output.split('\n').slice(-20).join('\n'));
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(failures.length ? `RED: ${failures.length} failure(s)` : 'GREEN');
  process.exit(failures.length ? 1 : 0);
}

/** `npm` and `npx` stand-ins on PATH. npm copies the package.json it ran
 *  against into `saw`, then fails with an npm-style error when `npmFails`. */
function writeNpmStubs(stubDir, { npmFails }) {
  mkdirSync(stubDir, { recursive: true });
  const saw = join(stubDir, 'npm-saw-package.json');
  writeFileSync(join(stubDir, 'npm'), [
    '#!/bin/sh',
    `cp package.json "${saw}"`,
    ...(npmFails ? ['echo "npm error code ENOTFOUND" >&2', 'exit 1'] : []),
    '',
  ].join('\n'));
  writeFileSync(join(stubDir, 'npm.cmd'), [
    `@copy /y package.json "${saw}" >nul`,
    ...(npmFails ? ['@echo npm error code ENOTFOUND 1>&2', '@exit /b 1'] : []),
    '',
  ].join('\r\n'));
  writeFileSync(join(stubDir, 'npx'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(stubDir, 'npx.cmd'), '@exit /b 0\r\n');
  chmodSync(join(stubDir, 'npm'), 0o755);
  chmodSync(join(stubDir, 'npx'), 0o755);
  return { saw };
}

/** Failed-install leg: a real apply whose `npm install` fails, then a rollback.
 *
 *  `npm` is shadowed on PATH by a stub that exits 1, so this needs no network
 *  failure to arrange. The old install's apply re-execs into the commit under
 *  test, which is the code that runs npm.
 *
 *  Expected: the update lands, but apply exits non-zero and says npm install
 *  failed instead of "Update complete", and user files stay byte-identical.
 *  A rollback with a working npm then runs it against the restored
 *  package.json, so node_modules ends up matching the version rolled back to.
 *
 *  Non-vacuity: before this leg existed, apply printed "npm install skipped
 *  (may need manual run)", then "Update complete", and exited 0; rollback never
 *  ran npm at all.
 */
function failedInstallLeg() {
  const targetSha = git(ROOT, 'rev-parse', 'HEAD');
  const oldTag = newestAncestorTag(targetSha);
  if (!oldTag) { console.error('No release tag is an ancestor of HEAD — fetch tags first (CI: fetch-depth: 0)'); process.exit(1); }

  const work = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-failedinstall-')));
  const failures = [];
  const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} [failed-install] ${msg}`); if (!cond) failures.push(msg); };
  const run = (cwd, env, ...args) => {
    const result = spawnSync(process.execPath, ['update-system.mjs', ...args], {
      cwd, encoding: 'utf-8', timeout: 300000, env,
    });
    return { exitCode: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}` };
  };
  const withStubs = (env, stubDir) => {
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
    return { ...env, [pathKey]: `${stubDir}${delimiter}${env[pathKey] ?? ''}` };
  };

  let applied = null;
  let rolledBack = null;
  try {
    const mirror = buildMirror(work, targetSha);
    const cfg = writeGitConfig(work, mirror);
    const install = join(work, 'install');
    git(ROOT, 'clone', '--quiet', '--branch', oldTag, ROOT, install);
    git(install, 'remote', 'set-url', 'origin', CANONICAL);
    const { manifest } = seedFixture(install, { state: fixtureStateFor(oldTag) });
    const packageBefore = readFileSync(join(install, 'package.json'), 'utf-8');

    const failing = join(work, 'stubs-failing');
    writeNpmStubs(failing, { npmFails: true });
    applied = run(install, withStubs({ ...hermeticEnv(cfg), CAREER_OPS_UPDATE_CONFIRM: '1' }, failing), 'apply', '--confirm');
    ok(applied.exitCode !== 0, `apply exits non-zero when npm install fails (got ${applied.exitCode})`);
    ok(applied.output.includes('npm install failed: npm error code ENOTFOUND'), "apply reports npm's own error");
    ok(!applied.output.includes('Update complete'), 'apply does not print "Update complete"');
    ok(applied.output.includes('Run `npm install`'), 'apply tells the user what to run');
    ok(
      git(install, 'rev-parse', 'HEAD:update-system.mjs') === git(mirror, 'rev-parse', `${targetSha}:update-system.mjs`),
      'the update itself landed (updater matches the target)',
    );
    for (const [f, hash] of Object.entries(manifest)) {
      const p = join(install, f);
      ok(existsSync(p) && sha256(p) === hash, `user file byte-identical: ${f}`);
    }

    const working = join(work, 'stubs-working');
    const { saw } = writeNpmStubs(working, { npmFails: false });
    rolledBack = run(install, withStubs(hermeticEnv(cfg), working), 'rollback');
    ok(rolledBack.exitCode === 0, `rollback succeeds (exit ${rolledBack.exitCode})`);
    ok(rolledBack.output.includes('Rollback complete'), 'rollback reports completion');
    ok(readFileSync(join(install, 'package.json'), 'utf-8') === packageBefore, 'rollback restored package.json');
    ok(existsSync(saw) && readFileSync(saw, 'utf-8') === packageBefore,
      'rollback ran npm install against the restored package.json');
  } finally {
    if (failures.length) {
      for (const [name, result] of [['apply', applied], ['rollback', rolledBack]]) {
        if (!result) continue;
        console.log(`  --- ${name} output tail [failed-install] ---`);
        console.log(result.output.split('\n').slice(-20).join('\n'));
      }
    }
    rmSync(work, { recursive: true, force: true });
  }

  console.log(failures.length ? `RED: ${failures.length} failure(s)` : 'GREEN');
  process.exit(failures.length ? 1 : 0);
}

/** Local-edit leg (#2337, #5759): a system file this install changed itself is
 *  kept by a real `apply`, and overwritten only under `--force`.
 *
 *  Until this leg, the decision inside apply() was checked by a regex over its
 *  source that matched the inverted branch just as well, and no leg committed
 *  a local edit before applying, so the keep/overwrite path never ran in CI.
 *
 *  The mirror gets one commit on top of the commit under test that changes
 *  EDITED, so upstream moves the file too and the local edit is really at risk.
 *  Two fresh installs at the old tag commit the same local fix to EDITED; one
 *  runs `apply --confirm`, the other `apply --force --confirm`.
 *
 *  Expected: the plain apply keeps the local file byte for byte, writes a .bak
 *  of it and names the file as kept; the forced apply lands the target's blob,
 *  leaves the local fix in the .bak and says it overwrote. Both exit 0.
 *
 *  Non-vacuity: `--local-edit-canary` inverts the `if (updateForce)` branch in
 *  the target's updater and must see this leg go RED. A leg never seen red
 *  proves nothing.
 */
const LOCAL_EDIT_FILE = 'modes/README.md';
const FORCE_BRANCH = "      if (updateForce) {\n        console.log('--force: overwriting them with the upstream version.');";

function localEditLeg({ invertForce = false } = {}) {
  const label = invertForce ? 'local-edit-canary' : 'local-edit';
  const baseSha = git(ROOT, 'rev-parse', 'HEAD');
  const oldTag = newestAncestorTag(baseSha);
  if (!oldTag) { console.error('No release tag is an ancestor of HEAD — fetch tags first (CI: fetch-depth: 0)'); process.exit(1); }

  const work = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-localedit-')));
  const failures = [];
  const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} [${label}] ${msg}`); if (!cond) failures.push(msg); };
  const commit = (cwd, msg) => git(cwd, '-c', 'user.name=upgrade-tests', '-c', 'user.email=upgrade-tests@career-ops.test',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', msg);
  const outputs = [];

  try {
    const mirror = buildMirror(work, baseSha);
    try { git(mirror, 'cat-file', '-e', `${oldTag}:${LOCAL_EDIT_FILE}`); } catch {
      throw new Error(`${LOCAL_EDIT_FILE} is not in ${oldTag} — pick another system file for this leg`);
    }

    // Upstream changes the same file, so the target's blob differs from both
    // the old tag's and the local fix.
    const wt = join(work, 'upstream-wt');
    git(mirror, 'worktree', 'add', wt, 'main');
    writeFileSync(join(wt, LOCAL_EDIT_FILE), `${readFileSync(join(wt, LOCAL_EDIT_FILE), 'utf-8')}\n<!-- upstream change (upgrade-tests --local-edit) -->\n`);
    git(wt, 'add', LOCAL_EDIT_FILE);
    if (invertForce) {
      const updater = readFileSync(join(wt, 'update-system.mjs'), 'utf-8');
      if (!updater.includes(FORCE_BRANCH)) throw new Error('Could not find the --force branch to invert (apply() changed?) — update FORCE_BRANCH');
      writeFileSync(join(wt, 'update-system.mjs'), updater.replace(FORCE_BRANCH, FORCE_BRANCH.replace('if (updateForce)', 'if (!updateForce)')));
      git(wt, 'add', 'update-system.mjs');
    }
    commit(wt, invertForce ? 'canary: upstream edit + inverted --force branch' : 'upstream: change a file this install also changed');
    const targetSha = git(wt, 'rev-parse', 'HEAD');
    git(mirror, 'worktree', 'remove', '--force', wt);
    git(mirror, 'update-ref', 'refs/heads/main', targetSha);
    const targetBlob = git(mirror, 'rev-parse', `${targetSha}:${LOCAL_EDIT_FILE}`);
    const cfg = writeGitConfig(work, mirror);

    for (const force of [false, true]) {
      const mode = force ? 'apply --force' : 'apply';
      const install = join(work, force ? 'install-force' : 'install-keep');
      git(ROOT, 'clone', '--quiet', '--branch', oldTag, ROOT, install);
      git(install, 'remote', 'set-url', 'origin', CANONICAL);
      const { manifest } = seedFixture(install, { state: fixtureStateFor(oldTag) });

      // The install's own fix, committed the way a user versions it.
      const edited = join(install, LOCAL_EDIT_FILE);
      writeFileSync(edited, `${readFileSync(edited, 'utf-8')}\n<!-- local fix: this install's own change -->\n`);
      git(install, 'add', LOCAL_EDIT_FILE);
      commit(install, 'local: fix a system file');
      const localContent = readFileSync(edited, 'utf-8');

      const run = spawnSync(process.execPath, ['update-system.mjs', 'apply', ...(force ? ['--force'] : []), '--confirm'], {
        cwd: install, encoding: 'utf-8', timeout: 300000,
        env: { ...hermeticEnv(cfg), CAREER_OPS_UPDATE_CONFIRM: '1' },
      });
      const exitCode = run.status ?? 1;
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}`;
      outputs.push([mode, output]);

      ok(exitCode === 0, `${mode} exits 0 (got ${exitCode})`);
      ok(output.includes(`${LOCAL_EDIT_FILE}  (local copy saved: ${LOCAL_EDIT_FILE}.bak)`),
        `${mode} lists ${LOCAL_EDIT_FILE} as changed by this install`);
      const bak = `${edited}.bak`;
      ok(existsSync(bak) && readFileSync(bak, 'utf-8') === localContent, `${mode} leaves the local fix in ${LOCAL_EDIT_FILE}.bak`);
      const onDisk = existsSync(edited) ? readFileSync(edited, 'utf-8') : null;
      if (force) {
        ok(onDisk !== null && git(install, 'hash-object', LOCAL_EDIT_FILE) === targetBlob,
          `${mode} replaces the local fix with the target's ${LOCAL_EDIT_FILE}`);
        ok(output.includes('--force: overwriting them with the upstream version.'), `${mode} says it overwrote`);
      } else {
        ok(onDisk === localContent, `${mode} keeps the local fix byte-identical`);
        ok(output.includes('Keeping your versions.'), `${mode} says it kept the local version`);
      }
      // The rest of the update lands either way.
      ok(git(install, 'rev-parse', 'HEAD:update-system.mjs') === git(mirror, 'rev-parse', `${targetSha}:update-system.mjs`),
        `${mode}: the rest of the update landed (updater matches the target)`);
      for (const [f, hash] of Object.entries(manifest)) {
        const p = join(install, f);
        ok(existsSync(p) && sha256(p) === hash, `${mode}: user file byte-identical: ${f}`);
      }
    }
  } finally {
    if (failures.length && !invertForce) {
      for (const [mode, output] of outputs) {
        console.log(`  --- ${mode} output tail [${label}] ---`);
        console.log(output.split('\n').slice(-20).join('\n'));
      }
    }
    rmSync(work, { recursive: true, force: true });
  }
  return failures;
}

function localEdit() {
  const failures = localEditLeg();
  console.log(failures.length ? `RED: ${failures.length} failure(s)` : 'GREEN');
  process.exit(failures.length ? 1 : 0);
}

/** The local-edit leg against a target whose `if (updateForce)` is inverted:
 *  the plain apply then overwrites the local fix, the forced apply keeps it,
 *  and exactly those four assertions MUST fail. Any other failure (setup, the
 *  backup, the rest of the update, a user file) is not the flip being caught,
 *  so it turns the canary red instead of passing for it. */
const LOCAL_EDIT_CANARY_FAILURES = [
  'apply keeps the local fix byte-identical',
  'apply says it kept the local version',
  `apply --force replaces the local fix with the target's ${LOCAL_EDIT_FILE}`,
  'apply --force says it overwrote',
];

function localEditCanary() {
  const failures = localEditLeg({ invertForce: true });
  const expected = new Set(LOCAL_EDIT_CANARY_FAILURES);
  const missing = LOCAL_EDIT_CANARY_FAILURES.filter((f) => !failures.includes(f));
  const unexpected = failures.filter((f) => !expected.has(f));
  if (missing.length === 0 && unexpected.length === 0 && failures.length === expected.size) {
    console.log('CANARY GREEN: the local-edit leg caught the inverted --force branch, and failed nothing else');
    process.exit(0);
  }
  console.error('CANARY RED: the local-edit leg did not fail exactly as the inverted --force branch should — do not trust that leg');
  if (missing.length) console.error(`  expected to fail but passed: ${missing.join('; ')}`);
  if (unexpected.length) console.error(`  failed but not expected to: ${unexpected.join('; ')}`);
  if (failures.length !== new Set(failures).size) console.error(`  an assertion failed more than once: ${failures.join('; ')}`);
  process.exit(1);
}


/** Fallback batch-failure leg (#3825 review): when the checkout of a long
 *  directory expansion fails in a LATER batch, apply must abort the update,
 *  restore what the earlier batches wrote, and leave the preserved file and
 *  the user layer byte-identical.
 *
 *  Why this exists: fallbackCheckoutBatched() splits a long expansion into
 *  argv-budgeted git runs, and the helper-level fault test only proves the
 *  helper THROWS after an earlier batch wrote. The caller contract - apply's
 *  per-path catch restoring partial batches - is what this leg exercises with
 *  a real apply against a real install.
 *
 *  Poison: the target's manifest claims gen-output/, where it ships ~300
 *  new files under generated/ (enough that the literal expansion cannot
 *  ride on one ARGV_BUDGET git call) plus zz-block.md, which sorts after
 *  them. The install carries gen-output/generated/.gitkeep, a file upstream
 *  does not ship: it makes the generated/ directory exist and writable, and
 *  as a locally added file it lands in preservedPaths, which is what forces
 *  the literal directory expansion in the first place. gen-output/ itself
 *  is then made unwritable: CREATING zz-block.md fails in the second batch,
 *  while the first batch's writes inside generated/ succeed.
 *
 *  Why a brand-new directory: the blocker must be a CREATE, not a rewrite.
 *  A blocked rewrite of an existing file (say under modes/pdf/, where
 *  .gitattributes renormalization rewrites even content-identical files)
 *  dirties its index entry, and the restore's own `git checkout HEAD --`
 *  then hits the same unwritable directory and stops before removing the
 *  earlier batches' additions - a real finding about persistent blockers,
 *  kept out of this leg's scope. A blocked CREATE leaves nothing behind:
 *  the restore skips the HEAD checkout entirely (HEAD holds only the
 *  excluded .gitkeep) and removes the earlier batches' additions, which is
 *  the caller contract this leg measures. (Blocking lib/ would trip the
 *  updater's self-bootstrap long before the system-path checkout.) The same
 *  blocker fails the batched run (which also expands the directory
 *  literally) and then the fallback's second batch. The writes the restore
 *  then has to cover can come from EITHER of those runs - the batched run's
 *  own first batch lands before it fails, and the fallback's first batch
 *  lands before it fails - so the assertions below measure the combined
 *  end state (every one of the 300 additions gone from worktree AND index),
 *  not which run wrote what; the per-run split is only in the apply log.
 *
 *  Scope: on POSIX the pre-batching single-call fallback dies at the same
 *  blocker inside one git call and the same caller catch restores, so this
 *  leg qualifies the caller contract on the tree under test and is a
 *  regression guard for it; it does not by itself discriminate the batching
 *  change on this platform (the argv-size failure it prevents needs a
 *  command-line limit this runner does not have). On a platform whose chmod
 *  cannot make a directory unwritable the leg SKIPs rather than running
 *  vacuously green.
 */
function fallbackBatchFailureLeg() {
  const DIR = 'gen-output/';
  const GENERATED = 300;
  const BLOCKER = 'gen-output/zz-block.md';
  const KEEP = 'gen-output/generated/.gitkeep';
  const USER_FILE = 'cv.md';
  const baseSha = git(ROOT, 'rev-parse', 'HEAD');
  const oldTag = newestAncestorTag(baseSha);
  if (!oldTag) { console.error('No release tag is an ancestor of HEAD - fetch tags first (CI: fetch-depth: 0)'); process.exit(1); }

  const work = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-fallbackbatch-')));
  const failures = [];
  const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} [fallback-batch-failure] ${msg}`); if (!cond) failures.push(msg); };
  const commit = (cwd, msg) => git(cwd, '-c', 'user.name=upgrade-tests', '-c', 'user.email=upgrade-tests@career-ops.test', 'commit', '-qm', msg);
  const moduleName = (i) => `module-${String(i).padStart(4, '0')}.mjs`;

  try {
    const mirror = buildMirror(work, baseSha);

    // Poison: the target ships the long generated directory and moves the
    // file the blocker protects.
    const wt = join(work, 'poison-wt');
    git(mirror, 'worktree', 'add', wt, 'main');
    mkdirSync(join(wt, 'gen-output', 'generated'), { recursive: true });
    for (let i = 0; i < GENERATED; i++) writeFileSync(join(wt, 'gen-output', 'generated', moduleName(i)), `// UPSTREAM v2 module ${i}\n`);
    writeFileSync(join(wt, BLOCKER), '# UPSTREAM v2 - only the target ships this file\n');
    const manifestFile = injectManifestEntry(wt, DIR);
    git(wt, 'add', '-f', 'gen-output', manifestFile);
    commit(wt, 'poison: claim a long gen-output/ expansion');
    const targetSha = git(wt, 'rev-parse', 'HEAD');
    git(mirror, 'worktree', 'remove', '--force', wt);
    git(mirror, 'update-ref', 'refs/heads/main', targetSha);

    const cfg = writeGitConfig(work, mirror);
    const install = join(work, 'install');
    git(ROOT, 'clone', '--quiet', '--branch', oldTag, ROOT, install);
    git(install, 'remote', 'set-url', 'origin', CANONICAL);
    seedFixture(install, { state: fixtureStateFor(oldTag) });

    // The .gitkeep: pre-creates the writable generated/ directory and is the
    // locally added (hence preserved) file that forces the expansion. Plus a
    // user-layer sentinel.
    mkdirSync(join(install, 'gen-output', 'generated'), { recursive: true });
    writeFileSync(join(install, KEEP), '# generated output lives here\n');
    writeFileSync(join(install, USER_FILE), '# my CV - no upstream counterpart\n');
    git(install, 'add', '-f', KEEP);
    commit(install, 'fork: keep the generated output directory');
    const keepBefore = sha256(join(install, KEEP));
    const cvBefore = sha256(join(install, USER_FILE));

    // The blocker: gen-output/ cannot gain or lose entries, so creating
    // zz-block.md fails, while generated/ (its own directory) stays
    // writable. Verified empirically: `git --literal-pathspecs checkout
    // <tree> -- gen-output/zz-block.md` dies with "unable to create file
    // 'gen-output/zz-block.md': Permission denied".
    const blockDir = join(install, 'gen-output');
    chmodSync(blockDir, 0o555);
    // Platform probe: if this filesystem still lets the owner create a file
    // here, the blocker blocks nothing and the leg would run vacuously.
    let blocked = false;
    try { writeFileSync(join(blockDir, '.chmod-probe'), 'x'); rmSync(join(blockDir, '.chmod-probe')); } catch { blocked = true; }
    if (!blocked) {
      chmodSync(blockDir, 0o755);
      console.log('SKIPPED: chmod 555 does not block writes on this platform - this leg qualified nothing');
      process.exit(0);
    }

    let exitCode = 0, output = '';
    try {
      output = execFileSync(process.execPath, ['update-system.mjs', 'apply', '--confirm'], {
        cwd: install, encoding: 'utf-8', timeout: 300000, env: hermeticEnv(cfg),
      });
    } catch (e) { exitCode = e.status ?? 1; output = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
    chmodSync(blockDir, 0o755);

    ok(exitCode !== 0, `apply aborts on the failed batch instead of completing a partial update (exit ${exitCode})`);
    ok(output.includes(`Update stopped while checking out ${DIR}`), `apply names the path it stopped on (${DIR})`);
    // The assertion the helper test cannot make: everything the batches
    // before the failure wrote is gone again - the install's state before
    // the update had no generated modules at all. Enumerate all of them,
    // not a sample, and check the index too: a failed `git checkout <tree>
    // -- <paths>` stages the blobs it wrote, so a worktree-only check would
    // miss additions that survive as staged entries.
    const survivors = [];
    for (let i = 0; i < GENERATED; i++) {
      if (existsSync(join(install, 'gen-output', 'generated', moduleName(i)))) survivors.push(moduleName(i));
    }
    ok(survivors.length === 0, `all ${GENERATED} files the batches before the failure wrote are reverted (${survivors.length} left)`);
    const staged = git(install, 'status', '--porcelain', '--', 'gen-output/');
    ok(staged === '', `no staged or dirty entries remain under ${DIR} (index matches the pre-update commit)`);
    ok(!existsSync(join(install, BLOCKER)), `the blocked file itself never landed: ${BLOCKER}`);
    ok(existsSync(join(install, KEEP)) && sha256(join(install, KEEP)) === keepBefore, `preserved file under ${DIR} is byte-identical: ${KEEP}`);
    ok(existsSync(join(install, USER_FILE)) && sha256(join(install, USER_FILE)) === cvBefore, `user layer is byte-identical: ${USER_FILE}`);

    if (failures.length && output) {
      console.log('  --- apply output tail [fallback-batch-failure] ---');
      console.log(output.split('\n').slice(-20).join('\n'));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(failures.length ? `RED: ${failures.length} failure(s)` : 'GREEN');
  process.exit(failures.length ? 1 : 0);
}


/** Persistent-rewrite-blocker leg (#3825 review): when the write blocker that
 *  failed the checkout PERSISTS and involves rewriting an existing file, the
 *  restore's own `git checkout HEAD --` hits the same blocker. The old
 *  revertPaths rethrew there: the failed path's additions cleanup never ran
 *  and every later path was skipped. revertPaths now records the failure,
 *  still removes the update's additions under the path, keeps restoring the
 *  remaining paths, and reports the specific error honestly instead of
 *  claiming a full restore.
 *
 *  Poison: same shape as --fallback-batch-failure, but the blocked directory
 *  is the real modes/pdf/ (already a SYSTEM_PATHS entry, so no manifest
 *  injection), whose .gitattributes renormalization makes even a
 *  content-identical hm-audit.md a rewrite on checkout. chmod 555 on
 *  modes/pdf/ blocks that rewrite ("unable to unlink old
 *  'modes/pdf/hm-audit.md'"), so the restore's HEAD checkout of modes/pdf/
 *  fails too. The 300 modules the earlier batches wrote under the writable
 *  generated/ subdirectory must still be removed from worktree AND index,
 *  the restore failure must be reported by name, and apply must exit
 *  non-zero.
 *
 *  Scope: same POSIX qualification as --fallback-batch-failure - it guards
 *  the caller contract on the tree under test and SKIPs where chmod cannot
 *  make a directory unwritable.
 */
function fallbackPersistentRewriteBlockerLeg() {
  const DIR = 'modes/pdf/';
  const GENERATED = 300;
  const BLOCKER = 'modes/pdf/zz-block.md';
  const KEEP = 'modes/pdf/generated/.gitkeep';
  const REWRITE = 'modes/pdf/hm-audit.md';
  const USER_FILE = 'cv.md';
  const baseSha = git(ROOT, 'rev-parse', 'HEAD');
  const oldTag = newestAncestorTag(baseSha);
  if (!oldTag) { console.error('No release tag is an ancestor of HEAD - fetch tags first (CI: fetch-depth: 0)'); process.exit(1); }

  const work = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-rewriteblock-')));
  const failures = [];
  const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} [fallback-persistent-rewrite-blocker] ${msg}`); if (!cond) failures.push(msg); };
  const commit = (cwd, msg) => git(cwd, '-c', 'user.name=upgrade-tests', '-c', 'user.email=upgrade-tests@career-ops.test', 'commit', '-qm', msg);
  const moduleName = (i) => `module-${String(i).padStart(4, '0')}.mjs`;

  try {
    const mirror = buildMirror(work, baseSha);

    // Poison: the target ships the long generated directory and the blocked
    // file under the real modes/pdf/.
    const wt = join(work, 'poison-wt');
    git(mirror, 'worktree', 'add', wt, 'main');
    mkdirSync(join(wt, 'modes', 'pdf', 'generated'), { recursive: true });
    for (let i = 0; i < GENERATED; i++) writeFileSync(join(wt, 'modes', 'pdf', 'generated', moduleName(i)), `// UPSTREAM v2 module ${i}\n`);
    writeFileSync(join(wt, BLOCKER), '# UPSTREAM v2 - only the target ships this file\n');
    git(wt, 'add', '-f', 'modes/pdf');
    commit(wt, 'poison: a long modes/pdf/ expansion behind a persistent blocker');
    const targetSha = git(wt, 'rev-parse', 'HEAD');
    git(mirror, 'worktree', 'remove', '--force', wt);
    git(mirror, 'update-ref', 'refs/heads/main', targetSha);

    const cfg = writeGitConfig(work, mirror);
    const install = join(work, 'install');
    git(ROOT, 'clone', '--quiet', '--branch', oldTag, ROOT, install);
    git(install, 'remote', 'set-url', 'origin', CANONICAL);
    seedFixture(install, { state: fixtureStateFor(oldTag) });

    // The .gitkeep: pre-creates the writable generated/ directory and is the
    // locally added (hence preserved) file that forces the expansion. Plus a
    // user-layer sentinel.
    mkdirSync(join(install, 'modes', 'pdf', 'generated'), { recursive: true });
    writeFileSync(join(install, KEEP), '# generated output lives here\n');
    writeFileSync(join(install, USER_FILE), '# my CV - no upstream counterpart\n');
    git(install, 'add', '-f', KEEP);
    commit(install, 'fork: keep the generated output directory');
    const keepBefore = sha256(join(install, KEEP));
    const rewriteBefore = sha256(join(install, REWRITE));
    const cvBefore = sha256(join(install, USER_FILE));

    // The blocker: modes/pdf/ cannot gain or lose entries, so the rewrite of
    // hm-audit.md and the create of zz-block.md both fail - and so does the
    // restore's own HEAD checkout of modes/pdf/ (verified empirically on the
    // pre-cleanup tree: "unable to unlink old 'modes/pdf/hm-audit.md'").
    const blockDir = join(install, 'modes', 'pdf');
    chmodSync(blockDir, 0o555);
    let blocked = false;
    try { writeFileSync(join(blockDir, '.chmod-probe'), 'x'); rmSync(join(blockDir, '.chmod-probe')); } catch { blocked = true; }
    if (!blocked) {
      chmodSync(blockDir, 0o755);
      console.log('SKIPPED: chmod 555 does not block writes on this platform - this leg qualified nothing');
      process.exit(0);
    }

    let exitCode = 0, output = '';
    try {
      output = execFileSync(process.execPath, ['update-system.mjs', 'apply', '--confirm'], {
        cwd: install, encoding: 'utf-8', timeout: 300000, env: hermeticEnv(cfg),
      });
    } catch (e) { exitCode = e.status ?? 1; output = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
    chmodSync(blockDir, 0o755);

    ok(exitCode !== 0, `apply aborts on the failed batch instead of completing a partial update (exit ${exitCode})`);
    ok(output.includes(`Update stopped while checking out ${DIR}`), `apply names the path it stopped on (${DIR})`);
    // The cleanup's new observable: the restore's own failure is reported by
    // name, instead of being rethrown before the additions cleanup ran.
    ok(output.includes('could not restore from HEAD: modes/pdf ('), `the blocked restore is reported honestly by name (${DIR})`);
    // The assertion the old code failed: everything the batches before the
    // failure wrote is gone again even though the restore checkout itself
    // failed - enumerated in full, and checked in the index too, since a
    // failed `git checkout <tree> -- <paths>` stages the blobs it wrote.
    const survivors = [];
    for (let i = 0; i < GENERATED; i++) {
      if (existsSync(join(install, 'modes', 'pdf', 'generated', moduleName(i)))) survivors.push(moduleName(i));
    }
    ok(survivors.length === 0, `all ${GENERATED} files the batches before the failure wrote are reverted despite the blocked restore (${survivors.length} left)`);
    const staged = git(install, 'status', '--porcelain', '--', 'modes/pdf/generated/');
    ok(staged === '', 'no staged or dirty entries remain under modes/pdf/generated/ (index matches the pre-update commit)');
    ok(!existsSync(join(install, BLOCKER)), `the blocked file itself never landed: ${BLOCKER}`);
    ok(existsSync(join(install, REWRITE)) && sha256(join(install, REWRITE)) === rewriteBefore, `the file whose rewrite was blocked is byte-identical: ${REWRITE}`);
    ok(existsSync(join(install, KEEP)) && sha256(join(install, KEEP)) === keepBefore, `preserved file under ${DIR} is byte-identical: ${KEEP}`);
    ok(existsSync(join(install, USER_FILE)) && sha256(join(install, USER_FILE)) === cvBefore, `user layer is byte-identical: ${USER_FILE}`);

    if (failures.length && output) {
      console.log('  --- apply output tail [fallback-persistent-rewrite-blocker] ---');
      console.log(output.split('\n').slice(-20).join('\n'));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(failures.length ? `RED: ${failures.length} failure(s)` : 'GREEN');
  process.exit(failures.length ? 1 : 0);
}

/** Cross-version collision refusal leg (#7250 review): the target ships as a
 *  directory what the install holds as a preserved local file. Neither the
 *  primary batched checkout nor the per-path fallback may write over the
 *  preserved file or silently skip the shipped directory: apply aborts with
 *  the honest refusal, and the writable entry the fallback loop checked out
 *  before reaching the collision is restored.
 *
 *  Poison: the target gains two manifest entries - zz-writable/ (a plain new
 *  directory, which sorts first) and collib (a directory in the target tree).
 *  The install holds collib as a locally added, committed FILE, so the
 *  update's preserved list names it exactly and the entry collides.
 */
function fallbackCollisionRefusalLeg() {
  const baseSha = git(ROOT, 'rev-parse', 'HEAD');
  const oldTag = newestAncestorTag(baseSha);
  if (!oldTag) { console.error('No release tag is an ancestor of HEAD - fetch tags first (CI: fetch-depth: 0)'); process.exit(1); }

  const work = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-collision-')));
  const failures = [];
  const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} [fallback-collision-refusal] ${msg}`); if (!cond) failures.push(msg); };
  const commit = (cwd, msg) => git(cwd, '-c', 'user.name=upgrade-tests', '-c', 'user.email=upgrade-tests@career-ops.test', 'commit', '-qm', msg);
  const USER_FILE = 'cv.md';

  try {
    const mirror = buildMirror(work, baseSha);
    const wt = join(work, 'poison-wt');
    git(mirror, 'worktree', 'add', wt, 'main');
    mkdirSync(join(wt, 'zz-writable'), { recursive: true });
    writeFileSync(join(wt, 'zz-writable', 'new.md'), '# UPSTREAM v2 writable entry\n');
    mkdirSync(join(wt, 'collib'), { recursive: true });
    writeFileSync(join(wt, 'collib', 'a.md'), '# UPSTREAM v2 collib directory content\n');
    // injectManifestEntry() inserts at the top of SYSTEM_PATHS, so the LAST
    // injection sorts first: the writable entry precedes the colliding one.
    injectManifestEntry(wt, 'collib');
    const manifestFile = injectManifestEntry(wt, 'zz-writable/');
    git(wt, 'add', '-f', 'zz-writable', 'collib', manifestFile);
    commit(wt, 'poison: a writable entry, then an entry that is a directory over a local file');
    const targetSha = git(wt, 'rev-parse', 'HEAD');
    git(mirror, 'worktree', 'remove', '--force', wt);
    git(mirror, 'update-ref', 'refs/heads/main', targetSha);

    const cfg = writeGitConfig(work, mirror);
    const install = join(work, 'install');
    git(ROOT, 'clone', '--quiet', '--branch', oldTag, ROOT, install);
    git(install, 'remote', 'set-url', 'origin', CANONICAL);
    seedFixture(install, { state: fixtureStateFor(oldTag) });

    // The install holds collib as a locally added, committed FILE - exactly
    // preserved once the update claims the entry.
    writeFileSync(join(install, 'collib'), '# my local collib file\n');
    writeFileSync(join(install, USER_FILE), '# my CV - no upstream counterpart\n');
    git(install, 'add', '-f', 'collib');
    commit(install, 'fork: keep a local collib file');
    const collibBefore = sha256(join(install, 'collib'));
    const cvBefore = sha256(join(install, USER_FILE));

    let exitCode = 0, output = '';
    try {
      output = execFileSync(process.execPath, ['update-system.mjs', 'apply', '--confirm'], {
        cwd: install, encoding: 'utf-8', timeout: 300000, env: hermeticEnv(cfg),
      });
    } catch (e) { exitCode = e.status ?? 1; output = `${e.stdout ?? ''}${e.stderr ?? ''}`; }

    ok(exitCode !== 0, `apply aborts on the collision instead of completing (exit ${exitCode})`);
    ok(output.includes('Cannot check out collib'), 'apply reports the collision refusal honestly');
    // The batched preflight refuses before any checkout runs: no partial
    // write, no restore churn, and no window in which a pre-update edit among
    // the earlier entries could be reset to HEAD. The refusal message is the
    // same one the per-path loop would have named.
    ok(!output.includes('Update stopped while checking out'), 'the batched refusal aborts before anything is written');
    ok(!/Restored \d+ system path/.test(output), 'no system-path restore ran, because nothing was written');
    ok(existsSync(join(install, 'collib')) && sha256(join(install, 'collib')) === collibBefore, 'the preserved local file is byte-identical: collib');
    ok(!existsSync(join(install, 'collib', 'a.md')), 'the shipped directory content never landed over the local file');
    ok(!existsSync(join(install, 'zz-writable', 'new.md')), 'the writable entry listed before the collision never landed');
    const staged = git(install, 'status', '--porcelain', '--', 'zz-writable', 'collib');
    ok(staged === '', 'no staged or dirty entries remain for the writable entry or the collision');
    ok(existsSync(join(install, USER_FILE)) && sha256(join(install, USER_FILE)) === cvBefore, `user layer is byte-identical: ${USER_FILE}`);

    if (failures.length && output) {
      console.log('  --- apply output tail [fallback-collision-refusal] ---');
      console.log(output.split('\n').slice(-20).join('\n'));
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
  else if (mode === '--user-layer-refusal') userLayerRefusalLeg();
  else if (mode === '--failed-install') failedInstallLeg();
  else if (mode === '--local-edit') localEdit();
  else if (mode === '--local-edit-canary') localEditCanary();
  else if (mode === '--fallback-batch-failure') fallbackBatchFailureLeg();
  else if (mode === '--fallback-persistent-rewrite-blocker') fallbackPersistentRewriteBlockerLeg();
  else if (mode === '--fallback-collision-refusal') fallbackCollisionRefusalLeg();
  else { console.error('Usage: node upgrade-tests.mjs --pr-gate | --canary | --local-paths | --user-layer-refusal | --failed-install | --local-edit | --local-edit-canary | --fallback-batch-failure | --fallback-persistent-rewrite-blocker | --fallback-collision-refusal'); process.exit(1); }
}
