// @ts-check
/**
 * _trust-validator.mjs — Lightweight trust validation for scanned job postings.
 *
 * Enriches each job with trustScore (0-100), trustFlags (string[]), and
 * trustLevel ('high' | 'medium' | 'low'). Never drops jobs — flag only.
 *
 * Underscore prefix keeps scan.mjs's provider loader from importing this
 * as a job-board provider.
 *
 * V1 heuristics:
 *   1. URL structure validation
 *   2. Missing application URL
 *   3. Suspicious domain detection
 *   4. Company ↔ domain mismatch (with ATS allowlist)
 */

/** @type {string[]} */
const DEFAULT_SUSPICIOUS_DOMAINS = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'forms.gle',
  'goo.gl',
  'shorturl.at',
  'rebrand.ly',
  'cutt.ly',
];

/** @type {string[]} */
const DEFAULT_ATS_ALLOWLIST = [
  'greenhouse.io',
  'ashbyhq.com',
  'lever.co',
  'workday.com',
  'smartrecruiters.com',
  'jobvite.com',
  'myworkdayjobs.com',
  'recruitee.com',
  'workable.com',
  'icims.com',
  'taleo.net',
  'applytojob.com',
  'breezy.hr',
  'jazz.co',
  'bamboohr.com',
  'teamtailor.com',
];

/** @type {Record<string, number>} */
const PENALTIES = {
  invalid_url: 50,
  missing_apply_url: 40,
  suspicious_domain: 25,
  company_domain_mismatch: 15,
};

/**
 * Classify a numeric trust score into a human-readable level.
 *
 * @param {number} score
 * @returns {'high' | 'medium' | 'low'}
 */
export function classifyTrustLevel(score) {
  if (score >= 90) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

/**
 * Check whether a URL string is well-formed and uses http(s).
 *
 * @param {string} url
 * @returns {{ valid: boolean, flag?: string }}
 */
export function validateUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, flag: 'invalid_url' };
    }
    return { valid: true };
  } catch {
    return { valid: false, flag: 'invalid_url' };
  }
}

/**
 * Check whether a hostname matches or is a subdomain of any entry in a
 * domain list.  E.g. hostname "abc.bit.ly" matches blocklist entry "bit.ly".
 *
 * @param {string} hostname — lowercased hostname from URL
 * @param {string[]} domainList
 * @returns {boolean}
 */
export function matchesDomainList(hostname, domainList) {
  for (const domain of domainList) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return true;
    }
  }
  return false;
}

/**
 * Heuristic: does the company name plausibly match the URL hostname?
 *
 * Strips non-alphanumeric chars from the company name, lowercases, and checks
 * whether the result (or any word ≥3 chars) appears as a substring of the
 * hostname.  Returns true when a match is found (= no mismatch flag needed).
 *
 * @param {string} company
 * @param {string} hostname
 * @returns {boolean} true if company matches hostname
 */
export function companyMatchesHostname(company, hostname) {
  if (!company || !hostname) return true; // can't evaluate → no flag

  const normalized = company.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (!normalized) return true;

  // Full slug check (all spaces removed)
  const slug = normalized.replace(/\s+/g, '');
  if (hostname.includes(slug)) return true;

  // Word-level check — any word ≥3 chars present in hostname
  const words = normalized.split(/\s+/).filter(w => w.length >= 3);
  for (const word of words) {
    if (hostname.includes(word)) return true;
  }

  return false;
}

/**
 * Build a trust validator function from portals.yml config.
 *
 * Usage mirrors buildLocationFilter / buildSalaryFilter in scan.mjs.
 *
 * @param {object} [config]
 * @param {boolean} [config.enabled]
 * @param {string[]} [config.suspicious_domains]
 * @param {string[]} [config.ats_allowlist]
 * @returns {(job: { url?: string, company?: string }) => { score: number, flags: string[], level: 'high' | 'medium' | 'low' }}
 */
export function buildTrustValidator(config) {
  // Disabled or absent config → return a no-op that gives every job 100/high
  if (!config || config.enabled === false) {
    return () => ({ score: 100, flags: [], level: /** @type {const} */ ('high') });
  }

  const suspiciousDomains = (Array.isArray(config.suspicious_domains)
    ? config.suspicious_domains
    : DEFAULT_SUSPICIOUS_DOMAINS)
    .map(d => String(d).toLowerCase().trim())
    .filter(Boolean);

  const atsAllowlist = (Array.isArray(config.ats_allowlist)
    ? config.ats_allowlist
    : DEFAULT_ATS_ALLOWLIST)
    .map(d => String(d).toLowerCase().trim())
    .filter(Boolean);

  return (job) => {
    /** @type {string[]} */
    const flags = [];
    let score = 100;

    const url = typeof job.url === 'string' ? job.url.trim() : '';

    // Rule 1 — Missing URL
    if (!url) {
      flags.push('missing_apply_url');
      score -= PENALTIES.missing_apply_url;
      // Can't run further URL-based checks
      const clamped = Math.max(0, score);
      return { score: clamped, flags, level: classifyTrustLevel(clamped) };
    }

    // Rule 2 — URL structure validation
    const urlCheck = validateUrl(url);
    if (!urlCheck.valid) {
      flags.push('invalid_url');
      score -= PENALTIES.invalid_url;
      // Can't parse hostname → skip domain checks
      const clamped = Math.max(0, score);
      return { score: clamped, flags, level: classifyTrustLevel(clamped) };
    }

    // Parse hostname for domain checks
    let hostname = '';
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      // Already validated above, but guard defensively
      const clamped = Math.max(0, score);
      return { score: clamped, flags, level: classifyTrustLevel(clamped) };
    }

    // Rule 3 — Suspicious domain detection
    if (matchesDomainList(hostname, suspiciousDomains)) {
      flags.push('suspicious_domain');
      score -= PENALTIES.suspicious_domain;
    }

    // Rule 4 — Company ↔ domain mismatch (skip for ATS-hosted URLs)
    const company = typeof job.company === 'string' ? job.company.trim() : '';
    if (company && !matchesDomainList(hostname, atsAllowlist)) {
      if (!companyMatchesHostname(company, hostname)) {
        flags.push('company_domain_mismatch');
        score -= PENALTIES.company_domain_mismatch;
      }
    }

    score = Math.max(0, Math.min(100, score));
    return { score, flags, level: classifyTrustLevel(score) };
  };
}
