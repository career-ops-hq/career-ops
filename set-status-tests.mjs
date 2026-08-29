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
 *   3 — ambiguous company match or numeric selector/report-link mismatch
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, utimesSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { acquireTrackerLock } from './tracker-utils.mjs';
// The ledger date is the LOCAL calendar day (#2932). Computing the expected
// value with toISOString() here would compare a local date against a UTC one
// and fail for the hours of the day where they differ — a test that passes
// only in part of the UTC day.
import { localToday } from './lib/local-today.mjs';

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

const TRACKER_REPORT_MISMATCH = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 2 | 2026-06-02 | DriftCo | Platform Engineer | 4.0/5 | Evaluated | ✅ | [7](../reports/007-driftco-2026-06-02.md) | migrated badly |
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

// ── 1b. Numeric selector refuses a tracker/report ID mismatch ───
{
  const sb = makeSandbox(TRACKER_REPORT_MISMATCH);
  const before = readTracker(sb);
  const r = runSetStatus(['2', 'Applied', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 3 && parsed?.code === 'report-number-mismatch'
      && parsed.trackerNum === 2 && parsed.reportNums?.includes(7)
      && readTracker(sb) === before) {
    pass('report-mismatch: numeric selector fails closed without writing');
  } else {
    fail(`report-mismatch: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
  }

  const forced = runSetStatus(['2', 'Applied', '--force'], sb);
  if (forced.code === 0 && /\| 2 \|[^\n]*\| Applied \|/.test(readTracker(sb))) {
    pass('report-mismatch: --force permits an intentional numeric update');
  } else {
    fail(`report-mismatch force: code=${forced.code}\n${forced.stdout}${forced.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 1c. A single match must still be checked against --role (#2009) ─
// resolveRow only consults --role to break ties between 2+ candidates, so a
// company matching exactly one row was updated without ever comparing it to
// the role the caller explicitly asked for. The intended requisition may not
// be in the tracker at all (fuzzy-deduped away), and the lone survivor for
// that company silently absorbed the status change.
{
  const sb = makeSandbox(TRACKER_9);
  const before = readTracker(sb);
  const r = runSetStatus(['globex', 'SKIP', '--role', 'Data Engineer', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 3 && parsed?.code === 'role-mismatch'
      && parsed.rowRole === 'Platform Engineer' && parsed.requestedRole === 'Data Engineer'
      && readTracker(sb) === before) {
    pass('role-mismatch: single company match fails closed without writing (#2009)');
  } else {
    fail(`role-mismatch: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
  }

  const forced = runSetStatus(['globex', 'SKIP', '--role', 'Data Engineer', '--force'], sb);
  if (forced.code === 0 && /\| 2 \|[^\n]*\| SKIP \|/.test(readTracker(sb))) {
    pass('role-mismatch: --force records an explicit decision to proceed');
  } else {
    fail(`role-mismatch force: code=${forced.code}\n${forced.stdout}${forced.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 1d. An exact --role must NOT be rejected by the new guard (#2009) ─
// roleFuzzyMatch is a dedup predicate: it returns false when the overlap is
// entirely baseline vocabulary (["platform","engineer"]) so same-titled
// sibling reqs never auto-merge. Using it alone as the guard's equality test
// would reject --role "Platform Engineer" against a row that is exactly that.
{
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus(['globex', 'Applied', '--role', 'Platform Engineer'], sb);
  if (r.code === 0 && /\| 2 \|[^\n]*\| Applied \|/.test(readTracker(sb))) {
    pass('role-mismatch: an exact all-baseline role title still proceeds (#2009)');
  } else {
    fail(`role-mismatch exact: code=${r.code}\n${r.stdout}${r.stderr}`);
  }

  // Case and punctuation must not matter for the equality path.
  const r2 = runSetStatus(['globex', 'Evaluated', '--role', 'platform  engineer'], sb);
  if (r2.code === 0 && /\| 2 \|[^\n]*\| Evaluated \|/.test(readTracker(sb))) {
    pass('role-mismatch: role equality is case/punctuation insensitive (#2009)');
  } else {
    fail(`role-mismatch normalize: code=${r2.code}\n${r2.stdout}${r2.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 1e. Symbol-bearing titles must not collapse to the same role (#2009) ─
// The equality normalizer strips generic punctuation, so it must preserve the
// symbols that actually distinguish a title first — otherwise "C# Engineer" and
// "C++ Engineer" both fold to "c engineer" and the guard silently updates the
// wrong row for exactly the kind of title it exists to protect.
{
  const TRACKER_SYMBOL = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Contoso | C++ Engineer | 4.0/5 | Evaluated | ✅ | [1](../reports/001-contoso-2026-06-01.md) | — |
`;
  const sb = makeSandbox(TRACKER_SYMBOL);
  const before = readTracker(sb);
  const r = runSetStatus(['contoso', 'SKIP', '--role', 'C# Engineer', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 3 && parsed?.code === 'role-mismatch' && readTracker(sb) === before) {
    pass('role-mismatch: "C# Engineer" does not match a "C++ Engineer" row (#2009)');
  } else {
    fail(`role-mismatch symbol: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
  }

  // The genuine same-symbol title still matches (guard does not over-fire).
  const r2 = runSetStatus(['contoso', 'Applied', '--role', 'c++ engineer'], sb);
  if (r2.code === 0 && /\| 1 \|[^\n]*\| Applied \|/.test(readTracker(sb))) {
    pass('role-mismatch: "c++ engineer" still matches a "C++ Engineer" row (#2009)');
  } else {
    fail(`role-mismatch symbol-equal: code=${r2.code}\n${r2.stdout}${r2.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 1f. Non-Latin titles must not all collapse to the same role (#2670) ─
// The equality normalizer stripped `[^a-z0-9]`, which deletes every non-Latin
// LETTER, not just punctuation. Any title written entirely in Japanese, Arabic
// or Cyrillic keyed to "", two different titles compared equal ("" === ""), and
// the guard that exists to stop a status reaching the wrong row accepted the
// mismatch and wrote. The repo ships modes/ja/, modes/ar/ and modes/ru/, so
// these are shipped-market titles, not exotica. Company matching already used
// the Unicode-aware normalizeTextKey; only the role guard was left ASCII-only.
{
  const TRACKER_CJK = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | リクルート | バックエンドエンジニア | 4.0/5 | Evaluated | ✅ | [1](../reports/001-recruit-2026-06-01.md) | — |
`;
  const sb = makeSandbox(TRACKER_CJK);
  const before = readTracker(sb);
  const r = runSetStatus(['リクルート', 'Rejected', '--role', 'フロントエンドエンジニア', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 3 && parsed?.code === 'role-mismatch' && readTracker(sb) === before) {
    pass('role-mismatch: a different Japanese title does not match (#2670)');
  } else {
    fail(`role-mismatch cjk: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
  }

  // Two titles differing ONLY by a parenthesised city — the fullwidth
  // parentheses are punctuation and must still collapse, so what has to
  // distinguish them is the city itself.
  const sb2 = makeSandbox(`# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | リクルート | エンジニア（東京） | 4.0/5 | Evaluated | ✅ | [1](../reports/001-recruit-2026-06-01.md) | — |
`);
  const before2 = readTracker(sb2);
  const r2 = runSetStatus(['リクルート', 'Rejected', '--role', 'エンジニア（大阪）', '--json'], sb2);
  if (r2.code === 3 && readTracker(sb2) === before2) {
    pass('role-mismatch: same Japanese title, different city does not match (#2670)');
  } else {
    fail(`role-mismatch cjk-city: code=${r2.code}\n${r2.stdout}${r2.stderr}`);
  }

  // The guard must not over-fire: the SAME non-Latin title still proceeds,
  // including across a Unicode normalization form (NFD input vs NFC row).
  const r3 = runSetStatus(['リクルート', 'Applied', '--role', 'バックエンドエンジニア'], sb);
  if (r3.code === 0 && /\| 1 \|[^\n]*\| Applied \|/.test(readTracker(sb))) {
    pass('role-mismatch: the same Japanese title still proceeds (#2670)');
  } else {
    fail(`role-mismatch cjk-equal: code=${r3.code}\n${r3.stdout}${r3.stderr}`);
  }
  const nfdRole = "バックエンドエンジニア".normalize('NFD');
  if (nfdRole === "バックエンドエンジニア") {
    fail("role-mismatch cjk-nfd: fixture is not actually decomposed — the case would prove nothing");
  }
  const r4 = runSetStatus(["リクルート", 'Responded', '--role', nfdRole], sb);
  if (r4.code === 0 && /\| 1 \|[^\n]*\| Responded \|/.test(readTracker(sb))) {
    pass('role-mismatch: a decomposed (NFD) Japanese title still matches (#2670)');
  } else {
    fail(`role-mismatch cjk-nfd: code=${r4.code}\n${r4.stdout}${r4.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
  rmSync(sb2.dir, { recursive: true, force: true });
}

// ── 1g. The same collapse hits Arabic and Cyrillic (#2670) ─
// Not a CJK quirk: `[^a-z0-9]` deletes every letter outside the Latin range,
// so modes/ar/ and modes/ru/ titles were equally unprotected.
{
  const sb = makeSandbox(`# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Яндекс | Разработчик | 4.0/5 | Evaluated | ✅ | [1](../reports/001-yandex-2026-06-01.md) | — |
`);
  const before = readTracker(sb);
  const r = runSetStatus(['Яндекс', 'Rejected', '--role', 'Тестировщик', '--json'], sb);
  if (r.code === 3 && readTracker(sb) === before) {
    pass('role-mismatch: a different Cyrillic title does not match (#2670)');
  } else {
    fail(`role-mismatch cyrillic: code=${r.code}\n${r.stdout}${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── 1h. Fullwidth C＃ / C＋＋ must not collapse together (#2670) ─
// The symbol pre-map matches ASCII "#" and "++", but normalizeTextKey folds
// NFKC AFTER it, so a fullwidth ＃/＋＋ reached the collapse still fullwidth, was
// stripped as punctuation, and both titles keyed to "c engineer". Fullwidth
// forms are ordinary Japanese typography, so this is the same shipped-market
// surface as §1f. Pre-normalizing NFKC lets the ASCII pre-map see them.
// The collision predates the #2670 fix — "[^a-z0-9]" dropped them too.
{
  const sb = makeSandbox(`# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Contoso | C＋＋ Engineer | 4.0/5 | Evaluated | ✅ | [1](../reports/001-contoso-2026-06-01.md) | — |
`);
  const before = readTracker(sb);
  const r = runSetStatus(['contoso', 'SKIP', '--role', 'C＃ Engineer', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (r.code === 3 && parsed?.code === 'role-mismatch' && readTracker(sb) === before) {
    pass('role-mismatch: fullwidth C＃ does not match a fullwidth C＋＋ row (#2670)');
  } else {
    fail(`role-mismatch fullwidth: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
  }

  // Not over-firing: the ASCII spelling of the SAME title still matches, which
  // is exactly what the NFKC folding buys.
  const r2 = runSetStatus(['contoso', 'Applied', '--role', 'C++ Engineer'], sb);
  if (r2.code === 0 && /\| 1 \|[^\n]*\| Applied \|/.test(readTracker(sb))) {
    pass('role-mismatch: ASCII "C++ Engineer" matches the fullwidth row (#2670)');
  } else {
    fail(`role-mismatch fullwidth-equal: code=${r2.code}\n${r2.stdout}${r2.stderr}`);
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
  // Backdate it rather than sleeping: the guard has to read as genuinely
  // abandoned, not merely as older than a small staleMs. Age alone is floored
  // at OWNERLESS_GRACE_MS (#2306) so that a guard a live caller is holding is
  // never evicted, and sleeping past that floor would make this test both
  // slower and vaguer about which condition it is exercising.
  mkdirSync(`${lockDir}.recover`, { recursive: true });
  const abandonedAt = new Date(Date.now() - 60_000);
  utimesSync(`${lockDir}.recover`, abandonedAt, abandonedAt);
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

// ── status-log ledger append (funnel-velocity data source) ──────
// The ledger must land NEXT TO the sandboxed tracker, never in the repo's
// real data/ — that is the whole point of deriving its path from APPS_FILE.
{
  const sb = makeSandbox(TRACKER_9);
  const logPath = join(sb.dir, 'status-log.tsv');

  // real transition → one line, today's date, from/to states, source set-status
  const r1 = runSetStatus(['2', 'Applied', '--json'], sb);
  const today = localToday();
  let log = '';
  try { log = readFileSync(logPath, 'utf-8'); } catch {}
  if (r1.code === 0 && log === `2\t${today}\tEvaluated\tApplied\tset-status\t\n`) {
    pass('ledger: real transition appends one dated line next to the tracker');
  } else {
    fail(`ledger: expected single Evaluated→Applied line, got ${JSON.stringify(log)}\n${r1.stdout}${r1.stderr}`);
  }
  let parsed1 = null;
  try { parsed1 = JSON.parse(r1.stdout); } catch {}
  if (parsed1 && parsed1.statusLogged === true) {
    pass('ledger: JSON output carries statusLogged: true');
  } else {
    fail(`ledger: statusLogged missing/false in JSON\n${r1.stdout}`);
  }

  // no-op re-run → no new line
  runSetStatus(['2', 'Applied'], sb);
  const logAfterNoop = readFileSync(logPath, 'utf-8');
  if (logAfterNoop.trim().split('\n').length === 1) {
    pass('ledger: idempotent re-run appends nothing');
  } else {
    fail(`ledger: no-op re-run grew the log\n${logAfterNoop}`);
  }

  // --on backdates the event
  const r2 = runSetStatus(['2', 'Responded', '--on', '2026-07-01'], sb);
  const logAfterOn = readFileSync(logPath, 'utf-8');
  if (r2.code === 0 && logAfterOn.includes('2\t2026-07-01\tApplied\tResponded\tset-status\t')) {
    pass('ledger: --on records the real event date');
  } else {
    fail(`ledger: --on date not recorded\n${logAfterOn}${r2.stderr}`);
  }

  rmSync(sb.dir, { recursive: true, force: true });
}

// ── --on validation (before anything touches the tracker) ───────
{
  const sb = makeSandbox(TRACKER_9);
  const badFormat = runSetStatus(['2', 'Applied', '--on', '07/01/2026'], sb);
  if (badFormat.code === 1 && readTracker(sb).includes('| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated |')) {
    pass('--on: bad format rejected before any write');
  } else {
    fail(`--on: bad format not rejected (code=${badFormat.code})`);
  }
  const notReal = runSetStatus(['2', 'Applied', '--on', '2026-02-30'], sb);
  if (notReal.code === 1) {
    pass('--on: impossible calendar date rejected');
  } else {
    fail(`--on: 2026-02-30 accepted (code=${notReal.code})`);
  }
  const future = runSetStatus(['2', 'Applied', '--on', '2199-01-01'], sb);
  if (future.code === 1) {
    pass('--on: future date rejected');
  } else {
    fail(`--on: future date accepted (code=${future.code})`);
  }
  const missingValue = runSetStatus(['2', 'Applied', '--on', '--dry-run'], sb);
  if (missingValue.code === 1) {
    pass('--on: refuses to consume a following flag as its value');
  } else {
    fail(`--on: consumed --dry-run as a date (code=${missingValue.code})`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── dry-run never writes the ledger ──────────────────────────────
{
  const sb = makeSandbox(TRACKER_9);
  runSetStatus(['2', 'Applied', '--dry-run'], sb);
  let logExists = true;
  try { readFileSync(join(sb.dir, 'status-log.tsv'), 'utf-8'); } catch { logExists = false; }
  if (!logExists) {
    pass('ledger: --dry-run appends nothing');
  } else {
    fail('ledger: --dry-run wrote to the log');
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── ledger append failure is a warning, not a failure ────────────
// Occupy the log path with a DIRECTORY so appendFileSync fails (EISDIR),
// portable across platforms. The status write itself must still succeed.
{
  const sb = makeSandbox(TRACKER_9);
  mkdirSync(join(sb.dir, 'status-log.tsv'));
  const r = runSetStatus(['2', 'Applied', '--json'], sb);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const trackerUpdated = /\| Globex \| Platform Engineer \| 4.0\/5 \| Applied \|/.test(readTracker(sb));
  // runSetStatus discards stderr on exit-0 runs, so the warning text itself
  // isn't assertable here — statusLogged: false in the JSON is the contract.
  if (r.code === 0 && trackerUpdated && parsed?.statusLogged === false) {
    pass('ledger: append failure → exit 0, tracker updated, statusLogged: false');
  } else {
    fail(`ledger: append-failure contract broken (code=${r.code}, logged=${parsed?.statusLogged})\n${r.stderr}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// ── explicit --row / --report selectors (tracker-row-vs-report-id) ──
//
// Tracker row IDs and report IDs are independent counters sharing one number
// space, so they diverge permanently once any row exists without a report.
// This fixture is that state in miniature: row #7 links report #5, and an
// unrelated row #5 also exists — so "5" alone names two different companies.
{
  const TRACKER_DIVERGED = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 5 | 2026-06-05 | Globex | Platform Engineer | 4.0/5 | Evaluated | ✅ | [4](../reports/004-globex-2026-06-05.md) | — |
| 6 | 2026-06-06 | Initech | Data Engineer | 3.9/5 | Evaluated | ❌ | — | backfilled, no report |
| 7 | 2026-06-07 | Acme | AI Engineer | 4.4/5 | Evaluated | ✅ | [5](../reports/005-acme-2026-06-07.md) | — |
`;

  const sandboxed = fn => {
    const sandbox = makeSandbox(TRACKER_DIVERGED);
    try { fn(sandbox); } finally { rmSync(sandbox.dir, { recursive: true, force: true }); }
  };

  // Negative control: without an explicit selector the ambiguity is real and
  // the guard must still fire. If this ever passes, the tests below prove
  // nothing — they would just be exercising an unguarded path.
  sandboxed(sandbox => {
    const r = runSetStatus(['5', 'Applied'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.code === 3 || /report ID|mismatch/i.test(r.stderr)) {
      pass('selectors: bare number on a diverged tracker is still guarded');
    } else {
      fail(`selectors: bare number should be guarded, got code=${r.code}\n${r.stdout}${r.stderr}`);
    }
  });

  sandboxed(sandbox => {
    const r = runSetStatus(['--row', '5', 'Applied', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.code === 0 && parsed?.company === 'Globex') {
      pass('selectors: --row 5 selects tracker row #5 (Globex)');
    } else {
      fail(`selectors: --row 5 → code=${r.code} company=${parsed?.company}\n${r.stdout}${r.stderr}`);
    }
  });

  // The discriminating case: the SAME number through the two selectors must
  // land on two different applications.
  sandboxed(sandbox => {
    const r = runSetStatus(['--report', '5', 'Applied', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.code === 0 && parsed?.company === 'Acme') {
      pass('selectors: --report 5 selects the row LINKING report #5 (Acme, row #7)');
    } else {
      fail(`selectors: --report 5 → code=${r.code} company=${parsed?.company}\n${r.stdout}${r.stderr}`);
    }
  });

  sandboxed(sandbox => {
    const r = runSetStatus(['--row', '7', 'Applied'], sandbox);
    if (r.code === 0 && /Acme/.test(r.stdout)) {
      pass('selectors: --row bypasses the mismatch guard without --force');
    } else {
      fail(`selectors: --row 7 → code=${r.code}\n${r.stdout}${r.stderr}`);
    }
  });

  sandboxed(sandbox => {
    const before = readTracker(sandbox);
    const r = runSetStatus(['--row', '5', '--report', '5', 'Applied'], sandbox);
    if (r.code === 1 && readTracker(sandbox) === before) {
      pass('selectors: --row + --report is rejected, tracker untouched');
    } else {
      fail(`selectors: --row + --report → code=${r.code}, tracker changed=${readTracker(sandbox) !== before}`);
    }
  });

  sandboxed(sandbox => {
    const before = readTracker(sandbox);
    const r = runSetStatus(['--row', 'abc', 'Applied'], sandbox);
    if (r.code === 1 && readTracker(sandbox) === before) {
      pass('selectors: non-numeric --row is rejected before any write');
    } else {
      fail(`selectors: --row abc → code=${r.code}`);
    }
  });

  sandboxed(sandbox => {
    const before = readTracker(sandbox);
    const r = runSetStatus(['--row', '5', 'Globex', 'Applied'], sandbox);
    if (r.code === 1 && readTracker(sandbox) === before) {
      pass('selectors: --row plus a positional selector is rejected');
    } else {
      fail(`selectors: --row + positional → code=${r.code}`);
    }
  });

  sandboxed(sandbox => {
    const r = runSetStatus(['--report', '999', 'Applied'], sandbox);
    if (r.code === 2) {
      pass('selectors: --report with no linked row exits not-found (2)');
    } else {
      fail(`selectors: --report 999 → code=${r.code}\n${r.stdout}${r.stderr}`);
    }
  });

  // A row with no report link must not be reachable via --report at all.
  sandboxed(sandbox => {
    const r = runSetStatus(['--report', '6', 'Applied', '--json'], sandbox);
    if (r.code === 2) {
      pass('selectors: --report never matches a report-less row by its tracker #');
    } else {
      fail(`selectors: --report 6 should not match row #6, got code=${r.code}\n${r.stdout}`);
    }
  });

  sandboxed(sandbox => {
    const before = readTracker(sandbox);
    const r = runSetStatus(['--row'], sandbox);
    if (r.code === 1 && readTracker(sandbox) === before) {
      pass('selectors: --row without a value exits 1 without writing');
    } else {
      fail(`selectors: bare --row → code=${r.code}`);
    }
  });

  sandboxed(sandbox => {
    const before = readTracker(sandbox);
    const r = runSetStatus(['--row', '5', 'Applied', '--dry-run'], sandbox);
    if (r.code === 0 && readTracker(sandbox) === before) {
      pass('selectors: --row honours --dry-run (no write)');
    } else {
      fail(`selectors: --row + --dry-run → code=${r.code}, changed=${readTracker(sandbox) !== before}`);
    }
  });
}

// ── report-less row blind spot (#2346) ───────────────────────────
//
// merge-tracker's "Tracker #N already used; assigning #M" fallback leaves a
// backfilled row at #N while the evaluated row lands at #M keeping its [N]
// report link. A stale numeric selector then lands on the report-less row,
// which the report-link guard cannot compare against anything.
{
  const TRACKER_2346 = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Engineer | 4.0/5 | Evaluated | ✅ | [1](../reports/001-acme-2026-06-01.md) | — |
| 4 | 2026-06-04 | Umbrella | Coordinator | N/A | Applied | ❌ | — | backfilled, occupies #4 |
| 5 | 2026-06-05 | Hooli | ML Engineer | 4.3/5 | Evaluated | ❌ | [4](../reports/004-hooli-2026-06-05.md) | pushed off #4 by the collision |
`;

  const boxed = fn => {
    const sandbox = makeSandbox(TRACKER_2346);
    try { fn(sandbox); } finally { rmSync(sandbox.dir, { recursive: true, force: true }); }
  };

  // The bug: "4" names row #4 (Umbrella) AND report #4 (Hooli). Before the
  // fix this silently rewrote Umbrella.
  boxed(sandbox => {
    const before = readTracker(sandbox);
    const r = runSetStatus(['4', 'Rejected', '--note', 'rejected per email'], sandbox);
    if (r.code === 3 && readTracker(sandbox) === before) {
      pass('#2346: bare number matching a report-less row is refused, tracker untouched');
    } else {
      fail(`#2346: expected exit 3 + no write, got code=${r.code} changed=${readTracker(sandbox) !== before}\n${r.stdout}${r.stderr}`);
    }
  });

  boxed(sandbox => {
    const r = runSetStatus(['4', 'Rejected', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (parsed?.code === 'report-number-ambiguous' && parsed?.linkedBy?.[0]?.company === 'Hooli') {
      pass('#2346: structured error names the row that links the report');
    } else {
      fail(`#2346: json payload = ${JSON.stringify(parsed)}`);
    }
  });

  // Both escapes must still reach their intended, DIFFERENT rows.
  boxed(sandbox => {
    const r = runSetStatus(['--report', '4', 'Rejected', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.code === 0 && parsed?.company === 'Hooli') {
      pass('#2346: --report 4 reaches Hooli (the actually-rejected application)');
    } else {
      fail(`#2346: --report 4 → code=${r.code} company=${parsed?.company}`);
    }
  });

  boxed(sandbox => {
    const r = runSetStatus(['--row', '4', 'Rejected', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.code === 0 && parsed?.company === 'Umbrella') {
      pass('#2346: --row 4 still reaches Umbrella');
    } else {
      fail(`#2346: --row 4 → code=${r.code} company=${parsed?.company}`);
    }
  });

  boxed(sandbox => {
    const r = runSetStatus(['4', 'Rejected', '--force'], sandbox);
    if (r.code === 0 && /Umbrella/.test(r.stdout)) {
      pass('#2346: --force still overrides, unchanged escape hatch');
    } else {
      fail(`#2346: --force → code=${r.code}\n${r.stdout}${r.stderr}`);
    }
  });

  // Negative control for the new check: a report-less row whose number NO other
  // row links is unambiguous and must keep working. Without this, the fix could
  // be over-broad (refusing every backfilled row) and the tests would not notice.
  boxed(sandbox => {
    const r2 = runSetStatus(['1', 'Rejected', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r2.stdout); } catch {}
    if (r2.code === 0 && parsed?.company === 'Acme') {
      pass('#2346: unambiguous bare number is still accepted (not over-broad)');
    } else {
      fail(`#2346: bare "1" should still work, got code=${r2.code} company=${parsed?.company}`);
    }
  });
}

// ── shared candidate resolution (#2348) ──────────────────────────
//
// The three selector paths delegate their match → narrow → refuse-to-guess
// flow to resolveCandidates(). These pin the properties that must survive any
// future edit to that helper: every path fails CLOSED on 2+ survivors (the
// #1704 property, previously enforced in three separate copies), and --role
// narrowing works from every path rather than only the two that had tests.
{
  // Two rows link the SAME report — reachable when a re-evaluation is filed
  // against an existing report, or a report link is copied between rows.
  const TRACKER_DUP_REPORT = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ✅ | [9](../reports/009-acme-2026-06-01.md) | — |
| 2 | 2026-06-02 | Globex | Data Engineer | 4.0/5 | Evaluated | ✅ | [9](../reports/009-globex-2026-06-02.md) | — |
`;

  const withDupReport = fn => {
    const sandbox = makeSandbox(TRACKER_DUP_REPORT);
    try { fn(sandbox); } finally { rmSync(sandbox.dir, { recursive: true, force: true }); }
  };

  // Previously untested: the --report path had no 2+ coverage at all, so a
  // regression to first-match-wins there would have gone unnoticed.
  withDupReport(sandbox => {
    const before = readTracker(sandbox);
    const r = runSetStatus(['--report', '9', 'Applied', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.code === 3 && parsed?.code === 'ambiguous' && parsed.candidates?.length === 2
        && readTracker(sandbox) === before) {
      pass('#2348: --report fails closed on 2+ linking rows, with candidates');
    } else {
      fail(`#2348: --report dup → code=${r.code} json=${JSON.stringify(parsed)}`);
    }
  });

  // --role narrowing must serve the --report path too, not just the numeric
  // and company paths that already had coverage.
  withDupReport(sandbox => {
    const r = runSetStatus(['--report', '9', 'Applied', '--role', 'Data Engineer', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.code === 0 && parsed?.company === 'Globex') {
      pass('#2348: --role narrows a --report match to the intended row');
    } else {
      fail(`#2348: --report + --role → code=${r.code} company=${parsed?.company}`);
    }
  });

  // A --role that matches NEITHER candidate must not silently pick one; the
  // helper falls through with the original list so both stay visible.
  withDupReport(sandbox => {
    const before = readTracker(sandbox);
    const r = runSetStatus(['--report', '9', 'Applied', '--role', 'Site Reliability Engineer', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {}
    if (r.code === 3 && parsed?.candidates?.length === 2 && readTracker(sandbox) === before) {
      pass('#2348: a --role matching neither candidate still fails closed with both listed');
    } else {
      fail(`#2348: --report + unmatched --role → code=${r.code} json=${JSON.stringify(parsed)}`);
    }
  });

  // Parity: the fail-closed contract is now enforced in ONE place, so assert
  // it holds identically from every entry point. This is the test that would
  // catch a future edit to resolveCandidates() that regressed one path.
  {
    const TRACKER_ALL_AMBIGUOUS = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 7 | 2026-06-01 | Initech | Backend Engineer | 4.2/5 | Evaluated | ✅ | [3](../reports/003-initech-2026-06-01.md) | — |
| 7 | 2026-06-02 | Initech | Data Engineer | 4.0/5 | Evaluated | ✅ | [3](../reports/003-initech-2026-06-02.md) | — |
`;
    const paths = [
      ['bare numeric', ['7', 'Applied', '--json']],
      ['--row', ['--row', '7', 'Applied', '--json']],
      ['--report', ['--report', '3', 'Applied', '--json']],
      ['company', ['Initech', 'Applied', '--json']],
    ];
    const failures = [];
    for (const [label, args] of paths) {
      const sandbox = makeSandbox(TRACKER_ALL_AMBIGUOUS);
      try {
        const before = readTracker(sandbox);
        const r = runSetStatus(args, sandbox);
        let parsed = null;
        try { parsed = JSON.parse(r.stdout); } catch {}
        const ok = r.code === 3 && parsed?.candidates?.length === 2 && readTracker(sandbox) === before;
        if (!ok) failures.push(`${label} (code=${r.code}, candidates=${parsed?.candidates?.length})`);
      } finally {
        rmSync(sandbox.dir, { recursive: true, force: true });
      }
    }
    if (failures.length === 0) {
      pass('#2348: all four selector paths fail closed on 2+ candidates, none written');
    } else {
      fail(`#2348: paths that did not fail closed: ${failures.join('; ')}`);
    }
  }
}

// ── --source: attribution for a caller that delegates here (#2900) ──────────
// The web status route writes through this CLI rather than touching the tracker
// itself, so the ledger row it produces has to stay distinguishable from a CLI
// one. One value feeds the ledger; it must be legal there.
{
  const sb = makeSandbox(TRACKER_9);
  const logPath = join(sb.dir, 'status-log.tsv');
  const today = localToday();

  const r = runSetStatus(['2', 'Applied', '--source', 'web', '--json'], sb);
  let log = '';
  try { log = readFileSync(logPath, 'utf-8'); } catch {}
  if (r.code === 0 && log === `2\t${today}\tEvaluated\tApplied\tweb\t\n`) {
    pass('--source web: ledger row carries web, not set-status');
  } else {
    fail(`--source web: expected web in the source column, got ${JSON.stringify(log)}\n${r.stdout}${r.stderr}`);
  }
}

{
  const sb = makeSandbox(TRACKER_9);
  const logPath = join(sb.dir, 'status-log.tsv');
  const today = localToday();
  const r = runSetStatus(['2', 'Applied', '--json'], sb);
  let log = '';
  try { log = readFileSync(logPath, 'utf-8'); } catch {}
  if (r.code === 0 && log === `2\t${today}\tEvaluated\tApplied\tset-status\t\n`) {
    pass('--source omitted: still defaults to set-status');
  } else {
    fail(`--source default: expected set-status, got ${JSON.stringify(log)}`);
  }
}

// Fails closed. The value is written to a file another tool parses positionally
// and gates on an allow-list, so an unrecognized label would be persisted and
// then silently dropped by the reader. Reject it at the boundary instead.
for (const bad of ['correction', 'backfill', 'cell-edit', 'nonsense']) {
  const sb = makeSandbox(TRACKER_9);
  const r = runSetStatus(['2', 'Applied', '--source', bad, '--json'], sb);
  let wrote = true;
  try { readFileSync(join(sb.dir, 'status-log.tsv'), 'utf-8'); } catch { wrote = false; }
  if (r.code !== 0 && !wrote) {
    pass(`--source ${bad}: rejected non-zero and nothing written`);
  } else {
    fail(`--source ${bad}: expected rejection, got code=${r.code} wrote=${wrote}`);
  }
}

// ── #2932: "today" is the LOCAL calendar day, never the UTC one ──────────
{
  // Auckland is always at or ahead of the UTC day, so for the first hours of
  // its local day the UTC day is still yesterday. Comparing --on against the
  // UTC day therefore rejected the user's own today:
  //   TZ=Pacific/Auckland --on 2026-08-16  ->  "date is in the future"
  const nzToday = execFileSync(NODE, ['-e',
    "const d=new Date(),p=n=>String(n).padStart(2,'0');process.stdout.write(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`)",
  ], { env: { ...process.env, TZ: 'Pacific/Auckland' }, encoding: 'utf-8' }).trim();

  const sandbox = makeSandbox(TRACKER_9);
  try {
    const r = runSetStatus(['Globex', 'Interview', '--on', nzToday, '--dry-run'], sandbox, { TZ: 'Pacific/Auckland' });
    if (r.code === 0) pass('#2932: --on accepts the local today east of UTC');
    else fail(`#2932: --on rejected Auckland's own today (${nzToday}): code=${r.code} ${(r.stderr || r.stdout).split('\n')[0]}`);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }

  // MUST NOT CHANGE: a genuinely future date is still refused. Without this,
  // deleting the check entirely would pass the assertion above.
  const sandbox2 = makeSandbox(TRACKER_9);
  try {
    const r = runSetStatus(['Globex', 'Interview', '--on', '2099-01-01', '--dry-run'], sandbox2, { TZ: 'Pacific/Auckland' });
    if (r.code === 1) pass('#2932: a genuinely future --on is still rejected');
    else fail(`#2932: future date not rejected (code=${r.code})`);
  } finally {
    rmSync(sandbox2.dir, { recursive: true, force: true });
  }

  // The west-of-UTC half, pinned to an instant so it does not depend on when
  // the suite runs: at 01:30 UTC it is still the previous day in New York, and
  // the UTC-day form would write tomorrow into status-log.tsv.
  const probe = execFileSync(NODE, ['-e',
    "const {localToday}=await import('./lib/local-today.mjs');" +
    "const i=new Date('2026-08-16T01:30:00Z');" +
    "process.stdout.write(localToday(i)+' '+i.toISOString().slice(0,10));",
    '--input-type=module',
  ], { cwd: ROOT, env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf-8' }).trim();
  if (probe === '2026-08-15 2026-08-16') {
    pass('#2932: localToday() resolves the local day west of UTC where the UTC day is tomorrow');
  } else {
    fail(`#2932: localToday() west-of-UTC probe returned "${probe}", want "2026-08-15 2026-08-16"`);
  }

  // MUST NOT CHANGE: the round-trip validity check is date PARSING on UTC
  // midnight and is deliberately untouched, so a malformed date still fails.
  const sandbox3 = makeSandbox(TRACKER_9);
  try {
    const r = runSetStatus(['Globex', 'Interview', '--on', '2026-02-30', '--dry-run'], sandbox3, { TZ: 'Pacific/Auckland' });
    if (r.code === 1) pass('#2932: an impossible calendar date is still rejected');
    else fail(`#2932: 2026-02-30 accepted (code=${r.code})`);
  } finally {
    rmSync(sandbox3.dir, { recursive: true, force: true });
  }
}

// ── #3075: --report resolves a report link kept in Notes ────────────────────
// merge-tracker learned this layout in 8668ac1 — a customized tracker with no
// dedicated Report column keeps the link in Notes prose. set-status read only
// the Report cell, so --report could not find a row merge-tracker linked
// happily, and the error even advised --row for the wrong reason.
{
  const CUSTOM = `# Applications Tracker

| # | Date | Company | Role | Score | Status | Materials | Apply Link | Follow-up | Notes |
|---|------|---------|------|-------|--------|-----------|------------|-----------|-------|
| 7 | 2026-06-01 | Acme | Staff Eng | 4.2/5 | Applied | CV v3 | https://acme.example/jobs/7 | 2026-06-14 | strong fit; report [12](reports/012-acme-2026-06-01.md) |
`;

  {
    const sb = makeSandbox(CUSTOM);
    try {
      const r = runSetStatus(['--report', '12', 'Interview', '--dry-run'], sb);
      if (r.code === 0) pass('#3075: --report resolves a report link kept in the Notes cell');
      else fail(`#3075: --report 12 failed on a custom layout (code=${r.code}) ${(r.stderr || r.stdout).split('\n')[0]}`);
    } finally { rmSync(sb.dir, { recursive: true, force: true }); }
  }

  // MUST NOT CHANGE: a report nobody links is still not found. Without this,
  // making the lookup match anything would pass the assertion above.
  {
    const sb = makeSandbox(CUSTOM);
    try {
      const r = runSetStatus(['--report', '99', 'Interview', '--dry-run'], sb);
      if (r.code !== 0) pass('#3075: an unlinked report number is still not found');
      else fail('#3075: --report 99 resolved a row nothing links');
    } finally { rmSync(sb.dir, { recursive: true, force: true }); }
  }

  // MUST NOT CHANGE: Notes is prose, so the fallback is scoped to reports/.
  // A job-posting URL and an unrelated markdown link both sit in Notes here.
  {
    const NOISY = CUSTOM.replace(
      'strong fit; report [12](reports/012-acme-2026-06-01.md)',
      'applied via https://acme.example/jobs/9 — see [9](../notes/9-thing.md)',
    );
    const sb = makeSandbox(NOISY);
    try {
      const r = runSetStatus(['--report', '9', 'Interview', '--dry-run'], sb);
      if (r.code !== 0) pass('#3075: a non-report link in Notes does not claim a report number');
      else fail('#3075: --report 9 matched a non-report markdown link in Notes');
    } finally { rmSync(sb.dir, { recursive: true, force: true }); }
  }

  // MUST NOT CHANGE: a real Report cell still wins over anything in Notes.
  {
    const CONFLICT = TRACKER_9.replace(
      '| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated | ✅ | [2](../reports/002-globex-2026-06-02.md) | — |',
      '| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated | ✅ | [2](../reports/002-globex-2026-06-02.md) | also [77](reports/077-other.md) |',
    );
    const sb = makeSandbox(CONFLICT);
    try {
      const r = runSetStatus(['--report', '77', 'Interview', '--dry-run'], sb);
      if (r.code !== 0) pass('#3075: Notes is a fallback only — a populated Report cell wins');
      else fail('#3075: a Notes link overrode a populated Report cell');
    } finally { rmSync(sb.dir, { recursive: true, force: true }); }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
