#!/usr/bin/env node

/**
 * set-status-tests.mjs — regression tests for the set-status.mjs CLI (#1428).
 *
 * set-status.mjs is the canonical write path for tracker status updates, so
 * these tests pin down the full CLI contract: row resolution (by number, by
 * company, --role disambiguation), strict state validation against
 * templates/states.yml, idempotent note appends, dry-run, JSON output, exit
 * codes, and layout tolerance (9-col and 10-col Location trackers).
 *
 * Tests provision a throwaway tracker via the CAREER_OPS_TRACKER /
 * CAREER_OPS_TRACKER_LOCK env overrides (same sandbox pattern as
 * tracker-columns-tests.mjs).
 *
 * Exit-code contract under test:
 *   0 — success (including no-op re-runs)
 *   1 — usage error or non-canonical state
 *   2 — row not found (bad number, unknown company)
 *   3 — ambiguous company match (candidates listed on stderr / in JSON)
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { acquireTrackerLock } from './tracker-utils.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

let passed = 0;
let failed = 0;
function pass(m) { console.log(`PASS ${m}`); passed++; }
function fail(m) { console.error(`FAIL ${m}`); failed++; }

// Run set-status.mjs with the tracker redirected to a sandbox. Returns
// { code, stdout, stderr }.
function runSetStatus(args, sandbox, extraEnv = {}) {
  const env = {
    ...process.env,
    CAREER_OPS_TRACKER: sandbox.tracker,
    CAREER_OPS_TRACKER_LOCK: sandbox.lock,
    ...extraEnv,
  };
  try {
    const stdout = execFileSync(NODE, [join(ROOT, 'set-status.mjs'), ...args], {
      cwd: ROOT, env, encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// Create a sandbox dir holding a tracker file.
function makeSandbox(trackerContent) {
  const dir = mkdtempSync(join(tmpdir(), 'co-setstatus-'));
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, trackerContent);
  // The lock env value must live under tmpdir and use the career-ops prefix
  // (see trackerLockDirFor) or it is ignored — which would still be safe,
  // just contending on the real default lock.
  const lock = join(dir, 'career-ops-merge-tracker-test.lock');
  return { dir, tracker, lock };
}

function readTracker(sandbox) {
  return readFileSync(sandbox.tracker, 'utf-8');
}

const TRACKER_9 = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ✅ | [1](../reports/001-acme-2026-06-01.md) | strong infra fit |
| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated | ✅ | [2](../reports/002-globex-2026-06-02.md) | — |
| 3 | 2026-06-03 | Acme | Data Engineer | 3.9/5 | Evaluated | ❌ | [3](../reports/003-acme-2026-06-03.md) | pipeline heavy |
`;

const TRACKER_10 = `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Initech | AI Engineer | Remote | 4.5/5 | Evaluated | ✅ | [1](../reports/001-initech-2026-06-01.md) | — |
`;

// Two unrelated rows share tracker number 5 (the #1704 bug: merge-tracker.mjs
// once trusted a stale TSV number as-is when it was numerically ahead of that
// run's max, even though the number was already used by an unrelated row
// merged in a separate, earlier invocation).
const TRACKER_DUP_NUM = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 5 | 2026-05-29 | University of Alberta | Curriculum Coordinator | 3.8/5 | Evaluated | ❌ | — | — |
| 5 | 2026-06-03 | Esri Canada | Manager Talent and Organizational Development | 4.1/5 | Evaluated | ❌ | — | — |
`;

// ── 1. Update by report number ──────────────────────────────────
{
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus(['2', 'Applied'], sb);
  const content = readTracker(sb);
  if (r.code === 0 && /\| 2 \| 2026-06-02 \| Globex \| Platform Engineer \| 4.0\/5 \| Applied \|/.test(content)) {
    pass('by-num: status updated to Applied');
  } else {
    fail(`by-num: code=${r.code}; row not updated correctly\n${r.stdout}${r.stderr}`);
  }
  if (content.includes('| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Evaluated |')) {
    pass('by-num: other rows untouched');
  } else {
    fail('by-num: other rows were modified');
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 2. Update by company name (single match) ────────────────────
{
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus(['globex', 'Responded'], sb);
  if (r.code === 0 && /\| Globex \| Platform Engineer \| 4.0\/5 \| Responded \|/.test(readTracker(sb))) {
    pass('by-company: fuzzy company resolves single match');
  } else {
    fail(`by-company: code=${r.code}\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 3. State aliases resolve to canonical labels ────────────────
{
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus(['2', 'aplicado'], sb);
  if (r.code === 0 && /\| Globex \| Platform Engineer \| 4.0\/5 \| Applied \|/.test(readTracker(sb))) {
    pass('alias: "aplicado" resolves to canonical "Applied"');
  } else {
    fail(`alias: code=${r.code}\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 4. Non-canonical state rejected ─────────────────────────────
{
  const sb = makeSandbox(TRACKER_9);
  const before = readTracker(sb);
  const r = runSetStatus(['2', 'Ghosted'], sb);
  if (r.code === 1 && readTracker(sb) === before && /Evaluated/.test(r.stderr) && /SKIP/.test(r.stderr)) {
    pass('bad-state: exit 1, valid states listed, tracker untouched');
  } else {
    fail(`bad-state: code=${r.code} (want 1)\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 5. Not found: number and company ────────────────────────────
{
  const sb = makeSandbox(TRACKER_9);
  const r1 = runSetStatus(['99', 'Applied'], sb);
  if (r1.code === 2) {
    pass('not-found: unknown report number exits 2');
  } else {
    fail(`not-found num: code=${r1.code} (want 2)\n${r1.stdout}${r1.stderr}`);
  }
  const r2 = runSetStatus(['hooli', 'Applied'], sb);
  if (r2.code === 2) {
    pass('not-found: unknown company exits 2');
  } else {
    fail(`not-found company: code=${r2.code} (want 2)\n${r2.stdout}${r2.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 6. Ambiguous company: candidates listed, --role disambiguates ─
{
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus(['acme', 'Applied'], sb);
  if (r.code === 3 && r.stderr.includes('#1') && r.stderr.includes('#3') && r.stderr.includes('Backend Engineer') && r.stderr.includes('Data Engineer')) {
    pass('ambiguous: exit 3 with numbered candidate list');
  } else {
    fail(`ambiguous: code=${r.code} (want 3)\n${r.stdout}${r.stderr}`);
  }
  const r2 = runSetStatus(['acme', 'Applied', '--role', 'Data Engineer'], sb);
  if (r2.code === 0 && /\| 3 \| 2026-06-03 \| Acme \| Data Engineer \| 3.9\/5 \| Applied \|/.test(readTracker(sb))) {
    pass('ambiguous: --role disambiguates to the right row');
  } else {
    fail(`ambiguous --role: code=${r2.code}\n${r2.stdout}${r2.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 6b. Duplicate tracker #: bare number refuses to guess (#1704) ─
{
  const sb = makeSandbox(TRACKER_DUP_NUM);
  const before = readTracker(sb);
  const r = runSetStatus(['5', 'Rejected'], sb);
  if (r.code === 3 && readTracker(sb) === before
      && r.stderr.includes('University of Alberta') && r.stderr.includes('Esri Canada')) {
    pass('dup-num: bare #5 matching 2 rows exits 3, tracker untouched, both companies listed');
  } else {
    fail(`dup-num: code=${r.code} (want 3)\n${r.stdout}${r.stderr}`);
  }
  // --role disambiguates exactly like the company-selector ambiguous path.
  const r2 = runSetStatus(['5', 'Rejected', '--role', 'Manager Talent and Organizational Development'], sb);
  if (r2.code === 0 && /\| 5 \| 2026-06-03 \| Esri Canada \|.*\| Rejected \|/.test(readTracker(sb))) {
    pass('dup-num: --role disambiguates to the right row');
  } else {
    fail(`dup-num --role: code=${r2.code}\n${r2.stdout}${r2.stderr}`);
  }
  // The OTHER row (University of Alberta) must stay untouched by the --role
  // disambiguated write above.
  if (readTracker(sb).includes('| 5 | 2026-05-29 | University of Alberta | Curriculum Coordinator | 3.8/5 | Evaluated |')) {
    pass('dup-num: unrelated row with the same # untouched after disambiguation');
  } else {
    fail(`dup-num: unrelated row was modified\n${readTracker(sb)}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 6c. Duplicate tracker # + --json: structured candidates ─────
{
  const sb = makeSandbox(TRACKER_DUP_NUM);
  const r = runSetStatus(['5', 'Rejected', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout || r.stderr); } catch {}
  if (r.code === 3 && parsed && parsed.code === 'ambiguous' && Array.isArray(parsed.candidates)
      && parsed.candidates.length === 2) {
    pass('dup-num json: structured ambiguous error with 2 candidates');
  } else {
    fail(`dup-num json: code=${r.code}\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 7. Note append: idempotent, separator, pipe-sanitized ───────
{
  const sb = makeSandbox(TRACKER_9);
  runSetStatus(['1', 'Applied', '--note', 'sent via referral'], sb);
  const after1 = readTracker(sb);
  if (/\| strong infra fit; sent via referral \|/.test(after1)) {
    pass('note: appended to existing notes with "; "');
  } else {
    fail(`note: append missing\n${after1}`);
  }
  // Retry with the identical note must not duplicate it.
  runSetStatus(['1', 'Applied', '--note', 'sent via referral'], sb);
  const after2 = readTracker(sb);
  if ((after2.match(/sent via referral/g) || []).length === 1) {
    pass('note: identical retry does not duplicate the note');
  } else {
    fail('note: retry duplicated the note');
  }
  // A note that itself contains "; " must also stay idempotent.
  runSetStatus(['3', 'Responded', '--note', 'Called; left voicemail'], sb);
  runSetStatus(['3', 'Responded', '--note', 'Called; left voicemail'], sb);
  if ((readTracker(sb).match(/left voicemail/g) || []).length === 1) {
    pass('note: retry with semicolon-bearing note does not duplicate');
  } else {
    fail('note: semicolon-bearing note duplicated on retry');
  }
  // Pipes/newlines in a note would corrupt the table — must be sanitized.
  runSetStatus(['2', 'Applied', '--note', 'weird | note'], sb);
  const after3 = readTracker(sb);
  if (!/weird \| note/.test(after3) && /weird \/ note/.test(after3)) {
    pass('note: literal pipe sanitized');
  } else {
    fail('note: pipe not sanitized');
  }
  // A literal newline would split the row into two lines and break the table:
  // the stored row must stay a single line with the newline collapsed.
  runSetStatus(['2', 'Applied', '--note', 'first line\nsecond line'], sb);
  const after4 = readTracker(sb);
  const row2 = after4.split('\n').filter(l => /^\| 2 \|/.test(l));
  if (row2.length === 1 && row2[0].includes('first line second line')) {
    pass('note: literal newline sanitized to a single table row');
  } else {
    fail(`note: newline broke the row\n${after4}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 7b. Note dedup is delimiter-aware, not substring ────────────
{
  const sb = makeSandbox(TRACKER_9);
  // Row 1 notes: "strong infra fit". A note that is a mere substring of an
  // existing entry is NOT a duplicate — only whole "; "-delimited entries
  // (or the entire field) count.
  const r = runSetStatus(['1', 'Applied', '--note', 'infra'], sb);
  if (r.code === 0 && /\| strong infra fit; infra \|/.test(readTracker(sb))) {
    pass('note-dedup: substring of an existing entry still appends');
  } else {
    fail(`note-dedup: substring wrongly suppressed\n${readTracker(sb)}`);
  }
  // The exact same note re-added must still be suppressed. "infra" appears
  // twice after the append (inside "infra fit" + the new entry); a duplicate
  // append would make it three.
  runSetStatus(['1', 'Applied', '--note', 'infra'], sb);
  if ((readTracker(sb).match(/infra/g) || []).length === 2) {
    pass('note-dedup: exact retry still idempotent');
  } else {
    fail(`note-dedup: exact retry duplicated\n${readTracker(sb)}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 8. No-op re-run: exit 0, file byte-identical ────────────────
{
  const sb = makeSandbox(TRACKER_9);
  runSetStatus(['2', 'Applied'], sb);
  const before = readTracker(sb);
  const r = runSetStatus(['2', 'Applied', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 0 && readTracker(sb) === before && parsed && parsed.changed === false) {
    pass('no-op: same status again exits 0, changed:false, file untouched');
  } else {
    fail(`no-op: code=${r.code} changed=${parsed?.changed}\n${r.stdout}${r.stderr}`);
  }
  // #1430 hook must fire only on a real transition into Applied — a re-run
  // must not invite the consumer to seed a duplicate follow-up.
  if (parsed && parsed.followupSeedCandidate === undefined) {
    pass('no-op: followupSeedCandidate absent on idempotent Applied re-run');
  } else {
    fail(`no-op: followupSeedCandidate leaked on re-run\n${r.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 9. Dry-run: reports change, writes nothing ──────────────────
{
  const sb = makeSandbox(TRACKER_9);
  const before = readTracker(sb);
  const r = runSetStatus(['2', 'Applied', '--dry-run', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 0 && readTracker(sb) === before && parsed && parsed.changed === true && parsed.dryRun === true) {
    pass('dry-run: reports change without writing');
  } else {
    fail(`dry-run: code=${r.code}\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 10. JSON output shape + #1430 follow-up hook ────────────────
{
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus(['2', 'Applied', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (parsed && parsed.num === 2 && parsed.company === 'Globex' && parsed.oldStatus === 'Evaluated'
      && parsed.newStatus === 'Applied' && parsed.changed === true && parsed.followupSeedCandidate === true) {
    pass('json: full output shape + followupSeedCandidate on Applied');
  } else {
    fail(`json: bad shape\n${r.stdout}${r.stderr}`);
  }
  const r2 = runSetStatus(['1', 'Rejected', '--json'], sb);
  let parsed2 = null;
  try { parsed2 = JSON.parse(r2.stdout); } catch {}
  if (parsed2 && parsed2.followupSeedCandidate === undefined) {
    pass('json: no followupSeedCandidate on non-Applied transitions');
  } else {
    fail(`json: followupSeedCandidate leaked on Rejected\n${r2.stdout}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 11. Ambiguous + --json: machine-readable candidates ─────────
{
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus(['acme', 'Applied', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout || r.stderr); } catch {}
  if (r.code === 3 && parsed && parsed.code === 'ambiguous' && Array.isArray(parsed.candidates)
      && parsed.candidates.length === 2 && parsed.candidates[0].num === 1) {
    pass('json ambiguous: error object with candidates array');
  } else {
    fail(`json ambiguous: code=${r.code}\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 12. 10-column Location layout ───────────────────────────────
{
  const sb = makeSandbox(TRACKER_10);
  const r = runSetStatus(['1', 'Interview', '--note', 'onsite loop scheduled'], sb);
  const content = readTracker(sb);
  if (r.code === 0 && /\| Initech \| AI Engineer \| Remote \| 4.5\/5 \| Interview \|/.test(content)
      && /onsite loop scheduled/.test(content)) {
    pass('location-layout: 10-col tracker updates the right columns');
  } else {
    fail(`location-layout: code=${r.code}\n${content}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 13. Usage errors ────────────────────────────────────────────
{
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus([], sb);
  if (r.code === 1 && /Usage/i.test(r.stderr + r.stdout)) {
    pass('usage: no args exits 1 with usage text');
  } else {
    fail(`usage: code=${r.code}\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 13b. --note/--role must not eat a following flag as their value ─
{
  const sb = makeSandbox(TRACKER_9);
  const before = readTracker(sb);
  // "--note --dry-run" once consumed "--dry-run" as the note text — silently
  // disabling dry-run and turning a preview into a real write. It must be a
  // usage error, and nothing may be written.
  const r = runSetStatus(['2', 'Applied', '--note', '--dry-run'], sb);
  if (r.code === 1 && readTracker(sb) === before) {
    pass('flag-eating: --note followed by a flag exits 1 without writing');
  } else {
    fail(`flag-eating: code=${r.code} (want 1) written=${readTracker(sb) !== before}\n${r.stdout}${r.stderr}`);
  }
  // Missing value at the end of argv is the same usage error.
  const r2 = runSetStatus(['2', 'Applied', '--role'], sb);
  if (r2.code === 1 && /--role/.test(r2.stderr) && readTracker(sb) === before) {
    pass('flag-eating: trailing --role without value exits 1');
  } else {
    fail(`flag-eating trailing: code=${r2.code}\n${r2.stdout}${r2.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 13c. Usage errors honor --json with a structured payload ────
{
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus(['--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 1 && parsed && parsed.code === 'usage' && typeof parsed.error === 'string') {
    pass('json usage: structured usage-error payload on stdout');
  } else {
    fail(`json usage: code=${r.code} stdout=${r.stdout}\n${r.stderr}`);
  }
  // failUsage can fire mid-parse ("--note --json" fails before --json is
  // reached), so JSON mode must be detected from the raw argv.
  const r2 = runSetStatus(['2', 'Applied', '--note', '--json'], sb);
  let parsed2 = null;
  try { parsed2 = JSON.parse(r2.stdout); } catch {}
  if (r2.code === 1 && parsed2 && parsed2.code === 'usage') {
    pass('json usage: --json detected even when parsing fails mid-argv');
  } else {
    fail(`json usage mid-parse: code=${r2.code} stdout=${r2.stdout}\n${r2.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 14. Lock timeout: structured exit 4, JSON error, no write ──
{
  const sb = makeSandbox(TRACKER_9);
  const before = readTracker(sb);
  // A live-owner lock (our own PID) can never be recovered, so the CLI must
  // time out and fail through the structured error path instead of throwing.
  mkdirSync(sb.lock, { recursive: true });
  writeFileSync(join(sb.lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'test', tracker: sb.tracker }));
  const r = runSetStatus(['2', 'Applied', '--json'], sb, { CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '300' });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 4 && parsed && parsed.code === 'lock-timeout' && readTracker(sb) === before) {
    pass('lock-timeout: exit 4 with structured JSON error, tracker untouched');
  } else {
    fail(`lock-timeout: code=${r.code} (want 4)\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 14b. Non-timeout lock failure is NOT reported as lock-timeout ─
{
  const sb = makeSandbox(TRACKER_9);
  // Point the lock at a path whose parent is a regular FILE (inside tmpdir,
  // with the required prefix, so trackerLockDirFor accepts it). mkdirSync
  // then fails with ENOTDIR/ENOENT — a config error, not a busy lock — and
  // must map to exit 1 / lock-error, keeping exit 4 reserved for retryable
  // timeouts.
  const blocker = join(sb.dir, 'career-ops-merge-tracker-blocker');
  writeFileSync(blocker, 'not a directory');
  const badLock = join(blocker, 'career-ops-merge-tracker-bad.lock');
  const r = runSetStatus(['2', 'Applied', '--json'], { ...sb, lock: badLock });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 1 && parsed && parsed.code === 'lock-error') {
    pass('lock-error: filesystem lock failure exits 1, not lock-timeout');
  } else {
    fail(`lock-error: code=${r.code} (want 1) json=${parsed?.code}\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 15. Orphaned recovery guard does not block stale-lock recovery ─
{
  const dir = mkdtempSync(join(tmpdir(), 'co-setstatus-guard-'));
  const lockDir = join(dir, 'career-ops-merge-tracker-guardtest.lock');
  // Stale lock: dead owner PID → recoverable.
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 999999999, token: 'dead', tracker: 'x' }));
  // Orphaned guard left behind by a killed process (no owner.json → judged by age).
  mkdirSync(`${lockDir}.recover`, { recursive: true });
  await new Promise(r => setTimeout(r, 150));
  try {
    const lock = await acquireTrackerLock(lockDir, { timeoutMs: 3000, retryMs: 25, staleMs: 50, tracker: 'x' });
    if (lock.staleRecovered) {
      pass('recover-guard: orphaned guard is aged out and stale lock still recovers');
    } else {
      fail('recover-guard: lock acquired but stale recovery did not run');
    }
    lock.release();
  } catch (e) {
    fail(`recover-guard: acquisition failed — orphaned guard blocked recovery (${e.message})`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 16. Write failure surfaces as a structured error, not a stack ─
{
  if (process.platform !== 'win32' && process.getuid?.() === 0) {
    pass('write-failure: skipped (running as root — directory permissions are not enforced)');
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'co-setstatus-wf-'));
    const roDir = join(dir, 'ro');
    mkdirSync(roDir);
    const tracker = join(roDir, 'applications.md');
    writeFileSync(tracker, TRACKER_9);
    const lock = join(dir, 'career-ops-merge-tracker-wf.lock');
    // Make the tracker's directory readable but unwritable, so the atomic
    // temp-file write fails after a successful read. On Windows, directory
    // read-only bits don't block file creation — deny write-data/append-data
    // for Everyone (*S-1-1-0) via icacls instead.
    const denyWrite = () => process.platform === 'win32'
      ? execFileSync('icacls', [roDir, '/deny', '*S-1-1-0:(WD,AD)'])
      : chmodSync(roDir, 0o555);
    const restore = () => process.platform === 'win32'
      ? execFileSync('icacls', [roDir, '/remove:d', '*S-1-1-0'])
      : chmodSync(roDir, 0o755);
    denyWrite();
    try {
      const r = runSetStatus(['2', 'Applied', '--json'], { tracker, lock });
      let parsed = null;
      try { parsed = JSON.parse(r.stdout); } catch {}
      if (r.code === 1 && parsed && parsed.code === 'write-failure') {
        pass('write-failure: structured JSON error instead of a raw stack');
      } else {
        fail(`write-failure: code=${r.code} json=${parsed?.code}\n${r.stdout}${r.stderr}`);
      }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
