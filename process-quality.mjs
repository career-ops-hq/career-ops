#!/usr/bin/env node
/**
 * process-quality.mjs — Recruiting-Process Friction Aggregator for career-ops
 *
 * Parses data/active-interviews.md, extracts inline `[process-friction]` tags
 * from the Notes column, and aggregates them per company into a friction
 * signal — independent of company/role fit (#960) and interviewer red-flag
 * behavior (#1232). This tracks a third, distinct axis: is the *recruiting
 * process itself* (scheduling, communication clarity, tooling) well-run?
 *
 * Tagging convention (candidate-authored, in the Notes column of
 * data/active-interviews.md):
 *   [process-friction]                          — friction occurred, no detail
 *   [process-friction: <short reason>]           — friction occurred, with detail
 *
 * This is a company/process-level signal only — never tied to a named
 * individual recruiter. See issue #1466.
 *
 * Run: node process-quality.mjs             (JSON to stdout)
 *      node process-quality.mjs --summary   (human-readable table)
 *      node process-quality.mjs --min-threshold 2  (min total interviews per company to report)
 *      node process-quality.mjs --file path/to/active-interviews.md  (override the data path; test isolation)
 *      node process-quality.mjs --self-test
 *
 * Issue #1466 — github.com/santifer/career-ops
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACTIVE_INTERVIEWS_PATH = existsSync(join(CAREER_OPS, 'data/active-interviews.md'))
  ? join(CAREER_OPS, 'data/active-interviews.md')
  : join(CAREER_OPS, 'active-interviews.md');

const FRICTION_TAG = /\[process-friction(?::\s*([^\]]+))?\]/i;

// --- CLI args ---
const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
// --file overrides the data path — mirrors validate-portals.mjs / verify-portals.mjs's
// --file convention. Primarily for test isolation: it lets tests point at a
// controlled temp path instead of depending on whatever data/active-interviews.md
// happens to exist (or not) in the caller's real workspace.
const fileIdx = args.indexOf('--file');
const ACTIVE_INTERVIEWS_PATH = fileIdx !== -1 && args[fileIdx + 1] !== undefined
  ? args[fileIdx + 1]
  : DEFAULT_ACTIVE_INTERVIEWS_PATH;
const minThresholdIdx = args.indexOf('--min-threshold');
const rawMinThreshold = minThresholdIdx !== -1 && args[minThresholdIdx + 1] !== undefined
  ? parseInt(args[minThresholdIdx + 1], 10)
  : 1;
// Clamped here (not just inside aggregateProcessQuality) so printSummary's
// displayed threshold always matches the threshold actually applied.
const MIN_THRESHOLD = Number.isFinite(rawMinThreshold) && rawMinThreshold >= 0 ? rawMinThreshold : 1;

// Case-insensitive column lookup shared by extractFriction and
// aggregateProcessQuality — the header wording comes from a candidate-edited
// markdown file, so "Notes" vs "notes" vs " Notes " must all resolve the
// same way. Centralized here so both call sites can never drift apart.
function findColumn(row, name) {
  const key = Object.keys(row || {}).find(k => k.trim().toLowerCase() === name);
  return key ? String(row[key] ?? '') : '';
}

// --- Parse data/active-interviews.md ---
//
// Table format: `| Company | Role | Round | Date/Time | Interviewer | Status | Notes |`
// A separator row (all dashes/colons/pipes) follows the header and is skipped.
// Only well-formed rows (same column count as the header) are kept; malformed
// rows are silently dropped rather than crashing the parser.
//
// Only the FIRST contiguous block of pipe-formatted lines is parsed as the
// table. This intentionally stops at the first non-table line rather than
// collecting every pipe-formatted line in the file — a document with more
// than one markdown table (e.g. a second table added later, or Landmines-
// style tables from other files if ever concatenated) must not have its
// unrelated rows merged into the active-interviews result.
//
// Exported so external tests can call parseActiveInterviews() directly on a
// markdown string.
export function parseActiveInterviews(content) {
  if (typeof content !== 'string' || !content.trim()) return [];

  const lines = content.split('\n');
  const isTableLine = line => /^\s*\|.*\|\s*$/.test(line);

  const startIdx = lines.findIndex(isTableLine);
  if (startIdx === -1) return [];

  const tableLines = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (!isTableLine(lines[i])) break;
    tableLines.push(lines[i]);
  }
  if (tableLines.length < 2) return [];

  const splitRow = line =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim());

  const isSeparatorRow = cells => cells.every(cell => /^:?-+:?$/.test(cell));

  const header = splitRow(tableLines[0]);
  const colCount = header.length;
  if (colCount === 0) return [];

  const rows = [];
  for (const line of tableLines.slice(1)) {
    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;
    if (cells.length !== colCount) continue;

    const row = {};
    header.forEach((col, i) => {
      row[col] = cells[i];
    });
    rows.push(row);
  }
  return rows;
}

// --- Friction extraction ---
//
// Reads the Notes column (case-insensitive lookup, since header wording is
// candidate-editable free text) and pulls out the [process-friction] tag if
// present. Returns { hasFriction, reason } — reason is '' when the tag is
// present without a detail string.
export function extractFriction(row) {
  if (!row || typeof row !== 'object') return { hasFriction: false, reason: '' };
  const notes = findColumn(row, 'notes');
  const match = notes.match(FRICTION_TAG);
  if (!match) return { hasFriction: false, reason: '' };
  return { hasFriction: true, reason: (match[1] || '').trim() };
}

// --- Core aggregation ---
//
// Groups rows by company (case-insensitive, trimmed), counts total
// interview rows and friction-tagged rows per company, and returns only
// companies with totalInterviews >= minThreshold. Companies are sorted by
// frictionCount descending, then frictionRate descending, then company name
// ascending (stable, deterministic ordering for tests and CLI output).
//
// Exported so external tests can call aggregateProcessQuality() directly on
// a parsed row list.
export function aggregateProcessQuality(rows, minThreshold = 1) {
  if (!Array.isArray(rows)) return [];
  const threshold = Number.isFinite(minThreshold) && minThreshold >= 0 ? minThreshold : 1;

  const companyKey = row => findColumn(row, 'company').trim();

  const byCompany = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const company = companyKey(row);
    if (!company) continue;

    const dedupeKey = company.toLowerCase();
    if (!byCompany.has(dedupeKey)) {
      byCompany.set(dedupeKey, { company, total: 0, frictionCount: 0, reasons: [] });
    }
    const entry = byCompany.get(dedupeKey);
    entry.total += 1;

    const { hasFriction, reason } = extractFriction(row);
    if (hasFriction) {
      entry.frictionCount += 1;
      if (reason) entry.reasons.push(reason);
    }
  }

  const results = [...byCompany.values()]
    .filter(entry => entry.total >= threshold)
    .map(entry => ({
      company: entry.company,
      totalInterviews: entry.total,
      frictionCount: entry.frictionCount,
      frictionRate: entry.total > 0 ? Math.round((entry.frictionCount / entry.total) * 100) / 100 : 0,
      reasons: entry.reasons,
    }));

  results.sort((a, b) => {
    if (b.frictionCount !== a.frictionCount) return b.frictionCount - a.frictionCount;
    if (b.frictionRate !== a.frictionRate) return b.frictionRate - a.frictionRate;
    return a.company.localeCompare(b.company);
  });

  return results;
}

function loadActiveInterviews(path = ACTIVE_INTERVIEWS_PATH) {
  if (!existsSync(path)) return [];
  return parseActiveInterviews(readFileSync(path, 'utf-8'));
}

// --- Summary mode ---
function printSummary(signals) {
  console.log(`\n${'='.repeat(78)}`);
  console.log('  Process Quality Signal — career-ops');
  console.log(`  min threshold: ${MIN_THRESHOLD} interview(s) | companies: ${signals.length}`);
  console.log(`${'='.repeat(78)}\n`);

  if (signals.length === 0) {
    console.log('  No process-friction signal found (or no companies met the threshold).\n');
    return;
  }

  const header =
    '  ' +
    'Company'.padEnd(26) +
    'Interviews'.padEnd(12) +
    'Friction'.padEnd(10) +
    'Rate';
  console.log(header);
  console.log('  ' + '-'.repeat(70));

  for (const s of signals) {
    const company = (s.company || '').substring(0, 24).padEnd(26);
    const total = String(s.totalInterviews).padEnd(12);
    const friction = String(s.frictionCount).padEnd(10);
    const rate = `${Math.round(s.frictionRate * 100)}%`;
    console.log('  ' + company + total + friction + rate);
    for (const reason of s.reasons) {
      console.log(`      ↳ ${reason}`);
    }
  }
  console.log('');
}

// --- Self-test ---
function runSelfTest() {
  const md = [
    '# Active Interviews',
    '',
    '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |',
    '|---------|------|-------|-----------|-------------|--------|-------|',
    '| Acme | Backend Engineer | Prescreen | 2026-06-01 | Jane (recruiter) | Scheduled | Clean process, no issues |',
    '| Acme | Backend Engineer | Round 1 | 2026-06-08 | Panel | Scheduled | Confirmed quickly, no friction |',
    '| Beta Corp | Coordinator | Prescreen | 2026-06-10 | Sasha (bot) | Scheduled | [process-friction: stated availability overridden twice before confirming] |',
    '| Beta Corp | Coordinator | Round 1 | 2026-06-17 | HM | Scheduled | Went smoothly this round |',
    '| Gamma Inc | Analyst | Prescreen | 2026-06-12 | Recruiter | Rejected | [process-friction] |',
    '| Malformed row with too few cells |',
  ].join('\n');

  const rows = parseActiveInterviews(md);
  const signals = aggregateProcessQuality(rows, 1);

  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  check(rows.length === 5, 'parses 5 well-formed rows, drops the malformed one');

  const beta = signals.find(s => s.company === 'Beta Corp');
  check(!!beta, 'Beta Corp appears in aggregated signals');
  if (beta) {
    check(beta.totalInterviews === 2, 'Beta Corp has 2 total interview rows');
    check(beta.frictionCount === 1, 'Beta Corp has 1 friction-tagged row');
    check(beta.frictionRate === 0.5, 'Beta Corp friction rate is 0.5');
    check(beta.reasons.length === 1 && beta.reasons[0].includes('overridden'), 'Beta Corp friction reason captured');
  }

  const gamma = signals.find(s => s.company === 'Gamma Inc');
  check(!!gamma, 'Gamma Inc appears in aggregated signals');
  if (gamma) {
    check(gamma.frictionCount === 1, 'Gamma Inc has 1 friction-tagged row (bare tag, no reason)');
    check(gamma.reasons.length === 0, 'bare [process-friction] tag produces no reason string');
  }

  const acme = signals.find(s => s.company === 'Acme');
  check(!!acme, 'Acme appears in aggregated signals');
  if (acme) {
    check(acme.frictionCount === 0, 'Acme has 0 friction (no tags present)');
    check(acme.frictionRate === 0, 'Acme friction rate is 0');
  }

  check(aggregateProcessQuality([]).length === 0, 'empty input returns no signals');
  check(aggregateProcessQuality(null).length === 0, 'null input returns no signals (no crash)');
  check(parseActiveInterviews('').length === 0, 'empty markdown returns no rows');
  check(parseActiveInterviews(null).length === 0, 'non-string input returns no rows (no crash)');

  // A second, unrelated table later in the same document must NOT be merged
  // into the parsed rows — only the first contiguous table block is parsed.
  const twoTablesMd = md + '\n\nSome other section.\n\n' +
    '| Foo | Bar |\n|-----|-----|\n| unrelated | table |\n';
  const twoTablesRows = parseActiveInterviews(twoTablesMd);
  check(twoTablesRows.length === 5, 'a second markdown table later in the document is not merged in');
  check(!twoTablesRows.some(r => r.Company === undefined && 'Foo' in r), 'second-table columns (Foo/Bar) never appear in the result');

  // Threshold filtering: companies with fewer interviews than minThreshold are excluded.
  const highThreshold = aggregateProcessQuality(rows, 2);
  check(highThreshold.some(s => s.company === 'Beta Corp'), 'threshold=2: Beta Corp (2 rows) included');
  check(highThreshold.some(s => s.company === 'Acme'), 'threshold=2: Acme (2 rows) included');
  check(!highThreshold.some(s => s.company === 'Gamma Inc'), 'threshold=2: Gamma Inc (1 row) excluded');

  console.log(`\n  process-quality self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (selfTestMode) {
    runSelfTest();
  }

  const rows = loadActiveInterviews();
  const signals = aggregateProcessQuality(rows, MIN_THRESHOLD);

  if (summaryMode) {
    printSummary(signals);
  } else {
    console.log(JSON.stringify({
      metadata: {
        minThreshold: MIN_THRESHOLD,
        totalRows: rows.length,
        companies: signals.length,
      },
      signals,
    }, null, 2));
  }
}
