#!/usr/bin/env node
/**
 * reeval-candidates.mjs — list tracker rows scored against older candidate evidence
 *
 * A tracker row's score is fixed when the role is evaluated. The primary
 * sources that evaluation reads keep changing afterwards (`expand` adds proof
 * points, `add` adds a project, the profile gains a target), and nothing says
 * which still-open rows were scored before that change. This script lists them,
 * so the user can decide which ones to evaluate again (#5669).
 *
 * Zero LLM, read-only: it never re-evaluates, never takes the tracker lock and
 * never writes the tracker, a report or any other file.
 *
 * PRIMARY SOURCES (the AGENTS.md "Primary / user-authored" tier that carries
 * facts): `cv.md`, `article-digest.md`, `config/profile.yml` (through
 * getProfilePath(), so CAREER_OPS_PROFILE is honored) and `modes/_profile.md`,
 * all under the data root. A missing file is reported and ignored.
 *
 * WHEN A SOURCE LAST CHANGED
 *   - git: the file is tracked in the git repository that contains it and has
 *     no uncommitted changes -> the committer date of the last commit that
 *     touched it. Committer date, not author date: it is never earlier than the
 *     moment the content entered the history (a rebase or amend moves it
 *     forward, which can only list a row too eagerly, never hide one).
 *   - mtime: everything else (no git, an untracked or gitignored file, which is
 *     the default layout since the checkout ignores user files, or a tracked
 *     file with uncommitted edits) -> the file's modification time. This is
 *     APPROXIMATE: a copy, sync, restore or checkout moves it without any change
 *     to the content, and the output labels it `mtime` for that reason.
 *   Both are reduced to a calendar day in the local timezone, the same day the
 *   evaluation date was written in.
 *
 * WHEN A ROW WAS LAST EVALUATED: the latest of
 *   1. the row's Date column (merge-tracker.mjs rewrites it to the
 *      re-evaluation date when a re-evaluation updates the row),
 *   2. every `Re-eval YYYY-MM-DD` marker in Notes (merge-tracker's mergeNotes()
 *      appends one per re-evaluation),
 *   3. each linked report's header date: the first bold header field whose
 *      value is an ISO date (`**Date:** 2026-09-14`, in any label language),
 *      or, when the header has none, the date in the report filename
 *      (`{###}-{slug}-{YYYY-MM-DD}.md`).
 *   The latest wins because a re-evaluation writes its score through to the row
 *   in both directions, so the score on the row is the most recent one. A row
 *   whose report link points at a missing file still uses (1) and (2); a row
 *   with no readable date at all is listed under `undated`, never dropped.
 *
 * RULE: a row is a candidate when at least one source changed on a LATER
 * calendar day than its evaluation date. A change on the same day is not
 * listed: the evaluation date has no time of day, so the order is unknown.
 *
 * Run: node reeval-candidates.mjs                       (JSON to stdout)
 *      node reeval-candidates.mjs --summary             (human-readable table)
 *      node reeval-candidates.mjs --status Evaluated,Applied
 *      node reeval-candidates.mjs --tracker path/to/applications.md
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

import { resolveColumns, parseTrackerRow, parseMarkdownLinks } from './tracker-parse.mjs';
import { loadCanonicalStates, resolveCanonicalState, trackerLinkDirsFor } from './tracker-utils.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { localToday } from './lib/local-today.mjs';
import { parseDate } from './lib/parse-date.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { canonicalizeTrackerPath, getCareerOpsRoot, getProfilePath, resolveTrackerPath } from './path-resolver.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const STATES_FILE = join(CODE_ROOT, 'templates/states.yml');

export const DEFAULT_STATUS = 'Evaluated';

/** Primary sources, by the name the output uses. Order is the display order. */
export const SOURCE_NAMES = ['cv.md', 'article-digest.md', 'config/profile.yml', 'modes/_profile.md'];

