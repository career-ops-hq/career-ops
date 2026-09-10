// Portals write closure banners with typographic punctuation and accents:
// WTTJ renders "Cette offre n’est plus disponible." with U+2019, not ASCII "'".
// A pattern spelled with a plain apostrophe silently never matches, so a clearly
// expired posting fell through to `no_apply_control` → uncertain → never filtered.
// Normalize once at the entry point and spell every pattern below in the
// normalized alphabet: ASCII quotes, no diacritics, collapsed whitespace.
function normalizeForMatch(text = '') {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[‘’ʼ′´`]/g, "'")
    .replace(/[“”″]/g, '"')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

const HARD_EXPIRED_PATTERNS = [
  /job (is )?no longer available/i,
  /job.*no longer open/i,
  // Generalized "filled" signal. The old /position has been filled/ missed the
  // phrasing SPA ATSs (Phenom, e.g. careers.icf.com) inject on a filled req —
  // "the job you are trying to apply for has been filled" — so those pages
  // returned HTTP 200 with a generic Apply control and were classified active.
  // A job noun within 60 chars, then "has been filled" — but NOT when the thing
  // filled is an application/form (the lookbehind) or "filled out" (the
  // lookahead). Both guards avoid the worse error: reading a LIVE posting whose
  // copy says "once the application form has been filled…" as expired.
  /\b(?:job|jobs|position|role|posting|opening|vacancy|requisition|req|listing)\b[\s\S]{0,60}?(?<!\b(?:application|form)\s)has been filled\b(?!\s+out)/i,
  /this job has expired/i,
  /job posting has expired/i,
  /no longer accepting applications/i,
  /this (position|role|job) (is )?no longer/i,
  /this job (listing )?is closed/i,
  /job (listing )?not found/i,
  /the page you are looking for doesn.t exist/i,
  /applications?\s+(?:(?:have|are|is)\s+)?closed/i,
  /closed on \d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  /closed on (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}/i,
  /diese stelle (ist )?(nicht mehr|bereits) besetzt/i,
  // French closure banners. Spelled accent-free on purpose: normalizeForMatch
  // strips diacritics, so "expiree" here matches "expirée" on the page.
  /offre (expiree|n'est plus disponible)/i,
  /(cette )?offre n'est plus (disponible|en ligne|active)/i,
  /(offre|poste|annonce) (deja )?pourvu(e)?/i,
  /offre (cloturee|desactivee|terminee)/i,
  /ce poste n'est plus (disponible|a pourvoir|ouvert)/i,
  /recrutement (termine|cloture)/i,
  /candidatures (closes|cloturees)/i,
];

const LISTING_PAGE_PATTERNS = [
  /\d+\s+jobs?\s+found/i,
  /search for jobs page is loaded/i,
];

// Anti-bot interstitials (Cloudflare "Just a moment...", hCaptcha walls, etc.)
// render a tiny challenge page instead of the posting. Headless Playwright trips
// these on portals like pracuj.pl. They must NOT be read as expired: the body is
// short and lacks an apply control, so without this guard they fall through to
// `insufficient_content` → expired, and scan --verify would write live jobs to
// scan-history and permanently filter them out. Treat as uncertain instead.
const BOT_CHALLENGE_PATTERNS = [
  /just a moment/i,
  /performing security verification/i,
  /checking your browser before/i,
  /verify you are (a |not a )?human/i,
  /enable javascript and cookies to continue/i,
  /attention required.*cloudflare/i,
  /\bray id\b/i,
  /\bcf-ray\b/i,
  /please complete the security check/i,
];

const EXPIRED_URL_PATTERNS = [
  /[?&]error=true/i,
];

const APPLY_PATTERNS = [
  /\bapply\b/i,
  /\bsolicitar\b/i,
  /\bbewerben\b/i,
  /\bpostuler\b/i,
  /submit application/i,
  /easy apply/i,
  /start application/i,
  /ich bewerbe mich/i,
  // Polish (pracuj.pl, justjoin.it, bulldogjob.pl): "Aplikuj" / "Aplikuj teraz" /
  // "Wyślij CV" / "Przejdź do panelu aplikowania". Without these, a fully-loaded
  // Polish posting has no recognized apply control and falls to no_apply_control.
  /\baplikuj\b/i,
  /panelu aplikowania/i,
  // Accent-free: apply controls go through normalizeForMatch too ("wyślij" → "wyslij").
  /wyslij (cv|aplikacj)/i,
  // Chinese MokaHR and Feishu Jobs detail pages use these exact control texts.
  // Keep them narrow: bare “申请” appears in descriptive prose, while longer
  // labels containing “投递” can be status/history controls rather than Apply.
  /^申请职位$/,
  /^投递$/,
];

const MIN_CONTENT_CHARS = 300;

// A job-detail URL almost always carries the posting's identity: a numeric req id
// (Greenhouse, Workday pid, Microsoft) or a UUID (Lever, Ashby). If the requested
// URL had one and the final URL lost it, the browser landed somewhere else.
const JOB_ID_TOKEN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{5,}/gi;

function jobIdToken(url = '') {
  const matches = url.match(JOB_ID_TOKEN);
  return matches ? matches[matches.length - 1].toLowerCase() : null;
}

function firstMatch(patterns, text = '') {
  return patterns.find((pattern) => pattern.test(text));
}

function hasApplyControl(controls = []) {
  return controls.some((control) => APPLY_PATTERNS.some((pattern) => pattern.test(control)));
}

export function classifyLiveness({ status = 0, requestedUrl = '', finalUrl = '', bodyText: rawBodyText = '', applyControls: rawApplyControls = [] } = {}) {
  const bodyText = normalizeForMatch(rawBodyText);
  const applyControls = (Array.isArray(rawApplyControls) ? rawApplyControls : []).map(normalizeForMatch);

  if (status === 404 || status === 410) {
    return { result: 'expired', code: 'http_gone', reason: `HTTP ${status}` };
  }

  // Bot/anti-scraping walls — never expired. Check before the content-length and
  // listing-page heuristics, which would otherwise misread the short challenge
  // body as a dead posting. 403/503 are access-blocked signals, not "gone"
  // (a genuinely removed posting returns 404/410 or a hard-expired banner).
  const botChallenge = firstMatch(BOT_CHALLENGE_PATTERNS, bodyText);
  if (botChallenge) {
    return { result: 'uncertain', code: 'bot_challenge', reason: `anti-bot challenge: ${botChallenge.source}` };
  }
  // 429 belongs with 403/503: rate limiting is the board throttling US, never
  // evidence the posting is gone. Its body is a short "Too Many Requests", well
  // under MIN_CONTENT_CHARS, so without this it fell through to
  // insufficient_content and read as `expired` — and an expired result is
  // written to scan-history as skipped_expired, whose URL every later scan
  // dedup-skips (indefinitely, unless scan_history.recheck_after_days is set).
  // Scanning harder is exactly what earns a 429, so this compounds.
  if (status === 403 || status === 429 || status === 503) {
    return { result: 'uncertain', code: 'access_blocked', reason: `HTTP ${status} (access blocked, likely anti-bot)` };
  }
  // Any other 5xx is a transient origin error (502/504 gateway hiccups, 500s
  // during deploys), not evidence the posting is gone. Without this guard the
  // short error body ("502 Bad Gateway / nginx") falls through to the
  // insufficient-content heuristic and reads as expired — and a false
  // "expired" permanently dedup-filters a real job out of future scans.
  if (status >= 500) {
    return { result: 'uncertain', code: 'server_error', reason: `HTTP ${status} (transient server error)` };
  }

  const expiredUrl = firstMatch(EXPIRED_URL_PATTERNS, finalUrl);
  if (expiredUrl) {
    return { result: 'expired', code: 'expired_url', reason: `redirect to ${finalUrl}` };
  }

  const expiredBody = firstMatch(HARD_EXPIRED_PATTERNS, bodyText);
  if (expiredBody) {
    return { result: 'expired', code: 'expired_body', reason: `pattern matched: ${expiredBody.source}` };
  }

  // A dead permalink that 301s to a generic search/listing page still shows
  // "Apply" buttons — on OTHER jobs' cards (seen when jobs.careers.microsoft.com
  // permalinks migrated to apply.careers.microsoft.com). When the requested URL
  // carried a job identifier and the final URL lost it, the page being read is
  // not the posting, so apply controls are not evidence of liveness. Uncertain,
  // not expired: a portal migration can 301 live postings too, and a false
  // "expired" permanently filters a real job out of scans.
  const jobId = jobIdToken(requestedUrl);
  if (jobId && finalUrl && !finalUrl.toLowerCase().includes(jobId)) {
    return {
      result: 'uncertain',
      code: 'redirected_off_posting',
      reason: `redirected to ${finalUrl} — job id "${jobId}" missing from final URL`,
    };
  }

  if (hasApplyControl(applyControls)) {
    return { result: 'active', code: 'apply_control_visible', reason: 'visible apply control detected' };
  }

  const listingPage = firstMatch(LISTING_PAGE_PATTERNS, bodyText);
  if (listingPage) {
    return { result: 'expired', code: 'listing_page', reason: `pattern matched: ${listingPage.source}` };
  }

  if (bodyText.trim().length < MIN_CONTENT_CHARS) {
    return { result: 'expired', code: 'insufficient_content', reason: 'insufficient content — likely nav/footer only' };
  }

  return { result: 'uncertain', code: 'no_apply_control', reason: 'content present but no visible apply control found' };
}

// A scan-history status that already carries a death certificate for its row:
// `skipped_expired` (what scan.mjs writes) and the legacy `added (expired)`
// suffix older histories carry. Deliberately NOT the other `skipped_*` states —
// skipped_dup / skipped_title / skipped_no_apply_control say "this row is not a
// fresh match", which is a different claim from "this posting is gone".
const EXPIRED_HISTORY_STATUS = /expired/i;

/**
 * Plan the `skipped_expired` scan-history rows for a batch of liveness verdicts.
 *
 * The pure half of recording a liveness sweep (#3891). Kept here rather than in
 * the CLI so its three invariants are testable without a browser:
 *
 *   - **Only `expired`.** `uncertain` is a timeout or a bot wall, never a death
 *     certificate; recording it would bury a live posting behind a network
 *     hiccup, a strictly worse failure than the one this closes.
 *   - **Only URLs the history already knows.** A liveness sweep is not a
 *     discovery channel: a URL scan-history never saw has no row to retire, and
 *     inventing one would put a posting nothing surfaced into the dedup set.
 *   - **Once each.** A URL already carrying an expired row is left alone, so
 *     re-running the sweep is idempotent.
 *
 * A planned row is emitted under the history's OWN spelling of the URL, not the
 * caller's: the web feed keys its dedup on the verbatim `url` cell, so a row
 * written under a different spelling would not line up with the `added` row it
 * exists to retire. Matching is done through the injected `normalizeUrl` (the
 * scanner's `normalizeUrlForDedup`) rather than an import, so this module stays
 * free of scan.mjs — liveness-browser.mjs imports it.
 *
 * @param {string} scanHistoryText - Raw data/scan-history.tsv contents ('' when absent).
 * @param {{url: string, result: string}[]} verdicts - One entry per checked URL.
 * @param {(url: string) => string} [normalizeUrl] - Dedup-key normalizer.
 * @returns {{url: string, source: string, title: string, company: string, location: string, fingerprint: string}[]}
 *   Offer-shaped rows for `appendToScanHistory(rows, date, 'skipped_expired')`.
 */
export function planExpiredHistoryRows(scanHistoryText = '', verdicts = [], normalizeUrl = (url) => url) {
  const knownByKey = new Map(); // dedup key -> Map(verbatim url -> row fields)
  const recorded = new Set();   // verbatim urls that already carry an expired row

  // slice(1) skips the header, the same convention collectSeenUrls uses.
  for (const line of String(scanHistoryText ?? '').split('\n').slice(1)) {
    const [url, , portal = '', title = '', company = '', status = '', location = ''] = line.split('\t');
    if (!url) continue;
    const key = normalizeUrl(url);
    if (!knownByKey.has(key)) knownByKey.set(key, new Map());
    // fingerprint is pinned empty rather than carried: it is discovery-time JD
    // content, it still lives on the row being retired, and a stale copy on a
    // dead row is only noise for the cross-listing check.
    knownByKey.get(key).set(url, { url, source: portal, title, company, location, fingerprint: '' });
    if (EXPIRED_HISTORY_STATUS.test(status)) recorded.add(url);
  }

  const rows = [];
  const claimed = new Set();
  for (const verdict of verdicts ?? []) {
    if (verdict?.result !== 'expired') continue;
    const candidate = typeof verdict.url === 'string' ? verdict.url.trim() : '';
    if (!candidate) continue;
    const known = knownByKey.get(normalizeUrl(candidate));
    if (!known) continue;
    for (const [url, fields] of known) {
      if (recorded.has(url) || claimed.has(url)) continue;
      claimed.add(url);
      rows.push(fields);
    }
  }
  return rows;
}
