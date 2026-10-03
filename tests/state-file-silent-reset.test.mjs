// tests/state-file-silent-reset.test.mjs — two user-state files that must never
// reset themselves quietly.
//
// hired-share.mjs's data/.hired-share-state.json is, in its own words, "the
// entire anti-nag memory": which hires the user was asked about, and which they
// said never to bring up again. intake.mjs's data/intake-state.json is the
// ledger of documents whose proposals the user already reviewed. Both loaders
// used to answer an unreadable file with an empty object, which is
// indistinguishable from "this is a first run" — and the next write persisted
// that emptiness, so the loss was permanent.
//
// AGENTS.md makes the hired-share case absolute: "If they say no: --mark never,
// and honor it — that hire is never brought up again." A silent reset breaks
// that rule without anyone finding out. So each suite below pins both halves:
// a corrupt file is refused (loudly, exit 1, original bytes untouched), and an
// absent file is still a first run.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { pass, fail, ROOT, NODE } from './helpers.mjs';

console.log('\nState files — an unreadable file is not a first run');

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 7 | 2026-01-05 | Acme | Staff Engineer | 4.5/5 | Hired | ✅ | [7](reports/007-acme-2026-01-05.md) | — |',
  '| 8 | 2026-02-11 | Globex | Principal Engineer | 4.7/5 | Hired | ✅ | [8](reports/008-globex-2026-02-11.md) | — |',
  '',
].join('\n');

// Every child inherits a sanitized env. CAREER_OPS_TRACKER outranks the
// resolved root (DATA_CONTRACT.md), so leaving a developer's own export in
// place would point these writers at their real tracker (#3988).
function env(root) {
  return { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '' };
}

function runScript(script, args, root) {
  try {
    const stdout = execFileSync(NODE, [join(ROOT, script), ...args], {
      env: env(root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || ''),
    };
  }
}

/** A workspace with a data/ tracker, plus whatever state file the case needs. */
function makeWorkspace(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), TRACKER);
  return dir;
}

const cleanup = [];

// ── hired-share: a corrupt memory is refused, not emptied ───────────────────
{
  const dir = makeWorkspace('hired-share-corrupt-');
  cleanup.push(dir);
  const statePath = join(dir, 'data', '.hired-share-state.json');

  // The user already said "never" to #7. Then the file got truncated — the
  // exact damage a non-atomic write produces when it is interrupted.
  const corrupt = '{\n  "byReport": {\n    "7": {\n      "status": "nev';
  writeFileSync(statePath, corrupt);

  const r = runScript('hired-share.mjs', ['--root', dir, '--status'], dir);
  if (r.code !== 0) pass('--status exits nonzero on an unreadable anti-nag memory');
  else fail(`--status exited 0 with a corrupt state file; stdout: ${r.stdout.slice(0, 200)}`);

  if (/not valid JSON/i.test(r.stderr) && r.stderr.includes('.hired-share-state.json')) {
    pass('the error names the file and says it is not valid JSON');
  } else fail(`error message does not identify the problem: ${JSON.stringify(r.stderr.slice(0, 300))}`);

  if (!/^\s*Error:|\n\s+at /.test(r.stderr)) pass('the error is a message, not a stack trace');
  else fail(`stack trace leaked to the user: ${r.stderr.slice(0, 300)}`);

  if (readFileSync(statePath, 'utf8') === corrupt) {
    pass('the damaged file is left exactly as found — recoverable by hand');
  } else fail('the run rewrote the damaged state file, destroying the evidence');

  // The real regression: refusing to read is worthless if the next write
  // replaces the memory with an empty one anyway.
  const marked = runScript('hired-share.mjs', ['--root', dir, '--report', '8', '--mark', 'shared'], dir);
  if (marked.code !== 0 && readFileSync(statePath, 'utf8') === corrupt) {
    pass('--mark refuses too, rather than persisting an empty memory over it');
  } else fail('--mark overwrote the corrupt memory with a fresh one — the reset this fixes');
}

