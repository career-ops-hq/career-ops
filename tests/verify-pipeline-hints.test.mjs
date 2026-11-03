// tests/verify-pipeline-hints.test.mjs — every verify-pipeline finding carries a
// one-line fix hint (#5796).
//
//   1. static   — every error(...) and warn(...) call site in verify-pipeline.mjs
//                 passes a non-empty second argument, so a new check cannot be
//                 added without telling the user what to do about it.
//   2. runtime  — against a fixture tracker in a temp dir: findings are followed
//                 by an indented "→ fix:" line, a repeated kind prints its hint
//                 only once, `--no-hints` restores hint-free output, and neither
//                 the counts nor the exit code depend on hints.
//
// Fixtures live entirely in a temp dir (tracker + reports via the same env
// overrides the sibling verify-pipeline suites use). No dates are computed.
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync, codeMask } from './helpers.mjs';

console.log('\nverify-pipeline — fix hints under every error and warning (#5796)');

// --- 1. Static: every call site passes a hint --------------------------------
const SRC = readFileSync(join(ROOT, 'verify-pipeline.mjs'), 'utf-8');
// Scans `src` for error()/warn() calls. Only code characters count (strings,
// template text and comments are masked out by codeMask), so a comma or paren
// inside a message cannot confuse the argument split; code inside a ${...}
// substitution is balanced and is skipped by depth. `hinted` is true only when
// a second argument exists AND is not an empty/whitespace-only string literal:
// printHint silently drops those, so error('x', '') must not satisfy the check.
function scanCallSites(src) {
  const isCode = codeMask(src);
  const sites = [];
  for (const m of src.matchAll(/\b(error|warn)\s*\(/g)) {
    const at = m.index;
    if (!isCode[at]) continue;                                               // comment or string
    if (/function\s+$/.test(src.slice(Math.max(0, at - 12), at))) continue; // the declaration
    const open = at + m[0].length - 1;
    let depth = 0;
    let secondStart = -1;
    let secondEnd = -1;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (!isCode[i]) continue;
      if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) { if (secondStart >= 0 && secondEnd < 0) secondEnd = i; break; }
        continue;
      }
      if (depth === 1 && ch === ',') {
        if (secondStart < 0) secondStart = i + 1;
        else if (secondEnd < 0) secondEnd = i;
      }
    }
    const second = secondStart >= 0 ? src.slice(secondStart, secondEnd).trim() : '';
    const hinted = second !== '' && !/^(['"`])\s*\1$/.test(second);
    sites.push({ kind: m[1], line: src.slice(0, at).split('\n').length, hinted });
  }
  return sites;
}

const sites = scanCallSites(SRC);
if (sites.filter(s => s.kind === 'error').length >= 10 && sites.filter(s => s.kind === 'warn').length >= 10) {
  pass(`found ${sites.length} error()/warn() call sites to check`);
} else {
  fail(`call-site scan found too few sites (${sites.length}) — the scanner is broken`);
}
const unhinted = sites.filter(s => !s.hinted);
if (unhinted.length === 0) {
  pass('every error()/warn() call site passes a non-empty hint');
} else {
  fail(`call site(s) without a hint: ${unhinted.map(s => `${s.kind}() at verify-pipeline.mjs:${s.line}`).join(', ')}`);
}

// Negative fixtures: the scanner must reject missing and empty/blank hints.
const negVerdicts = scanCallSites([
  "error('no hint');",
  "warn ('spaced, no hint');",
  "error('empty', '');",
  'warn(`blank`, `  `);',
  "warn('ok', 'run node x.mjs');",
  "error(`t ${f(1, 2)}`, 'run it');",
].join('\n')).map(x => x.hinted).join(',');
if (negVerdicts === 'false,false,false,false,true,true') pass('scanner rejects a missing or empty/blank hint and accepts a real one');
else fail(`scanner verdicts wrong for negative fixtures: ${negVerdicts}`);

