#!/usr/bin/env node
/**
 * dedup-tracker.mjs — Remove duplicate entries from applications.md
 *
 * Groups by normalized company + fuzzy role match.
 * Keeps entry with highest score. If discarded entry had more advanced status,
 * preserves that status. Merges notes.
 *
 * Run: node career-ops/dedup-tracker.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { roleFuzzyMatch } from './role-matcher.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
// Support both layouts: data/applications.md (boilerplate) and applications.md
// (original). CAREER_OPS_TRACKER lets tests point the script at an isolated
// fixture so the real user tracker is never touched.
const APPS_FILE = process.env.CAREER_OPS_TRACKER
  ? process.env.CAREER_OPS_TRACKER
  : existsSync(join(CAREER_OPS, 'data/applications.md'))
    ? join(CAREER_OPS, 'data/applications.md')
    : join(CAREER_OPS, 'applications.md');
const DRY_RUN = process.argv.includes('--dry-run');

// Ensure the target tracker directory exists in both normal and fixture mode.
mkdirSync(dirname(APPS_FILE), { recursive: true });

// Status advancement order (higher = more advanced in pipeline)
// Aplicado > Rechazado because active application > terminal state
const STATUS_RANK = {
  // English canonicals (states.yml labels)
  'skip': 0,
  'discarded': 0,
  'rejected': 1,
  'evaluated': 2,
  'applied': 3,
  'responded': 4,
  'interview': 5,
  'offer': 6,
  // Spanish aliases — kept for backwards compat with existing tracker data
  'no_aplicar': 0,
  'no aplicar': 0,
  'descartado': 0,
  'descartada': 0,
  'rechazado': 1,  // Terminal — below active states
  'rechazada': 1,
  'evaluada': 2,
  'aplicado': 3,
  'respondido': 4,
  'entrevista': 5,
  'oferta': 6,
};

/**
 * Normalize a company name into the grouping key used by deduplication.
 *
 * The tracker may contain punctuation, parenthetical branding, or spacing
 * differences for the same employer. This function removes those presentation
 * differences while keeping the alphanumeric company identity that determines
 * which rows are safe to compare for duplicate roles.
 *
 * @param {string} name - Company name from an applications.md row.
 * @returns {string} Lowercase company key used for same-company grouping.
 */
function normalizeCompany(name) {
  return name.toLowerCase()
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

/**
 * Normalize tracker status text before ranking or comparing it.
 *
 * Existing trackers can contain bold Markdown wrappers or legacy dates appended
 * to the status cell. Dedup needs the canonical status word only, in lowercase,
 * so advanced-state protection works the same for old and new tracker rows.
 *
 * @param {string} status - Raw status cell from applications.md.
 * @returns {string} Lowercase status key with Markdown/date noise removed.
 */
function normalizeStatus(status) {
  return String(status ?? '')
    .replace(/\*\*/g, '')
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '')
    .trim()
    .toLowerCase();
}

/**
 * Convert a tracker status into its pipeline-advancement rank.
 *
 * Higher ranks represent states that carry more user intent and should not be
 * casually overwritten or removed. Unknown statuses rank as 0 so malformed data
 * is treated conservatively rather than promoted.
 *
 * @param {string} status - Raw or normalized status value.
 * @returns {number} Numeric rank from STATUS_RANK, or 0 for unknown statuses.
 */
function statusRank(status) {
  return STATUS_RANK[normalizeStatus(status)] || 0;
}

/**
 * Check whether a status represents a real application already in motion.
 *
 * Rows at Applied or later have user-visible history that dedup must preserve
 * unless the duplicate relationship is exact. This guard prevents fuzzy title
 * matches from silently deleting an active application record.
 *
 * @param {string} status - Raw status value from the tracker row.
 * @returns {boolean} True when the row is Applied, Responded, Interview, or Offer.
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
 * Exact identity is stronger than fuzzy role matching. If two rows share the
 * same tracker number or bracketed report number, dedup may treat them as the
 * same record even when an advanced status is present.
 *
 * @param {object} a - First parsed applications.md row.
 * @param {object} b - Second parsed applications.md row.
 * @returns {boolean} True when both rows represent the same report identity.
 */
function sameReportIdentity(a, b) {
  if (a.num === b.num) return true;
  const reportA = extractReportNum(a.report);
  const reportB = extractReportNum(b.report);
  return reportA !== null && reportA === reportB;
}

