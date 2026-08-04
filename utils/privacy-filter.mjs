/**
 * utils/privacy-filter.mjs — Privacy & PII Redaction for career-ops
 *
 * Redacts candidate personally identifiable information (PII) from prompt text
 * before sending payloads to external LLM endpoints.
 */

import yaml from 'js-yaml';

/**
 * Redacts candidate PII (name, email, phone, linkedin, github) from text.
 *
 * @param {string} text - The input prompt string (CV, profile, JD, etc.)
 * @param {string} profileYmlText - Raw content of config/profile.yml
 * @returns {string} Text with PII replaced by placeholders.
 */
export function redactCandidatePII(text, profileYmlText) {
  if (!text || typeof text !== 'string') return text;
  if (!profileYmlText || typeof profileYmlText !== 'string') return text;

  let redacted = text;
  try {
    const parsed = yaml.load(profileYmlText);
    const candidate = parsed?.candidate || {};

    const name = candidate.full_name;
    const email = candidate.email;
    const phone = candidate.phone;
    const linkedin = candidate.linkedin;
    const github = candidate.github;

    if (name && typeof name === 'string' && name.trim().length > 2) {
      redacted = redacted.split(name.trim()).join('Candidate Name');
    }
    if (email && typeof email === 'string' && email.trim().length > 2) {
      redacted = redacted.split(email.trim()).join('candidate@example.com');
    }
    if (phone && typeof phone === 'string' && phone.trim().length > 2) {
      redacted = redacted.split(phone.trim()).join('+91-0000000000');
    }
    if (linkedin && typeof linkedin === 'string' && linkedin.trim().length > 2) {
      redacted = redacted.split(linkedin.trim()).join('linkedin.com/in/candidate');
    }
    if (github && typeof github === 'string' && github.trim().length > 2) {
      redacted = redacted.split(github.trim()).join('github.com/candidate');
    }
  } catch {
    // If parsing fails, fail open and return original text
  }

  return redacted;
}

/**
 * Anonymizes context object containing cv, profile, and profileMode strings.
 *
 * @param {Object} ctx - Context object containing cv, profile, profileMode
 * @returns {Object} Context object with redacted strings
 */
export function anonymizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const profileYml = ctx.profile || '';

  if (ctx.cv) ctx.cv = redactCandidatePII(ctx.cv, profileYml);
  if (ctx.profile) ctx.profile = redactCandidatePII(ctx.profile, profileYml);
  if (ctx.profileMode) ctx.profileMode = redactCandidatePII(ctx.profileMode, profileYml);

  return ctx;
}
