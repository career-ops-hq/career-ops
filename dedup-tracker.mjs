#!/usr/bin/env node
/**
 * dedup-tracker.mjs — Remove duplicate entries from applications.md
 *
 * Groups by normalized company, then merges only rows whose full role title
 * matches exactly (case- and whitespace-normalized) and whose posting URLs, when
 * both rows carry one, do not conflict. Keeps entry with highest
 * score. If discarded entry had more advanced status, preserves that status,
 * and runs the same status hooks set-status.mjs runs (lib/status-hooks.mjs).
 * Merges notes.
 *
 * Run: node career-ops/dedup-tracker.mjs [--dry-run]
 */

import { readFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { relatePostingLanguageKeys, postingLanguageKey, normalizeUrl } from './url-key.mjs';
import {
  openTrackerTransaction, rebuildRow, normalizeCompany, corporateFormTokensMatch,
  MIN_STEM_CHARS, loadCanonicalStates, resolveCanonicalStateId, resolveCanonicalState,
  stripStatusDecoration,
  resolveWorkspaceRoot, containedReportFile, reportUrlToken,
} from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow, normalizeVia, extractReqNumber, parseScore, normalizeTextKey } from './tracker-parse.mjs';
import { validateFlags } from './lib/cli-flags.mjs';

const CAREER_OPS = getCareerOpsRoot();
// Support both layouts: data/applications.md (boilerplate) and applications.md
// (original). CAREER_OPS_TRACKER lets tests point the script at an isolated
// fixture so the real user tracker is never touched.
const APPS_FILE = resolveTrackerPath(CAREER_OPS);
// Report links resolve against the same root merge-tracker.mjs uses, so the
// two tools read the same report for the same cell.
const REPORTS_ROOT = resolveWorkspaceRoot(APPS_FILE);

// ── CLI args ────────────────────────────────────────────────────────
// Same shape as scan-ats-full.mjs (#1633/PR #1635) and reply-watch.mjs
// (#2743): an unrecognized flag must fail fast, never silently fall through
// to the live-run default and write to the real tracker (#2744). Shared via
// lib/cli-flags.mjs's validateFlags() (#2775).
const KNOWN_FLAGS = ['--dry-run', '--help', '-h'];
const USAGE = `Usage: node dedup-tracker.mjs [--dry-run]`;

const cliArgs = process.argv.slice(2);

validateFlags(cliArgs, KNOWN_FLAGS, USAGE);
const DRY_RUN = process.argv.includes('--dry-run');

// Status advancement order (higher = more advanced in pipeline), keyed by
// states.yml id. Only the ORDER lives here. Every spelling of a state (label,
// alias, localized form) resolves to its id through states.yml, so a new alias
// needs no change in this file.
// Applied > Rejected because an active application outranks a terminal state.
const STATUS_RANK = {
  'skip': 0,
  'discarded': 0,
  'rejected': 1,
  'evaluated': 2,
  'applied': 3,
  'responded': 4,
  'assessment': 5,
  'interview': 6,
  'offer': 7,
  // Hired outranks everything: the accepted-job record must never lose a
  // dedup contest to a repost row.
  'hired': 8,
};

// templates/states.yml is system layer: it lives beside this script, not in the
// data root. It is the only place a status spelling is defined, so without it
// no row can be ranked, and a row ranked 0 is one this script may delete. Stop
// before touching the tracker rather than rank from a partial vocabulary.
//
// A file that parses but does not define one of the ranked states is the same
// hazard, only narrower: every spelling of that state resolves to nothing and
// ranks 0. `states: []` is the limiting case, where that is every row.
const STATES_FILE = join(dirname(fileURLToPath(import.meta.url)), 'templates', 'states.yml');
let CANONICAL_STATES;
try {
  CANONICAL_STATES = loadCanonicalStates(STATES_FILE);
  const defined = new Set(CANONICAL_STATES.map((s) => s.id.toLowerCase()));
  const undefinedIds = Object.keys(STATUS_RANK).filter((id) => !defined.has(id));
  if (undefinedIds.length > 0) throw new Error(`it defines no state with id ${undefinedIds.join(', ')}`);
} catch (err) {
  console.error(`Cannot rank statuses from ${STATES_FILE}: ${err.message}`);
  console.error('dedup-tracker ranks every status through that file and will not guess without it. Nothing was changed.');
  process.exit(1);
}

