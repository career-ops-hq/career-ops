#!/usr/bin/env node

/**
 * find.mjs — resolve a company/role/number query to its full pipeline identity (#1431).
 *
 * "Apply to #13" is ambiguous: report numbers and tracker row numbers diverge,
 * and mapping company ↔ report# ↔ tracker# ↔ PDF used to require opening three
 * files (applications.md, reports/, data/pdf-index.tsv). This read-only tool
 * answers it in one lookup.
 *
 * Usage:
 *   node find.mjs <query> [--json]
 *
 * <query> is a report number, tracker number, or company/role fragment.
 * A numeric query matches BOTH the tracker # column and the report number in
 * the Report link ("012" and "12" are the same number), so a collision between
 * the two numbering schemes surfaces as multiple rows instead of a silent wrong
 * pick. A text query matches company/role by case-insensitive substring, with
 * the shared fuzzy matcher (role-matcher.mjs) as fallback for multi-word
 * phrases.
 *
 * Zero dependencies and strictly read-only: parses data/applications.md via
 * the shared header-aware column mapping (tracker-parse.mjs) and the PDF
 * manifest data/pdf-index.tsv (written by generate-pdf.mjs).
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

// "008" and "8" are the same report — zero-padded report-link form vs unpadded
// tracker-# form (same normalization as the manifest writer in generate-pdf.mjs).
const normNum = (s) => String(s ?? '').trim().replace(/^0+(?=\d)/, '');

// Same status hygiene as tracker.mjs: strip markdown bold and stray dates so a
// messy cell still prints as its canonical label.
const cleanStatus = (s) =>
  String(s ?? '').replace(/\*\*/g, '').replace(/\(?\d{4}-\d{2}-\d{2}\)?/g, '').trim();

/**
 * Parse the tracker markdown into lookup rows.
 *
 * The report number and path come from the Report cell's markdown link. The
 * path is normalized to be root-relative: trackers at `data/applications.md`
 * carry `../reports/...` links (relative to the tracker file, see #760), which
 * would be misleading when printed from the career-ops root.
 *
 * @param {string} text - Full contents of applications.md.
 * @returns {Array<{trackerNum:number,date:string,company:string,role:string,score:string,status:string,reportNum:string|null,reportPath:string|null}>}
 */
export function parseTrackerRows(text) {
  const lines = String(text ?? '').split('\n');
  const colmap = resolveColumns(lines);
  const rows = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    const link = row.report.match(/\[(\d+)\]\(([^)]+)\)/);
    rows.push({
      trackerNum: row.num,
      date: row.date,
      company: row.company,
      role: row.role,
      score: row.score,
      status: cleanStatus(row.status),
      reportNum: link ? normNum(link[1]) : null,
      reportPath: link ? link[2].replace(/^(\.\.\/)+/, '') : null,
    });
  }
  return rows;
}

/**
 * Parse data/pdf-index.tsv (report \t pdf \t html \t format \t date) into a
 * normalized-report# → PDF-path map. Comment lines and rows generated without
 * a report number are skipped.
 *
 * @param {string} text - Full contents of pdf-index.tsv.
 * @returns {Map<string,string>}
 */
export function parsePdfIndex(text) {
  const map = new Map();
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (!fields[0]?.trim() || !fields[1]) continue;
    map.set(normNum(fields[0]), fields[1]);
  }
  return map;
}

/**
 * Resolve a query against parsed tracker rows.
 *
 * @param {ReturnType<typeof parseTrackerRows>} rows
 * @param {string} query - Report#, tracker#, or company/role fragment.
 * @param {Map<string,string>} [pdfIndex] - From parsePdfIndex().
 * @returns {Array<object>} Matching rows, each augmented with `pdfPath` (null when no PDF is indexed for its report).
 */
export function findMatches(rows, query, pdfIndex = new Map()) {
  const q = String(query ?? '').trim();
  if (!q) return [];

  let hits;
  if (/^\d+$/.test(q)) {
    const nq = normNum(q);
    hits = rows.filter(r => String(r.trackerNum) === nq || r.reportNum === nq);
  } else {
    const ql = q.toLowerCase();
    hits = rows.filter(r =>
      r.company.toLowerCase().includes(ql) ||
      r.role.toLowerCase().includes(ql) ||
      roleFuzzyMatch(r.company, q) ||
      roleFuzzyMatch(r.role, q));
  }
  return hits.map(r => ({
    ...r,
    pdfPath: (r.reportNum !== null && pdfIndex.get(r.reportNum)) || null,
  }));
}

// ── CLI ─────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const query = args.filter(a => a !== '--json').join(' ').trim();
  if (!query) {
    console.log('Usage: node find.mjs <report# | tracker# | company/role fragment> [--json]');
    process.exitCode = 1;
    return;
  }

  const trackerPath = process.env.CAREER_OPS_TRACKER || resolve(ROOT, 'data', 'applications.md');
  if (!existsSync(trackerPath)) {
    console.error(`Error: ${trackerPath} not found — nothing to search.`);
    process.exitCode = 1;
    return;
  }
  const rows = parseTrackerRows(readFileSync(trackerPath, 'utf-8'));

  const manifestPath = resolve(ROOT, 'data', 'pdf-index.tsv');
  const pdfIndex = existsSync(manifestPath)
    ? parsePdfIndex(readFileSync(manifestPath, 'utf-8'))
    : new Map();

  const matches = findMatches(rows, query, pdfIndex);
  if (json) {
    console.log(JSON.stringify(matches, null, 2));
    if (matches.length === 0) process.exitCode = 1;
    return;
  }
  if (matches.length === 0) {
    console.log(`No application matches "${query}" — try a report #, tracker #, or company fragment.`);
    process.exitCode = 1;
    return;
  }

  const headers = ['Tracker#', 'Report#', 'Company', 'Role', 'Status', 'PDF', 'Report'];
  const table = matches.map(m => [
    String(m.trackerNum), m.reportNum ?? '—', m.company, m.role,
    m.status || '—', m.pdfPath ?? '—', m.reportPath ?? '—',
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...table.map(r => r[i].length)));
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  console.log(fmt(headers));
  console.log(fmt(widths.map(w => '-'.repeat(w))));
  for (const r of table) console.log(fmt(r));
  console.error(`\n${matches.length} match(es)`); // stderr so stdout stays pipeable
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
