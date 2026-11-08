
// @ts-check

/**
 * Resolve a location string to a city slug using the supplied city table.
 *
 * @param {string} location
 * @param {Readonly<Record<string, string>>} table
 * @returns {string | null}
 */
export function citySlug(location, table) {
  const key = String(location ?? '').trim().toLowerCase();
  if (!key) return null;

  // Only resolve own properties; inherited Object.prototype keys are not cities.
  if (Object.hasOwn(table, key)) return table[key] ?? null;

  for (const [candidate, slug] of Object.entries(table)) {
    if (key.includes(candidate)) return slug;
  }

  return null;
}
