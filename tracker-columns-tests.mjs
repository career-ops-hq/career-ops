#!/usr/bin/env node

/**
 * tracker-columns-tests.mjs — regression tests for header-name column mapping.
 *
 * merge-tracker.mjs and verify-pipeline.mjs used to parse applications.md by
 * fixed column position. Inserting a column (e.g. a Location column after Role)
 * shifted every later index by one — Location was read as Score, Score as
 * Status — so verify-pipeline flagged false errors and merge-tracker wrote
 * malformed rows. Both now map columns by header NAME (see #946).
 *
 * These tests provision a throwaway tracker + additions dir via the
 * CAREER_OPS_TRACKER / CAREER_OPS_ADDITIONS env overrides and assert:
 *   1. A 10-column tracker (with Location) merges a new row into the correct
 *      columns — Score/Status are NOT shifted, Location is populated.
 *   2. verify-pipeline reports a clean bill of health on that 10-column tracker.
 *   3. The original 9-column layout still works unchanged (back-compat).
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, utimesSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { resolveTsvColumns } from './tracker-parse.mjs';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

// web/ lives deliberately OUTSIDE the auto-updater's world (its own
// release-please component; see validate-system-paths-coverage.mjs
// EXCLUDE_PREFIXES), so installs updated via `update-system.mjs apply` have
// the core WITHOUT the web/ tree. The web-reader tests below exercise the
// real alias chain on fresh clones and CI, and skip cleanly on core-only
// installs instead of crashing the whole suite with ERR_MODULE_NOT_FOUND.
const HAS_WEB = existsSync(join(ROOT, 'web', 'src', 'lib', 'tracker-table.mjs'));
function skipWeb(m) { console.log(`SKIP ${m} — web/ not present (core-only install; web/ is excluded from the auto-updater by design)`); }

let passed = 0;
let failed = 0;
function pass(m) { console.log(`PASS ${m}`); passed++; }
function fail(m) { console.error(`FAIL ${m}`); failed++; }

// Run a script with tracker/additions redirected to a sandbox. Returns
// { code, stdout, stderr } — code is 0 on success, the process exit code
// otherwise. `stdout` folds in stderr on the failure path so an assertion
// message carries the reason; `stderr` is always the raw stream, which is where
// tracker.mjs puts its diagnostics so stdout stays pipeable.
function runScript(script, args, sandbox) {
  const env = {
    ...process.env,
    CAREER_OPS_TRACKER: sandbox.tracker,
    CAREER_OPS_ADDITIONS: sandbox.additions,
    CAREER_OPS_TRACKER_LOCK: sandbox.lock,
    // The derived SQLite index defaults to sitting beside the tracker it was
    // built from — pin it into the sandbox so a test run can never create one
    // next to the developer's real data (#3506).
    CAREER_OPS_TRACKER_DB: join(sandbox.dir, 'applications.db'),
    // Pinned for the same reason as the tracker: keep the fixture isolated from
    // the real reports/ dir. See makeSandbox.
    ...(sandbox.reports ? { CAREER_OPS_REPORTS: sandbox.reports } : {}),
  };
  try {
    const res = spawnSync(NODE, [join(ROOT, script), ...args], {
      cwd: ROOT, env, encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = res.stdout || '';
    const stderr = res.stderr || '';
    // A timeout still fills stdout/stderr, and `res.error` is a plain Error with
    // no `.status`/`.stdout` — rethrowing it into the catch below turned every
    // timeout into "code 1, no output", the exact reasonless failure the
    // fixture comments elsewhere in this file warn about (PR #3794 review).
    if (res.error) {
      const why = `${res.error.message}${res.signal ? ` (signal ${res.signal})` : ''}`;
      return { code: 1, stdout: `${stdout}${stderr}${why}`, stderr: `${stderr}${why}` };
    }
    if (res.status === 0) return { code: 0, stdout, stderr };
    return { code: res.status ?? 1, stdout: `${stdout}${stderr}`, stderr };
  } catch (e) {
    return { code: e.status ?? 1, stdout: `${e.stdout || ''}${e.stderr || ''}`, stderr: `${e.stderr || ''}` };
  }
}

// Sync the sandbox tracker into the tracker.mjs index and return one parsed
// row by company name (row is null when sync/query fails or the row is absent).
function syncAndQueryRow(sb, company) {
  const sync = runScript('tracker.mjs', ['sync'], sb);
  const query = runScript('tracker.mjs', ['query', '--json'], sb);
  let row = null;
  try { row = JSON.parse(query.stdout).find(r => r.company === company) ?? null; } catch { /* malformed output → null */ }
  return { sync, query, row };
}

