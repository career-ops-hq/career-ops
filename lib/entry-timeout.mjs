// Per-entry request timeout for portals.yml boards. Side-effect free on purpose: scan.mjs loads the
// data root's .env when imported, so audit-portals.mjs takes this helper from here, not from scan.mjs.

// setTimeout rewrites a longer delay to 1ms, which would abort every request of the entry.
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Apply an entry's `timeout_ms` to the ctx a provider fetches with.
 *
 * A board that returns its whole catalogue in one response can need more time
 * than its provider allows, and the scan then reports it as a network error. Such
 * a board sets `timeout_ms` on its own portals.yml entry. The setting is the
 * user's, so it wins over a `timeoutMs` the provider passes, and every other
 * entry keeps its timeout. An entry without the key leaves the ctx as it is. So
 * does a value that is not a whole YAML number from 1 to 2147483647, with a
 * warning naming the entry.
 *
 * @param {object} ctx - The per-entry ctx; its fetchers are replaced in place.
 * @param {{ name?: string, timeout_ms?: unknown }} entry
 * @returns {object} The same ctx.
 */
export function applyEntryTimeout(ctx, entry) {
  const raw = entry?.timeout_ms;
  if (raw === undefined || raw === null) return ctx;
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_TIMER_MS) {
    console.error(`⚠️  ${entry?.name}: timeout_ms must be a whole number from 1 to ${MAX_TIMER_MS}, got ${JSON.stringify(raw)} — ignored`);
    return ctx;
  }
  for (const method of ['fetchJson', 'fetchText', 'fetchResponse']) {
    const original = ctx[method];
    if (typeof original !== 'function') continue;
    ctx[method] = (url, opts = {}) => original(url, { ...opts, timeoutMs: raw });
  }
  return ctx;
}
