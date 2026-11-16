#!/usr/bin/env node
/**
 * discard-analytics.mjs — Analyze the discard log for filter tuning
 *
 * The discard log (data/discard.log, or batch/logs/discard.log for batch runs)
 * is the only record of what the filters threw away and why. This script reads
 * it and produces a summary of rejection reasons, domains, and daily volume,
 * plus the most-discarded URLs for the candidate to review by hand.
 *
 * Read-only: never modifies the log.
 *
 * The reasons are whatever the writers put there: batch-runner.sh writes
 * `dealbreaker: "{rule}"` and `below-min-score`, and the interactive pipeline
 * gate writes a free-text reason. No reason vocabulary is assumed. Title
 * keyword tuning belongs to filter-audit.mjs: title filtering happens in
 * scan.mjs and is recorded in data/scan-history.tsv, not in this log.
 *
 * The most-discarded section is deliberately dumb — it lists the URLs with
 * their latest reason and lets the candidate judge whether the gate is
 * costing them real roles. It never infers a rule change; that is a guess
 * wearing a number. Combine it with --reason to review one reason's URLs.
 *
 * Run: node discard-analytics.mjs [--log <path>] [--reason <pattern>] [--top N] [--since YYYY-MM-DD]
 *
 * --log defaults to data/discard.log. Pass batch/logs/discard.log to analyze
 * the batch variant (same shape, one extra id field per row).
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';

/**
 * Parse a discard log's contents into entries.
 *
 * Interactive rows are 3 fields:  {timestamp}\t{url}\t{reason}
 * Batch rows are 4 fields:        {timestamp}\t{id}\t{url}\t{reason}
 * The URL is always the field before the reason; detected by field count.
 *
 * @param {string} text - Raw log contents.
 * @returns {Array<{timestamp:string, url:string, reason:string}>}
 */
export function parseDiscardLog(text) {
  const out = [];
  for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    let timestamp, url, reason;
    if (parts.length >= 4) {
      [timestamp, , url, reason] = parts;
    } else {
      [timestamp, url, reason] = parts;
    }
    if (!timestamp || !url || !reason) continue;
    out.push({ timestamp, url, reason: reason.trim() });
  }
  return out;
}

/**
 * Order two log timestamps as instants. ISO8601 strings do not sort as text
 * (`10:00:00.500Z` sorts before `10:00:00Z`, and offsets differ), so both are
 * parsed; an unparseable one falls back to text order.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative, zero or positive, like a sort comparator.
 */
