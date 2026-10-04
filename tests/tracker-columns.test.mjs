/**
 * tracker-columns.test.mjs — regression tests for header-name column mapping.
 *
 * merge-tracker.mjs and verify-pipeline.mjs used to parse applications.md by
 * fixed column position. Inserting a column (e.g. a Location column after Role)
 * shifted every later index by one — Location was read as Score, Score as
 * Status — so verify-pipeline flagged false errors and merge-tracker wrote
 * malformed rows. Both now map columns by header NAME (see #946).
 *
 * Every case provisions a throwaway tracker + additions dir and asserts that
 * each reader and writer keeps every value in its own column, across layouts.
 *
 * In-process by default (#4758). This was `tracker-columns-tests.mjs` at the
 * repo root, and it started 75 node processes: merge-tracker.mjs and
 * tracker.mjs read their paths from the environment once, at module load, so
 * a fresh process per case was the only way to point them at a new sandbox.
 * Its runtime was spawn count × cold start — 14s locally, over 30s once on
 * windows-latest — and grew with every case added. Both scripts now export a
 * function that takes its paths (mergeTracker, runTracker), so the cases call
 * those directly. What still spawns is what process isolation is FOR: exit
 * codes, `--migrate-via` from the command line, `export --out` refusing under
 * the tracker lock, and the scripts this suite checks but does not own
 * (verify-pipeline, normalize-statuses, dedup-tracker).
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { format } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveTsvColumns, resolveColumns, parseTrackerRow, HEADER_ALIASES } from '../tracker-parse.mjs';
import { canonicalizeTrackerPath } from '../path-resolver.mjs';
import { mergeTracker } from '../merge-tracker.mjs';
import { runTracker, removeRowByNum } from '../tracker.mjs';
import { loadSeenCompanyRoles } from '../scan.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;

// web/ lives deliberately OUTSIDE the auto-updater's world (its own
// release-please component; see validate-system-paths-coverage.mjs
// EXCLUDE_PREFIXES), so installs updated via `update-system.mjs apply` have
// the core WITHOUT the web/ tree. The web-reader tests below exercise the
// real alias chain on fresh clones and CI, and skip cleanly on core-only
// installs instead of crashing the whole suite with ERR_MODULE_NOT_FOUND.
const HAS_WEB = existsSync(join(ROOT, 'web', 'src', 'lib', 'tracker-table.mjs'));
const WEB = HAS_WEB ? {} : { skip: 'web/ not present (core-only install; web/ is excluded from the auto-updater by design)' };
// Relative specifiers: an absolute path is not a valid ESM specifier on
// Windows (`D:\...` reads as a URL scheme).
const webTable = () => import('../web/src/lib/tracker-table.mjs');

// ── child processes ────────────────────────────────────────────────────────
// The few cases that need a real process. Spawned async, never spawnSync:
// test-all caps this suite at 30s and on timeout SIGTERMs `node --test`, which
// forwards it here — and a child started by a process that dies is not killed
// with it. A blocking spawnSync would leave no chance to run the handler below;
// awaiting a spawn does, so a timeout leaves no stray node processes behind.
// The handler is `once`, so re-raising the signal afterwards gets the default
// action and the suite still dies of the signal it was sent.
const children = new Set();
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    for (const child of children) child.kill('SIGKILL');
    process.kill(process.pid, signal);
  });
}

// Run a script with tracker/additions redirected to a sandbox. Returns
// { code, stdout, stderr }. `stdout` folds in stderr on the failure path so an
// assertion message carries the reason; `stderr` is always the raw stream.
function runScript(script, args, sandbox) {
  const env = {
    ...process.env,
    CAREER_OPS_TRACKER: sandbox.tracker,
    CAREER_OPS_ADDITIONS: sandbox.additions,
    CAREER_OPS_BATCH_STATE: sandbox.batchState,
    CAREER_OPS_TRACKER_LOCK: sandbox.lock,
    // The derived SQLite index defaults to sitting beside the tracker it was
    // built from — pin it into the sandbox so a test run can never create one
    // next to the developer's real data (#3506).
    CAREER_OPS_TRACKER_DB: sandbox.db,
    // Pinned for the same reason as the tracker: keep the fixture isolated from
    // the real reports/ dir. See makeSandbox.
    CAREER_OPS_REPORTS: sandbox.reports,
  };
  return new Promise((resolvePromise) => {
    const child = spawn(NODE, [join(ROOT, script), ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf-8').on('data', (d) => { stderr += d; });
    // Bounded per child, well inside the suite's own cap, so one hung script
    // fails its case with a reason instead of consuming the whole budget.
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    const done = (code, why = '') => {
      clearTimeout(timer);
      children.delete(child);
      resolvePromise(code === 0
        ? { code, stdout, stderr }
        : { code: code ?? 1, stdout: `${stdout}${stderr}${why}`, stderr: `${stderr}${why}` });
    };
    child.on('error', (err) => done(1, err.message));
    child.on('close', (code, signal) => done(code, signal ? `(signal ${signal})` : ''));
  });
}

// ── in-process entry points ────────────────────────────────────────────────

// A logger that keeps what merge-tracker printed, every stream in one string:
// merge-tracker exits 0 when it SKIPS a malformed addition (other files in the
// run still merge), and every refusal message is a console.warn, so the
// assertions below need warn/error as much as log.
function captureLogger() {
  const lines = [];
  const push = (...parts) => { lines.push(format(...parts)); };
  return { logger: { log: push, warn: push, error: push, info: push }, text: () => lines.join('\n') };
}

// Merge a sandbox's pending additions in-process: the same paths the CLI
// would resolve from the env runScript sets, and the same code path, the
// post-merge PDF flag sync included.
async function merge(sb, flags = {}) {
  const { logger, text } = captureLogger();
  const code = await mergeTracker({
    appsFile: canonicalizeTrackerPath(sb.tracker),
    dataRoot: sb.dir,
    additionsDir: sb.additions,
    batchStateFile: sb.batchState,
    lockDir: sb.lock,
    flags,
    logger,
  });
  return { code, stdout: text() };
}

// Run one tracker.mjs command in-process against the sandbox tracker + index.
async function runTrackerIn(sb, command, ...args) {
  let stdout = '';
  let stderr = '';
  const code = await runTracker(command, args, {
    mdPath: canonicalizeTrackerPath(sb.tracker),
    dbPath: sb.db,
    stdout: { write: (s) => { stdout += s; } },
    stderr: { write: (s) => { stderr += s; } },
  });
  return { code, stdout, stderr };
}

// Sync the sandbox tracker into the tracker.mjs index and return one parsed
// row by company name (row is null when sync/query fails or the row is absent).
async function syncAndQueryRow(sb, company) {
  const sync = await runTrackerIn(sb, 'sync');
  const query = await runTrackerIn(sb, 'query', '--json');
  let row = null;
  try { row = JSON.parse(query.stdout).find(r => r.company === company) ?? null; } catch { /* malformed output → null */ }
  return { sync, query, row };
}

// ── fixtures ───────────────────────────────────────────────────────────────

