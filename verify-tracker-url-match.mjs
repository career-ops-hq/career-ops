#!/usr/bin/env node
/**
 * verify-tracker-url-match.mjs — does each tracker row's URL cell describe the
 * same posting as the report it links?
 *
 * The gap this closes: verify-pipeline's Check 3 only proves the report FILE
 * exists, and Check 9 compares URLs BETWEEN reports that share a company+role.
 * Nothing compares the row's own URL cell against the report's `**URL:**`
 * header, so a row pointing at posting A while its linked report documents
 * posting B passes every existing check — the tracker's dedup key and the
 * report's archive disagree, and neither reader sees it.
 *
 * The mismatch gate is AGENTS.md's own URL identity rule, reused rather than
 * reinvented: a URL mismatch proves two different postings ONLY while both
 * sides are employer-controlled (an ATS board or the employer's careers page).
 * An aggregator (LinkedIn, Indeed, ...) re-lists one requisition under its own
 * URL, so a mismatch with an aggregator on either side is skipped, never
 * flagged. The same applies to a one-sided language param (?language=en on one
 * side only) — postingUrlRelation reports it as 'one-sided-language', which is
 * not proof of two postings.
 *
 * Multi-report rows (a re-evaluation keeps two reports on record, #5780) are
 * flagged only when the row agrees with NONE of its keyed reports: when the row
 * matches one report, a URL difference on the other is the report-to-report
 * question Check 9 already owns, not a row integrity problem.
 *
 * Read-only: never writes anything. Exit 1 when at least one mismatch is
 * found, 0 otherwise (skips never fail the run) — same convention as
 * check-jd-archive.mjs, so CI can gate on it.
 *
 * Run: node verify-tracker-url-match.mjs            (JSON)
 *      node verify-tracker-url-match.mjs --summary  (human-readable)
 *      node verify-tracker-url-match.mjs --help
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { resolveTrackerPath, resolveWorkspaceRoot } from './tracker-utils.mjs';
import { detectColumns, isHeaderRow, isSeparatorRow, parseTrackerRow, extractTrackerReportLinks, LEGACY_COLMAP } from './tracker-parse.mjs';
import { normalizeUrl, isAggregatorUrl, postingUrlRelation } from './url-key.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const KNOWN_FLAGS = ['--json', '--summary', '--help', '-h'];
const USAGE = `verify-tracker-url-match.mjs — compare each tracker row's URL cell with its linked report's **URL:** header

  node verify-tracker-url-match.mjs            JSON
  node verify-tracker-url-match.mjs --summary  human-readable

Read-only. Flags a row only when both URLs are employer-controlled and
postingUrlRelation says 'distinct'; aggregator and one-sided-language cases are
skipped, following AGENTS.md's URL identity rule. Exit 1 on any mismatch.`;

/**
 * The raw token after `**URL:**` in a report header, or '' when absent.
 *
 * Same extraction rule as verify-pipeline's Check 9 and merge-tracker's
 * resolveReportUrl (which document it): the match is anywhere on the line —
 * the documented header is INLINE (`**Score:** 4.1/5 | **URL:** https://...`)
 * — and `[ \t]*` / `\S+` cannot cross a newline, so an EMPTY header cannot
 * capture the next header's text. Returns the raw token, not a key: `**URL:**
 * N/A` (a recruiter-sourced role) must classify as "no key", never become a
 * value two sides can compare.
 *
 * @param {string} reportContent - Full markdown text of a report file.
 * @returns {string} The raw token after **URL:**, or '' when there is none.
 */
export function extractReportUrlToken(reportContent) {
  const m = String(reportContent ?? '').match(/\*\*URL:\*\*[ \t]*(\S+)/);
  return m ? m[1] : '';
}

/**
 * Compare one row URL against one report URL under the AGENTS.md identity rule.
 *
 * @param {string} rowUrlRaw - The row's URL cell (already the href, #3516).
 * @param {string} reportUrlRaw - The report's raw `**URL:**` token.
 * @returns {{verdict: 'match'|'mismatch'|'skip', reason: string}}
 */
export function classifyPair(rowUrlRaw, reportUrlRaw) {
  const rowKey = normalizeUrl(rowUrlRaw);
  const reportKey = normalizeUrl(reportUrlRaw);
  // '' is NO KEY, never a value that can match another '' (url-key.mjs contract).
  if (!rowKey) return { verdict: 'skip', reason: 'row-url-missing' };
  if (!reportKey) return { verdict: 'skip', reason: 'report-url-missing' };
  if (rowKey === reportKey) return { verdict: 'match', reason: 'same-key' };
  // Identical keys already matched above; from here the hosts disagree, and an
  // aggregator on either side says nothing about identity (#3652).
  if (isAggregatorUrl(rowUrlRaw) || isAggregatorUrl(reportUrlRaw)) {
    return { verdict: 'skip', reason: 'aggregator' };
  }
  const relation = postingUrlRelation(rowUrlRaw, reportUrlRaw);
  if (relation === 'distinct') return { verdict: 'mismatch', reason: 'distinct-employer-urls' };
  return { verdict: 'skip', reason: relation };
}