function compareTimestamps(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Aggregate parsed entries into sorted reason/domain/day counts.
 *
 * @param {Array<{timestamp:string, url:string, reason:string}>} entries
 * @returns {{
 *   total: number,
 *   byReason: Array<[string, number]>,
 *   byDomain: Array<[string, number]>,
 *   byDay: Array<[string, number]>,
 *   byUrl: Array<{url: string, count: number, lastReason: string}>
 * }}
 */
export function aggregateDiscards(entries) {
  const reasonCounts = {};
  const domainCounts = {};
  const dayCounts = {};
  const urlStats = new Map();

  for (const e of entries) {
    reasonCounts[e.reason] = (reasonCounts[e.reason] || 0) + 1;
    try {
      const u = new URL(e.url);
      domainCounts[u.hostname] = (domainCounts[u.hostname] || 0) + 1;
    } catch { /* malformed URL */ }
    const day = e.timestamp.slice(0, 10);
    dayCounts[day] = (dayCounts[day] || 0) + 1;
    const stat = urlStats.get(e.url) || { url: e.url, count: 0, lastReason: '', lastTimestamp: '' };
    stat.count += 1;
    if (stat.count === 1 || compareTimestamps(e.timestamp, stat.lastTimestamp) >= 0) {
      stat.lastTimestamp = e.timestamp;
      stat.lastReason = e.reason;
    }
    urlStats.set(e.url, stat);
  }

  const byReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  const byDomain = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  const byDay = Object.entries(dayCounts).sort((a, b) => a[0].localeCompare(b[0]));
  const byUrl = [...urlStats.values()]
    .sort((a, b) => b.count - a.count || a.url.localeCompare(b.url))
    .map(({ url, count, lastReason }) => ({ url, count, lastReason }));

  return { total: entries.length, byReason, byDomain, byDay, byUrl };
}

/**
 * Render the summary to a string (the CLI prints it).
 * @param {ReturnType<typeof aggregateDiscards>} agg
 * @param {number} topN - Number of domains/URLs to show.
 * @param {string} firstDate - Earliest timestamp in the filtered set.
 * @param {string} lastDate - Latest timestamp in the filtered set.
 * @returns {string}
 */
export function renderSummary(agg, topN, firstDate, lastDate) {
  const pct = (n) => ((n / agg.total) * 100).toFixed(1);
  const pad = (s, n) => String(s).padEnd(n);

  const lines = [];
  lines.push('=== Discard Log Analytics ===');
  lines.push(`Period: ${firstDate} to ${lastDate}`);
  lines.push(`Total discards: ${agg.total}`);
  lines.push('');

  lines.push('By reason:');
  for (const [reason, count] of agg.byReason) {
    lines.push(`  ${pad(reason, 30)} ${pad(count, 5)}  (${pct(count)}%)`);
  }
  lines.push('');

  lines.push(`By domain (top ${topN}):`);
  for (const [domain, count] of agg.byDomain.slice(0, topN)) {
    lines.push(`  ${pad(domain, 35)} ${pad(count, 5)}  (${pct(count)}%)`);
  }
  lines.push('');

  lines.push('By day:');
  for (const [day, count] of agg.byDay) {
    lines.push(`  ${day}  ${pad(count, 5)}  ${'#'.repeat(Math.min(count, 50))}`);
  }
  lines.push('');

  if (agg.byUrl.length > 0) {
    lines.push(`Most-discarded URLs (top ${topN}, check by hand for wrong rejections):`);
    for (const { url, count, lastReason } of agg.byUrl.slice(0, topN)) {
      lines.push(`  ${pad(count, 5)} ${url}  (${lastReason})`);
    }
    lines.push('');
  }

  lines.push(`Summary: ${agg.byReason.length} unique reasons, ${agg.byDomain.length} domains, ${agg.byDay.length} active days`);
  if (agg.byReason.length > 0) {
    const [topReason, count] = agg.byReason[0];
    lines.push(`Top rejection: "${topReason}" (${count} occurrences, ${pct(count)}%)`);
  }
  return lines.join('\n');
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (isMainModule(import.meta.url)) {
  // Before any work. argValue() below used indexOf(), which cannot see
  // `--log=path`, `--since=2026-08-26`, `--reason=x` or `--top=5`: the value
  // was dropped and the run used the default log and no filter at exit 0.
  // validateFlags rejects an unknown or valueless flag; flagValue reads both
  // spellings.
  const USAGE = 'Usage: node discard-analytics.mjs [--log <path>] [--reason <pattern>] [--top N] [--since YYYY-MM-DD]\n'
    + '  Analyzes the discard log for filter tuning insights.';
  const args = process.argv.slice(2);
  validateFlags(args, ['--log', '--reason', '--top', '--since', '--help', '-h'], USAGE, {
    valueFlags: ['--log', '--reason', '--top', '--since'],
    requireOperand: true,
  });

  const argValue = (flag) => flagValue(args, flag) ?? null;

  const filterReason = argValue('--reason');
  const parsedTopN = Number(argValue('--top') || '10');
  const topN = Number.isInteger(parsedTopN) && parsedTopN > 0 ? parsedTopN : 10;
  const sinceDate = argValue('--since');
  const customLog = argValue('--log');

  const logFile = customLog || join(getCareerOpsRoot(), 'data/discard.log');
  let logStat = null;
  try {
    logStat = existsSync(logFile) ? statSync(logFile) : null;
  } catch {
    logStat = null;
  }
  if (!logStat?.isFile()) {
    console.log(`No discard log found at ${logFile}`);
    process.exit(0);
  }

  let entries = parseDiscardLog(readFileSync(logFile, 'utf-8'));
  if (sinceDate) entries = entries.filter((e) => e.timestamp >= sinceDate);
  if (filterReason) entries = entries.filter((e) => e.reason.toLowerCase().includes(filterReason.toLowerCase()));

  if (entries.length === 0) {
    console.log('No matching entries in discard log.');
    process.exit(0);
  }

  const agg = aggregateDiscards(entries);
  const firstDate = agg.byDay[0][0];
  const lastDate = agg.byDay[agg.byDay.length - 1][0];

  console.log(renderSummary(agg, topN, firstDate, lastDate));
}
