/**
 * tests/discover-new-companies.test.mjs — suite for discover-new-companies.mjs
 *
 * discover-new-companies.mjs is a CLI script (no exported functions), so it is
 * driven end-to-end via execFileSync against scratch fixtures — no live
 * network, no LLM. Both inputs are redirected with env overrides
 * (CAREER_OPS_SCAN_HISTORY, CAREER_OPS_PORTALS) so the real data/ directory is
 * never read or written.
 *
 * Covered:
 * - --help exits 0; missing history/value → nonzero exit; bad --since → nonzero exit
 * - default user-layer inputs resolve through CAREER_OPS_ROOT, independent of cwd
 * - --json subtracts already-tracked companies (canonical-name + alias match,
 *   disabled entries count as tracked)
 * - --min-rows, --added-only, --since window (undated rows pass)
 * - ranking: 'added'-producing companies rank first
 * - default YAML output is the `companies: [{name}]` shape discover-ats consumes
 *
 * Run: node test-all.mjs --only discover-new-companies
 *      A discovered suite reports through the shared counters; running the file
 *      directly returns 0 even when assertions fail.
 *
 * Issue #4181 — github.com/career-ops-hq/career-ops
 */

import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import * as yaml from 'js-yaml';
import { pass, fail } from './helpers.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(label);
  else fail(`${label} — expected ${e}, got ${a}`);
}

console.log('\ndiscover-new-companies.mjs — scan-history → discover-ats bridge');

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'discover-new-companies.mjs');
const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n';
const today = new Date().toISOString().slice(0, 10);
const old = '2000-01-01';

/** Build a scan-history.tsv row in the canonical column order. */
function row({ url = 'https://boards.greenhouse.io/acme/jobs/1', seen = today, portal = 'greenhouse', title = 'Engineer', company, status = 'skipped' }) {
  return [url, seen, portal, title, company, status, 'Remote'].join('\t');
}

