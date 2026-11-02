/**
 * admission-gate.mjs — one decision for "does this posting go into
 * data/pipeline.md?", shared by the writers that are not scan.mjs (#5478).
 *
 * scan.mjs admits a posting only after the user's blacklist, title filter,
 * location filter and seen set (scan-history, pipeline and tracker, compared
 * as normalized URLs). scan-hn, scan-interamt, openrouter-runner and plugin
 * ingest each built their own subset of that: none read data/blacklist.md,
 * Interamt and scan-hn kept private substring matchers, and the seen checks
 * compared raw URLs or the pipeline alone. The same portals.yml then gave a
 * different verdict depending on which command added the row.
 *
 * The gate is assembled from the scan.mjs pieces, so a change to any of those
 * rules reaches every writer. It never writes: the caller appends what it
 * admits and records whatever skip rows it already records.
 */

import {
  buildTitleFilter,
  buildLocationFilter,
  loadBlacklist,
  findBlacklistEntry,
  loadSeenUrls,
  isOfferSeen,
  markOfferSeen,
} from '../scan.mjs';

/** Skip reasons, in the order the gate tests them. */
export const ADMISSION_REASONS = Object.freeze(['seen', 'blacklisted', 'title', 'location']);

/**
 * Build a gate for one run.
 *
 * Every dependency can be injected, which is how tests and callers with their
 * own filter (scan-hn's hn_hiring.keywords) use it. The defaults read the
 * user's files through scan.mjs, so they honor the data root and the
 * CAREER_OPS_* path overrides.
 *
 * @param {object} [options]
 * @param {object} [options.config] - Parsed portals.yml; supplies title_filter and location_filter.
 * @param {(title: string) => boolean} [options.titleFilter]
 * @param {(location: string, url: string, title: string) => boolean} [options.locationFilter]
 * @param {Map<string, object>} [options.blacklist] - As returned by loadBlacklist().
 * @param {Set<string>} [options.seen] - As returned by loadSeenUrls().seen. The gate adds to it.
 */
export function createAdmissionGate({
  config = {},
  titleFilter = buildTitleFilter(config?.title_filter),
  locationFilter = buildLocationFilter(config?.location_filter),
  blacklist = loadBlacklist(),
  seen = loadSeenUrls().seen,
} = {}) {
  const counts = { admitted: 0, seen: 0, blacklisted: 0, title: 0, location: 0 };

  function reasonFor(offer, titleText) {
    if (isOfferSeen(offer, seen)) return 'seen';
    if (findBlacklistEntry(blacklist, offer.company || '', offer.url)) return 'blacklisted';
    if (!titleFilter(titleText)) return 'title';
    if (!locationFilter(offer.location || '', offer.url, offer.title || '')) return 'location';
    return null;
  }

  /**
   * Judge one posting. Returns null when it is admitted, otherwise one of
   * ADMISSION_REASONS. Either way the posting joins the run's seen set, so a
   * second copy later in the same run is reported as 'seen'.
   *
   * @param {{url: string, company?: string, title?: string, location?: string}} offer
   * @param {object} [options]
   * @param {string} [options.titleText] - Text the title filter reads, when it is not offer.title.
   * @returns {null | 'seen' | 'blacklisted' | 'title' | 'location'}
   */
  function check(offer, { titleText = offer.title || '' } = {}) {
    const reason = reasonFor(offer, titleText);
    if (reason !== 'seen') markOfferSeen(offer, seen);
    counts[reason ?? 'admitted']++;
    return reason;
  }

  return {
    titleFilter,
    counts,

    /** Whether the posting is already in scan-history, the pipeline, the tracker, or this run. */
    isSeen(offer) {
      return isOfferSeen(offer, seen);
    },

    /** Record a posting as handled this run without judging it (a failed extraction, say). */
    markSeen(offer) {
      markOfferSeen(offer, seen);
    },

    check,

    /**
     * Split a batch into the admitted postings and the skipped ones by reason.
     *
     * @param {Array<object>} offers
     */
    partition(offers) {
      const admitted = [];
      const skipped = { seen: [], blacklisted: [], title: [], location: [] };
      for (const offer of offers) {
        const reason = check(offer);
        if (reason) skipped[reason].push(offer);
        else admitted.push(offer);
      }
      return { admitted, skipped };
    },
  };
}

/**
 * One summary line of what the gate dropped, or '' when it dropped nothing.
 *
 * @param {{seen: number, blacklisted: number, title: number, location: number}} counts
 */
export function formatSkipCounts(counts) {
  const parts = [];
  if (counts.seen) parts.push(`${counts.seen} already seen`);
  if (counts.blacklisted) parts.push(`${counts.blacklisted} blacklisted`);
  if (counts.title) parts.push(`${counts.title} title filter`);
  if (counts.location) parts.push(`${counts.location} location filter`);
  return parts.join(', ');
}
