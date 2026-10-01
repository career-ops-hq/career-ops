/** Resolve the shared search terms from a frozen scan context or the selected profile. */
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';

export function profileTargetKeywords(profile) {
  const words = profile?.target_roles?.search_keywords;
  if (!Array.isArray(words) || !words.length || words.some(word => typeof word !== 'string' || !word.trim())) {
    throw new Error('target_roles.search_keywords must be a non-empty array of non-empty strings');
  }
  return [...new Map(words.map(word => [word.trim().toLowerCase(), word.trim()])).values()];
}

export function resolveProfileKeywords(profilePath = process.env.CAREER_OPS_PROFILE || 'config/profile.yml') {
  return profileTargetKeywords(yaml.load(readFileSync(profilePath, 'utf8')));
}

export function providerKeywords(context) {
  return context && Object.hasOwn(context, 'searchKeywords')
    ? profileTargetKeywords({ target_roles: { search_keywords: context.searchKeywords } })
    : resolveProfileKeywords();
}
