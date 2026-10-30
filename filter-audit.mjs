#!/usr/bin/env node

/**
 * filter-audit.mjs — what your title_filter is actually doing.
 *
 * Zero-LLM, read-only. The keyword layer decides the fate of ~78% of everything
 * scanned (measured: 8,289 found → 6,499 rejected on title alone) and reports
 * nothing about how. scan.mjs already computes which keywords matched a title —
 * matchedTitleKeywords() — but only to scope content_filter, and throws the
 * answer away 8,000 times per scan. This replays it over the offers that
 * passed the title filter, so the filter can be tuned from evidence instead of
 * guesswork.
 *
 * Three questions, two of which it answers:
 *
 *   1. Which keywords earn their keep?  — replayed over scan-history.tsv
 *   2. Which generate noise?           — joined against evaluated scores
 *   3. What am I missing?              — not here. The rejected titles are now
 *                                        in scan-history.tsv as skipped_title
 *                                        (#2695); a near-miss report over them
 *                                        is a separate tool.
 *
 * The metric that matters is `unique`, not `hits`: how many offers a keyword is
 * the ONLY one to catch. A keyword with 200 hits and 0 unique can be deleted
 * without losing a single posting; one with 3 hits and 3 unique is the only
 * reason those three were ever seen.
 *
 * Usage:
 *   node filter-audit.mjs             JSON
 *   node filter-audit.mjs --summary   human-readable
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadYaml } from './lib/yaml-document.mjs';
import { matchedTitleKeywords, normalizeUrlForDedup, PORTALS_PATH, SCAN_HISTORY_PATH } from './scan.mjs';
import { foldTitle } from './title-keywords.mjs';
import { parseScanHistoryLine } from './lib/scan-history-columns.mjs';
import { parseScore, unwrapReportUrlToken } from './tracker-parse.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';

const REPORTS_DIR = join(getCareerOpsRoot(), 'reports');

const KNOWN_FLAGS = ['--summary', '--help', '-h'];
const USAGE = `filter-audit.mjs — what your title_filter is actually doing

  node filter-audit.mjs             JSON
  node filter-audit.mjs --summary   human-readable

Answers "which keywords earn their keep" and "which generate noise" by
replaying the matcher over the offers in data/scan-history.tsv that passed the
title filter.

"What am I missing" is not answered here. The titles the filter rejected are
recorded as skipped_title rows (#2695) and are left out of this replay, since
by definition they match no positive keyword.`;

/**
 * The offers that passed the title filter, one per posting.
 *
 * `skipped_title` rows are left out: they matched no positive keyword by
 * definition, so replaying them would only inflate `unmatchedRows`, which is
 * meant to say the filter changed since a row was recorded. Every other status
 * was decided after the title cut. A posting can carry several rows (one per
 * status), so rows are deduped on the scanner's own URL key.
 *
 * Pre-v1.18 rows carry three cells, url / date / title, with no header, and an
 * upgrade keeps them byte-identical. Read by the current column order their
 * title lands in `portal`, so a three-cell row takes its title from there and
 * has no company or status.
 */