// Create a sandbox dir holding a tracker file and an additions dir.
function makeSandbox(trackerContent, additions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-cols-'));
  const tracker = join(dir, 'applications.md');
  const additionsDir = join(dir, 'tracker-additions');
  const lock = join(dir, 'lock');
  // An empty reports dir belongs in the sandbox alongside the tracker. Without
  // it verify-pipeline scans the REAL reports/ dir and emits one "Orphan report"
  // warning per report not referenced by this fixture's tracker -- 213 of them
  // at 256 reports. That made Test 2 slow enough to trip its own 30s timeout
  // under full-suite load, failing ~2 runs in 5 as "tracker-columns-tests.mjs
  // crashed" while passing 8/8 in isolation. Same fixture bug as the #1704 block
  // in test-all.mjs (see PATCHES.md patch 10).
  const reportsDir = join(dir, 'reports');
  mkdirSync(additionsDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(tracker, trackerContent);
  for (const [name, content] of Object.entries(additions)) {
    writeFileSync(join(additionsDir, name), content);
  }
  return { dir, tracker, additions: additionsDir, lock, reports: reportsDir };
}

// Pin scan.mjs's extra dedupe sources inside the sandbox. The module-level
// paths are relative to process.cwd(), so an in-process call would otherwise
// read the developer's real data/scan-history.tsv and data/pipeline.md — CI
// only escapes that because both files are gitignored.
function sandboxSources(sb) {
  return {
    scanHistoryPath: join(sb.dir, 'scan-history.tsv'),
    pipelinePath: join(sb.dir, 'pipeline.md'),
  };
}

// Return the data rows of a tracker (pipe lines that aren't header/separator).
function dataRows(trackerPath) {
  return readFileSync(trackerPath, 'utf-8')
    .split('\n')
    .filter(l => l.startsWith('|') && !l.includes('---') && !/\bScore\b/.test(l));
}

const HEADER_10 = `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Engineer | Remote | 4.0/5 | Applied | ✅ | — | seed row |
`;

const HEADER_9 = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ✅ | — | seed row |
`;

// TSV column order (status BEFORE score): num,date,company,role,status,score,pdf,report,notes[,location]
const TSV_WITH_LOCATION = '2\t2026-02-02\tGlobex\tManager\tApplied\tN/A\t✅\t—\tnew row\tSingapore\n';
const TSV_NO_LOCATION = '2\t2026-02-02\tGlobex\tManager\tApplied\tN/A\t✅\t—\tnew row\n';

// ── Test 1: 10-column tracker merges into the correct columns ──────────────
{
  const sb = makeSandbox(HEADER_10, { '2-globex.tsv': TSV_WITH_LOCATION });
  const res = runScript('merge-tracker.mjs', [], sb);
  if (res.code !== 0) {
    fail(`merge into 10-col tracker exits 0 (got ${res.code})\n${res.stdout}`);
  } else {
    pass('merge into 10-col tracker exits 0');
    const row = dataRows(sb.tracker).find(l => l.includes('Globex'));
    const cells = row ? row.split('|').map(s => s.trim()) : [];
    // cells: ['', num, date, company, role, location, score, status, pdf, report, notes, '']
    if (cells[5] === 'Singapore') pass('Location column populated (not shifted into Score)');
    else fail(`Location column populated — got "${cells[5]}" in row: ${row}`);
    if (cells[6] === 'N/A') pass('Score sits in the Score column');
    else fail(`Score in Score column — got "${cells[6]}" in row: ${row}`);
    if (cells[7] === 'Applied') pass('Status sits in the Status column');
    else fail(`Status in Status column — got "${cells[7]}" in row: ${row}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 2: verify-pipeline is clean on a 10-column tracker ────────────────
{
  const sb = makeSandbox(HEADER_10);
  const res = runScript('verify-pipeline.mjs', [], sb);
  if (res.code === 0 && /0 errors/.test(res.stdout)) {
    pass('verify-pipeline clean on 10-col tracker (no false column errors)');
  } else {
    fail(`verify-pipeline clean on 10-col tracker (code ${res.code})\n${res.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 3: legacy 9-column layout still works (back-compat) ───────────────
{
  const sb = makeSandbox(HEADER_9, { '2-globex.tsv': TSV_NO_LOCATION });
  const merge = runScript('merge-tracker.mjs', [], sb);
  const verify = runScript('verify-pipeline.mjs', [], sb);
  const row = dataRows(sb.tracker).find(l => l.includes('Globex'));
  const cells = row ? row.split('|').map(s => s.trim()) : [];
  // cells: ['', num, date, company, role, score, status, pdf, report, notes, '']
  if (merge.code === 0 && cells[5] === 'N/A' && cells[6] === 'Applied') {
    pass('9-col tracker still merges into correct columns');
  } else {
    fail(`9-col tracker merge (code ${merge.code}) row: ${row}`);
  }
  if (verify.code === 0 && /0 errors/.test(verify.stdout)) {
    pass('verify-pipeline clean on legacy 9-col tracker');
  } else {
    fail(`verify-pipeline clean on 9-col tracker (code ${verify.code})\n${verify.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 4: tracker.mjs CLI maps a 10-column tracker by header (#1596) ──────
// tracker.mjs used a fixed 9-cell destructure, so a Location column shifted
// Score into Status and folded the real Notes cell away.
{
  const sb = makeSandbox(HEADER_10);
  const { sync, query, row } = syncAndQueryRow(sb, 'Acme');
  if (sync.code === 0 && query.code === 0 && row) {
    if (row.role === 'Engineer') pass('tracker.mjs: Role read from Role column on 10-col tracker');
    else fail(`tracker.mjs: Role on 10-col tracker — got "${row.role}"`);
    if (row.score === '4.0/5') pass('tracker.mjs: Score not shifted on 10-col tracker');
    else fail(`tracker.mjs: Score on 10-col tracker — got "${row.score}"`);
    if (row.status === 'Applied') pass('tracker.mjs: Status not shifted on 10-col tracker');
    else fail(`tracker.mjs: Status on 10-col tracker — got "${row.status}"`);
    if (row.notes === 'seed row') pass('tracker.mjs: Notes intact on 10-col tracker');
    else fail(`tracker.mjs: Notes on 10-col tracker — got "${row.notes}"`);
  } else {
    fail(`tracker.mjs sync/query on 10-col tracker (sync ${sync.code}, query ${query.code})\n${sync.stdout}${query.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 5: removeRowByNum resolves the Report column by header ─────────────
{
  const { removeRowByNum } = await import('./tracker.mjs');
  const tenCol = HEADER_10.replace('| — | seed row |', '| [1](reports/001-acme-2026-01-01.md) | seed row |');
  const res = removeRowByNum(tenCol, 1);
  if (res.removed && res.report === '[1](reports/001-acme-2026-01-01.md)') {
    pass('removeRowByNum: report column resolved by header on 10-col tracker');
  } else {
    fail(`removeRowByNum: report on 10-col tracker — got "${res.report}"`);
  }
}

// ── Test 6: scan.mjs seen-set maps company/role by header ───────────────────
// loadSeenCompanyRoles used a positional regex, so a 10-col tracker produced
// keys like "engineer::remote" and scan dedup missed real matches.
{
  const { loadSeenCompanyRoles } = await import('./scan.mjs');
  const sb = makeSandbox(HEADER_10);
  const seen = loadSeenCompanyRoles(sb.tracker, undefined, sandboxSources(sb));
  if (seen.has('acme::engineer')) pass('scan.mjs: seen-set keys company::role on 10-col tracker');
  else fail(`scan.mjs: seen-set on 10-col tracker — got [${[...seen].join(', ')}]`);
  if (![...seen].some(k => k.includes('remote') || k.includes('4.0/5'))) {
    pass('scan.mjs: seen-set has no shifted-column garbage keys');
  } else {
    fail(`scan.mjs: shifted keys present — [${[...seen].join(', ')}]`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 6b: normalize-statuses maps Status/Score/Notes by header (#1955) ───
// normalize-statuses.mjs read Status at parts[6], Score at parts[5] and Notes
// at parts[9]. On a 10-column tracker every one of those lands a column early:
// the Score cell was normalized as if it were a status — a `—` score (the
// tracker's own "no evaluation" sentinel) mapped to Discarded and OVERWROTE
// the Score column — while the real, non-canonical status was left untouched
// and reported as an unknown status instead.
{
  const TEN_COL_MESSY = `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Engineer | Remote | — | Aplicado 2026-01-02 | ✅ | — | backfilled, no eval |
| 2 | 2026-01-03 | Globex | Manager | Berlin | 4.5/5 | DUPLICADO de #1 | ❌ | — | keep me |
`;
  const sb = makeSandbox(TEN_COL_MESSY);
  const res = runScript('normalize-statuses.mjs', [], sb);
  const rows = dataRows(sb.tracker);
  const rowOf = (company) => rows.find(l => l.includes(company)) || '';
  const cellsOf = (company) => rowOf(company).split('|').map(s => s.trim());
  // cells: ['', num, date, company, role, location, score, status, pdf, report, notes, '']
  const acme = cellsOf('Acme');
  if (res.code === 0 && acme[7] === 'Applied' && acme[6] === '—') {
    pass('normalize-statuses: Status normalized in place on 10-col tracker, Score not clobbered');
  } else {
    fail(`normalize-statuses on 10-col tracker (code ${res.code}) row: ${rowOf('Acme')}\n${res.stdout}`);
  }
  const globex = cellsOf('Globex');
  if (globex[7] === 'Discarded' && globex[6] === '4.5/5'
      && globex[10].includes('DUPLICADO de #1') && globex[10].includes('keep me')) {
    pass('normalize-statuses: DUPLICADO provenance lands in the Notes column on 10-col tracker');
  } else {
    fail(`normalize-statuses DUPLICADO row on 10-col tracker: ${rowOf('Globex')}\n${res.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 7: schema contract — every consumer maps an UNKNOWN extra column ───
// The header-name contract (#1596): a column no consumer recognizes must be
// skipped by ALL of them, never silently shifted into a known field. This is
// the guard that makes the next column insertion a one-place change instead of
// a repo-wide incident.
{
  const HEADER_UNKNOWN = `# Applications Tracker

| # | Date | Company | Priority | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|----------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | high | Engineer | 4.0/5 | Applied | ✅ | — | seed row |
`;
  const sb = makeSandbox(HEADER_UNKNOWN);

  const verify = runScript('verify-pipeline.mjs', [], sb);
  if (verify.code === 0 && /0 errors/.test(verify.stdout)) {
    pass('contract: verify-pipeline skips an unknown extra column');
  } else {
    fail(`contract: verify-pipeline on unknown-column tracker (code ${verify.code})\n${verify.stdout}`);
  }

  const { sync, row } = syncAndQueryRow(sb, 'Acme');
  if (sync.code === 0 && row && row.role === 'Engineer' && row.score === '4.0/5' && row.status === 'Applied') {
    pass('contract: tracker.mjs skips an unknown extra column');
  } else {
    fail(`contract: tracker.mjs on unknown-column tracker — got ${JSON.stringify(row)}`);
  }

  const { loadSeenCompanyRoles } = await import('./scan.mjs');
  const seen = loadSeenCompanyRoles(sb.tracker, undefined, sandboxSources(sb));
  if (seen.has('acme::engineer') && seen.size === 1) {
    pass('contract: scan.mjs seen-set skips an unknown extra column');
  } else {
    fail(`contract: scan.mjs seen-set on unknown-column tracker — [${[...seen].join(', ')}]`);
  }

  // The seed status is already canonical, so a header-aware run is a strict
  // no-op: the file must come back byte-identical and nothing may be reported
  // as an unknown status.
  const before = readFileSync(sb.tracker, 'utf-8');
  const norm = runScript('normalize-statuses.mjs', [], sb);
  const after = readFileSync(sb.tracker, 'utf-8');
  if (norm.code === 0 && after === before && !/unknown statuses/.test(norm.stdout)) {
    pass('contract: normalize-statuses skips an unknown extra column');
  } else {
    fail(`contract: normalize-statuses on unknown-column tracker (code ${norm.code})\n${norm.stdout}`);
  }

  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 8: web read path resolves headers via the SHARED alias table ───────
// web/src/lib/tracker-table.mjs (behind readApplications() in career-ops.ts)
// loads tracker-aliases.json — the same file tracker-parse.mjs exports as
// HEADER_ALIASES — instead of mirroring it. Passing ROOT here exercises the
// REAL alias file, so an alias added/renamed there is either honored by the
// web reader too or fails this test; a second drifting table can't come back.
if (!HAS_WEB) {
  skipWeb('web reader: shared alias table tests');
} else {
  const { parseApplications, loadHeaderAliases } = await import('./web/src/lib/tracker-table.mjs');
  const { HEADER_ALIASES } = await import('./tracker-parse.mjs');
  const WEB_10COL = `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Priority | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|----------|-------|
| 1 | 2026-01-01 | Acme | Engineer | Remote | 4.0/5 | Applied | ✅ | — | high | seed row |
`;
  const rows = parseApplications(WEB_10COL, ROOT);
  const r = rows[0];
  if (rows.length === 1 && r.company === 'Acme' && r.role === 'Engineer') {
    pass('web reader: Company/Role read by header on 10-col tracker');
  } else {
    fail(`web reader: Company/Role on 10-col tracker — got ${JSON.stringify(r)}`);
  }
  if (r && r.score === '4.0/5' && r.status === 'Applied') {
    pass('web reader: Score/Status not shifted by Location column');
  } else {
    fail(`web reader: Score/Status on 10-col tracker — got ${JSON.stringify(r)}`);
  }
  if (r && r.notes === 'seed row') {
    pass('web reader: unknown Priority column skipped, Notes intact');
  } else {
    fail(`web reader: Notes past unknown column — got "${r && r.notes}"`);
  }
  // The web reader and the Node tooling must consume the IDENTICAL table.
  const webAliases = loadHeaderAliases(ROOT);
  if (JSON.stringify(webAliases) === JSON.stringify(HEADER_ALIASES) && Object.keys(webAliases).length > 0) {
    pass('web reader: alias table is byte-identical to tracker-parse HEADER_ALIASES');
  } else {
    fail(`web reader: alias table drifted from HEADER_ALIASES — web ${JSON.stringify(webAliases)} vs core ${JSON.stringify(HEADER_ALIASES)}`);
  }
}

// ═══ Stage 2 (#1596): Via column ════════════════════════════════════════════

const HEADER_VIA = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | — | Engineer | 4.0/5 | Applied | ✅ | — | direct seed row |
| 2 | 2026-01-05 | ? | Hays | Data Engineer | 4.2/5 | Applied | ✅ | — | fintech, Leeds |
`;

// ── Test 9: parseTrackerRow surfaces the Via column ─────────────────────────
{
  const { resolveColumns, parseTrackerRow } = await import('./tracker-parse.mjs');
  const lines = HEADER_VIA.split('\n');
  const colmap = resolveColumns(lines);
  const rows = lines.map(l => parseTrackerRow(l, colmap)).filter(Boolean);
  const direct = rows.find(r => r.num === 1);
  const blind = rows.find(r => r.num === 2);
  if (direct && direct.via === '—' && direct.role === 'Engineer' && direct.score === '4.0/5') {
    pass('parseTrackerRow: Via column mapped, later columns not shifted');
  } else {
    fail(`parseTrackerRow: Via layout — got ${JSON.stringify(direct)}`);
  }
  if (blind && blind.company === '?' && blind.via === 'Hays' && blind.status === 'Applied') {
    pass('parseTrackerRow: unknown-employer (?) row carries via');
  } else {
    fail(`parseTrackerRow: ? row — got ${JSON.stringify(blind)}`);
  }
}

// ── Test 10: TSV `via=` tagged field merges into the Via column ──────────────
// The batch TSV is header-less and positional; Via travels as a tagged extra
// field (`via=Hays`) instead of another positional slot, so a stale writer
// omitting the empty-location pad can't silently shift columns.
{
  const TSV_VIA = '3\t2026-02-02\t?\tPlatform Engineer\tApplied\t4.1/5\t✅\t—\tblind agency listing\tvia=Hays\n';
  const sb = makeSandbox(HEADER_VIA, { '3-blind.tsv': TSV_VIA });
  const res = runScript('merge-tracker.mjs', [], sb);
  const row = dataRows(sb.tracker).find(l => l.includes('Platform Engineer'));
  const cells = row ? row.split('|').map(s => s.trim()) : [];
  // cells: ['', num, date, company, via, role, score, status, pdf, report, notes, '']
  if (res.code === 0 && cells[3] === '?' && cells[4] === 'Hays' && cells[6] === '4.1/5' && cells[7] === 'Applied') {
    pass('merge: via= tag lands in the Via column, ? company preserved');
  } else {
    fail(`merge: via= tag (code ${res.code}) row: ${row}\n${res.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 11: ambiguous TSV extras are rejected loudly, never merged ─────────
{
  const TWO_UNTAGGED = '4\t2026-02-02\tGlobex\tManager\tApplied\tN/A\t✅\t—\tnote\tSingapore\tHays\n';
  const TWO_TAGS = '5\t2026-02-02\tGlobex\tManager\tApplied\tN/A\t✅\t—\tnote\tvia=Hays\tvia=Randstad\n';
  const sb = makeSandbox(HEADER_VIA, { '4-a.tsv': TWO_UNTAGGED, '5-b.tsv': TWO_TAGS });
  const res = runScript('merge-tracker.mjs', [], sb);
  const rows = dataRows(sb.tracker);
  // Rejection is loud on stderr; runScript only captures stdout on success, so
  // assert via the merge summary (2 skipped) plus the tracker staying clean.
  if (!rows.some(l => l.includes('Globex')) && /2 skipped/.test(res.stdout)) {
    pass('merge: ambiguous extras (two untagged / duplicate via=) rejected, not merged');
  } else {
    fail(`merge: ambiguous extras — rows: ${rows.length}\n${res.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 12: cross-channel guard — ? rows never fuzzy-merge across agencies ─
// Two blind listings for the same role via DIFFERENT agencies are distinct
// submissions (#1596): merging them silently is exactly the double-submission
// hazard the Via column exists to surface. Same agency + same role IS the
// re-blast duplicate and must still merge/update.
{
  const OTHER_AGENCY = '6\t2026-02-02\t?\tData Engineer\tApplied\t4.5/5\t✅\t—\tsame role, other agency\tvia=Randstad\n';
  const SAME_AGENCY = '7\t2026-02-03\t?\tData Engineer\tApplied\t4.6/5\t✅\t—\tre-blast, higher score\tvia=Hays\n';
  const sb = makeSandbox(HEADER_VIA, { '6-other.tsv': OTHER_AGENCY });
  const res1 = runScript('merge-tracker.mjs', [], sb);
  const rowsAfter1 = dataRows(sb.tracker).filter(l => l.includes('Data Engineer'));
  if (res1.code === 0 && rowsAfter1.length === 2 && rowsAfter1.some(l => l.includes('Randstad'))) {
    pass('merge: ? row via a different agency added as a NEW row (no cross-channel merge)');
  } else {
    fail(`merge: cross-channel guard — ${rowsAfter1.length} Data Engineer rows\n${res1.stdout}`);
  }
  writeFileSync(join(sb.additions, '7-same.tsv'), SAME_AGENCY);
  const res2 = runScript('merge-tracker.mjs', [], sb);
  const hays = dataRows(sb.tracker).filter(l => l.includes('Hays') && l.includes('Data Engineer'));
  if (res2.code === 0 && hays.length === 1 && hays[0].includes('4.6/5')) {
    pass('merge: same-agency re-blast updates the existing ? row (Via preserved)');
  } else {
    fail(`merge: same-agency update — ${hays.length} Hays rows: ${hays.join(' / ')}\n${res2.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 12b: legacy 9-col tracker — via= tag dropped WITHOUT breaking dedup ─
// The tracker has no Via column, so existing rows parse with via=''. The
// addition's via must be cleared before duplicate matching, or the
// cross-channel guard would see 'Hays' ≠ '' and add a second ? row instead of
// updating the same-agency re-blast.
{
  const FIRST = '2\t2026-02-02\t?\tData Engineer\tApplied\t4.1/5\t✅\t—\tblind listing\tvia=Hays\n';
  const REBLAST = '3\t2026-02-10\t?\tData Engineer\tApplied\t4.3/5\t✅\t—\tre-blast, higher score\tvia=Hays\n';
  const sb = makeSandbox(HEADER_9, { '2-first.tsv': FIRST });
  const res1 = runScript('merge-tracker.mjs', [], sb);
  writeFileSync(join(sb.additions, '3-reblast.tsv'), REBLAST);
  const res2 = runScript('merge-tracker.mjs', [], sb);
  const blind = dataRows(sb.tracker).filter(l => l.includes('Data Engineer'));
  if (res1.code === 0 && res2.code === 0 && blind.length === 1 && blind[0].includes('4.3/5') && /1 updated/.test(res2.stdout)) {
    pass('merge: legacy 9-col tracker — via= re-blast UPDATES the ? row (no duplicate)');
  } else {
    fail(`merge: legacy via= dedup — ${blind.length} rows: ${blind.join(' / ')}\n${res2.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 13: --migrate-via inserts the column, idempotently ─────────────────
{
  const sb = makeSandbox(HEADER_9);
  const first = runScript('merge-tracker.mjs', ['--migrate-via'], sb);
  const content = readFileSync(sb.tracker, 'utf-8');
  const header = content.split('\n').find(l => l.includes('Company'));
  const seed = content.split('\n').find(l => l.includes('Acme'));
  const headCells = header ? header.split('|').map(s => s.trim()) : [];
  const seedCells = seed ? seed.split('|').map(s => s.trim()) : [];
  if (first.code === 0 && headCells[4] === 'Via' && headCells[3] === 'Company' && seedCells[4] === '—' && seedCells[6] === '4.0/5') {
    pass('--migrate-via: Via column inserted after Company, rows padded with —');
  } else {
    fail(`--migrate-via: header "${header}" seed "${seed}"\n${first.stdout}`);
  }
  const second = runScript('merge-tracker.mjs', ['--migrate-via'], sb);
  if (second.code === 0 && readFileSync(sb.tracker, 'utf-8') === content) {
    pass('--migrate-via: idempotent (second run changes nothing)');
  } else {
    fail(`--migrate-via: not idempotent\n${second.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 14: dedup — unknown-employer rows key on Via + role + 90-day window ─
{
  const BLIND_TRACKER = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-05 | ? | Hays | Data Engineer | 4.2/5 | Evaluated | ✅ | — | fintech, Leeds |
| 2 | 2026-01-20 | ? | Hays | Data Engineer | 4.3/5 | Evaluated | ✅ | — | re-blast of same listing |
| 3 | 2026-01-06 | ? | Randstad | Data Engineer | 4.0/5 | Evaluated | ✅ | — | different channel |
| 4 | 2026-01-10 | ? | Hays | Platform Engineer | 3.9/5 | Evaluated | ✅ | — | old listing |
| 5 | 2026-06-01 | ? | Hays | Platform Engineer | 4.4/5 | Evaluated | ✅ | — | far outside window |
`;
  const sb = makeSandbox(BLIND_TRACKER);
  const res = runScript('dedup-tracker.mjs', [], sb);
  const rows = dataRows(sb.tracker);
  const dataEng = rows.filter(l => l.includes('Data Engineer'));
  const platform = rows.filter(l => l.includes('Platform Engineer'));
  if (res.code === 0 && dataEng.length === 2 && dataEng.some(l => l.includes('Randstad')) && dataEng.some(l => l.includes('4.3/5'))) {
    pass('dedup: same-agency re-blast within 90d deduped; other agency kept');
  } else {
    fail(`dedup: blind keying — ${dataEng.length} Data Engineer rows:\n${dataEng.join('\n')}\n${res.stdout}`);
  }
  if (platform.length === 2) {
    pass('dedup: same agency+role >90 days apart NOT deduped');
  } else {
    fail(`dedup: window — ${platform.length} Platform Engineer rows\n${res.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 15: verify-pipeline Via checks ─────────────────────────────────────
{
  const VIA_ISSUES = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-05 | ? | — | Data Engineer | 4.2/5 | Evaluated | ✅ | — | blind row, no agency |
| 2 | 2026-01-06 | Confidential | Hays | ML Engineer | 4.0/5 | Evaluated | ✅ | — | word placeholder |
| 3 | 2026-01-07 | Acme | Hays | Backend Engineer | 4.1/5 | Applied | ✅ | — | via agency |
| 4 | 2026-01-08 | Acme | — | Backend Engineer | 4.1/5 | Applied | ✅ | — | direct too |
`;
  const sb = makeSandbox(VIA_ISSUES);
  const res = runScript('verify-pipeline.mjs', [], sb);
  if (/unknown employer \(\?\) with no Via/.test(res.stdout)) {
    pass('verify: ? row with no Via channel is an error');
  } else {
    fail(`verify: ?-without-via\n${res.stdout}`);
  }
  if (/looks like a confidentiality placeholder/.test(res.stdout)) {
    pass('verify: localized confidentiality word linted toward ?');
  } else {
    fail(`verify: confidentiality lint\n${res.stdout}`);
  }
  if (/Cross-channel duplicate/.test(res.stdout)) {
    pass('verify: same company+role via different channels warned');
  } else {
    fail(`verify: cross-channel warning\n${res.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 16: web alias cache refreshes on change, never caches failure ──────
// loadHeaderAliases caches per file to avoid a disk read+parse per request
// (readApplications runs on every API route / page render), but the cache is
// mtime-keyed: a missing/corrupt file is NEVER cached — recovery is picked up
// without a server restart — and a rewritten file (system update changing the
// alias table) is re-read on the next call.
if (!HAS_WEB) {
  skipWeb('web reader: alias cache refresh tests');
} else {
  const { loadHeaderAliases } = await import('./web/src/lib/tracker-table.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'co-alias-'));
  const aliasFile = join(dir, 'tracker-aliases.json');
  // Force distinct mtimes between rewrites — same-ms writes are otherwise
  // indistinguishable on coarse-timestamp filesystems.
  let tick = Date.now();
  const bump = () => { tick += 2000; const t = new Date(tick); utimesSync(aliasFile, t, t); };

  // (a) missing file → {} and NOT cached: creating the file afterwards is seen.
  const missing = loadHeaderAliases(dir);
  writeFileSync(aliasFile, JSON.stringify({ '#': 'num', 'company': 'company' }));
  const recovered = loadHeaderAliases(dir);
  if (Object.keys(missing).length === 0 && recovered['#'] === 'num' && recovered.company === 'company') {
    pass('web reader: alias file created after a failed load is picked up (no restart)');
  } else {
    fail(`web reader: recovery after missing file — first ${JSON.stringify(missing)}, then ${JSON.stringify(recovered)}`);
  }

  // (b) file rewritten → new aliases visible without a process restart.
  writeFileSync(aliasFile, JSON.stringify({ '#': 'num', 'req id': 'num' }));
  bump();
  const updated = loadHeaderAliases(dir);
  if (updated['req id'] === 'num' && updated.company === undefined) {
    pass('web reader: rewritten alias file is re-read (mtime-keyed cache)');
  } else {
    fail(`web reader: update not visible without restart — got ${JSON.stringify(updated)}`);
  }

  // (c) corrupt file → {} safely, and NOT cached: fixing it is seen.
  writeFileSync(aliasFile, '{ not json');
  bump();
  const corrupt = loadHeaderAliases(dir);
  writeFileSync(aliasFile, JSON.stringify({ '#': 'num' }));
  bump();
  const fixed = loadHeaderAliases(dir);
  if (Object.keys(corrupt).length === 0 && fixed['#'] === 'num') {
    pass('web reader: corrupt alias file yields {} and later fix is picked up');
  } else {
    fail(`web reader: corrupt handling — during ${JSON.stringify(corrupt)}, after fix ${JSON.stringify(fixed)}`);
  }

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 17: pipe rows preserve empty interior cells ──────────────────────
{
  const EMPTY_PDF = '| 42 | 2026-01-01 | Foo | Bar Engineer | 4.0/5 | Evaluated |  | [42](reports/042-foo-2026-01-01.md) | some note |';
  const EMPTY_NOTES = '| 43 | 2026-01-02 | Baz | Platform Engineer | 4.1/5 | Evaluated | ✅ | [43](reports/043-baz-2026-01-02.md) |  | Singapore';
  const sb = makeSandbox(HEADER_10, { '42-foo.tsv': EMPTY_PDF, '43-baz.tsv': EMPTY_NOTES });
  const res = runScript('merge-tracker.mjs', [], sb);
  const foo = dataRows(sb.tracker).find(l => l.includes('Foo'));
  const baz = dataRows(sb.tracker).find(l => l.includes('Baz'));
  const fooCells = foo ? foo.split('|').map(s => s.trim()) : [];
  const bazCells = baz ? baz.split('|').map(s => s.trim()) : [];
  if (res.code === 0 && fooCells[8] === '' && fooCells[9] === '[42](reports/042-foo-2026-01-01.md)' && fooCells[10] === 'some note') {
    pass('merge: empty PDF cell does not shift Report or Notes');
  } else {
    fail(`merge: empty PDF cell shifted columns (code ${res.code}) row: ${foo}\n${res.stdout}`);
  }
  if (res.code === 0 && bazCells[5] === 'Singapore' && bazCells[10] === '') {
    pass('merge: empty Notes cell does not shift a later Location');
  } else {
    fail(`merge: empty Notes cell shifted Location (code ${res.code}) row: ${baz}\n${res.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 18: web reader honors the core's row-shape contract (#2369) ────────
// The web reader mirrors parseTrackerRow's LOGIC (not just its alias table),
// so it must agree with the core on which rows are readable at all:
//   a) a row missing an INTERIOR cell shifts every later column one left, so
//      the core REJECTS it (dynamic width guard in parseTrackerRow). The web
//      reader used to accept it and render Score in the Role column.
//   b) a hand-edited row WITHOUT the trailing pipe is one part narrower but
//      complete (tracker-utils rebuildRow supports them), so the core reads
//      its last cell. The web reader used to drop it via slice(1, -1).
// Realistic trigger for (a): a row written before `merge-tracker --migrate-via`
// widened the header, so it carries no Via cell.
if (!HAS_WEB) {
  skipWeb('web reader: row-shape contract tests');
} else {
  const { parseApplications } = await import('./web/src/lib/tracker-table.mjs');
  const { resolveColumns, parseTrackerRow } = await import('./tracker-parse.mjs');
  const VIA_HEADER = [
    '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|-----|------|-------|--------|-----|--------|-------|',
  ];
  const coreRows = (md) => {
    const lines = md.split('\n');
    const cm = resolveColumns(lines);
    return lines.map(l => parseTrackerRow(l.trim(), cm)).filter(Boolean);
  };

  // (a) pre-migration row: 9 cells under a 10-column header.
  const SHIFTED = [
    ...VIA_HEADER,
    '| 12 | 2026-01-01 | Acme | Hays | Engineer | 4.5/5 | Applied | ✅ | — | agency |',
    '| 13 | 2026-01-02 | Globex | Engineer | 4.0/5 | Applied | ✅ | — | pre-migration |',
  ].join('\n');
  const shiftedWeb = parseApplications(SHIFTED, ROOT);
  const shiftedCore = coreRows(SHIFTED);
  if (shiftedWeb.length === shiftedCore.length && shiftedWeb.every(r => r.n !== '13')) {
    pass('web reader: row missing an interior cell is rejected, like the core');
  } else {
    fail(`web reader: accepted a short row — web ${JSON.stringify(shiftedWeb.map(r => r.n))} vs core ${JSON.stringify(shiftedCore.map(r => String(r.num)))}`);
  }
  // The complete row next to it must still parse, unshifted.
  const good = shiftedWeb.find(r => r.n === '12');
  if (good && good.via === 'Hays' && good.role === 'Engineer' && good.score === '4.5/5' && good.status === 'Applied') {
    pass('web reader: the complete Via row next to it stays unshifted');
  } else {
    fail(`web reader: complete Via row misread — got ${JSON.stringify(good)}`);
  }

  // (b) no trailing pipe — the last cell is data, not padding.
  const NO_TRAILING_PIPE = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 5 | 2026-01-01 | Acme | Engineer | 4.5/5 | Applied | ✅ | — | last note',
  ].join('\n');
  const tailWeb = parseApplications(NO_TRAILING_PIPE, ROOT)[0];
  const tailCore = coreRows(NO_TRAILING_PIPE)[0];
  if (tailWeb && tailCore && tailWeb.notes === tailCore.notes && tailWeb.notes === 'last note') {
    pass('web reader: row without a trailing pipe keeps its last cell');
  } else {
    fail(`web reader: dropped the last cell — web "${tailWeb && tailWeb.notes}" vs core "${tailCore && tailCore.notes}"`);
  }
}

// ── Headed tracker additions (#3517) ───────────────────────────────────────
// The TSV ingest format wrote status BEFORE score while applications.md shows
// score BEFORE status, and the two were reconciled by identifying the score
// cell by CONTENT (`looksLikeScoreCell`). That discriminator has an
// undecidable case in this repo's own conventions: `—` is a score sentinel
// (#1799) AND a status meaning Discarded (normalize-statuses.mjs), so a
// discarded, never-scored row carries `—` in both cells and no content rule can
// order them. Additions may now carry a HEADER row, after which columns resolve
// by NAME through the same alias table as the tracker, and no order is
// privileged. Headerless files keep the legacy positional path untouched.
const HEADED_SCORE_FIRST_DASHES =
  'num\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes\n' +
  '2\t2026-02-02\tGlobex\tManager\t—\t—\t❌\t—\tdiscarded, never scored\n';
const HEADED_STATUS_FIRST_DASHES =
  'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
  '2\t2026-02-02\tGlobex\tManager\t—\t—\t❌\t—\tdiscarded, never scored\n';
const HEADERLESS_DASHES =
  '2\t2026-02-02\tGlobex\tManager\t—\t—\t❌\t—\tdiscarded, never scored\n';

// Like runScript, but merges stderr into the captured output. merge-tracker
// exits 0 when it SKIPS a malformed addition (other files in the run still
// merge), and every refusal message is a console.warn — so the assertions below
// would see nothing at all on the path they exist to check.
function runCaptured(script, sandbox) {
  const r = spawnSync(NODE, [join(ROOT, script)], {
    cwd: ROOT,
    env: {
      ...process.env,
      CAREER_OPS_TRACKER: sandbox.tracker,
      CAREER_OPS_ADDITIONS: sandbox.additions,
      CAREER_OPS_TRACKER_LOCK: sandbox.lock,
      ...(sandbox.reports ? { CAREER_OPS_REPORTS: sandbox.reports } : {}),
    },
    encoding: 'utf-8',
    timeout: 30000,
  });
  return { code: r.status ?? 1, stdout: `${r.stdout || ''}${r.stderr || ''}` };
}

// Merge one addition into a 9-column tracker and return { merge, row, cells }.
// cells: ['', num, date, company, role, score, status, pdf, report, notes, '']
function mergeOne(tsv, name = '2-globex.tsv') {
  const sb = makeSandbox(HEADER_9, { [name]: tsv });
  const merge = runCaptured('merge-tracker.mjs', sb);
  const row = dataRows(sb.tracker).find(l => l.includes('Globex')) || null;
  const cells = row ? row.split('|').map(s => s.trim()) : [];
  rmSync(sb.dir, { recursive: true, force: true });
  return { merge, row, cells };
}

// The exact case the maintainer named: `—` / `—` in BOTH orders. Both merge
// under a header; neither is decidable without one.
{
  const scoreFirst = mergeOne(HEADED_SCORE_FIRST_DASHES);
  if (scoreFirst.merge.code === 0 && scoreFirst.row) {
    pass('headed addition, score-first, — / — in both cells merges');
  } else {
    fail(`headed score-first — / — merges (code ${scoreFirst.merge.code})\n${scoreFirst.merge.stdout}`);
  }

  const statusFirst = mergeOne(HEADED_STATUS_FIRST_DASHES);
  if (statusFirst.merge.code === 0 && statusFirst.row) {
    pass('headed addition, status-first, — / — in both cells merges');
  } else {
    fail(`headed status-first — / — merges (code ${statusFirst.merge.code})\n${statusFirst.merge.stdout}`);
  }

  // Same bytes without the header: still refused, loudly. This is the
  // regression the header form exists to remove — pinned so the headerless
  // path is never "fixed" by guessing an order.
  const headerless = mergeOne(HEADERLESS_DASHES);
  if (!headerless.row && /cannot tell score from status/.test(headerless.merge.stdout)) {
    pass('headerless — / — is still refused, not guessed');
  } else {
    fail(`headerless — / — refused — row: ${headerless.row}\n${headerless.merge.stdout}`);
  }
}

// Distinguishable values, both header orders: the header alone decides which
// tracker column each value lands in.
{
  const scoreFirst = mergeOne(
    'num\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tManager\t4.5/5\tApplied\t❌\t—\tscore-first\n',
  );
  if (scoreFirst.cells[5] === '4.5/5' && scoreFirst.cells[6] === 'Applied') {
    pass('headed score-first: Score and Status land in their own columns');
  } else {
    fail(`headed score-first landing — row: ${scoreFirst.row}\n${scoreFirst.merge.stdout}`);
  }

  const statusFirst = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t—\tstatus-first\n',
  );
  if (statusFirst.cells[5] === '4.5/5' && statusFirst.cells[6] === 'Applied') {
    pass('headed status-first: Score and Status land in their own columns');
  } else {
    fail(`headed status-first landing — row: ${statusFirst.row}\n${statusFirst.merge.stdout}`);
  }
}

// An emitter whose LABELS and VALUES disagree is the silent swap in a new
// costume. The header is authoritative, so the row is refused rather than
// quietly un-swapped by content — the same answer the headerless path gives.
{
  const swapped = mergeOne(
    'num\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t—\tlabels and values disagree\n',
  );
  if (!swapped.row && /labelled "score"/.test(swapped.merge.stdout)) {
    pass('headed addition whose values contradict its labels is refused');
  } else {
    fail(`labels-vs-values mismatch refused — row: ${swapped.row}\n${swapped.merge.stdout}`);
  }
}

// Malformed headers report at the header instead of merging a shifted row.
{
  const missing = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t❌\t—\tno score column\n',
  );
  if (!missing.row && /missing required column\(s\): score/.test(missing.merge.stdout)) {
    pass('headed addition missing a required column is refused at the header');
  } else {
    fail(`missing-column header refused — row: ${missing.row}\n${missing.merge.stdout}`);
  }

  const duplicated = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tscore\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t—\t4.0/5\n',
  );
  if (!duplicated.row && /same column twice/.test(duplicated.merge.stdout)) {
    pass('headed addition labelling one field twice is refused');
  } else {
    fail(`duplicate-label header refused — row: ${duplicated.row}\n${duplicated.merge.stdout}`);
  }

  const twoRows = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t—\tfirst\n' +
    '3\t2026-02-03\tInitech\tArchitect\tApplied\t4.0/5\t❌\t—\tsecond\n',
  );
  if (!twoRows.row && /one addition per file/.test(twoRows.merge.stdout)) {
    pass('headed addition with two data rows is refused, not silently truncated');
  } else {
    fail(`two-data-row file refused — row: ${twoRows.row}\n${twoRows.merge.stdout}`);
  }
}

// Optional columns resolve by name too: no positional trailing-field rules, and
// a placeholder in an optional column reads as absent rather than as content.
{
  const sb = makeSandbox(
    `# Applications Tracker

| # | Date | Company | Via | Role | Location | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|-----|------|----------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | Acme | — | Engineer | Remote | 4.0/5 | Applied | ✅ | — | seed row | — |
`,
    {
      '2-globex.tsv':
        'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\tvia\tlocation\turl\n' +
        '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t—\tvia a header\tHays\tSingapore\thttps://example.com/jobs/2\n',
      '3-initech.tsv':
        'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\tvia\turl\n' +
        '3\t2026-02-03\tInitech\tArchitect\tApplied\t4.0/5\t❌\t—\tno agency\tN/A\tTBD\n',
    },
  );
  const merge = runCaptured('merge-tracker.mjs', sb);
  const rows = dataRows(sb.tracker);
  const globex = (rows.find(l => l.includes('Globex')) || '').split('|').map(s => s.trim());
  const initech = (rows.find(l => l.includes('Initech')) || '').split('|').map(s => s.trim());
  // cells: ['', num, date, company, via, role, location, score, status, pdf, report, notes, url, '']
  if (merge.code === 0 && globex[4] === 'Hays' && globex[6] === 'Singapore' && globex[7] === '4.5/5' && globex[8] === 'Applied' && globex[12] === 'https://example.com/jobs/2') {
    pass('headed addition fills Via / Location / URL by name');
  } else {
    fail(`headed optional columns — row: ${globex.join(' | ')}\n${merge.stdout}`);
  }
  // Via fills with '—'; the URL column's documented empty form is a blank cell.
  if (initech[4] === '—' && initech[12] === '') {
    pass('placeholder values in optional headed columns read as absent');
  } else {
    fail(`headed placeholder handling — row: ${initech.join(' | ')}\n${merge.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// A pasted markdown table row may carry a header too — same resolution.
{
  const piped = mergeOne(
    '| # | Date | Company | Role | Status | Score | PDF | Report | Notes |\n' +
    '| 2 | 2026-02-02 | Globex | Manager | Applied | 4.5/5 | ❌ | — | pipe-delimited header |\n',
  );
  if (piped.cells[5] === '4.5/5' && piped.cells[6] === 'Applied') {
    pass('pipe-delimited addition with a header resolves by name');
  } else {
    fail(`pipe-delimited headed addition — row: ${piped.row}\n${piped.merge.stdout}`);
  }
}

// Back-compat: the documented headerless 9-column form is untouched.
{
  const legacy = mergeOne(TSV_NO_LOCATION);
  if (legacy.cells[5] === 'N/A' && legacy.cells[6] === 'Applied') {
    pass('headerless 9-column addition still merges unchanged');
  } else {
    fail(`headerless back-compat — row: ${legacy.row}\n${legacy.merge.stdout}`);
  }
}

// ── an empty trailing cell is not a missing cell (#3517 review) ────────────
// A writer whose last value is empty routinely stops at the last tab —
// openrouter-runner emits `…\treport\t\n` for an absent note — and the whole
// file used to be trimmed before parsing, so that tab (which IS the final
// empty cell) was gone and the row read as one cell short of its own header.
// These are the exact bytes the converted writers emit.
{
  const trailingTab = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\t(see report)\tEvaluated\t4.5/5\t❌\t[2](reports/2.md)\t\n',
  );
  if (trailingTab.cells[5] === '4.5/5' && trailingTab.cells[6] === 'Evaluated') {
    pass('headed row ending in an empty cell (trailing tab) merges');
  } else {
    fail(`trailing-empty-cell row — row: ${trailingTab.row}\n${trailingTab.merge.stdout}`);
  }

  // Absent and empty must read the same, which is what the batch and web
  // prompts already promise: "leave the last field empty".
  const noTrailingTab = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tManager\tEvaluated\t4.5/5\t❌\t[2](reports/2.md)\n',
  );
  if (noTrailingTab.cells[5] === '4.5/5' && noTrailingTab.cells[6] === 'Evaluated') {
    pass('headed row omitting its empty trailing cell merges the same way');
  } else {
    fail(`omitted-trailing-cell row — row: ${noTrailingTab.row}\n${noTrailingTab.merge.stdout}`);
  }

  // Only OPTIONAL cells may be absent. A row short of a required one is still
  // refused, and says which.
  const shortRequired = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tManager\tEvaluated\t4.0/5\n',
  );
  if (!shortRequired.row && /missing the required cell\(s\): pdf, report/.test(shortRequired.merge.stdout)) {
    pass('headed row missing required cells is refused, naming them');
  } else {
    fail(`short-required row refused — row: ${shortRequired.row}\n${shortRequired.merge.stdout}`);
  }

  // The width rule is not the shift defense, so prove the shift is still
  // caught: omit an INTERIOR cell (role) and every later value slides one
  // column left, which the score corroboration sees by content. No `url` label
  // here, so the misplaced-URL guard below cannot be what catches it — this
  // pins the score check specifically.
  const shifted = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tEvaluated\t4.0/5\t❌\t[2](reports/2.md)\tnote\n',
  );
  if (!shifted.row && /labelled "score"/.test(shifted.merge.stdout)) {
    pass('headed row with an omitted interior cell is caught by content, not width');
  } else {
    fail(`interior-omission row refused — row: ${shifted.row}\n${shifted.merge.stdout}`);
  }
}

// ── what the optional-cell leniency must NOT wave through (#3517 review) ───
// Accepting a short row (absent optional cells read as empty) buys two new
// ambiguities, and both corrupt exactly the mapping the header protects.
{
  // A blank REQUIRED cell is not "none": every required field has a documented
  // value, and the no-data cases have sentinels. Left through, an empty status
  // reaches validateStatus(''), which returns "Evaluated" — a real evaluation
  // state the row never claimed.
  const blankStatus = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tManager\t\t4.0/5\t❌\t[2](reports/2.md)\tnote\n',
  );
  if (!blankStatus.row && /required cell\(s\) present but empty: status/.test(blankStatus.merge.stdout)) {
    pass('headed row with a blank required cell is refused, not defaulted');
  } else {
    fail(`blank-required-cell row — row: ${blankStatus.row}\n${blankStatus.merge.stdout}`);
  }

  // "notes omitted, url written" and "notes written, url omitted" are both one
  // cell short, so position cannot tell them apart. The typed column is the
  // corroboration: a cell that IS a URL under a non-url label, while `url` has
  // no cell, means every optional value sits one column left of its label.
  const shiftedTail = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t[2](reports/2.md)\thttps://example.com/jobs/2\n',
  );
  if (!shiftedTail.row && /a URL sits under "notes"/.test(shiftedTail.merge.stdout)) {
    pass('headed row whose optional tail is shifted (URL in notes) is refused');
  } else {
    fail(`shifted-optional-tail row — row: ${shiftedTail.row}\n${shiftedTail.merge.stdout}`);
  }

  // ...and the shapes that are NOT ambiguous still merge. Written placeholder
  // for the omitted note:
  const placeheld = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t4.1/5\t❌\t[2](reports/2.md)\t\thttps://example.com/jobs/2\n',
  );
  if (placeheld.cells[5] === '4.1/5' && placeheld.cells[6] === 'Applied') {
    pass('headed row with an empty placeholder before a supplied URL merges');
  } else {
    fail(`placeholder-then-url row — row: ${placeheld.row}\n${placeheld.merge.stdout}`);
  }

  // Both optional cells simply absent — nothing is shifted, nothing is lost:
  const bothAbsent = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t4.2/5\t❌\t[2](reports/2.md)\n',
  );
  if (bothAbsent.cells[5] === '4.2/5' && bothAbsent.cells[6] === 'Applied') {
    pass('headed row omitting every optional cell merges');
  } else {
    fail(`both-optionals-absent row — row: ${bothAbsent.row}\n${bothAbsent.merge.stdout}`);
  }

  // A note that MENTIONS a url in prose is a note. The guard is anchored to the
  // whole cell, so only a cell that IS a URL trips it.
  const urlInProse = mergeOne(
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t4.3/5\t❌\t[2](reports/2.md)\tsee https://example.com/jobs/2 for the req\n',
  );
  if (urlInProse.cells[5] === '4.3/5' && /for the req/.test(urlInProse.row ?? '')) {
    pass('a note that merely mentions a URL is not read as a shifted cell');
  } else {
    fail(`url-in-prose note — row: ${urlInProse.row}\n${urlInProse.merge.stdout}`);
  }
}

// ── the web's run prompt is a TSV writer too (#3517) ───────────────────────
// web/src/lib/run-prompts.mjs dictates the addition row to the agent, so the
// prompt is an emitter of this format even though it emits no bytes itself. A
// header it spells differently than tracker-aliases.json knows would not go
// red anywhere: merge-tracker would read the row as headerless and fall back to
// content sniffing — the exact path that cannot order a `—` / `—` row. Assert
// the prompt's own example lines against the real ingest, not against a copy of
// the labels.
if (!HAS_WEB) {
  skipWeb('web run-prompt TSV header matches the ingest contract');
} else {
  try {
    // Relative specifier, like the other web imports in this file: an absolute
    // path is not a valid ESM specifier on Windows (`D:\...` reads as a URL
    // scheme), which is how this test passed on ubuntu/macos and failed there.
    const { buildPrompt } = await import('./web/src/lib/run-prompts.mjs');
    const prompt = buildPrompt({ kind: 'evaluate', input: 'https://example.com/jobs/2', memory: '', today: '2026-02-02' });
    const tabLines = prompt.split('\n').filter(l => l.includes('\t'));

    if (tabLines.length !== 2) {
      fail(`web run prompt shows a header line and one data line — got ${tabLines.length}`);
    } else {
      const header = tabLines[0].trim().split('\t');
      const { missing, duplicates, unknown } = resolveTsvColumns(header);
      if (!missing.length && !duplicates.length && !unknown.length) {
        pass('web run prompt: every header label resolves through tracker-aliases.json');
      } else {
        fail(`web run prompt header — missing ${JSON.stringify(missing)}, duplicates ${JSON.stringify(duplicates)}, unknown ${JSON.stringify(unknown)}`);
      }

      // Fill the prompt's own template with real values, by NAME, and merge it.
      const VALUES = {
        num: '2', date: '2026-02-02', company: 'Globex', role: 'Manager',
        status: 'Applied', score: '4.5/5', pdf: '❌', report: '—',
        notes: 'row as the web dictates it', url: 'https://example.com/jobs/2',
      };
      const dataWidth = tabLines[1].trim().split('\t').length;
      if (dataWidth !== header.length) {
        fail(`web run prompt: header labels ${header.length} columns but the data row shows ${dataWidth}`);
      }
      const row = header.map(h => VALUES[h.trim().toLowerCase()] ?? '').join('\t');
      const sb = makeSandbox(HEADER_9, { '2-globex.tsv': `${header.join('\t')}\n${row}\n` });
      const merge = runCaptured('merge-tracker.mjs', sb);
      const cells = (dataRows(sb.tracker).find(l => l.includes('Globex')) || '').split('|').map(c => c.trim());
      rmSync(sb.dir, { recursive: true, force: true });
      if (merge.code === 0 && cells[5] === '4.5/5' && cells[6] === 'Applied') {
        pass('web run prompt: the row it dictates merges into the right columns');
      } else {
        fail(`web run prompt row merge (code ${merge.code}) — cells ${JSON.stringify(cells)}\n${merge.stdout}`);
      }
    }
  } catch (e) {
    fail(`web run-prompt TSV header test crashed: ${e.message}`);
  }
}

// ═══ tracker.mjs export: the round-trip carries the LAYOUT (#3703) ══════════
// `sync` read the tracker by header NAME and `export` wrote it back by fixed
// POSITION, so a customized layout round-tripped every VALUE correctly and lost
// the COLUMN — silently, and `--out data/applications.md` writes that result
// back over the user's own tracker. Losing the URL column also disables
// merge-tracker's deterministic dedup pass, which is invisible in the file.

const runTracker = (args, sb) => runScript('tracker.mjs', args, sb);

// ── Test 16: a Location + URL layout survives sync → export byte-for-byte ────
{
  const CUSTOM = `# Applications Tracker

| # | Date | Company | Location | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|----------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | Acme | Berlin | Engineer | 4.2/5 | Applied | ❌ | [1](../reports/1.md) | note one | https://acme.example/jobs/1 |
`;
  const sb = makeSandbox(CUSTOM);
  const sync = runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  if (sync.code === 0 && exported.code === 0 && exported.stdout === CUSTOM) {
    pass('tracker.mjs export: Location/URL layout round-trips byte-for-byte');
  } else {
    fail(`tracker.mjs export: custom layout round-trip (sync ${sync.code}, export ${exported.code})\n--- got ---\n${exported.stdout}--- want ---\n${CUSTOM}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 17: an unknown user column keeps its own values, not just its header ─
{
  const CUSTOM = `# Applications Tracker

| # | Date | Company | Priority | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|----------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | high | Engineer | 4.2/5 | Applied | ✅ | — | seed row |
| 2 | 2026-01-02 | Globex | low | Manager | 3.0/5 | Rejected | ❌ | — | second row |
`;
  const sb = makeSandbox(CUSTOM);
  runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  if (exported.code === 0 && exported.stdout === CUSTOM) {
    pass('tracker.mjs export: unknown extra column keeps its per-row values');
  } else {
    fail(`tracker.mjs export: unknown column round-trip\n--- got ---\n${exported.stdout}--- want ---\n${CUSTOM}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 18: the legacy 9-column layout is unchanged ────────────────────────
{
  const sb = makeSandbox(HEADER_9);
  runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  if (exported.code === 0 && exported.stdout === HEADER_9) {
    pass('tracker.mjs export: legacy 9-column layout round-trips unchanged');
  } else {
    fail(`tracker.mjs export: 9-col round-trip\n--- got ---\n${exported.stdout}--- want ---\n${HEADER_9}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 19: --out over the tracker preserves the custom columns ────────────
// The adoption path from the issue: export a repaired copy back over
// applications.md. Adopting it used to cost the user Location, Via and URL.
{
  const CUSTOM = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | ? | Hays | Engineer | 4.2/5 | aplicado | ❌ | — | agency row | https://acme.example/jobs/1 |
`;
  const sb = makeSandbox(CUSTOM);
  runTracker(['sync'], sb);
  const res = runTracker(['export', '--out', sb.tracker], sb);
  const after = readFileSync(sb.tracker, 'utf-8');
  const cells = after.split('\n').find(l => l.includes('Hays'))?.split('|').map(c => c.trim()) ?? [];
  // cells: ['', num, date, company, via, role, score, status, pdf, report, notes, url, '']
  if (res.code === 0 && cells[4] === 'Hays' && cells[11] === 'https://acme.example/jobs/1') {
    pass('tracker.mjs export --out: Via and URL survive adoption over the tracker');
  } else {
    fail(`tracker.mjs export --out over tracker (code ${res.code})\n${after}`);
  }
  // The point of exporting over the tracker is the repair: a non-canonical
  // status is normalized while the custom columns stay put.
  if (cells[7] === 'Applied') pass('tracker.mjs export --out: non-canonical status still repaired');
  else fail(`tracker.mjs export --out: status repair — got "${cells[7]}"`);
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 20: cells the layout cannot hold are named, and block --out ────────
// Option 3 of the issue: whatever the round-trip cannot reproduce must be a
// decision the user makes, not a silent drop under a "backed up to .bak" line.
{
  const WIDE = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note | with | stray | https://acme.example/1 |
`;
  const sb = makeSandbox(WIDE);
  runTracker(['sync'], sb);
  const stdoutRun = runTracker(['export'], sb);
  if (/cannot be reproduced by export/.test(stdoutRun.stderr)) {
    pass('tracker.mjs export: names the columns it cannot reproduce');
  } else {
    fail(`tracker.mjs export: expected a dropped-column warning\n${stdoutRun.stderr}`);
  }

  const before = readFileSync(sb.tracker, 'utf-8');
  const refused = runTracker(['export', '--out', sb.tracker], sb);
  if (refused.code === 1 && readFileSync(sb.tracker, 'utf-8') === before) {
    pass('tracker.mjs export --out: refuses to overwrite when columns would be dropped');
  } else {
    fail(`tracker.mjs export --out: expected refusal (code ${refused.code})\n${refused.stdout}`);
  }

  const forced = runTracker(['export', '--out', sb.tracker, '--force'], sb);
  if (forced.code === 0 && readFileSync(sb.tracker, 'utf-8') !== before) {
    pass('tracker.mjs export --out --force: writes once the drop is acknowledged');
  } else {
    fail(`tracker.mjs export --out --force (code ${forced.code})\n${forced.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 21: an index built before extras/md_header existed is rebuilt ──────
// The md hash still matches, so freshness alone would serve an export with no
// layout and no extras — the exact silent drop, from a stale schema. Built with
// the PRE-#3703 schema by hand rather than by mutating a current index: a test
// that assumes the new `extras` column exists cannot fail cleanly against the
// old code, it aborts on "no such column" (PR #3794 review).
{
  const CUSTOM = `# Applications Tracker

| # | Date | Company | Location | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|----------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Berlin | Engineer | 4.2/5 | Applied | ❌ | — | seed row |
`;
  const sb = makeSandbox(CUSTOM);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(sb.dir, 'applications.db'));
  db.exec(`CREATE TABLE applications (
    id INTEGER PRIMARY KEY, pos INTEGER NOT NULL, date TEXT NOT NULL,
    company TEXT NOT NULL, role TEXT NOT NULL, score TEXT NOT NULL DEFAULT '—',
    status TEXT NOT NULL, pdf TEXT NOT NULL DEFAULT '❌',
    report TEXT NOT NULL DEFAULT '—', notes TEXT NOT NULL DEFAULT '');
    CREATE TABLE status_events (id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES applications(id), status TEXT NOT NULL, date TEXT NOT NULL);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.prepare('INSERT INTO applications VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(1, 0, '2026-01-01', 'Acme', 'Engineer', '4.2/5', 'Applied', '❌', '—', 'seed row');
  // The hash a pre-#3703 sync would have stored: freshness passes, so only the
  // missing schema_version can force the rebuild.
  db.prepare('INSERT INTO meta VALUES (?,?)')
    .run('md_sha256', createHash('sha256').update(readFileSync(sb.tracker)).digest('hex'));
  db.close();

  const exported = runTracker(['export'], sb);
  const headerLine = exported.stdout.split('\n').find(l => l.startsWith('| #')) ?? '';
  if (exported.code === 0 && /\| Location \|/.test(headerLine)) {
    pass('tracker.mjs export: a pre-#3703 index is rebuilt, exporting the source header');
  } else {
    fail(`tracker.mjs export: stale-schema index kept the default header — got "${headerLine}"`);
  }
  if (exported.stdout === CUSTOM) {
    pass('tracker.mjs export: the rebuilt stale index round-trips byte-for-byte');
  } else {
    fail(`tracker.mjs export: stale-schema round-trip\n--- got ---\n${exported.stdout}--- want ---\n${CUSTOM}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 22: content around and inside the table (PR #3794 review) ──────────
// `export` emitted a fixed skeleton, so `--out` over the tracker deleted a
// localized title, a legend, an archive section and a trailing note — and the
// drop gate never saw it, because it counted only cells past the header width.
{
  const RICH = `# Seguimiento de candidaturas

Legend: ✅ sent · ❌ not sent.

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note | https://a.example/1 |

Last reviewed 2026-09-01.
`;
  const sb = makeSandbox(RICH);
  runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  if (exported.code === 0 && exported.stdout === RICH) {
    pass('tracker.mjs export: title, preamble and trailing note survive the round-trip');
  } else {
    fail(`tracker.mjs export: non-table content\n--- got ---\n${exported.stdout}--- want ---\n${RICH}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 23: content BETWEEN table rows is named and gated ─────────────────
// A second table's rows are indexed against the FIRST table's columns, so
// replaying its heading and header would frame a shifted row as intact. It is
// reported as a loss instead, and `--out` refuses.
{
  const ARCHIVED = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note | https://a.example/1 |

## Archive (2025)

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 9 | 2025-06-01 | Oldco | Analyst | 3.0/5 | Rejected | ❌ | — | archived |
`;
  const sb = makeSandbox(ARCHIVED);
  runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  if (/## Archive \(2025\)/.test(exported.stderr) && /cannot be reproduced by export/.test(exported.stderr)) {
    pass('tracker.mjs export: a section between table rows is named as a loss');
  } else {
    fail(`tracker.mjs export: expected the archive section in the loss list\n${exported.stderr}`);
  }
  const before = readFileSync(sb.tracker, 'utf-8');
  const refused = runTracker(['export', '--out', sb.tracker], sb);
  if (refused.code === 1 && readFileSync(sb.tracker, 'utf-8') === before) {
    pass('tracker.mjs export --out: refuses to flatten a tracker with an archive section');
  } else {
    fail(`tracker.mjs export --out: expected refusal (code ${refused.code})\n${refused.stdout}`);
  }
  // The archived row was indexed against the FIRST table's header, so emitting
  // it under the active table invents an empty URL cell for it. Naming it as a
  // loss is the only honest option; forcing must not move it (PR #3794 review).
  if (/row #9 \(Oldco/.test(exported.stderr)) {
    pass('tracker.mjs export: the later table\'s row is named as a loss');
  } else {
    fail(`tracker.mjs export: expected row #9 in the loss list\n${exported.stderr}`);
  }
  const forced = runTracker(['export', '--out', sb.tracker, '--force'], sb);
  const after = readFileSync(sb.tracker, 'utf-8');
  if (forced.code === 0 && !/Oldco/.test(after)) {
    pass('tracker.mjs export --force: the archived row is NOT re-emitted under the active table');
  } else {
    fail(`tracker.mjs export --force moved the archive row into the active table:\n${after}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 27: prologue/epilogue whitespace is replayed, not re-rendered ──────
// The lines around the table are prose the export COPIES. Trimming them edited
// a user's indentation and trailing spaces with nothing in the loss list able
// to see it (PR #3794 review).
{
  const INDENTED_PROSE = [
    '# Applications Tracker',
    '',
    '  > Indented note with trailing spaces   ',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note |',
    '',
    '    trailing indented line',
    '',
  ].join('\n');
  const sb = makeSandbox(INDENTED_PROSE);
  runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  if (exported.code === 0 && exported.stdout === INDENTED_PROSE) {
    pass('tracker.mjs export: prologue/epilogue whitespace survives verbatim');
  } else {
    fail(`tracker.mjs export: prose whitespace\n--- got ---\n${JSON.stringify(exported.stdout)}\n--- want ---\n${JSON.stringify(INDENTED_PROSE)}`);
  }
  // Nothing was lost, so the gate must not fire — a false refusal is its own bug.
  const written = runTracker(['export', '--out', sb.tracker], sb);
  if (written.code === 0) pass('tracker.mjs export --out: no false refusal when nothing is lost');
  else fail(`tracker.mjs export --out: unexpected refusal\n${written.stdout}`);
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 28: a cell the render had to rewrite is a reported loss ────────────
// A stray pipe is folded into Notes at sync time and comes back as '│' — the
// VALUE changed, so a silent `--out` edits the tracker (PR #3794 review).
{
  const STRAY = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note | extra |
`;
  const sb = makeSandbox(STRAY);
  runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  if (/note \| extra.*note │ extra/.test(exported.stderr)) {
    pass('tracker.mjs export: a sanitized cell is named with its before/after');
  } else {
    fail(`tracker.mjs export: expected the sanitized cell in the loss list\n${exported.stderr}`);
  }
  const before = readFileSync(sb.tracker, 'utf-8');
  const refused = runTracker(['export', '--out', sb.tracker], sb);
  if (refused.code === 1 && readFileSync(sb.tracker, 'utf-8') === before) {
    pass('tracker.mjs export --out: refuses when a cell value would change');
  } else {
    fail(`tracker.mjs export --out: expected refusal on a sanitized cell (code ${refused.code})`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 24: an indented table reads and writes the same layout ────────────
// resolveColumns needs `startsWith('|')` and detectLayout trimmed on its own,
// so an indented header gave the LEGACY map on read and the real map on write:
// Berlin moved into Role and Applied into PDF (PR #3794 review).
{
  const INDENTED = [
    '# Applications Tracker',
    '',
    '  | # | Date | Company | Location | Role | Score | Status | PDF | Report | Notes |',
    '  |---|------|---------|----------|------|-------|--------|-----|--------|-------|',
    '  | 1 | 2026-01-01 | Acme | Berlin | Engineer | 4.2/5 | Applied | ❌ | — | note |',
    '',
  ].join('\n');
  const sb = makeSandbox(INDENTED);
  runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  const cells = exported.stdout.split('\n').find(l => l.includes('Acme'))?.split('|').map(c => c.trim()) ?? [];
  // cells: ['', num, date, company, location, role, score, status, pdf, report, notes, '']
  if (cells[4] === 'Berlin' && cells[5] === 'Engineer' && cells[7] === 'Applied' && cells[10] === 'note') {
    pass('tracker.mjs export: an indented table keeps every cell in its own column');
  } else {
    fail(`tracker.mjs export: indented table shifted cells — ${JSON.stringify(cells)}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 25: a header career-ops cannot name is still preserved ─────────────
// isHeaderRow only fires when the alias table resolves the FULL schema, so a
// Spanish header (puntuación/estado are unmapped) recorded no layout at all and
// exported as the English default, exit 0 (PR #3794 review).
{
  const SPANISH = `# Seguimiento

| # | Fecha | Empresa | Puesto | Puntuación | Estado | PDF | Informe | Notas |
|---|-------|---------|--------|------------|--------|-----|---------|-------|
| 1 | 2026-01-01 | Acme | Ingeniero | 4.2/5 | Applied | ❌ | — | nota |
`;
  const sb = makeSandbox(SPANISH);
  runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  if (exported.code === 0 && exported.stdout === SPANISH) {
    pass('tracker.mjs export: an unresolvable localized header round-trips verbatim');
  } else {
    fail(`tracker.mjs export: localized header\n--- got ---\n${exported.stdout}--- want ---\n${SPANISH}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 26: CRLF line endings survive ─────────────────────────────────────
{
  const CRLF = [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note |',
    '',
  ].join('\r\n');
  const sb = makeSandbox(CRLF);
  runTracker(['sync'], sb);
  const exported = runTracker(['export'], sb);
  if (exported.code === 0 && exported.stdout === CRLF) {
    pass('tracker.mjs export: CRLF line endings are not rewritten to LF');
  } else {
    fail(`tracker.mjs export: CRLF round-trip — got ${JSON.stringify(exported.stdout)}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
