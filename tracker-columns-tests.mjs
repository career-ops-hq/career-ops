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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
