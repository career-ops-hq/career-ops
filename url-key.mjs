/**
 * url-key.mjs — canonical posting-URL key for deterministic tracker dedup.
 *
 * Two URLs that point to the same job posting must produce the same key so the
 * merge can upsert on it (the stable natural key — see merge-tracker.mjs Pass 0).
 *
 * UNDER-STRIP ON PURPOSE. The two failure modes are asymmetric:
 *   - over-normalizing collapses two genuinely different postings into one key
 *     → a SILENT merge / data loss (the exact bug this whole change fixes);
 *   - under-normalizing leaves two spellings of the SAME posting as two keys
 *     → a VISIBLE duplicate row you can see and fix.
 * So we strip only a denylist of known tracking params, lowercase the host,
 * force https, drop non-identity fragments + a trailing slash, and sort the
 * remaining query — and KEEP every functional query param (e.g. gh_jid, which
 * on some corporate-hosted Greenhouse boards is the canonical posting id).
 *
 * This mirrors RFC 3986 §6, whose comparison ladder runs simple-string →
 * syntax-based → scheme-based → protocol-based, and whose stated design goal is
 * to "minimize false negatives while strictly avoiding false positives" — the
 * same asymmetry above. Case and trailing-dot-segment handling are §6.2.2
 * syntax-based normalization and are always safe. Dropping query parameters is
 * NOT: the RFC puts scheme/protocol-specific knowledge on a higher rung that
 * requires knowing the resource. So the denylist stays narrow and literal, and
 * generic names (ref, source, src) are deliberately NOT stripped — they are
 * functional on some boards, and stripping them would merge two distinct
 * postings, which is the failure direction the RFC tells us to avoid.
 *
 * NO KEY IS NOT A KEY. An input that is not a usable http(s) posting URL
 * returns '' — never a lowercased-string stand-in. A placeholder like "N/A" or
 * "TBD" is a sentinel for a MISSING value, and SQL's three-valued logic is the
 * settled answer here: NULL is never equal to NULL, and a comparison against it
 * is UNKNOWN rather than true. Returning s.toLowerCase() gave every "N/A" row
 * one shared key, so unrelated employers compared equal on it.
 *
 * The tracker scripts compare posting URLs through it, and scan.mjs takes its
 * fragment and language-param handling from it, so the scanner and the tracker
 * do not keep two copies that can drift apart.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkedInPathJobId } from './lib/linkedin-url.mjs';

// Query params that identify a click/campaign, never the posting itself. Keep
// this list literal and board-specific; see the RFC note above on why generic
// names are absent.
const TRACKING_PARAMS = [
  /^utm_/i, /^gh_src$/i, /^fbclid$/i, /^gclid$/i,
  /^mc_cid$/i, /^mc_eid$/i, /^igshid$/i, /^_hsenc$/i, /^_hsmi$/i, /^trk$/i, /^trackingid$/i,
];

// Multi-employer job boards that re-list requisitions hosted elsewhere. One
// opening routinely carries a LinkedIn URL, an Indeed URL and the employer's
// own ATS URL at the same time, so two of these URLs are two spellings of an
// unknown posting rather than two postings. Registrable domains only; keep the
// list literal and conservative, for the same reason TRACKING_PARAMS is. Adding
// an employer-controlled host here would let a fuzzy title collision merge two
// genuinely distinct requisitions, which is the silent failure direction.
// The scraper list is shared with scan.mjs (data-static/aggregator-domains.txt,
// #4263) so a newly discovered reposter is added in ONE place.
//
// It does not answer this module's question on its own. That file lists hosts
// that SCRAPE AND REPOST, and deliberately omits the big job boards because
// companies post to them directly as a primary board — its header says exactly
// that about indeed.com. url-key.mjs asks something broader: is this URL
// EMPLOYER-CONTROLLED? For a board that carries a company's own posting under
// its own URL the answer is still no, because the same requisition also lives
// on the employer's ATS, which is the duplicate this module exists to collapse.
//
// So the shared file is the base and these are layered on top, each named with
// the reason it is absent there. Dropping any of them would silently un-fix the
// case this whole change is for: one posting seen on LinkedIn and on the
// employer board landing twice.
const AGGREGATOR_SUPPLEMENT = [
  'indeed.com',      // primary board; excluded from the shared file by its header
  'linkedin.com',    // primary board; employers post directly
  'glassdoor.com',   // primary board; employers post directly
  'ziprecruiter.com', // primary board; employers post directly
  'dice.com',        // primary board for tech; employers post directly
  'wellfound.com',   // primary board for startups; employers post directly
  // Boards this repository's own scanner reads (#3652). Each host is emitted by
  // the provider named beside it, so a row arriving through scan, pipeline and
  // evaluate carries one of these URLs rather than an employer-controlled one.
  //
  // They belong here rather than in the shared file for the same reason
  // indeed.com does, and the cost of getting it wrong is concrete: the shared
  // file also drives the "Possible aggregator reposts" warning in scan.mjs,
  // which prints a line per offer whose host it lists. Listing a board the
  // scanner itself reads there would flag EVERY offer that board returns as a
  // suspected repost of itself, on every run. A warning that fires on its own
  // input teaches people to skip reading it, and then it stops working for the
  // scraped reposts it exists to catch.
  'remoteok.com',       // board-wide remote feed; providers/remoteok.mjs
  'jobicy.com',         // board-wide remote feed; providers/jobicy.mjs
  'remotive.com',       // board-wide remote feed; providers/remotive.mjs
  'workingnomads.com',  // board-wide remote feed; providers/workingnomads.mjs
  'himalayas.app',      // multi-employer remote board, board-controlled URLs; providers/himalayas.mjs
  'weworkremotely.com', // multi-employer remote board, board-controlled URLs; providers/weworkremotely.mjs
  'nodesk.co',          // multi-employer remote board, board-controlled URLs; providers/nodesk.mjs
  'themuse.com',        // multi-employer board, board-controlled URLs; providers/themuse.mjs
  'echojobs.io',        // multi-employer board; providers/echojobs.mjs is retired (#2976), so historical rows only
];

/** Path to the shared scraper list, overridable the same way scan.mjs allows. */
const AGGREGATOR_DOMAINS_PATH = process.env.CAREER_OPS_AGGREGATOR_DOMAINS
  || join(dirname(fileURLToPath(import.meta.url)), 'data-static/aggregator-domains.txt');

