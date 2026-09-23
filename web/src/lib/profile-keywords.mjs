// profile-keywords.mjs — web mirror of providers/_profile-keywords.mjs.
//
// The web app cannot import the core helper at build time: Turbopack's root is
// pinned to web/ and refuses modules outside it (see web/next.config.mjs, and
// web/src/lib/tracker-table.mjs's header for the same constraint). So the web
// carries a mirror — and a mirror is exactly the thing that drifts. Guarded by
// tests/profile-keywords-parity.test.mjs (compared as SETS: core de-dupes and
// trims, this mirror returns raw strings for the caller's cleanChips to handle).

/**
 * Extracts candidate search keywords from a parsed profile.yml's
 * `target_roles` block: `primary[]` plus `archetypes[].name`.
 * @param {any} profile
 * @returns {string[]}
 */
export function profileTargetKeywords(profile) {
  const roles = profile && profile.target_roles;
  if (!roles || typeof roles !== "object") return [];
  const primary = Array.isArray(roles.primary) ? roles.primary : [];
  const archetypes = Array.isArray(roles.archetypes)
    ? roles.archetypes.map((a) => (a && typeof a === "object" ? a.name : undefined))
    : [];
  return [...primary, ...archetypes].filter((k) => typeof k === "string");
}
