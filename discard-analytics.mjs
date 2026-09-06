#!/usr/bin/env node
/**
 * discard-analytics.mjs — Analyze the discard log for filter tuning
 *
 * The discard log (data/discard.log, or batch/logs/discard.log for batch runs)
 * is the only record of what the filters threw away and why. This script reads
 * it and produces a summary of rejection reasons, domains, and daily volume,
 * plus the most frequent title_mismatch URLs for the candidate to review.
 *
 * Read-only: never modifies the log.
 *
 * The top title_mismatch section is deliberately dumb — it lists the URLs and
 * lets the candidate judge whether a keyword is costing them real roles. It
 * never infers which keyword to add; that is a guess wearing a number.
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
 * Aggregate parsed entries into sorted reason/domain/day counts.
 *
 * @param {Array<{timestamp:string, url:string, reason:string}>} entries
 * @returns {{
 *   total: number,
 *   byReason: Array<[string, number]>,
 *   byDomain: Array<[string, number]>,
 *   byDay: Array<[string, number]>,
 *   titleMismatch: Array<[string, number]>
 * }}
 */
export function aggregateDiscards(entries) {
  const reasonCounts = {};
  const domainCounts = {};
  const dayCounts = {};
  const titleMismatchCounts = {};

  for (const e of entries) {
    reasonCounts[e.reason] = (reasonCounts[e.reason] || 0) + 1;
    try {
      const u = new URL(e.url);
      domainCounts[u.hostname] = (domainCounts[u.hostname] || 0) + 1;
    } catch { /* malformed URL */ }
    const day = e.timestamp.slice(0, 10);
    dayCounts[day] = (dayCounts[day] || 0) + 1;
    if (e.reason.includes('title_mismatch')) {
      titleMismatchCounts[e.url] = (titleMismatchCounts[e.url] || 0) + 1;
    }
  }

  const byReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  const byDomain = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  const byDay = Object.entries(dayCounts).sort((a, b) => a[0].localeCompare(b[0]));
  const titleMismatch = Object.entries(titleMismatchCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return { total: entries.length, byReason, byDomain, byDay, titleMismatch };
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

  if (agg.titleMismatch.length > 0) {
    lines.push(`Top title_mismatch URLs (review for keyword tuning):`);
    for (const [url, count] of agg.titleMismatch.slice(0, topN)) {
      lines.push(`  ${count}. ${url}`);
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
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log('Usage: node discard-analytics.mjs [--log <path>] [--reason <pattern>] [--top N] [--since YYYY-MM-DD]');
    console.log('  Analyzes the discard log for filter tuning insights.');
    process.exit(0);
  }

  function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
  }

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