// Read once, lazily: this module is imported by merge-tracker.mjs and scan.mjs
// on every run, and it stays a pure function module until something actually
// asks about an aggregator.
//
// Read directly rather than importing scan.mjs's loader: scan.mjs already
// imports THIS module, so depending on it back would be a cycle and would pull
// scan.mjs's whole import graph into merge-tracker's path.
let aggregatorDomainsCache = null;
function aggregatorDomains() {
  if (aggregatorDomainsCache) return aggregatorDomainsCache;
  const domains = new Set(AGGREGATOR_SUPPLEMENT);
  try {
    for (let line of readFileSync(AGGREGATOR_DOMAINS_PATH, 'utf-8').replace(/\r/g, '').split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const domain = line.split('#')[0].trim().toLowerCase();
      if (domain) domains.add(domain);
    }
  } catch (err) {
    // Losing the shared file is NOT a no-op, and an earlier version of this
    // comment claimed it was. Every domain in that file is one this module
    // turns on, so without it those hosts stop reading as aggregators and
    // their URL mismatches start counting as employer-controlled evidence,
    // which BLOCKS a merge. That is the under-merge direction — a visible
    // duplicate row the user can fix — rather than the silent over-merge, so
    // carrying on is the right call. It is still a behaviour change worth
    // being loud about.
    //
    // A missing file at the DEFAULT path is the one case that stays quiet: a
    // partial checkout legitimately lacks it. Anything else is the operator
    // being wrong about something they asked for — a bad
    // CAREER_OPS_AGGREGATOR_DOMAINS path, a directory, an unreadable file —
    // and swallowing all of those identically is how a misconfiguration runs
    // for months looking like normal operation.
    const overridden = Boolean(process.env.CAREER_OPS_AGGREGATOR_DOMAINS);
    if (err?.code !== 'ENOENT' || overridden) {
      console.warn(
        `Warning: could not read aggregator domains from ${AGGREGATOR_DOMAINS_PATH} (${err?.code || err}). `
        + 'Falling back to the built-in supplement; hosts listed only in that file will not be treated as '
        + 'aggregators, so some duplicate rows may stop collapsing.',
      );
    }
  }
  aggregatorDomainsCache = domains;
  return aggregatorDomainsCache;
}