// Ensure the target tracker directory exists in both normal and fixture mode.
mkdirSync(dirname(APPS_FILE), { recursive: true });

/**
 * Convert a tracker status into its pipeline-advancement rank.
 *
 * Higher ranks represent states that carry more user intent and should not be
 * casually overwritten or removed. Unknown statuses rank as 0 so malformed data
 * is treated conservatively rather than promoted.
 *
 * The cell is resolved through states.yml (resolveCanonicalStateId), which also
 * strips the bold wrappers and trailing dates legacy trackers carry. An alias
 * ("Sent", "Aplicada", "Başvuruldu", "Mülakat"...) therefore ranks as the state
 * the dashboard and set-status.mjs read it as. Ranking one 0 made an Applied
 * row look like a throwaway and let a higher-scored Evaluated sibling delete it.
 *
 * @param {string} status - Raw status cell from applications.md.
 * @returns {number} Numeric rank from STATUS_RANK, or 0 for unknown statuses.
 */
function statusRank(status) {
  const id = resolveCanonicalStateId(status, CANONICAL_STATES);
  return id !== null && Object.hasOwn(STATUS_RANK, id) ? STATUS_RANK[id] : 0;
}

/**
 * Check whether a status represents a real application already in motion.
 *
 * Rows at Applied or later have user-visible history that dedup must preserve
 * unless the duplicate relationship is exact. This guard prevents fuzzy title
 * matches from silently deleting an active application record.
 *
 * @param {string} status - Raw status value from the tracker row.
 * @returns {boolean} True when the row is Applied, Responded, Assessment, Interview, or Offer.
 */
function isAdvancedStatus(status) {
  return statusRank(status) >= STATUS_RANK.applied;
}

/**
 * Extract the report number from a Markdown report link.
 *
 * Tracker report cells are normally written as links like
 * `[123](../reports/123-company-role-date.md)`. The bracketed number is the
 * stable report identity used to distinguish exact duplicates from merely
 * similar fuzzy-title matches.
 *
 * @param {string} reportStr - Raw report cell from applications.md.
 * @returns {number|null} Parsed report number, or null when no link number exists.
 */
function extractReportNum(reportStr) {
  const m = String(reportStr ?? '').match(/\[(\d+)\]/);
  return m ? parseInt(m[1]) : null;
}

/**
 * Determine whether two tracker rows point to the same exact report identity.
 *
 * Exact identity is stronger than fuzzy role matching: it may cluster rows
 * even when an advanced status is present. Matching bracketed report numbers
 * are that evidence. A shared tracker number alone is NOT — duplicate tracker
 * numbers are a known artifact of the old merge bug (verify-pipeline Check 12
 * exists because they never mean the same application), so a bare number match
 * only counts when the rows also carry the same exact role title.
 *
 * @param {object} a - First parsed applications.md row.
 * @param {object} b - Second parsed applications.md row.
 * @returns {boolean} True when both rows represent the same report identity.
 */
function sameReportIdentity(a, b) {
  const reportA = extractReportNum(a.report);
  const reportB = extractReportNum(b.report);
  if (reportA !== null && reportA === reportB) return true;
  return a.num === b.num && normalizeRole(a.role) === normalizeRole(b.role);
}

/**
 * Build a stable key for logging one protected same-title pair only once.
 *
 * The nested dedup loop can encounter a protected pair during cluster building.
 * Sorting the row numbers produces the same key regardless of comparison order,
 * which keeps the warning output readable and avoids repeated noise.
 *
 * @param {object} a - First parsed applications.md row.
 * @param {object} b - Second parsed applications.md row.
 * @returns {string} Stable pair key in ascending tracker-number order.
 */
