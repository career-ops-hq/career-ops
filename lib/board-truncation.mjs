/**
 * board-truncation.mjs — the one shared reading of a partly-read board (#6632).
 *
 * A provider that stops short of the whole board says so on the jobs array it
 * returns, but every provider said it under its own name: `workdayTruncated`,
 * `eightfoldTruncated`, `leverTruncated`, and so on, in three different
 * shapes (boolean `true`, a string reason, an object `{ reason }`). `scan.mjs`
 * read none of them, so a board cut short by a page cap, a 429, or a fetch
 * error was logged `reachable` in `data/portal-health.tsv` and never entered
 * the persistent-failure streak.
 *
 * This module is the single place that reading happens:
 *
 *   - `markTruncated(jobs, { reason, total })` sets the canonical flag for
 *     new providers: `jobs.truncated = { reason, fetched, total? }`.
 *   - `readTruncation(jobs, ctx)` returns that canonical flag, or the
 *     normalised form of any legacy `<name>Truncated` tag, or `null` when
 *     the board is complete. No provider has to change its tag.
 *
 * Reason vocabulary. The canonical reasons are the ones providers already
 * report: `cap` (page cap / request budget), `fetch-error` (a page failed
 * after retries), `429` (rate-limited, when a provider distinguishes it),
 * `transient` / `structural` (Workday's retryable vs fixed-bound cut), and
 * `unknown` (a bare boolean tag, where the provider did not say why). Any
 * other non-empty string a provider reports — `source-reports-more`,
 * `not-cumulative`, `counted`, `repeated` — is passed through verbatim
 * rather than collapsed into one of the above, so no information is lost.
 * A reason is never invented: a boolean tag reads as `unknown`.
 *
 * Precedence, when several tags are present on one board (in practice a
 * board carries one, but the rule is pinned here so a second tag can never
 * silently win): a tag with a specific reason beats a bare `true`; among
 * specific reasons, `fetch-error` beats `cap` — a board that broke is not
 * merely capped. The canonical `jobs.truncated` flag is a candidate like
 * any other, so the same ranking applies to it.
 *
 * Probe guard. When `ctx.maxPages` is set, verify-portals is running a
 * liveness probe (one page, one axis), not a scan, and a one-page walk is
 * not a truncated board. `readTruncation` returns `null` for a probe, so a
 * future caller cannot misread a probe as a partial board.
 */

/**
 * Every legacy `<name>Truncated` tag present in `providers/*.mjs` at this
 * HEAD. The issue (#6632) counts 19 providers; the tree carries 20 tags —
 * `aldiNordTruncated` is the twentieth, a string reason set by
 * providers/aldi-nord.mjs. Nothing is dropped to make the count match the
 * issue: the reader recognises all 20, and this list is the place to add
 * the next one.
 */
export const LEGACY_TRUNCATED_TAGS = [
  'adpTruncated',
  'aldiNordTruncated',
  'bulldogjobTruncated',
  'clearcompanyTruncated',
  'eightfoldTruncated',
  'icimsTruncated',
  'inrecruitingTruncated',
  'jibeapplyTruncated',
  'jobicyTruncated',
  'jobstreetTruncated',
  'joinTruncated',
  'leverTruncated',
  'pageupTruncated',
  'phenomTruncated',
  'polymerTruncated',
  'ripplingTruncated',
  'trakstarTruncated',
  'ultiproTruncated',
  'workdayTruncated',
  'wpJobManagerTruncated',
];

/**
 * How strongly a reason identifies the cut, for precedence. A bare boolean
 * tag (reason `unknown`) is the weakest signal; a specific reason beats it;
 * `fetch-error` beats every other specific reason.
 * @param {string} reason
 * @returns {number}
 */
function reasonRank(reason) {
  if (reason === 'fetch-error') return 4;
  if (reason === 'unknown') return 1;
  return 3;
}

/**
 * Normalise one legacy tag value to a reason string, or `null` when the
 * value carries no truncation signal (`false`, `undefined`, an empty string,
 * an object without a reason).
 * @param {unknown} value
 * @returns {string|null}
 */
function normaliseReason(value) {
  if (value === true) return 'unknown';
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (value !== null && typeof value === 'object') {
    const reason = /** @type {{ reason?: unknown }} */ (value).reason;
    if (typeof reason === 'string' && reason.trim() !== '') return reason.trim();
  }
  return null;
}

