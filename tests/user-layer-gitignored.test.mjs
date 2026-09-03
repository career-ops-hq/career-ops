// tests/user-layer-gitignored.test.mjs
//
// AGENTS.md declares a User Layer: the files a candidate fills with their own
// personal data. Every one of those paths must be git-ignored, or a contributor
// working in a fork can stage their own CV, proof points or tracker into a public
// repository with a reflexive `git add .`.
//
// article-digest.md drifted off .gitignore while remaining on the AGENTS.md list.
// This test compares the two lists directly so they cannot diverge again.

import { spawnSync } from 'child_process';
import { lstatSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, warn, ROOT } from './helpers.mjs';

/**
 * Ask git whether one path is ignored, keeping "git said no" and "git could not
 * answer" apart.
 *
 * check-ignore exits 1 for a path that is simply not ignored, and 128 for a
 * pathspec it refuses outright. The refusal that matters here is
 * `fatal: pathspec '...' is beyond a symbolic link`, which is every probe
 * through a user-layer directory symlinked out of the repo -- the layout people
 * adopt as the manual workaround for #524. A bare `catch` collapses the two, so
 * this suite reported data/, output/ and reports/ as unignored PII leaks on a
 * checkout where they are ignored (#3165): a false negative on the one
 * assertion in the file whose whole point is to be trustworthy.
 *
 * `--no-index` does not avoid it. Git will not evaluate a pathspec that crosses
 * a symlink at all, with or without an index.
 *
 * @param {string} probe - Repo-relative path to test.
 * @returns {{verdict: 'ignored'|'not-ignored'|'unanswerable', stderr: string}}
 */
function checkIgnore(probe) {
  const r = spawnSync('git', ['check-ignore', '-q', '--no-index', probe], { cwd: ROOT, encoding: 'utf-8' });
  if (r.status === 0) return { verdict: 'ignored', stderr: '' };
  if (r.status === 1) return { verdict: 'not-ignored', stderr: '' };
  const stderr = (r.stderr || r.error?.message || `git exited ${r.status}`).trim();
  return { verdict: 'unanswerable', stderr };
}

/**
 * Whether a repo-relative path is itself a symlink (not merely reached through
 * one). lstat, so the link is described rather than followed.
 *
 * @param {string} rel - Repo-relative path.
 * @returns {boolean}
 */
