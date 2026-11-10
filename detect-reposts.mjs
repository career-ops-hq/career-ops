#!/usr/bin/env node
/**
 * detect-reposts.mjs — Repost Detector for career-ops
 *
 * Reads data/scan-history.tsv, groups rows by company, groups role titles by
 * title identity (see titleIdentityKey), and flags any company+role that
 * appears 2+ times with different URLs, on 2+ distinct scan dates, within a
 * 90-day window. Such clusters are almost certainly the same opening being
 * re-listed by the employer — useful for tracking stale pipelines and
 * ghost postings.
 *
 * Only rows with status `added` are considered. Rows with a non-`added`
 * status (`skipped_expired`, `skipped_invalid_url`, `skipped_blocked_host`)
 * describe dead postings, not reposts, and are skipped.
 *
 * TWO CONSTRAINTS SEPARATE A REPOST FROM A SIBLING REQUISITION. Both were
 * added after the detector reported `reposts-detected` for three companies
 * that had never reposted anything:
 *
 *   1. MINIMUM SPAN. `first_seen` is when the SCANNER first saw a URL, not
 *      when the employer posted it. A whole company is swept at once, so two
 *      URLs sharing a first_seen date were listed CONCURRENTLY — that is the
 *      signature of parallel openings, and the exact opposite of a repost,
 *      which requires the role to reappear later. A cluster whose members all
 *      come from one sweep therefore spans 0 days and cannot be evidence of
 *      reposting at all. See MIN_REPOST_SPAN_DAYS / --min-span.
 *
 *   2. TITLE IDENTITY, not title similarity. This used to group titles with
 *      roleFuzzyMatch, which merges any two titles clearing a 0.6 Jaccard
 *      ratio. Per-region and per-segment variants of one job land exactly on
 *      that boundary — "Commercial Solutions Engineer - Munich" vs "- Berlin"
 *      share 3 of 5 tokens — so a company that fans one opening out across
 *      cities read as a company reposting. Those are distinct requisitions
 *      hiring distinct headcount, and merging them is a fabricated signal.
 *      Membership now requires the same SET of title words, which still
 *      tolerates word-order and punctuation churn between two listings of one
 *      role but never merges titles that differ by a city, country, language,
 *      segment or seniority word.
 *
 *   3. SAME SOURCE. A repost is the same site listing the role again under a
 *      new URL. scan-history.tsv mixes many sources — the employer's ATS, job
 *      boards, aggregators, alert emails — and one live opening is routinely
 *      picked up by two of them on different days: the ATS scan finds it on
 *      Monday, a job-board copy arrives on Thursday. Grouped across sources,
 *      that reads as a repost even though the opening was listed once and
 *      never changed. Membership therefore also requires the same source host
 *      (see sourceHost); a cross-source sighting is a duplicate, not a repost.
 *
 * ONE CASE THE TITLE RULE CANNOT SETTLE: a multi-employer aggregator. Its board
 * carries many different employers' postings under its own name, so identical
 * titles there are genuinely different jobs and every rule above rests on an
 * assumption that does not hold — same company + same title = same opening.
 * Mark such an entry `aggregator: true` in portals.yml and this skips it
 * entirely (see loadAggregatorCompanies, #2703). It has to be config: measured
 * on a real history, an aggregator's clusters are indistinguishable by shape
 * from legitimate ones.
 *
 * RETENTION. scan-history.tsv is append-only by contract — its rows are the
 * scanner's "seen" ledger, which is why a column may not be reordered
 * (DATA_CONTRACT.md) — but nothing ever removed a row, so an installation that
 * scans for a couple of years re-parses its entire history on every run.
 * --retain-days N drops rows older than N days. Because that changes the
 * ledger, it is opt-in and previewable (--dry-run), and three kinds of row are
 * never dropped regardless of age, because their meaning does not decay:
 * `skipped_invalid_url`, `skipped_blocked_host`, and `cooldown:*` (which names
 * its own expiry). A row whose date cannot be parsed is kept too; a retention
 * pass may not guess. Counts go to stderr, so `--json` on stdout stays
 * parseable.
 *
 * Run: node detect-reposts.mjs             (JSON to stdout)
 *      node detect-reposts.mjs --summary   (human-readable table)
 *      node detect-reposts.mjs --window 60 (override 90-day window)
 *      node detect-reposts.mjs --min-span 7 (override 1-day minimum span)
 *      node detect-reposts.mjs --retain-days 180 (drop rows older than 180 days first)
 *      node detect-reposts.mjs --retain-days 180 --dry-run (report, write nothing)
 *      node detect-reposts.mjs --self-test
 *      node detect-reposts.mjs --help
 *
 * Issue #1205 — github.com/career-ops-hq/career-ops
 */

import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
// Namespace import, not default: js-yaml 5.x drops the default export, and
// #2656 migrated the rest of the repo for exactly that reason.
import { loadYaml } from './lib/yaml-document.mjs';

import { roleFuzzyMatch } from './role-matcher.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { normalizeCompanyName } from './invite-match.mjs';
import { flagValue, validateFlags, safeIntFlag } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { parseDate } from './lib/parse-date.mjs';
import { localToday } from './lib/local-today.mjs';
import { parseScanHistoryLine, scanHistoryLineHasColumn } from './lib/scan-history-columns.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';

