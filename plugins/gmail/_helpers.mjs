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
    // Alert-management hosts. These carry the recipient's own alert/unsubscribe
    // token in the query string: not a posting, and not something to write into a
    // file. Only reachable since quoted-printable parts are decoded — before that
    // the URL arrived cut at the fold (`https://subscriptio=`).
    if (/^subscriptions?\./.test(host)) return false;
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Gmail stamps its own verdict with the authserv-id `mx.google.com`. RFC 8601 §5
// only requires a receiver to strip Authentication-Results headers claiming its
// OWN authserv-id, so a header the sender wrote under any other id survives
// delivery byte-for-byte: `Authentication-Results: evil.test; dmarc=pass
// header.from=linkedin.com` arrives exactly as sent, sitting below Gmail's real
// verdict. Reading those is letting the sender grade their own homework.
/** Gmail's own authserv-id, with the optional RFC 8601 authres-version. */
const GMAIL_AUTHSERV_ID = /^mx\.google\.com(?:\s+\d+)?$/i;

/**
 * Split an Authentication-Results value into its clauses in one pass, dropping
 * comments and respecting quoted strings.
 *
 * Both matter for a security decision. `smtp.mailfrom=` carries the sender's own
 * MAIL FROM, and RFC 5321 lets a quoted local-part hold `;`, so a naive split
 * would let a sender forge a clause boundary and open a clause of their own.
 * Comments nest, so they are tracked with a depth counter rather than a repeated
 * regex — linear in the length of the value however deeply they are nested.
 * @param {string} value
 * @returns {string[]} clauses, in order, trimmed
 */
function authResultsClauses(value) {
  const clauses = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length && (quoted || depth > 0)) {
      if (depth === 0) current += ch + value[i + 1];
      i++;
      continue;
    }
    if (quoted) {
      current += ch;
      if (ch === '"') quoted = false;
      continue;
    }
    if (depth > 0) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      continue;
    }
    if (ch === '(') { depth++; current += ' '; continue; }
    if (ch === '"') { quoted = true; current += ch; continue; }
    if (ch === ';') { clauses.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  clauses.push(current.trim());
  return clauses;
}

/**
 * Gmail's own DMARC clause, when it passed. '' otherwise — including when Gmail
 * reported a failure, when the domain publishes no DMARC record at all, and when
 * the only Authentication-Results present were written by someone else.
 *
 * The clause is read whole rather than by scanning the header for `dmarc=pass`
 * anywhere in it: `dmarc=fail reason="not dmarc=pass"` is a real shape.
 * @param {Array<{ name: string, value: string }>} headers
 * @returns {string} the `dmarc=pass …` clause, or ''
 */
function gmailDmarcClause(headers) {
  for (const h of Array.isArray(headers) ? headers : []) {
    if (h?.name?.toLowerCase() !== 'authentication-results') continue;
    const clauses = authResultsClauses(h.value || '');
    if (!GMAIL_AUTHSERV_ID.test(clauses[0])) continue;
    for (const clause of clauses.slice(1)) {
      if (/^dmarc\s*=\s*pass\b/i.test(clause)) return clause;
    }
    // Gmail spoke and it was not a pass. No header below it overrides that.
    return '';
  }
  return '';
}

/**
 * DMARC alignment check (anti-spoof gate, fail-closed). Only mail whose *Gmail*
 * Authentication-Results header reports dmarc=pass is trusted; a header carrying
 * any other authserv-id is the sender's own claim and is ignored.
 * @param {Array<{ name: string, value: string }>} headers
 * @returns {boolean}
 */
export function isAuthenticEmail(headers) {
  if (!Array.isArray(headers)) return false;
  return gmailDmarcClause(headers) !== '';
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
 * Decode a quoted-printable body.
 *
 * Needed because Gmail hands some parts through with their transfer encoding
 * intact, and quoted-printable does two things that break the URL sweep: it
 * folds long lines with a trailing `=` (which splits a job URL across two lines
 * mid-token) and it escapes every `=` in a query string as `=3D` (so `jk=c3626a…`
 * arrives as `jk=3Dc3626a…`, a plausible-looking id for a posting that does not
 * exist). Decoding is done byte-wise and only then read as UTF-8, because one CJK
 * character is three separate `=XX` escapes and decoding them individually
 * yields mojibake.
 * @param {string} text
 * @returns {string}
 */
export function decodeQuotedPrintable(text) {
  const unfolded = text.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < unfolded.length; i++) {
    if (unfolded[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    // A code point, not a code unit. Quoted-printable is supposed to escape every
    // non-ASCII byte, but senders emit raw UTF-8 in these parts anyway, and an
    // astral character is two UTF-16 halves — encoding each half alone yields two
    // U+FFFD.
    const cp = String.fromCodePoint(/** @type {number} */ (unfolded.codePointAt(i)));
    for (const b of Buffer.from(cp, 'utf-8')) bytes.push(b);
    i += cp.length - 1;
  }
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * @param {any} part
 * @param {string} name lowercased header name
 */
const partHeader = (part, name) =>
  (part?.headers || []).find(h => h.name?.toLowerCase() === name)?.value || '';

/**
 * Decode one MIME part's own body: base64url off the wire, then its declared
 * transfer encoding.
 *
 * Only a part that *declares* quoted-printable is decoded. Sniffing the content
 * for a trailing-`=` fold looks tempting and is wrong in the common case: RFC 2045
 * makes 7bit the default, plenty of senders omit the header entirely, and an
 * ordinary 7bit body that happens to wrap after `?gh_src=` would then have the
 * fold eaten and `=ab` read as a byte. Gmail's `format=full` gives every part its
 * headers, so a part that really is quoted-printable says so.
 * @param {any} part
 * @returns {string}
 */
function decodePartText(part) {
  if (!part?.body?.data) return '';
  const base64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
  const text = Buffer.from(base64, 'base64').toString('utf-8');
  const encoding = partHeader(part, 'content-transfer-encoding').trim().toLowerCase();
  return encoding === 'quoted-printable' ? decodeQuotedPrintable(text) : text;
}

/**
 * Recursively decode a Gmail message payload's body parts to text: base64url,
 * then each part's declared transfer encoding.
 * @param {any} payload
 * @returns {string}
 */
export function getMessageBody(payload) {
  if (!payload) return '';
  let body = decodePartText(payload);
  for (const part of payload.parts || []) body += getMessageBody(part);
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