function pairKey(a, b) {
  return [a.num, b.num].sort((x, y) => x - y).join(':');
}

const protectedTitlePairs = new Set();

/**
 * Normalize a role title into the key used for exact same-opening comparison.
 *
 * Deduplication must only collapse rows that describe the *same* opening, so
 * the comparison is exact on the meaningful title text. Only presentation noise
 * is removed — letter case and whitespace (leading, trailing, and repeated
 * internal spaces). Distinguishing words such as seniority ("Senior") or the
 * team suffix ("Data Infrastructure" vs "Agent Infrastructure") are preserved,
 * so sibling roles at one company are never merged.
 *
 * @param {string} role - Role title from an applications.md row.
 * @returns {string} Lowercase, whitespace-collapsed role key.
 */
function normalizeRole(role) {
  return String(role ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Check whether two tracker rows name two different postings.
 *
 * Only two present-and-different keys are evidence: a blank or placeholder URL
 * yields no key from normalizeUrl() and is UNKNOWN, never a conflict. Two
 * different known languages of one page are two postings (postingUrlRelation
 * in url-key.mjs).
 *
 * @param {object} a - First parsed applications.md row.
 * @param {object} b - Second parsed applications.md row.
 * @returns {boolean} True when both rows carry a URL and the URLs name two postings.
 */
function urlsConflict(a, b) {
  return relatePostingLanguageKeys(cachedLanguageKey(a), cachedLanguageKey(b)) === 'distinct';
}

const reportUrls = new Map();

/**
 * A row's posting URL for the URL guards: its URL cell, else the URL its report
 * names.
 *
 * The default nine-column tracker has no URL cell, so reading the cell alone
 * left both guards blind there: two same-company, same-title rows whose
 * reports name two different openings (`…/jobs/1001` and `…/jobs/2002`) looked
 * identical, and this tool deleted one of them. merge-tracker.mjs already
 * resolved the report's URL in exactly this case — its own comment says
 * "without the report the guards never see two same-titled postings as
 * distinct" — so `node merge-tracker.mjs` kept both rows and `node
 * dedup-tracker.mjs` then removed one. Both now read through
 * reportUrlToken(), with the same path containment. A placeholder such as
 * `N/A` needs no filtering here: postingUrlRelation() gives it no key.
 *
 * Read lazily and memoised: only rows that already share a company reach a
 * guard.
 *
 * @param {object} row - A parsed applications.md row.
 * @returns {string}
 */
function postingUrl(row) {
  if (row.url) return row.url;
  if (!reportUrls.has(row.report)) {
    reportUrls.set(row.report, reportUrlToken(containedReportFile(row.report, REPORTS_ROOT)));
  }
  return reportUrls.get(row.report);
}

// Company identity and posting-language keys are pure per row. The pair loop
// used to rebuild both on every comparison: normalizeTextKey for the company,
// and a URL parse for the posting. A bucket of a few thousand rows made that
// the whole command. Each row keeps one of each. The Maps are this run's
// rows, not a process-wide cache of every string the helpers have seen.
const compareStats = { normalizes: 0, urlKeys: 0, pairs: 0 };
const companyKeys = new Map();
const languageKeys = new Map();

function cachedCompany(entry) {
  let cached = companyKeys.get(entry);
  if (cached) return cached;
  cached = {
    key: normalizeCompany(entry.company),
    tokens: normalizeTextKey(entry.company, ' ').split(' ').filter(Boolean),
  };
  companyKeys.set(entry, cached);
  compareStats.normalizes++;
  return cached;
}

// Built only when a pair actually compares URLs. A row that never meets
// another must not pay for a report read it used to skip.
function cachedLanguageKey(row) {
  if (languageKeys.has(row)) return languageKeys.get(row);
  const key = postingLanguageKey(postingUrl(row));
  languageKeys.set(row, key);
  compareStats.urlKeys++;
  return key;
}

/**
 * Check whether two tracker rows show the same page with a language param on
 * one side only (`…/job/1` vs `…/job/1?lang=en`).
 *
 * Not proof of two postings, so the same report identity still merges them,
 * but not proof of one either: the bare row may be the German version and the
 * other its English one, so a role match alone must not delete either.
 *
 * @param {object} a - First parsed applications.md row.
 * @param {object} b - Second parsed applications.md row.
 * @returns {boolean}
 */
function languageOnOneSide(a, b) {
  return relatePostingLanguageKeys(cachedLanguageKey(a), cachedLanguageKey(b)) === 'one-sided-language';
}

/**
 * Check whether two tracker rows carry two different requisition ids in Notes.
 *
 * The rule merge-tracker.mjs applies as `reqNumDiffers` (#1524): an id missing
 * on either side is UNKNOWN, and only two present-and-different ids are evidence
 * that the rows are distinct openings. An employer posts one title once per city
 * or country, each copy with its own job id, and merge-tracker keeps those rows
 * apart on purpose; deleting one here would silently reverse that decision.
 *
 * @param {object} a - First parsed applications.md row.
 * @param {object} b - Second parsed applications.md row.
 * @returns {boolean} True when both rows carry a recognizable id and they differ.
 */
function reqNumsConflict(a, b) {
  const reqA = extractReqNumber(a.notes);
  const reqB = extractReqNumber(b.notes);
  return Boolean(reqA && reqB && reqA !== reqB);
}

/**
 * Decide whether two same-company tracker rows should be deduplicated.
 *
 * Rows merge only when they describe the same opening: either the exact same
 * report identity (same tracker number or bracketed report number), or an exact
 * role-title match after normalizing case and whitespace. Fuzzy title matching
 * is deliberately NOT used here — it collapsed distinct sibling roles at one
 * company (e.g. "Software Engineer, Data Infrastructure" vs "Senior Software
 * Engineer, Agent Infrastructure"), causing real data loss.
 *
 * When titles match exactly but either row is already Applied or later, dedup
 * still keeps both and warns: deleting an in-flight application would lose its
 * status, report link, and notes unless the rows are the exact same report
 * identity.
 *
 * Two present-and-different posting URLs veto every tier, report identity
 * included (#4562). That is the rule merge-tracker.mjs applies (`urlDiffers`),
 * through the same postingUrlRelation(): two rows cannot be one application while
 * naming two postings. A blank or placeholder URL yields no key and is
 * UNKNOWN, never a conflict, so rows without URLs behave exactly as before.
 * The same page with a language param on one URL only is not a conflict, so
 * report identity still merges it, but it blocks the role-title match.
 * Two present-and-different requisition ids in Notes (`Job id 8157736` vs
 * `Job id 8157738`, the #1524 rule) veto every tier the same way, so one title
 * posted once per city or country keeps one row per posting.
 * Blocking fails toward a duplicate the user can see; merging on a conflict
 * deletes a real application.
 *
 * @param {object} a - First parsed applications.md row.
 * @param {object} b - Second parsed applications.md row.
 * @returns {boolean} True when dedup may cluster the two rows as duplicates.
 */
function roleMatch(a, b) {
  if (urlsConflict(a, b)) return false;
  if (reqNumsConflict(a, b)) return false;

  if (sameReportIdentity(a, b)) return true;
  if (languageOnOneSide(a, b)) return false;
  if (normalizeRole(a.role) !== normalizeRole(b.role)) return false;

  // Exact-title duplicates that have entered the real application pipeline are
  // kept separate. A user may already have applied to one row; deleting it
  // because a higher-scored exact-title sibling exists would lose status,
  // report, and notes. Keep both unless the rows point to the exact same
  // report identity.
  if (isAdvancedStatus(a.status) || isAdvancedStatus(b.status)) {
    const key = pairKey(a, b);
    if (!protectedTitlePairs.has(key)) {
      protectedTitlePairs.add(key);
      console.warn(`⚠️  Keep #${a.num} and #${b.num}: exact-title match but advanced status requires exact report identity`);
    }
    return false;
  }

  return true;
}

/**
 * Parse one Markdown table row from applications.md into a tracker object.
 *
 * Header and separator rows return null because they either lack enough cells
 * or do not have a numeric tracker id. Valid data rows keep the raw line; the
 * caller attaches the physical line index after parsing so later updates and
 * removals never depend on tracker numbers being globally unique.
 *
 * @param {string} line - One line from applications.md.
 * @returns {object|null} Parsed tracker row, or null for non-application lines.
 */
function parseAppLine(line) {
  return parseTrackerRow(line, COLMAP);
}

// Read
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to dedup.');
  process.exit(0);
}

let trackerTransaction = null;
let statusHooks = null;
let localToday = null;
let committed = false;
const releaseClaims = [];
// Kept rows that take over a removed duplicate's more advanced status. Each is
// a real status change for that row number, so it gets the status hooks once
// the write has landed.
const promotions = [];
let COLMAP;
if (!DRY_RUN) {
  try {
    trackerTransaction = await openTrackerTransaction(APPS_FILE);
  } catch (err) {
    console.error(`Cannot acquire tracker lock: ${err.message}`);
    process.exit(1);
  }
  process.once('exit', () => {
    try { trackerTransaction.close(); } catch {}
  });
}
try {
const content = trackerTransaction ? trackerTransaction.read() : readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');
// Header-aware column map (tolerates an inserted Location column, etc.).
COLMAP = resolveColumns(lines);

// Parse all entries
const entries = [];

for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith('|')) continue;
  const app = parseAppLine(lines[i]);
  if (app && app.num > 0) {
    app.lineIdx = i;
    entries.push(app);
  }
}

