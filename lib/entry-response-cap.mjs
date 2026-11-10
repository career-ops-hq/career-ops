// Per-entry response cap for portals.yml boards. Side-effect free on purpose: scan.mjs loads the
// data root's .env when imported, so audit-portals.mjs takes this helper from here, not from scan.mjs.

/**
 * Apply an entry's `max_response_mb` to the ctx a provider fetches with.
 *
 * fetchJson / fetchText / fetchResponse refuse a body over
 * DEFAULT_MAX_BODY_BYTES (_http.mjs) unless the call passes `maxBytes`. A
 * board that is legitimately bigger sets `max_response_mb` on its own
 * portals.yml entry; the setting is the user's, so it wins over a `maxBytes`
 * the provider passes, and every other entry keeps the default. An entry
 * without the key leaves the ctx as it is. So does a value that is not a YAML
 * number (a quoted string, a boolean, a list) or that does not come to a whole
 * positive finite byte count, with a warning naming the entry.
 *
 * @param {object} ctx - The per-entry ctx; its fetchers are replaced in place.
 * @param {{ name?: string, max_response_mb?: unknown }} entry
 * @returns {object} The same ctx.
 */
export function applyEntryResponseCap(ctx, entry) {
  const raw = entry?.max_response_mb;
  if (raw === undefined || raw === null) return ctx;
  const maxBytes = typeof raw === 'number' ? Math.floor(raw * 1024 * 1024) : NaN;
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    console.error(`⚠️  ${entry?.name}: max_response_mb must be a positive number, got ${JSON.stringify(raw)} — ignored`);
    return ctx;
  }
  for (const method of ['fetchJson', 'fetchText', 'fetchResponse']) {
    const original = ctx[method];
    if (typeof original !== 'function') continue;
    ctx[method] = function(url, opts = {}) {return original.call(this,url, { ...opts, maxBytes })};
  }
  return ctx;
}
