/**
 * updater-local-edits-argv-limit.test.mjs — locallyModifiedSystemFiles() must
 * not over-report when the file list outgrows a Windows command line (#5103).
 *
 * The detector compares candidates file by file: against the update commit
 * that installed them, and against the blobs upstream published. Each of those
 * git calls used to name every candidate on argv. Windows caps a whole command
 * line at 32,767 characters, so an install with ~1,200 files changed since its
 * merge-base threw ENAMETOOLONG; the surrounding catch degrades to "keep every
 * candidate", and apply() then pinned ~135 untouched files at the old version
 * with a message blaming the user's edits.
 *
 * The runner below enforces that ceiling on every platform, so the property is
 * verified on macOS and Linux too, not only on a Windows runner.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pass, fail, makeUpdaterRepo } from './helpers.mjs';
import { locallyModifiedSystemFiles, commitPathspecs, updateCommitCommand } from '../update-system.mjs';

const WINDOWS_ARGV_LIMIT = 32767;

const fixtures = [];
process.on('exit', () => {
  for (const dir of fixtures) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A fixture that cannot be removed must not change the suite's verdict.
    }
  }
});

// 400 names of ~100 characters: ~40 KB joined, comfortably past the ceiling.
const NAMES = Array.from({ length: 400 }, (_, i) =>
  `bulk/${String(i).padStart(3, '0')}-${'a-deliberately-long-fixture-filename-'.repeat(2)}x.md`);
const PATHS = ['bulk/'];

function makeRepo() {
  const repo = makeUpdaterRepo({ prefix: 'co-argv-limit-', includeRoot: true });
  fixtures.push(repo.dir);
  // Exact-content comparisons below; CRLF checkouts would muddy them.
  repo.g('config', 'core.autocrlf', 'false');
  mkdirSync(join(repo.dir, 'bulk'));
  writeAll(repo, 'v1');
  repo.g('add', '-A');
  repo.g('commit', '-qm', 'base');
  repo.g('branch', 'upstream');
  return repo;
}

function writeAll(repo, content) {
  for (const name of NAMES) writeFileSync(join(repo.dir, name), `${content}\n`);
}

function upstreamWrites(repo, content) {
  repo.g('checkout', '-q', 'upstream');
  writeAll(repo, content);
  repo.g('commit', '-qam', `upstream ${content}`);
  repo.g('checkout', '-q', 'main');
}

/** A git runner that fails the way spawnSync does on Windows. */
function limitedRunner(g, calls) {
  return (...args) => {
    const chars = args.join(' ').length + 'git '.length;
    calls.push({ sub: args.find((a) => !a.startsWith('-')), chars });
    if (chars > WINDOWS_ARGV_LIMIT) {
      const err = new Error('spawnSync git ENAMETOOLONG');
      err.code = 'ENAMETOOLONG';
      throw err;
    }
    return g(...args);
  };
}

console.log('\n🧪 Testing local-edit detection under the Windows argv ceiling (#5103)...');

if (NAMES.join(' ').length > WINDOWS_ARGV_LIMIT) {
  pass(`fixture names span ${NAMES.join(' ').length} chars, past the ${WINDOWS_ARGV_LIMIT} ceiling`);
} else {
  fail('fixture too small to exercise the argv ceiling');
}

// ── 1. Files an update commit installed, untouched since: nothing reported ──
//    Exercises the per-update-commit `diff --numstat <commit> -- <files>`.
{
  const repo = makeRepo();
  upstreamWrites(repo, 'v2');
  repo.g('checkout', 'upstream', '--', ...PATHS);
  repo.g('commit', '-qm', 'chore: auto-update system files to v2');
  upstreamWrites(repo, 'v3');

  const calls = [];
  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', { git: limitedRunner(repo.g, calls), root: repo.dir });
  if (atRisk.length === 0) {
    pass('an untouched install with 400 updated files reports no local edits');
  } else {
    fail(`#1 expected [], got ${atRisk.length} file(s) reported as local edits`);
  }
  const over = calls.filter((c) => c.chars > WINDOWS_ARGV_LIMIT);
  if (over.length === 0) {
    pass('no git call exceeds the Windows command-line ceiling');
  } else {
    fail(`#1 ${over.length} call(s) over the ceiling: ${over.map((c) => `${c.sub}(${c.chars})`).join(', ')}`);
  }
}

// ── 2. Same shape, one file genuinely edited locally: only that one ──
{
  const repo = makeRepo();
  upstreamWrites(repo, 'v2');
  repo.g('checkout', 'upstream', '--', ...PATHS);
  repo.g('commit', '-qm', 'chore: auto-update system files to v2');
  upstreamWrites(repo, 'v3');
  const edited = NAMES[NAMES.length - 1];
  writeFileSync(join(repo.dir, edited), 'local fix\n');
  repo.g('commit', '-qam', 'local fix');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', { git: limitedRunner(repo.g, []), root: repo.dir });
  if (atRisk.length === 1 && atRisk[0] === edited) {
    pass('a real local edit among 400 updated files is still the one reported');
  } else {
    fail(`#2 expected [${edited}], got ${atRisk.length} file(s)`);
  }
}