/** Only the report header is read; a report's archived JD can run long. */
const MAX_REPORT_BYTES = 64 * 1024;

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// `**Date:** 2026-09-14`, `**Date :** …` (fr), `**Date**: …`.
const HEADER_DATE_RE = /^\s*\*\*[^*\n]+?\*\*\s*:?\s*(\d{4}-\d{2}-\d{2})(?!\d)/;
const FILENAME_DATE_RE = /(\d{4}-\d{2}-\d{2})\.md$/i;
// merge-tracker.mjs mergeNotes(): `Re-eval 2026-10-02 (3.8→4.1)`.
const REEVAL_MARKER_RE = /\bre-?eval(?:uated|uation)?\b[\s:]*(\d{4}-\d{2}-\d{2})(?!\d)/gi;

// Variables that tell git where a repository is. With one of them inherited
// (a git hook sets GIT_DIR), the working directory would stop deciding which
// repository is asked about the file.
const GIT_LOCATION_ENV = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_COMMON_DIR',
  'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
];

const isoDay = (value) => (ISO_DAY_RE.test(value) && parseDate(value) ? value : null);

/** Canonical state labels from templates/states.yml. */
export function loadStates(statesFile = STATES_FILE) {
  return loadCanonicalStates(statesFile);
}

/** `Evaluated, applied` -> Set{'Evaluated','Applied'}; throws on an unknown state. */
export function resolveStatusFilter(value, states = loadStates()) {
  const labels = new Set();
  for (const part of String(value).split(',')) {
    if (!part.trim()) continue;
    const label = resolveCanonicalState(part, states);
    if (!label) {
      throw new Error(`Unknown status "${part.trim()}". Canonical states: ${states.map(s => s.label).join(', ')}.`);
    }
    labels.add(label);
  }
  if (labels.size === 0) throw new Error('--status needs at least one state.');
  return labels;
}

function gitEnv() {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_ENV) delete env[name];
  return env;
}

// `--no-optional-locks`: `git status` would otherwise refresh the index, a
// write this read-only script has no business making.
function git(cwd, args) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd,
    encoding: 'utf-8',
    env: gitEnv(),
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * When one source file last changed.
 *
 * @param {string} name - Display name (`cv.md`).
 * @param {string} path - Where the file is expected.
 * @returns {{source: string, path: string, exists: boolean, changed?: string,
 *   changedAt?: string, basis?: 'git'|'mtime', note?: string}}
 */
export function sourceChange(name, path) {
  const base = { source: name, path };
  let real;
  let stat;
  try {
    real = realpathSync(path);
    stat = statSync(real);
  } catch {
    return { ...base, exists: false };
  }
  if (!stat.isFile()) return { ...base, exists: false };

  const fromMtime = (note) => ({
    ...base,
    exists: true,
    changed: localToday(stat.mtime),
    changedAt: stat.mtime.toISOString(),
    basis: 'mtime',
    note,
  });

  const dir = dirname(real);
  const file = basename(real);
  let tracked = '';
  try {
    tracked = git(dir, ['ls-files', '--', file]);
  } catch {
    // Not inside a repository, or git is not installed.
    return fromMtime('approximate: no usable git repository, file modification time');
  }
  // Untracked or gitignored (the default layout ignores user files). Checked
  // before `git log`, which still names the commit that stopped tracking a
  // file once it is removed from the index and kept on disk.
  if (!tracked) return fromMtime('approximate: not tracked by git, file modification time');

  let committed = '';
  let dirty = '';
  try {
    committed = git(dir, ['log', '-1', '--format=%ct', '--', file]);
    dirty = git(dir, ['status', '--porcelain', '--untracked-files=no', '--', file]);
  } catch {
    return fromMtime('approximate: git history unavailable, file modification time');
  }
  if (!/^\d+$/.test(committed)) return fromMtime('approximate: not committed yet, file modification time');
  if (dirty) return fromMtime('approximate: uncommitted changes, file modification time');

  const at = new Date(Number(committed) * 1000);
  return {
    ...base,
    exists: true,
    changed: localToday(at),
    changedAt: at.toISOString(),
    basis: 'git',
    note: 'last commit touching the file',
  };
}