const CAREER_OPS = getCareerOpsRoot();
// Same resolution scan.mjs uses, lane override included (scan.mjs's
// SCAN_HISTORY_PATH). This matters more here than it used to: reading the wrong
// lane only misreported, but a retention pass that ignored the override would
// DELETE rows from the default lane while leaving the selected one untouched.
// docs/SCRIPTS.md gives a lane its own CAREER_OPS_SCAN_HISTORY for exactly this
// reason, since the file is the dedup source.
const SCAN_HISTORY_PATH = process.env.CAREER_OPS_SCAN_HISTORY || join(CAREER_OPS, 'data/scan-history.tsv');
// Same resolution scan.mjs uses, so a sandboxed run overrides both together.
const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || join(CAREER_OPS, 'portals.yml');
const DEFAULT_WINDOW_DAYS = 90;

// Smallest first_seen span a cluster may have and still count as a repost.
// 1, not a larger figure: scans run on an irregular cadence (this history has
// gaps of 1 to 13 days), so a genuine repost caught on two consecutive scan
// days spans exactly 1 and must survive. The load-bearing part is that 0 is
// excluded — see constraint 1 in the header. --min-span raises it for anyone
// whose sweeps straddle midnight and land one company on two dates.
const MIN_REPOST_SPAN_DAYS = 1;

// --- CLI args ---

// ADDING A FLAG: add it to BOTH lists below, and to USAGE. validateFlags reads
// these, not the code that consumes the flag, so a new flag wired up everywhere
// else still exits 1 with "unrecognized flag(s)". Appending to a list is also
// the shape git merges most willingly: two branches can each add a flag here and
// merge without a conflict, leaving whichever landed second working in every
// file except this one. That is how --min-span arrived rejected (#2919).
const KNOWN_FLAGS = ['--window', '--min-span', '--summary', '--self-test', '--help', '-h', '--retain-days', '--dry-run'];
const VALUE_FLAGS = ['--window', '--min-span', '--retain-days'];

const USAGE = `Usage:
  node detect-reposts.mjs                       # full JSON repost clusters to stdout
  node detect-reposts.mjs --summary             # human-readable table
  node detect-reposts.mjs --window 60           # override the default 90-day window
  node detect-reposts.mjs --min-span 7          # override the default 1-day minimum span
  node detect-reposts.mjs --retain-days 180     # drop rows older than 180 days first
  node detect-reposts.mjs --retain-days 180 --dry-run  # report what would be dropped
  node detect-reposts.mjs --self-test           # run the in-memory test suite
  node detect-reposts.mjs --help                # print this usage block and exit`;

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
// Both numeric flags read through flagValue, so `--min-span=7` behaves exactly
// like `--min-span 7` — the defect lib/cli-flags.mjs exists to keep the next
// script from rediscovering. The rules and the reasoning now live in
// lib/cli-flags.mjs's safeIntFlag() so process-quality.mjs stops being the
// file that lacks them (#2982); the behaviour here is unchanged, including
// the deliberate fall back to the default rather than an exit.
const intFlag = (flag, fallback) => safeIntFlag(flagValue(args, flag), fallback);
const windowDays = intFlag('--window', DEFAULT_WINDOW_DAYS);
const minSpanDays = intFlag('--min-span', MIN_REPOST_SPAN_DAYS);

// --- Date helpers ---
function daysBetween(d1, d2) {
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

// --- Parse scan-history.tsv ---
// Columns as declared in lib/scan-history-columns.mjs. The normalized_company
// column is preferred as the clustering key when present; rows written before
// it existed simply lack it and carry `normCompany: ''`, so a consumer
// normalizes the raw company on the fly.
export function parseScanHistory(content) {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  const rows = [];
  // Only skip the header when it actually looks like one — older
  // headerless scan-history.tsv files and the seed file in the repo
  // don't have a header row, and slice(1) would silently lose row 0.
  const hasHeader = /^\s*url\s*\t/i.test(lines[0]);
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    if (!scanHistoryLineHasColumn(line, 'company')) continue;
    const row = parseScanHistoryLine(line);
    const date = parseDate(row.first_seen);
    if (!row.url || !date) continue;
    rows.push({
      url: row.url.trim(),
      date,
      dateStr: row.first_seen.trim(),
      portal: row.portal.trim(),
      title: row.title.trim(),
      company: row.company.trim(),
      status: (row.status || 'added').trim(),
      location: row.location.trim(),
      // '' for older rows that predate the normalized_company column —
      // companyKey() falls back to normalizing the raw name so old and new
      // rows still cluster on the same key.
      normCompany: row.normalized_company.trim(),
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

// Companies the user has marked `aggregator: true` in portals.yml, as a Set of
// keys in the SAME space companyKey() produces, so the two can be compared
// directly without re-deriving anything.
//
// Why this needs config rather than a heuristic: a multi-employer board posts
// many different employers' roles under its own name, so identical titles there
// are genuinely different jobs — the one case where title identity is not
// enough. That cannot be inferred from the rows. Measured on a real history:
// the aggregator's clusters and the legitimate ones are indistinguishable by
// shape (both median 2 sightings over 2 dates, 1 row per date); the best
// threshold available removed under half the aggregator clusters and needed a
// magic number to do it. See #2703.
//
// portals.yml is a USER-LAYER file and may be absent (a fresh install, a
// sandboxed test, CI). Absent, unreadable or malformed all degrade to "no
// aggregators", which is exactly the behaviour before this existed — the
// detector must never fail because an optional config is missing.
// Returns a Map of key -> the raw name as written in portals.yml, not a bare
// Set. The key is what the detector matches on; the raw name is what a reader
// has to see. company-history.mjs renders a card for a flagged company even
// when it has no tracker rows and no clusters, and without the original name
// that card would be titled with the normalized key — "joinupch" rather than
// "joinup.ch". Map.has() is identical to Set.has() on the matching path.
// BOTH collections, not just tracked_companies. A multi-employer board is far
// likelier to live under `job_boards` — that is what the section is for — so
// reading only one collection would leave a flag the user can see in their own
// config silently doing nothing.
export function loadAggregatorCompanies(portalsPath = PORTALS_PATH) {
  const found = new Map();
  try {
    if (!existsSync(portalsPath)) return found;
    const doc = loadYaml(readFileSync(portalsPath, 'utf-8'));
    for (const entries of [doc?.tracked_companies, doc?.job_boards]) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || entry.aggregator !== true) continue;
        const raw = typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!raw) continue;
        const key = normalizeCompanyName(raw) || raw.toLowerCase();
        if (key && !found.has(key)) found.set(key, raw);
      }
    }
  } catch {
    // A malformed portals.yml is scan.mjs's problem to report, not this
    // script's problem to crash on.
    return found;
  }
  return found;
}