// Create a sandbox dir holding a tracker file and an additions dir.
function makeSandbox(trackerContent, additions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-cols-'));
  const tracker = join(dir, 'applications.md');
  const additionsDir = join(dir, 'tracker-additions');
  // An empty reports dir belongs in the sandbox alongside the tracker. Without
  // it verify-pipeline scans the REAL reports/ dir and emits one "Orphan report"
  // warning per report not referenced by this fixture's tracker -- 213 of them
  // at 256 reports. That made a verify case slow enough to trip its own 30s
  // timeout under full-suite load. Same fixture bug as the #1704 block in
  // test-all.mjs (see PATCHES.md patch 10).
  const reportsDir = join(dir, 'reports');
  mkdirSync(additionsDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(tracker, trackerContent);
  for (const [name, content] of Object.entries(additions)) {
    writeFileSync(join(additionsDir, name), content);
  }
  return {
    dir,
    tracker,
    additions: additionsDir,
    // Not a valid CAREER_OPS_TRACKER_LOCK (those must carry the
    // career-ops-merge-tracker- prefix), so a spawned script falls back to the
    // lock derived from the sandbox tracker's own path. In-process callers take
    // it as given. Either way it is unique to this sandbox.
    lock: join(dir, 'lock'),
    batchState: join(dir, 'batch-state.tsv'),
    db: join(dir, 'applications.db'),
    reports: reportsDir,
  };
}

const removeSandbox = (sb) => rmSync(sb.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

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

const cellsOf = (row) => (row ? row.split('|').map(s => s.trim()) : []);

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
// Through the CLI: the one end-to-end merge, covering the exit code, the env
// resolution in merge-tracker's CLI branch, and the sync-pdf-flags child.
describe('merge-tracker CLI: 10-column tracker', () => {
  let sb, res, cells;
  before(async () => {
    sb = makeSandbox(HEADER_10, { '2-globex.tsv': TSV_WITH_LOCATION });
    res = await runScript('merge-tracker.mjs', [], sb);
    // cells: ['', num, date, company, role, location, score, status, pdf, report, notes, '']
    cells = cellsOf(dataRows(sb.tracker).find(l => l.includes('Globex')));
  });
  after(() => removeSandbox(sb));

  test('merge into 10-col tracker exits 0', () => {
    assert.equal(res.code, 0, res.stdout);
  });
  test('Location column populated (not shifted into Score)', () => {
    assert.equal(cells[5], 'Singapore', cells.join(' | '));
  });
  test('Score sits in the Score column', () => {
    assert.equal(cells[6], 'N/A', cells.join(' | '));
  });
  test('Status sits in the Status column', () => {
    assert.equal(cells[7], 'Applied', cells.join(' | '));
  });
});

// ── Test 2: verify-pipeline is clean on a 10-column tracker ────────────────
describe('verify-pipeline: 10-column tracker', () => {
  let sb, res;
  before(async () => {
    sb = makeSandbox(HEADER_10);
    res = await runScript('verify-pipeline.mjs', [], sb);
  });
  after(() => removeSandbox(sb));

  test('verify-pipeline clean on 10-col tracker (no false column errors)', () => {
    assert.equal(res.code, 0, res.stdout);
    assert.match(res.stdout, /0 errors/);
  });
});

// ── Test 3: legacy 9-column layout still works (back-compat) ───────────────
describe('legacy 9-column tracker', () => {
  let sb, mergeRes, verify, cells;
  before(async () => {
    sb = makeSandbox(HEADER_9, { '2-globex.tsv': TSV_NO_LOCATION });
    mergeRes = await merge(sb);
    verify = await runScript('verify-pipeline.mjs', [], sb);
    // cells: ['', num, date, company, role, score, status, pdf, report, notes, '']
    cells = cellsOf(dataRows(sb.tracker).find(l => l.includes('Globex')));
  });
  after(() => removeSandbox(sb));

  test('9-col tracker still merges into correct columns', () => {
    assert.equal(mergeRes.code, 0, mergeRes.stdout);
    assert.equal(cells[5], 'N/A', cells.join(' | '));
    assert.equal(cells[6], 'Applied', cells.join(' | '));
  });
  test('verify-pipeline clean on legacy 9-col tracker', () => {
    assert.equal(verify.code, 0, verify.stdout);
    assert.match(verify.stdout, /0 errors/);
  });
});

// ── Test 4: tracker.mjs maps a 10-column tracker by header (#1596) ──────────
// tracker.mjs used a fixed 9-cell destructure, so a Location column shifted
// Score into Status and folded the real Notes cell away.
describe('tracker.mjs: 10-column tracker', () => {
  let sb, got;
  before(async () => {
    sb = makeSandbox(HEADER_10);
    got = await syncAndQueryRow(sb, 'Acme');
    assert.equal(got.sync.code, 0, got.sync.stderr);
    assert.equal(got.query.code, 0, got.query.stderr);
    assert.ok(got.row, `no Acme row in ${got.query.stdout}`);
  });
  after(() => removeSandbox(sb));

  test('tracker.mjs: Role read from Role column on 10-col tracker', () => {
    assert.equal(got.row.role, 'Engineer');
  });
  test('tracker.mjs: Score not shifted on 10-col tracker', () => {
    assert.equal(got.row.score, '4.0/5');
  });
  test('tracker.mjs: Status not shifted on 10-col tracker', () => {
    assert.equal(got.row.status, 'Applied');
  });
  test('tracker.mjs: Notes intact on 10-col tracker', () => {
    assert.equal(got.row.notes, 'seed row');
  });
});

// ── Test 5: removeRowByNum resolves the Report column by header ─────────────
test('removeRowByNum: report column resolved by header on 10-col tracker', () => {
  const tenCol = HEADER_10.replace('| — | seed row |', '| [1](reports/001-acme-2026-01-01.md) | seed row |');
  const res = removeRowByNum(tenCol, 1);
  assert.equal(res.removed, true);
  assert.equal(res.report, '[1](reports/001-acme-2026-01-01.md)');
});

// ── Test 6: scan.mjs seen-set maps company/role by header ───────────────────
// loadSeenCompanyRoles used a positional regex, so a 10-col tracker produced
// keys like "engineer::remote" and scan dedup missed real matches.
describe('scan.mjs seen-set: 10-column tracker', () => {
  let sb, seen;
  before(() => {
    sb = makeSandbox(HEADER_10);
    seen = loadSeenCompanyRoles(sb.tracker, undefined, sandboxSources(sb));
  });
  after(() => removeSandbox(sb));

  test('scan.mjs: seen-set keys company::role on 10-col tracker', () => {
    assert.ok(seen.has('acme::engineer'), `got [${[...seen].join(', ')}]`);
  });
  test('scan.mjs: seen-set has no shifted-column garbage keys', () => {
    assert.ok(![...seen].some(k => k.includes('remote') || k.includes('4.0/5')), `got [${[...seen].join(', ')}]`);
  });
});

// ── Test 6b: normalize-statuses maps Status/Score/Notes by header (#1955) ───
// normalize-statuses.mjs read Status at parts[6], Score at parts[5] and Notes
// at parts[9]. On a 10-column tracker every one of those lands a column early:
// the Score cell was normalized as if it were a status — a `—` score (the
// tracker's own "no evaluation" sentinel) mapped to Discarded and OVERWROTE
// the Score column — while the real, non-canonical status was left untouched
// and reported as an unknown status instead.
describe('normalize-statuses: 10-column tracker', () => {
  const TEN_COL_MESSY = `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Engineer | Remote | — | Aplicado 2026-01-02 | ✅ | — | backfilled, no eval |
| 2 | 2026-01-03 | Globex | Manager | Berlin | 4.5/5 | DUPLICADO de #1 | ❌ | — | keep me |
`;
  let sb, res, rowOf;
  before(async () => {
    sb = makeSandbox(TEN_COL_MESSY);
    res = await runScript('normalize-statuses.mjs', [], sb);
    const rows = dataRows(sb.tracker);
    rowOf = (company) => rows.find(l => l.includes(company)) || '';
  });
  after(() => removeSandbox(sb));

  // cells: ['', num, date, company, role, location, score, status, pdf, report, notes, '']
  test('normalize-statuses: Status normalized in place on 10-col tracker, Score not clobbered', () => {
    const acme = cellsOf(rowOf('Acme'));
    assert.equal(res.code, 0, res.stdout);
    assert.equal(acme[7], 'Applied', rowOf('Acme'));
    assert.equal(acme[6], '—', rowOf('Acme'));
  });
  test('normalize-statuses: DUPLICADO provenance lands in the Notes column on 10-col tracker', () => {
    const globex = cellsOf(rowOf('Globex'));
    assert.equal(globex[7], 'Discarded', rowOf('Globex'));
    assert.equal(globex[6], '4.5/5', rowOf('Globex'));
    assert.ok(globex[10].includes('DUPLICADO de #1') && globex[10].includes('keep me'), rowOf('Globex'));
  });
});

// ── Test 7: schema contract — every consumer maps an UNKNOWN extra column ───
// The header-name contract (#1596): a column no consumer recognizes must be
// skipped by ALL of them, never silently shifted into a known field. This is
// the guard that makes the next column insertion a one-place change instead of
// a repo-wide incident.
describe('contract: an unknown extra column', () => {
  const HEADER_UNKNOWN = `# Applications Tracker

| # | Date | Company | Priority | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|----------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | high | Engineer | 4.0/5 | Applied | ✅ | — | seed row |
`;
  let sb, verify, got, seen, norm, before_, after_;
  before(async () => {
    sb = makeSandbox(HEADER_UNKNOWN);
    verify = await runScript('verify-pipeline.mjs', [], sb);
    got = await syncAndQueryRow(sb, 'Acme');
    seen = loadSeenCompanyRoles(sb.tracker, undefined, sandboxSources(sb));
    // The seed status is already canonical, so a header-aware run is a strict
    // no-op: the file must come back byte-identical and nothing may be reported
    // as an unknown status.
    before_ = readFileSync(sb.tracker, 'utf-8');
    norm = await runScript('normalize-statuses.mjs', [], sb);
    after_ = readFileSync(sb.tracker, 'utf-8');
  });
  after(() => removeSandbox(sb));

  test('contract: verify-pipeline skips an unknown extra column', () => {
    assert.equal(verify.code, 0, verify.stdout);
    assert.match(verify.stdout, /0 errors/);
  });
  test('contract: tracker.mjs skips an unknown extra column', () => {
    assert.equal(got.sync.code, 0, got.sync.stderr);
    assert.ok(got.row, got.query.stdout);
    assert.deepEqual(
      { role: got.row.role, score: got.row.score, status: got.row.status },
      { role: 'Engineer', score: '4.0/5', status: 'Applied' },
    );
  });
  test('contract: scan.mjs seen-set skips an unknown extra column', () => {
    assert.deepEqual([...seen], ['acme::engineer']);
  });
  test('contract: normalize-statuses skips an unknown extra column', () => {
    assert.equal(norm.code, 0, norm.stdout);
    assert.equal(after_, before_);
    assert.doesNotMatch(norm.stdout, /unknown statuses/);
  });
});

// ── Test 8: web read path resolves headers via the SHARED alias table ───────
// web/src/lib/tracker-table.mjs (behind readApplications() in career-ops.ts)
// loads tracker-aliases.json — the same file tracker-parse.mjs exports as
// HEADER_ALIASES — instead of mirroring it. Passing ROOT here exercises the
// REAL alias file, so an alias added/renamed there is either honored by the
// web reader too or fails this test; a second drifting table can't come back.
describe('web reader: shared alias table', WEB, () => {
  const WEB_10COL = `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Priority | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|----------|-------|
| 1 | 2026-01-01 | Acme | Engineer | Remote | 4.0/5 | Applied | ✅ | — | high | seed row |
`;
  let web, rows, r;
  before(async () => {
    web = await webTable();
    rows = web.parseApplications(WEB_10COL, ROOT);
    r = rows[0];
  });

  test('web reader: Company/Role read by header on 10-col tracker', () => {
    assert.equal(rows.length, 1);
    assert.equal(r.company, 'Acme');
    assert.equal(r.role, 'Engineer');
  });
  test('web reader: Score/Status not shifted by Location column', () => {
    assert.equal(r.score, '4.0/5');
    assert.equal(r.status, 'Applied');
  });
  test('web reader: unknown Priority column skipped, Notes intact', () => {
    assert.equal(r.notes, 'seed row');
  });
  // Recognizing a column is not the same as delivering it: `location` is in
  // tracker-aliases.json AND in WEB_FIELD, so detectColumnMap mapped it all
  // along — and the emitter, written out by hand, dropped the value anyway.
  // Same failure as Apply Link / Follow-up below, one step further along.
  test('web reader: Location column reaches the caller', () => {
    assert.equal(r.location, 'Remote');
  });
  // A tracker predating the column keeps working; the field reads as "".
  test('web reader: tracker without a Location column still parses, field empty', () => {
    const LEGACY_NO_LOCATION = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ✅ | — | seed row |
`;
    const noLoc = web.parseApplications(LEGACY_NO_LOCATION, ROOT)[0];
    assert.ok(noLoc);
    assert.equal(noLoc.location, '');
    assert.equal(noLoc.notes, 'seed row');
  });
  // The web reader and the Node tooling must consume the IDENTICAL table.
  test('web reader: alias table is byte-identical to tracker-parse HEADER_ALIASES', () => {
    const webAliases = web.loadHeaderAliases(ROOT);
    assert.ok(Object.keys(webAliases).length > 0);
    assert.equal(JSON.stringify(webAliases), JSON.stringify(HEADER_ALIASES));
  });

  // Every column the SHARED alias table resolves has to reach the caller, not
  // just be recognized: "apply link" → applylink and "follow-up" → followup are
  // in tracker-aliases.json, but WEB_FIELD mapped neither, so the web read path
  // detected both columns and then dropped their values on the floor.
  const WEB_APPLY_FOLLOWUP = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Apply Link | Follow-up | Notes |
|---|------|---------|------|-------|--------|-----|--------|------------|-----------|-------|
| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ✅ | — | [ad](https://example.com/jobs/1) | 2026-01-08 | seed row |
`;
  test('web reader: Apply Link / Follow-up columns reach the caller', () => {
    const wide = web.parseApplications(WEB_APPLY_FOLLOWUP, ROOT)[0];
    assert.ok(wide);
    assert.equal(wide.applyLink, '[ad](https://example.com/jobs/1)');
    assert.equal(wide.followUp, '2026-01-08');
  });
  test('web reader: Notes/Status unaffected by the two added fields', () => {
    const wide = web.parseApplications(WEB_APPLY_FOLLOWUP, ROOT)[0];
    assert.equal(wide.notes, 'seed row');
    assert.equal(wide.status, 'Applied');
  });
  // A tracker predating those columns keeps working; the fields read as "".
  // Its header IS recognized, so this covers the mapped branch with the two
  // columns simply absent from the map.
  test('web reader: 9-column tracker still parses, new fields empty', () => {
    const LEGACY_9COL = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ✅ | — | seed row |
`;
    const legacy = web.parseApplications(LEGACY_9COL, ROOT)[0];
    assert.ok(legacy);
    assert.deepEqual([legacy.applyLink, legacy.followUp, legacy.notes], ['', '', 'seed row']);
  });
  // The general rule the three field bugs are instances of: whatever WEB_FIELD
  // names, a parsed row carries. Asserted on the shape rather than on any one
  // field, so the next column added to the map cannot be dropped silently by
  // an emitter that forgot it.
  test('web reader: every WEB_FIELD name reaches the caller', () => {
    const shaped = web.parseApplications(WEB_10COL, ROOT)[0];
    const missing = web.WEB_FIELD_NAMES.filter((f) => !(f in shaped));
    assert.deepEqual(missing, [], `fields named by the map but absent from the row (${web.WEB_FIELD_NAMES.length} fields)`);
  });
  // The fixed-order fallback is a SECOND path, reached only when no header is
  // recognized at all — the shape of a tracker whose header row was edited or
  // lost. The fixture above cannot reach it, so the branch that hard-codes the
  // column order needs its own rows with no header above them.
  test('web reader: headerless tracker takes the fixed-order path, new fields empty', () => {
    const NO_HEADER = `| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Applied | ✅ | — | seed row |
`;
    const positional = web.parseApplications(NO_HEADER, ROOT)[0];
    assert.ok(positional);
    assert.deepEqual(
      [positional.company, positional.role, positional.applyLink, positional.followUp, positional.notes],
      ['Acme', 'Engineer', '', '', 'seed row'],
    );
  });
});

// ═══ Stage 2 (#1596): Via column ════════════════════════════════════════════

const HEADER_VIA = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | — | Engineer | 4.0/5 | Applied | ✅ | — | direct seed row |
| 2 | 2026-01-05 | ? | Hays | Data Engineer | 4.2/5 | Applied | ✅ | — | fintech, Leeds |
`;

// ── Test 9: parseTrackerRow surfaces the Via column ─────────────────────────
describe('parseTrackerRow: Via column', () => {
  const lines = HEADER_VIA.split('\n');
  const colmap = resolveColumns(lines);
  const rows = lines.map(l => parseTrackerRow(l, colmap)).filter(Boolean);

  test('parseTrackerRow: Via column mapped, later columns not shifted', () => {
    const direct = rows.find(r => r.num === 1);
    assert.ok(direct);
    assert.deepEqual([direct.via, direct.role, direct.score], ['—', 'Engineer', '4.0/5']);
  });
  test('parseTrackerRow: unknown-employer (?) row carries via', () => {
    const blind = rows.find(r => r.num === 2);
    assert.ok(blind);
    assert.deepEqual([blind.company, blind.via, blind.status], ['?', 'Hays', 'Applied']);
  });
});

// ── Test 10: TSV `via=` tagged field merges into the Via column ──────────────
// The batch TSV is header-less and positional; Via travels as a tagged extra
// field (`via=Hays`) instead of another positional slot, so a stale writer
// omitting the empty-location pad can't silently shift columns.
test('merge: via= tag lands in the Via column, ? company preserved', async (t) => {
  const TSV_VIA = '3\t2026-02-02\t?\tPlatform Engineer\tApplied\t4.1/5\t✅\t—\tblind agency listing\tvia=Hays\n';
  const sb = makeSandbox(HEADER_VIA, { '3-blind.tsv': TSV_VIA });
  t.after(() => removeSandbox(sb));
  const res = await merge(sb);
  const row = dataRows(sb.tracker).find(l => l.includes('Platform Engineer'));
  const cells = cellsOf(row);
  // cells: ['', num, date, company, via, role, score, status, pdf, report, notes, '']
  assert.equal(res.code, 0, res.stdout);
  assert.deepEqual([cells[3], cells[4], cells[6], cells[7]], ['?', 'Hays', '4.1/5', 'Applied'], `${row}\n${res.stdout}`);
});

// ── Test 11: ambiguous TSV extras are rejected loudly, never merged ─────────
test('merge: ambiguous extras (two untagged / duplicate via=) rejected, not merged', async (t) => {
  const TWO_UNTAGGED = '4\t2026-02-02\tGlobex\tManager\tApplied\tN/A\t✅\t—\tnote\tSingapore\tHays\n';
  const TWO_TAGS = '5\t2026-02-02\tGlobex\tManager\tApplied\tN/A\t✅\t—\tnote\tvia=Hays\tvia=Randstad\n';
  const sb = makeSandbox(HEADER_VIA, { '4-a.tsv': TWO_UNTAGGED, '5-b.tsv': TWO_TAGS });
  t.after(() => removeSandbox(sb));
  const res = await merge(sb);
  const rows = dataRows(sb.tracker);
  assert.ok(!rows.some(l => l.includes('Globex')), rows.join('\n'));
  assert.match(res.stdout, /2 skipped/);
});

// ── Test 12: cross-channel guard — ? rows never fuzzy-merge across agencies ─
// Two blind listings for the same role via DIFFERENT agencies are distinct
// submissions (#1596): merging them silently is exactly the double-submission
// hazard the Via column exists to surface. Same agency + same role IS the
// re-blast duplicate and must still merge/update.
describe('merge: cross-channel guard for ? rows', () => {
  const OTHER_AGENCY = '6\t2026-02-02\t?\tData Engineer\tApplied\t4.5/5\t✅\t—\tsame role, other agency\tvia=Randstad\n';
  const SAME_AGENCY = '7\t2026-02-03\t?\tData Engineer\tApplied\t4.6/5\t✅\t—\tre-blast, higher score\tvia=Hays\n';
  let sb, res1, rowsAfter1, res2, hays;
  before(async () => {
    sb = makeSandbox(HEADER_VIA, { '6-other.tsv': OTHER_AGENCY });
    res1 = await merge(sb);
    rowsAfter1 = dataRows(sb.tracker).filter(l => l.includes('Data Engineer'));
    writeFileSync(join(sb.additions, '7-same.tsv'), SAME_AGENCY);
    res2 = await merge(sb);
    hays = dataRows(sb.tracker).filter(l => l.includes('Hays') && l.includes('Data Engineer'));
  });
  after(() => removeSandbox(sb));

  test('merge: ? row via a different agency added as a NEW row (no cross-channel merge)', () => {
    assert.equal(res1.code, 0, res1.stdout);
    assert.equal(rowsAfter1.length, 2, rowsAfter1.join('\n'));
    assert.ok(rowsAfter1.some(l => l.includes('Randstad')), rowsAfter1.join('\n'));
  });
  test('merge: same-agency re-blast updates the existing ? row (Via preserved)', () => {
    assert.equal(res2.code, 0, res2.stdout);
    assert.equal(hays.length, 1, hays.join(' / '));
    assert.ok(hays[0].includes('4.6/5'), hays[0]);
  });
});

// ── Test 12b: legacy 9-col tracker — via= tag dropped WITHOUT breaking dedup ─
// The tracker has no Via column, so existing rows parse with via=''. The
// addition's via must be cleared before duplicate matching, or the
// cross-channel guard would see 'Hays' ≠ '' and add a second ? row instead of
// updating the same-agency re-blast.
test('merge: legacy 9-col tracker — via= re-blast UPDATES the ? row (no duplicate)', async (t) => {
  const FIRST = '2\t2026-02-02\t?\tData Engineer\tApplied\t4.1/5\t✅\t—\tblind listing\tvia=Hays\n';
  const REBLAST = '3\t2026-02-10\t?\tData Engineer\tApplied\t4.3/5\t✅\t—\tre-blast, higher score\tvia=Hays\n';
  const sb = makeSandbox(HEADER_9, { '2-first.tsv': FIRST });
  t.after(() => removeSandbox(sb));
  const res1 = await merge(sb);
  writeFileSync(join(sb.additions, '3-reblast.tsv'), REBLAST);
  const res2 = await merge(sb);
  const blind = dataRows(sb.tracker).filter(l => l.includes('Data Engineer'));
  assert.equal(res1.code, 0, res1.stdout);
  assert.equal(res2.code, 0, res2.stdout);
  assert.equal(blind.length, 1, blind.join(' / '));
  assert.ok(blind[0].includes('4.3/5'), blind[0]);
  assert.match(res2.stdout, /1 updated/);
});

// ── Test 13: --migrate-via inserts the column, idempotently ─────────────────
// The first run goes through the CLI (the flag is parsed there); the second
// runs in-process, so this also pins the two entry points to one behaviour.
describe('--migrate-via', () => {
  let sb, first, content, second;
  before(async () => {
    sb = makeSandbox(HEADER_9);
    first = await runScript('merge-tracker.mjs', ['--migrate-via'], sb);
    content = readFileSync(sb.tracker, 'utf-8');
    second = await merge(sb, { migrateVia: true });
  });
  after(() => removeSandbox(sb));

  test('--migrate-via: Via column inserted after Company, rows padded with —', () => {
    const headCells = cellsOf(content.split('\n').find(l => l.includes('Company')));
    const seedCells = cellsOf(content.split('\n').find(l => l.includes('Acme')));
    assert.equal(first.code, 0, first.stdout);
    assert.deepEqual([headCells[3], headCells[4], seedCells[4], seedCells[6]], ['Company', 'Via', '—', '4.0/5'], content);
  });
  test('--migrate-via: idempotent (second run changes nothing)', () => {
    assert.equal(second.code, 0, second.stdout);
    assert.equal(readFileSync(sb.tracker, 'utf-8'), content);
  });
});

// ── Test 14: dedup — unknown-employer rows key on Via + role + 90-day window ─
describe('dedup-tracker: unknown-employer keying', () => {
  const BLIND_TRACKER = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-05 | ? | Hays | Data Engineer | 4.2/5 | Evaluated | ✅ | — | fintech, Leeds |
| 2 | 2026-01-20 | ? | Hays | Data Engineer | 4.3/5 | Evaluated | ✅ | — | re-blast of same listing |
| 3 | 2026-01-06 | ? | Randstad | Data Engineer | 4.0/5 | Evaluated | ✅ | — | different channel |
| 4 | 2026-01-10 | ? | Hays | Platform Engineer | 3.9/5 | Evaluated | ✅ | — | old listing |
| 5 | 2026-06-01 | ? | Hays | Platform Engineer | 4.4/5 | Evaluated | ✅ | — | far outside window |
`;
  let sb, res, rows;
  before(async () => {
    sb = makeSandbox(BLIND_TRACKER);
    res = await runScript('dedup-tracker.mjs', [], sb);
    rows = dataRows(sb.tracker);
  });
  after(() => removeSandbox(sb));

  test('dedup: same-agency re-blast within 90d deduped; other agency kept', () => {
    const dataEng = rows.filter(l => l.includes('Data Engineer'));
    assert.equal(res.code, 0, res.stdout);
    assert.equal(dataEng.length, 2, dataEng.join('\n'));
    assert.ok(dataEng.some(l => l.includes('Randstad')), dataEng.join('\n'));
    assert.ok(dataEng.some(l => l.includes('4.3/5')), dataEng.join('\n'));
  });
  test('dedup: same agency+role >90 days apart NOT deduped', () => {
    assert.equal(rows.filter(l => l.includes('Platform Engineer')).length, 2, res.stdout);
  });
});

// ── Test 15: verify-pipeline Via checks ─────────────────────────────────────
describe('verify-pipeline: Via checks', () => {
  const VIA_ISSUES = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-05 | ? | — | Data Engineer | 4.2/5 | Evaluated | ✅ | — | blind row, no agency |
| 2 | 2026-01-06 | Confidential | Hays | ML Engineer | 4.0/5 | Evaluated | ✅ | — | word placeholder |
| 3 | 2026-01-07 | Acme | Hays | Backend Engineer | 4.1/5 | Applied | ✅ | — | via agency |
| 4 | 2026-01-08 | Acme | — | Backend Engineer | 4.1/5 | Applied | ✅ | — | direct too |
`;
  let sb, res;
  before(async () => {
    sb = makeSandbox(VIA_ISSUES);
    res = await runScript('verify-pipeline.mjs', [], sb);
  });
  after(() => removeSandbox(sb));

  test('verify: ? row with no Via channel is an error', () => {
    assert.match(res.stdout, /unknown employer \(\?\) with no Via/);
  });
  test('verify: localized confidentiality word linted toward ?', () => {
    assert.match(res.stdout, /looks like a confidentiality placeholder/);
  });
  test('verify: same company+role via different channels warned', () => {
    assert.match(res.stdout, /Cross-channel duplicate/);
  });
});

// ── Test 16: web alias cache refreshes on change, never caches failure ──────
// loadHeaderAliases caches per file to avoid a disk read+parse per request
// (readApplications runs on every API route / page render), but the cache is
// mtime-keyed: a missing/corrupt file is NEVER cached — recovery is picked up
// without a server restart — and a rewritten file (system update changing the
// alias table) is re-read on the next call.
describe('web reader: alias cache refresh', WEB, () => {
  let dir, missing, recovered, updated, corrupt, fixed;
  before(async () => {
    const { loadHeaderAliases } = await webTable();
    dir = mkdtempSync(join(tmpdir(), 'co-alias-'));
    const aliasFile = join(dir, 'tracker-aliases.json');
    // Force distinct mtimes between rewrites — same-ms writes are otherwise
    // indistinguishable on coarse-timestamp filesystems.
    let tick = Date.now();
    const bump = () => { tick += 2000; const t = new Date(tick); utimesSync(aliasFile, t, t); };

    // (a) missing file → {} and NOT cached: creating the file afterwards is seen.
    missing = loadHeaderAliases(dir);
    writeFileSync(aliasFile, JSON.stringify({ '#': 'num', 'company': 'company' }));
    recovered = loadHeaderAliases(dir);
    // (b) file rewritten → new aliases visible without a process restart.
    writeFileSync(aliasFile, JSON.stringify({ '#': 'num', 'req id': 'num' }));
    bump();
    updated = loadHeaderAliases(dir);
    // (c) corrupt file → {} safely, and NOT cached: fixing it is seen.
    writeFileSync(aliasFile, '{ not json');
    bump();
    corrupt = loadHeaderAliases(dir);
    writeFileSync(aliasFile, JSON.stringify({ '#': 'num' }));
    bump();
    fixed = loadHeaderAliases(dir);
  });
  after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test('web reader: alias file created after a failed load is picked up (no restart)', () => {
    assert.deepEqual(missing, {});
    assert.equal(recovered['#'], 'num');
    assert.equal(recovered.company, 'company');
  });
  test('web reader: rewritten alias file is re-read (mtime-keyed cache)', () => {
    assert.equal(updated['req id'], 'num');
    assert.equal(updated.company, undefined);
  });
  test('web reader: corrupt alias file yields {} and later fix is picked up', () => {
    assert.deepEqual(corrupt, {});
    assert.equal(fixed['#'], 'num');
  });
});

// ── Test 17: pipe rows preserve empty interior cells ──────────────────────
describe('merge: empty interior cells', () => {
  const EMPTY_PDF = '| 42 | 2026-01-01 | Foo | Bar Engineer | 4.0/5 | Evaluated |  | [42](reports/042-foo-2026-01-01.md) | some note |';
  const EMPTY_NOTES = '| 43 | 2026-01-02 | Baz | Platform Engineer | 4.1/5 | Evaluated | ✅ | [43](reports/043-baz-2026-01-02.md) |  | Singapore';
  let sb, res, fooCells, bazCells;
  before(async () => {
    sb = makeSandbox(HEADER_10, { '42-foo.tsv': EMPTY_PDF, '43-baz.tsv': EMPTY_NOTES });
    res = await merge(sb);
    fooCells = cellsOf(dataRows(sb.tracker).find(l => l.includes('Foo')));
    bazCells = cellsOf(dataRows(sb.tracker).find(l => l.includes('Baz')));
  });
  after(() => removeSandbox(sb));

  test('merge: empty PDF cell does not shift Report or Notes', () => {
    assert.equal(res.code, 0, res.stdout);
    assert.deepEqual([fooCells[8], fooCells[9], fooCells[10]], ['', '[42](reports/042-foo-2026-01-01.md)', 'some note']);
  });
  test('merge: empty Notes cell does not shift a later Location', () => {
    assert.equal(res.code, 0, res.stdout);
    assert.deepEqual([bazCells[5], bazCells[10]], ['Singapore', '']);
  });
});

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
describe('web reader: row-shape contract', WEB, () => {
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
  let parseApplications;
  before(async () => { ({ parseApplications } = await webTable()); });

  test('web reader: row missing an interior cell is rejected, like the core', () => {
    const shiftedWeb = parseApplications(SHIFTED, ROOT);
    const shiftedCore = coreRows(SHIFTED);
    assert.equal(shiftedWeb.length, shiftedCore.length,
      `web ${JSON.stringify(shiftedWeb.map(r => r.n))} vs core ${JSON.stringify(shiftedCore.map(r => String(r.num)))}`);
    assert.ok(shiftedWeb.every(r => r.n !== '13'));
  });
  // The complete row next to it must still parse, unshifted.
  test('web reader: the complete Via row next to it stays unshifted', () => {
    const good = parseApplications(SHIFTED, ROOT).find(r => r.n === '12');
    assert.ok(good);
    assert.deepEqual([good.via, good.role, good.score, good.status], ['Hays', 'Engineer', '4.5/5', 'Applied']);
  });
  // (b) no trailing pipe — the last cell is data, not padding.
  test('web reader: row without a trailing pipe keeps its last cell', () => {
    const NO_TRAILING_PIPE = [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 5 | 2026-01-01 | Acme | Engineer | 4.5/5 | Applied | ✅ | — | last note',
    ].join('\n');
    const tailWeb = parseApplications(NO_TRAILING_PIPE, ROOT)[0];
    const tailCore = coreRows(NO_TRAILING_PIPE)[0];
    assert.ok(tailWeb && tailCore);
    assert.equal(tailWeb.notes, 'last note');
    assert.equal(tailCore.notes, 'last note');
  });
});

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

// Merge one addition into a 9-column tracker and return { merge, row, cells }.
// cells: ['', num, date, company, role, score, status, pdf, report, notes, '']
async function mergeOne(tsv, name = '2-globex.tsv') {
  const sb = makeSandbox(HEADER_9, { [name]: tsv });
  try {
    const res = await merge(sb);
    const row = dataRows(sb.tracker).find(l => l.includes('Globex')) || null;
    return { merge: res, row, cells: cellsOf(row) };
  } finally {
    removeSandbox(sb);
  }
}

// The exact case the maintainer named: `—` / `—` in BOTH orders. Both merge
// under a header; neither is decidable without one.
describe('headed additions: — / — in both cells', () => {
  test('headed addition, score-first, — / — in both cells merges', async () => {
    const scoreFirst = await mergeOne(HEADED_SCORE_FIRST_DASHES);
    assert.equal(scoreFirst.merge.code, 0, scoreFirst.merge.stdout);
    assert.ok(scoreFirst.row, scoreFirst.merge.stdout);
  });
  test('headed addition, status-first, — / — in both cells merges', async () => {
    const statusFirst = await mergeOne(HEADED_STATUS_FIRST_DASHES);
    assert.equal(statusFirst.merge.code, 0, statusFirst.merge.stdout);
    assert.ok(statusFirst.row, statusFirst.merge.stdout);
  });
  // Same bytes without the header: still refused, loudly. This is the
  // regression the header form exists to remove — pinned so the headerless
  // path is never "fixed" by guessing an order.
  test('headerless — / — is still refused, not guessed', async () => {
    const headerless = await mergeOne(HEADERLESS_DASHES);
    assert.equal(headerless.row, null, headerless.row);
    assert.match(headerless.merge.stdout, /cannot tell score from status/);
  });
});

// Distinguishable values, both header orders: the header alone decides which
// tracker column each value lands in.
describe('headed additions: header decides the column', () => {
  test('headed score-first: Score and Status land in their own columns', async () => {
    const scoreFirst = await mergeOne(
      'num\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes\n' +
      '2\t2026-02-02\tGlobex\tManager\t4.5/5\tApplied\t❌\t—\tscore-first\n',
    );
    assert.deepEqual([scoreFirst.cells[5], scoreFirst.cells[6]], ['4.5/5', 'Applied'], scoreFirst.merge.stdout);
  });
  test('headed status-first: Score and Status land in their own columns', async () => {
    const statusFirst = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
      '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t—\tstatus-first\n',
    );
    assert.deepEqual([statusFirst.cells[5], statusFirst.cells[6]], ['4.5/5', 'Applied'], statusFirst.merge.stdout);
  });
});

// An emitter whose LABELS and VALUES disagree is the silent swap in a new
// costume. The header is authoritative, so the row is refused rather than
// quietly un-swapped by content — the same answer the headerless path gives.
test('headed addition whose values contradict its labels is refused', async () => {
  const swapped = await mergeOne(
    'num\tdate\tcompany\trole\tscore\tstatus\tpdf\treport\tnotes\n' +
    '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t—\tlabels and values disagree\n',
  );
  assert.equal(swapped.row, null, swapped.row);
  assert.match(swapped.merge.stdout, /labelled "score"/);
});

// Malformed headers report at the header instead of merging a shifted row.
describe('headed additions: malformed headers', () => {
  test('headed addition missing a required column is refused at the header', async () => {
    const missing = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tpdf\treport\tnotes\n' +
      '2\t2026-02-02\tGlobex\tManager\tApplied\t❌\t—\tno score column\n',
    );
    assert.equal(missing.row, null, missing.row);
    assert.match(missing.merge.stdout, /missing required column\(s\): score/);
  });
  test('headed addition labelling one field twice is refused', async () => {
    const duplicated = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tscore\n' +
      '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t—\t4.0/5\n',
    );
    assert.equal(duplicated.row, null, duplicated.row);
    assert.match(duplicated.merge.stdout, /same column twice/);
  });
  test('headed addition with two data rows is refused, not silently truncated', async () => {
    const twoRows = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
      '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t—\tfirst\n' +
      '3\t2026-02-03\tInitech\tArchitect\tApplied\t4.0/5\t❌\t—\tsecond\n',
    );
    assert.equal(twoRows.row, null, twoRows.row);
    assert.match(twoRows.merge.stdout, /one addition per file/);
  });
});

// Optional columns resolve by name too: no positional trailing-field rules, and
// a placeholder in an optional column reads as absent rather than as content.
describe('headed additions: optional columns by name', () => {
  let sb, res, globex, initech;
  before(async () => {
    sb = makeSandbox(
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
    res = await merge(sb);
    const rows = dataRows(sb.tracker);
    // cells: ['', num, date, company, via, role, location, score, status, pdf, report, notes, url, '']
    globex = cellsOf(rows.find(l => l.includes('Globex')));
    initech = cellsOf(rows.find(l => l.includes('Initech')));
  });
  after(() => removeSandbox(sb));

  test('headed addition fills Via / Location / URL by name', () => {
    assert.equal(res.code, 0, res.stdout);
    assert.deepEqual(
      [globex[4], globex[6], globex[7], globex[8], globex[12]],
      ['Hays', 'Singapore', '4.5/5', 'Applied', 'https://example.com/jobs/2'],
      res.stdout,
    );
  });
  // Via fills with '—'; the URL column's documented empty form is a blank cell.
  test('placeholder values in optional headed columns read as absent', () => {
    assert.deepEqual([initech[4], initech[12]], ['—', ''], res.stdout);
  });
});

// A pasted markdown table row may carry a header too — same resolution.
test('pipe-delimited addition with a header resolves by name', async () => {
  const piped = await mergeOne(
    '| # | Date | Company | Role | Status | Score | PDF | Report | Notes |\n' +
    '| 2 | 2026-02-02 | Globex | Manager | Applied | 4.5/5 | ❌ | — | pipe-delimited header |\n',
  );
  assert.deepEqual([piped.cells[5], piped.cells[6]], ['4.5/5', 'Applied'], piped.merge.stdout);
});

// Back-compat: the documented headerless 9-column form is untouched.
test('headerless 9-column addition still merges unchanged', async () => {
  const legacy = await mergeOne(TSV_NO_LOCATION);
  assert.deepEqual([legacy.cells[5], legacy.cells[6]], ['N/A', 'Applied'], legacy.merge.stdout);
});

// ── an empty trailing cell is not a missing cell (#3517 review) ────────────
// A writer whose last value is empty routinely stops at the last tab —
// openrouter-runner emits `…\treport\t\n` for an absent note — and the whole
// file used to be trimmed before parsing, so that tab (which IS the final
// empty cell) was gone and the row read as one cell short of its own header.
// These are the exact bytes the converted writers emit.
describe('headed additions: empty trailing cells', () => {
  test('headed row ending in an empty cell (trailing tab) merges', async () => {
    const trailingTab = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
      '2\t2026-02-02\tGlobex\t(see report)\tEvaluated\t4.5/5\t❌\t[2](reports/2.md)\t\n',
    );
    assert.deepEqual([trailingTab.cells[5], trailingTab.cells[6]], ['4.5/5', 'Evaluated'], trailingTab.merge.stdout);
  });
  // Absent and empty must read the same, which is what the batch and web
  // prompts already promise: "leave the last field empty".
  test('headed row omitting its empty trailing cell merges the same way', async () => {
    const noTrailingTab = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
      '2\t2026-02-02\tGlobex\tManager\tEvaluated\t4.5/5\t❌\t[2](reports/2.md)\n',
    );
    assert.deepEqual([noTrailingTab.cells[5], noTrailingTab.cells[6]], ['4.5/5', 'Evaluated'], noTrailingTab.merge.stdout);
  });
  // Only OPTIONAL cells may be absent. A row short of a required one is still
  // refused, and says which.
  test('headed row missing required cells is refused, naming them', async () => {
    const shortRequired = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
      '2\t2026-02-02\tGlobex\tManager\tEvaluated\t4.0/5\n',
    );
    assert.equal(shortRequired.row, null, shortRequired.row);
    assert.match(shortRequired.merge.stdout, /missing the required cell\(s\): pdf, report/);
  });
  // The width rule is not the shift defense, so prove the shift is still
  // caught: omit an INTERIOR cell (role) and every later value slides one
  // column left, which the score corroboration sees by content. No `url` label
  // here, so the misplaced-URL guard below cannot be what catches it — this
  // pins the score check specifically.
  test('headed row with an omitted interior cell is caught by content, not width', async () => {
    const shifted = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
      '2\t2026-02-02\tGlobex\tEvaluated\t4.0/5\t❌\t[2](reports/2.md)\tnote\n',
    );
    assert.equal(shifted.row, null, shifted.row);
    assert.match(shifted.merge.stdout, /labelled "score"/);
  });
});

// ── what the optional-cell leniency must NOT wave through (#3517 review) ───
// Accepting a short row (absent optional cells read as empty) buys two new
// ambiguities, and both corrupt exactly the mapping the header protects.
describe('headed additions: what optional-cell leniency must not accept', () => {
  // A blank REQUIRED cell is not "none": every required field has a documented
  // value, and the no-data cases have sentinels. Left through, an empty status
  // reaches validateStatus(''), which returns "Evaluated" — a real evaluation
  // state the row never claimed.
  test('headed row with a blank required cell is refused, not defaulted', async () => {
    const blankStatus = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
      '2\t2026-02-02\tGlobex\tManager\t\t4.0/5\t❌\t[2](reports/2.md)\tnote\n',
    );
    assert.equal(blankStatus.row, null, blankStatus.row);
    assert.match(blankStatus.merge.stdout, /required cell\(s\) present but empty: status/);
  });
  // "notes omitted, url written" and "notes written, url omitted" are both one
  // cell short, so position cannot tell them apart. The typed column is the
  // corroboration: a cell that IS a URL under a non-url label, while `url` has
  // no cell, means every optional value sits one column left of its label.
  test('headed row whose optional tail is shifted (URL in notes) is refused', async () => {
    const shiftedTail = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n' +
      '2\t2026-02-02\tGlobex\tManager\tApplied\t4.5/5\t❌\t[2](reports/2.md)\thttps://example.com/jobs/2\n',
    );
    assert.equal(shiftedTail.row, null, shiftedTail.row);
    assert.match(shiftedTail.merge.stdout, /a URL sits under "notes"/);
  });
  // ...and the shapes that are NOT ambiguous still merge. Written placeholder
  // for the omitted note:
  test('headed row with an empty placeholder before a supplied URL merges', async () => {
    const placeheld = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n' +
      '2\t2026-02-02\tGlobex\tManager\tApplied\t4.1/5\t❌\t[2](reports/2.md)\t\thttps://example.com/jobs/2\n',
    );
    assert.deepEqual([placeheld.cells[5], placeheld.cells[6]], ['4.1/5', 'Applied'], placeheld.merge.stdout);
  });
  // Both optional cells simply absent — nothing is shifted, nothing is lost:
  test('headed row omitting every optional cell merges', async () => {
    const bothAbsent = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n' +
      '2\t2026-02-02\tGlobex\tManager\tApplied\t4.2/5\t❌\t[2](reports/2.md)\n',
    );
    assert.deepEqual([bothAbsent.cells[5], bothAbsent.cells[6]], ['4.2/5', 'Applied'], bothAbsent.merge.stdout);
  });
  // A note that MENTIONS a url in prose is a note. The guard is anchored to the
  // whole cell, so only a cell that IS a URL trips it.
  test('a note that merely mentions a URL is not read as a shifted cell', async () => {
    const urlInProse = await mergeOne(
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n' +
      '2\t2026-02-02\tGlobex\tManager\tApplied\t4.3/5\t❌\t[2](reports/2.md)\tsee https://example.com/jobs/2 for the req\n',
    );
    assert.equal(urlInProse.cells[5], '4.3/5', urlInProse.merge.stdout);
    assert.match(urlInProse.row ?? '', /for the req/);
  });
});

