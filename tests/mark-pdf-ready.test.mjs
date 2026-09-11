// tests/mark-pdf-ready.test.mjs — regression coverage for mark-pdf-ready.mjs (#2172).
//
// mark-pdf-ready.mjs is the canonical write path for the tracker's PDF column
// (❌→✅), used by the web dashboard's "pdf" mode after the backend confirms a
// successful render. Same sandboxing pattern as set-status-tests.mjs /
// tracker-columns-tests.mjs: a throwaway tracker via the CAREER_OPS_TRACKER /
// CAREER_OPS_TRACKER_LOCK env overrides tracker-utils.mjs already respects.
//
// Auto-discovered by test-all.mjs (tests/**/*.test.mjs, #1440) — imported
// in-process alongside every other discovered suite, so this file must NEVER
// exit the process itself; only pass()/fail() from ./helpers.mjs.
import { pass, fail, NODE, ROOT, directoryDenyBinds } from './helpers.mjs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nmark-pdf-ready.mjs — PDF column write path');

// Create a sandbox dir holding a tracker file, isolated from the real one.
function makeSandbox(trackerContent) {
  const dir = mkdtempSync(join(tmpdir(), 'co-markpdf-'));
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, trackerContent);
  // Must live under tmpdir and use the career-ops lock-name prefix (see
  // trackerLockDirFor) or it's ignored — still safe, just a shared-lock risk.
  const lock = join(dir, 'career-ops-merge-tracker-test.lock');
  return { dir, tracker, lock };
}

function readTracker(sandbox) {
  return readFileSync(sandbox.tracker, 'utf-8');
}

