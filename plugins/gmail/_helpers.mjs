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

/** File types that are page furniture (logos, webfonts, media), never a posting. */
const ASSET_EXT_RE =
  /\.(jpe?g|png|gif|svg|webp|avif|ico|bmp|tiff?|css|js|mjs|woff2?|ttf|otf|eot|mp4|webm|mp3|wav)(\?|#|$)/i;

/** Subdomains that only ever serve static files. */
const ASSET_HOST_PREFIXES = ['cdn.', 'static.', 'assets.', 'img.', 'images.', 'media.'];

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
      // LinkedIn digest chrome: the header/footer/promo links every alert email
      // carries. They are not postings, and unlike the real job cards they have
      // no trackingId, so they sail through every other check.
      'linkedin.com/comm/feed', 'linkedin.com/comm/messaging',
      'linkedin.com/comm/mynetwork', 'linkedin.com/comm/notifications',
      'linkedin.com/comm/widgets', 'linkedin.com/comm/jobs/alerts',
      'linkedin.com/comm/jobs/search-results',
    ];
    if (badKeywords.some(kw => lowerUrl.includes(kw))) return false;
    // Page assets, not postings. Job-alert emails embed one company logo per job,
    // and those URLs pass every check above: https, no tracker keyword, hosted on
    // the board's own domain. They land in the pipeline as untitled "job leads" you
    // have to click to discover are 160x160 PNGs. Extension check first (query
    // string included, since CDNs append cache-busters), then the CMS upload paths
    // and asset subdomains that serve files without one.
    const host = u.hostname.toLowerCase();
    if (ASSET_EXT_RE.test(u.pathname + u.search)) return false;
    if (/\/(wp-content|wp-includes)\//i.test(u.pathname)) return false;
    if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') return false;
    if (ASSET_HOST_PREFIXES.some(prefix => host.startsWith(prefix))) return false;
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

/**
 * Canonical LinkedIn posting URL, or '' if the URL is not a job view.
 * `/comm/jobs/view/{id}/?trackingId=...` → `https://www.linkedin.com/jobs/view/{id}`.
 * Dropping the query is what makes these usable: the tracking params differ per
 * email, so two alerts for the same job would otherwise look like two leads, and
 * `trackingId` trips isCleanUrl's 'track' keyword — which is why the real job
 * cards were the one thing a digest never yielded.
 * @param {string} url
 * @returns {string}
 */
export function canonicalLinkedInJobUrl(url) {
  const match = /^https?:\/\/(?:[\w-]+\.)*linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i.exec(url || '');
  return match ? `https://www.linkedin.com/jobs/view/${match[1]}` : '';
}

/** Card badges LinkedIn prints under the location line ("Fast growing", etc.). */
const LI_BADGE_RE =
  /^(fast growing|actively recruiting|easy apply|promoted|viewed|be an early applicant|your profile matches|alum works here|school alum works here|\$|€|£)/i;

/**
 * Parse the job cards out of a LinkedIn job-alert digest's plain-text part.
 *
 * Each card is four lines and a link, separated by a rule:
 *
 *     Senior Manager, Center of Expertise
 *     Veeam Software
 *     United States
 *     Fast growing                        <- optional badge lines
 *     View job: https://www.linkedin.com/comm/jobs/view/4430024078/?trackingId=...
 *     ---------------------------------------------------------
 *
 * Pulling title/company per card is the point: the subject line names only the
 * first job, so seeding every URL in the email from it (what the generic path
 * does) labels 20 unrelated postings with one company's name.
 *
 * @param {string} body Decoded message body (plain-text part included).
 * @returns {Array<{ title: string, url: string, company: string, location: string }>}
 */
export function parseLinkedInAlert(body) {
  if (!body) return [];
  const jobs = [];
  const seen = new Set();
  for (const chunk of body.split(/^-{10,}\s*$/m)) {
    const lines = chunk.split(/\r?\n/).map(l => l.trim());
    const urlIdx = lines.findIndex(l => /https?:\/\/\S*\/jobs\/view\/\d+/i.test(l));
    if (urlIdx === -1) continue;
    const url = canonicalLinkedInJobUrl(
      (/https?:\/\/\S+/.exec(lines[urlIdx]) || [''])[0].replace(/&amp;/g, '&'),
    );
    if (!url || seen.has(url)) continue;
    // Drop the digest's own header ("Your job alert for ...") so the first card
    // on the page does not inherit it as a title.
    const before = lines
      .slice(0, urlIdx)
      .filter(Boolean)
      .filter(l => !/^(your job alert|new jobs match|\d+ new jobs)/i.test(l));
    if (!before.length) continue;
    const [title, company = '', location = ''] = before;
    seen.add(url);
    jobs.push({
      title,
      url,
      company: LI_BADGE_RE.test(company) ? '' : company,
      // ponytail: positional — title/company/location in order, badges after.
      // A card that omits its location would shift a badge into this slot, so
      // badge-looking values are dropped rather than trusted.
      location: LI_BADGE_RE.test(location) ? '' : location,
    });
  }
  return jobs;
}