// ── the web's run prompt is a TSV writer too (#3517) ───────────────────────
// web/src/lib/run-prompts.mjs dictates the addition row to the agent, so the
// prompt is an emitter of this format even though it emits no bytes itself. A
// header it spells differently than tracker-aliases.json knows would not go
// red anywhere: merge-tracker would read the row as headerless and fall back to
// content sniffing — the exact path that cannot order a `—` / `—` row. Assert
// the prompt's own example lines against the real ingest, not against a copy of
// the labels.
describe('web run prompt: TSV header matches the ingest contract', WEB, () => {
  let tabLines, header;
  before(async () => {
    const { buildPrompt } = await import('../web/src/lib/run-prompts.mjs');
    const prompt = buildPrompt({ kind: 'evaluate', input: 'https://example.com/jobs/2', memory: '', today: '2026-02-02' });
    tabLines = prompt.split('\n').filter(l => l.includes('\t'));
    assert.equal(tabLines.length, 2, 'web run prompt shows a header line and one data line');
    header = tabLines[0].trim().split('\t');
  });

  test('web run prompt: every header label resolves through tracker-aliases.json', () => {
    const { missing, duplicates, unknown } = resolveTsvColumns(header);
    assert.deepEqual({ missing, duplicates, unknown }, { missing: [], duplicates: [], unknown: [] });
  });
  // Fill the prompt's own template with real values, by NAME, and merge it.
  test('web run prompt: the row it dictates merges into the right columns', async () => {
    const VALUES = {
      num: '2', date: '2026-02-02', company: 'Globex', role: 'Manager',
      status: 'Applied', score: '4.5/5', pdf: '❌', report: '—',
      notes: 'row as the web dictates it', url: 'https://example.com/jobs/2',
    };
    const dataWidth = tabLines[1].trim().split('\t').length;
    assert.equal(dataWidth, header.length, `header labels ${header.length} columns but the data row shows ${dataWidth}`);
    const row = header.map(h => VALUES[h.trim().toLowerCase()] ?? '').join('\t');
    const res = await mergeOne(`${header.join('\t')}\n${row}\n`);
    assert.equal(res.merge.code, 0, res.merge.stdout);
    assert.deepEqual([res.cells[5], res.cells[6]], ['4.5/5', 'Applied'], res.merge.stdout);
  });
});