/**
 * Pull a `total` out of a tag value when the provider reported one
 * (canonical flag or an object tag carrying it). Anything else is not a
 * total — a string or a boolean is not a count.
 * @param {unknown} value
 * @returns {number|undefined}
 */
function extractTotal(value) {
  if (value !== null && typeof value === 'object') {
    const total = /** @type {{ total?: unknown }} */ (value).total;
    if (typeof total === 'number' && Number.isFinite(total) && total >= 0) return total;
  }
  return undefined;
}

/**
 * Mark a jobs array as truncated, in the canonical form new providers use.
 * `fetched` is the array's length at call time; `total` is included only
 * when the provider knows it.
 *
 * @param {unknown[]} jobs
 * @param {{ reason?: string, total?: number }} [options]
 * @returns {unknown[]}
 */
export function markTruncated(jobs, { reason = 'cap', total } = {}) {
  if (!Array.isArray(jobs)) throw new TypeError('markTruncated expects an array of jobs');
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new TypeError('markTruncated expects a non-empty string reason');
  }
  if (total !== undefined && (typeof total !== 'number' || !Number.isFinite(total) || total < 0)) {
    throw new TypeError('markTruncated expects total to be a finite number >= 0');
  }
  /** @type {any} */ (jobs).truncated = {
    reason: reason.trim(),
    fetched: jobs.length,
    ...(total !== undefined ? { total } : {}),
  };
  return jobs;
}

/**
 * Read the truncation signal off a jobs array, in canonical form, or `null`
 * when the board is complete. The canonical `jobs.truncated` flag and every
 * legacy `<name>Truncated` tag are candidates; the best-ranked reason wins
 * (see the module header for the precedence rule). `fetched` is always the
 * array's length at read time, so a flag set before a later dedup still
 * reports what the caller actually holds.
 *
 * @param {unknown} jobs
 * @param {{ maxPages?: unknown } | null} [ctx]
 * @returns {{ reason: string, fetched: number, total?: number } | null}
 */
export function readTruncation(jobs, ctx = null) {
  // A liveness probe (verify-portals, `ctx.maxPages: 1`) walks one page by
  // design; that is not a truncated board, and no tag on a probe result may
  // be read as one.
  if (ctx !== null && typeof ctx === 'object' && Number.isInteger(/** @type {{ maxPages?: unknown }} */ (ctx).maxPages)
    && /** @type {{ maxPages: number }} */ (ctx).maxPages > 0) {
    return null;
  }
  if (!Array.isArray(jobs)) return null;
  /** @type {{ reason: string, rank: number, total: number|undefined } | null} */
  let best = null;
  const consider = (value) => {
    const reason = normaliseReason(value);
    if (reason === null) return;
    const rank = reasonRank(reason);
    if (best === null || rank > best.rank) {
      best = { reason, rank, total: extractTotal(value) };
    } else if (rank === best.rank && best.total === undefined) {
      // Same strength, but this candidate knows the total — keep it.
      const total = extractTotal(value);
      if (total !== undefined) best.total = total;
    }
  };
  consider(/** @type {any} */ (jobs).truncated);
  for (const tag of LEGACY_TRUNCATED_TAGS) consider(/** @type {any} */ (jobs)[tag]);
  if (best === null) return null;
  return {
    reason: best.reason,
    fetched: jobs.length,
    ...(best.total !== undefined ? { total: best.total } : {}),
  };
}

/**
 * The one-line form a partial board takes in a run summary, matching the
 * issue's example: `Apple (page-cap, 100 of 340)`. The `total` is omitted
 * when the provider did not report one. A `cap` reason is shown as
 * `page-cap` — the cap is on pages, and the summary is where a reader
 * decides whether to raise `max_pages`.
 * @param {{ company: string, reason: string, fetched: number, total?: number }} partial
 * @returns {string}
 */
export function formatPartialBoard(partial) {
  const reason = partial.reason === 'cap' ? 'page-cap' : partial.reason;
  const count = partial.total !== undefined
    ? `${partial.fetched} of ${partial.total}`
    : `${partial.fetched}`;
  return `${partial.company} (${reason}, ${count})`;
}