// Set or Map — both answer .has(key), and every caller only asks that. Keeps a
// hand-built Set working in tests while the loader returns a Map.
export function isKeyLookup(value) {
  return value instanceof Set || value instanceof Map;
}

// Canonical identity of a role TITLE, for deciding whether two listings are the
// same opening. The key is the title's set of words: accent-folded, lowercased,
// stripped of punctuation, deduplicated and sorted.
//
// Set equality is the whole point, and it is chosen against the two
// alternatives on either side of it:
//
//   - Raw string equality is too tight. One opening re-listed months later
//     routinely comes back with the words reordered or repunctuated
//     ("Forward Deployed Engineer - Sweden" -> "Forward Deployed Engineer,
//     Sweden"), and a detector that misses those misses real reposts.
//
//   - roleFuzzyMatch (what this used to use) is too loose. It merges titles
//     that merely overlap enough, which is precisely how a family of sibling
//     requisitions — same job, one per city/country/language/segment/level —
//     collapses into a phantom repost cluster.
//
// Set equality sits exactly between them: every word must be accounted for on
// both sides, so any city, country, language or seniority word present in one
// title and absent from the other splits the two apart, while their ORDER and
// punctuation are free to drift.
//
// No length or stopword filtering, deliberately. roleTokens drops words of 3
// characters or fewer, which would erase the only thing distinguishing "…
// Engineer - UK" from "… Engineer - US" and merge two countries' openings.
//
// Word splitting is script-preserving: it keeps any Unicode letter or number
// and treats everything else as a separator, following the same reasoning as
// #2429 for company names. Restricting to [a-z0-9] would fold every Japanese
// or Cyrillic title to the empty string, and every such title at one company
// would then share a key. A CJK title has no spaces to split on, so it stays a
// single word and matches only its exact self — no over-clustering either way.
//
// A title that folds to nothing (all punctuation) falls back to its lowercased
// raw text, the same guard companyKey uses.
export function titleIdentityKey(title) {
  const raw = String(title ?? '').trim();
  const words = raw
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return raw.toLowerCase();
  return [...new Set(words)].sort().join(' ');
}

function loadScanHistory(path = SCAN_HISTORY_PATH) {
  if (!existsSync(path)) return [];
  return parseScanHistory(readFileSync(path, 'utf-8'));
}

// --- Retention ---
//
// Statuses whose verdict is about the URL rather than the posting, so it cannot
// become outdated: an invalid URL does not become valid because time passed,
// and a blocked host does not become reachable. `cooldown:*` carries its own
// expiry, so age is not the rule that governs it either. Everything else
// describes a sighting, and a sighting older than the user's retention window
// is what --retain-days exists to forget.
export const PRUNE_PROTECTED_SCAN_HISTORY_STATUSES = new Set([
  'skipped_invalid_url',
  'skipped_blocked_host',
]);

/**
 * Decide which scan-history rows a retention pass would drop. Pure: touches no
 * files, exported so the policy can be tested without a temp data root.
 *
 * The result carries two views of the same decision. `lines` is the retained
 * text, convenient for reading. `keepIndexes` is the positions in the `\n`-split
 * source, and it is the one a writer must use: reading the file as text decodes
 * it lossily where it is not valid UTF-8, so a retained line that carried such a
 * byte would be corrupted by writing `lines` back. A caller holding the original
 * bytes rebuilds from `keepIndexes` instead (see rebuildScanHistoryBytes).
 *
 * @param {string} content - Full scan-history.tsv contents.
 * @param {number} retainDays - Drop rows whose first_seen is strictly older than this.
 * @param {{today?: Date|string}} [options] - Comparison day. Defaults to the local calendar day;
 *   a string is read as a calendar day (UTC midnight), which is what lib/local-today.mjs documents.
 * @returns {{lines: string[], keepIndexes: number[], pruned: Array<{url: string, status: string, firstSeen: string, ageDays: number}>, totalRows: number, keptRows: number}}
 */