// ═══ tracker.mjs export: the round-trip carries the LAYOUT (#3703) ══════════
// `sync` read the tracker by header NAME and `export` wrote it back by fixed
// POSITION, so a customized layout round-tripped every VALUE correctly and lost
// the COLUMN — silently, and `--out data/applications.md` writes that result
// back over the user's own tracker. Losing the URL column also disables
// merge-tracker's deterministic dedup pass, which is invisible in the file.

// sync → export of `content`, returning the sandbox for further steps.
async function syncThenExport(content) {
  const sb = makeSandbox(content);
  const sync = await runTrackerIn(sb, 'sync');
  const exported = await runTrackerIn(sb, 'export');
  return { sb, sync, exported };
}

// ── a Location + URL layout survives sync → export byte-for-byte ────────────
test('tracker.mjs export: Location/URL layout round-trips byte-for-byte', async (t) => {
  const CUSTOM = `# Applications Tracker

| # | Date | Company | Location | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|----------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | Acme | Berlin | Engineer | 4.2/5 | Applied | ❌ | [1](../reports/1.md) | note one | https://acme.example/jobs/1 |
`;
  const { sb, sync, exported } = await syncThenExport(CUSTOM);
  t.after(() => removeSandbox(sb));
  assert.equal(sync.code, 0, sync.stderr);
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(exported.stdout, CUSTOM);
});