// ── hired-share: absent is still a first run ────────────────────────────────
{
  const dir = makeWorkspace('hired-share-absent-');
  cleanup.push(dir);
  const statePath = join(dir, 'data', '.hired-share-state.json');

  const r = runScript('hired-share.mjs', ['--root', dir, '--status'], dir);
  if (r.code === 0) pass('an absent state file is a first run, not an error');
  else fail(`--status failed with no state file: ${r.stderr.slice(0, 200)}`);

  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  if (parsed && parsed.askable?.length === 2) pass('both hires are askable on a first run');
  else fail(`expected 2 askable hires, got: ${r.stdout.slice(0, 200)}`);

  const marked = runScript('hired-share.mjs', ['--root', dir, '--report', '7', '--mark', 'never'], dir);
  if (marked.code === 0 && JSON.parse(readFileSync(statePath, 'utf8')).byReport['7'].status === 'never') {
    pass('--mark never records the answer');
  } else fail(`--mark never did not persist: ${marked.stderr.slice(0, 200)}`);

  // Guard: the whole point of the memory. #7 must not come back.
  const after = runScript('hired-share.mjs', ['--root', dir, '--status'], dir);
  const askable = JSON.parse(after.stdout).askable;
  if (!askable.includes('7') && askable.includes('8')) {
    pass('a "never" hire drops out of askable and the untouched one stays');
  } else fail(`AGENTS.md cadence rule broken — askable: ${JSON.stringify(askable)}`);

  // Guard: the atomic write must not leave its temp file behind.
  const strays = readdirSync(join(dir, 'data')).filter((f) => f.endsWith('.tmp'));
  if (strays.length === 0) pass('the atomic write leaves no .tmp file behind');
  else fail(`stray temp files after write: ${strays.join(', ')}`);
}

// ── hired-share: JSON that parses but is not a state object ─────────────────
//
// Exit code alone does not pin this. Before the fix these already exited
// nonzero -- but by dereferencing the missing `byReport` and surfacing
// "Cannot read properties of undefined (reading '7')", a message that names
// neither the file nor the problem and reads like a crash in the tool rather
// than a damaged file the user can fix. So assert the file is NAMED.
{
  for (const [label, body] of [['an array', '[]'], ['null', 'null'], ['a string', '"never"'], ['a number', '3']]) {
    const dir = makeWorkspace('hired-share-shape-');
    cleanup.push(dir);
    writeFileSync(join(dir, 'data', '.hired-share-state.json'), body);
    const r = runScript('hired-share.mjs', ['--root', dir, '--status'], dir);
    if (r.code !== 0 && r.stderr.includes('.hired-share-state.json')) {
      pass(`${label} in the state file is refused, and the message names the file`);
    } else {
      fail(`${label}: expected a refusal naming the state file, got code ${r.code} / `
        + `${JSON.stringify(r.stderr.slice(0, 160))}`);
    }
  }
}

// ── hired-share: a root-level tracker has no data/ to write into ────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'hired-share-rootlevel-'));
  cleanup.push(dir);
  // The documented fallback layout: applications.md at the root, no data/.
  writeFileSync(join(dir, 'applications.md'), TRACKER);

  const r = runScript('hired-share.mjs', ['--root', dir, '--report', '7', '--mark', 'never'], dir);
  if (r.code === 0) pass('--mark never works with a root-level tracker and no data/');
  else fail(`--mark never failed where data/ does not exist yet: ${r.stderr.slice(0, 200)}`);

  const statePath = join(dir, 'data', '.hired-share-state.json');
  if (existsSync(statePath) && JSON.parse(readFileSync(statePath, 'utf8')).byReport['7'].status === 'never') {
    pass('the answer is persisted after creating data/');
  } else fail('the "never" answer was reported as recorded but is not on disk');
}