export function planScanHistoryPrune(content, retainDays, { today = localToday() } = {}) {
  // localToday() answers with a calendar day, and this repo's date arithmetic
  // parses one at UTC midnight rather than at the current instant — the line
  // lib/local-today.mjs draws. A Date is taken as-is so tests can pin an instant.
  const todayDate = today instanceof Date ? today : parseDate(today);
  if (!todayDate) throw new Error(`planScanHistoryPrune: unreadable "today" (${today})`);
  const source = String(content ?? '').split('\n');
  const keepIndexes = [];
  const pruned = [];
  let totalRows = 0;
  let firstContentLine = true;
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];
    if (!line.trim()) { keepIndexes.push(index); continue; }
    // Same header rule parseScanHistory() applies: only the first non-blank
    // line can be the header, and only when it starts with a `url` column.
    if (firstContentLine) {
      firstContentLine = false;
      if (/^\s*url\s*\t/i.test(line)) { keepIndexes.push(index); continue; }
    }
    totalRows += 1;
    let row;
    try {
      row = scanHistoryLineHasColumn(line, 'company') ? parseScanHistoryLine(line) : null;
    } catch {
      row = null;
    }
    // Unreadable rows are kept: a retention pass must not be the thing that
    // silently deletes a row it could not understand.
    if (!row || !String(row.url || '').trim()) { keepIndexes.push(index); continue; }
    const status = String(row.status || 'added').trim();
    if (PRUNE_PROTECTED_SCAN_HISTORY_STATUSES.has(status) || status.startsWith('cooldown:')) {
      keepIndexes.push(index);
      continue;
    }
    const date = parseDate(row.first_seen);
    if (!date) { keepIndexes.push(index); continue; }
    const ageDays = daysBetween(date, todayDate);
    // "Older than N days": a row exactly N days old is still inside the window,
    // so retention N keeps the same span a window of N would.
    if (ageDays > retainDays) {
      pruned.push({ url: String(row.url).trim(), status, firstSeen: String(row.first_seen || '').trim(), ageDays });
      continue;
    }
    keepIndexes.push(index);
  }
  return {
    lines: keepIndexes.map(index => source[index]),
    keepIndexes,
    pruned,
    totalRows,
    keptRows: totalRows - pruned.length,
  };
}

/**
 * Split a buffer on `\n` without decoding it, mirroring `String.prototype.split`
 * exactly: the separator is dropped and a trailing newline still yields a final
 * empty piece. U+000A is a single byte in UTF-8, and no multi-byte sequence
 * contains 0x0A, so the piece count matches the decoded split for any input,
 * valid UTF-8 or not.
 *
 * @param {Buffer} bytes
 * @returns {Buffer[]}
 */
function splitByteLines(bytes) {
  const slices = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a) {
      slices.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }
  slices.push(bytes.subarray(start));
  return slices;
}

/**
 * Reassemble a scan history from the byte slices that survived a retention
 * pass, keeping every retained line exactly as it was on disk.
 *
 * This exists because the decision has to decode a line to read its date and
 * status, and `Buffer.toString('utf-8')` is lossy on invalid input: it writes
 * U+FFFD over the offending bytes. A line the pass decided to keep must come
 * back unchanged anyway, so the writer takes the positions and copies the
 * original slices instead of re-encoding the text it read.
 *
 * @param {Buffer} bytes - The file as read, before any decode.
 * @param {number[]} keepIndexes - Positions from planScanHistoryPrune().
 * @returns {Buffer}
 */