/** Every primary source under the data root, with its last-change day. */
export function primarySourceChanges(dataRoot, { profilePath = getProfilePath() } = {}) {
  const paths = {
    'cv.md': join(dataRoot, 'cv.md'),
    'article-digest.md': join(dataRoot, 'article-digest.md'),
    'config/profile.yml': profilePath,
    'modes/_profile.md': join(dataRoot, 'modes', '_profile.md'),
  };
  return SOURCE_NAMES.map(name => sourceChange(name, paths[name]));
}

/**
 * Report links a row names: the Report cell's local links, or, when it has
 * none, `reports/` links in Notes (trackers without a Report column).
 */
export function reportLinkTargets(reportCell, notesCell) {
  const local = (target) => {
    const t = String(target ?? '').trim().replace(/^<|>$/g, '');
    if (!t || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(t)) return null;
    return t.split(/[?#]/, 1)[0];
  };
  const cell = String(reportCell ?? '').trim();
  const links = parseMarkdownLinks(cell).map(l => local(l.target)).filter(Boolean);
  if (links.length > 0) return [...new Set(links)];
  if (/\.md$/i.test(cell) && !/\s/.test(cell)) {
    const bare = local(cell);
    if (bare) return [bare];
  }
  const fromNotes = parseMarkdownLinks(String(notesCell ?? ''))
    .map(l => local(l.target))
    .filter(t => t && /(?:^|[\\/])reports[\\/]/i.test(t));
  return [...new Set(fromNotes)];
}

/** First existing file for a link, tried from each tracker dir, then the data root. */
function resolveReportPath(target, linkDirs, dataRoot) {
  const candidates = isAbsolute(target)
    ? [target]
    : [...new Set([...linkDirs.map(d => join(d, target)), join(dataRoot, target)])];
  for (const path of candidates) {
    try {
      if (statSync(path).isFile()) return path;
    } catch {
      // Absent here; try the next base.
    }
  }
  return null;
}

/** The evaluation date in a report's header block (before the first `---` or `## `). */
export function reportHeaderDate(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0 && (/^\s*-{3,}\s*$/.test(line) || /^##\s/.test(line))) break;
    const m = HEADER_DATE_RE.exec(line);
    if (m && isoDay(m[1])) return m[1];
  }
  return null;
}

function readReportHead(path) {
  try {
    return readFileSync(path).subarray(0, MAX_REPORT_BYTES).toString('utf-8');
  } catch {
    return null;
  }
}

/** Every `Re-eval YYYY-MM-DD` marker in a Notes cell, as valid ISO days. */
export function reevalMarkerDates(notes) {
  const out = [];
  REEVAL_MARKER_RE.lastIndex = 0;
  let m;
  while ((m = REEVAL_MARKER_RE.exec(String(notes ?? ''))) !== null) {
    if (isoDay(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * The date a row was last evaluated, and where it came from.
 *
 * @returns {{evaluated: string|null, evaluatedFrom: string[], reports: object[]}}
 *   `evaluatedFrom` names every input that carries the winning date;
 *   `reports` lists each linked report with whether it was found.
 */
export function rowEvaluationDate(row, { linkDirs, dataRoot }) {
  const dated = [];
  const column = isoDay(String(row.date ?? '').trim());
  if (column) dated.push({ date: column, from: 'date-column' });
  for (const date of reevalMarkerDates(row.notes)) dated.push({ date, from: 'notes-reeval' });

  const reports = [];
  for (const link of reportLinkTargets(row.report, row.notes)) {
    const path = resolveReportPath(link, linkDirs, dataRoot);
    const entry = { link, found: Boolean(path), date: null };
    if (path) {
      const header = reportHeaderDate(readReportHead(path));
      const fromName = isoDay(FILENAME_DATE_RE.exec(basename(path))?.[1] ?? '');
      if (header) {
        entry.date = header;
        dated.push({ date: header, from: 'report-header' });
      } else if (fromName) {
        entry.date = fromName;
        dated.push({ date: fromName, from: 'report-filename' });
      }
    }
    reports.push(entry);
  }

  if (dated.length === 0) return { evaluated: null, evaluatedFrom: [], reports };
  const evaluated = dated.reduce((max, d) => (d.date > max ? d.date : max), dated[0].date);
  const evaluatedFrom = [...new Set(dated.filter(d => d.date === evaluated).map(d => d.from))];
  return { evaluated, evaluatedFrom, reports };
}

/**
 * Compute the re-evaluation candidates from tracker markdown.
 *
 * @param {string} trackerMd
 * @param {object} opts
 * @param {object[]} opts.sources - From primarySourceChanges().
 * @param {Set<string>} opts.statuses - Canonical status labels to include.
 * @param {string[]} opts.linkDirs - Directories report links resolve from.
 * @param {string} opts.dataRoot
 */
export function computeReevalCandidates(trackerMd, { sources, statuses, linkDirs, dataRoot, states = loadStates() }) {
  const lines = String(trackerMd || '').replace(/\r\n/g, '\n').split('\n');
  const colmap = resolveColumns(lines);
  const present = sources.filter(s => s.exists && s.changed);

  const candidates = [];
  const undated = [];
  let rowsChecked = 0;

  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    const rawStatus = String(row.status || '').replace(/\*\*/g, '').trim();
    const status = resolveCanonicalState(rawStatus, states) ?? rawStatus;
    if (!statuses.has(status)) continue;
    rowsChecked++;

    const { evaluated, evaluatedFrom, reports } = rowEvaluationDate(row, { linkDirs, dataRoot });
    const primary = reports.find(r => r.date === evaluated) ?? reports[0] ?? null;
    const base = {
      num: row.num,
      company: row.company,
      role: row.role,
      score: row.score,
      status,
      report: primary ? primary.link : null,
      reportFound: primary ? primary.found : null,
    };
    if (reports.some(r => !r.found)) base.missingReports = reports.filter(r => !r.found).map(r => r.link);

    if (!evaluated) {
      undated.push({ ...base, reason: 'no ISO date in the Date column, Notes or a linked report' });
      continue;
    }

    const changedSince = present
      .filter(s => s.changed > evaluated)
      .sort((a, b) => b.changed.localeCompare(a.changed) || SOURCE_NAMES.indexOf(a.source) - SOURCE_NAMES.indexOf(b.source))
      .map(s => ({ source: s.source, changed: s.changed, basis: s.basis }));
    if (changedSince.length === 0) continue;

    candidates.push({ ...base, evaluated, evaluatedFrom, changedSince });
  }

  candidates.sort((a, b) => a.evaluated.localeCompare(b.evaluated) || a.num - b.num);
  undated.sort((a, b) => a.num - b.num);

  const latest = present.reduce((max, s) => (!max || s.changed > max.changed ? s : max), null);
  return {
    candidates,
    undated,
    rowsChecked,
    latestSourceChange: latest ? { source: latest.source, changed: latest.changed, basis: latest.basis } : null,
  };
}

// --- CLI ---

const KNOWN_FLAGS = ['--status', '--tracker', '--json', '--summary', '--help', '-h'];
const VALUE_FLAGS = ['--status', '--tracker'];

const USAGE = `Usage:
  node reeval-candidates.mjs                       # JSON report (default)
  node reeval-candidates.mjs --summary             # human-readable table
  node reeval-candidates.mjs --status <A[,B...]>   # canonical states to include (default ${DEFAULT_STATUS})
  node reeval-candidates.mjs --tracker <path>      # a different applications.md
  node reeval-candidates.mjs --help                # show this message

Lists tracker rows whose last evaluation predates the latest change to
cv.md, article-digest.md, config/profile.yml or modes/_profile.md (git commit
date when the file is committed, file mtime otherwise). Read-only: it never
re-evaluates and never writes to the tracker, a report or any other file.`;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function printSummary(report) {
  const { metadata, sources, candidates, undated } = report;
  const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}\u2026` : String(s));

  console.log(`\n${'='.repeat(86)}`);
  console.log('  Re-evaluation candidates \u2014 career-ops');
  const latest = metadata.latestSourceChange;
  console.log(`  Status: ${metadata.statuses.join(', ')} \u00b7 latest source change: ${latest ? `${latest.changed} (${latest.source})` : 'none found'}`);
  console.log(`${'='.repeat(86)}\n`);

  console.log('Primary sources:');
  for (const s of sources) {
    const when = s.exists ? s.changed : '\u2014';
    const basis = s.exists ? (s.basis === 'mtime' ? 'mtime (approximate)' : 'git commit') : 'missing';
    console.log(`  ${s.source.padEnd(20)}${when.padEnd(12)}${basis}`);
  }

  console.log(`\nScored before a later source change: ${candidates.length}`);
  if (candidates.length) {
    console.log(`  ${'#'.padEnd(5)}${'Company'.padEnd(20)}${'Role'.padEnd(26)}${'Score'.padEnd(8)}${'Evaluated'.padEnd(12)}Changed since`);
    for (const r of candidates) {
      const changed = r.changedSince.map(c => `${c.source} ${c.changed}${c.basis === 'mtime' ? '~' : ''}`).join(', ');
      console.log(`  ${String(r.num).padEnd(5)}${clip(r.company, 18).padEnd(20)}${clip(r.role, 24).padEnd(26)}${clip(r.score || '\u2014', 7).padEnd(8)}${r.evaluated.padEnd(12)}${changed}`);
      const report = r.report ? `${r.report}${r.reportFound ? '' : ' (missing)'}` : 'no report link';
      console.log(`  ${''.padEnd(5)}report: ${report}`);
    }
    console.log('  (~ = file mtime, approximate)');
  }

  console.log(`\nNo readable evaluation date: ${undated.length}`);
  for (const r of undated) {
    console.log(`  #${r.num} ${clip(r.company, 22)} \u2014 ${clip(r.role, 28)} (${r.reason})`);
  }
  console.log(`\nRows checked: ${metadata.rowsChecked}`);
  console.log('Read-only. To refresh a score, evaluate the posting again; the merge updates the row in place.\n');
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  if (hasFlag(args, '--json') && hasFlag(args, '--summary')) fail('Choose one of --json or --summary.');

  const valueOf = (flag) => (hasFlag(args, flag) ? flagValue(args, flag) : null);

  const states = loadStates();
  let statuses;
  try {
    statuses = resolveStatusFilter(valueOf('--status') ?? DEFAULT_STATUS, states);
  } catch (err) {
    fail(err.message);
  }

  const dataRoot = getCareerOpsRoot();
  const trackerArg = valueOf('--tracker');
  const trackerPath = trackerArg ? canonicalizeTrackerPath(trackerArg) : resolveTrackerPath(dataRoot);
  const linkDirs = trackerArg
    ? [...new Set([dirname(trackerPath), dirname(resolve(trackerArg))])]
    : trackerLinkDirsFor(dataRoot);

  const warnings = [];
  let trackerMd = '';
  if (existsSync(trackerPath)) {
    trackerMd = readFileSync(trackerPath, 'utf-8');
  } else {
    warnings.push(`No tracker found at ${trackerPath}; nothing to check.`);
  }

  const sources = primarySourceChanges(dataRoot);
  if (!sources.some(s => s.exists)) {
    warnings.push(`None of ${SOURCE_NAMES.join(', ')} was found under ${dataRoot}; nothing to compare against.`);
  }

  const result = computeReevalCandidates(trackerMd, { sources, statuses, linkDirs, dataRoot, states });
  const display = (path) => {
    const rel = relative(dataRoot, path);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split('\\').join('/') : path;
  };
  const report = {
    metadata: {
      statuses: [...statuses],
      rowsChecked: result.rowsChecked,
      candidates: result.candidates.length,
      undated: result.undated.length,
      latestSourceChange: result.latestSourceChange,
    },
    sources: sources.map(s => ({ ...s, path: display(s.path) })),
    candidates: result.candidates,
    undated: result.undated,
    warnings,
  };

  if (hasFlag(args, '--summary')) {
    printSummary(report);
    for (const w of warnings) console.log(w);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}