// Run mark-pdf-ready.mjs against a sandboxed tracker. Returns { code, stdout, stderr }.
function runMarkPdfReady(args, sandbox, extraEnv = {}) {
  const env = {
    ...process.env,
    CAREER_OPS_TRACKER: sandbox.tracker,
    CAREER_OPS_TRACKER_LOCK: sandbox.lock,
    ...extraEnv,
  };
  try {
    const stdout = execFileSync(NODE, [join(ROOT, 'mark-pdf-ready.mjs'), ...args], {
      cwd: ROOT, env, encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

const TRACKER_9 = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-06-01.md) | strong infra fit |
| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated | ✅ | [2](../reports/002-globex-2026-06-02.md) | — |
`;

const TRACKER_10_VIA = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 3 | 2026-06-03 | Initech | — | AI Engineer | 4.5/5 | Evaluated | ❌ | [3](../reports/003-initech-2026-06-03.md) | — |
`;

const TRACKER_DUP_REPORT = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 8 | 2026-06-08 | University of Alberta | Curriculum Coordinator | 3.8/5 | Evaluated | ❌ | [9](../reports/009-university-of-alberta-2026-06-08.md) | dup report link |
| 9 | 2026-06-09 | Esri Canada | Talent Development | 4.1/5 | Evaluated | ❌ | [9](../reports/009-esri-canada-2026-06-09.md) | dup report link |
`;

// ── 1. Happy path: flips ❌→✅ for the row linking the given report# ──
{
  // Given a 9-column tracker with report #1 (Acme) marked ❌
  const sb = makeSandbox(TRACKER_9);
  try {
    // When mark-pdf-ready is run for report #1
    const r = runMarkPdfReady(['1'], sb);
    const content = readTracker(sb);

    // Then it exits 0 and Acme's PDF cell flips to ✅, other rows untouched
    if (r.code === 0 && /\| 1 \| 2026-06-01 \| Acme \| Backend Engineer \| 4.2\/5 \| Evaluated \| ✅ \|/.test(content)) {
      pass('happy path: PDF cell flipped ❌→✅ for the matching report');
    } else {
      fail(`happy path: code=${r.code}; row not updated correctly\n${r.stdout}${r.stderr}`);
    }
    if (content.includes('| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated | ✅ |')) {
      pass('happy path: other rows untouched');
    } else {
      fail('happy path: other rows were modified');
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 2. Idempotent re-run: row already ✅ ──
{
  // Given a tracker where report #2 (Globex) is already ✅
  const sb = makeSandbox(TRACKER_9);
  try {
    const before = readTracker(sb);

    // When mark-pdf-ready is run again for report #2
    const r = runMarkPdfReady(['2', '--json'], sb);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then it exits 0, reports changed:false, and writes nothing
    if (r.code === 0 && parsed?.changed === false && readTracker(sb) === before) {
      pass('idempotent re-run: already-✅ row is a no-op success');
    } else {
      fail(`idempotent re-run: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 3. Not-found report number ──
{
  // Given a tracker with no row linking report #999
  const sb = makeSandbox(TRACKER_9);
  try {
    const before = readTracker(sb);

    // When mark-pdf-ready is run for report #999
    const r = runMarkPdfReady(['999', '--json'], sb);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then it fails closed with exit 2 and writes nothing
    if (r.code === 2 && parsed?.code === 'not-found' && readTracker(sb) === before) {
      pass('not-found: unknown report number fails closed without writing');
    } else {
      fail(`not-found: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 4. Ambiguous: two rows link the same report number ──
{
  // Given two tracker rows that both link report #9 (a tracker data bug)
  const sb = makeSandbox(TRACKER_DUP_REPORT);
  try {
    const before = readTracker(sb);

    // When mark-pdf-ready is run for report #9
    const r = runMarkPdfReady(['9', '--json'], sb);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then it refuses to guess: exit 3, both candidates listed, nothing written
    if (r.code === 3 && parsed?.code === 'ambiguous' && parsed.candidates?.length === 2 && readTracker(sb) === before) {
      pass('ambiguous: duplicate report link fails closed with both candidates');
    } else {
      fail(`ambiguous: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 5. --dry-run writes nothing ──
{
  // Given a 9-column tracker with report #1 (Acme) marked ❌
  const sb = makeSandbox(TRACKER_9);
  try {
    const before = readTracker(sb);

    // When mark-pdf-ready is run with --dry-run for report #1
    const r = runMarkPdfReady(['1', '--dry-run', '--json'], sb);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then it exits 0, reports dryRun:true, changed:true (it WOULD flip ❌→✅), and the file is untouched
    if (r.code === 0 && parsed?.dryRun === true && parsed?.changed === true && readTracker(sb) === before) {
      pass('--dry-run: resolves and reports without writing');
    } else {
      fail(`--dry-run: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 5b. --dry-run on an already-✅ row reports changed:false ──
{
  // Given a 9-column tracker where report #2 (Globex) is already ✅
  const sb = makeSandbox(TRACKER_9);
  try {
    const before = readTracker(sb);

    // When mark-pdf-ready is run with --dry-run for report #2
    const r = runMarkPdfReady(['2', '--dry-run', '--json'], sb);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then it exits 0, reports dryRun:true, changed:false (nothing to do), and the file is untouched
    if (r.code === 0 && parsed?.dryRun === true && parsed?.changed === false && readTracker(sb) === before) {
      pass('--dry-run on already-✅ row: reports changed:false');
    } else {
      fail(`--dry-run already-✅: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 6. --json output shape on success ──
{
  // Given a 9-column tracker with report #1 (Acme) marked ❌
  const sb = makeSandbox(TRACKER_9);
  try {
    // When mark-pdf-ready is run with --json for report #1
    const r = runMarkPdfReady(['1', '--json'], sb);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then the JSON carries the row identity and the report number resolved
    if (r.code === 0 && parsed?.changed === true && parsed?.num === 1
        && parsed?.company === 'Acme' && parsed?.reportNum === 1 && typeof parsed?.tracker === 'string') {
      pass('--json: success payload carries changed/num/company/reportNum/tracker');
    } else {
      fail(`--json shape: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 7. 10-column layout with a Via column ──
{
  // Given a 10-column tracker (Via column inserted) with report #3 marked ❌
  const sb = makeSandbox(TRACKER_10_VIA);
  try {
    // When mark-pdf-ready is run for report #3
    const r = runMarkPdfReady(['3'], sb);
    const content = readTracker(sb);

    // Then the PDF cell flips ✅ and the Via cell round-trips untouched
    if (r.code === 0 && /\| 3 \| 2026-06-03 \| Initech \| — \| AI Engineer \| 4.5\/5 \| Evaluated \| ✅ \|/.test(content)) {
      pass('10-col layout: PDF cell flipped ✅, Via column preserved');
    } else {
      fail(`10-col layout: code=${r.code}; row not updated correctly\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 8. Human-readable (non --json) stdout text ──
{
  // Given a 9-column tracker: report #1 (Acme, ❌) and report #2 (Globex, already ✅)
  const sb = makeSandbox(TRACKER_9);
  try {
    // When mark-pdf-ready is run for report #1 (will flip) and report #2 (already ready)
    const marked = runMarkPdfReady(['1'], sb);
    const already = runMarkPdfReady(['2'], sb);

    // Then the printed verb matches what actually happened
    if (marked.code === 0 && /marked PDF ready/.test(marked.stdout)) {
      pass('human-readable: flipped row prints "marked PDF ready"');
    } else {
      fail(`human-readable marked: code=${marked.code} stdout=${marked.stdout}${marked.stderr}`);
    }
    if (already.code === 0 && /already PDF ready/.test(already.stdout)) {
      pass('human-readable: already-✅ row prints "already PDF ready"');
    } else {
      fail(`human-readable already: code=${already.code} stdout=${already.stdout}${already.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 9. Usage error: no args ──
{
  // Given no tracker state matters — this fails during arg parsing
  const sb = makeSandbox(TRACKER_9);
  try {
    // When mark-pdf-ready is run with no arguments
    const r = runMarkPdfReady([], sb);

    // Then it exits 1 with usage text
    if (r.code === 1 && /Usage/i.test(r.stderr + r.stdout)) {
      pass('usage: no args exits 1 with usage text');
    } else {
      fail(`usage: code=${r.code}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 10. Missing tracker file -> exit 2 ──
{
  // Given CAREER_OPS_TRACKER points at a path with no tracker
  const dir = mkdtempSync(join(tmpdir(), 'co-markpdf-missing-'));
  const sandbox = { tracker: join(dir, 'does-not-exist.md'), lock: join(dir, 'career-ops-merge-tracker-test.lock') };
  try {
    // When mark-pdf-ready is run for any report number
    const r = runMarkPdfReady(['1', '--json'], sandbox);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then it fails closed with exit 2 (row-not-found family, not a usage error)
    if (r.code === 2 && parsed?.code === 'no-tracker') {
      pass('missing tracker: exit 2 with no-tracker code');
    } else {
      fail(`missing tracker: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 11. Tracker with no PDF column -> exit 1 ──
{
  // Given a header that resolveColumns recognizes as an alias-based header
  // (num/company/role/score/status all present, so it does NOT fall back to
  // LEGACY_COLMAP — which does have a pdf column) but genuinely omits PDF
  const NO_PDF_COLUMN = `# Applications Tracker

| # | Date | Company | Role | Score | Status | Report | Notes |
|---|------|---------|------|-------|--------|--------|-------|
| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | [1](../reports/001-acme-2026-06-01.md) | — |
`;
  const sb = makeSandbox(NO_PDF_COLUMN);
  try {
    // When mark-pdf-ready is run for any report number
    const r = runMarkPdfReady(['1', '--json'], sb);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then it exits 1 with the no-pdf-column code, not a crash
    if (r.code === 1 && parsed?.code === 'no-pdf-column') {
      pass('no-pdf-column: exit 1 when the tracker has no PDF column');
    } else {
      fail(`no-pdf-column: code=${r.code} json=${JSON.stringify(parsed)}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 12. Lock timeout: structured exit 4, no write ──
{
  // Given a lock already held by a live process (our own PID can never be recovered)
  const sb = makeSandbox(TRACKER_9);
  const before = readTracker(sb);
  mkdirSync(sb.lock, { recursive: true });
  writeFileSync(join(sb.lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'test', tracker: sb.tracker }));
  try {
    // When mark-pdf-ready is run against that locked tracker with a short timeout
    const r = runMarkPdfReady(['1', '--json'], sb, { CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: '300' });
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then it times out with exit 4 and writes nothing
    if (r.code === 4 && parsed?.code === 'lock-timeout' && readTracker(sb) === before) {
      pass('lock-timeout: exit 4 with structured JSON error, tracker untouched');
    } else {
      fail(`lock-timeout: code=${r.code} (want 4)\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

// ── 13. Non-timeout lock failure -> exit 1, not lock-timeout ──
{
  // Given a lock path whose parent is a regular file (mkdir fails with
  // ENOTDIR — a config error, not a busy lock)
  const dir = mkdtempSync(join(tmpdir(), 'co-markpdf-lockerr-'));
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, TRACKER_9);
  const blocker = join(dir, 'career-ops-merge-tracker-blocker');
  writeFileSync(blocker, 'not a directory');
  const badLock = join(blocker, 'career-ops-merge-tracker-bad.lock');
  try {
    // When mark-pdf-ready is run against that unusable lock path
    const r = runMarkPdfReady(['1', '--json'], { tracker, lock: badLock });
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

    // Then it fails as a config error (exit 1), keeping exit 4 reserved for retryable timeouts
    if (r.code === 1 && parsed?.code === 'lock-error') {
      pass('lock-error: filesystem lock failure exits 1, not lock-timeout');
    } else {
      fail(`lock-error: code=${r.code} (want 1) json=${parsed?.code}\n${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 14. Write failure surfaces as a structured error, not a stack ──
{
  if (process.platform !== 'win32' && process.getuid?.() === 0) {
    pass('write-failure: skipped (running as root — directory permissions are not enforced)');
  } else if (process.platform === 'win32' && !directoryDenyBinds()) {
    // Same escape hatch as root above. This suite mirrors set-status-tests.mjs's
    // write-failure test, and mirrored its Windows blind spot with it (#3423).
    pass('write-failure: skipped (an icacls write-deny does not bind this token - elevated shell)');
  } else {
    // Given the tracker's directory is readable but not writable
    const dir = mkdtempSync(join(tmpdir(), 'co-markpdf-wf-'));
    const roDir = join(dir, 'ro');
    mkdirSync(roDir);
    const tracker = join(roDir, 'applications.md');
    writeFileSync(tracker, TRACKER_9);
    const lock = join(dir, 'career-ops-merge-tracker-wf.lock');
    // On Windows, directory read-only bits don't block file creation — deny
    // write-data/append-data for Everyone (*S-1-1-0) via icacls instead
    // (mirrors set-status-tests.mjs's write-failure test).
    const denyWrite = () => process.platform === 'win32'
      ? execFileSync('icacls', [roDir, '/deny', '*S-1-1-0:(WD,AD)'])
      : chmodSync(roDir, 0o555);
    const restore = () => process.platform === 'win32'
      ? execFileSync('icacls', [roDir, '/remove:d', '*S-1-1-0'])
      : chmodSync(roDir, 0o755);
    denyWrite();
    try {
      // When mark-pdf-ready tries to flip report #1's PDF cell
      const r = runMarkPdfReady(['1', '--json'], { tracker, lock });
      let parsed = null;
      try { parsed = JSON.parse(r.stdout); } catch { /* asserted below */ }

      // Then the atomic write's failure surfaces as a structured error, not a raw stack trace
      if (r.code === 1 && parsed?.code === 'write-failure') {
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
