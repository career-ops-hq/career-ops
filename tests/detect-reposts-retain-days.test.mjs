/**
 * detect-reposts --retain-days prunes rows older than the retention window.
 *
 * scan-history.tsv is append-only by contract, so nothing ever removed a row:
 * an installation that scans for a couple of years re-parses its whole history
 * on every run. The pass is opt-in, previewable, and conservative — statuses
 * that describe the URL rather than a sighting are kept regardless of age, and
 * a row whose date cannot be read is never dropped.
 *
 * Two layers are tested: planScanHistoryPrune() as a pure function (the whole
 * policy, no filesystem), then the CLI in a sandboxed data root through the
 * lock, the backup and the real write.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODE, ROOT } from './helpers.mjs';
import { planScanHistoryPrune, rebuildScanHistoryBytes, PRUNE_PROTECTED_SCAN_HISTORY_STATUSES } from '../detect-reposts.mjs';
import { localToday } from '../lib/local-today.mjs';

console.log('\ndetect-reposts --retain-days — scan-history retention');

const COLS = ['url', 'first_seen', 'portal', 'title', 'company', 'status', 'location'];
const header = COLS.join('\t');

function row(url, firstSeen, status = 'added') {
  return [url, firstSeen, 'greenhouse', 'Senior Engineer', 'Acme', status, 'Remote'].join('\t');
}

// Every assertion is a node:test case rather than a bump of the shared counter.
// A pass/fail-style suite is imported into test-all and absorbed into its
// counters, which works there — but the same file under a direct `node --test`
// run reports one synthetic passing test and exits 0 no matter what failed.
// These checks run the CLI, so they are the ones a person runs directly when
// something looks wrong. node:test also reaches test-all properly:
// test-all.mjs runs a suite importing `node:test` under `node --test` and folds
// the child's exit code into its own counters.
function check(label, condition, detail = '') {
  test(label, () => assert.ok(condition, detail));
}

// ── Pure policy ────────────────────────────────────────────────────────────
const today = new Date('2026-06-01T00:00:00Z');
const at = (daysAgo) => {
  const d = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

const content = [
  header,
  row('https://a.example/1', at(400)),                      // older than 90 → pruned
  row('https://a.example/2', at(89)),                        // inside the window
  row('https://a.example/3', at(400), 'skipped_expired'),     // a sighting too → pruned
  row('https://a.example/4', at(400), 'skipped_title'),       // observational → pruned
  row('https://a.example/5', at(400), 'skipped_invalid_url'), // protected
  row('https://a.example/6', at(400), 'skipped_blocked_host'),// protected
  row('https://a.example/7', at(400), 'cooldown:2026-12-01'), // names its own expiry
  row('https://a.example/8', 'not-a-date'),                   // unreadable → kept
  '',
].join('\n');

const plan = planScanHistoryPrune(content, 90, { today });
// Both sides of these comparisons are a whole URL cell or a whole row, never a
// URL substring. `includes('https://host/1')` would also match
// 'https://host/10', and the substring shape is what CodeQL reports as
// js/incomplete-url-substring-sanitization.
const prunedUrls = new Set(plan.pruned.map(entry => entry.url));
const keptRows = new Set(plan.lines);
check('a sighting older than the window is pruned',
  prunedUrls.has('https://a.example/1'));
check('a sighting inside the window is kept',
  !prunedUrls.has('https://a.example/2'));
check('a dead posting (skipped_expired) is pruned once it is old enough',
  prunedUrls.has('https://a.example/3'));
check('an observational skip is pruned too — it never pinned the URL',
  prunedUrls.has('https://a.example/4'));
check('skipped_invalid_url is never pruned',
  keptRows.has(row('https://a.example/5', at(400), 'skipped_invalid_url')));
check('skipped_blocked_host is never pruned',
  keptRows.has(row('https://a.example/6', at(400), 'skipped_blocked_host')));
check('a cooldown row keeps its own expiry rather than being aged out',
  keptRows.has(row('https://a.example/7', at(400), 'cooldown:2026-12-01')));
check('a row with an unreadable date is kept rather than guessed at',
  keptRows.has(row('https://a.example/8', 'not-a-date')));
check('the header survives the pass', plan.lines[0] === header);
check('counts add up',
  plan.totalRows === 8 && plan.pruned.length === 3 && plan.keptRows === 5,
  `total=${plan.totalRows} pruned=${plan.pruned.length} kept=${plan.keptRows}`);
check('keepIndexes selects the same lines the text view reports',
  plan.lines.length === plan.keepIndexes.length
  && plan.lines.every((line, i) => content.split('\n')[plan.keepIndexes[i]] === line));
check('the protected-status list is the documented one',
  PRUNE_PROTECTED_SCAN_HISTORY_STATUSES.has('skipped_invalid_url')
  && PRUNE_PROTECTED_SCAN_HISTORY_STATUSES.has('skipped_blocked_host')
  && PRUNE_PROTECTED_SCAN_HISTORY_STATUSES.size === 2);

// Boundary: "older than N days" keeps the row exactly N days old.
const boundary = planScanHistoryPrune([header, row('https://b.example/1', at(90))].join('\n'), 90, { today });
check('a row exactly N days old is still inside the window',
  boundary.pruned.length === 0 && boundary.lines.length === 2);
const justOver = planScanHistoryPrune([header, row('https://b.example/1', at(91))].join('\n'), 90, { today });
check('a row N+1 days old is pruned', justOver.pruned.length === 1);

// A headerless file (older installs, seeds): its first line is DATA, and
// treating it as a header would silently exempt one row from the pass.
const headerless = planScanHistoryPrune(row('https://c.example/1', at(400)), 90, { today });
check('a headerless first row is evaluated, not skipped as a header',
  headerless.totalRows === 1 && headerless.pruned.length === 1);

// Untouched lines keep their bytes, including a CRLF ending.
const crlf = planScanHistoryPrune(
  [`${header}\r`, `${row('https://d.example/1', at(400))}\r`, `${row('https://d.example/2', at(5))}\r`].join('\n'),
  90,
  { today },
);
check('surviving lines keep their CR',
  crlf.lines.length === 2 && crlf.lines[0].endsWith('\r') && crlf.lines[1].endsWith('\r'));

// Columns beyond the ones the pass reads must survive the rewrite untouched.
const wide = [row('https://e.example/1', at(5)), ...Array(9).fill('extra')].join('\t') + '\t2026-07-01';
const widePlan = planScanHistoryPrune([header, wide].join('\n'), 90, { today });
check('a wide row is kept byte-for-byte, trailing columns included',
  widePlan.lines[1] === wide);

// ── Byte fidelity ──────────────────────────────────────────────────────────
// The decision decodes a line so it can read the date. A line the pass keeps
// must not be re-encoded from that text, because the decode is lossy where the
// file is not valid UTF-8 and would write U+FFFD over the original bytes.
const asBytes = (text) => Buffer.from(text, 'utf-8');
const keepAll = planScanHistoryPrune(content, 10000, { today });
check('a pass that prunes nothing reproduces the file byte for byte',
  rebuildScanHistoryBytes(asBytes(content), keepAll.keepIndexes).equals(asBytes(content)));

const invalidByte = Buffer.from([0xff, 0xfe]);
const poisoned = Buffer.concat([
  asBytes(`${header}\n`),
  asBytes(row('https://f.example/live', at(5))),
  invalidByte,
  Buffer.from('\n'),
  asBytes(row('https://f.example/stale', at(400))),
  Buffer.from('\n'),
]);
const poisonedPlan = planScanHistoryPrune(poisoned.toString('utf-8'), 90, { today });
const expectedPoisoned = Buffer.concat([
  asBytes(`${header}\n`),
  asBytes(row('https://f.example/live', at(5))),
  invalidByte,
  Buffer.from('\n'),
]);
const rebuiltPoisoned = rebuildScanHistoryBytes(poisoned, poisonedPlan.keepIndexes);
check('a retained line keeps bytes that are not valid UTF-8',
  poisonedPlan.pruned.length === 1 && rebuiltPoisoned.equals(expectedPoisoned),
  `pruned=${poisonedPlan.pruned.length} rebuilt=${rebuiltPoisoned.toString('hex').slice(-40)}`);
check('the lossy decode never reaches the file (no U+FFFD replacement bytes)',
  !rebuiltPoisoned.includes(Buffer.from([0xef, 0xbf, 0xbd])));
check('an out-of-range keep index is refused', (() => {
  try {
    rebuildScanHistoryBytes(asBytes('a\n'), [5]);
    return false;
  } catch {
    return true;
  }
})());

// ── CLI in a sandboxed data root ───────────────────────────────────────────
const sandbox = mkdtempSync(join(tmpdir(), 'co-retain-'));
const historyPath = join(sandbox, 'data', 'scan-history.tsv');
mkdirSync(join(sandbox, 'data'), { recursive: true });
const cliRows = [
  header,
  row('https://old.example/1', '2020-01-01'),
  row('https://old.example/2', '2020-01-02', 'skipped_expired'),
  row('https://new.example/1', localToday()),
  row('https://keep.example/1', '2020-01-03', 'skipped_invalid_url'),
];
writeFileSync(historyPath, `${cliRows.join('\n')}\n`, 'utf-8');
const originalBytes = readFileSync(historyPath);
const original = originalBytes.toString('utf-8');

function runCli(args, extraEnv = {}) {
  const result = spawnSync(NODE, [join(ROOT, 'detect-reposts.mjs'), ...args], {
    cwd: sandbox,
    encoding: 'utf-8',
    timeout: 30_000,
    // Pin every lane variable. A developer whose shell exports one would
    // otherwise point the run at their own files, and a prune writes there.
    env: { ...process.env, CAREER_OPS_ROOT: sandbox, CAREER_OPS_DATA_DIR: '', CAREER_OPS_SCAN_HISTORY: '', ...extraEnv },
  });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

try {
  const dry = runCli(['--retain-days', '30', '--dry-run']);
  check('--dry-run exits 0 and reports the counts on stderr',
    dry.status === 0 && /scan-history prune: 4 row\(s\) read, 2 older than 30 day\(s\), 2 kept/.test(dry.output)
    && /dry-run — no changes written/.test(dry.output),
    `status=${dry.status}\n${dry.output.trim()}`);
  check('--dry-run leaves the file untouched', readFileSync(historyPath, 'utf-8') === original);
  let json = null;
  try { json = JSON.parse(dry.stdout); } catch { /* asserted below */ }
  check('stdout stays valid JSON while the prune reports on stderr',
    json && json.metadata.totalRows === 4 && Array.isArray(json.clusters));

  const real = runCli(['--retain-days', '30']);
  const after = readFileSync(historyPath, 'utf-8');
  const rowsAfter = new Set(after.split('\n'));
  check('--retain-days writes the pruned file', real.status === 0 && after.split('\n').filter(Boolean).length === 3,
    `status=${real.status}\n${after}`);
  check('the pruned rows are the old sightings',
    rowsAfter.has(row('https://new.example/1', localToday()))
    && !rowsAfter.has(row('https://old.example/1', '2020-01-01'))
    && !rowsAfter.has(row('https://old.example/2', '2020-01-02', 'skipped_expired')));
  check('the protected row survives a real run',
    rowsAfter.has(row('https://keep.example/1', '2020-01-03', 'skipped_invalid_url')));
  check('a .bak holds the pre-prune bytes',
    existsSync(`${historyPath}.bak`) && readFileSync(`${historyPath}.bak`).equals(originalBytes));

  const zero = runCli(['--retain-days', '0']);
  check('--retain-days 0 is rejected, not silently defaulted',
    zero.status === 1 && /Invalid --retain-days "0"/.test(zero.output));
  const text = runCli(['--retain-days', 'ninety']);
  check('a non-numeric --retain-days is rejected',
    text.status === 1 && /Invalid --retain-days "ninety"/.test(text.output));
  const lonely = runCli(['--dry-run']);
  check('--dry-run without --retain-days is refused',
    lonely.status === 1 && /--dry-run needs --retain-days/.test(lonely.output));
  const noOperand = runCli(['--retain-days']);
  check('--retain-days with no operand is refused before the read',
    noOperand.status === 1 && /--retain-days/.test(noOperand.output));

  // A lane's history is selected by CAREER_OPS_SCAN_HISTORY (docs/SCRIPTS.md),
  // and scan.mjs writes that file. Retention has to follow the same selection:
  // ignoring it would delete rows from the default lane and leave the selected
  // lane untouched, which is the opposite of what the caller asked for.
  const lanePath = join(sandbox, 'data', 'scan-history.bridge.tsv');
  writeFileSync(lanePath, `${cliRows.join('\n')}\n`, 'utf-8');
  const defaultBeforeLane = readFileSync(historyPath);
  const laneRun = runCli(['--retain-days', '30'], { CAREER_OPS_SCAN_HISTORY: 'data/scan-history.bridge.tsv' });
  const laneAfter = readFileSync(lanePath, 'utf-8');
  let laneJson = null;
  try { laneJson = JSON.parse(laneRun.stdout); } catch { /* asserted below */ }
  check('--retain-days prunes the lane history the scanner selects',
    laneRun.status === 0 && laneAfter.split('\n').filter(Boolean).length === 3
    && /scan-history prune: 4 row\(s\) read, 2 older than 30 day\(s\), 2 kept/.test(laneRun.output),
    `status=${laneRun.status}\n${laneRun.output.trim()}`);
  check('the default lane history is untouched when another lane is selected',
    readFileSync(historyPath).equals(defaultBeforeLane));
  check('detection reads the same lane retention wrote',
    laneJson !== null && laneJson.metadata.totalRows === 2,
    JSON.stringify(laneJson?.metadata ?? null));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}