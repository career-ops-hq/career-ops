/**
 * utils/privacy-filter.mjs — opt-in contact-detail redaction for career-ops
 *
 * Keeps the candidate's name and contact details (email, phone, LinkedIn,
 * GitHub, portfolio, socials) out of the prompts that gemini-eval,
 * openai-tailor and openrouter-runner send to a hosted model.
 *
 * Opt-in: nothing is redacted unless config/profile.yml sets
 *
 *   privacy:
 *     redact_contact_info: true
 *
 * The values to redact come from the `candidate:` block of the same profile.
 * Redaction is reversible (`restoreCandidatePII`) so output that is shipped to
 * a recruiter, such as a tailored CV, carries the real details, never a
 * placeholder.
 */

import { loadYaml } from '../lib/yaml-document.mjs';

export const PLACEHOLDERS = Object.freeze({
  name: 'Candidate Name',
  email: 'candidate@example.com',
  phone: '+00-0000000000',
  linkedin: 'linkedin.com/in/candidate',
  github: 'github.com/candidate',
  portfolio_url: 'candidate.example',
  portfolio: 'candidate-portfolio.example',
  twitter: 'x.com/candidate',
});

const URL_KINDS = Object.freeze(['linkedin', 'github', 'portfolio_url', 'portfolio', 'twitter']);

const MIN_TEXT_LEN = 3;
const MIN_PHONE_DIGITS = 7;
const URL_PREFIX = '(?:https?:\\/\\/)?(?:www\\.)?';

function escapeRegex(s) {
  return String(s).replace(/[\\^$*+?.()|[\]{}/-]/g, (m) => '\\' + m);
}