console.log(`📊 ${entries.length} entries loaded`);

// Group by company+role. Unknown-employer rows (Company `?`, #1596) all
// normalize to the same empty key, so they group by their Via channel instead:
// the same agency re-blasting one listing IS a duplicate, while the same role
// via two different agencies is two real submissions and must never merge.
// The channel key is Unicode-aware (#1603/#2393): this file's own
// normalizeCompany() used to strip everything outside [a-z0-9], so distinct
// non-Latin agency names (リクルート, パーソル, …) all collapsed to the same empty
// key and one of two genuinely separate submissions was DELETED. Both keys are
// now Unicode-aware — normalizeCompany comes from tracker-utils.mjs (#2429), so
// the ordinary company path cannot regress the way this channel path did.
// normalizeVia() is the same key that
// merge-tracker.mjs uses for its cross-channel guard, so the two scripts
// cannot drift on agency identity. An absent Via (empty or `—`) still keys to
// '' and groups with other via-less blind rows, matching merge-tracker, whose
// guard does not reject a pair whose Via cells are both blank.
// The NUL prefix makes this key uncollidable with any real company name.
// It is written as the ESCAPE, never as a raw NUL byte in the source: a raw
// one makes grep classify this file as binary and report NO MATCH for any
// pattern in it, silently, with the same exit code as a genuine absence.
// Identical value at runtime, and the file stays greppable.
// Pinned by tests/source-no-nul-bytes.test.mjs.
const BLIND_KEY = '\u0000blind-via:';

