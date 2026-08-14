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
 *      node detect-reposts.mjs --help
 *
 * Issue #1205 — github.com/santifer/career-ops
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { roleFuzzyMatch, roleTokens, BASELINE_TOKENS } from './role-matcher.mjs';
import { normalizeCompanyName } from './invite-match.mjs';
import { flagValue } from './lib/cli-flags.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const SCAN_HISTORY_PATH = join(CAREER_OPS, 'data/scan-history.tsv');
const DEFAULT_WINDOW_DAYS = 90;

// --- CLI args ---

const USAGE = `Usage:
  node detect-reposts.mjs                       # full JSON repost clusters to stdout
  node detect-reposts.mjs --summary             # human-readable table
  node detect-reposts.mjs --window 60           # override the default 90-day window
  node detect-reposts.mjs --self-test           # run the in-memory test suite
  node detect-reposts.mjs --help                # print this usage block and exit`;

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const windowValue = flagValue(args, '--window');
const windowDays = windowValue !== undefined
  ? (Number.isNaN(parseInt(windowValue, 10)) ? DEFAULT_WINDOW_DAYS : parseInt(windowValue, 10))
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
// Format: url, first_seen, portal, title, company, status, location, ...,
//         normalized_company (trailing col 12, additive — see scan.mjs).
// The normalized_company column is preferred as the clustering key when
// present; rows written before it existed (fewer columns) simply lack it and
// carry `normCompany: ''`, so a consumer normalizes the raw company on the fly.
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
      // Trailing normalized-company key (col 12, 0-indexed 11). '' for older
      // rows that predate the column — companyKey() falls back to normalizing
      // the raw name so old and new rows still cluster on the same key.
      normCompany: (cols[11] || '').trim(),
    });
  }
  return rows;
}

