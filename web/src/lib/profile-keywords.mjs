/**
 * profile-keywords.mjs — read search keywords out of `config/profile.yml`'s
 * `target_roles` block.
 *
 * The core already does this in `providers/_profile-keywords.mjs`
 * (`profileTargetKeywords`), and this is a deliberate mirror of it, not a
 * second design: Turbopack's root is pinned to `web/` and refuses modules
 * outside it (see next.config.mjs and tracker-table.mjs's header), so a
 * build-time import of the core helper is not available here.
 *
 * It exists as a named, tested function because the inline version it replaces
 * had drifted from the core's in both fields it reads, and did so silently:
 *
 *   ...(typeof roles.primary === "string" ? [roles.primary] : []),
 *   ...(Array.isArray(roles.archetypes) ? roles.archetypes : []),
 *
 * `primary` is a LIST in `config/profile.example.yml` — and in what the web's
 * own writer emits (`api/profile/route.ts` → `{ primary: roles.slice(0, 6) }`)
 * — so the string test never fired. `archetypes` is a list of
 * `{name, level, fit}` objects, so spreading it raw yielded objects that the
 * caller's string cleaner then dropped. Both halves returned nothing, which
 * made `seedExploreFilters`'s profile.yml fallback dead code: the web wrote a
 * profile it could not read back.
 *
 * Plain `.mjs`, same pattern as clean-chips.mjs, so the test can import the
 * real module under Node without a TypeScript runner.
 */

/**
 * Extract candidate search keywords from a parsed profile.yml's `target_roles`
 * block: `primary[]` plus `archetypes[].name`. Order is preserved and matches
 * the core helper's. Never throws — a missing or malformed block yields [].
 *
 * Returns raw strings; de-duplication and trimming are the caller's, so the
 * web can run them through the same `cleanChips` as every other keyword list.
 *
 * @param {unknown} profile - A parsed profile.yml (or anything at all).
 * @returns {string[]}
 */
export function profileTargetKeywords(profile) {
  const roles = profile && typeof profile === "object" ? profile.target_roles : null;
  if (!roles || typeof roles !== "object") return [];
  return [
    ...(Array.isArray(roles.primary) ? roles.primary : []),
    ...(Array.isArray(roles.archetypes) ? roles.archetypes.map((a) => a && a.name) : []),
  ].filter((k) => typeof k === "string");
}

/**
 * Regions the candidate may work from, for the inbox's geo-eligibility hint.
 * The union of `location.authorized_in` and `location.country` from
 * `config/profile.yml` — WHATEVER the user lists, so nothing is hardcoded to
 * one person's geography. Lowercased & de-duped. A user who wants LATAM/Americas
 * postings to count as eligible simply lists those regions in `authorized_in`.
 * Empty when unset (the hint then never marks a row "not eligible").
 * @param {unknown} profile parsed config/profile.yml
 * @returns {string[]}
 */
export function profileAuthorizedRegions(profile) {
  const loc = profile && typeof profile === "object" ? profile.location : null;
  if (!loc || typeof loc !== "object") return [];
  const out = [
    ...(Array.isArray(loc.authorized_in) ? loc.authorized_in : []),
    ...(typeof loc.country === "string" ? [loc.country] : []),
  ].filter((r) => typeof r === "string" && r.trim());
  return [...new Set(out.map((r) => r.trim().toLowerCase()))];
}

const SENIORITY_ORDER = ["lead", "staff", "senior", "mid", "junior", "intern"];

/** Map one level/title phrase to the shared seniority scale (null when nothing matches). */
function mapSeniority(phrase) {
  const t = ` ${String(phrase).toLowerCase()} `;
  if (/\b(head|vp|vice president|director|chief|manager|mgr|lead)\b/.test(t)) return "lead";
  if (/\b(staff|principal|distinguished|fellow|architect)\b/.test(t)) return "staff";
  if (/\b(senior|sr\.?|snr)\b/.test(t)) return "senior";
  if (/\b(mid|intermediate)\b/.test(t)) return "mid";
  if (/\b(junior|jr\.?|entry|graduate|associate)\b/.test(t)) return "junior";
  if (/\b(intern|internship|working student|apprentice)\b/.test(t)) return "intern";
  return null;
}

/**
 * The candidate's target seniority BOUNDARY, for the inbox's below-target flag.
 * Reads every level named in `target_roles.archetypes[].level` (and the primary
 * role titles), maps each to the shared scale, and returns the LEAST-senior one
 * targeted — so a row only flags when it sits strictly below what the user would
 * accept. Nothing hardcoded to "senior"; a mid-level job seeker gets a mid
 * boundary. Returns null when no level maps (the flag then never fires).
 * @param {unknown} profile parsed config/profile.yml
 * @returns {("lead"|"staff"|"senior"|"mid"|"junior"|"intern")|null}
 */
export function profileTargetSeniority(profile) {
  const roles = profile && typeof profile === "object" ? profile.target_roles : null;
  if (!roles || typeof roles !== "object") return null;
  const phrases = [
    ...(Array.isArray(roles.archetypes) ? roles.archetypes.map((a) => a && a.level) : []),
    ...(Array.isArray(roles.primary) ? roles.primary : []),
  ].filter((s) => typeof s === "string");
  let boundary = null;
  for (const phrase of phrases) {
    // one phrase can name two levels ("Mid-Senior", "Senior/Staff"); keep the least senior.
    for (const tok of phrase.split(/[\s/,()+&-]+/)) {
      const s = mapSeniority(tok);
      if (s && (boundary == null || SENIORITY_ORDER.indexOf(s) > SENIORITY_ORDER.indexOf(boundary))) boundary = s;
    }
  }
  return boundary;
}