export function rebuildScanHistoryBytes(bytes, keepIndexes) {
  const slices = splitByteLines(bytes);
  const parts = [];
  for (const index of keepIndexes) {
    if (!Number.isInteger(index) || index < 0 || index >= slices.length) {
      throw new Error(`rebuildScanHistoryBytes: line ${index} is outside a ${slices.length}-line file`);
    }
    parts.push(slices[index]);
    // Every piece except the last was followed by a newline in the source, so
    // the separator is reproduced rather than invented: a file with no trailing
    // newline keeps not having one.
    if (index < slices.length - 1) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

/**
 * Apply a retention pass to the real scan history, under the lock every scanner
 * appends through. The whole file is replaced, so reading it outside the lock
 * would drop a scanner's fresh rows; reading it here, inside, is the point.
 *
 * The file is read as bytes and the backup is those bytes verbatim. Decoding is
 * only how the decision reads a row: it is lossy where the file is not valid
 * UTF-8, so the result is rebuilt from the original slices (see
 * rebuildScanHistoryBytes) rather than from the text that was decoded.
 *
 * Counts go to stderr, leaving stdout for the repost report.
 */
async function pruneScanHistory(retainDays, { dryRun = false, path = SCAN_HISTORY_PATH } = {}) {
  if (!existsSync(path)) {
    console.error('scan-history prune: no data/scan-history.tsv — nothing to prune.');
    return;
  }
  await withPipelineLock(path, () => {
    const bytes = readFileSync(path);
    const plan = planScanHistoryPrune(bytes.toString('utf-8'), retainDays);
    const summary = `scan-history prune: ${plan.totalRows} row(s) read, ${plan.pruned.length} older than ${retainDays} day(s), ${plan.keptRows} kept`;
    if (plan.pruned.length === 0) {
      console.error(`${summary} (nothing to prune)`);
      return;
    }
    if (dryRun) {
      console.error(`${summary} (dry-run — no changes written)`);
      return;
    }
    const backupPath = `${path}.bak`;
    writeFileSync(backupPath, bytes);
    writeFileAtomic(path, rebuildScanHistoryBytes(bytes, plan.keepIndexes));
    console.error(`${summary} (backup: ${backupPath})`);
  });
}

// --- Core detection ---
//
// Group rows by company (case-insensitive), then within each company group by
// title identity (titleIdentityKey). Keep a cluster only if (a) it contains 2+
// rows, (b) at least two rows have different URLs, (c) the cluster's first_seen
// dates all fall within `windowDays` of each other, and (d) those dates span at
// least `minSpanDays` — see constraint 1 in the header.
//
// `aggregators` is an optional Set of company keys (see loadAggregatorCompanies)
// whose boards carry many employers' postings. Those companies are skipped
// entirely: an identical title there is a different employer's job, so the one
// assumption every other rule rests on — same company + same title means same
// opening — does not hold. Omitted or empty, nothing is skipped.
//
// The parameter is passed in rather than read from disk here so this stays a
// pure function of its arguments, which is what lets the tests drive it.
//
// Exported so external tests can call detectReposts() directly on a row list.
export function detectReposts(rows, windowDays = DEFAULT_WINDOW_DAYS, minSpan = MIN_REPOST_SPAN_DAYS, aggregators = null) {
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

  const skip = isKeyLookup(aggregators) ? aggregators : null;

  const clusters = [];
  for (const [key, groupRows] of byCompany) {
    if (groupRows.length < 2) continue;
    if (skip && skip.has(key)) continue;
    clusters.push(...detectRepostsInGroup(groupRows, windowDays, minSpan));
  }
  return clusters.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

// Cluster rows in a single company group. Rows are first grouped by title
// identity, then each title group is sorted by date and a sliding window finds
// sub-clusters within the windowDays span. This two-phase approach prevents
// non-matching roles (e.g. a Product Manager between two Backend Engineer
// postings) from breaking a valid repost cluster.
function detectRepostsInGroup(rows, windowDays, minSpan = MIN_REPOST_SPAN_DAYS) {
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
          const result = buildRepostCluster(cluster, windowDays, minSpan);
          if (result) results.push(result);
        }
        cluster = cluster.filter(c => daysBetween(c.date, row.date) <= windowDays);
        cluster.push(row);
      }
    }
    if (cluster.length >= 2) {
      const result = buildRepostCluster(cluster, windowDays, minSpan);
      if (result) results.push(result);
    }
  }
  return results;
}

// The site a posting URL belongs to, for constraint 3 of the header: hostname,
// lowercased, without `www.` or a two-letter regional prefix (`de.linkedin.com`
// and `www.linkedin.com` are one site; a role re-listed across them is still a
// repost). Unparseable URLs keep the raw string, so they never merge with
// anything but themselves.
export function sourceHost(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return String(url); }
  const labels = host.split('.');
  if (labels.length > 2 && (labels[0] === 'www' || /^[a-z]{2}$/.test(labels[0]))) labels.shift();
  return labels.join('.');
}

// Group one company's rows into title groups: all rows sharing a
// titleIdentityKey and a sourceHost land in one group.
//
// This is a single O(N) bucketing pass. It replaced a nested loop that compared
// every pair of titles with roleFuzzyMatch, and then an inverted token index
// built to make that nested loop affordable (#2383) on the shape
// scan-history.tsv actually grows into — the file is append-only with one row
// per scanned posting, so a large employer accumulates thousands of DISTINCT
// titles and nothing collapses. Deciding membership by an equality key instead
// of by pairwise similarity removes the quadratic term outright, so the index
// that existed to prune it has nothing left to prune.
//
// The correctness reason for the change, rather than the speed one, is in
// constraint 2 of the header: pairwise similarity merged sibling requisitions.
//
// Ordering is load-bearing downstream and is preserved. The date sort in
// detectRepostsInGroup uses a comparator returning 1 (not 0) for equal dates,
// so same-date rows keep their input order only if the group arrives in input
// order; buildRepostCluster also reads clusterRows[0].company. Groups are
// therefore emitted in first-appearance order of their key, and rows within a
// group stay in input order.
function groupRowsByTitle(rows) {
  const groups = [];
  const groupOfKey = new Map();
  for (const row of rows) {
    const key = `${titleIdentityKey(row.title)}\u0000${sourceHost(row.url)}`;
    let idx = groupOfKey.get(key);
    if (idx === undefined) {
      idx = groups.length;
      groupOfKey.set(key, idx);
      groups.push([]);
    }
    groups[idx].push(row);
  }
  return groups;
}