/**
 * Resolve the report file for a report NUMBER in the workspace's reports/ dir.
 * Accepts both the canonical zero-padded prefix (`042-...`) and the unpadded
 * spelling (`42-...`), the same pair jd-capture.mjs resolves by.
 *
 * @param {string} reportsDir - Workspace reports/ directory.
 * @param {number} num - Report number from the tracker link.
 * @returns {string|null} Absolute path, or null when no file matches.
 */
function findReportFile(reportsDir, num) {
  if (!existsSync(reportsDir)) return null;
  const prefixes = [`${String(num).padStart(3, '0')}-`, `${String(num)}-`];
  for (const name of readdirSync(reportsDir)) {
    if (!name.endsWith('.md')) continue;
    if (prefixes.some((p) => name.startsWith(p))) return join(reportsDir, name);
  }
  return null;
}

/**
 * Run the check over the resolved tracker.
 *
 * @returns {{tracker: string, checked: number, matched: number, mismatches: object[], skipped: Record<string, number>, ok: boolean}}
 */
export function runCheck() {
  const root = getCareerOpsRoot();
  const trackerPath = resolveTrackerPath(root);
  const reportsDir = join(resolveWorkspaceRoot(trackerPath), 'reports');

  const result = {
    tracker: trackerPath,
    checked: 0,
    matched: 0,
    mismatches: [],
    skipped: {},
    ok: true,
  };
  const skip = (reason) => { result.skipped[reason] = (result.skipped[reason] ?? 0) + 1; };

  if (!existsSync(trackerPath)) {
    result.trackerMissing = true;
    return result;
  }

  const lines = readFileSync(trackerPath, 'utf-8').split(/\r?\n/);
  const colmap = detectColumns(lines) ?? LEGACY_COLMAP;

  for (const line of lines) {
    if (!line.startsWith('|') || isSeparatorRow(line) || isHeaderRow(line)) continue;
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;

    const links = extractTrackerReportLinks(row.report, row.notes);
    if (links.length === 0) { skip('no-report-link'); continue; }
    result.checked++;
    if (!normalizeUrl(row.url)) { result.checked--; skip('row-url-missing'); continue; }

    let agrees = false;
    const candidates = [];
    for (const link of links) {
      const reportFile = findReportFile(reportsDir, link.target);
      if (!reportFile) { skip('report-file-missing'); continue; }
      const token = extractReportUrlToken(readFileSync(reportFile, 'utf-8'));
      const { verdict, reason } = classifyPair(row.url, token);
      if (verdict === 'match') { agrees = true; continue; }
      if (verdict === 'mismatch') {
        candidates.push({
          num: row.num,
          company: row.company.trim(),
          role: row.role.trim(),
          rowUrl: row.url,
          reportFile: `${reportsDir.split(/[/\\]/).pop()}/${reportFile.split(/[/\\]/).pop()}`,
          reportUrl: token,
        });
        continue;
      }
      skip(reason);
    }

    if (candidates.length === 0 && agrees) { result.matched++; continue; }
    // A row that agrees with at least one of its reports is internally
    // consistent; a URL difference on ANOTHER report is Check 9's
    // report-to-report question (#5780 re-evaluations), not a row mismatch.
    if (agrees) { candidates.forEach(() => skip('row-agrees-with-another-report')); continue; }
    if (candidates.length === 0) continue; // every link was skipped — nothing to judge
    result.mismatches.push(...candidates);
  }

  result.ok = result.mismatches.length === 0;
  return result;
}

function printSummary(result) {
  console.log(`tracker: ${result.tracker}`);
  if (result.trackerMissing) { console.log('  (tracker file not found — nothing to check)'); return; }
  console.log(`rows checked: ${result.checked}   consistent: ${result.matched}   mismatches: ${result.mismatches.length}`);
  for (const m of result.mismatches) {
    console.log(`\n  ✗ #${m.num} ${m.company} — ${m.role}`);
    console.log(`      row:    ${m.rowUrl}`);
    console.log(`      report: ${m.reportUrl}  (${m.reportFile})`);
  }
  const skips = Object.entries(result.skipped);
  if (skips.length) {
    console.log(`\nskipped: ${skips.map(([k, v]) => `${k}=${v}`).join('  ')}`);
  }
  console.log(result.ok ? '\n✅ row URLs agree with their reports' : '\n❌ row URL(s) disagree with the linked report — open both and correct the row URL cell or the report header');
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  validateFlags(argv, KNOWN_FLAGS, USAGE);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }

  const result = runCheck();
  if (argv.includes('--summary')) printSummary(result);
  else console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}