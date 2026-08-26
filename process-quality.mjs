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
 * Example friction patterns (illustrative, NOT an enforced taxonomy — the
 * tag stays free-text; tag anything that fits the spirit even if it doesn't
 * match one of these verbatim):
 *   [process-friction: call scheduled for a rejection with no info beyond what email would convey]
 *   [process-friction: prescreen repeated info already given in a prior round]
 *   [process-friction: interview rescheduled 2+ times same week]
 *   [process-friction: no confirmation after stated timeline passed]
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
import { fileURLToPath } from 'url';
import { flagValue, validateFlags, safeIntFlag } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

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
const fileFlagValue = flagValue(args, '--file');
const ACTIVE_INTERVIEWS_PATH = fileFlagValue !== undefined
  ? fileFlagValue
  : DEFAULT_ACTIVE_INTERVIEWS_PATH;
// safeIntFlag, not parseInt: this file had NO shape check, so unlike
// detect-reposts it did not even fall back — `--min-threshold
// 999999999999999999999` was ACCEPTED and reported as `"minThreshold": 1e+21`,
// the exact "metadata reports a value that is not the one in effect" failure
// detect-reposts.mjs documents isSafeInteger as existing to prevent (#2982).
// "abc" and "-5" already fell back to 1 via the clamp below; "3.5" silently
// became 3. All of them now take the documented fallback.
const rawMinThreshold = safeIntFlag(flagValue(args, '--min-threshold'), 1);
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

// A cell carrying no letter and no digit is a PLACEHOLDER, not a value: `?` for
// an undisclosed employer (#1596), and the tracker's `—`/`-` no-data sentinels.
function isPlaceholder(value) {
  return !/[\p{L}\p{N}]/u.test(value);
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

    // `?` is the documented marker for an undisclosed end employer (#1596), not
    // a company name. Grouping on it merged every unrelated employer into ONE
    // row and reported a friction rate averaged across all of them — the number
    // a user acts on ("this company wastes my time") computed over companies
    // they never dealt with. merge-tracker already refuses that merge; this
    // aggregate has to refuse it too.
    //
    // The channel is what distinguishes those rows, so it becomes the bucket.
    // A row naming neither employer nor channel supports no per-company claim
    // at all and is dropped rather than given one.
    let label = company;
    if (isPlaceholder(company)) {
      const via = findColumn(row, 'via').trim();
      if (!via || isPlaceholder(via)) continue;
      // The prefix is ALWAYS `?`, never the cell's own spelling. isPlaceholder
      // accepts `?`, `—`, `-` and an empty cell, and every one of them means the
      // same thing — but keeping them verbatim keys `— (via Hays)` apart from
      // `? (via Hays)`, splitting one channel's totals. That is this function's
      // own bug in miniature, so it gets the same answer: normalize, then group.
      label = `? (via ${via})`;
    }

    const dedupeKey = label.toLowerCase();
    if (!byCompany.has(dedupeKey)) {
      byCompany.set(dedupeKey, { company: label, total: 0, frictionCount: 0, reasons: [] });
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
const KNOWN_FLAGS = ['--file', '--min-threshold', '--summary', '--self-test', '--help', '-h'];
const VALUE_FLAGS = ['--file', '--min-threshold'];

const USAGE = `Usage:
  node process-quality.mjs                        # JSON report
  node process-quality.mjs --summary              # human-readable table
  node process-quality.mjs --file <path>          # a different active-interviews.md
  node process-quality.mjs --min-threshold <N>    # minimum rounds before a company is reported (default 1)
  node process-quality.mjs --self-test            # run the built-in fixtures
  node process-quality.mjs --help                 # show this message`;

if (isMainModule(import.meta.url)) {
  // Inside the main-module guard, not at import time: rejection-latency.mjs
  // imports parseActiveInterviews from here, so a top-level check would judge
  // the IMPORTER's argv and reject its flags as unrecognized (#2919).
  //
  // A mistyped --file was previously ignored, so the script silently reported
  // on data/active-interviews.md instead of the path that was asked for.
  //
  // requireOperand: without it, `--file --min-threshold` reads --min-threshold
  // as the file path and `--min-threshold --summary` parses to NaN and falls
  // back to the default of 1 — both silently, at exit 0 (#3087). Neither flag
  // has a more specific missing-value message of its own.
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

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