// A title-identity cluster becomes a repost cluster only when (a) at least two
// distinct URLs are present (same URL means a dedup hit, not a repost), (b)
// every row's first_seen date falls within windowDays of every other row, and
// (c) the span between the earliest and latest first_seen is at least
// minSpan days. We enforce the window by requiring max-min span <= windowDays.
// Rows sharing the same URL are collapsed (only the earliest sighting is kept)
// so a URL seen on multiple scan dates doesn't inflate the repost count.
//
// (c) is what keeps concurrent openings out. Two URLs first seen on the same
// date were listed side by side in one sweep — that is a company running two
// requisitions at once, which is the opposite of re-listing one requisition
// later, and it is the single largest source of false positives in a real
// history (165 of 252 clusters when it was missing). See header constraint 1.
function buildRepostCluster(clusterRows, windowDays, minSpan = MIN_REPOST_SPAN_DAYS) {
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
  if (span < minSpan) return null;

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
function printSummary(clusters, aggregatorCount = 0) {
  console.log(`\n${'='.repeat(78)}`);
  console.log('  Repost Detector — career-ops');
  console.log(`  window: ${windowDays} days | min span: ${minSpanDays} day(s) | aggregators skipped: ${aggregatorCount} | clusters: ${clusters.length}`);
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

  // --- Regression fixtures for the three phantom-repost shapes found in a
  // real scan-history. Company names and URLs are synthetic; only the SHAPE is
  // reproduced, which is the part that matters. ---
  const scanRow = (url, dateStr, title, company) =>
    ({ url, date: parseDate(dateStr), dateStr, title, company, status: 'added', portal: 'ashby-full', location: '' });

  // Shape 1 — one sweep, sibling per-city variants of one role. Both
  // constraints reject it independently, so assert each one on its own too.
  const perCity = [
    scanRow('https://jobs.example.com/acme/a', '2026-01-10', 'Commercial Solutions Engineer - Munich', 'Acme'),
    scanRow('https://jobs.example.com/acme/b', '2026-01-10', 'Commercial Solutions Engineer - Berlin', 'Acme'),
    scanRow('https://jobs.example.com/acme/c', '2026-01-10', 'Commercial Solutions Engineer - EMEA', 'Acme'),
  ];
  check(detectReposts(perCity, DEFAULT_WINDOW_DAYS).length === 0, 'per-city variants seen in one sweep are not reposts');
  check(
    detectReposts(perCity, DEFAULT_WINDOW_DAYS, 0).length === 0,
    'per-city variants are rejected on title identity even with the span floor disabled',
  );

  // Shape 2 — the exact same title twice in one sweep: two concurrent
  // requisitions. Only the span floor can reject this one; title identity
  // holds, which is precisely why the floor is needed as well.
  const sameSweep = [
    scanRow('https://jobs.example.com/globex/r1', '2026-01-10', 'Regional Sales Engineer (Remote, CHE)', 'Globex'),
    scanRow('https://jobs.example.com/globex/r2', '2026-01-10', 'Regional Sales Engineer (Remote, CHE)', 'Globex'),
  ];
  check(detectReposts(sameSweep, DEFAULT_WINDOW_DAYS).length === 0, 'two concurrent requisitions in one sweep are not a repost');
  check(
    detectReposts(sameSweep, DEFAULT_WINDOW_DAYS, 0).length === 1,
    'the same-sweep fixture is rejected by the span floor specifically (it survives with the floor disabled)',
  );

  // Shape 3 — two countries' requisitions in one sweep, titles differing only
  // by a trailing country. This is exactly what roleFuzzyMatch used to merge.
  const perCountry = [
    scanRow('https://jobs.example.com/initech/1', '2026-01-10', 'Channel Account Manager', 'Initech'),
    scanRow('https://jobs.example.com/initech/2', '2026-01-10', 'Channel Account Manager - Spain', 'Initech'),
  ];
  check(detectReposts(perCountry, DEFAULT_WINDOW_DAYS).length === 0, 'two countries\' requisitions are not a repost');

  // Shape 4 — one opening picked up by two sources on different days: the
  // employer's ATS first, a job-board copy later. Same company, same title,
  // different URLs, a real span — and still one listing, not a repost.
  const crossSource = [
    scanRow('https://jobs.ashbyhq.com/hooli/1', '2026-01-10', 'Senior Product Manager', 'Hooli'),
    scanRow('https://www.jobboard.example/jobs/hooli-senior-pm-77', '2026-01-14', 'Senior Product Manager', 'Hooli'),
  ];
  check(detectReposts(crossSource, DEFAULT_WINDOW_DAYS).length === 0, 'one opening seen on two sources is not a repost');
  check(
    detectReposts([...crossSource, scanRow('https://jobs.ashbyhq.com/hooli/2', '2026-02-20', 'Senior Product Manager', 'Hooli')], DEFAULT_WINDOW_DAYS).length === 1,
    'the same source re-listing the role under a new URL is still a repost',
  );
  check(sourceHost('https://de.linkedin.com/jobs/view/1') === sourceHost('https://www.linkedin.com/jobs/view/2'), 'regional subdomains are one source');
  check(
    detectReposts(perCountry, DEFAULT_WINDOW_DAYS, 0).length === 0,
    'a trailing country word splits the titles even with the span floor disabled',
  );

  // --- The positive control these constraints must not break: the same role,
  // different URL, seen on two different scan dates. ---
  const genuine = [
    scanRow('https://jobs.example.com/umbrella/4066969101', '2026-01-08', 'Senior Customer Success Manager', 'Umbrella'),
    scanRow('https://jobs.example.com/umbrella/4948414101', '2026-02-11', 'Senior Customer Success Manager', 'Umbrella'),
  ];
  const genuineClusters = detectReposts(genuine, DEFAULT_WINDOW_DAYS);
  check(genuineClusters.length === 1, 'genuine repost across two scan dates is still flagged');
  check(genuineClusters[0]?.daysSpan === 34, 'genuine repost keeps its real 34-day span');

  // --- Aggregator skip (#2703): the one case title identity cannot settle,
  // because an identical title on a multi-employer board is a different
  // employer's job. Same fixture, flagged vs not, so the skip is the only
  // variable. ---
  check(
    detectReposts(genuine, DEFAULT_WINDOW_DAYS, MIN_REPOST_SPAN_DAYS, new Set(['umbrella'])).length === 0,
    'a company marked aggregator produces no clusters',
  );
  check(
    detectReposts(genuine, DEFAULT_WINDOW_DAYS, MIN_REPOST_SPAN_DAYS, new Set(['someoneelse'])).length === 1,
    'flagging a DIFFERENT company leaves this one detected (the skip is keyed, not global)',
  );
  check(
    detectReposts(genuine, DEFAULT_WINDOW_DAYS, MIN_REPOST_SPAN_DAYS, new Set()).length === 1,
    'an empty aggregator set changes nothing',
  );
  check(
    detectReposts(genuine, DEFAULT_WINDOW_DAYS, MIN_REPOST_SPAN_DAYS, null).length === 1,
    'a null aggregator set changes nothing (pre-#2703 behaviour)',
  );
  // The key space must match companyKey's, or the Set silently never matches —
  // a skip that quietly does nothing is worse than no skip at all.
  check(
    detectReposts(
      [
        scanRow('https://jobs.example.com/acme/1', '2026-01-08', 'Data Engineer', 'Acme Inc.'),
        scanRow('https://jobs.example.com/acme/2', '2026-02-11', 'Data Engineer', 'ACME, INC'),
      ],
      DEFAULT_WINDOW_DAYS,
      MIN_REPOST_SPAN_DAYS,
      new Set([normalizeCompanyName('Acme Inc.')]),
    ).length === 0,
    'the aggregator key is normalized the same way companyKey normalizes rows',
  );

  // A repost re-listed with the words reordered/repunctuated is still one role.
  const reworded = [
    scanRow('https://jobs.example.com/hooli/a', '2026-01-28', 'Forward Deployed Engineer - Sweden', 'Hooli'),
    scanRow('https://jobs.example.com/hooli/b', '2026-02-11', 'Forward Deployed Engineer, Sweden', 'Hooli'),
  ];
  check(detectReposts(reworded, DEFAULT_WINDOW_DAYS).length === 1, 'punctuation-only retitling still counts as the same role');

  // A same-day sighting must not be able to drag a real repost pair's span down
  // to 0 and suppress it.
  const mixedSpan = [
    ...genuine,
    scanRow('https://jobs.example.com/umbrella/4948414102', '2026-02-11', 'Senior Customer Success Manager', 'Umbrella'),
  ];
  const mixedClusters = detectReposts(mixedSpan, DEFAULT_WINDOW_DAYS);
  check(mixedClusters.length === 1 && mixedClusters[0].repostCount === 3, 'a same-day third sighting joins the real cluster rather than suppressing it');

  // titleIdentityKey contract.
  check(
    titleIdentityKey('Forward Deployed Engineer - Sweden') === titleIdentityKey('Forward Deployed Engineer, Sweden'),
    'titleIdentityKey ignores punctuation',
  );
  check(
    titleIdentityKey('Senior Backend Engineer Payments') === titleIdentityKey('Backend Engineer Payments Senior'),
    'titleIdentityKey ignores word order',
  );
  check(
    titleIdentityKey('Solutions Engineer - UK') !== titleIdentityKey('Solutions Engineer - US'),
    'titleIdentityKey keeps short country words that roleTokens would have dropped',
  );
  check(
    titleIdentityKey('Operations Manager') !== titleIdentityKey('Senior Operations Manager'),
    'titleIdentityKey keeps seniority words distinct',
  );
  // --- loadAggregatorCompanies against REAL yaml written to disk, not a
  // hand-built Set: the parse and the key derivation are the parts that can
  // silently produce an empty Set, and an empty Set looks exactly like
  // "no aggregators configured". ---
  {
    // One private directory rather than predictable names in the shared temp
    // dir: `co-aggr-<pid>.yml` can be pre-created as a symlink by anyone else
    // on the machine, and writeFileSync follows it. mkdtempSync gives a path
    // nobody can guess ahead of time, and one rmSync cleans all of it up.
    const fixtures = mkdtempSync(join(tmpdir(), 'co-aggr-'));
    try {
      const tmp = join(fixtures, 'portals.yml');
      writeFileSync(tmp, [
        'tracked_companies:',
        '  - name: Plain Co',
        '    provider: lever',
        '  - name: Board One',
        '    provider: lever',
        '    aggregator: true',
        '  - name: Board Two Inc.',
        '    aggregator: true',
        '  - name: Explicitly Not',
        '    aggregator: false',
        '  - name: Stringy',
        '    aggregator: "true"',
        'job_boards:',
        '  - name: Board Under Boards',
        '    aggregator: true',
        '',
      ].join('\n'), 'utf-8');
      const keys = loadAggregatorCompanies(tmp);
      check(keys.has(normalizeCompanyName('Board One')), 'aggregator: true is picked up');
      check(keys.has(normalizeCompanyName('Board Two Inc.')), 'a suffixed name is normalized into the companyKey space');
      // A multi-employer board is likelier to be configured here than under
      // tracked_companies, and both entries portals.example.yml flags are.
      check(keys.has(normalizeCompanyName('Board Under Boards')), 'a flagged entry under job_boards counts too');
      check(!keys.has(normalizeCompanyName('Plain Co')), 'an entry without the flag is not an aggregator');
      check(!keys.has(normalizeCompanyName('Explicitly Not')), 'aggregator: false is not an aggregator');
      // YAML would give the string "true" here. Accepting it would make the
      // flag's meaning depend on quoting; rejecting it keeps `=== true` honest.
      check(!keys.has(normalizeCompanyName('Stringy')), 'a quoted "true" is not the boolean true');
      check(keys.size === 3, 'exactly the three flagged entries are returned');

      check(loadAggregatorCompanies(join(fixtures, 'does-not-exist.yml')).size === 0, 'a missing portals.yml yields no aggregators, no crash');

      const bad = join(fixtures, 'malformed.yml');
      writeFileSync(bad, 'tracked_companies: [unclosed\n', 'utf-8');
      check(loadAggregatorCompanies(bad).size === 0, 'a malformed portals.yml yields no aggregators, no crash');

      const unflagged = join(fixtures, 'unflagged.yml');
      writeFileSync(unflagged, 'job_boards:\n  - name: Somewhere\n', 'utf-8');
      check(loadAggregatorCompanies(unflagged).size === 0, 'a config whose entries carry no flag yields no aggregators');
    } finally {
      rmSync(fixtures, { recursive: true, force: true });
    }
  }

  check(titleIdentityKey('—') === '—', 'a title that folds to nothing falls back to its raw text rather than an empty key');
  check(
    titleIdentityKey('シニアエンジニア') !== titleIdentityKey('データアナリスト'),
    'non-Latin titles keep distinct keys instead of both folding to empty (#2429 reasoning)',
  );
  check(
    titleIdentityKey('Ingénieur Données') === titleIdentityKey('Ingenieur Donnees'),
    'titleIdentityKey folds accents, so a re-listing that drops them is still the same role',
  );

  console.log(`\n  detect-reposts self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (isMainModule(import.meta.url)) {
  // Replaces a bare --help check that never looked at the other flags, so a
  // mistyped --window was ignored and the scan silently used the 90-day
  // default instead of the window that was asked for (#2919). validateFlags
  // also runs the unrecognized-flag check BEFORE --help, so `--help --bogus`
  // errors rather than exiting 0 unread.
  //
  // Inside the main-module guard, not at import time: company-history.mjs
  // imports detectReposts/parseScanHistory from here, so a top-level check
  // would judge the IMPORTER's argv.
  // requireOperand: without it, `--window --summary` reads --summary as the
  // window value; flagValue() has no adjacency check, parseInt('--summary')
  // is NaN, and windowDays silently falls back to DEFAULT_WINDOW_DAYS at exit
  // 0 instead of reporting the malformed flag (#3087). Nothing more specific
  // to say than the shared message.
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  if (selfTestMode) {
    runSelfTest();
  }

  // --retain-days is validated by hand rather than through safeIntFlag: that
  // helper falls back to a default on an unparseable value, which is right for
  // a display window and wrong for a pass that deletes rows. A typo must stop
  // the run, not silently pick a retention the user never asked for.
  const retainRaw = flagValue(args, '--retain-days');
  let retainDays = null;
  if (retainRaw !== undefined) {
    const parsed = Number(retainRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      console.error(`Invalid --retain-days "${retainRaw}". Use a positive whole number of days, e.g. --retain-days 180.`);
      process.exit(1);
    }
    retainDays = parsed;
  }
  const dryRun = args.includes('--dry-run');
  if (dryRun && retainDays === null) {
    console.error('--dry-run needs --retain-days N; it previews a retention pass and nothing else.');
    process.exit(1);
  }
  // Before the read below, so the report describes the retained file rather
  // than clusters the pass just removed.
  if (retainDays !== null) await pruneScanHistory(retainDays, { dryRun });

  const rows = loadScanHistory();
  const aggregators = loadAggregatorCompanies();
  const clusters = detectReposts(rows, windowDays, minSpanDays, aggregators);

  if (summaryMode) {
    printSummary(clusters, aggregators.size);
  } else {
    console.log(JSON.stringify({
      metadata: {
        windowDays,
        minSpanDays,
        totalRows: rows.length,
        // Reported so a reader can tell "no aggregators configured" from
        // "aggregators configured and skipped" — otherwise a mis-keyed flag
        // that silently matches nothing looks identical to a working one.
        aggregatorCompanies: aggregators.size,
        clusters: clusters.length,
      },
      clusters,
    }, null, 2));
  }
}