/**
 * Fold a hostname to its comparison form: lowercase, with the DNS root label
 * dropped.
 *
 * `example.com.` and `example.com` are the same name — the terminal dot is the
 * root label written explicitly — but WHATWG URL preserves it verbatim. Both
 * exported functions below parse the host themselves, so without one shared
 * fold the same posting yields two keys in `normalizeUrl` (dedup sees two rows
 * where there is one) AND slips past `isAggregatorUrl` (an aggregator gets
 * treated as an employer board, which is the direction that turns a non-signal
 * back into false evidence of a distinct requisition).
 *
 * Exactly one dot is stripped. `example.com..` is not a valid host, so it is
 * left alone rather than silently repaired into a key that would match a real
 * posting, and a bare root host is left as-is — rejecting it is a separate
 * decision this does not make.
 *
 * @param {string} host - A hostname from a parsed URL.
 * @returns {string} The folded hostname.
 */
function foldHostname(host) {
  const h = String(host).toLowerCase();
  return h.length > 1 && h.endsWith('.') && !h.endsWith('..') ? h.slice(0, -1) : h;
}

// Posting-ID extractors, keyed by the registrable aggregator domain above.
//
// WHY AN ID AND NOT THE HOST. "Aggregator on either side → unknown" is too
// coarse: it also swallows two DIFFERENT requisitions listed on the SAME board,
// and folding those rewrites an Applied row's URL to a posting nobody applied
// to. The host itself cannot separate the two cases — the posting ID can.
//
// ONLY VERIFIED SHAPES GO IN HERE, and an unmapped board is not a defect. A
// guessed regex that reads two spellings of one posting as two IDs splits that
// posting into two rows, which is the failure direction this file exists to
// avoid; a missing extractor merely leaves the pair UNKNOWN, i.e. exactly the
// behaviour shipped for #3652. The two below are the shapes this repo already
// resolves in liveness-api.mjs (see its `linkedin` provider) and exercises in
// tests/liveness-api-linkedin.test.mjs — not inferred from the URLs' looks.
//
// Extractors are keyed on the DOMAIN, never on the path: `/jobs/view/{id}` is
// also Workable's employer-board shape, where it means something else.
const AGGREGATOR_POSTING_ID = {
  // The shapes and the /comm/ email link are documented in lib/linkedin-url.mjs.
  // parseAggregator has already matched the folded host, so only the path is read.
  'linkedin.com': linkedInPathJobId,
  // indeed.com/viewjob?jk={id}; a results page carries the focused posting as
  // ?vjk={id}. The job key is the requisition, so region hosts (uk./www./de.)
  // and the two page shapes all reduce to it.
  'indeed.com': (u) => {
    const jk = u.searchParams.get('jk') ?? u.searchParams.get('vjk');
    return jk && /^[\w-]+$/.test(jk) ? jk : null;
  },
};

/**
 * Parse a posting URL and resolve the aggregator it is hosted on.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {{url: URL, domain: string}|null} null when it is not on a known one.
 */
function parseAggregator(raw) {
  if (typeof raw !== 'string') return null;
  let url;
  try { url = new URL(raw.trim()); } catch { return null; }
  const host = foldHostname(url.hostname);
  // Label boundary, never a substring: `linkedin.com.evil.example` and
  // `myindeed.com` both contain an aggregator domain and are neither.
  let domain = null;
  for (const d of aggregatorDomains()) {
    if (host === d || host.endsWith(`.${d}`)) { domain = d; break; }
  }
  return domain ? { url, domain } : null;
}

/**
 * Is this posting URL hosted by a multi-employer aggregator?
 *
 * Callers use it to decide whether a URL mismatch is evidence about identity.
 * Between two employer-controlled boards it is; as soon as an aggregator is on
 * either side the HOSTS alone say nothing, because the same requisition appears
 * on both — see aggregatorPostingId for the signal that survives that.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {boolean} True only for a parseable URL on a known aggregator.
 */
export function isAggregatorUrl(raw) {
  return parseAggregator(raw) !== null;
}

/**
 * Extract the requisition identity an aggregator URL carries.
 *
 * Two of these are comparable ONLY when `domain` matches: one opening is listed
 * on LinkedIn and on Indeed at the same time, so a LinkedIn id and an Indeed id
 * differing is a statement about two boards, not about two postings.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {{domain: string, id: string}|null} null means UNKNOWN — not on a
 *   known aggregator, no extractor for that board yet, or no id in the URL.
 *   Callers must never read null as "the same posting".
 */
export function aggregatorPostingId(raw) {
  const agg = parseAggregator(raw);
  if (!agg) return null;
  const id = AGGREGATOR_POSTING_ID[agg.domain]?.(agg.url) ?? null;
  return id ? { domain: agg.domain, id } : null;
}

