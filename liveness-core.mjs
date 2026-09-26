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
  // Widened from /this job (listing )?is closed/i: agentic-engineering-jobs.com
  // writes "This role is closed" (111 of 111 uncertain postings measured in
  // one run, #4175), and other boards use "position". The three nouns are
  // interchangeable in JD copy.
  //
  // The trailing \b(?!-) is a compound-adjective guard. Without it,
  // "This role is closed-loop control of the platform" (real prose in a
  // control-systems JD, per santifer's review on #4194) matches the "is
  // closed" fragment and returns expired. \b requires end-of-word after
  // "closed"; (?!-) additionally rejects the hyphen case that \b alone
  // allows (d->- is word->non-word, so \b matches; the lookahead is what
  // catches closed-loop / closed-form / closed-source). "closedown" is
  // rejected by \b alone (d->o is word->word).
  /this (?:job|role|position)(?: listing)? is closed\b(?!-)/i,
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

// Weak expiry signals: real when nothing else on the page contradicts them,
// but too broad to override a visible apply control. The tier distinction
// exists because HARD_EXPIRED_PATTERNS is checked BEFORE hasApplyControl —
// anything placed there wins over a live Apply button on the page.
//
// /\bjob expired\b/i lived in HARD_EXPIRED_PATTERNS in the first cut of #4175
// and false-fired on four live-posting shapes santifer measured in the #4194
// review: a "Similar jobs" carousel with a "Job Expired" entry, a "Hide job
// expired" filter chip, a footer FAQ asking "what happens when a job
// expired?", and — before the closed-loop guard on the closed pattern above —
// "This role is closed-loop control of the platform" prose. liveness-browser
// hands classifyLiveness the whole page innerText plus same-origin iframe
// text (liveness-browser.mjs:434), so those elements are in scope.
//
// Moved down here so the same phrase in a dead-page scenario (nodesk.co's
// bare "JOB EXPIRED" banner, no apply control, per #4175) still fires. The
// pre-existing comments on the 5xx and 429 guards spell out the underlying
// rule: a false `expired` is written to scan-history as skipped_expired and
// dedup-filters a real job out of every later scan (indefinitely, unless
// scan_history.recheck_after_days is set), so this direction of error is
// always the more expensive one.
const SOFT_EXPIRED_PATTERNS = [
  /\bjob expired\b/i,
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

// A scraped page's closure banner states expiration as a bare fact — it
// never hedges or denies it. LLM prose can do both ("I cannot determine
// whether this job has expired", "this is not a case where the job has
// expired"), which HARD_EXPIRED_PATTERNS's substring matching cannot tell
// apart from an affirmative report on its own (CodeRabbit review on #4364).
// Scoped to the SAME SENTENCE as the match, not the whole text: a hedge or
// negation elsewhere in a long response must not suppress a genuine,
// separately-stated expiration elsewhere in it. "Same sentence" is decided
// per LINE first, then by terminal punctuation within that line — a hedge on
// one line ("I cannot determine whether the URL is valid") and an affirmative
// report on the very next ("This job has expired") are two separate
// statements with no sentence-ending punctuation between them, and
// normalizeForMatch() collapses that newline to a space before
// SENTENCE_SPLIT_RE ever sees it — so splitting on `\s+` after normalizing
// would merge them into one "sentence" and let the unrelated hedge suppress a
// real signal (CodeRabbit follow-up review on #4459).
//
// Deliberately a fixed phrase list, not general negation/uncertainty
// detection (out of reach for a regex, and not needed here): a model
// narrating "the job has expired, no longer accepting applications" does
// not also, in the same breath, say it cannot tell — the two are
// contradictory prose that practice does not produce. Kept narrow enough to
// avoid the mirror failure: bare "not" is deliberately excluded, since
// "no longer accepting applications" — one of the phrases this is meant to
// let through — contains it as ordinary description of the closure itself,
// not a hedge against reporting one.
const HEDGE_OR_UNCERTAINTY_RE = /\b(?:cannot|can'?t|couldn'?t|unable to|not\s+(?:really\s+)?(?:sure|clear|certain)|unsure|unclear|uncertain|don'?t know|do not know|no way to (?:tell|know|determine|confirm)|(?:hard|difficult) to (?:tell|know|determine|confirm)|whether or not|may or may not|not\s+a\s+case\s+where)\b/i;

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

/**
 * Whether `text` contains an unambiguous "this posting is gone" phrase —
 * standalone access to the HARD_EXPIRED_PATTERNS half of classifyLiveness(),
 * for a caller whose input isn't a scraped page at all (#4364: an LLM's own
 * prose narrating that it hit a liveness gate, with no HTTP status, no apply
 * controls, no URL to check).
 *
 * Deliberately HARD-only, never SOFT_EXPIRED_PATTERNS or MIN_CONTENT_CHARS:
 * classifyLiveness() places SOFT_EXPIRED_PATTERNS and its content-length
 * heuristic AFTER the apply-control check specifically because they are
 * ambiguous without it (see their own comments above) — "job expired" alone,
 * or a short body alone, both need "and no visible Apply control" to mean
 * anything. A short, genuinely malformed LLM response is exactly as short as
 * a genuine liveness-gate exit, so nothing here can safely stand in for that
 * missing corroboration.
 *
 * One caveat HARD_EXPIRED_PATTERNS's other callers don't need: a sentence
 * that also hedges or denies the match (HEDGE_OR_UNCERTAINTY_RE above) is
 * not counted — see that constant's comment for why prose, unlike a scraped
 * banner, needs this at all.
 *
 * @param {string} text - arbitrary prose, not necessarily a scraped page.
 * @returns {boolean}
 */
export function hasHardExpiredSignal(text = '') {
  // Split on real line breaks BEFORE normalizing: normalizeForMatch()
  // collapses every run of whitespace, newlines included, to a single space,
  // which would silently merge two separate lines into one sentence-scan
  // unit. Splitting first, then normalizing and sentence-splitting each line
  // on its own, keeps a hedge on one line from ever sharing a "sentence"
  // with an affirmative statement on another.
  const rawLines = (typeof text === 'string' ? text : '').split(/\r\n?|\n/);
  // ...except a SOFT line wrap, which is the opposite case: "I cannot
  // determine whether\nthis job has expired" is ONE hedge sentence broken
  // mid-clause by word-wrapping, not two statements — splitting there would
  // strand "this job has expired" on its own line with no hedge in sight and
  // misread the wrap as an affirmative report (CodeRabbit follow-up review on
  // #4459). The distinguishing signal already present in both of the
  // review's own examples: a genuine new statement starts with a capital
  // letter ("This job has expired"); the tail of a wrapped sentence
  // continues in lowercase ("this job has expired"). So a line starting with
  // a lowercase letter is merged back into the previous line before any
  // sentence-splitting happens, rather than treated as its own unit.
  // English-only, like every HARD_EXPIRED_PATTERNS phrase this feeds into —
  // not a general prose-boundary detector.
  const lines = [];
  for (const raw of rawLines) {
    if (lines.length > 0 && /^[a-z]/.test(raw.trimStart())) {
      lines[lines.length - 1] += ` ${raw.trimStart()}`;
    } else {
      lines.push(raw);
    }
  }
  const sentences = lines.flatMap((line) => normalizeForMatch(line).split(SENTENCE_SPLIT_RE));
  return sentences.some(
    (sentence) => firstMatch(HARD_EXPIRED_PATTERNS, sentence) && !HEDGE_OR_UNCERTAINTY_RE.test(sentence),
  );
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

  // Weak expiry signals — see SOFT_EXPIRED_PATTERNS above for why these
  // live below the apply-control check rather than in HARD_EXPIRED_PATTERNS.
  const softExpired = firstMatch(SOFT_EXPIRED_PATTERNS, bodyText);
  if (softExpired) {
    return { result: 'expired', code: 'expired_body_soft', reason: `pattern matched: ${softExpired.source}` };
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