/**
 * Build a stable key for logging one protected fuzzy pair only once.
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

const protectedFuzzyPairs = new Set();

/**
 * Decide whether two same-company tracker rows should be deduplicated.
 *
 * The function first accepts exact report identity, then applies the shared
 * fuzzy role matcher. If either row is already Applied or later, fuzzy matching
 * alone is not enough; dedup keeps both rows and warns because deleting one
 * would lose application status, report link, and notes for a potentially
 * distinct opening.
 *
 * @param {object} a - First parsed applications.md row.
 * @param {object} b - Second parsed applications.md row.
 * @returns {boolean} True when dedup may cluster the two rows as duplicates.
 */
function roleMatch(a, b) {
  if (sameReportIdentity(a, b)) return true;
  if (!roleFuzzyMatch(a.role, b.role)) return false;

  // Fuzzy title matches are intentionally conservative once either row has
  // entered the real application pipeline. A user may already have applied to
  // one sibling role, so deleting that row because a higher-scored sibling has
  // similar wording would lose status, report, and notes. Keep both unless the
  // rows point to the exact same report identity.
  if (isAdvancedStatus(a.status) || isAdvancedStatus(b.status)) {
    const key = pairKey(a, b);
    if (!protectedFuzzyPairs.has(key)) {
      protectedFuzzyPairs.add(key);
      console.warn(`⚠️  Keep #${a.num} and #${b.num}: fuzzy role match but advanced status requires exact report identity`);
    }
    return false;
  }

  return true;
}

/**
 * Parse a tracker score cell into a numeric value for keeper selection.
 *
 * Scores may include Markdown bolding or a `/5` suffix. Dedup only needs the
 * numeric part so it can keep the highest-scored duplicate row in a cluster.
 *
 * @param {string} s - Raw score cell such as `4.3/5` or `**4.3/5**`.
 * @returns {number} Parsed score, or 0 when no number is present.
 */
function parseScore(s) {
  const m = s.replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
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
/**
 * Rebuild a markdown table row from the cells produced by `line.split('|')`.
 *
 * `split('|')` yields a leading empty element (before the opening `|`) and,
 * when the row ends with a trailing `|`, a trailing empty element too. The old
 * `slice(1, -1)` assumed that trailing empty always existed — but a row written
 * without a trailing pipe (`| 5 | … | note`, still a valid 9-cell row) has its
 * real last cell (the notes) at the end, so `slice(1, -1)` silently dropped it.
 * Here we drop the leading empty and only drop a trailing element when it is
 * actually empty, preserving every real cell regardless of trailing-pipe style
 * (and tolerating extra columns like a custom Location).
 *
 * @param {string[]} parts - Trimmed cells from `line.split('|').map(s => s.trim())`.
 * @returns {string} The rebuilt `| a | b | … |` row.
 */
function rebuildRow(parts) {
  const cells = parts.slice(1);
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return '| ' + cells.join(' | ') + ' |';
}

function parseAppLine(line) {
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 9) return null;
  const num = parseInt(parts[1]);
  if (isNaN(num)) return null;
  return {
    num,
    date: parts[2],
    company: parts[3],
    role: parts[4],
    score: parts[5],
    status: parts[6],
    pdf: parts[7],
    report: parts[8],
    notes: parts[9] || '',
    raw: line,
  };
}

// Read
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to dedup.');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

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

// Group by company+role
const groups = new Map();
for (const entry of entries) {
  const key = normalizeCompany(entry.company);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(entry);
}

// Find duplicates
let removed = 0;
const linesToRemove = new Set();

for (const [company, companyEntries] of groups) {
  if (companyEntries.length < 2) continue;

  // Within same company, find role matches
  const processed = new Set();
  for (let i = 0; i < companyEntries.length; i++) {
    if (processed.has(i)) continue;
    const cluster = [companyEntries[i]];
    processed.add(i);

    for (let j = i + 1; j < companyEntries.length; j++) {
      if (processed.has(j)) continue;
      if (roleMatch(companyEntries[i], companyEntries[j])) {
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
        const parts = lines[lineIdx].split('|').map(s => s.trim());
        parts[6] = bestStatus;
        lines[lineIdx] = rebuildRow(parts);
        console.log(`  📝 #${keeper.num}: status promoted to "${bestStatus}" (from #${cluster.find(e => e.status === bestStatus)?.num})`);
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
  copyFileSync(APPS_FILE, APPS_FILE + '.bak');
  writeFileSync(APPS_FILE, lines.join('\n'));
  console.log('✅ Written to applications.md (backup: applications.md.bak)');
} else if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else {
  console.log('✅ No duplicates found');
}