// ── Test 17: an unknown user column keeps its own values, not just its header ─
test('tracker.mjs export: unknown extra column keeps its per-row values', async (t) => {
  const CUSTOM = `# Applications Tracker

| # | Date | Company | Priority | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|----------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | high | Engineer | 4.2/5 | Applied | ✅ | — | seed row |
| 2 | 2026-01-02 | Globex | low | Manager | 3.0/5 | Rejected | ❌ | — | second row |
`;
  const { sb, exported } = await syncThenExport(CUSTOM);
  t.after(() => removeSandbox(sb));
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(exported.stdout, CUSTOM);
});

// ── Test 18: the legacy 9-column layout is unchanged ────────────────────────
test('tracker.mjs export: legacy 9-column layout round-trips unchanged', async (t) => {
  const { sb, exported } = await syncThenExport(HEADER_9);
  t.after(() => removeSandbox(sb));
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(exported.stdout, HEADER_9);
});

// ── Test 19: --out over the tracker preserves the custom columns ────────────
// The adoption path from the issue: export a repaired copy back over
// applications.md. Adopting it used to cost the user Location, Via and URL.
describe('tracker.mjs export --out over the tracker', () => {
  const CUSTOM = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | ? | Hays | Engineer | 4.2/5 | aplicado | ❌ | — | agency row | https://acme.example/jobs/1 |
`;
  let sb, res, after_, cells;
  before(async () => {
    sb = makeSandbox(CUSTOM);
    await runTrackerIn(sb, 'sync');
    res = await runTrackerIn(sb, 'export', '--out', sb.tracker);
    after_ = readFileSync(sb.tracker, 'utf-8');
    // cells: ['', num, date, company, via, role, score, status, pdf, report, notes, url, '']
    cells = cellsOf(after_.split('\n').find(l => l.includes('Hays')));
  });
  after(() => removeSandbox(sb));

  test('tracker.mjs export --out: Via and URL survive adoption over the tracker', () => {
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual([cells[4], cells[11]], ['Hays', 'https://acme.example/jobs/1'], after_);
  });
  // The point of exporting over the tracker is the repair: a non-canonical
  // status is normalized while the custom columns stay put.
  test('tracker.mjs export --out: non-canonical status still repaired', () => {
    assert.equal(cells[7], 'Applied', after_);
  });
});

// ── Test 20: cells the layout cannot hold are named, and block --out ────────
// Option 3 of the issue: whatever the round-trip cannot reproduce must be a
// decision the user makes, not a silent drop under a "backed up to .bak" line.
// The refusal goes through the CLI: it is an exit code, and it is decided while
// export holds the tracker lock.
describe('tracker.mjs export: unplaceable cells', () => {
  const WIDE = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note | with | stray | https://acme.example/1 |
`;
  let sb, stdoutRun, before_, refused, afterRefusal, forced, afterForce;
  before(async () => {
    sb = makeSandbox(WIDE);
    await runTrackerIn(sb, 'sync');
    stdoutRun = await runTrackerIn(sb, 'export');
    before_ = readFileSync(sb.tracker, 'utf-8');
    refused = await runScript('tracker.mjs', ['export', '--out', sb.tracker], sb);
    afterRefusal = readFileSync(sb.tracker, 'utf-8');
    forced = await runTrackerIn(sb, 'export', '--out', sb.tracker, '--force');
    afterForce = readFileSync(sb.tracker, 'utf-8');
  });
  after(() => removeSandbox(sb));

  test('tracker.mjs export: names the columns it cannot reproduce', () => {
    assert.match(stdoutRun.stderr, /cannot be reproduced by export/);
  });
  test('tracker.mjs export --out: refuses to overwrite when columns would be dropped', () => {
    assert.equal(refused.code, 1, refused.stdout);
    assert.equal(afterRefusal, before_);
  });
  test('tracker.mjs export --out --force: writes once the drop is acknowledged', () => {
    assert.equal(forced.code, 0, forced.stderr);
    assert.notEqual(afterForce, before_);
  });
});

