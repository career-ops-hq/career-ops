#!/usr/bin/env node

/**
 * followup-seed-tests.mjs — regression tests for followup-seed.mjs (#1430).
 *
 * Marking a tracker row Applied used to leave data/follow-ups.md untouched
 * until the user ran the `followup` mode by hand — the seed step never ran on
 * its own. These tests drive followup-seed.mjs's CLI (via execFileSync, like
 * tracker-columns-tests.mjs) end-to-end against sandboxed fixtures, plus a few
 * direct unit-level imports of the exported functions.
 *
 * Run: node followup-seed-tests.mjs
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseNextOverrides, resolveNextOverride, normalizeStatus, addDays, parseDate } from './followup-cadence.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const SCRIPT = join(ROOT, 'followup-seed.mjs');

let passed = 0;
let failed = 0;
function pass(m) { console.log(`PASS ${m}`); passed++; }
function fail(m) { console.error(`FAIL ${m}`); failed++; }

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// --- sandbox helpers --------------------------------------------------------

function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'co-seed-'));
  const tracker = join(dir, 'applications.md');
  const followups = join(dir, 'follow-ups.md');
  const lock = join(dir, `career-ops-followups-test-${Math.random().toString(36).slice(2)}.lock`);
  return { dir, tracker, followups, lock };
}

function writeTracker(sandbox, rows) {
  const header = [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...rows,
    '',
  ].join('\n');
  writeFileSync(sandbox.tracker, header);
}

function trackerRow(num, date, company, role, score, status, notes) {
  return `| ${num} | ${date} | ${company} | ${role} | ${score} | ${status} | ❌ | — | ${notes} |`;
}

// Run followup-seed.mjs against a sandbox. Returns { code, stdout, stderr }.
function run(args, sandbox, extraEnv = {}) {
  const env = {
    ...process.env,
    CAREER_OPS_TRACKER: sandbox.tracker,
    CAREER_OPS_FOLLOWUPS: sandbox.followups,
    CAREER_OPS_FOLLOWUPS_LOCK: sandbox.lock,
    ...extraEnv,
  };
  try {
    const stdout = execFileSync(NODE, [SCRIPT, ...args], {
      cwd: ROOT, env, encoding: 'utf-8', timeout: 30000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function cleanup(sandbox) {
  rmSync(sandbox.dir, { recursive: true, force: true });
  rmSync(sandbox.lock, { recursive: true, force: true });
}

// ── Test 1: round-trip — pin date derives from notes, not the tracker date column ──
{
  const sb = makeSandbox();
  // Tracker date column (2026-05-01) is deliberately earlier than the notes'
  // "Applied 2026-06-20" — the seed must use the notes date, never the column.
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20. Great team.')]);

  const res = run(['1', '--json'], sb);
  if (res.code !== 0) {
    fail(`1. round-trip seed exits 0 (got ${res.code})\n${res.stdout}${res.stderr}`);
  } else {
    pass('1. round-trip seed exits 0');
    const content = readFileSync(sb.followups, 'utf-8');
    const overrides = parseNextOverrides(content);
    const override = overrides.get(1);
    if (override) {
      pass('1. pin parses via parseNextOverrides');
      const resolved = resolveNextOverride(override, null);
      const expectedNext = addDays(parseDate('2026-06-20'), 7); // default applied_first
      if (resolved === expectedNext) pass(`1. resolved next date is applied-date + applied_first (${expectedNext})`);
      else fail(`1. resolved next date — expected ${expectedNext}, got ${resolved}`);
      if (override.setDate === todayStr()) pass('1. setDate is today');
      else fail(`1. setDate — expected ${todayStr()}, got ${override.setDate}`);
    } else {
      fail('1. pin parses via parseNextOverrides — no override found for #1');
    }
  }
  cleanup(sb);
}

// ── Test 2: seeded line matches OVERRIDE_RE, never starts with '|' ──────────
{
  const sb = makeSandbox();
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20.')]);
  run(['1'], sb);
  const content = readFileSync(sb.followups, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim().startsWith('- next'));
  if (lines.length === 1 && /^-\s+next\s+#\d+\s+\d{4}-\d{2}-\d{2}(\s+\(set\s+\d{4}-\d{2}-\d{2}\))?\s*$/i.test(lines[0])) {
    pass('2. seeded line matches OVERRIDE_RE');
  } else {
    fail(`2. seeded line matches OVERRIDE_RE — got: ${JSON.stringify(lines)}`);
  }
  if (!lines[0]?.startsWith('|')) pass('2. seeded line does not start with |');
  else fail('2. seeded line does not start with |');
  cleanup(sb);
}

// ── Test 3: idempotency + --force appends a second pin (last wins) ─────────
{
  const sb = makeSandbox();
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20.')]);
  const first = run(['1', '--json'], sb);
  const second = run(['1', '--json'], sb);
  if (second.code === 0 && JSON.parse(second.stdout).seeded === false) {
    pass('3. second seed is a no-op (seeded:false)');
  } else {
    fail(`3. second seed is a no-op — code ${second.code}, stdout ${second.stdout}`);
  }

  // Pre-existing table row for the appNum should also block seeding.
  const sb2 = makeSandbox();
  writeTracker(sb2, [trackerRow(2, '2026-05-01', 'Globex', 'Manager', '4.0/5', 'Applied', 'Applied 2026-06-01.')]);
  const tableHeader = [
    '# Follow-ups',
    '',
    '| num | appNum | date | company | role | channel | contact | notes |',
    '|---|---|---|---|---|---|---|---|',
    '| 1 | 2 | 2026-06-10 | Globex | Manager | email | recruiter@globex.com | sent |',
    '',
  ].join('\n');
  writeFileSync(sb2.followups, tableHeader);
  const blocked = run(['2', '--json'], sb2);
  if (blocked.code === 0 && JSON.parse(blocked.stdout).seeded === false) {
    pass('3. pre-existing table row blocks seeding');
  } else {
    fail(`3. pre-existing table row blocks seeding — code ${blocked.code}, stdout ${blocked.stdout}`);
  }
  cleanup(sb2);

  const forced = run(['1', '--force', '--json'], sb);
  if (forced.code === 0 && JSON.parse(forced.stdout).seeded === true) {
    pass('3. --force appends a fresh pin');
  } else {
    fail(`3. --force appends a fresh pin — code ${forced.code}, stdout ${forced.stdout}`);
  }
  const content = readFileSync(sb.followups, 'utf-8');
  const overrides = parseNextOverrides(content);
  const pinLines = content.split('\n').filter(l => l.trim().startsWith('- next #1 '));
  if (pinLines.length === 2) pass('3. two pin lines now present for #1');
  else fail(`3. two pin lines now present for #1 — got ${pinLines.length}`);
  // parseNextOverrides keeps the LAST pin per app.
  const lastPin = pinLines[pinLines.length - 1];
  const lastDateMatch = lastPin.match(/#1\s+(\d{4}-\d{2}-\d{2})/);
  if (overrides.get(1)?.date === lastDateMatch?.[1]) pass('3. parseNextOverrides returns the LAST pin');
  else fail(`3. parseNextOverrides returns the LAST pin — got ${JSON.stringify(overrides.get(1))} vs last line ${lastPin}`);
  cleanup(sb);
}

// ── Test 4: date resolution order — --date beats notes; notes beat today; column never used ──
{
  const sb = makeSandbox();
  // Column date is 2026-01-01 (would be very wrong if ever used).
  writeTracker(sb, [trackerRow(1, '2026-01-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20.')]);
  const withDate = run(['1', '--date', '2026-06-25', '--json'], sb);
  const parsed = JSON.parse(withDate.stdout);
  if (parsed.appliedDate === '2026-06-25') pass('4. --date beats notes date');
  else fail(`4. --date beats notes date — got ${parsed.appliedDate}`);
  if (parsed.appliedDate !== '2026-01-01') pass('4. tracker date column never used');
  else fail('4. tracker date column never used — got column date');
  cleanup(sb);

  // Unit-level: resolveAppliedDate directly.
  const mod = await import(pathToFileURL(SCRIPT).href);
  const rowWithNotes = { notes: 'Applied 2026-06-20. Some other text.' };
  if (mod.resolveAppliedDate(rowWithNotes, null) === '2026-06-20') pass('4. resolveAppliedDate: notes beat today (no explicit date)');
  else fail('4. resolveAppliedDate: notes beat today');
  if (mod.resolveAppliedDate(rowWithNotes, '2026-07-01') === '2026-07-01') pass('4. resolveAppliedDate: explicit date wins over notes');
  else fail('4. resolveAppliedDate: explicit date wins over notes');
  const rowNoNotes = { notes: 'no date here' };
  if (mod.resolveAppliedDate(rowNoNotes, null) === todayStr()) pass('4. resolveAppliedDate: falls back to today');
  else fail('4. resolveAppliedDate: falls back to today');
}

// ── Test 5: missing file gets exact canonical header; append preserves bytes ──
{
  const sb = makeSandbox();
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20.')]);
  run(['1'], sb);
  const content = readFileSync(sb.followups, 'utf-8');
  const expectedHeader = [
    '# Follow-ups',
    '',
    '| num | appNum | date | company | role | channel | contact | notes |',
    '|---|---|---|---|---|---|---|---|',
  ].join('\n');
  if (content.startsWith(expectedHeader)) pass('5. missing file created with exact canonical header');
  else fail(`5. missing file created with exact canonical header — got:\n${content.slice(0, 200)}`);

  // Now append a second app; prior bytes (header + first pin) must be preserved exactly.
  const before = readFileSync(sb.followups, 'utf-8');
  writeTracker(sb, [
    trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20.'),
    trackerRow(2, '2026-05-01', 'Globex', 'Manager', '4.0/5', 'Applied', 'Applied 2026-06-15.'),
  ]);
  run(['2'], sb);
  const after = readFileSync(sb.followups, 'utf-8');
  if (after.startsWith(before)) pass('5. appending to existing file preserves prior bytes exactly');
  else fail('5. appending to existing file preserves prior bytes exactly');
  cleanup(sb);
}

// ── Test 6: impossible calendar date rejected ───────────────────────────────
{
  const sb = makeSandbox();
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20.')]);
  const res = run(['1', '--date', '2026-02-31'], sb);
  if (res.code === 1) pass('6. --date 2026-02-31 exits 1');
  else fail(`6. --date 2026-02-31 exits 1 — got ${res.code}`);
  cleanup(sb);
}

// ── Test 7: non-Applied row rejected without --force, accepted with --force ──
{
  const sb = makeSandbox();
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Evaluated', 'no applied date yet')]);
  const res = run(['1'], sb);
  if (res.code === 1) pass('7. non-Applied row rejected without --force (exit 1)');
  else fail(`7. non-Applied row rejected without --force — got ${res.code}`);
  const forced = run(['1', '--force', '--json'], sb);
  if (forced.code === 0 && JSON.parse(forced.stdout).seeded === true) pass('7. non-Applied row succeeds with --force');
  else fail(`7. non-Applied row succeeds with --force — code ${forced.code}, stdout ${forced.stdout}`);
  cleanup(sb);
}

// ── Test 8: --backfill seeds only unpinned Applied rows; re-run seeds 0 ────
{
  const sb = makeSandbox();
  writeTracker(sb, [
    trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-01.'),   // Applied, unpinned
    trackerRow(2, '2026-05-01', 'Globex', 'Manager', '4.0/5', 'Applied', 'Applied 2026-06-05.'),  // Applied, will be pre-pinned
    trackerRow(3, '2026-05-01', 'Initech', 'Analyst', '3.0/5', 'Evaluated', 'not applied'),        // Evaluated
    trackerRow(4, '2026-05-01', 'Umbrella', 'Scientist', '2.0/5', 'Rejected', 'Applied 2026-04-01. rejected'), // Rejected
  ]);
  // Pre-seed #2 with a pin so backfill must skip it.
  run(['2'], sb);

  const res = run(['--backfill', '--json'], sb);
  if (res.code !== 0) fail(`8. --backfill exits 0 (got ${res.code})\n${res.stdout}${res.stderr}`);
  else {
    const parsed = JSON.parse(res.stdout);
    if (parsed.seeded.length === 1 && parsed.seeded[0].appNum === 1) pass('8. --backfill seeds exactly the 1 unpinned Applied row');
    else fail(`8. --backfill seeds exactly the 1 unpinned Applied row — got ${JSON.stringify(parsed.seeded)}`);
    if (parsed.skipped.some(s => s.appNum === 2)) pass('8. --backfill skips the already-pinned Applied row');
    else fail(`8. --backfill skips the already-pinned Applied row — got ${JSON.stringify(parsed.skipped)}`);
  }

  const rerun = run(['--backfill', '--json'], sb);
  const rerunParsed = JSON.parse(rerun.stdout);
  if (rerun.code === 0 && rerunParsed.seeded.length === 0) pass('8. re-run backfill seeds 0');
  else fail(`8. re-run backfill seeds 0 — got ${JSON.stringify(rerunParsed)}`);
  cleanup(sb);
}

// ── Test 9: lock held by a live pid → exit 4 ────────────────────────────────
{
  const sb = makeSandbox();
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20.')]);
  mkdirSync(sb.lock, { recursive: true });
  writeFileSync(join(sb.lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'x', startedAt: new Date().toISOString() }));
  const res = run(['1'], sb, { CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS: '200' });
  if (res.code === 4) pass('9. lock held by live pid → exit 4');
  else fail(`9. lock held by live pid → exit 4 — got ${res.code}\n${res.stdout}${res.stderr}`);
  cleanup(sb);
}

// ── Test 10: stale-pin harmlessness — pin still parses after status flips to Rejected ──
{
  const sb = makeSandbox();
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20.')]);
  run(['1'], sb);
  // Flip status to Rejected — the pin is inert (cadence analysis only consumes
  // actionable statuses), but the pin line itself must still parse fine.
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Rejected', 'Applied 2026-06-20. rejected after onsite')]);
  const content = readFileSync(sb.followups, 'utf-8');
  const overrides = parseNextOverrides(content);
  if (overrides.has(1)) pass('10. stale pin still parses via parseNextOverrides');
  else fail('10. stale pin still parses via parseNextOverrides');
  if (normalizeStatus('Rejected') === 'rejected') pass('10. normalizeStatus(Rejected) === rejected (not actionable)');
  else fail(`10. normalizeStatus(Rejected) — got ${normalizeStatus('Rejected')}`);
  cleanup(sb);
}

// ── Test 11: impossible "Applied" date in notes → INVALID_DATE, no garbage pin ──
{
  const sb = makeSandbox();
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-02-31. Bad date.')]);
  const res = run(['1', '--json'], sb);
  if (res.code === 1) pass('11. impossible notes date → exit 1');
  else fail(`11. impossible notes date → exit 1 — got ${res.code}\n${res.stdout}${res.stderr}`);
  if ((res.stdout + res.stderr).includes('impossible')) pass('11. error names the invalid date problem');
  else fail(`11. error names the invalid date problem — got\n${res.stdout}${res.stderr}`);
  // An explicit valid --date must rescue the row (notes date is skipped entirely).
  const rescued = run(['1', '--date', '2026-06-20', '--json'], sb);
  let rescuedOk = false;
  try { rescuedOk = rescued.code === 0 && JSON.parse(rescued.stdout).seeded === true; } catch { /* fall through */ }
  if (rescuedOk) pass('11. explicit --date rescues a row with bad notes date');
  else fail(`11. explicit --date rescues — got code ${rescued.code}\n${rescued.stdout}${rescued.stderr}`);
  cleanup(sb);
}