function isSymlink(rel) {
  try {
    return lstatSync(join(ROOT, rel)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * The outermost symlink on the way down to `rel`, if any.
 *
 * git stops at the FIRST symlink it meets walking a pathspec, so that entry --
 * not the leaf -- is the one it can still answer for. Returns the repo-relative
 * path of that ancestor (or `rel` itself when the leaf is the symlink), else null.
 *
 * @param {string} rel - Repo-relative path.
 * @returns {string|null}
 */
function symlinkedAncestor(rel) {
  const parts = rel.split('/').filter(Boolean);
  for (let i = 1; i <= parts.length; i += 1) {
    const prefix = parts.slice(0, i).join('/');
    if (isSymlink(prefix)) return prefix;
  }
  return null;
}

/**
 * checkIgnore, but able to answer for probes that cross a user-layer symlink.
 *
 * The loop over the AGENTS.md paths below has resolved this since #3165: when
 * git refuses a pathspec, ask about the symlinked entry instead, because that
 * entry is what actually governs whether `git add .` can stage anything through
 * it -- the contents live outside the repository. That fallback was written
 * inline, so the derived-index probe list added later did not inherit it and
 * went permanently red on the symlinked layout. Keeping it in one helper is
 * what lets the next probe list opt in with one call instead of rediscovering
 * exit 128 the hard way.
 *
 * @param {string} probe - Repo-relative path to test.
 * @returns {{verdict: 'ignored'|'not-ignored'|'unanswerable', stderr: string, via: string|null}}
 */
function checkIgnoreThroughSymlinks(probe) {
  const direct = checkIgnore(probe);
  if (direct.verdict !== 'unanswerable') return { ...direct, via: null };

  const ancestor = symlinkedAncestor(probe);
  if (!ancestor) return { ...direct, via: null };

  return { ...checkIgnore(ancestor), via: ancestor };
}

console.log('\n🔒 user-layer files are git-ignored');

// Pull the declared user-layer paths straight out of AGENTS.md so the test tracks
// the document rather than a hand-copied duplicate of it.
const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf-8');
const line = agents.split(/\r?\n/).find(l => l.includes('**User Layer'));

if (!line) {
  fail('AGENTS.md no longer contains a "**User Layer" line — update this test');
} else {
  // Backtick-quoted paths, minus the glob suffix: `data/*` -> data/
  const paths = [...line.matchAll(/`([^`]+)`/g)]
    .map(m => m[1])
    .map(p => (p.endsWith('/*') ? `${p.slice(0, -1)}` : p));

  if (paths.length === 0) fail('parsed no paths from the AGENTS.md user-layer line');
  else pass(`parsed ${paths.length} user-layer paths from AGENTS.md`);

  for (const p of paths) {
    // A directory glob is satisfied by a probe file inside it; a bare filename
    // is checked directly.
    const entry = p.endsWith('/') ? p.slice(0, -1) : p;
    const probe = p.endsWith('/') ? `${p}__gitignore_probe__.md` : p;
    const first = checkIgnore(probe);

    if (first.verdict === 'ignored') {
      pass(`${p} is git-ignored`);
      continue;
    }
    if (first.verdict === 'not-ignored') {
      fail(`${p} is declared user-layer in AGENTS.md but is NOT git-ignored — personal data could be committed`);
      continue;
    }

    // Git refused the pathspec. If the declared path is itself a symlink, the
    // question it CAN answer is whether the link entry is ignored -- and that is
    // the question that actually governs what `git add .` stages here, since the
    // contents live outside the repository entirely.
    if (!isSymlink(entry)) {
      fail(`${p}: git check-ignore could not answer — ${first.stderr}`);
      continue;
    }

    const link = checkIgnore(entry);
    if (link.verdict === 'ignored') {
      pass(`${p} is git-ignored (symlinked out of the repo; checked the link entry itself)`);
    } else if (link.verdict === 'not-ignored') {
      // A warning, not a failure. The leak is real but far smaller than the one
      // the failure message above describes: staging a symlink commits its
      // target path, not the user's CV or tracker. Failing here would just
      // recreate the permanently-red suite this check was fixed to end, for the
      // same people. `data/*` does not match `data`, so stock rules land here.
      warn(`${p} is symlinked out of the repo and the link entry itself is NOT ignored — `
        + `\`git add .\` would commit the link (its target path, not your data). `
        + `Add a rule matching the entry itself, e.g. \`/${entry}\` alongside \`${entry}/*\`.`);
    } else {
      fail(`${p}: git check-ignore could not answer for the link entry either — ${link.stderr}`);
    }
  }
}

// safe-write.ts names backups like `cv.md.bak-2026-08-05T16-55-08-641Z`.
// The old `*.bak` pattern did not match those timestamped paths, so a
// reflexive `git add .` could stage PII sitting in the repo root.
const timestampedBackupProbes = [
  'cv.md.bak-2026-08-05T16-55-08-641Z',
  'config/profile.yml.bak-2026-08-05T16-55-08-641Z',
  'portals.yml.bak-2026-08-05T16-55-08-641Z',
  'cv.md.bak10',
];

for (const path of timestampedBackupProbes) {
  const { verdict, stderr } = checkIgnore(path);
  if (verdict === 'ignored') pass(`${path} is git-ignored`);
  else if (verdict === 'not-ignored') fail(`${path} is NOT git-ignored — a timestamped backup could expose PII`);
  else fail(`${path}: git check-ignore could not answer — ${stderr}`);
}

// The tracker's DERIVED SQLite index (tracker.mjs, #918), which carries the
// same content as the markdown it indexes — company, role, score, status,
// notes.
//
// On the standard layout it lands in data/ and the rules above already cover
// it. But resolveTrackerPath() falls back to `<root>/applications.md` when
// data/applications.md is absent, and the index follows the markdown, so on
// the legacy layout it sits in the repo root instead. That is also every fresh
// clone: `node test-all.mjs` leaves one there, 36KB, ready for `git add .`.
//
// The nested probes are the ones that decide the SHAPE of the rule. A
// root-anchored `/*.db` covers the repo root and nothing else, and would still
// pass every root probe below — but getCareerOpsRoot() resolves a RELATIVE
// CAREER_OPS_ROOT (or .career-ops-data marker) against the codebase directory,
// so a data root configured as `career-data` puts the tracker, and its index,
// in a subdirectory of the checkout. `data/applications.db` cannot settle this
// on its own: it is already covered by the blanket `data/*` rule at the top of
// the file, so it passes either way.
//
// Built as a cross-product rather than hand-listed. tracker.mjs derives every
// one of these from a single path — DB_PATH is resolveTrackerPath() with .md
// swapped for .db, and SQLite appends the sidecar suffixes to that — so any
// directory that can hold the index can hold all three names. Enumerating them
// by hand is how the -shm sidecar ended up covered in the repo root and missed
// one directory down.
const derivedIndexLocations = [
  'applications',                // legacy layout: tracker markdown in the root
  'data/applications',           // standard layout
  'career-data/applications',    // a relative CAREER_OPS_ROOT / .career-ops-data root
];
const derivedIndexProbes = derivedIndexLocations.flatMap(
  (base) => ['.db', '.db-wal', '.db-shm'].map((suffix) => `${base}${suffix}`),
);

for (const path of derivedIndexProbes) {
  const { verdict, stderr, via } = checkIgnoreThroughSymlinks(path);
  if (verdict === 'ignored') {
    pass(via ? `${path} is git-ignored (reached through the ${via} symlink; checked that entry)` : `${path} is git-ignored`);
  } else if (verdict === 'not-ignored' && via) {
    // Same call as the user-layer loop above: the index lives outside the repo,
    // so staging the link commits its target path, not the tracker's contents.
    warn(`${path} sits behind the ${via} symlink and that entry is NOT ignored — `
      + `\`git add .\` would commit the link, not the index. Add a rule matching the entry itself, e.g. \`/${via}\`.`);
  } else if (verdict === 'not-ignored') {
    fail(`${path} is NOT git-ignored — the derived index holds the same PII as the tracker`);
  } else {
    fail(`${path}: git check-ignore could not answer — ${stderr}`);
  }
}

// Not user-layer data, but the same mechanism: this one is about what a
// reflexive `git add .` can swallow. test-all.mjs builds its script-runner
// sandbox with mkdtempSync under the repo ROOT, and a suite interrupted
// mid-run (a flake, a Ctrl-C) leaves that copy behind: ~650MB and ~1000
// stageable files. The copied .gitignore does travel with it and does keep the
// user-layer paths inside it ignored, so this is noise rather than a leak, but
// it is noise a contributor can commit by accident.
const scratchProbes = [
  '.tmp-script-test-abc123/AGENTS.md',
  '.tmp-script-test-abc123/nested/deep/file.mjs',
];

for (const path of scratchProbes) {
  const { verdict, stderr } = checkIgnore(path);
  if (verdict === 'ignored') pass(`${path} is git-ignored`);
  else if (verdict === 'not-ignored') fail(`${path} is NOT git-ignored — an interrupted test run leaves it stageable`);
  else fail(`${path}: git check-ignore could not answer — ${stderr}`);
}