export function readHistory(tsv) {
  const lines = String(tsv ?? '').split('\n');
  if (lines[0]?.startsWith('url\t')) lines.shift();
  const seen = new Set();
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parsed = parseScanHistoryLine(line);
    const legacy = line.split('\t').length === 3;
    const { url } = parsed;
    const title = legacy ? parsed.portal : parsed.title;
    const company = legacy ? '' : parsed.company;
    const status = legacy ? '' : parsed.status;
    if (!title || status === 'skipped_title') continue;
    const key = url ? normalizeUrlForDedup(url) : `title:${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ url, title, company });
  }
  return rows;
}

/** Leading report number of `041-acme-2026-01-07.md`, or -1. */
function reportNumber(name) {
  const m = String(name).match(/^(\d+)-/);
  return m ? Number(m[1]) : -1;
}

/**
 * URL → score, from the evaluation reports. Lets a keyword be judged on the
 * quality of what it admits, not just the quantity.
 *
 * A posting evaluated twice has two reports. The highest report number wins,
 * since that is the latest evaluation; reports are read in that order rather
 * than directory order, so the result is the same on every filesystem.
 *
 * @param {{name: string, text: string}[]} reports
 */
export function readScoresByUrl(reports) {
  const map = new Map();
  const ordered = [...reports].sort((a, b) => reportNumber(a.name) - reportNumber(b.name) || a.name.localeCompare(b.name));
  for (const { text } of ordered) {
    const u = text.match(/\*\*URL:\*\*[ \t]*(\S+)/);
    const s = text.match(/\*\*Score:\*\*[ \t]*([^\n]+)/);
    if (!u || !s) continue;
    const score = parseScore(s[1]);
    if (score > 0) map.set(normalizeUrlForDedup(unwrapReportUrlToken(u[1])), score);
  }
  return map;
}

export function audit(titleFilter, history, scoresByUrl) {
  // Keywords that compile to the same matcher are one keyword. matchedTitleKeywords
  // returns one hit per entry, so a duplicate ("AI" twice, or "AI" and "ai")
  // gave one title two hits, zeroed `unique` for both and called a load-bearing
  // keyword redundant. The first spelling is kept; the rest are reported.
  const raw = Array.isArray(titleFilter?.positive) ? titleFilter.positive : [];
  const byKey = new Map();
  const duplicates = [];
  for (const k of raw) {
    if (typeof k !== 'string' || !k.trim()) continue;
    const key = foldTitle(k).trim();
    if (byKey.has(key)) duplicates.push(k);
    else byKey.set(key, k);
  }
  const positives = [...byKey.values()];
  const filter = { ...titleFilter, positive: positives };

  const stats = new Map(positives.map((k) => [k, { keyword: k, hits: 0, unique: 0, scored: 0, scoreSum: 0, examples: [] }]));
  let unmatched = 0;

  for (const row of history) {
    const hit = matchedTitleKeywords(row.title, filter);
    if (hit.length === 0) {
      // Present in history but matched nothing: the filter changed since this
      // row was recorded. Worth surfacing rather than silently dropping.
      unmatched++;
      continue;
    }
    const score = row.url ? scoresByUrl.get(normalizeUrlForDedup(row.url)) : undefined;
    for (const k of hit) {
      const s = stats.get(k);
      if (!s) continue;
      s.hits++;
      if (hit.length === 1) s.unique++;
      if (typeof score === 'number') { s.scored++; s.scoreSum += score; }
      if (s.examples.length < 3) s.examples.push(row.title);
    }
  }

  const rows = [...stats.values()].map((s) => ({
    ...s,
    avgScore: s.scored ? Number((s.scoreSum / s.scored).toFixed(2)) : null,
  }));
  rows.sort((a, b) => b.unique - a.unique || b.hits - a.hits || a.keyword.localeCompare(b.keyword));

  return {
    offers: history.length,
    keywords: positives.length,
    duplicates,
    unmatchedRows: unmatched,
    dead: rows.filter((r) => r.hits === 0).map((r) => r.keyword),
    // Carries its weight only through other keywords: deleting it loses nothing.
    redundant: rows.filter((r) => r.hits > 0 && r.unique === 0).map((r) => r.keyword),
    // Admits a lot, and what it admits scores badly. The cost is real: every one
    // of these is a candidate someone might pay to evaluate.
    noisy: rows.filter((r) => r.hits >= 5 && r.avgScore !== null && r.avgScore < 2.5),
    rows,
  };
}

function printSummary(result) {
  console.log('TITLE FILTER AUDIT');
  console.log(`${result.keywords} keywords replayed over ${result.offers} offers that passed the title filter`);
  if (result.unmatchedRows) console.log(`${result.unmatchedRows} historical rows match no current keyword (filter changed since)`);
  console.log('');

  if (result.duplicates.length) {
    console.log(`  DUPLICATE (${result.duplicates.length}) — the same keyword listed again; audited once:`);
    console.log(`    ${result.duplicates.join(', ')}\n`);
  }
  if (result.dead.length) {
    console.log(`  NEVER MATCHED (${result.dead.length}) — too narrow, misspelled, or the market does not use the word:`);
    console.log(`    ${result.dead.join(', ')}\n`);
  }
  if (result.noisy.length) {
    console.log('  NOISY — admits volume, and what it admits scores badly:');
    for (const r of result.noisy) {
      console.log(`    ${r.keyword}  ${r.hits} hits · ${r.unique} unique · avg ${r.avgScore}/5`);
      if (r.examples[0]) console.log(`      e.g. "${r.examples[0]}"`);
    }
    console.log('');
  }
  if (result.redundant.length) {
    console.log(`  REDUNDANT (${result.redundant.length}) — every match also caught by another keyword; deleting loses nothing:`);
    console.log(`    ${result.redundant.join(', ')}\n`);
  }

  const carrying = result.rows.filter((r) => r.unique > 0).slice(0, 12);
  console.log('  CARRYING THE SEARCH — offers only this keyword catches:');
  for (const r of carrying) {
    console.log(`    ${String(r.unique).padStart(4)} unique  ${String(r.hits).padStart(4)} hits  ${r.avgScore !== null ? `avg ${r.avgScore}` : '  —  '}  ${r.keyword}`);
  }
  console.log('\n  `unique` is the number to tune on. A keyword with hits but no unique can go;');
  console.log('  one with few hits and all of them unique is the only reason those were seen.');
}

function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE);

  if (!existsSync(PORTALS_PATH)) {
    console.error(`Error: portals.yml not found at ${PORTALS_PATH}. Run onboarding first - the audit reads its title_filter.`);
    process.exit(1);
  }
  const cfg = loadYaml(readFileSync(PORTALS_PATH, 'utf-8')) || {};
  const history = existsSync(SCAN_HISTORY_PATH) ? readHistory(readFileSync(SCAN_HISTORY_PATH, 'utf-8')) : [];
  const reports = existsSync(REPORTS_DIR)
    ? readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith('.md') && !f.includes('RESERVED'))
      .map((name) => ({ name, text: readFileSync(join(REPORTS_DIR, name), 'utf-8') }))
    : [];
  const result = audit(cfg.title_filter, history, readScoresByUrl(reports));

  if (args.includes('--summary')) printSummary(result);
  else console.log(JSON.stringify(result, null, 2));
}

if (isMainModule(import.meta.url)) main();
