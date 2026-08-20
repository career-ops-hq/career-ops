/**
 * scan-dedup.mjs — Deduplication & History Helpers for scan.mjs
 */
import { fingerprintText, findCrossListings } from './fingerprint-core.mjs';
import { normalizeTextKey } from './tracker-parse.mjs';

/**
 * Filter out duplicate jobs based on URL, exact title/company match, or SimHash fingerprint.
 *
 * @param {Array} jobs - Raw list of jobs fetched during scan
 * @param {Set<string>} existingUrls - Set of URLs already present in history/tracker
 * @returns {{ unique: Array, duplicates: Array }}
 */
export function deduplicateScanJobs(jobs, existingUrls = new Set()) {
  const unique = [];
  const duplicates = [];
  const seenUrls = new Set(existingUrls);
  const seenKeys = new Set();

  for (const job of jobs) {
    const url = (job.url || '').trim();
    if (!url || seenUrls.has(url)) {
      duplicates.push({ ...job, reason: 'URL duplicate' });
      continue;
    }

    const companyKey = normalizeTextKey(job.company || '');
    const titleKey = normalizeTextKey(job.title || '');
    const compoundKey = `${companyKey}:${titleKey}`;

    if (compoundKey !== ':' && seenKeys.has(compoundKey)) {
      duplicates.push({ ...job, reason: 'Compound company+title duplicate' });
      continue;
    }

    seenUrls.add(url);
    if (compoundKey !== ':') seenKeys.add(compoundKey);
    unique.push(job);
  }

  return { unique, duplicates };
}