/**
 * Promote a known identity-bearing SPA fragment into a functional query key
 * before generic URL normalization drops the fragment. Most fragments are
 * presentation-only. The narrow exceptions are recognized `#/job/{id}` and
 * `#/jobs/{id}` routes; MokaHR keeps its established board-specific key.
 *
 * The emitted/public URL remains untouched; this mutates only the URL object
 * used to build a comparison key.
 *
 * @param {URL} url
 */
export function promoteKnownFragmentIdentity(url) {
  const match = /^#\/jobs?\/([^/?#]+)(?:\?[^#]*)?$/i.exec(url.hash);
  if (!match) return;
  let jobId;
  try { jobId = decodeURIComponent(match[1]); } catch { return; }
  if (!jobId) return;
  if (url.hostname.toLowerCase() === 'app.mokahr.com') {
    url.searchParams.append('mokahr_job_id', jobId);
    return;
  }
  url.searchParams.append('_career_ops_fragment_job_id', jobId);
}

/**
 * Reduce a posting URL to a stable comparison key.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {string} A normalized key, or '' when there is nothing to key on.
 *   '' means NO KEY — callers must treat it as unknown, never as a value that
 *   can match another ''.
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';

  let u;
  try {
    u = new URL(s);
  } catch {
    // Not a parseable absolute URL: a placeholder ("N/A", "TBD", "—"), a
    // `local:jds/...` pipeline reference, or free text. None of these identify a
    // posting, so none of them may become a key.
    return '';
  }

  // Only http(s) postings can be keyed. A non-http scheme is not a posting
  // locator we can compare, so it yields no key rather than a string stand-in.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';

  u.protocol = 'https:';            // http vs https is the same posting
  u.hostname = foldHostname(u.hostname);
  promoteKnownFragmentIdentity(u);
  u.hash = '';                      // unrecognized fragments do not identify it

  // Drop tracking params, keep functional ones, sort for order-independence.
  const keep = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (!TRACKING_PARAMS.some((re) => re.test(k))) keep.push([k, v]);
  }
  keep.sort((x, y) => (x[0] !== y[0] ? (x[0] < y[0] ? -1 : 1) : (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0)));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);

  // Drop a single trailing slash on the path (but never the root "/").
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }

  return u.toString();
}

// Query params naming the language a posting page renders in. An ATS that
// serves every language version of one posting at one URL tells the versions
// apart by one of these (Personio `?language=`, Recruitee `?lang=`). scan.mjs
// imports this list for its own dedup key, so the scanner and the tracker read
// the same names.
export const LANGUAGE_PARAMS = ['language', 'lang', 'locale'];

/**
 * The posting a URL names, apart from the language it asks for.
 *
 * `key` is the normalizeUrl() key of the URL without its language param, so
 * the language versions of one posting share it. `language` is the param's
 * value reduced to its language subtag (`en-GB` → `en`), or '' when the URL
 * names no language — which means "the posting's default version, language
 * unknown", not a language of its own.
 *
 * @param {string} raw - A posting URL (or any string) from a tracker row / TSV.
 * @returns {{key: string, language: string}} `key` is '' when there is no key.
 */
export function postingLanguageKey(raw) {
  if (typeof raw !== 'string') return { key: '', language: '', script: '' };
  let u;
  try { u = new URL(raw.trim()); } catch { return { key: normalizeUrl(raw), language: '', script: '' }; }
  let language = '';
  let script = '';
  for (const name of [...u.searchParams.keys()]) {
    if (!LANGUAGE_PARAMS.includes(name.toLowerCase())) continue;
    if (!language) {
      const raw = u.searchParams.get(name);
      language = languageSubtag(raw);
      script = postingScript(raw);
    }
    u.searchParams.delete(name);
  }
  return { key: normalizeUrl(u.href), language, script };
}