// ── Test 21: an index built before extras/md_header existed is rebuilt ──────
// The md hash still matches, so freshness alone would serve an export with no
// layout and no extras — the exact silent drop, from a stale schema. Built with
// the PRE-#3703 schema by hand rather than by mutating a current index: a test
// that assumes the new `extras` column exists cannot fail cleanly against the
// old code, it aborts on "no such column" (PR #3794 review).
describe('tracker.mjs export: pre-#3703 index', () => {
  const CUSTOM = `# Applications Tracker

| # | Date | Company | Location | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|----------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Berlin | Engineer | 4.2/5 | Applied | ❌ | — | seed row |
`;
  let sb, exported;
  before(async () => {
    sb = makeSandbox(CUSTOM);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(sb.db);
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
    exported = await runTrackerIn(sb, 'export');
  });
  after(() => removeSandbox(sb));

  test('tracker.mjs export: a pre-#3703 index is rebuilt, exporting the source header', () => {
    const headerLine = exported.stdout.split('\n').find(l => l.startsWith('| #')) ?? '';
    assert.equal(exported.code, 0, exported.stderr);
    assert.match(headerLine, /\| Location \|/);
  });
  test('tracker.mjs export: the rebuilt stale index round-trips byte-for-byte', () => {
    assert.equal(exported.stdout, CUSTOM);
  });
});

