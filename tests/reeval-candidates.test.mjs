// tests/reeval-candidates.test.mjs — reeval-candidates.mjs lists tracker rows
// whose last evaluation predates the latest change to the candidate's primary
// sources, and never writes anything (#5669).
//
// Covers: a git-backed data root (commit date wins over mtime, uncommitted
// edits fall back to mtime), a data root without git (mtime), the status
// filter, re-evaluated rows (Date column, `Re-eval` Notes marker, a second
// report link), a report link to a missing file, and rows with no date.
//
// Run: node test-all.mjs --only reeval-candidates

import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, rmSync, ROOT, NODE, hermeticGitEnv, describeSpawn } from './helpers.mjs';
import { walkTree } from '../lib/walk-tree.mjs';

const {
  computeReevalCandidates,
  primarySourceChanges,
  reportHeaderDate,
  reevalMarkerDates,
  reportLinkTargets,
  resolveStatusFilter,
  sourceChange,
} = await import(pathToFileURL(join(ROOT, 'reeval-candidates.mjs')).href);

console.log('\nreeval-candidates.mjs — rows scored against older candidate evidence');

function ok(label, cond, detail = '') {
  if (cond) pass(label);
  else fail(detail ? `${label} — ${detail}` : label);
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, `got ${a}, expected ${e}`);
}

/** Local noon on a calendar day, so no timezone moves it to another day. */
const localNoon = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};