/**
 * The script a posting language param names, or '' when the value does not say.
 *
 * Separate from languageSubtag() because the two answer different questions.
 * languageSubtag() reduces to the language, which is what ranking a posting
 * against `preferred_languages` wants: a user who writes `zh` means Chinese,
 * and should match a Traditional posting as readily as a Simplified one.
 * Posting IDENTITY is the opposite question, and there the script is not a
 * regional variant at all — it changes the text. `zh-Hant` and `zh-Hans` are
 * not the same page for any reader, which is why this project ships
 * `modes/zh/` and `modes/zh-TW/` as two market mode sets rather than one.
 *
 * The script is reported only when the value actually establishes it:
 *
 * - an explicit script subtag (`zh-Hant`, `sr-Cyrl`) — stated outright;
 * - otherwise the script implied by an explicit REGION (`zh-TW` → Hant,
 *   `zh-CN` → Hans), which is reliable for the cases that matter;
 * - otherwise ''. A bare `zh` is never resolved to a script, because
 *   `Intl.Locale('zh').maximize()` answers `zh-Hans-CN` — a guess at the
 *   commonest case, not something the URL said. A posting served as `?lang=zh`
 *   may well be the Traditional one under a loose code, so treating it as
 *   Simplified would assert two postings where there is no evidence of two.
 *   Unknown stays unknown, the same way an absent language param does.
 *
 * @param {unknown} value - A language param value.
 * @returns {string} A script subtag (`Hant`), or ''.
 */
export function postingScript(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v) return '';
  let loc;
  try { loc = new Intl.Locale(v.replace(/_/g, '-')); } catch { return ''; }
  if (loc.script) return loc.script;
  if (!loc.region) return '';
  try { return loc.maximize().script || ''; } catch { return ''; }
}

/**
 * A posting language reduced to the form two languages are compared in; ''
 * when the value is empty or not a string.
 *
 * A value that parses as a language tag (`_` read as `-`) is reduced by
 * `Intl.Locale` to its canonical language subtag: the region and script go
 * (`en-GB`, `en_GLOBAL`, `zh-Hant-TW` → `en`, `en`, `zh`) — regional variants of
 * one language are the same text for any reader — and legacy or three-letter
 * codes map to the current two-letter one (`deu` → `de`, `iw` → `he`). Anything
 * that doesn't parse, such as `English (US)`, is compared whole, case-folded; a
 * name like `German` parses as a (non-standard) tag and comes back lowercased.
 * The two postings being compared come from one employer, and almost always
 * one provider, so the value only has to be consistent within a source, not
 * standard across sources. scan.mjs's languageFormsForDedup is built on it.
 *
 * @param {unknown} value - A language param value, `Job.language`, or a
 *   scan-history `language` cell.
 * @returns {string}
 */
export function languageSubtag(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v) return '';
  try {
    return new Intl.Locale(v.replace(/_/g, '-')).language;
  } catch {
    return v.toLowerCase();
  }
}

/**
 * What two posting URLs say about whether they name the same posting.
 *
 * - `'no-key'`: either side has no key — no evidence at all.
 * - `'same'`: the same page in the same language, or both without one.
 * - `'distinct'`: two different pages, or the same page in two known,
 *   different languages — two language versions of one posting are kept as
 *   two tracker rows. Two known, different SCRIPTS of one language count here
 *   too (`zh-Hant` vs `zh-Hans`): a script is not a regional variant, it is
 *   different text. See postingScript().
 * - `'one-sided-language'`: the same page with a language on one side only.
 *   The bare URL is the posting's default version, and the URL does not say
 *   which language that is, so this is not proof of two postings — a
 *   re-evaluation of the same report may match across it — but it is not
 *   proof of one either: the bare row may be the German version and the other
 *   its English one, so a title match must not fold them together.
 *
 * @param {string} rawA
 * @param {string} rawB
 * @returns {'no-key'|'same'|'distinct'|'one-sided-language'}
 */
export function postingUrlRelation(rawA, rawB) {
  const a = postingLanguageKey(rawA);
  const b = postingLanguageKey(rawB);
  if (!a.key || !b.key) return 'no-key';
  if (a.key !== b.key) return 'distinct';
  if (a.language === b.language) {
    // One language, two scripts: two versions, not one page. Only when BOTH
    // sides actually state a script — `zh` vs `zh-Hant` stays 'same', because
    // the bare code is not evidence of Simplified.
    if (a.language && a.script && b.script && a.script !== b.script) return 'distinct';
    return 'same';
  }
  return a.language && b.language ? 'distinct' : 'one-sided-language';
}

/**
 * One key per posting: the board's own posting id on a known aggregator, so a
 * LinkedIn alert link and the plain /jobs/view/ link agree, else normalizeUrl.
 *
 * @param {string} raw
 * @returns {string} '' when the input is not a usable posting URL
 */
export function postingKey(raw) {
  const agg = aggregatorPostingId(raw);
  return agg ? `${agg.domain}:${agg.id}` : normalizeUrl(raw);
}

export default normalizeUrl;