// ── Test 21b: a schema step that throws still closes the handle ─────────────
// runTracker closes every index it was handed, but openDb() can throw before
// handing one over — an `applications` table some other tool left without a
// `status` column fails the CREATE INDEX — and that handle used to stay open.
// A stand-in DatabaseSync, because a leaked handle is only observable on
// Windows (the file cannot be deleted); this pins the close itself.
describe('tracker.mjs openDb: failed schema setup', () => {
  test('openDb closes the database when schema setup throws, then rethrows', async () => {
    const { openDb } = await import('../tracker.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'co-opendb-'));
    try {
      let closed = 0;
      class ThrowingDb {
        exec(sql) { if (/CREATE INDEX/.test(sql)) throw new Error('no such column: status'); }
        close() { closed++; }
      }
      assert.throws(() => openDb(ThrowingDb, join(dir, 'applications.db')), /no such column: status/);
      assert.equal(closed, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // The real shape, end to end: runTracker reports the SQLite error itself
  // rather than a TypeError from a half-initialized handle.
  test('runTracker surfaces the schema error from a foreign applications table', async (t) => {
    const sb = makeSandbox(HEADER_9);
    t.after(() => removeSandbox(sb));
    const { DatabaseSync } = await import('node:sqlite');
    const foreign = new DatabaseSync(sb.db);
    foreign.exec('CREATE TABLE applications (id INTEGER PRIMARY KEY, company TEXT)');
    foreign.close();
    await assert.rejects(runTrackerIn(sb, 'sync'), /status/);
  });
});

// ── Test 22: content around and inside the table (PR #3794 review) ──────────
// `export` emitted a fixed skeleton, so `--out` over the tracker deleted a
// localized title, a legend, an archive section and a trailing note — and the
// drop gate never saw it, because it counted only cells past the header width.
test('tracker.mjs export: title, preamble and trailing note survive the round-trip', async (t) => {
  const RICH = `# Seguimiento de candidaturas

Legend: ✅ sent · ❌ not sent.

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note | https://a.example/1 |

Last reviewed 2026-09-01.
`;
  const { sb, exported } = await syncThenExport(RICH);
  t.after(() => removeSandbox(sb));
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(exported.stdout, RICH);
});

// ── Test 23: content BETWEEN table rows is named and gated ─────────────────
// A second table's rows are indexed against the FIRST table's columns, so
// replaying its heading and header would frame a shifted row as intact. It is
// reported as a loss instead, and `--out` refuses.
describe('tracker.mjs export: a second table', () => {
  const ARCHIVED = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note | https://a.example/1 |

## Archive (2025)

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 9 | 2025-06-01 | Oldco | Analyst | 3.0/5 | Rejected | ❌ | — | archived |
`;
  let sb, exported, before_, refused, afterRefusal, forced, afterForce;
  before(async () => {
    ({ sb, exported } = await syncThenExport(ARCHIVED));
    before_ = readFileSync(sb.tracker, 'utf-8');
    refused = await runTrackerIn(sb, 'export', '--out', sb.tracker);
    afterRefusal = readFileSync(sb.tracker, 'utf-8');
    forced = await runTrackerIn(sb, 'export', '--out', sb.tracker, '--force');
    afterForce = readFileSync(sb.tracker, 'utf-8');
  });
  after(() => removeSandbox(sb));

  test('tracker.mjs export: a section between table rows is named as a loss', () => {
    assert.match(exported.stderr, /## Archive \(2025\)/);
    assert.match(exported.stderr, /cannot be reproduced by export/);
  });
  test('tracker.mjs export --out: refuses to flatten a tracker with an archive section', () => {
    assert.equal(refused.code, 1, refused.stderr);
    assert.equal(afterRefusal, before_);
  });
  // The archived row was indexed against the FIRST table's header, so emitting
  // it under the active table invents an empty URL cell for it. Naming it as a
  // loss is the only honest option; forcing must not move it (PR #3794 review).
  test('tracker.mjs export: the later table\'s row is named as a loss', () => {
    assert.match(exported.stderr, /row #9 \(Oldco/);
  });
  test('tracker.mjs export --force: the archived row is NOT re-emitted under the active table', () => {
    assert.equal(forced.code, 0, forced.stderr);
    assert.doesNotMatch(afterForce, /Oldco/);
  });
});

// ── Test 27: prologue/epilogue whitespace is replayed, not re-rendered ──────
// The lines around the table are prose the export COPIES. Trimming them edited
// a user's indentation and trailing spaces with nothing in the loss list able
// to see it (PR #3794 review).
describe('tracker.mjs export: prose whitespace', () => {
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
  let sb, exported, written;
  before(async () => {
    ({ sb, exported } = await syncThenExport(INDENTED_PROSE));
    written = await runTrackerIn(sb, 'export', '--out', sb.tracker);
  });
  after(() => removeSandbox(sb));

  test('tracker.mjs export: prologue/epilogue whitespace survives verbatim', () => {
    assert.equal(exported.code, 0, exported.stderr);
    assert.equal(exported.stdout, INDENTED_PROSE);
  });
  // Nothing was lost, so the gate must not fire — a false refusal is its own bug.
  test('tracker.mjs export --out: no false refusal when nothing is lost', () => {
    assert.equal(written.code, 0, written.stderr);
  });
});

// ── Test 28: a cell the render had to rewrite is a reported loss ────────────
// A stray pipe is folded into Notes at sync time and comes back as '│' — the
// VALUE changed, so a silent `--out` edits the tracker (PR #3794 review).
describe('tracker.mjs export: a sanitized cell', () => {
  const STRAY = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note | extra |
`;
  let sb, exported, before_, refused, afterRefusal;
  before(async () => {
    ({ sb, exported } = await syncThenExport(STRAY));
    before_ = readFileSync(sb.tracker, 'utf-8');
    refused = await runTrackerIn(sb, 'export', '--out', sb.tracker);
    afterRefusal = readFileSync(sb.tracker, 'utf-8');
  });
  after(() => removeSandbox(sb));

  test('tracker.mjs export: a sanitized cell is named with its before/after', () => {
    assert.match(exported.stderr, /note \| extra.*note │ extra/);
  });
  test('tracker.mjs export --out: refuses when a cell value would change', () => {
    assert.equal(refused.code, 1, refused.stderr);
    assert.equal(afterRefusal, before_);
  });
});

// ── Test 24: an indented table reads and writes the same layout ────────────
// resolveColumns needs `startsWith('|')` and detectLayout trimmed on its own,
// so an indented header gave the LEGACY map on read and the real map on write:
// Berlin moved into Role and Applied into PDF (PR #3794 review).
test('tracker.mjs export: an indented table keeps every cell in its own column', async (t) => {
  const INDENTED = [
    '# Applications Tracker',
    '',
    '  | # | Date | Company | Location | Role | Score | Status | PDF | Report | Notes |',
    '  |---|------|---------|----------|------|-------|--------|-----|--------|-------|',
    '  | 1 | 2026-01-01 | Acme | Berlin | Engineer | 4.2/5 | Applied | ❌ | — | note |',
    '',
  ].join('\n');
  const { sb, exported } = await syncThenExport(INDENTED);
  t.after(() => removeSandbox(sb));
  // cells: ['', num, date, company, location, role, score, status, pdf, report, notes, '']
  const cells = cellsOf(exported.stdout.split('\n').find(l => l.includes('Acme')));
  assert.deepEqual([cells[4], cells[5], cells[7], cells[10]], ['Berlin', 'Engineer', 'Applied', 'note'], exported.stdout);
});

// ── Test 25: a header career-ops cannot name is still preserved ─────────────
// isHeaderRow only fires when the alias table resolves the FULL schema, so a
// Spanish header (puntuación/estado are unmapped) recorded no layout at all and
// exported as the English default, exit 0 (PR #3794 review).
test('tracker.mjs export: an unresolvable localized header round-trips verbatim', async (t) => {
  const SPANISH = `# Seguimiento

| # | Fecha | Empresa | Puesto | Puntuación | Estado | PDF | Informe | Notas |
|---|-------|---------|--------|------------|--------|-----|---------|-------|
| 1 | 2026-01-01 | Acme | Ingeniero | 4.2/5 | Applied | ❌ | — | nota |
`;
  const { sb, exported } = await syncThenExport(SPANISH);
  t.after(() => removeSandbox(sb));
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(exported.stdout, SPANISH);
});

// ── Test 26: CRLF line endings survive ─────────────────────────────────────
test('tracker.mjs export: CRLF line endings are not rewritten to LF', async (t) => {
  const CRLF = [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-01-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note |',
    '',
  ].join('\r\n');
  const { sb, exported } = await syncThenExport(CRLF);
  t.after(() => removeSandbox(sb));
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(exported.stdout, CRLF);
});