/** Run the script against scratch fixtures; return parsed stdout. */
function run(historyRows, portalsObj, args, { parse = 'json' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'discover-new-'));
  try {
    const hist = join(dir, 'scan-history.tsv');
    const portals = join(dir, 'portals.yml');
    writeFileSync(hist, HEADER + historyRows.join('\n') + '\n');
    writeFileSync(portals, yaml.dump(portalsObj || {}));
    const out = execFileSync('node', [scriptPath, ...args], {
      encoding: 'utf-8', timeout: 20000, cwd: dirname(scriptPath),
      env: { ...process.env, CAREER_OPS_SCAN_HISTORY: hist, CAREER_OPS_PORTALS: portals },
    });
    return parse === 'json' ? JSON.parse(out) : out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 1. CLI guards ───────────────────────────────────────────────────────────
console.log('\n--- 1. CLI guards ---');

const help = execFileSync('node', [scriptPath, '--help'], { encoding: 'utf-8', timeout: 15000 });
ok('--help prints usage and exits 0', /Usage: node discover-new-companies\.mjs/.test(help));

let missingExit = 0;
try {
  execFileSync('node', [scriptPath, '--json'], {
    encoding: 'utf-8', timeout: 15000, cwd: dirname(scriptPath),
    env: { ...process.env, CAREER_OPS_SCAN_HISTORY: join(tmpdir(), 'does-not-exist-xyz.tsv') },
  });
} catch (e) { missingExit = e.status; }
ok('missing history file → nonzero exit', missingExit !== 0);

let badSinceExit = 0;
try {
  run([row({ company: 'Acme' })], {}, ['--since', '-5', '--json']);
} catch (e) { badSinceExit = e.status; }
ok('negative --since → nonzero exit', badSinceExit !== 0);

for (const args of [['--since'], ['--since', '--json']]) {
  let missingValueExit = 0;
  try {
    run([row({ company: 'Acme' })], {}, args);
  } catch (e) { missingValueExit = e.status; }
  ok(`${args.join(' ')} rejects a missing value`, missingValueExit !== 0);
}

for (const args of [
  ['--since', '30', '--since'],
  ['--since', '30', '--since', '--json'],
  ['--since', '30', '--since', '7', '--json'],
]) {
  let duplicateExit = 0;
  try {
    run([row({ company: 'Acme' })], {}, args);
  } catch (e) { duplicateExit = e.status; }
  ok(`${args.join(' ')} rejects a duplicate value option`, duplicateExit !== 0);
}

{
  const dataRoot = mkdtempSync(join(tmpdir(), 'discover-new-root-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'discover-new-cwd-'));
  try {
    mkdirSync(join(dataRoot, 'data'));
    mkdirSync(join(decoyCwd, 'data'));
    writeFileSync(join(dataRoot, 'data', 'scan-history.tsv'), HEADER
      + [row({ company: 'DataRootCo' }), row({ company: 'DataRootCo' })].join('\n') + '\n');
    writeFileSync(join(dataRoot, 'portals.yml'), '{}\n');
    writeFileSync(join(decoyCwd, 'data', 'scan-history.tsv'), HEADER
      + [row({ company: 'DecoyCo' }), row({ company: 'DecoyCo' })].join('\n') + '\n');
    writeFileSync(join(decoyCwd, 'portals.yml'), '{}\n');

    const out = execFileSync('node', [scriptPath, '--json'], {
      encoding: 'utf-8', timeout: 15000, cwd: decoyCwd,
      env: {
        ...process.env,
        CAREER_OPS_ROOT: dataRoot,
        CAREER_OPS_DATA_DIR: '',
        CAREER_OPS_SCAN_HISTORY: '',
        CAREER_OPS_PORTALS: '',
      },
    });
    eq('default inputs follow CAREER_OPS_ROOT instead of cwd',
      JSON.parse(out).companies.map((company) => company.name), ['DataRootCo']);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(decoyCwd, { recursive: true, force: true });
  }
}

{
  const dataRoot = mkdtempSync(join(tmpdir(), 'discover-new-empty-root-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'discover-new-populated-cwd-'));
  let missingDataExit = 0;
  try {
    mkdirSync(join(decoyCwd, 'data'));
    writeFileSync(join(decoyCwd, 'data', 'scan-history.tsv'), HEADER
      + [row({ company: 'DecoyCo' }), row({ company: 'DecoyCo' })].join('\n') + '\n');
    execFileSync('node', [scriptPath, '--json'], {
      encoding: 'utf-8', timeout: 15000, cwd: decoyCwd,
      env: {
        ...process.env,
        CAREER_OPS_ROOT: dataRoot,
        CAREER_OPS_DATA_DIR: '',
        CAREER_OPS_SCAN_HISTORY: '',
        CAREER_OPS_PORTALS: '',
      },
    });
  } catch (e) {
    missingDataExit = e.status;
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(decoyCwd, { recursive: true, force: true });
  }
  ok('missing data directory fails cleanly instead of reading cwd', missingDataExit !== 0);
}

// ── 2. Subtract already-tracked ───────────────────────────────────────────────
console.log('\n--- 2. Subtract already-tracked companies ---');

{
  const history = [
    row({ company: 'Acme', status: 'added' }),
    row({ company: 'Acme', status: 'skipped' }),
    row({ company: 'Globex' }),
    row({ company: 'Globex' }),
    row({ company: 'Initech' }),
    row({ company: 'Initech' }),
  ];
  // Initech is already tracked; Acme + Globex are new.
  const res = run(history, { tracked_companies: [{ name: 'Initech' }] }, ['--min-rows', '1', '--json']);
  const names = res.companies.map((c) => c.name).sort();
  eq('emits only untracked companies', names, ['Acme', 'Globex']);
  ok('tracked company is excluded', !names.includes('Initech'));
}

{
  // Alias drift: history logs "Pagar.me (Stone)" but portals tracks "Stone"
  // under company_aliases — the canonicalizer must fold them together.
  const history = [
    row({ company: 'Pagar.me (Stone)' }),
    row({ company: 'Pagar.me (Stone)' }),
    row({ company: 'Nubank' }),
    row({ company: 'Nubank' }),
  ];
  const portals = {
    tracked_companies: [{ name: 'Stone' }],
    company_aliases: { Stone: ['Pagar.me (Stone)', 'Pagar.me'] },
  };
  const res = run(history, portals, ['--min-rows', '1', '--json']);
  const names = res.companies.map((c) => c.name);
  ok('alias-tracked company folded out', !names.some((n) => /Stone/.test(n)));
  ok('unrelated new company still surfaces', names.includes('Nubank'));
}

{
  // A disabled tracked entry still counts as tracked — the user turned it off
  // on purpose, and re-proposing it every run would be noise.
  const history = [row({ company: 'Hooli' }), row({ company: 'Hooli' })];
  const res = run(history, { tracked_companies: [{ name: 'Hooli', enabled: false }] }, ['--min-rows', '1', '--json']);
  eq('disabled tracked entry counts as tracked', res.companies.length, 0);
}

// ── 3. Filters ────────────────────────────────────────────────────────────────
console.log('\n--- 3. Filters ---');

{
  const history = [
    row({ company: 'Once' }),
    row({ company: 'Twice' }),
    row({ company: 'Twice' }),
  ];
  const res = run(history, {}, ['--min-rows', '2', '--json']);
  const names = res.companies.map((c) => c.name);
  ok('--min-rows drops single-row companies', names.includes('Twice') && !names.includes('Once'));
}

{
  const history = [
    row({ company: 'FilteredOnly', status: 'skipped' }),
    row({ company: 'FilteredOnly', status: 'skipped' }),
    row({ company: 'RealHit', status: 'added' }),
    row({ company: 'RealHit', status: 'skipped' }),
  ];
  const res = run(history, {}, ['--min-rows', '1', '--added-only', '--json']);
  const names = res.companies.map((c) => c.name);
  ok('--added-only keeps companies that produced an added row', names.includes('RealHit'));
  ok('--added-only drops never-added companies', !names.includes('FilteredOnly'));
}

{
  // --since window: an old-dated company falls out; undated rows pass.
  const history = [
    row({ company: 'Ancient', seen: old }),
    row({ company: 'Ancient', seen: old }),
    row({ company: 'Fresh', seen: today }),
    row({ company: 'Fresh', seen: today }),
    row({ company: 'Undated', seen: '' }),
    row({ company: 'Undated', seen: '' }),
  ];
  const res = run(history, {}, ['--since', '30', '--min-rows', '1', '--json']);
  const names = res.companies.map((c) => c.name).sort();
  ok('--since excludes old-dated companies', !names.includes('Ancient'));
  ok('--since keeps recent companies', names.includes('Fresh'));
  ok('undated rows pass the window', names.includes('Undated'));
}

// ── 4. Ranking ─────────────────────────────────────────────────────────────────
console.log('\n--- 4. Ranking ---');

{
  const history = [
    row({ company: 'JustFiltered', status: 'skipped' }),
    row({ company: 'JustFiltered', status: 'skipped' }),
    row({ company: 'JustFiltered', status: 'skipped' }),
    row({ company: 'Producer', status: 'added' }),
    row({ company: 'Producer', status: 'skipped' }),
  ];
  const res = run(history, {}, ['--min-rows', '1', '--json']);
  eq('company that produced pipeline rows ranks first', res.companies[0].name, 'Producer');
}

// ── 5. Output shape ─────────────────────────────────────────────────────────────
console.log('\n--- 5. Output shape ---');

{
  const history = [row({ company: 'Acme' }), row({ company: 'Acme' })];
  const text = run(history, {}, ['--min-rows', '1'], { parse: 'text' });
  const doc = yaml.load(text);
  ok('default YAML is the companies:[{name}] shape discover-ats consumes',
    Array.isArray(doc.companies) && doc.companies[0] && doc.companies[0].name === 'Acme');
}

// ── 6. Headerless legacy history ──────────────────────────────────────────────
// Legacy scan-history.tsv files predate the header row and are never rewritten
// (appendToScanHistory in scan.mjs). An unconditional skip of line 0 would drop
// the first company; the header must be detected, not assumed.
console.log('\n--- 6. Headerless legacy history ---');

{
  const dir = mkdtempSync(join(tmpdir(), 'discover-new-headerless-'));
  try {
    const hist = join(dir, 'scan-history.tsv');
    const portals = join(dir, 'portals.yml');
    // No HEADER line: line 0 is a real company row that appears only once, so an
    // unconditional skip of line 0 would drop FirstRowCo entirely.
    writeFileSync(hist, [
      row({ company: 'FirstRowCo' }),
      row({ company: 'SecondCo' }),
      row({ company: 'SecondCo' }),
    ].join('\n') + '\n');
    writeFileSync(portals, '{}\n');
    const out = execFileSync('node', [scriptPath, '--min-rows', '1', '--json'], {
      encoding: 'utf-8', timeout: 20000, cwd: dirname(scriptPath),
      env: { ...process.env, CAREER_OPS_SCAN_HISTORY: hist, CAREER_OPS_PORTALS: portals },
    });
    const names = JSON.parse(out).companies.map((c) => c.name).sort();
    eq('headerless file keeps its first company row', names, ['FirstRowCo', 'SecondCo']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
