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
/**
 * Is `host` this domain or a subdomain of it? Compared label-wise, because a
 * substring test reads `evillinkedin.com` as LinkedIn — and for a rewrite that
 * is worse than a missed match: the foreign URL is replaced by a plausible board
 * URL and takes the real posting's place in the dedupe key.
 * @param {string} host lowercased hostname
 * @param {string} domain registrable domain, e.g. 'linkedin.com'
 * @returns {boolean}
 */
function isHostOf(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isCleanUrl(url) {
  try {
    const u = new URL(url);
    const lowerUrl = url.toLowerCase();
    const badKeywords = [
      'click', 'track', 'openpixel', 'sendgrid', 'unsubscribe', 'optout',
      'newsletter', 'subscribe', 'w3.org', 'doubleclick', 'googlesyndication',
      'googleadservices', 'mailgun', 'mandrill', 'mjml', 'github.com/login',
      'linkedin.com/legal', 'linkedin.com/help', 'linkedin.com/settings',
      'linkedin.com/comm/psettings', 'linkedin.com/comm/jobs/search',
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
    // file. Only reachable since digest bodies are transfer-decoded — before that
    // the URL arrived truncated at the fold and failed to parse at all.
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
 * anywhere in it: `dmarc=fail reason="not dmarc=pass"` is a real shape, and a
 * `header.from` inside a parenthesised note is not the verified one.
 *
 * Fail-closed where Gmail's own formatting does not reach: a `header.from` in a
 * clause of its own, rather than alongside the `dmarc=pass` it belongs to, is not
 * read.
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
 * Recursively decode a Gmail message payload's base64url body parts to text.
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-sender digest parsers
//
// The generic `extractUrls().filter(isCleanUrl)` path treats a message as a bag
// of links. That is right for a one-off "saw this, thought of you" mail and wrong
// for a digest: LinkedIn's job alert states the title, company and location of
// every posting in its own body, and flattening it to URLs throws all three away.
// The lead then lands in the pipeline as `Job lead (email)` with an empty company,
// which cannot be ranked, deduped against a scanned posting, or read at a glance —
// it has to be opened by hand to find out what it even is.
//
// Two rules hold for every parser below:
//
//   1. A field the digest does not state stays ''. Never inferred from the URL
//      slug, the subject line, or a neighbouring entry. A wrong company name is
//      worse than a blank one: blank is visibly missing, wrong is silently acted on.
//   2. Every parser is exercised against a fixture under tests/, never a live
//      mailbox. The fixtures are redacted real digests, so a layout change upstream
//      shows up as a failing test rather than as leads quietly losing their titles.

/**
 * Decode a quoted-printable body.
 *
 * Needed because Gmail hands some parts through with their transfer encoding
 * intact, and quoted-printable does two things that break a line-oriented parse:
 * it folds long lines with a trailing `=` (which splits a job URL across two
 * lines mid-token) and it escapes every non-ASCII byte as `=XX` (which turns a
 * Traditional Chinese job title into `=E3=80=90TW=E3=80=91…`). Decoding is done
 * byte-wise and only then read as UTF-8, because one CJK character is three
 * separate `=XX` escapes and decoding them individually yields mojibake.
 * @param {string} text
 * @returns {string}
 */
export function decodeQuotedPrintable(text) {
  const unfolded = text.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < unfolded.length; i++) {
    const ch = unfolded[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    for (const b of Buffer.from(ch, 'utf-8')) bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf-8');
}

const partHeader = (part, name) =>
  (part?.headers || []).find(h => h.name?.toLowerCase() === name)?.value || '';

/**
 * Decode one MIME part's own body: base64url off the wire, then its declared
 * transfer encoding. Shared by both readers below so the generic URL sweep and
 * the digest parsers see the *same* text. They did not before: the sweep read a
 * quoted-printable Indeed alert raw, so `jk=3Dc3626a…` canonicalized into a
 * plausible-looking `viewjob?jk=3dc3626a…` — a corrupt second copy of a posting
 * the parser had already described correctly.
 *
 * Only a part that *declares* quoted-printable is decoded. Sniffing the content
 * for a trailing-`=` fold looks tempting and is wrong in the common case: RFC 2045
 * makes 7bit the default, plenty of senders omit the header entirely, and an
 * ordinary 7bit body that happens to wrap after `?gh_src=` would then have the
 * fold eaten and `=ab` read as a byte — corrupting URLs on the generic sweep for
 * every sender, not just the two with parsers. Gmail's `format=full` gives every
 * part its headers, so a part that really is quoted-printable says so.
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
 * Decode ONLY the `text/plain` part of a Gmail payload (first one found, depth
 * first). Digests lay their jobs out cleanly in plain text while the HTML part is
 * table soup, so this is the surface the parsers read. Returns '' when the message
 * has no plain-text alternative — callers fall back to the generic URL path.
 * @param {any} payload
 * @returns {string}
 */
export function getPlainTextBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodePartText(payload);
  for (const part of payload.parts || []) {
    const text = getPlainTextBody(part);
    if (text) return text;
  }
  return '';
}

/**
 * Reduce a board's click-tracking link to the canonical posting URL.
 *
 * Needed because the same posting reaches the pipeline by two routes — a parsed
 * digest lead and the generic URL sweep of the same message — under two different
 * spellings. LinkedIn wraps its links as `/comm/jobs/view/<id>?trk=…` with a
 * per-send `trk`, so a plain string dedupe sees a new job on every digest. The
 * numeric id after `jobs/view/` is the stable identity; `jk` is Indeed's.
 *
 * Anything unrecognized is returned unchanged: this canonicalizes, it does not
 * filter, and a URL it does not understand must survive intact.
 * @param {string} url
 * @returns {string}
 */
export function canonicalizeJobUrl(url) {
  if (!url) return url;
  let host, rest;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return url;
    host = u.hostname.toLowerCase();
    rest = u.pathname + u.search;
  } catch {
    return url;
  }
  if (isHostOf(host, 'linkedin.com')) {
    const id = rest.match(/jobs\/view\/(\d+)/);
    if (id) return `https://www.linkedin.com/jobs/view/${id[1]}`;
  }
  if (isHostOf(host, 'indeed.com')) {
    const jk = rest.match(/[?&]jk=([0-9a-f]{10,20})/i);
    if (jk) return `https://www.indeed.com/viewjob?jk=${jk[1].toLowerCase()}`;
  }
  return url;
}

const LINKEDIN_ANCHOR = /view job:\s*(https?:\/\/\S*?jobs\/view\/(\d+))/i;

/**
 * Parse `{ url, title, company, location }` per posting from a LinkedIn job-alert
 * digest's plain-text part.
 *
 * LinkedIn lays each posting out as three consecutive lines — title, company,
 * location — then a blank line, then a variable amount of furniture (a "this
 * company is actively hiring" proof line, an "Apply with your profile" CTA, a
 * matched-skills line), then `View job: <url>`.
 *
 * The parse anchors on `View job:` and walks *up* to the blank separator rather
 * than enumerating the furniture, because the furniture varies per posting and per
 * send while the blank line does not. Two shapes are accepted and no others:
 * three lines above the separator (title/company/location) or two (title/company,
 * location genuinely absent → stays ''). Anything else is skipped and left to the
 * generic URL path — a lead with a wrong title is worse than an untitled one.
 * @param {string} plainText
 * @returns {Array<{ url: string, title: string, company: string, location: string }>}
 */
export function parseLinkedInDigest(plainText) {
  if (!plainText) return [];
  const lines = plainText.split(/\r?\n/).map(line => line.trim());
  const jobs = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const anchor = lines[i].match(LINKEDIN_ANCHOR);
    if (!anchor) continue;
    const id = anchor[2];
    if (seen.has(id)) continue;

    // Walk up past the furniture to the blank separator. Crossing another
    // posting's anchor means this one has no separator of its own — the digest
    // dropped a blank — and walking on would read the neighbour's fields.
    let sep = i - 1;
    let guard = 0;
    while (sep >= 0 && lines[sep] !== '' && guard < 6) {
      if (LINKEDIN_ANCHOR.test(lines[sep])) { sep = -1; break; }
      sep--; guard++;
    }
    if (sep < 0 || lines[sep] !== '') continue;

    // The run above the separator must be the whole shape and nothing else:
    // exactly three lines (title/company/location) or two (location genuinely
    // absent), bounded above by a blank line or the start of the message. A run
    // of four — an estimated-salary line, a promoted label — is a shape this
    // parser does not know, and reading the bottom three of it silently
    // relabels every field: the location becomes the salary, the company
    // becomes the location.
    const block = [];
    let top = sep - 1;
    while (top >= 0 && lines[top] !== '' && block.length <= 3) { block.push(lines[top]); top--; }
    if (block.length < 2 || block.length > 3) continue;
    if (block.some(line => LINKEDIN_ANCHOR.test(line))) continue;

    const [location, company, title] = block.length === 3 ? block : ['', block[0], block[1]];
    seen.add(id);
    jobs.push({
      url: `https://www.linkedin.com/jobs/view/${id}`,
      title: cut(title, 160),
      company: cut(company, 80),
      location: cut(location, 80),
    });
  }
  return jobs;
}

const INDEED_ANCHOR = /^(https?:\/\/\S*[?&]jk=([0-9a-f]{10,20})\S*)$/i;

/**
 * Parse `{ url, title, company, location }` per posting from an Indeed job-alert
 * email's plain-text part.
 *
 * Indeed lays each posting out as a block separated from its neighbours by blank
 * lines, with a fixed order at the top and a variable tail:
 *
 *     【TW】資深客戶成功經理 (BP) Senior Customer Success Manager (BP)
 *     漸強實驗室 Crescendo Lab Ltd. - 台北市
 *     … description excerpt, which wraps and is sometimes several lines
 *     1天前
 *     https://tw.indeed.com/rc/clk/dl?jk=c3626a655de4a873&from=ja&qd=…
 *
 * Only the first two lines of a block are read. The tail varies — the description
 * excerpt wraps, the recency line is localized and sometimes absent, and Indeed
 * inserts an estimated-salary line on some postings — so counting up from the URL
 * would land on a different field depending on which of those a posting happens to
 * carry. Counting down from the top of the block does not.
 *
 * The company line is split on its LAST ` - `, because a company name may contain
 * one ("Acme - Taiwan Branch - 台北市") while the trailing location does not.
 * A block with no ` - ` is all company and no location, which is left as ''.
 *
 * Anchored on `jk=`: the "See matching results on Indeed" link at the top of the
 * digest and every footer link carry no job id, so they cannot open a block.
 * @param {string} plainText
 * @returns {Array<{ url: string, title: string, company: string, location: string }>}
 */
export function parseIndeedAlert(plainText) {
  if (!plainText) return [];
  const lines = plainText.split(/\r?\n/).map(line => line.trim());
  const jobs = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const anchor = lines[i].match(INDEED_ANCHOR);
    if (!anchor) continue;
    const id = anchor[2].toLowerCase();
    if (seen.has(id)) continue;

    // Walk up to the blank line that opens this posting's block, then read the
    // block downward. The guard stops a malformed digest from swallowing the
    // whole message; no observed block runs longer than this.
    let top = i - 1;
    let guard = 0;
    while (top >= 0 && lines[top] !== '' && guard < 8) {
      // Same reason as LinkedIn: crossing the previous posting's URL means this
      // block has no opening blank of its own, and the lines above belong to
      // the neighbour.
      if (INDEED_ANCHOR.test(lines[top])) { top = -1; break; }
      top--; guard++;
    }
    if (top < 0 || lines[top] !== '') continue;

    const block = [];
    for (let j = top + 1; j < i; j++) block.push(lines[j]);
    if (block.length < 2) continue;

    const [title, companyLine] = block;
    // A block whose second line is itself a URL is not the shape this parser
    // knows; leaving it to the generic path beats guessing at a company name.
    if (!title || /^https?:\/\//i.test(companyLine)) continue;

    const split = companyLine.lastIndexOf(' - ');
    const company = split === -1 ? companyLine : companyLine.slice(0, split);
    const location = split === -1 ? '' : companyLine.slice(split + 3);

    seen.add(id);
    jobs.push({
      url: `https://www.indeed.com/viewjob?jk=${id}`,
      title: cut(title, 160),
      company: cut(company.trim(), 80),
      location: cut(location.trim(), 80),
    });
  }
  return jobs;
}

// Verified sending domain → parser. A digest forwarded from a personal address
// authenticates as that address, so it does not get parsed with LinkedIn's layout.
// slice() counts UTF-16 code units, so a cut landing between an emoji's two
// surrogates leaves a lone half that serializes as U+FFFD. Count code points.
const cut = (text, max) => Array.from(text).slice(0, max).join('');

const DIGEST_PARSERS = [
  { id: 'linkedin', domain: /^([a-z0-9-]+\.)*linkedin\.com$/, parse: parseLinkedInDigest },
  { id: 'indeed', domain: /^([a-z0-9-]+\.)*indeed\.com$/, parse: parseIndeedAlert },
];

/**
 * The domain Gmail's DMARC check actually verified.
 *
 * Dispatching on the From header instead is a losing game. The display name is
 * attacker-chosen and RFC 5322 lets it carry angle brackets, nested comments and
 * a mailbox-list, so every parse of it is a differential someone can sit in:
 * `<evil@example.test> (a (b) <jobs@linkedin.com>)` and
 * `<evil@example.test>, <jobs@linkedin.com>` are both legal, both delivered from
 * example.test, and both readable as LinkedIn by a reasonable parse. Landing there
 * means an attacker-controlled body reaches a parser that writes titles and
 * company names into the user's pipeline, and DMARC does not help — it
 * authenticates example.test, which the attacker owns.
 *
 * `header.from=` inside *Gmail's own* `dmarc=pass` clause is the one domain nobody
 * can claim without controlling it. The authserv-id check above is what makes that
 * true; without it the sender can supply the clause themselves.
 * @param {Array<{ name: string, value: string }>} headers
 * @returns {string} the verified domain, lowercased, or '' when DMARC did not pass
 */
function authenticatedFromDomain(headers) {
  const domain = gmailDmarcClause(headers).match(/header\.from\s*=\s*"?([a-z0-9.-]+)/i);
  return domain ? domain[1].toLowerCase().replace(/\.$/, '') : '';
}

/**
 * Dispatch a message to its sender's digest parser and return titled leads.
 * Returns [] for any sender without one, and for a message whose plain-text part
 * the parser could not read — in both cases the caller falls back to the generic
 * URL sweep, so a parser that stops matching degrades to today's behaviour rather
 * than dropping the mail.
 * @param {Array<{ name: string, value: string }>} headers
 * @param {any} payload
 * @returns {Array<{ url: string, title: string, company: string, location: string }>}
 */
export function parseDigestLeads(headers, payload) {
  const domain = authenticatedFromDomain(headers);
  if (!domain) return [];
  const parser = DIGEST_PARSERS.find(p => p.domain.test(domain));
  if (!parser) return [];
  const plain = getPlainTextBody(payload);
  if (!plain) return [];
  return parser.parse(plain);
}
