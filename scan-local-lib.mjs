/**
 * scan-local-lib.mjs — shared plumbing for local keyword scanners (scan-seek.mjs).
 *
 * Assembles the filtering, deduplication, polite HTTP and run-logging logic
 * from the pieces every other scanner already uses:
 *
 *   - title / location / blacklist / seen-URL decisions: createAdmissionGate
 *     (lib/admission-gate.mjs), whose title filter is title-keywords.mjs's
 *     buildTitleFilter over portals.yml `title_filter`;
 *   - "same role": scan.mjs's companyRoleDedupKey with invite-match.mjs's
 *     normalizeCompanyName as the canonicalizer, checked against the company+role
 *     keys of scan-history, pipeline and tracker (loadDedupSnapshot) and against
 *     the other postings of this run, so a role listed more than once across
 *     sources or queries is admitted once;
 *   - run log: scan.mjs's appendScanRunSummary into data/scan-runs.tsv, the
 *     file stats.mjs reads, written under the same lock.
 *
 * Network access is not done here: scanners fetch through providers/_http.mjs's
 * fetchTextWithRetry (shared timeout, Retry-After-aware back-off on 429/5xx and
 * transient network errors) and pace requests with `sleep` below.
 */

import path from 'node:path';
import { createAdmissionGate } from './lib/admission-gate.mjs';
import { normalizeCompanyName } from './invite-match.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import {
  companyRoleDedupKey,
  loadDedupSnapshot,
  appendScanRunSummary,
  resolveDedupIncludeLocation,
} from './scan.mjs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lowercase, hyphen-separated slug for the SEEK SEO path. */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Decode the handful of HTML entities job cards use, and collapse whitespace. */
export function decodeHtml(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => (Number(n) <= 0x10FFFF ? String.fromCodePoint(Number(n)) : m))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Admission gate plus same-role dedup for one run.
 *
 * check(offer) returns null when the posting is admitted, otherwise one of
 * 'seen' | 'blacklisted' | 'title' | 'location' | 'duplicate-role'.
 * 'duplicate-role' means the company+role is already in scan-history, the
 * pipeline or the tracker, or was admitted earlier in this run.
 *
 * @param {object} [options]
 * @param {object} [options.config] - Parsed portals.yml.
 * @param {object} [options.gateOptions] - Passed to createAdmissionGate (tests).
 * @param {Set<string>} [options.seenRoles] - Existing company+role keys (tests).
 */
export function createLocalGate({ config = {}, gateOptions = {}, seenRoles } = {}) {
  const gate = createAdmissionGate({ config, ...gateOptions });
  const includeLocation = resolveDedupIncludeLocation(config);
  let roles;
  let locatedBases;
  if (seenRoles) {
    roles = seenRoles;
    locatedBases = new Set();
  } else {
    const snapshot = loadDedupSnapshot({}, normalizeCompanyName, { includeLocation });
    roles = new Set(snapshot.seenCompanyRoles);
    locatedBases = new Set(snapshot.seenCompanyRoleBases);
  }
  const counts = gate.counts;
  counts.duplicateRole = 0;

  const baseKeyOf = (offer) => companyRoleDedupKey(offer.company, offer.title, normalizeCompanyName);
  const roleKey = (offer) => (includeLocation
    ? companyRoleDedupKey(offer.company, offer.title, normalizeCompanyName, offer.location)
    : baseKeyOf(offer));

  return {
    counts,
    roleKey,
    check(offer) {
      const reason = gate.check(offer);
      if (reason) return reason;
      const key = roleKey(offer);
      // A tracker row with no city is the wildcard, and a located row is the
      // wildcard for a later offer that names no city. A different city does
      // not match either of those.
      const bare = includeLocation ? baseKeyOf(offer) : key;
      if (roles.has(key) || (key !== bare && roles.has(bare)) || (key === bare && locatedBases.has(bare))) {
        // gate.check already counted this posting as admitted.
        counts.admitted--;
        counts.duplicateRole++;
        return 'duplicate-role';
      }
      roles.add(key);
      if (key !== bare) locatedBases.add(bare);
      return null;
    },
  };
}

/** One-line description of what a local gate dropped. */
export function formatLocalSkips(counts) {
  const parts = [];
  if (counts.seen) parts.push(`${counts.seen} already seen`);
  if (counts.duplicateRole) parts.push(`${counts.duplicateRole} same role already known`);
  if (counts.blacklisted) parts.push(`${counts.blacklisted} blacklisted`);
  if (counts.title) parts.push(`${counts.title} title filter`);
  if (counts.location) parts.push(`${counts.location} location filter`);
  return parts.join(', ');
}

/**
 * Append one row to data/scan-runs.tsv in scan.mjs's format, under the same
 * lock. `boards` is the number of queries run; `companies` is 0 because these
 * scanners search by keyword rather than by tracked company.
 *
 * @param {object} run
 * @param {number} run.found
 * @param {object} run.counts - A gate's counts.
 * @param {number} run.newAdded
 * @param {number} run.queries
 * @param {number} run.errors
 * @param {'completed'|'failed'} [run.status]
 * @param {string} [filePath]
 */
export async function writeRunLog(run, filePath = path.join(getCareerOpsRoot(), 'data/scan-runs.tsv')) {
  const { counts = {} } = run;
  await withPipelineLock(filePath, async () => appendScanRunSummary({
    timestamp: new Date().toISOString(),
    status: run.status ?? 'completed',
    companies: 0,
    boards: run.queries,
    found: run.found,
    filteredTitle: counts.title ?? 0,
    filteredTier: 0,
    filteredLocation: counts.location ?? 0,
    filteredPostingAge: 0,
    filteredSalary: 0,
    filteredContent: 0,
    filteredCooldown: 0,
    dupes: (counts.seen ?? 0) + (counts.duplicateRole ?? 0),
    newAdded: run.newAdded,
    errors: run.errors,
    filteredBlacklist: counts.blacklisted ?? 0,
  }, filePath));
}

