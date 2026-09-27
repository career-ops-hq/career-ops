/**
 * candidate-identity.mjs — the contact block for generated master CVs.
 *
 * This data used to be a hardcoded `BASE_CANDIDATE` literal inside
 * generate-master-cvs.mjs. That file is a SYSTEM_PATHS entry: the auto-updated,
 * shareable system layer. Keeping personal contact details there was wrong
 * twice over —
 *
 *   1. Exposure. The system layer is what the project publishes to other
 *      users. A candidate's phone, email and home city have no business in it.
 *   2. Data loss, which is the likelier of the two. `update-system.mjs apply`
 *      restores system files from the upstream ref, so the next update would
 *      have overwritten the literal and silently dropped the candidate's
 *      details from every generated CV.
 *
 * Identity is user data, so it lives in the user layer. config/profile.yml
 * already carries it under `candidate:` — that file's own header calls it the
 * "single source of truth for personal data across all modes" — so this module
 * reads what is already there rather than inventing a second config surface.
 *
 * Keys are read flat and left alone: `linkedin` and `portfolio_url` must stay
 * flat strings, because prepare-application.mjs regex-reads `linkedin` for ATS
 * form autofill and an object form silently yields an empty field.
 *
 * A missing or partial profile is NOT an error. This repo ships as a template,
 * so neutral placeholders are the correct output for a fresh clone;
 * `missingFields()` lets the caller say so rather than rendering a CV that
 * looks finished but is not.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { getCareerOpsRoot } from '../path-resolver.mjs';

export const PROFILE_PATH = join(getCareerOpsRoot(), 'config', 'profile.yml');

/**
 * What a template clone renders. Deliberately generic and obviously-fake: a
 * generated CV must never quietly look personalised when it is not.
 */
export const PLACEHOLDER_IDENTITY = {
  name: 'Your Name',
  phone: '+00-000-000-000',
  email: 'you@example.com',
  linkedin: { url: '', display: '' },
  portfolio: { url: '', display: '' },
  location: 'Your City',
};

/** Visible text for a link: the URL without its scheme, or '' when unset. */
export function displayFor(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  return s.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Read `candidate:` out of config/profile.yml.
 * @returns {object|null} the parsed candidate block, or null when unavailable.
 */
export function readCandidateBlock(profilePath = PROFILE_PATH) {
  if (!existsSync(profilePath)) return null;
  let parsed;
  try {
    parsed = yamlLoad(readFileSync(profilePath, 'utf8'));
  } catch {
    // A malformed profile is the user's file to fix; a CV generator should
    // degrade to placeholders rather than throw and lose the whole run.
    return null;
  }
  const block = parsed && parsed.candidate;
  return block && typeof block === 'object' ? block : null;
}

/** Fields the caller still needs before the CV is submittable. */
export function missingFields(identity) {
  const out = [];
  for (const key of ['name', 'phone', 'email', 'location']) {
    const v = identity && identity[key];
    if (!v || v === PLACEHOLDER_IDENTITY[key]) out.push(`candidate.${key === 'name' ? 'full_name' : key}`);
  }
  for (const key of ['linkedin', 'portfolio']) {
    if (!identity || !identity[key] || !identity[key].url) out.push(`candidate.${key === 'linkedin' ? 'linkedin' : 'portfolio_url'}`);
  }
  return out;
}

/**
 * The identity block for a generated CV: profile.yml values, each falling back
 * to a placeholder independently so one absent field cannot blank the rest.
 */
export function loadCandidateIdentity(profilePath = PROFILE_PATH) {
  const c = readCandidateBlock(profilePath) || {};
  const pick = (key, fallback) => {
    const v = c[key];
    return v === undefined || v === null || String(v).trim() === '' ? fallback : String(v).trim();
  };

  const linkedinUrl = pick('linkedin', PLACEHOLDER_IDENTITY.linkedin.url);
  const portfolioUrl = pick('portfolio_url', PLACEHOLDER_IDENTITY.portfolio.url);

  return {
    name: pick('full_name', PLACEHOLDER_IDENTITY.name),
    phone: pick('phone', PLACEHOLDER_IDENTITY.phone),
    email: pick('email', PLACEHOLDER_IDENTITY.email),
    linkedin: { url: linkedinUrl, display: displayFor(linkedinUrl) },
    portfolio: { url: portfolioUrl, display: displayFor(portfolioUrl) },
    location: pick('location', PLACEHOLDER_IDENTITY.location),
  };
}