// Pre-filter bucket for the pair-wise company gate below. Rows that could name
// one employer under a different corporate form ("Acme Widgets, APC" vs "Acme
// Widgets") must land together so they are compared at all — normalizeCompany()
// keeps the suffix, so keying groups on it split those pairs into two groups and
// a duplicate re-scan survived every cleanup run (#4421 defect 4).
// The key is the first MIN_STEM_CHARS characters of the normalized name, the
// narrowest width that provably holds every pair sameCompany() accepts: the
// corporate-form rule refuses a stem shorter than that, and an exact match
// shares the whole string. A first-TOKEN key is too narrow — "Foo-Bar" and
// "FooBar" are one employer under normalizeCompany() but tokenize to "foo" and
// "foobar", so tokenizing split two rows that used to group and made them
// unmergeable. Widening is free and narrowing is not: this key only decides
// which pairs get compared, never whether they merge, so an over-wide bucket
// costs a few extra comparisons while an over-narrow one leaves a duplicate
// row in applications.md forever.
function companyBucketKey(entry) {
  return cachedCompany(entry).key.slice(0, MIN_STEM_CHARS);
}

// True when two rows name the same employer: identical under normalizeCompany,
// or one is the other with a corporate-form tail ("Acme Widgets" / "Acme
// Widgets, APC"). corporateFormTokensMatch() is the token half of
// companiesMatchIgnoringCorporateForm(), OR-ed with the exact check because
// that rule returns false for two IDENTICAL names (equal token length) — that
// is the exact tier's business. Deletion is still decided by roleMatch + the
// status-rank guard; this only widens which pairs reach them. Both keys were
// built once per row, above.
function sameCompany(a, b) {
  const left = cachedCompany(a);
  const right = cachedCompany(b);
  return left.key === right.key || corporateFormTokensMatch(left.tokens, right.tokens);
}