// ── intake: a corrupt ledger is refused, not treated as empty ───────────────
{
  const dir = makeWorkspace('intake-corrupt-');
  cleanup.push(dir);
  mkdirSync(join(dir, 'documents'), { recursive: true });
  writeFileSync(join(dir, 'documents', 'master-cv.md'), '# Master CV\n\nTen years of things.\n');
  const statePath = join(dir, 'data', 'intake-state.json');
  const corrupt = '{"ingested": {"documents/master-cv.md": {"hash": "abc';
  writeFileSync(statePath, corrupt);

  const r = runScript('intake.mjs', ['--summary'], dir);
  if (r.code !== 0) pass('intake exits nonzero on an unreadable ingest ledger');
  else fail(`intake exited 0 with a corrupt ledger; stdout: ${r.stdout.slice(0, 200)}`);

  if (/not valid JSON/i.test(r.stderr) && r.stderr.includes('intake-state.json')) {
    pass('the error names the ledger and says it is not valid JSON');
  } else fail(`error message does not identify the problem: ${JSON.stringify(r.stderr.slice(0, 300))}`);

  if (!/^\s*Error:|\n\s+at /.test(r.stderr)) pass('the ledger error is a message, not a stack trace');
  else fail(`stack trace leaked to the user: ${r.stderr.slice(0, 300)}`);

  if (!/\bnew\b/.test(r.stdout)) pass('no document is re-proposed as new off a ledger it cannot read');
  else fail(`intake proposed documents anyway: ${r.stdout.slice(0, 300)}`);

  if (readFileSync(statePath, 'utf8') === corrupt) pass('the damaged ledger is left exactly as found');
  else fail('intake rewrote the damaged ledger');
}

// ── intake: absent ledger is a first run; a healthy one is honored ──────────
{
  const dir = makeWorkspace('intake-healthy-');
  cleanup.push(dir);
  mkdirSync(join(dir, 'documents'), { recursive: true });
  writeFileSync(join(dir, 'documents', 'master-cv.md'), '# Master CV\n\nTen years of things.\n');

  const first = runScript('intake.mjs', ['--summary'], dir);
  if (first.code === 0 && /master-cv\.md\s+new\b/.test(first.stdout)) {
    pass('an absent ledger is a first run — the document reads as new');
  } else fail(`first run did not report the document as new: ${first.stdout.slice(0, 300)}${first.stderr.slice(0, 200)}`);

  const committed = runScript('intake.mjs', ['--commit', 'master-cv.md'], dir);
  if (committed.code === 0) pass('--commit records the reviewed source');
  else fail(`--commit failed: ${committed.stderr.slice(0, 200)}`);

  // Guard: the reason the ledger exists at all.
  const second = runScript('intake.mjs', ['--summary'], dir);
  if (/master-cv\.md\s+ingested\b/.test(second.stdout)) {
    pass('a reviewed document is not proposed again');
  } else fail(`reviewed document came back as unreviewed: ${second.stdout.slice(0, 300)}`);

  const strays = readdirSync(join(dir, 'data')).filter((f) => f.endsWith('.tmp'));
  if (strays.length === 0) pass('the ledger write leaves no .tmp file behind');
  else fail(`stray temp files after commit: ${strays.join(', ')}`);
}

// ── intake: JSON that parses but is not a ledger object ────────────────────
{
  for (const [label, body] of [['an array', '[]'], ['null', 'null'], ['a string', '"{}"']]) {
    const dir = makeWorkspace('intake-shape-');
    cleanup.push(dir);
    mkdirSync(join(dir, 'documents'), { recursive: true });
    writeFileSync(join(dir, 'documents', 'master-cv.md'), '# CV\n\nthings\n');
    writeFileSync(join(dir, 'data', 'intake-state.json'), body);
    const r = runScript('intake.mjs', ['--summary'], dir);
    if (r.code !== 0 && r.stderr.includes('intake-state.json')) {
      pass(`${label} in the ledger is refused, and the message names the ledger`);
    } else {
      fail(`${label}: expected a refusal naming the ledger, got code ${r.code} / `
        + `${JSON.stringify(r.stderr.slice(0, 160))} / stdout ${r.stdout.slice(0, 120)}`);
    }
  }
}

for (const dir of cleanup) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