// --- 2. Runtime ---------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'co-vp-hints-'));
try {
  const reports = join(tmp, 'reports');
  mkdirSync(reports, { recursive: true });
  const tracker = join(tmp, 'applications.md');
  const row = (num, score, status, report) =>
    `| ${num} | 2026-01-01 | Co${num} | Role ${num} | ${score} | ${status} | ❌ | ${report} | — |\n`;
  writeFileSync(tracker,
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    // two dead report links (same kind), one score holding a status word
    row(1, '4.0/5', 'Evaluated', '[1](reports/001-gone-2026-01-01.md)') +
    row(2, '4.0/5', 'Evaluated', '[2](reports/002-gone-2026-01-01.md)') +
    row(3, 'Applied', 'Evaluated', '—'));

  const runVp = (extraArgs = []) => {
    const env = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_REPORTS: reports };
    try {
      const stdout = execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs'), ...extraArgs],
        { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
      return { status: 0, stdout };
    } catch (err) {
      return { status: typeof err.status === 'number' ? err.status : 1, stdout: typeof err.stdout === 'string' ? err.stdout : '' };
    }
  };
  const summary = (out) => (out.match(/Pipeline Health: (\d+) errors, (\d+) warnings/) || []).slice(1).join('/');
  const withoutHints = (out) => out.split('\n').filter(l => !/^ {3}→ fix: /.test(l)).join('\n');

  const on = runVp();
  const off = runVp(['--no-hints']);

  if (on.status === 1 && off.status === 1 && summary(on.stdout) !== '' && summary(on.stdout) === summary(off.stdout)) {
    pass(`exit code and counts are identical with and without hints (${summary(on.stdout)})`);
  } else {
    fail(`exit/counts differ with hints: on=${on.status} ${summary(on.stdout)} off=${off.status} ${summary(off.stdout)}`);
  }

  if (!/→ fix:/.test(off.stdout)) pass('--no-hints prints no hint lines');
  else fail('--no-hints still printed a hint line');

  if (withoutHints(on.stdout) === off.stdout) pass('hints only add lines: stripping them gives the --no-hints output byte-for-byte');
  else fail('hint output differs from --no-hints output beyond the hint lines');

  const lines = on.stdout.split('\n');
  const idx = lines.findIndex(l => l.startsWith('❌ #1: Report not found'));
  if (idx >= 0 && /^ {3}→ fix: .*fix-report-links\.mjs/.test(lines[idx + 1] || '')) {
    pass('a Report-not-found error is followed by its fix hint naming fix-report-links.mjs');
  } else {
    fail(`no fix hint under the Report-not-found error:\n${lines.slice(Math.max(0, idx), idx + 3).join('\n')}`);
  }

  const second = lines.findIndex(l => l.startsWith('❌ #2: Report not found'));
  if (second >= 0 && !/→ fix:/.test(lines[second + 1] || '')) {
    pass('a second finding of the same kind does not repeat the hint');
  } else {
    fail('the hint was repeated under every finding of the same kind');
  }
  if (lines.filter(l => /fix-report-links\.mjs/.test(l)).length === 1) {
    pass('the grouped hint is printed exactly once for both dead links');
  } else {
    fail('grouped hint printed an unexpected number of times');
  }

  const score = lines.findIndex(l => l.startsWith('❌ #3: Invalid score format'));
  if (score >= 0 && /^ {3}→ fix: /.test(lines[score + 1] || '')) {
    pass('a different kind of finding gets its own hint');
  } else {
    fail('Invalid-score error has no hint');
  }

  // Sync drift hints depend on WHICH file is stale: set-status.mjs only writes
  // applications.md, so it must not be offered for active-interviews.md.
  const root = join(tmp, 'sync-root');
  mkdirSync(join(root, 'data'), { recursive: true });
  const syncTracker = join(root, 'data', 'applications.md');
  writeFileSync(syncTracker,
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    row(1, '4.0/5', 'Applied', '—').replace('Co1 | Role 1', 'Alpha | Engineer') +
    row(2, '4.0/5', 'Rejected', '—').replace('Co2 | Role 2', 'Beta | Analyst'));
  writeFileSync(join(root, 'data', 'active-interviews.md'),
    '| Company | Role | Date | Status | Notes |\n' +
    '|---------|------|------|--------|-------|\n' +
    '| Alpha | Engineer | 2026-01-02 | Scheduled | x |\n' +
    '| Beta | Analyst | 2026-01-03 | Scheduled | x |\n');
  let syncOut = '';
  try {
    syncOut = execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], {
      cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: syncTracker, CAREER_OPS_REPORTS: reports },
    });
  } catch (err) { syncOut = typeof err.stdout === 'string' ? err.stdout : ''; }
  const syncLines = syncOut.split('\n');
  const hintAfter = (prefix) => {
    const i = syncLines.findIndex(l => l.includes(prefix));
    return i >= 0 ? (syncLines[i + 1] || '') : null;
  };
  const alphaHint = hintAfter('Sync drift (auto-resolvable): Alpha');
  const betaHint = hintAfter('Sync drift (auto-resolvable): Beta');
  if (alphaHint && /applications\.md is the stale file/.test(alphaHint) && /set-status\.mjs/.test(alphaHint)) {
    pass('sync drift with applications.md stale points to set-status.mjs');
  } else {
    fail(`wrong hint when applications.md is stale: ${alphaHint}`);
  }
  if (betaHint && /active-interviews\.md is the stale file/.test(betaHint) && /by hand/.test(betaHint) && !/node set-status\.mjs/.test(betaHint)) {
    pass('sync drift with active-interviews.md stale says to edit by hand, not set-status.mjs');
  } else {
    fail(`wrong hint when active-interviews.md is stale: ${betaHint}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
