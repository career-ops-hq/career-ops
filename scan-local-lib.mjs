/**
 * scan-local-lib.mjs — shared plumbing for scan-seek.mjs and scan-linkedin.mjs.
 *
 * The two scanners read different sites but must agree on what a keyword
 * match and a "same role" mean, so that logic lives here and is assembled from
 * the pieces every other scanner already uses:
 *
 *   - title / location / blacklist / seen-URL decisions: createAdmissionGate
 *     (lib/admission-gate.mjs), whose title filter is title-keywords.mjs's
 *     buildTitleFilter over portals.yml `title_filter`;
 *   - "same role": scan.mjs's companyRoleDedupKey with invite-match.mjs's
 *     normalizeCompanyName as the canonicalizer, checked against the company+role
 *     keys of scan-history, pipeline and tracker (loadDedupSnapshot) and against
 *     the other postings of this run, so a role found on both SEEK and LinkedIn
 *     is admitted once;
 *   - run log: scan.mjs's appendScanRunSummary into data/scan-runs.tsv, the
 *     file stats.mjs reads, written under the same lock.
 *
 * Network access goes through politeFetch: one request at a time, a pause
 * between requests, and Retry-After-aware back-off on 429/5xx.
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
} from './scan.mjs';

export const USER_AGENT = 'career-ops-scanner (personal job search; low volume)';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds or HTTP-date Retry-After header to milliseconds, or null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * GET a URL politely. Retries 429 and 5xx up to `retries` times, waiting for
 * Retry-After when the server sends it, otherwise backing off exponentially.
 * Resolves to the body text, or throws once retries are exhausted or on any
 * other non-2xx status (a 403/404 is not retried).
 *
 * @param {string} url
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.retries]
 * @param {number} [options.backoffMs]
 * @param {number} [options.maxWaitMs] - Cap on any single wait.
 * @param {(ms: number) => Promise<void>} [options.sleepImpl]
 */
export async function politeFetch(url, {
  fetchImpl = fetch,
  retries = 3,
  backoffMs = 2000,
  maxWaitMs = 60000,
  sleepImpl = sleep,
  headers = {},
} = {}) {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en', ...headers },
    });
    if (res.ok) return res.text();
    lastStatus = res.status;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === retries) break;
    const hinted = parseRetryAfter(res.headers?.get?.('retry-after'));
    await sleepImpl(Math.min(maxWaitMs, hinted ?? backoffMs * 2 ** attempt));
  }
  const err = new Error(`HTTP ${lastStatus} for ${url}`);
  err.status = lastStatus;
  throw err;
}

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
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
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
  const roles = seenRoles ?? new Set(loadDedupSnapshot({}, normalizeCompanyName).seenCompanyRoles);
  const counts = gate.counts;
  counts.duplicateRole = 0;

  const roleKey = (offer) => companyRoleDedupKey(offer.company, offer.title, normalizeCompanyName);

  return {
    counts,
    roleKey,
    check(offer) {
      const reason = gate.check(offer);
      if (reason) return reason;
      const key = roleKey(offer);
      if (roles.has(key)) {
        // gate.check already counted this posting as admitted.
        counts.admitted--;
        counts.duplicateRole++;
        return 'duplicate-role';
      }
      roles.add(key);
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

