// @ts-check
/**
 * Normalize dedicated workplaceType field to 'remote' | 'hybrid' | 'onsite'.
 * Trims + lowercases; maps 'on-site'/'onsite' -> 'onsite'. Anything else
 * (blank, 'unspecified', unknown) returns undefined.
 *
 * @param {unknown} val
 * @returns {'remote' | 'hybrid' | 'onsite' | undefined}
 */
export function normalizeWorkplaceType(val) {
  if (typeof val !== 'string') return undefined;
  const s = val.trim().toLowerCase();
  if (s === 'remote') return 'remote';
  if (s === 'hybrid') return 'hybrid';
  if (s === 'onsite' || s === 'on-site') return 'onsite';
  return undefined;
}

/**
 * Returns `{ workplaceType }` when valid, or `{}` when omitted.
 * Allows object literals in providers to spread it in one line without reindenting.
 *
 * @param {unknown} val
 * @returns {{ workplaceType: 'remote' | 'hybrid' | 'onsite' } | {}}
 */
export function workplaceField(val) {
  const wt = normalizeWorkplaceType(val);
  return wt ? { workplaceType: wt } : {};
}
