#!/usr/bin/env node
/**
 * detect-reposts.mjs — Repost Detector for career-ops
 *
 * Reads data/scan-history.tsv, groups rows by company, fuzzy-matches role
 * titles with roleFuzzyMatch from role-matcher.mjs, and flags any
 * company+role that appears 2+ times with different URLs within a 90-day
 * window. Such clusters are almost certainly the same opening being
 * re-listed by the employer — useful for tracking stale pipelines and
 * ghost postings.
 *
 * Only rows with status `added` are considered. Rows with a non-`added`
 * status (`skipped_expired`, `skipped_invalid_url`, `skipped_blocked_host`)
 * describe dead postings, not reposts, and are skipped.
 *
 * Run: node detect-reposts.mjs             (JSON to stdout)
 *      node detect-reposts.mjs --summary   (human-readable table)
 *      node detect-reposts.mjs --window 60 (override 90-day window)
 *      node detect-reposts.mjs --self-test
 *
 * Issue #1205 — github.com/santifer/career-ops
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { roleFuzzyMatch } from './role-matcher.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const SCAN_HISTORY_PATH = join(CAREER_OPS, 'data/scan-history.tsv');
const DEFAULT_WINDOW_DAYS = 90;

// --- CLI args ---
const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const windowIdx = args.indexOf('--window');
const windowDays = windowIdx !== -1 && args[windowIdx + 1] !== undefined
  ? (Number.isNaN(parseInt(args[windowIdx + 1], 10)) ? DEFAULT_WINDOW_DAYS : parseInt(args[windowIdx + 1], 10))
  : DEFAULT_WINDOW_DAYS;

// --- Date helpers ---
function parseDate(dateStr) {
  const iso = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  return date;
}

function daysBetween(d1, d2) {
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

// --- Parse scan-history.tsv ---
// Format: url, first_seen, portal, title, company, status, location
export function parseScanHistory(content) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  const rows = [];
  // Only skip the header when it actually looks like one — older
  // headerless scan-history.tsv files and the seed file in the repo
  // don't have a header row, and slice(1) would silently lose row 0.
  const hasHeader = /^\s*url\s*\t/i.test(lines[0]);
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cols = line.split('\t');
    if (cols.length < 5) continue;
    const [url, firstSeen, portal = '', title = '', company = '', status = 'added', location = ''] = cols;
    const date = parseDate(firstSeen);
    if (!url || !date) continue;
    rows.push({
      url: url.trim(),
      date,
      dateStr: firstSeen.trim(),
      portal: portal.trim(),
      title: title.trim(),
      company: company.trim(),
      status: (status || 'added').trim(),
      location: (location || '').trim(),
    });
  }
  return rows;
}

function loadScanHistory(path = SCAN_HISTORY_PATH) {
  if (!existsSync(path)) return [];
  return parseScanHistory(readFileSync(path, 'utf-8'));
}

// --- Core detection ---
//
// Group rows by company (case-insensitive), then within each company group
// compare all pairs of titles via roleFuzzyMatch. Build clusters of matching
// rows with union-find, then keep a cluster only if (a) it contains 2+ rows,
// (b) at least two rows have different URLs, and (c) the cluster's first_seen
// dates all fall within `windowDays` of each other.
//
// Exported so external tests can call detectReposts() directly on a row list.
export function detectReposts(rows, windowDays = DEFAULT_WINDOW_DAYS) {
  if (!Array.isArray(rows)) return [];
  const valid = rows
    .filter(r =>
      r &&
      typeof r === 'object' &&
      r.status === 'added' &&
      typeof r.url === 'string' && r.url.trim() &&
      r.date instanceof Date &&
      !Number.isNaN(r.date.getTime()) &&
      typeof r.company === 'string' && r.company.trim() &&
      typeof r.title === 'string' && r.title.trim()
    )
    .map(r => ({
      ...r,
      url: r.url.trim(),
      company: r.company.trim(),
      title: r.title.trim(),
    }));
  if (valid.length < 2) return [];

  // Group by company (case-insensitive).
  const byCompany = new Map();
  for (const row of valid) {
    const key = row.company.toLowerCase();
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(row);
  }

  const clusters = [];
  for (const [, groupRows] of byCompany) {
    if (groupRows.length < 2) continue;
    clusters.push(...detectRepostsInGroup(groupRows, windowDays));
  }
  return clusters.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

// Cluster rows in a single company group. Rows are first grouped by title
// (exact or fuzzy match), then each title group is sorted by date and a
// sliding window finds sub-clusters within the windowDays span. This two-phase
// approach prevents non-matching roles (e.g. a Product Manager between two
// Backend Engineer postings) from breaking a valid repost cluster.
function detectRepostsInGroup(rows, windowDays) {
  const titleGroups = [];
  const used = new Set();

  for (const row of rows) {
    if (used.has(row)) continue;
    const group = [row];
    used.add(row);
    for (const other of rows) {
      if (used.has(other)) continue;
      if (row.title.toLowerCase() === other.title.toLowerCase() || roleFuzzyMatch(row.title, other.title)) {
        group.push(other);
        used.add(other);
      }
    }
    titleGroups.push(group);
  }

  const results = [];
  for (const group of titleGroups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    let cluster = [];

    for (const row of sorted) {
      if (cluster.length === 0) {
        cluster = [row];
        continue;
      }
      const first = cluster[0];
      const span = daysBetween(first.date, row.date);
      if (span <= windowDays) {
        cluster.push(row);
      } else {
        // Span exceeds window. Seal the current cluster if it has 2+ rows,
        // then slide the window: drop the oldest row(s) until the new row
        // fits within windowDays of the new cluster start. This preserves
        // valid overlapping repost pairs that would otherwise be dropped
        // (e.g. Jan 1 + Mar 15 sealed, but Mar 15 + Jun 10 also valid).
        if (cluster.length >= 2) {
          const result = buildRepostCluster(cluster, windowDays);
          if (result) results.push(result);
        }
        cluster = cluster.filter(c => daysBetween(c.date, row.date) <= windowDays);
        cluster.push(row);
      }
    }
    if (cluster.length >= 2) {
      const result = buildRepostCluster(cluster, windowDays);
      if (result) results.push(result);
    }
  }
  return results;
}

// A fuzzy-matched cluster becomes a repost cluster only when (a) at least two
// distinct URLs are present (same URL means a dedup hit, not a repost), and
// (b) every row's first_seen date falls within windowDays of every other row.
// We enforce the window by requiring max-min span <= windowDays. Rows sharing
// the same URL are collapsed (only the earliest sighting is kept) so a URL
// seen on multiple scan dates doesn't inflate the repost count.
function buildRepostCluster(clusterRows, windowDays) {
  const byUrl = new Map();
  for (const row of clusterRows) {
    if (!byUrl.has(row.url) || row.date < byUrl.get(row.url).date) {
      byUrl.set(row.url, row);
    }
  }
  const deduped = [...byUrl.values()];

  if (deduped.length < 2) return null;

  const sorted = [...deduped].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = daysBetween(first.date, last.date);
  if (span > windowDays) return null;

  const role = last.title;
  const appearances = sorted.map(r => ({ url: r.url, date: r.dateStr, title: r.title }));

  return {
    company: clusterRows[0].company,
    role,
    repostCount: appearances.length,
    firstSeen: first.dateStr,
    lastSeen: last.dateStr,
    daysSpan: span,
    appearances,
  };
}

// --- Summary mode ---
function printSummary(clusters) {
  console.log(`\n${'='.repeat(78)}`);
  console.log('  Repost Detector — career-ops');
  console.log(`  window: ${windowDays} days | clusters: ${clusters.length}`);
  console.log(`${'='.repeat(78)}\n`);

  if (clusters.length === 0) {
    console.log('  No reposted roles detected.\n');
    return;
  }

  const header =
    '  ' +
    'Company'.padEnd(22) +
    'Role'.padEnd(34) +
    'Reposts'.padEnd(9) +
    'Span'.padEnd(12) +
    'First → Last';
  console.log(header);
  console.log('  ' + '-'.repeat(90));

  for (const c of clusters) {
    const company = (c.company || '').substring(0, 20).padEnd(22);
    const role = (c.role || '').substring(0, 32).padEnd(34);
    const reposts = String(c.repostCount).padEnd(9);
    const span = `${c.daysSpan}d`.padEnd(12);
    const range = `${c.firstSeen} → ${c.lastSeen}`;
    console.log('  ' + company + role + reposts + span + range);
  }
  console.log('');
}

// --- Self-test ---
function runSelfTest() {
  const baseRows = [
    // Genuine repost: same role, different URL, within 90 days.
    { url: 'https://acme.com/jobs/sre-1', date: parseDate('2024-01-10'), dateStr: '2024-01-10', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    { url: 'https://acme.com/jobs/sre-2', date: parseDate('2024-03-01'), dateStr: '2024-03-01', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    // Distinct role at the same company — must NOT be flagged.
    { url: 'https://acme.com/jobs/eng-mgr', date: parseDate('2024-02-15'), dateStr: '2024-02-15', title: 'Engineering Manager Platform', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    // Same role + same URL — dedup hit, NOT a repost.
    { url: 'https://acme.com/jobs/sre-1', date: parseDate('2024-03-20'), dateStr: '2024-03-20', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    // Same role + different URL but outside 90-day window — NOT flagged.
    { url: 'https://acme.com/jobs/sre-3', date: parseDate('2024-12-01'), dateStr: '2024-12-01', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'added', portal: 'greenhouse', location: '' },
    // Skipped (expired) row — must be ignored entirely.
    { url: 'https://acme.com/jobs/sre-4', date: parseDate('2024-02-01'), dateStr: '2024-02-01', title: 'Senior Site Reliability Engineer', company: 'Acme', status: 'skipped_expired', portal: 'greenhouse', location: '' },
  ];

  const clusters = detectReposts(baseRows, DEFAULT_WINDOW_DAYS);

  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  // The genuine repost cluster (sre-1 on 2024-01-10, sre-2 on 2024-03-01).
  const repostClusters = clusters.filter(c =>
    c.company === 'Acme' &&
    /Site Reliability/.test(c.role) &&
    c.appearances.some(a => a.url === 'https://acme.com/jobs/sre-1') &&
    c.appearances.some(a => a.url === 'https://acme.com/jobs/sre-2')
  );
  check(repostClusters.length === 1, 'genuine repost (same role, different URL, within 90d) should be flagged');

  // The "same URL" row (sre-1 on 2024-03-20) must NOT inflate the cluster with
  // itself as a separate appearance — it collapses onto the sre-1 edge.
  if (repostClusters.length === 1) {
    const urls = repostClusters[0].appearances.map(a => a.url);
    check(new Set(urls).size === urls.length, 'appearances should not duplicate the same URL within one cluster');
    check(repostClusters[0].repostCount === 2, 'repostCount should be 2 for the genuine cluster (sre-1, sre-2)');
  }

  // The distinct Engineering Manager role must NOT appear in any cluster.
  const mgrClusters = clusters.filter(c => /Engineering Manager/.test(c.role));
  check(mgrClusters.length === 0, 'distinct role at the same company should NOT be flagged');

  // The outside-window row (sre-3 on 2024-12-01) must NOT be in the 90-day cluster.
  const sre3Clusters = clusters.filter(c => c.appearances.some(a => a.url === 'https://acme.com/jobs/sre-3'));
  check(sre3Clusters.length === 0, 'same role + different URL but outside 90-day window should NOT be flagged');

  // The skipped_expired row must never appear.
  const expiredClusters = clusters.filter(c => c.appearances.some(a => a.url === 'https://acme.com/jobs/sre-4'));
  check(expiredClusters.length === 0, 'rows with skipped_expired status must be ignored');

  // Empty input -> empty output, no crash.
  check(detectReposts([], DEFAULT_WINDOW_DAYS).length === 0, 'empty input should return no clusters');
  check(detectReposts(baseRows.filter(r => r.status !== 'added'), DEFAULT_WINDOW_DAYS).length === 0, 'only-skipped rows should return no clusters');

  console.log(`\n  detect-reposts self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (selfTestMode) {
    runSelfTest();
  }

  const rows = loadScanHistory();
  const clusters = detectReposts(rows, windowDays);

  if (summaryMode) {
    printSummary(clusters);
  } else {
    console.log(JSON.stringify({
      metadata: {
        windowDays,
        totalRows: rows.length,
        clusters: clusters.length,
      },
      clusters,
    }, null, 2));
  }
}