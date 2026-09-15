/**
 * _paging.mjs — page-cap and probe resolution shared by paginating providers.
 *
 * Both rules below were being re-implemented per provider, which is how they
 * drift: at the time this was extracted, 19 providers carried their own copy of
 * the cap resolver and four their own copy of the probe check, and a provider
 * written without them silently ignored `max_pages` (a large board truncated
 * with no way to raise it) or walked an entire board to answer a health check.
 *
 * @param {any} entry - The portals.yml entry.
 * @param {any} ctx   - Scanner context; ctx.maxPages is set by a probing caller.
 * @param {number} cap - The provider's own hard ceiling.
 * @returns {number} Pages this run may request.
 */
export function resolveMaxPages(entry, ctx, cap) {
  const v = entry?.max_pages;
  const fromEntry = Number.isInteger(v) && v > 0 ? Math.min(v, cap) : cap;
  const hint = Number(ctx?.maxPages);
  return Number.isFinite(hint) && hint > 0 ? Math.min(fromEntry, Math.floor(hint)) : fromEntry;
}

/**
 * Is this caller probing rather than scanning? verify-portals.mjs's health check
 * sets ctx.maxPages to 1.
 *
 * Providers that loop QUERIES x PAGES need this as well as the cap: bounding
 * pages alone still fires one request per configured query, so a probe that
 * should cost one request costs five. Collapse the query list with
 * `isProbing(ctx) ? queries.slice(0, 1) : queries`.
 *
 * @param {any} ctx
 * @returns {boolean}
 */
export function isProbing(ctx) {
  const hint = Number(ctx?.maxPages);
  return Number.isFinite(hint) && hint > 0;
}
