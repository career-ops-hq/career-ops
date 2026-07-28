// @ts-check
// Pure, side-effect-free Gmail helpers. Ported verbatim from the gmail-helpers
// contributed by @SparshGarg999 in #1203 (with thanks). Files prefixed with _
// are never discovered as plugins.

/**
 * Extract all http/https URLs from a string (plain text or HTML). Normalizes
 * &amp; and strips trailing punctuation. Dedups.
 * @param {string} body
 * @returns {string[]}
 */
export function extractUrls(body) {
  if (!body) return [];
  const urls = [];
  const regex = /https?:\/\/[^\s"'<>\(\)]+/gi;
  let match;
  while ((match = regex.exec(body)) !== null) {
    const url = match[0].replace(/[.,;:!?]+$/, '').replace(/&amp;/g, '&');
    urls.push(url);
  }
  return [...new Set(urls)];
}

/**
 * Is a URL clean and relevant (not a click tracker, unsubscribe link, or pixel)?
 * @param {string} url
 * @returns {boolean}
 */
export function isCleanUrl(url) {
  try {
    const u = new URL(url);
    const lowerUrl = url.toLowerCase();
    const badKeywords = [
      'click', 'track', 'openpixel', 'sendgrid', 'unsubscribe', 'optout',
      'newsletter', 'subscribe', 'w3.org', 'doubleclick', 'googlesyndication',
      'googleadservices', 'mailgun', 'mandrill', 'mjml', 'github.com/login',
      'linkedin.com/legal', 'linkedin.com/help', 'linkedin.com/settings',
    ];
    if (badKeywords.some(kw => lowerUrl.includes(kw))) return false;
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * DMARC alignment check (anti-spoof gate, fail-closed). Only emails whose
 * Authentication-Results header reports dmarc=pass are trusted.
 * @param {Array<{ name: string, value: string }>} headers
 * @returns {boolean}
 */
export function isAuthenticEmail(headers) {
  if (!Array.isArray(headers)) return false;
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === 'authentication-results') {
      if (h.value && /dmarc=pass/i.test(h.value)) return true;
    }
  }
  return false;
}

/**
 * Parse "{Role} at {Company}" from a subject line.
 * @param {string} subject
 * @returns {{ role: string, company: string } | null}
 */
export function parseRoleAtCompany(subject) {
  if (!subject) return null;
  let clean = subject.replace(/^(re|fwd|new match|job alert|alert|match|notification|alert for|daily alert for):\s*/i, '').trim();
  clean = clean.split(/\s+[-|]\s+/)[0].trim();
  const match = clean.match(/^(.+?)\s+at\s+(.+)$/i);
  if (match) {
    const role = match[1].trim();
    const company = match[2].trim();
    if (role && company && role.length < 100 && company.length < 100) {
      return { role, company };
    }
  }
  return null;
}

/**
 * Recursively decode a Gmail message payload's base64url body parts to text.
 * @param {any} payload
 * @returns {string}
 */
export function getMessageBody(payload) {
  if (!payload) return '';
  let body = '';
  if (payload.body && payload.body.data) {
    const base64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
    body += Buffer.from(base64, 'base64').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) body += getMessageBody(part);
  }
  return body;
}

/**
 * Best-effort company name from a known ATS URL (greenhouse/lever slug).
 * @param {string} url
 * @returns {string}
 */
export function companyFromUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'boards.greenhouse.io' || hostname.endsWith('.greenhouse.io') ||
        hostname === 'jobs.lever.co' || hostname.endsWith('.lever.co')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length > 0) return parts[0];
    }
  } catch { /* malformed → no company */ }
  return '';
}