function parseProfile(profileYmlText) {
  if (!profileYmlText || typeof profileYmlText !== 'string') return null;
  try {
    const parsed = loadYaml(profileYmlText.replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * True only when the profile explicitly sets `privacy.redact_contact_info: true`.
 * Absent, malformed or non-boolean values mean "off".
 *
 * @param {string} profileYmlText - raw content of config/profile.yml
 * @returns {boolean}
 */
export function isRedactionEnabled(profileYmlText) {
  return parseProfile(profileYmlText)?.privacy?.redact_contact_info === true;
}

function cleanString(v) {
  return typeof v === 'string' && v.trim().length >= MIN_TEXT_LEN ? v.trim() : null;
}

function normalizeUrl(v) {
  return v.replace(/[?#].*$/, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

// X and Twitter serve the same profile under two hosts: a profile configured as
// x.com/<handle> must also match twitter.com/<handle>, and the other way round.
// The lookbehind keeps a short host like "x.com" from matching inside "box.com".
const X_HOST = /^(?:x|twitter)\.com(?=\/|$)/i;

function urlPattern(normalized) {
  if (X_HOST.test(normalized)) {
    return `(?<![\\w.-])${URL_PREFIX}(?:x|twitter)\\.com${escapeRegex(normalized.replace(X_HOST, ''))}`;
  }
  return `${URL_PREFIX}${escapeRegex(normalized)}`;
}

/**
 * Build the replacement rules for a profile: one entry per detail that is
 * present, each with a regex that finds it in free text and the original
 * value used to restore it.
 */
function buildRules(profileYmlText) {
  const candidate = parseProfile(profileYmlText)?.candidate;
  if (!candidate || typeof candidate !== 'object') return [];
  const rules = [];

  // The name rule is pushed LAST (see below): a one-word name such as "Jane"
  // would otherwise rewrite the start of "jane.doe@example.org" before the
  // email rule could match it.
  const name = cleanString(candidate.full_name);

  // Primary first, then alternates. Each distinct email address gets its own
  // unique placeholder (e.g. candidate@example.com, candidate-alt1@example.com)
  // so restoreCandidatePII preserves every address across the round trip.
  const alternates = candidate.alternate_emails;
  const altList = Array.isArray(alternates) ? alternates
    : (alternates && typeof alternates === 'object' ? Object.values(alternates) : []);
  const emails = [candidate.email, ...altList].map(cleanString).filter(Boolean);
  const uniqueEmails = [...new Set(emails)];
  uniqueEmails.forEach((email, idx) => {
    const placeholder = idx === 0 ? PLACEHOLDERS.email : `candidate-alt${idx}@example.com`;
    rules.push({
      kind: 'email',
      placeholder,
      original: email,
      find: new RegExp(`(?<![\\w.+-])${escapeRegex(email)}(?![\\w-])`, 'gi'),
    });
  });

  const phone = cleanString(candidate.phone);
  // Match the number itself: an extension ("ext 123", "x123", "#123") is not part
  // of what appears in a CV's number, so keep its digits out of the matcher.
  const phoneBase = phone ? phone.replace(/[\s,;]*(?:ext(?:ension)?\.?|x|#)\s*\d+\s*$/i, '') : '';
  const digits = phoneBase.replace(/\D/g, '');
  if (digits.length >= MIN_PHONE_DIGITS) {
    // Match the number however it is spaced or punctuated, and also without
    // its country code (e.g. "+91 98765 43210" -> "98765 43210") or with a
    // national trunk prefix (e.g. "09876543210" for India +91 / UK +44 / France +33).
    const variants = new Set([digits]);
    if (digits.length > 10) {
      const national = digits.slice(-10);
      variants.add(national);
      variants.add('0' + national);
    } else if (digits.length === 10) {
      variants.add('0' + digits);
    } else if (digits.startsWith('0') && digits.length >= 8) {
      variants.add(digits.slice(1));
    }
    for (const v of variants) {
      const body = v.split('').join('[\\s().-]*');
      rules.push({
        kind: 'phone',
        placeholder: PLACEHOLDERS.phone,
        original: phone,
        find: new RegExp(`(?<![\\d])(?:\\+\\s*)?${body}(?!\\d)`, 'g'),
      });
    }
  }

  for (const kind of URL_KINDS) {
    const url = cleanString(candidate[kind]);
    if (!url || !normalizeUrl(url)) continue; // e.g. "https://": an empty pattern would match everywhere
    rules.push({
      kind,
      placeholder: PLACEHOLDERS[kind] || 'candidate.example',
      original: url,
      // Canonical profile path, plus any ?query / #fragment that follows it in the text.
      // Uses disjoint character classes for query chars vs trailing sentence punctuation
      // to avoid catastrophic / polynomial ReDoS (CodeQL js/polynomial-redos).
      find: new RegExp(
        `${urlPattern(normalizeUrl(url))}(?![\\w-])\\/?(?:[?#][^\\s)\\]>"'.,;:!?]+(?:[.,;:!?]+[^\\s)\\]>"'.,;:!?]+)*)?`,
        'gi'
      ),
    });
  }

  if (name) {
    const parts = name.split(/\s+/).map(escapeRegex).join('\\s+');
    rules.push({
      kind: 'name',
      placeholder: PLACEHOLDERS.name,
      original: name,
      find: new RegExp(`(?<![\\p{L}\\p{N}])${parts}(?![\\p{L}\\p{N}])`, 'giu'),
    });
  }

  return rules;
}

/**
 * Replace the candidate's name, email, phone, LinkedIn, GitHub, portfolio and
 * socials in `text` with neutral placeholders. Unconditional: callers that
 * honour the profile toggle should use `redactIfEnabled` / `anonymizeContext`.
 *
 * @param {string} text
 * @param {string} profileYmlText - raw content of config/profile.yml
 * @returns {string}
 */
export function redactCandidatePII(text, profileYmlText) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const rule of buildRules(profileYmlText)) {
    out = out.replace(rule.find, rule.placeholder || PLACEHOLDERS[rule.kind]);
  }
  return out;
}

/**
 * Reverse `redactCandidatePII`: put the candidate's real details back in place
 * of the placeholders. Use on model output that is delivered to the candidate
 * or a recruiter (e.g. the tailored CV).
 *
 * @param {string} text
 * @param {string} profileYmlText - raw content of config/profile.yml
 * @returns {string}
 */
export function restoreCandidatePII(text, profileYmlText) {
  if (!text || typeof text !== 'string') return text;
  const seen = new Set();
  let out = text;
  for (const rule of buildRules(profileYmlText)) {
    const placeholder = rule.placeholder || PLACEHOLDERS[rule.kind];
    if (seen.has(placeholder)) continue; // phone variants share one placeholder
    seen.add(placeholder);
    const isUrl = URL_KINDS.includes(rule.kind);
    const escaped = escapeRegex(placeholder);
    const re = isUrl
      ? new RegExp(`${URL_PREFIX}${escaped}(?![\\w-])`, 'gi')
      : new RegExp(escaped, 'gi');
    out = out.replace(re, () => rule.original);
  }
  return out;
}

/**
 * Redact only when the profile opts in via `privacy.redact_contact_info`.
 *
 * @param {string} text
 * @param {string} profileYmlText
 * @returns {string}
 */
export function redactIfEnabled(text, profileYmlText) {
  return isRedactionEnabled(profileYmlText) ? redactCandidatePII(text, profileYmlText) : text;
}

/**
 * Restore real details only when the profile opted in to redaction.
 *
 * @param {string} text
 * @param {string} profileYmlText
 * @returns {string}
 */
export function restoreIfEnabled(text, profileYmlText) {
  return isRedactionEnabled(profileYmlText) ? restoreCandidatePII(text, profileYmlText) : text;
}

/**
 * Redact the `cv`, `profile` and `profileMode` strings of a context object,
 * when the profile opts in. Returns a new object; the input is not mutated.
 *
 * @param {{cv?: string, profile?: string, profileMode?: string}} ctx
 * @returns {object}
 */
export function anonymizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const profileYml = ctx.profile || '';
  if (!isRedactionEnabled(profileYml)) return ctx;

  const out = { ...ctx };
  for (const key of ['cv', 'profile', 'profileMode']) {
    if (out[key]) out[key] = redactCandidatePII(out[key], profileYml);
  }
  return out;
}