// ── 3. Files no update commit delivered, holding content upstream published ──
//    Exercises `diff --raw <ref> -- <undelivered>` and
//    `log --raw <range> -- <undelivered>`.
{
  const repo = makeRepo();
  upstreamWrites(repo, 'v2');
  // The install adopted upstream's v2 by hand, not through an update commit.
  writeAll(repo, 'v2');
  repo.g('commit', '-qam', 'adopt upstream fix');
  upstreamWrites(repo, 'v3');

  const calls = [];
  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', { git: limitedRunner(repo.g, calls), root: repo.dir });
  if (atRisk.length === 0) {
    pass('400 files holding content upstream published are not reported as local edits');
  } else {
    fail(`#3 expected [], got ${atRisk.length} file(s) reported as local edits`);
  }
  const over = calls.filter((c) => c.chars > WINDOWS_ARGV_LIMIT);
  if (over.length === 0) {
    pass('the raw diff/log comparison stays under the ceiling too');
  } else {
    fail(`#3 ${over.length} call(s) over the ceiling: ${over.map((c) => `${c.sub}(${c.chars})`).join(', ')}`);
  }
}

// ── 4. Same shape, one file holding content upstream never shipped ──
{
  const repo = makeRepo();
  upstreamWrites(repo, 'v2');
  writeAll(repo, 'v2');
  const edited = NAMES[0];
  writeFileSync(join(repo.dir, edited), 'local fix\n');
  repo.g('commit', '-qam', 'adopt upstream fix, plus one local edit');
  upstreamWrites(repo, 'v3');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', { git: limitedRunner(repo.g, []), root: repo.dir });
  if (atRisk.length === 1 && atRisk[0] === edited) {
    pass('content upstream never shipped is still reported among 400 adopted files');
  } else {
    fail(`#4 expected [${edited}], got ${atRisk.length} file(s)`);
  }
}

// ── 5. The scoped update commit: 400 paths, an unrelated file already staged ──
//    apply() takes this form exactly when the user has something else staged,
//    and that is the call azizibilel's run hit with 1,593 paths (#5103).
{
  const repo = makeRepo();
  writeAll(repo, 'v2');
  repo.g('add', '--', 'bulk/');
  writeFileSync(join(repo.dir, 'mine.txt'), 'user work\n');
  repo.g('add', 'mine.txt');

  const calls = [];
  let error = null;
  try {
    commitPathspecs('chore: auto-update system files to v2', NAMES, { git: limitedRunner(repo.g, calls), root: repo.dir });
  } catch (err) {
    error = err;
  }
  const over = calls.filter((c) => c.chars > WINDOWS_ARGV_LIMIT);
  if (!error && over.length === 0) {
    pass('a scoped commit of 400 paths stays under the Windows ceiling');
  } else {
    fail(`#5 ${error ? error.message : `${over.length} call(s) over the ceiling`}`);
  }
  const committed = repo.g('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  if (committed.length === NAMES.length && !committed.includes('mine.txt')) {
    pass('the commit holds exactly the 400 named paths');
  } else {
    fail(`#5 expected the 400 named paths only, commit holds ${committed.length} (mine.txt ${committed.includes('mine.txt') ? 'swept in' : 'absent'})`);
  }
  if (repo.g('diff', '--cached', '--name-only') === 'mine.txt') {
    pass('the unrelated staged file is left staged, outside the commit (#915 bug 2)');
  } else {
    fail('#5 the unrelated staged file did not stay staged on its own');
  }
  const gitDir = resolve(repo.dir, repo.g('rev-parse', '--git-dir'));
  if (!readdirSync(gitDir).some((f) => f.startsWith('career-ops-update-pathspecs'))) {
    pass('the pathspec file is removed once the commit lands');
  } else {
    fail('#5 the pathspec file was left behind after a successful commit');
  }
}

// ── 6. literal: a glob-shaped name commits only itself ──
//    rollback() commits with --literal-pathspecs; the file must not undo it.
{
  const repo = makeRepo();
  writeFileSync(join(repo.dir, 'bulk', '[ab].md'), 'v1\n');
  writeFileSync(join(repo.dir, 'bulk', 'a.md'), 'v1\n');
  repo.g('add', '--', 'bulk/[ab].md', 'bulk/a.md');
  repo.g('commit', '-qm', 'base 2');
  writeFileSync(join(repo.dir, 'bulk', '[ab].md'), 'v2\n');
  writeFileSync(join(repo.dir, 'bulk', 'a.md'), 'v2\n');
  repo.g('add', '--', 'bulk/a.md');
  repo.g('--literal-pathspecs', 'add', '--', 'bulk/[ab].md');

  commitPathspecs('chore: rollback system files', ['bulk/[ab].md'], { git: repo.g, root: repo.dir, literal: true });
  const committed = repo.g('show', '--name-only', '--format=', 'HEAD');
  if (committed === 'bulk/[ab].md') {
    pass('a literal pathspec file does not glob `[ab].md` onto `a.md`');
  } else {
    fail(`#6 expected only bulk/[ab].md, commit holds: ${committed.replace(/\n/g, ', ')}`);
  }
}