function setMtime(path, iso) {
  const at = localNoon(iso);
  utimesSync(path, at, at);
}

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-09-10 | Acme | Platform Engineer | 4.1/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-09-10.md) | remote |
| 2 | 2026-09-12 | Globex | ML Engineer | 3.8/5 | Evaluated | ❌ | [2](../reports/002-globex-2026-09-12.md) | Re-eval 2026-10-20 (3.5→3.8) |
| 3 | 2026-09-01 | Initech | SRE | 3.0/5 | Applied | ❌ | [3](../reports/003-initech-2026-09-01.md) | |
| 4 | 2026-09-03 | Umbrella | Backend Engineer | 3.9/5 | Evaluated | ❌ | [4](../reports/004-umbrella-2026-09-03.md) | |
| 5 | 2026-09-01 | Hooli | Data Engineer | 4.4/5 | Evaluated | ❌ | [5](../reports/005-hooli-2026-09-01.md) [6](../reports/006-hooli-2026-10-08.md) | |
| 6 | — | Wayne | Analyst | N/A | Evaluated | ❌ | — | no date anywhere |
| 7 | 2026-10-05 | Stark | Staff Engineer | 4.0/5 | evaluada | ❌ | [7](../reports/007-stark-2026-10-05.md) | same day as the CV change |
| 8 | 2026-08-20 | Soylent | QA | 2.9/5 | Rejected | ❌ | — | |
`;

const REPORTS = {
  '001-acme-2026-09-10.md': '# Evaluation: Acme — Platform Engineer\n\n**Date:** 2026-09-10\n**Score:** 4.1/5\n\n---\n\nBody 2026-12-31\n',
  '002-globex-2026-09-12.md': '# Evaluation: Globex — ML Engineer\n\n**Date:** 2026-09-12\n\n---\n',
  '003-initech-2026-09-01.md': '# Evaluation: Initech — SRE\n\n**Date:** 2026-09-01\n\n---\n',
  // 004 is deliberately absent: the row's link points at a missing file.
  '005-hooli-2026-09-01.md': '# Evaluation: Hooli — Data Engineer\n\n**Date:** 2026-09-01\n\n---\n',
  // No header date: the filename's date stands in.
  '006-hooli-2026-10-08.md': '# Evaluation: Hooli — Data Engineer\n\n**Score:** 4.4/5\n\n---\n',
  '007-stark-2026-10-05.md': '# Evaluation: Stark — Staff Engineer\n\n**Fecha:** 2026-10-05\n\n---\n',
};

function makeDataRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const sub of ['data', 'reports', 'config', 'modes']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), TRACKER);
  for (const [name, body] of Object.entries(REPORTS)) writeFileSync(join(dir, 'reports', name), body);
  writeFileSync(join(dir, 'cv.md'), '# CV\n\n- Built the thing\n');
  writeFileSync(join(dir, 'article-digest.md'), '# Proof points\n');
  writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate:\n  full_name: Test Person\n');
  writeFileSync(join(dir, 'modes', '_profile.md'), '# Profile\n');
  return dir;
}

/** Every file in the data root (git's own storage aside), by relative path. */
function snapshot(dir) {
  const files = {};
  const skip = (entry, _parent, depth) => depth === 0 && entry.name === '.git';
  for (const abs of walkTree(dir, { skip })) {
    files[relative(dir, abs).split(sep).join('/')] = readFileSync(abs, 'utf-8');
  }
  return files;
}

function runCli(dataRoot, args) {
  return spawnSync(NODE, [join(ROOT, 'reeval-candidates.mjs'), ...args], {
    cwd: tmpdir(),
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: dataRoot,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_PROFILE: '',
    },
  });
}

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const GIT_LOCATION_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY'];

/** A git runner sealed against ambient config, committing at a fixed local day. */
function gitIn(dir) {
  const base = hermeticGitEnv(join(dir, '.git-test-config'));
  for (const name of GIT_LOCATION_ENV) delete base[name];
  return (args, day) => {
    const env = { ...base };
    if (day) {
      const stamp = `${day}T12:00:00`;
      env.GIT_AUTHOR_DATE = stamp;
      env.GIT_COMMITTER_DATE = stamp;
    }
    return execFileSync('git', args, { cwd: dir, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  };
}

// ── Parsing helpers ─────────────────────────────────────────────────────────

eq('header date: English **Date:**', reportHeaderDate('# Evaluation: X\n\n**Date:** 2026-09-14\n**Score:** 4/5\n'), '2026-09-14');
eq('header date: label in another language (**Fecha:**)', reportHeaderDate('# Evaluación: X\n\n**Fecha:** 2026-09-15\n'), '2026-09-15');
eq('header date: French spacing (**Date :**)', reportHeaderDate('# Évaluation : X\n\n**Date :** 2026-09-16\n'), '2026-09-16');
eq('header date: a date below the header block is not the evaluation date',
  reportHeaderDate('# Evaluation: X\n\n**Score:** 4/5\n\n---\n\n**Date:** 2026-01-01\n'), null);
eq('header date: an invalid calendar date is ignored', reportHeaderDate('# E\n\n**Date:** 2026-02-31\n'), null);

eq('Notes: every Re-eval marker merge-tracker writes is read',
  reevalMarkerDates('remote. Re-eval 2026-10-02 (3.8→4.1). Re-eval 2026-10-15 (4.1→3.9) — Superseded report [12] (was 4.1/5)'),
  ['2026-10-02', '2026-10-15']);
eq('Notes: an unrelated date is not a re-evaluation', reevalMarkerDates('Applied 2026-10-01; posted: 2026-08-07'), []);

eq('report links: several links in the Report cell, external URLs ignored',
  reportLinkTargets('[5](../reports/005-a-2026-09-01.md) [6](../reports/006-a-2026-10-08.md) [jd](https://jobs.example/1)', ''),
  ['../reports/005-a-2026-09-01.md', '../reports/006-a-2026-10-08.md']);
eq('report links: Notes are read only when the Report cell has no link',
  reportLinkTargets('—', 'see [9](reports/009-x-2026-09-09.md) and [notes](../notes/9-thing.md)'),
  ['reports/009-x-2026-09-09.md']);

{
  const labels = [...resolveStatusFilter('evaluated, Applied')];
  eq('status filter: case-insensitive, comma-separated, canonical labels', labels, ['Evaluated', 'Applied']);
  let threw = false;
  try { resolveStatusFilter('Pending'); } catch { threw = true; }
  ok('status filter: an unknown state is rejected', threw);
}

// ── Pure computation over fixed source dates ────────────────────────────────

{
  const dir = makeDataRoot('reeval-pure-');
  try {
    const sources = [
      { source: 'cv.md', exists: true, changed: '2026-10-05', basis: 'git' },
      { source: 'article-digest.md', exists: true, changed: '2026-09-11', basis: 'mtime' },
      { source: 'config/profile.yml', exists: false },
      { source: 'modes/_profile.md', exists: true, changed: '2026-08-01', basis: 'git' },
    ];
    const linkDirs = [join(dir, 'data')];
    const evaluated = resolveStatusFilter('Evaluated');
    const r = computeReevalCandidates(TRACKER, { sources, statuses: evaluated, linkDirs, dataRoot: dir });

    eq('default Evaluated filter: candidates, oldest evaluation first', r.candidates.map(c => c.num), [4, 1]);
    const acme = r.candidates.find(c => c.num === 1);
    eq('candidate carries #, company, role, score, eval date and report link',
      [acme.company, acme.role, acme.score, acme.evaluated, acme.report, acme.reportFound],
      ['Acme', 'Platform Engineer', '4.1/5', '2026-09-10', '../reports/001-acme-2026-09-10.md', true]);
    eq('candidate names every source that changed after it, newest first',
      acme.changedSince, [
        { source: 'cv.md', changed: '2026-10-05', basis: 'git' },
        { source: 'article-digest.md', changed: '2026-09-11', basis: 'mtime' },
      ]);
    eq('evaluation date sources are named', acme.evaluatedFrom, ['date-column', 'report-header']);

    const umbrella = r.candidates.find(c => c.num === 4);
    eq('missing report: the Date column still dates the row and the link is flagged',
      [umbrella.evaluated, umbrella.reportFound, umbrella.missingReports],
      ['2026-09-03', false, ['../reports/004-umbrella-2026-09-03.md']]);

    ok('re-evaluated row (Re-eval marker in Notes) is not listed', !r.candidates.some(c => c.num === 2));
    ok('re-evaluated row (second report link, filename date) is not listed', !r.candidates.some(c => c.num === 5));
    ok('a source change on the evaluation day itself is not listed', !r.candidates.some(c => c.num === 7));
    ok('Applied and Rejected rows are left out by default', !r.candidates.some(c => c.num === 3 || c.num === 8));
    eq('a row with no readable date is reported, not dropped', r.undated.map(u => u.num), [6]);
    eq('rows checked: every Evaluated row, alias status included', r.rowsChecked, 6);
    eq('latest source change is reported', r.latestSourceChange, { source: 'cv.md', changed: '2026-10-05', basis: 'git' });

    const withApplied = computeReevalCandidates(TRACKER, {
      sources, statuses: resolveStatusFilter('Evaluated,Applied'), linkDirs, dataRoot: dir,
    });
    eq('--status Evaluated,Applied adds the Applied row', withApplied.candidates.map(c => c.num), [3, 4, 1]);
    const appliedOnly = computeReevalCandidates(TRACKER, {
      sources, statuses: resolveStatusFilter('Applied'), linkDirs, dataRoot: dir,
    });
    eq('--status Applied lists only Applied rows', appliedOnly.candidates.map(c => c.num), [3]);

    const none = computeReevalCandidates(TRACKER, {
      sources: sources.map(s => ({ ...s, exists: false })), statuses: evaluated, linkDirs, dataRoot: dir,
    });
    eq('no source files: nothing is listed', [none.candidates.length, none.latestSourceChange], [0, null]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── mtime fallback: a data root that is not a git repository ────────────────

{
  const dir = makeDataRoot('reeval-mtime-');
  try {
    setMtime(join(dir, 'cv.md'), '2026-10-05');
    setMtime(join(dir, 'article-digest.md'), '2026-08-01');
    setMtime(join(dir, 'config', 'profile.yml'), '2026-08-02');
    setMtime(join(dir, 'modes', '_profile.md'), '2026-08-03');

    const sources = primarySourceChanges(dir, { profilePath: join(dir, 'config', 'profile.yml') });
    const cv = sources.find(s => s.source === 'cv.md');
    eq('mtime fallback: the day comes from the file modification time', [cv.changed, cv.basis], ['2026-10-05', 'mtime']);
    ok('mtime fallback: the note says it is approximate', /approximate/.test(cv.note || ''), cv.note);
    eq('a missing source is reported as missing', sourceChange('cv.md', join(dir, 'nope.md')).exists, false);

    const before = snapshot(dir);
    const res = runCli(dir, []);
    ok('CLI: JSON by default exits 0', res.status === 0, describeSpawn(res));
    let out = null;
    try { out = JSON.parse(res.stdout); } catch { /* reported below */ }
    ok('CLI: stdout is JSON', out !== null, res.stdout.slice(0, 200));
    if (out) {
      eq('CLI: default status is Evaluated', out.metadata.statuses, ['Evaluated']);
      eq('CLI: candidates from the mtime data root', out.candidates.map(c => c.num), [4, 1]);
      eq('CLI: sources are shown relative to the data root', out.sources.map(s => s.path),
        ['cv.md', 'article-digest.md', 'config/profile.yml', 'modes/_profile.md']);
      ok('CLI: every source is labelled mtime', out.sources.every(s => s.basis === 'mtime'));
    }

    const summary = runCli(dir, ['--summary']);
    ok('CLI: --summary exits 0', summary.status === 0, describeSpawn(summary));
    ok('CLI: --summary shows the candidate table and the approximate-mtime marker',
      /Scored before a later source change: 2/.test(summary.stdout)
        && /Acme/.test(summary.stdout)
        && /cv\.md 2026-10-05~/.test(summary.stdout)
        && /mtime \(approximate\)/.test(summary.stdout),
      summary.stdout);
    eq('CLI: the tracker, reports and sources are untouched and nothing was added', snapshot(dir), before);

    const applied = runCli(dir, ['--status', 'Applied', '--json']);
    ok('CLI: --status Applied exits 0', applied.status === 0, describeSpawn(applied));
    try {
      eq('CLI: --status Applied lists the Applied row', JSON.parse(applied.stdout).candidates.map(c => c.num), [3]);
    } catch (err) {
      fail(`CLI: --status Applied output is not JSON (${err.message})`);
    }

    const bad = runCli(dir, ['--status', 'Pending']);
    ok('CLI: an unknown --status exits 2', bad.status === 2, describeSpawn(bad));
    const both = runCli(dir, ['--json', '--summary']);
    ok('CLI: --json with --summary exits 2', both.status === 2, describeSpawn(both));
    const unknown = runCli(dir, ['--fix']);
    ok('CLI: an unrecognized flag exits 1', unknown.status === 1, describeSpawn(unknown));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── git-backed data root ────────────────────────────────────────────────────

if (!hasGit()) {
  fail('git is not installed: the git-backed data root case cannot run');
} else {
  const dir = makeDataRoot('reeval-git-');
  try {
    const g = gitIn(dir);
    g(['init', '-q']);
    g(['config', 'user.name', 'Test']);
    g(['config', 'user.email', 'test@example.invalid']);
    g(['config', 'commit.gpgsign', 'false']);
    g(['config', 'core.autocrlf', 'false']);
    g(['add', 'cv.md', 'article-digest.md', 'config/profile.yml', 'modes/_profile.md']);
    g(['commit', '-q', '-m', 'evidence'], '2026-08-01');
    writeFileSync(join(dir, 'cv.md'), '# CV\n\n- Built the thing\n- Shipped the other thing\n');
    g(['add', 'cv.md']);
    g(['commit', '-q', '-m', 'cv: new proof point'], '2026-10-05');

    // mtimes that disagree with the history: the commit date has to win.
    setMtime(join(dir, 'cv.md'), '2026-12-01');
    setMtime(join(dir, 'config', 'profile.yml'), '2026-12-02');
    // A tracked file with uncommitted edits falls back to its mtime.
    writeFileSync(join(dir, 'article-digest.md'), '# Proof points\n\n- uncommitted\n');
    setMtime(join(dir, 'article-digest.md'), '2026-09-11');

    const sources = primarySourceChanges(dir, { profilePath: join(dir, 'config', 'profile.yml') });
    const by = Object.fromEntries(sources.map(s => [s.source, s]));
    eq('git: a committed, clean file is dated by its last commit, not its mtime',
      [by['cv.md'].changed, by['cv.md'].basis], ['2026-10-05', 'git']);
    eq('git: an untouched file keeps its original commit date',
      [by['config/profile.yml'].changed, by['config/profile.yml'].basis], ['2026-08-01', 'git']);
    eq('git: uncommitted edits fall back to the mtime',
      [by['article-digest.md'].changed, by['article-digest.md'].basis], ['2026-09-11', 'mtime']);
    ok('git: the uncommitted fallback says why', /uncommitted/.test(by['article-digest.md'].note || ''), by['article-digest.md'].note);

    // A file inside the repository that git ignores is dated by its mtime.
    writeFileSync(join(dir, '.gitignore'), 'modes/_profile.md\n');
    g(['rm', '-q', '--cached', 'modes/_profile.md']);
    g(['add', '.gitignore']);
    g(['commit', '-q', '-m', 'ignore profile mode'], '2026-10-06');
    setMtime(join(dir, 'modes', '_profile.md'), '2026-08-03');
    const ignored = sourceChange('modes/_profile.md', join(dir, 'modes', '_profile.md'));
    eq('git: an ignored file is dated by its mtime, not the commit that untracked it',
      [ignored.changed, ignored.basis], ['2026-08-03', 'mtime']);

    const before = snapshot(dir);
    const res = runCli(dir, ['--json']);
    ok('CLI (git): exits 0', res.status === 0, describeSpawn(res));
    let out = null;
    try { out = JSON.parse(res.stdout); } catch { /* reported below */ }
    ok('CLI (git): stdout is JSON', out !== null, res.stdout.slice(0, 200));
    if (out) {
      eq('CLI (git): candidates are the rows evaluated before the cv.md commit', out.candidates.map(c => c.num), [4, 1]);
      const acme = out.candidates.find(c => c.num === 1);
      eq('CLI (git): the changed sources and their basis are named',
        acme && acme.changedSince, [
          { source: 'cv.md', changed: '2026-10-05', basis: 'git' },
          { source: 'article-digest.md', changed: '2026-09-11', basis: 'mtime' },
        ]);
      eq('CLI (git): latest source change', out.metadata.latestSourceChange, { source: 'cv.md', changed: '2026-10-05', basis: 'git' });
    }
    eq('CLI (git): nothing in the data root was modified', snapshot(dir), before);
    eq('CLI (git): the working tree status is unchanged by the run',
      g(['status', '--porcelain', '--untracked-files=no']), 'M article-digest.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
