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
 *   node upgrade-tests.mjs --pr-gate    # newest old tag -> HEAD, one leg
 *   node upgrade-tests.mjs --canary     # planted user-file clobber must go RED
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { seedFixture, loadExpectations } from './seed-fixture.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CANONICAL = 'https://github.com/santifer/career-ops.git';
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
  writeFileSync(cfg, `[user]\n\tname = upgrade-tests\n\temail = upgrade-tests@career-ops.test\n[url "${url}"]\n\tinsteadOf = ${CANONICAL}\n[safe]\n\tdirectory = *\n`);
  return cfg;
}

/** A system file whose blob differs between oldTag and target — the non-vacuity
 *  oracle. Restricted to files `apply` actually manages (SYSTEM_PATHS: an exact
 *  entry, or any file under a `dir/` prefix entry); a changed USER-layer or
 *  meta file would never be rewritten by apply, so its blob could never match
 *  the target and the leg would go spuriously RED. */
function pickOracle(mirror, oldTag, targetSha, systemPaths) {
  const changed = git(mirror, 'diff', '--name-only', `${oldTag}..${targetSha}`).split('\n').filter(Boolean);
  if (changed.includes('update-system.mjs')) return 'update-system.mjs';
  const managed = (f) => systemPaths.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));
  const candidate = changed.find((f) => {
    if (!managed(f)) return false;
    try { git(mirror, 'cat-file', '-e', `${targetSha}:${f}`); return true; } catch { return false; }
  });
  if (!candidate) throw new Error(`No changed system file between ${oldTag} and target — nothing to upgrade, leg would be vacuous`);
  return candidate;
}

function isAncestor(cwd, tag, sha) {
  try { git(cwd, 'merge-base', '--is-ancestor', tag, sha); return true; } catch { return false; }
}

export function runLeg({ oldTag, targetSha, label = oldTag, mutateMirror = null }) {
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

    const oracle = pickOracle(mirror, oldTag, targetSha, targetSystemPaths);
    const oracleBlob = git(mirror, 'rev-parse', `${targetSha}:${oracle}`);

    const install = join(work, 'install');
    git(ROOT, 'clone', '--quiet', '--branch', oldTag, ROOT, install);
    git(install, 'remote', 'set-url', 'origin', CANONICAL);
    const state = fixtureStateFor(oldTag);
    const { manifest } = seedFixture(install, { state });

    // New-path delta for the #1998-class assertion: concrete files in the
    // target's SYSTEM_PATHS that don't exist at the old tag but do at target.
    const newConcrete = targetSystemPaths.filter((p) => !p.endsWith('/'))
      .filter((p) => { try { git(mirror, 'cat-file', '-e', `${oldTag}:${p}`); return false; } catch { return true; } })
      .filter((p) => { try { git(mirror, 'cat-file', '-e', `${targetSha}:${p}`); return true; } catch { return false; } });

    let exitCode = 0, output = '';
    try {
      output = execFileSync(process.execPath, ['update-system.mjs', 'apply'], {
        cwd: install, encoding: 'utf-8', timeout: 300000,
        env: { ...process.env, GIT_CONFIG_GLOBAL: cfg },
      });
    } catch (e) { exitCode = e.status ?? 1; output = `${e.stdout ?? ''}${e.stderr ?? ''}`; }

    // Ordered assertions — user-layer manifest BEFORE any repo script runs
    // (doctor's autoCopy writes user-layer files).
    ok(exitCode === 0, `apply exits 0 (got ${exitCode})`);
    let installOracle = null;
    try { installOracle = git(install, 'rev-parse', `HEAD:${oracle}`); } catch { /* leave null */ }
    ok(installOracle === oracleBlob, `upgrade executed: ${oracle} blob matches target (non-vacuity oracle)`);
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
  const { failures } = runLeg({ oldTag: newestOld, targetSha });
  console.log(failures.length ? `RED: ${failures.length} failure(s)` : 'GREEN');
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === '--pr-gate') prGate();
  else if (mode === '--canary') canary();
  else { console.error('Usage: node upgrade-tests.mjs --pr-gate | --canary'); process.exit(1); }
}
