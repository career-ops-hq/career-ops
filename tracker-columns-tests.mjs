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

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

let passed = 0;
let failed = 0;
function pass(m) { console.log(`PASS ${m}`); passed++; }
function fail(m) { console.error(`FAIL ${m}`); failed++; }

// Run a script with tracker/additions redirected to a sandbox. Returns
// { code, stdout } — code is 0 on success, the process exit code otherwise.
function runScript(script, args, sandbox) {
  const env = {
    ...process.env,
    CAREER_OPS_TRACKER: sandbox.tracker,
    CAREER_OPS_ADDITIONS: sandbox.additions,
    CAREER_OPS_TRACKER_LOCK: sandbox.lock,
  };
  try {
    const stdout = execFileSync(NODE, [join(ROOT, script), ...args], {
      cwd: ROOT, env, encoding: 'utf-8', timeout: 30000,
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: `${e.stdout || ''}${e.stderr || ''}` };
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
  mkdirSync(additionsDir, { recursive: true });
  writeFileSync(tracker, trackerContent);
  for (const [name, content] of Object.entries(additions)) {
    writeFileSync(join(additionsDir, name), content);
  }
  return { dir, tracker, additions: additionsDir, lock };
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
  const seen = loadSeenCompanyRoles(sb.tracker);
  if (seen.has('acme::engineer')) pass('scan.mjs: seen-set keys company::role on 10-col tracker');
  else fail(`scan.mjs: seen-set on 10-col tracker — got [${[...seen].join(', ')}]`);
  if (![...seen].some(k => k.includes('remote') || k.includes('4.0/5'))) {
    pass('scan.mjs: seen-set has no shifted-column garbage keys');
  } else {
    fail(`scan.mjs: shifted keys present — [${[...seen].join(', ')}]`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 7: schema contract — every consumer maps an UNKNOWN extra column ───
// The header-name contract (#1596): a column no consumer recognizes must be
// skipped by ALL of them, never silently shifted into a known field. This is
// the guard that makes the next column insertion a one-place change instead of
// a repo-wide incident. normalize-statuses.mjs is excluded until PR #1114
// (which retrofits it) lands — add it here when that merges.
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
  const seen = loadSeenCompanyRoles(sb.tracker);
  if (seen.has('acme::engineer') && seen.size === 1) {
    pass('contract: scan.mjs seen-set skips an unknown extra column');
  } else {
    fail(`contract: scan.mjs seen-set on unknown-column tracker — [${[...seen].join(', ')}]`);
  }

  rmSync(sb.dir, { recursive: true, force: true });
}

// ── Test 8: web read path resolves headers via the SHARED alias table ───────
// web/src/lib/tracker-table.mjs (behind readApplications() in career-ops.ts)
// loads tracker-aliases.json — the same file tracker-parse.mjs exports as
// HEADER_ALIASES — instead of mirroring it. Passing ROOT here exercises the
// REAL alias file, so an alias added/renamed there is either honored by the
// web reader too or fails this test; a second drifting table can't come back.
{
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