const groups = new Map();
for (const entry of entries) {
  // Every row, including a blind `?` that groups by Via instead. The company
  // key is cheap next to the pair loop, and a later sameCompany() hit is a
  // map lookup. Posting keys stay lazy: see cachedLanguageKey().
  cachedCompany(entry);
  const key = String(entry.company).trim() === '?'
    ? BLIND_KEY + normalizeVia(entry.via || '')
    : companyBucketKey(entry);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(entry);
}

// Two blind rows only count as the same listing when their evaluation dates
// sit within the re-post window (mirrors detect-reposts.mjs's 90 days).
// Unparseable dates never cluster — deleting a real application is worse than
// keeping a duplicate.
const BLIND_WINDOW_DAYS = 90;
function withinBlindWindow(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) <= BLIND_WINDOW_DAYS * 86400000;
}

// Find duplicates
let removed = 0;
const linesToRemove = new Set();

for (const [company, companyEntries] of groups) {
  if (companyEntries.length < 2) continue;
  const isBlindGroup = company.startsWith(BLIND_KEY);

  // Within same company, find role matches
  const processed = new Set();
  for (let i = 0; i < companyEntries.length; i++) {
    if (processed.has(i)) continue;
    const cluster = [companyEntries[i]];
    processed.add(i);

    for (let j = i + 1; j < companyEntries.length; j++) {
      if (processed.has(j)) continue;
      compareStats.pairs++;
      // Named rows share a bucket, not an employer: gate the pair on the
      // corporate-form-aware identity so suffix variants merge but two distinct
      // employers sharing a prefix do not. The gate is against EVERY existing
      // cluster member, not just the anchor, because corporate-form matching is
      // not transitive: a bare "Acme" matches both "Acme Solutions" and "Acme
      // Technologies", so anchor-only gating pulled all three into one cluster
      // and deleted a real row even though the two tails never match each other.
      // Requiring the whole cluster to agree leaves "Acme Technologies" in its
      // own cluster, where it survives. Blind rows already share the Via bucket
      // and are gated on the re-post window instead.
      const companyOk = isBlindGroup
        ? withinBlindWindow(companyEntries[i].date, companyEntries[j].date)
        : cluster.every((m) => sameCompany(m, companyEntries[j]));
      // roleMatch() only compares against the seed row, so a seed with no URL
      // would admit two rows naming different postings and one would be
      // deleted. Check the candidate's URL and requisition id against every
      // member already in.
      if (companyOk && roleMatch(companyEntries[i], companyEntries[j])
          && !cluster.some(member => urlsConflict(member, companyEntries[j]) || reqNumsConflict(member, companyEntries[j]))) {
        cluster.push(companyEntries[j]);
        processed.add(j);
      }
    }

    if (cluster.length < 2) continue;

    // Keep the one with highest score
    cluster.sort((a, b) => parseScore(b.score) - parseScore(a.score));
    const keeper = cluster[0];

    // Check if any removed entry has more advanced status
    let bestStatusRank = statusRank(keeper.status);
    let bestStatus = keeper.status;
    for (let k = 1; k < cluster.length; k++) {
      const rank = statusRank(cluster[k].status);
      if (rank > bestStatusRank) {
        bestStatusRank = rank;
        bestStatus = cluster[k].status;
      }
    }

    // Update keeper's status if a removed entry had a more advanced one
    if (bestStatus !== keeper.status) {
      const lineIdx = keeper.lineIdx;
      if (lineIdx !== undefined) {
        // The donor's spelling, without its bold or trailing date. statusRank()
        // strips both before ranking, so a legacy `Applied 2026-01-02` cell can
        // win. Copied verbatim it put a date in the keeper's Status cell, and
        // resolveCanonicalState() then read the promoted status as unknown: the
        // ledger recorded `to: -`, which funnel-velocity replays as retracting
        // the row's last real transition, and the Applied/Interview hooks below
        // never ran.
        const promoted = stripStatusDecoration(bestStatus);
        const parts = lines[lineIdx].split('|').map(s => s.trim());
        parts[COLMAP.status] = promoted;
        lines[lineIdx] = rebuildRow(parts);
        const donorNum = cluster.find(e => e.status === bestStatus)?.num;
        console.log(`  📝 #${keeper.num}: status promoted to "${promoted}" (from #${donorNum})`);
        promotions.push({ keeper, from: keeper.status, to: promoted, donorNum });
      }
    }

    // Merge notes from removed entries
    let mergedNotes = String(keeper.notes || '').trim();
    const originalNotes = mergedNotes;
    for (let k = 1; k < cluster.length; k++) {
      const dupReport = String(cluster[k].report || '').trim();
      const dupReportNum = extractReportNum(dupReport);
      if (dupReportNum !== null && dupReportNum !== extractReportNum(keeper.report)) {
        const reportNote = `also evaluated in ${dupReport}`;
        if (!mergedNotes.includes(dupReport)) {
          mergedNotes = mergedNotes && mergedNotes !== 'N/A' && mergedNotes !== '-' ? `${mergedNotes}; ${reportNote}` : reportNote;
        }
      }
      const dupNotes = String(cluster[k].notes || '').trim();
      if (dupNotes && dupNotes !== 'N/A' && dupNotes !== '❌' && dupNotes !== 'pending' && dupNotes !== '-') {
        if (!mergedNotes.includes(dupNotes)) {
          mergedNotes = mergedNotes && mergedNotes !== 'N/A' && mergedNotes !== '-' ? `${mergedNotes}; ${dupNotes}` : dupNotes;
        }
      }
    }

    if (mergedNotes !== originalNotes) {
      const lineIdx = keeper.lineIdx;
      if (lineIdx !== undefined) {
        const parts = lines[lineIdx].split('|').map(s => s.trim());
        parts[COLMAP.notes] = mergedNotes;
        lines[lineIdx] = rebuildRow(parts);
        keeper.notes = mergedNotes;
        console.log(`  📝 #${keeper.num}: notes merged`);
      }
    }

    // Carry over a posting URL the keeper lacks. The URL cell is the
    // deterministic dedup key (#3516): left on a deleted row it went with it,
    // and the surviving row, often the Applied one whose status was just
    // promoted onto it, fell back to fuzzy company+role matching from then on.
    // Cluster members never name two different postings (urlsConflict vetoes
    // that), so the first URL found is this posting's. The donor's raw cell is
    // copied, so a `[label](href)` link stays a link.
    if (COLMAP.url != null && !normalizeUrl(keeper.url) && keeper.lineIdx !== undefined) {
      const donor = cluster.slice(1).find(e => e.lineIdx !== undefined && normalizeUrl(e.url));
      if (donor) {
        const parts = lines[keeper.lineIdx].split('|').map(s => s.trim());
        parts[COLMAP.url] = lines[donor.lineIdx].split('|').map(s => s.trim())[COLMAP.url];
        lines[keeper.lineIdx] = rebuildRow(parts);
        keeper.url = donor.url;
        console.log(`  🔗 #${keeper.num}: posting URL kept from #${donor.num}`);
      }
    }

    // Remove duplicates
    for (let k = 1; k < cluster.length; k++) {
      const dup = cluster[k];
      const lineIdx = dup.lineIdx;
      if (lineIdx !== undefined) {
        linesToRemove.add(lineIdx);
        removed++;
        console.log(`🗑️  Remove #${dup.num} (${dup.company} — ${dup.role}, ${dup.score}) → kept #${keeper.num} (${keeper.score})`);
      }
    }
  }
}