// Canonical clustering key for a row. Prefers the stored normalized-company
// column (written by scan.mjs via normalizeCompanyName) so "Acme Inc." and
// "Acme" cluster without re-deriving anything; falls back to normalizing the
// raw company on the fly for pre-column rows and for row objects built directly
// (e.g. tests). A final fallback to the raw lowercased name preserves the
// pre-normalization behavior for names that fold to empty (e.g. all-CJK or
// all-Cyrillic company names), so those never over-cluster under one '' key.
export function companyKey(row) {
  const stored = typeof row.normCompany === 'string' ? row.normCompany.trim() : '';
  const raw = typeof row.company === 'string' ? row.company.trim() : '';
  return stored || normalizeCompanyName(raw) || raw.toLowerCase();
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

  // Group by normalized company key (prefers the stored normalized-company
  // column, falls back to normalizing the raw name — see companyKey). This is
  // what makes "Acme Inc." and "Acme" a single repost cluster instead of two.
  const byCompany = new Map();
  for (const row of valid) {
    const key = companyKey(row);
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
  const titleGroups = groupRowsByTitle(rows);

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

// Group one company's rows into title groups: a seed row plus every later row
// whose title matches it (exact, case-insensitively, or via roleFuzzyMatch).
//
// The obvious implementation is a nested loop over rows, and that is what this
// used to be. It degrades badly on the shape scan-history.tsv actually grows
// into: the file is append-only with one row per scanned posting, so a large
// employer accumulates thousands of DISTINCT titles. Nothing collapses, every
// pair pays a full roleFuzzyMatch (which re-tokenizes both strings on every
// call), and the run goes quadratic with a very expensive constant (#2383).
//
// Two structures replace the nested loop without changing what it computes:
//
//   1. Rows are bucketed by their lowercased title in one pass. Every row in a
//      bucket matches every other by the exact-title arm of the old condition,
//      so a bucket is atomic: a seed either takes the whole bucket or none of
//      it. Exact reposts (the overwhelming majority of real ones) therefore
//      collapse in O(N) with no fuzzy calls at all, and toLowerCase() runs once
//      per row instead of once per comparison.
//
//   2. Fuzzy matching then runs over DISTINCT buckets only, and even there is
//      gated by an inverted index over non-baseline tokens. roleFuzzyMatch can
//      only return true for two non-identical titles when their deduped token
//      sets share at least two tokens, at least one of which is not a
//      BASELINE_TOKENS word, and their Jaccard ratio is >= 0.6. All three are
//      necessary conditions and all three are checked exactly here, so any
//      bucket pair the gate drops is one roleFuzzyMatch would have rejected
//      anyway. The gate filters calls, never verdicts: every surviving pair is
//      still decided by roleFuzzyMatch itself.
//
// Ordering is preserved exactly, because it is load-bearing downstream. The
// date sort in detectRepostsInGroup uses a comparator that returns 1 (not 0)
// for equal dates, so same-date rows keep their input order only if the group
// arrives in input order; buildRepostCluster also reads clusterRows[0].company.
// Groups are therefore emitted in seed order and their rows re-sorted by
// original array position, which is what the nested loop produced: the seed is
// always the first not-yet-used row, and the inner loop appended the rest in
// array order.
function groupRowsByTitle(rows) {
  // Pass 1 — bucket by lowercased title, remembering each row's original
  // position so groups can be rebuilt in input order later.
  const buckets = [];
  const bucketOfKey = new Map();
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i].title.toLowerCase();
    let idx = bucketOfKey.get(key);
    if (idx === undefined) {
      idx = buckets.length;
      bucketOfKey.set(key, idx);
      // The representative title is the FIRST row's raw title, which is also
      // the row the nested loop would have used as the seed. Other rows in the
      // bucket differ from it only in case, and every decision roleFuzzyMatch
      // makes runs on lowercased text, so the choice cannot change a verdict.
      buckets.push({ title: rows[i].title, rowIdx: [], tokens: null, tokenSet: null });
    }
    buckets[idx].rowIdx.push(i);
  }

  // Single distinct title: the nested loop would have made one group of
  // everything. Skip the index entirely.
  if (buckets.length === 1) return [buckets[0].rowIdx.map(i => rows[i])];

  // Pass 2 — tokenize each distinct title once, then index DISCRIMINATING
  // token -> buckets. Baseline tokens are deliberately left out of the index:
  // words like "engineer" or "platform" appear in most titles at a company, so
  // indexing them would build one enormous posting list that has to be walked
  // for every seed and can never, on its own, justify a match.
  const postings = new Map();
  for (let b = 0; b < buckets.length; b++) {
    const tokens = [...new Set(roleTokens(buckets[b].title))];
    buckets[b].tokens = tokens;
    buckets[b].tokenSet = new Set(tokens);
    for (const token of tokens) {
      if (BASELINE_TOKENS.has(token)) continue;
      let list = postings.get(token);
      if (!list) { list = []; postings.set(token, list); }
      list.push(b);
    }
  }

  // Pass 3 — seed buckets in first-appearance order, gathering matches.
  const used = new Uint8Array(buckets.length);
  const seen = new Uint8Array(buckets.length);
  const candidates = [];
  const groups = [];

  for (let seed = 0; seed < buckets.length; seed++) {
    if (used[seed]) continue;
    used[seed] = 1;
    const members = [seed];
    const seedTokens = buckets[seed].tokens;

    // Collect every bucket sharing at least one discriminating token with the
    // seed. A bucket that shares none cannot match: roleFuzzyMatch requires a
    // non-baseline word in the overlap, so it would return false without ever
    // being asked.
    for (const token of seedTokens) {
      const list = postings.get(token);
      if (!list) continue;
      for (const b of list) {
        if (b === seed || used[b] || seen[b]) continue;
        seen[b] = 1;
        candidates.push(b);
      }
    }

    // Ascending bucket order keeps the candidate walk deterministic. It cannot
    // change the outcome — each candidate is tested against the seed alone —
    // but it makes the traversal reproducible run to run.
    candidates.sort((a, b) => a - b);
    for (const b of candidates) {
      seen[b] = 0;
      // Exact overlap over the deduped token sets, then the exact Jaccard
      // ratio |A n B| / |A u B| with |A u B| = |A| + |B| - |A n B|. Both are
      // the same numbers roleFuzzyMatch computes; failing either is a verdict
      // it would have reached itself.
      const candSet = buckets[b].tokenSet;
      let overlap = 0;
      for (const token of seedTokens) if (candSet.has(token)) overlap += 1;
      if (overlap < 2) continue;
      const union = seedTokens.length + buckets[b].tokens.length - overlap;
      if (overlap / union < 0.6) continue;
      if (roleFuzzyMatch(buckets[seed].title, buckets[b].title)) {
        used[b] = 1;
        members.push(b);
      }
    }
    candidates.length = 0;

    if (members.length === 1) {
      groups.push(buckets[seed].rowIdx.map(i => rows[i]));
      continue;
    }
    // Appended one index at a time rather than spread: a pathological history
    // can put a very large number of rows into a single bucket, and a spread
    // that wide overflows the argument stack.
    const merged = [];
    for (const b of members) for (const i of buckets[b].rowIdx) merged.push(i);
    merged.sort((a, b) => a - b);
    groups.push(merged.map(i => rows[i]));
  }

  return groups;
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
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

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