// ── 7. A failed commit leaves the file the recovery hint names, and it works ──
{
  const repo = makeRepo();
  writeAll(repo, 'v2');
  repo.g('add', '--', 'bulk/');
  writeFileSync(join(repo.dir, 'mine.txt'), 'user work\n');
  repo.g('add', 'mine.txt');

  const failingCommit = (...args) => {
    if (args.includes('commit')) throw new Error('simulated commit failure');
    return repo.g(...args);
  };
  let listFile = null;
  try {
    commitPathspecs('chore: auto-update system files to v2', NAMES, { git: failingCommit, root: repo.dir });
    fail('#7 the simulated failure did not surface');
  } catch (err) {
    listFile = err.pathspecFile;
  }
  // A second scoped commit that fails must not touch the first one's file,
  // and one that lands must not delete it.
  let otherFile = null;
  try {
    commitPathspecs('chore: other', ['mine.txt'], { git: failingCommit, root: repo.dir });
  } catch (err) {
    otherFile = err.pathspecFile;
  }
  if (listFile && otherFile && listFile !== otherFile
      && readFileSync(resolve(repo.dir, listFile), 'utf8').split('\0').filter(Boolean).length === NAMES.length) {
    pass('a later failed scoped commit gets its own file and leaves the first one intact');
  } else {
    fail(`#7 pathspec files collided: ${listFile} vs ${otherFile}`);
  }
  rmSync(resolve(repo.dir, otherFile), { force: true });
  // Exercise the same formatter apply() uses, reusing the failed commit's file
  // rather than writing another copy or expanding the paths back onto argv.
  const hint = updateCommitCommand('2', false, NAMES, {
    pathspecFile: listFile,
    git: () => { throw new Error('the failed commit already wrote the file'); },
  });
  const match = hint.match(/^git commit -m "([^"]+)" "--pathspec-from-file=([^"]+)" --pathspec-file-nul$/);
  const recovery = match && ['commit', '-m', match[1], `--pathspec-from-file=${match[2]}`, '--pathspec-file-nul'];
  let recovered = false;
  try {
    if (match?.[2] === listFile) {
      repo.g(...recovery);
      recovered = true;
    }
  } catch {
    recovered = false;
  }
  const committed = repo.g('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  if (recovered && committed.length === NAMES.length && !committed.includes('mine.txt')) {
    pass('the printed recovery command commits the update paths and nothing else');
  } else {
    fail(`#7 recovery ${recovered ? `committed ${committed.length} path(s)` : 'failed'}`);
  }
  const hintChars = hint.length;
  if (hintChars < WINDOWS_ARGV_LIMIT) {
    pass(`the recovery command is ${hintChars} chars, runnable under the Windows ceiling`);
  } else {
    fail(`#7 recovery command is ${hintChars} chars`);
  }
}

// A withheld scoped commit has no failed commit file yet. Its printed command
// must also fit on Windows and leave unrelated staged work out of the commit.
{
  const repo = makeRepo();
  writeAll(repo, 'v2');
  repo.g('add', '--', 'bulk/');
  writeFileSync(join(repo.dir, 'mine.txt'), 'user work\n');
  repo.g('add', 'mine.txt');
  const calls = [];
  const hint = updateCommitCommand('2', false, NAMES, {
    git: limitedRunner(repo.g, calls), root: repo.dir,
  });
  const match = hint.match(/^git commit -m "([^"]+)" "--pathspec-from-file=([^"]+)" --pathspec-file-nul$/);
  const contents = match && readFileSync(resolve(repo.dir, match[2]), 'utf8');
  if (hint.length < WINDOWS_ARGV_LIMIT && contents === NAMES.map(p => `${p}\0`).join('')) {
    pass('a withheld update prints a short command backed by the complete NUL-delimited path list');
  } else {
    fail(`withheld recovery hint is invalid or too long (${hint.length} chars)`);
  }
  if (match) {
    limitedRunner(repo.g, calls)('commit', '-m', match[1], `--pathspec-from-file=${match[2]}`, '--pathspec-file-nul');
    const committed = repo.g('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
    if (committed.length === NAMES.length && !committed.includes('mine.txt')
        && repo.g('diff', '--cached', '--name-only') === 'mine.txt') {
      pass('the withheld recovery command commits all 400 update files and leaves unrelated work staged');
    } else {
      fail('the withheld recovery command lost update files or swept in unrelated work');
    }
  }
}
