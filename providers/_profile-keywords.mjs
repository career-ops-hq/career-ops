// _profile-keywords.mjs — shared fallback for keyword-required providers.
// Currently used by vdab.mjs; other keyword-required providers (e.g.
// arbeitsagentur.mjs) can opt in later. Files prefixed with _ are never
// loaded as providers by scan.mjs (see _registry.mjs), so this is a helper
// module.
//
// A user who has completed onboarding already has target roles recorded in
// config/profile.yml. Without this, a keyword-required provider's portals.yml
// block with no `keywords:` set just throws — forcing the same information to
// be duplicated into every such provider's config by hand. This lets a
// provider fall back to the candidate's own profile instead.
//
// Scoped deliberately: providers only ever receive their own portals.yml
// entry (never the scanner's top-level config), so this only covers the
// config/profile.yml tier — not a title_filter.positive fallback, which
// would require changing the Provider.fetch(entry, ctx) contract itself.

import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';

// Matches the CAREER_OPS_PROFILE override already honored by scan.mjs,
// cv-templates.mjs, followup-cadence.mjs, plugins/_engine.mjs, and
// test-all.mjs — without this, a user with that env var set would get
// silently different fallback behavior here than everywhere else.
const DEFAULT_PROFILE_PATH = process.env.CAREER_OPS_PROFILE || 'config/profile.yml';

function cleanKeywords(value) {
  const arr = Array.isArray(value) ? value : [];
  return [...new Set(
    arr
      .filter(k => typeof k === 'string')
      .map(k => k.trim())
      .filter(Boolean),
  )];
}

/**
 * Extracts candidate search keywords from a parsed profile.yml's
 * `target_roles` block: `primary[]` plus `archetypes[].name`.
 * @param {any} profile
 * @returns {string[]}
 */
export function profileTargetKeywords(profile) {
  const roles = profile && profile.target_roles;
  if (!roles || typeof roles !== 'object') return [];
  return cleanKeywords([
    ...(Array.isArray(roles.primary) ? roles.primary : []),
    ...(Array.isArray(roles.archetypes) ? roles.archetypes.map(a => a && a.name) : []),
  ]);
}

/**
 * Reads config/profile.yml (if present) and returns its target-role
 * keywords. Fails open (empty array) on a missing/unparseable file — this is
 * a convenience fallback, never a hard requirement, so it must never throw.
 * @param {string} [profilePath]
 * @returns {string[]}
 */
export function resolveProfileKeywords(profilePath = DEFAULT_PROFILE_PATH) {
  if (!existsSync(profilePath)) return [];
  try {
    const profile = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    return profileTargetKeywords(profile);
  } catch {
    return [];
  }
}