// Remove lines (in reverse order to preserve indices)
const sortedRemoveIndices = [...linesToRemove].sort((a, b) => b - a);
for (const idx of sortedRemoveIndices) {
  lines.splice(idx, 1);
}

console.log(`\n📊 ${removed} duplicates removed`);

if (!DRY_RUN && removed > 0) {
  const backupPath = `${APPS_FILE}.bak`;
  copyFileSync(APPS_FILE, backupPath);
  // Loaded only when a status moves, so a run that just drops duplicates keeps
  // the import closure it always had.
  if (promotions.length > 0) {
    statusHooks = await import('./lib/status-hooks.mjs');
    ({ localToday } = await import('./lib/local-today.mjs'));
    for (const p of promotions) releaseClaims.push(statusHooks.claimStatusActivity(p.keeper, `dedup-tracker → ${p.to}`));
  }
  trackerTransaction.replace(lines.join('\n'));
  console.log(`✅ Written to ${APPS_FILE} (backup: ${backupPath})`);
  // Inside the lock window, like set-status's own append. The removed row's
  // history stays under its old number; this row says where the kept row's
  // status came from. dedup-tracker did not observe the transition, it found
  // it, so funnel-velocity counts the row but keeps it out of day-math: dated
  // today, it would otherwise read as "applied today".
  // The keeper's own cell can be a dated legacy one too; strip it the same way
  // so a known prior state is not logged as unknown.
  const ledgerState = status => resolveCanonicalState(stripStatusDecoration(status), CANONICAL_STATES) ?? '-';
  for (const p of promotions) {
    statusHooks.appendStatusTransition(APPS_FILE, {
      num: p.keeper.num,
      date: localToday(),
      from: ledgerState(p.from),
      to: ledgerState(p.to),
      source: 'dedup-tracker',
      note: `from #${p.donorNum}`,
    });
  }
  committed = true;
} else if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else {
  console.log('✅ No duplicates found');
}
} finally {
  trackerTransaction?.close();
}

// After the tracker lock is released: both hooks re-read the row this run
// wrote, and the follow-up seeder takes its own lock.
try {
  if (committed) {
    for (const p of promotions) {
      const to = resolveCanonicalState(p.to, CANONICAL_STATES);
      const keeper = { ...p.keeper, status: p.to };
      if (to === 'Applied') await statusHooks.seedFollowupOnApplied(keeper.num, { trackerPath: APPS_FILE });
      if (to === 'Interview') statusHooks.archiveJdOnInterview(keeper, { trackerPath: APPS_FILE });
    }
  }
} finally {
  for (const release of releaseClaims) release();
}

// Off unless a test asks. The counts are how many times the keys were built,
// so a pair loop that recomputes them fails the bound instead of only looking
// slower. Quiet on a normal run: stderr stays what callers already parse.
if (process.env.CAREER_OPS_DEDUP_STATS === '1') {
  console.error(`dedup-stats normalizes=${compareStats.normalizes} urlKeys=${compareStats.urlKeys} pairs=${compareStats.pairs}`);
}