// ── Test 12: backfill skips (not aborts on) a row with an impossible notes date ──
{
  const sb = makeSandbox();
  writeTracker(sb, [
    trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-02-31. Bad date.'),
    trackerRow(2, '2026-05-02', 'Globex', 'Engineer', '4.2/5', 'Applied', 'Applied 2026-06-20.'),
  ]);
  const res = run(['--backfill', '--json'], sb);
  if (res.code === 0) pass('12. backfill with one bad-notes row exits 0');
  else fail(`12. backfill with one bad-notes row exits 0 — got ${res.code}\n${res.stdout}${res.stderr}`);
  try {
    const out = JSON.parse(res.stdout);
    if (out.seeded.length === 1 && out.seeded[0].appNum === 2) pass('12. good row still seeded');
    else fail(`12. good row still seeded — got ${JSON.stringify(out.seeded)}`);
    if (out.skipped.length === 1 && out.skipped[0].appNum === 1 && out.skipped[0].reason === 'invalid-notes-date') {
      pass('12. bad row skipped with reason invalid-notes-date');
    } else {
      fail(`12. bad row skipped with reason invalid-notes-date — got ${JSON.stringify(out.skipped)}`);
    }
  } catch (e) {
    fail(`12. backfill JSON parses — ${e.message}\n${res.stdout}`);
  }
  cleanup(sb);
}

// ── Test 13: --date combined with --backfill is a usage error ──
{
  const sb = makeSandbox();
  writeTracker(sb, [trackerRow(1, '2026-05-01', 'Acme', 'Engineer', '4.0/5', 'Applied', 'Applied 2026-06-20.')]);
  const res = run(['--backfill', '--date', '2026-06-20'], sb);
  if (res.code === 1) pass('13. --backfill --date → exit 1');
  else fail(`13. --backfill --date → exit 1 — got ${res.code}\n${res.stdout}${res.stderr}`);
  if (res.stderr.includes('--date cannot be combined with --backfill')) pass('13. usage error explains the rejection');
  else fail(`13. usage error explains the rejection — got\n${res.stderr}`);
  cleanup(sb);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
