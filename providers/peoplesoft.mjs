// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// PeopleSoft Fluid Candidate Gateway provider — a public, no-auth careers
// site running Oracle/PeopleSoft HCM's "Fluid" recruiting UI (institutions
// verified live 2026-09: Western University/UWO `recruit.uwo.ca`, Toronto
// Metropolitan University `careers.torontomu.ca`, McMaster University
// `hr.mcmaster.ca`, Workplace Safety and Insurance Board `wsib.ca`). Unlike
// every other provider in this directory, PeopleSoft exposes NO clean JSON
// REST API — it's a stateful HTML application (PeopleTools' classic ICAJAX
// postback model) that needs a cookie session carried across a GET → POST →
// GET sequence, and HTML scraped with tag-agnostic id-based extraction.
//
// Single-company adapter, `tracked_companies:` only — each PeopleSoft-hosting
// institution (Western, TMU, McMaster, WSIB, …) is one `careers_url`/`api`
// entry, the same "one employer, one entry" shape as ibm.mjs/dassault.mjs;
// there is no board-wide feed to point a `job_boards:` entry at.
//
// ── Detection ────────────────────────────────────────────────────────────
// Every tenant runs on its own branded domain (recruit.uwo.ca is nothing
// like careers.torontomu.ca), so — same reasoning as successfactors.mjs's
// branded RMK hosts — a hostname can never be the detect() signal here.
// What IS a reliable, tenant-agnostic signal is the URL *path*: PeopleSoft's
// Fluid job-search page always lives at the literal path
//   /psc/{site}/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL
// {site} is the tenant's PeopleSoft "site" segment (e.g. "uwo1", "psft_hr").
// That component-name string is a PeopleTools implementation signature, not
// a brand guess — no unrelated site coincidentally serves that exact path —
// so detect() safely pattern-matches on it regardless of host.
//
// ── The flow (verified live) ────────────────────────────────────────────
//   1. GET  {origin}/psc/{site}/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL
//           ?Page=HRS_APP_SCHJOB_FL&Action=U&FOCUS=Applicant&SiteId=1
//      Establishes the PeopleSoft session (Set-Cookie) and returns HTML whose
//      `form[name="win0"]` carries the full ICAJAX postback state.
//   2. "Load more results" is NOT a `?page=N` query — it's a POST replay of
//      EVERY field from `form[name="win0"]` (PeopleSoft's postback model
//      needs the whole form state, not just the fields we care about), with
//      one field overridden: `ICAction=HRS_AGNT_RSLT_I$hdown$0`. POST to the
//      form's own `action` URL, same session cookies, parse the response the
//      same way, dedupe by job opening id across pages.
//   3. GET  {origin}/psc/{site}/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL
//           ?Page=HRS_APP_JBPST_FL&Action=U&FOCUS=Applicant
//           &JobOpeningId={id}&PostingSeq={seq}&SiteId=1
//      for the detail page. PostingSeq=1 first; if the page is invalid or the
//      returned job id doesn't match, retry PostingSeq=2 before giving up
//      (empirically necessary — PeopleSoft numbers postings per-opening, and
//      a dead PostingSeq can redirect to an unrelated generic page instead of
//      erroring cleanly, so the id match below is mandatory, not defensive).
//
// ── The single most important correctness requirement ──────────────────
// A response with no `form[name="win0"]` at all is NOT "zero postings" — it
// is very likely a login page, an expired-session redirect, a generic error
// page, or a WAF/challenge page. Reporting that as an empty board would
// silently hide every posting for a tenant that is merely rate-limiting or
// session-expiring the scanner. parseSearchPage() always distinguishes this
// (`valid: false`) from a genuinely empty, well-formed result page
// (`valid: true, rows: []`), and fetch() throws rather than returning [] when
// it sees the former.
//
// ── No HTML parser dependency ───────────────────────────────────────────
// This codebase ships no DOM/HTML parser library (see icims.mjs, workday.mjs,
// successfactors.mjs — all regex-based). PeopleSoft's markup is id-anchored
// (every field of interest carries a stable, documented `id=`), so extraction
// here is a small tag-agnostic "find by id, walk to the matching close tag"
// helper (extractById) rather than a full parser — same "regex over the
// stable bits" strategy the rest of the directory already uses.
//
// ── Probe-budget note (read before touching ctx.maxPages handling) ─────
// verify-portals.mjs's request-budget guard (ProbePageBudgetReached) wraps
// only `ctx.fetchJson` / `ctx.fetchText` — NOT `ctx.fetchResponse`. Every
// request this provider makes goes through `ctx.fetchResponse` (Set-Cookie
// is only visible on the raw Response), so that external safety net does not
// apply to us at all. This provider's OWN `ctx.maxPages` cooperation is
// therefore the ONLY thing bounding a probe's request count — not a
// belt-and-suspenders nicety like it is for a fetchJson/fetchText provider.
// See `resolveMaxLoadMore()` below.
//
// ── Session cookies ──────────────────────────────────────────────────────
// This codebase's one existing precedent (csod.mjs) captures Set-Cookie off
// a single bootstrap GET and replays it verbatim on every later request. That
// isn't quite enough here: PeopleSoft's session can rotate its cookie across
// the GET → POST → GET(detail) chain, so cookies are captured and MERGED
// (last-value-wins per name, like a real browser jar) after every hop, not
// just the first. createCookieJar/updateCookieJar/cookieHeader below are the
// small local jar this needs — no shared cookie-jar helper exists in this
// codebase to reuse (checked: _http.mjs has no jar, only per-response
// Set-Cookie access via fetchResponse).
//
// ── description output ───────────────────────────────────────────────────
// Detail-page description sections (`[id^="win0divHRS_SCH_PSTDSC_row$"]`) are
// concatenated in DOM order into the one description form Job actually has
// (`_types.js`): `description`, plain text via the shared htmlToText from
// _html-to-text.mjs — reused, not reimplemented. An earlier revision also
// built a sanitized-HTML form and a raw-section debug array and attached
// both to the output row; neither is a Job field, nothing downstream reads
// them, and the hand-rolled sanitizer that built the HTML form was the
// source of two CodeQL "incomplete multi-character sanitization" alerts —
// removed along with it (review round on #3724/#3739). `parseJobDetail()`
// still returns its internal `sections` (`{label, text}[]`) so the
// section-by-section extraction stays independently testable; only
// `descriptionText` crosses into `fetch()`'s output. Detail enrichment is
// opt-in (`peoplesoft: { fetchDetails: true }`) and skipped during a probe,
// same convention as adp-workforcenow.mjs/vdab.mjs.

import { decodeEntities } from './_html-entities.mjs';
import { htmlToText, DESCRIPTION_CAP } from './_html-to-text.mjs';
import { fetchResponseWithRetry, sleep, BROWSER_LIKE_USER_AGENT } from './_http.mjs';
import { intInRange } from './_config-utils.mjs';

// The Fluid job-search page's fixed path shape. {site} (capture group 1) is
// the tenant's PeopleSoft site segment — used to rebuild every other URL
// this provider needs, never trusted from elsewhere in the given URL.
const PS_SEARCH_PATH_RE = /^\/psc\/([^/]+)\/EMPLOYEE\/HRMS\/c\/HRS_HRAM_FL\.HRS_CG_SEARCH_FL\.GBL$/i;

const SEARCH_PAGE_PARAM = 'HRS_APP_SCHJOB_FL';
const DETAIL_PAGE_PARAM = 'HRS_APP_JBPST_FL';
// The "load more results" postback trigger — a fixed literal PeopleSoft
// ICAction value, not something a page ever varies per tenant.
const LOAD_MORE_ACTION = 'HRS_AGNT_RSLT_I$hdown$0';

// Absolute ceiling on "load more" POST replays, independent of ctx.maxPages
// and of whatever the page reports as its own total (ADDING_A_PROVIDER.md,
// "Absolute page ceiling") — a tampered/misbehaving response must not turn
// one portals.yml line into an unbounded POST loop.
const DEFAULT_MAX_LOAD_MORE = 20; // generous: PeopleSoft's own anonymous cap is ~100 results
const MAX_LOAD_MORE_CAP = 100;

// Cap on how many postings get per-job detail enrichment in one run. Detail
// fetches run sequentially (see fetch()'s enrichment loop — no concurrency
// pool, to avoid a stale read on the shared session cookie jar), so this is
// also the total enrichment request burst for a tenant.
const DEFAULT_DETAIL_LIMIT = 25;

// Polite pacing between GET/POST/detail hops against the same tenant.
const INTER_REQUEST_DELAY_MS = 300;

// PeopleSoft's Fluid UI is known to serve degraded/legacy markup to a bare
// default UA on some tenants — same rationale as icims.mjs/workday.mjs.
const HEADERS = {
  'user-agent': BROWSER_LIKE_USER_AGENT,
  'accept-language': 'en-US,en;q=0.9',
};

// ── Config resolution ────────────────────────────────────────────────────

/**
 * Resolve a portals.yml entry to a PeopleSoft tenant config, or null.
 *
 * No fixed-hostname allowlist here (unlike a single-SaaS-host provider such
 * as greenhouse.mjs's ALLOWED_GREENHOUSE_HOSTS): PeopleSoft is a self-hosted,
 * per-institution install with no shared vendor domain to pin to — the same
 * reason successfactors.mjs's branded RMK hosts and phenom.mjs carry no host
 * allowlist either (see the "Detection" note in this file's header). A fixed
 * list would either have to be curated per tenant forever (defeating the
 * point of a general-purpose provider) or degenerate into something too
 * broad to be a meaningful restriction (e.g. "any .edu/.ca/.com/.org/.net").
 * The guard that actually matters, and that IS enforced: the origin accepted
 * here (from trusted portals.yml data, HTTPS-only, gated on the anchored
 * PeopleTools path signature) becomes `config.origin`, and every later
 * request — including every redirect hop, see requestWithSession() below —
 * is re-validated to stay at EXACTLY that origin (assertPeopleSoftUrl()),
 * closing the actual attack this class of guard exists for: a
 * compromised/malicious response bouncing the scanner to a different host
 * than the one portals.yml configured. DNS-rebinding / private-address
 * targets (127.0.0.1, 169.254.169.254 cloud metadata, RFC1918, …) are
 * blocked independently and unconditionally for every provider request by
 * the shared `providerFetchContext` guard in `_ip-guard.mjs` /
 * `providers/_http.mjs` — see Scott-Emberson's 2026-09-04 review on
 * career-ops-hq/career-ops#3739, which verified this origin-pinning design
 * sound. (CodeRabbit's automated "Provider Contract" pre-merge check flags
 * the absence of a host allowlist here — that check's heuristic assumes the
 * ADP/UKG-Pro/Taleo shape, a small fixed set of vendor SaaS hosts; it does
 * not have a branded-per-tenant-domain exception, which is what this
 * actually is.)
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{origin: string, site: string, searchUrl: string} | null}
 */
export function resolveConfig(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let u;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:') continue;
    const m = u.pathname.match(PS_SEARCH_PATH_RE);
    if (!m) continue;
    const site = m[1];
    return { origin: u.origin, site, searchUrl: buildSearchUrl(u.origin, site) };
  }
  return null;
}

/** @param {string} origin @param {string} site */
export function buildSearchUrl(origin, site) {
  const u = new URL(`${origin}/psc/${site}/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL`);
  u.searchParams.set('Page', SEARCH_PAGE_PARAM);
  u.searchParams.set('Action', 'U');
  u.searchParams.set('FOCUS', 'Applicant');
  u.searchParams.set('SiteId', '1');
  return u.href;
}

/**
 * @param {{origin: string, site: string}} config
 * @param {string} jobId
 * @param {number} postingSeq
 */
export function buildDetailUrl(config, jobId, postingSeq) {
  const u = new URL(`${config.origin}/psc/${config.site}/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL`);
  u.searchParams.set('Page', DETAIL_PAGE_PARAM);
  u.searchParams.set('Action', 'U');
  u.searchParams.set('FOCUS', 'Applicant');
  u.searchParams.set('JobOpeningId', jobId);
  u.searchParams.set('PostingSeq', String(postingSeq));
  u.searchParams.set('SiteId', '1');
  return u.href;
}

/**
 * SSRF guard: every URL this provider fetches is either rebuilt from
 * `config.origin` (trusted) or, for the "load more" replay, taken from the
 * page's own `form action=` (page-controlled, so it MUST be pinned back to
 * the resolved tenant origin before any network call).
 * @param {string} url @param {{origin: string}} config
 */
function assertPeopleSoftUrl(url, config) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`peoplesoft: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`peoplesoft: URL must use HTTPS: ${url}`);
  if (parsed.origin !== config.origin) {
    throw new Error(`peoplesoft: untrusted origin "${parsed.origin}" — must be ${config.origin}`);
  }
  return url;
}

// ── Cookie jar (see header comment — no shared jar helper exists yet) ──────

/** @returns {Map<string, string>} */
export function createCookieJar() {
  return new Map();
}

/**
 * Merge Set-Cookie values into an existing jar (last value per name wins,
 * same semantics as a real browser jar). Only the leading name=value pair is
 * kept; attributes (Path/HttpOnly/Secure/SameSite/Expires) describe browser
 * storage rules and are meaningless on an outgoing request.
 * @param {Map<string, string>} jar @param {string[] | undefined} setCookies
 */
export function updateCookieJar(jar, setCookies) {
  for (const raw of Array.isArray(setCookies) ? setCookies : []) {
    if (typeof raw !== 'string') continue;
    const pair = raw.split(';', 1)[0].trim();
    const eq = pair.indexOf('=');
    if (eq <= 0) continue; // no '=', or an empty name — not a cookie
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return jar;
}

/** @param {Map<string, string>} jar @returns {string} */
export function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

// ── id-anchored HTML extraction (no DOM parser in this codebase) ───────────

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the raw inner HTML of the first element carrying `id="{id}"`,
 * tag-agnostic, tracking nested same-tag-name depth (a `<div id="x">...<div>
 * nested</div>...</div>` doesn't stop at the nested close tag). Returns null
 * when the id isn't present, or the element has no discoverable close tag
 * (malformed markup — never guess).
 * @param {string} html @param {string} id
 */
export function extractById(html, id) {
  const str = String(html);
  const idEsc = escapeRegExp(id);
  // PeopleSoft's own generated markup was observed live (2026-09) to emit at
  // least one id attribute UNQUOTED (`id=HRS_SCH_PSTDSC_DESCRLONG$0 >`), not
  // just the quoted form every other provider's HTML scraping assumes — so
  // both forms are matched here, not just id="..."/id='...'.
  const idAttrRe = new RegExp(`\\bid=(?:"${idEsc}"|'${idEsc}'|${idEsc}(?=[\\s>]))`);
  const idMatch = idAttrRe.exec(str);
  if (!idMatch) return null;
  const idPos = idMatch.index;
  const tagStart = str.lastIndexOf('<', idPos);
  if (tagStart === -1) return null;
  const tagOpenEnd = str.indexOf('>', idPos);
  if (tagOpenEnd === -1) return null;
  const tagNameMatch = str.slice(tagStart + 1, tagStart + 40).match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  if (!tagNameMatch) return null;
  const tagName = tagNameMatch[1];
  if (str[tagOpenEnd - 1] === '/') return ''; // self-closing tag, e.g. <input ... id="x" />
  const tagRe = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}\\s*>`, 'gi');
  tagRe.lastIndex = tagOpenEnd + 1;
  let depth = 1;
  let m;
  while ((m = tagRe.exec(str))) {
    if (m[0][1] === '/') {
      depth--;
      if (depth === 0) return str.slice(tagOpenEnd + 1, m.index);
    } else {
      depth++;
    }
  }
  return null; // no matching close tag found — malformed, don't guess
}

/** extractById() + strip tags + decode entities + collapse whitespace. */
export function extractTextById(html, id) {
  const raw = extractById(html, id);
  if (raw === null) return null;
  return decodeEntities(raw.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Minimal HTML attribute tokenizer for one tag's attribute string.
 * Boolean attributes (e.g. `checked`, `selected`) come back as `true`.
 * @param {string} attrString
 */
function parseAttrs(attrString) {
  /** @type {Record<string, string | true>} */
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s"'>]+))?/g;
  let m;
  while ((m = re.exec(attrString))) {
    const name = m[1].toLowerCase();
    const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[2] !== undefined ? m[2] : true;
    out[name] = /** @type {string | true} */ (value);
  }
  return out;
}

/**
 * Parse `form[name="win0"]`'s current state: every input/select/textarea
 * name→value, plus the form's own `action`. PeopleSoft's ICAJAX postback
 * needs the FULL form state replayed, not just the fields this provider
 * cares about, so every field is collected — see LOAD_MORE_ACTION usage.
 * @param {string} html
 * @returns {{ action: string | null, fields: Record<string, string> } | null}
 */
export function parseFormState(html) {
  const str = String(html);
  const openMatch = /<form\b[^>]*\bname=["']win0["'][^>]*>/i.exec(str);
  if (!openMatch) return null;
  const closeIdx = str.toLowerCase().indexOf('</form>', openMatch.index);
  const formHtml = closeIdx === -1 ? str.slice(openMatch.index) : str.slice(openMatch.index, closeIdx);
  const actionMatch = /\baction=["']([^"']*)["']/i.exec(openMatch[0]);

  /** @type {Record<string, string>} */
  const fields = {};

  for (const m of formHtml.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = parseAttrs(m[1]);
    if (typeof attrs.name !== 'string' || !attrs.name) continue;
    const type = typeof attrs.type === 'string' ? attrs.type.toLowerCase() : 'text';
    if ((type === 'checkbox' || type === 'radio') && attrs.checked === undefined) continue;
    fields[decodeEntities(attrs.name)] = decodeEntities(typeof attrs.value === 'string' ? attrs.value : '');
  }
  for (const m of formHtml.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attrs = parseAttrs(m[1]);
    if (typeof attrs.name !== 'string' || !attrs.name) continue;
    const optMatch = /<option\b([^>]*)\bselected\b[^>]*>/i.exec(m[2]) || /<option\b([^>]*)>/i.exec(m[2]);
    const optAttrs = optMatch ? parseAttrs(optMatch[1]) : {};
    fields[decodeEntities(attrs.name)] = decodeEntities(typeof optAttrs.value === 'string' ? optAttrs.value : '');
  }
  for (const m of formHtml.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const attrs = parseAttrs(m[1]);
    if (typeof attrs.name !== 'string' || !attrs.name) continue;
    fields[decodeEntities(attrs.name)] = decodeEntities(m[2]);
  }

  return { action: actionMatch ? actionMatch[1] : null, fields };
}

// ── search-page parsing ─────────────────────────────────────────────────

/** @param {string | null} text */
export function parseReportedTotal(text) {
  if (!text) return null;
  const ofMatch = String(text).match(/of\s+(\d+)/i);
  if (ofMatch) return Number(ofMatch[1]);
  const bare = String(text).match(/(\d+)/);
  return bare ? Number(bare[1]) : null;
}

// SCH_OPENED renders US-format M/D/YYYY on every tenant observed live. An
// unrecognized shape is NOT guessed at — the raw string is kept on the row
// and the normalized field stays undefined, per this task's explicit "never
// guess a date format" requirement.
/** @param {string | null | undefined} raw @returns {number | undefined} */
export function parsePeopleSoftDate(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const ms = Date.UTC(year, month - 1, day);
  if (new Date(ms).getUTCDate() !== day) return undefined; // catches 4/31, 2/30, etc.
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Parse one PeopleSoft Fluid search-results response.
 *
 * The single most important branch: `valid: false` when `form[name="win0"]`
 * is absent — a login/session-expired/challenge/generic-error page, NEVER
 * treated as "zero postings" by the caller. `valid: true, rows: []` is the
 * genuinely-different "endpoint alive, no matches" case.
 *
 * @param {string} html
 * @param {{origin: string, site: string}} config
 * @returns {{
 *   valid: boolean,
 *   errorReason: string | null,
 *   rows: Array<{jobId: string, title: string, location: string, department: string, postedRaw: string | null, postedAt: number | undefined}>,
 *   reportedTotal: number | null,
 *   formAction: string | null,
 *   formFields: Record<string, string>,
 * }}
 */
export function parseSearchPage(html, config) {
  const str = String(html);
  const hasForm = /<form\b[^>]*\bname=["']win0["']/i.test(str);
  if (!hasForm) {
    return { valid: false, errorReason: 'unexpected-page', rows: [], reportedTotal: null, formAction: null, formFields: {} };
  }

  const formState = parseFormState(str) || { action: null, fields: {} };
  const reportedTotal = parseReportedTotal(extractTextById(str, 'win0divHRS_AGNT_RSLT_Irowcnt$0'));

  const rowIndices = [];
  const rowRe = /\bid=(?:["']HRS_AGNT_RSLT_I\$0_row_(\d+)["']|HRS_AGNT_RSLT_I\$0_row_(\d+)(?=[\s>]))/g;
  let rm;
  while ((rm = rowRe.exec(str))) rowIndices.push(rm[1] ?? rm[2]);

  const rows = [];
  for (const idx of rowIndices) {
    // PeopleTools names every grid-instance control `{field}$N}` — verified
    // live 2026-09 against a real tenant (Western University), where the
    // list carried e.g. `SCH_JOB_TITLE$0` / `HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$0`,
    // never a bare `SCH_JOB_TITLE0`. `$${idx}` (not a bare `${idx}`) is
    // therefore used for every per-row field, mirroring the row `li` id
    // itself (`HRS_AGNT_RSLT_I$0_row_N`).
    const jobId = extractTextById(str, `HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$${idx}`);
    const title = extractTextById(str, `SCH_JOB_TITLE$${idx}`);
    // No stable dedup key / nothing to show — skip this row, keep the rest.
    if (!jobId || !title) continue;
    // LOCATION / department / posted-date are genuinely tenant-configurable
    // grid columns (verified live: one real tenant's board showed Department
    // + Employee Group + Close Date and NO location column at all) — an
    // absent field is a normal, expected shape for a given tenant, not a
    // parse failure, so these stay optional (`|| ''` / `undefined`) rather
    // than gating row validity the way jobId/title do.
    const postedRaw = extractTextById(str, `SCH_OPENED$${idx}`);
    rows.push({
      jobId,
      title,
      location: extractTextById(str, `LOCATION$${idx}`) || '',
      department: extractTextById(str, `HRS_APP_JBSCH_I_HRS_DEPT_DESCR$${idx}`) || '',
      postedRaw: postedRaw || null,
      postedAt: parsePeopleSoftDate(postedRaw),
    });
  }

  return {
    valid: true,
    errorReason: null,
    rows,
    reportedTotal,
    formAction: formState.action,
    formFields: formState.fields,
  };
}

// ── session-carrying transport ──────────────────────────────────────────
//
// A hard-earned correction from live testing (2026-09), not from the source
// issue: even the fully-correct search URL, with the right query params and
// a browser-like UA, comes back as a same-origin 302 (PeopleSoft's portal
// bootstrap bounces through its own PSJSESSIONID/theme-negotiation redirect
// before landing on the real content) — sometimes more than once. Every
// OTHER provider in this codebase passes `redirect: 'error'` unconditionally
// (ADDING_A_PROVIDER.md's SSRF guard), which would make a fully legitimate
// PeopleSoft fetch fail 100% of the time. That guard's actual intent is
// "a compromised/malicious response must never redirect us off the
// validated target" — not "no redirect is ever legitimate" — so this
// provider follows redirects manually, validating EVERY hop's Location
// against `config.origin` with the same assertPeopleSoftUrl() guard used
// everywhere else, and throwing the instant a hop points off-origin. This is
// strictly more defensive than a single up-front check would be (it also
// catches a LATER hop in a chain redirecting away), not a relaxation of the
// guard's purpose.

const MAX_REDIRECTS = 10; // generous bound on PeopleSoft's own internal bootstrap bounces

/**
 * GET/POST under a session, following only strictly same-origin redirects
 * (see block comment above), capturing Set-Cookie at every hop, and
 * returning the final response body as text.
 * @param {any} ctx @param {Map<string, string>} jar
 * @param {{origin: string}} config
 * @param {'GET' | 'POST'} method @param {string} url
 * @param {{headers?: Record<string, string>, body?: string}} [opts]
 */
async function requestWithSession(ctx, jar, config, method, url, opts = {}) {
  let currentUrl = assertPeopleSoftUrl(url, config);
  let currentMethod = method;
  let currentBody = opts.body;
  const baseHeaders = opts.headers || {};

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers = {
      ...HEADERS,
      ...baseHeaders,
      ...(cookieHeader(jar) ? { cookie: cookieHeader(jar) } : {}),
    };
    // No 4th `policy` argument: this tenant needs no cadence different from
    // fetchResponseWithRetry's own default ({ retries: 2, baseDelayMs: 500,
    // maxDelayMs: 8_000 } — see _http.mjs RETRY_DEFAULTS). A prior revision
    // passed an explicit policy object that was byte-identical to that
    // default, which is a no-op, not a real override (contrast
    // workday.mjs/oraclecloud.mjs, which pass `{ retries: 3 }` because their
    // API is WAF-fronted — a genuine reason to differ).
    const res = await fetchResponseWithRetry(
      ctx,
      currentUrl,
      { method: currentMethod, redirect: 'manual', headers, body: currentMethod === 'GET' ? undefined : currentBody },
    );
    const setCookies = typeof res?.headers?.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    updateCookieJar(jar, setCookies);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`peoplesoft: redirect (HTTP ${res.status}) with no Location header from ${currentUrl}`);
      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl).href;
      } catch {
        throw new Error(`peoplesoft: redirect (HTTP ${res.status}) carried an unparseable Location: ${location}`);
      }
      nextUrl = assertPeopleSoftUrl(nextUrl, config); // throws if the redirect leaves config.origin
      // 307/308 preserve method+body; 301/302/303 downgrade to a GET with no
      // body, same as a real browser (and undici's own `redirect: 'follow'`).
      if (res.status !== 307 && res.status !== 308) {
        currentMethod = 'GET';
        currentBody = undefined;
      }
      currentUrl = nextUrl;
      continue;
    }
    return res.text();
  }
  throw new Error(`peoplesoft: exceeded ${MAX_REDIRECTS} redirects following ${url}`);
}

async function getWithSession(ctx, jar, config, url) {
  return requestWithSession(ctx, jar, config, 'GET', url);
}

async function postWithSession(ctx, jar, config, url, body) {
  return requestWithSession(ctx, jar, config, 'POST', url, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

/**
 * Start a tenant session: an empty cookie jar plus the transport context.
 * @param {import('./_types.js').Context} ctx
 */
export async function createSession(ctx) {
  return { ctx, jar: createCookieJar() };
}

/**
 * GET the search page under a session, parsed.
 * @param {{origin: string, site: string, searchUrl: string}} config
 * @param {{ctx: any, jar: Map<string, string>}} session
 */
export async function fetchSearchPage(config, session) {
  const html = await getWithSession(session.ctx, session.jar, config, config.searchUrl);
  return parseSearchPage(html, config);
}

function resolveFormActionUrl(action, config) {
  if (!action) return config.searchUrl; // no action captured — fall back rather than fail the whole sweep
  try {
    return new URL(action, config.origin).href;
  } catch {
    return config.searchUrl;
  }
}

/**
 * The "load more results" step: POST the ENTIRE current form state back to
 * the form's own action URL, with `ICAction` overridden to the "load more"
 * trigger, same session cookies. Returns the next page, parsed the same way
 * as the initial GET.
 * @param {{formAction: string | null, formFields: Record<string, string>}} state
 * @param {{ctx: any, jar: Map<string, string>, config: {origin: string, site: string}}} session
 */
export async function fetchAdditionalResults(state, session) {
  const { config, ctx, jar } = session;
  const fields = { ...state.formFields, ICAction: LOAD_MORE_ACTION };
  const actionUrl = assertPeopleSoftUrl(resolveFormActionUrl(state.formAction, config), config);
  const body = new URLSearchParams(fields).toString();
  const html = await postWithSession(ctx, jar, config, actionUrl, body);
  return parseSearchPage(html, config);
}

// ── detail-page parsing ─────────────────────────────────────────────────

/**
 * Parse a job detail page, verifying identity against the requested job id.
 *
 * `#HRS_SCH_WRK2_HRS_JOB_OPENING_ID` absent → not a job-detail page at all
 * (dead PostingSeq redirected somewhere generic) → `valid: false`. Present
 * but not equal to `expectedJobId` → PeopleSoft served an unrelated posting
 * for a dead deep-link → `valid: false, reason: 'job-id-mismatch'`. Both
 * cases must be REJECTED, not silently accepted as this job's detail — the
 * caller (fetchJobDetail) then tries PostingSeq=2 before giving up.
 *
 * @param {string} html
 * @param {string} expectedJobId
 */
export function parseJobDetail(html, expectedJobId) {
  const str = String(html);
  const returnedJobId = extractTextById(str, 'HRS_SCH_WRK2_HRS_JOB_OPENING_ID');
  if (returnedJobId === null) {
    return { valid: false, reason: 'unexpected-page', jobId: null };
  }
  if (returnedJobId.trim() !== String(expectedJobId).trim()) {
    return { valid: false, reason: 'job-id-mismatch', jobId: returnedJobId };
  }

  const title = extractTextById(str, 'HRS_SCH_WRK2_POSTING_TITLE') || '';
  const location = extractTextById(str, 'HRS_SCH_WRK_HRS_DESCRLONG') || '';

  // Section containers appear in DOM order — collecting indices via a single
  // forward regex scan preserves that order without needing real tree walk.
  const sectionIndices = [];
  const secRe = /id=["']win0divHRS_SCH_PSTDSC_row\$(\d+)["']/g;
  let sm;
  while ((sm = secRe.exec(str))) sectionIndices.push(sm[1]);

  // Sections are collected as plain text only — descriptionText (via the
  // shared htmlToText) is the only description form this provider exposes on
  // Job. Earlier revisions also built a sanitized-HTML form and a raw-section
  // debug array, but neither is a Job field (_types.js) and nothing in
  // scan.mjs reads them off an output row (review round on #3724/#3739), so
  // producing them was dead weight — and, for the HTML form specifically, the
  // surface for two now-moot CodeQL "incomplete multi-character sanitization"
  // alerts on the hand-rolled tag filter that built it. Removed rather than
  // kept unused.
  const sections = [];
  for (const idx of sectionIndices) {
    // Same `$N` grid-instance convention as the search-page rows (see
    // parseSearchPage) — verified live against the same real tenant's detail
    // page: `HRS_SCH_WRK_DESCR100$0lbl` / `HRS_SCH_PSTDSC_DESCRLONG$0`.
    const labelRaw = extractById(str, `HRS_SCH_WRK_DESCR100$${idx}lbl`);
    const bodyRaw = extractById(str, `HRS_SCH_PSTDSC_DESCRLONG$${idx}`);
    if (labelRaw === null && bodyRaw === null) continue; // neither half present — nothing to concatenate
    sections.push({
      label: labelRaw !== null ? htmlToText(labelRaw) : '',
      text: htmlToText(bodyRaw || ''),
    });
  }

  const descriptionText = sections
    .map((s) => (s.label ? `${s.label}\n` : '') + s.text)
    .join('\n\n')
    .trim()
    .slice(0, DESCRIPTION_CAP);

  return {
    valid: true,
    reason: null,
    jobId: returnedJobId,
    title,
    location,
    sections,
    descriptionText,
  };
}

/**
 * Fetch one job's detail page under the session, trying PostingSeq=1 then
 * PostingSeq=2 (empirically necessary — see module header) before giving up.
 * Detail enrichment is best-effort: returns null (never throws) when neither
 * PostingSeq works, so the caller keeps the listing row without a description.
 * @param {{origin: string, site: string}} config
 * @param {{ctx: any, jar: Map<string, string>}} session
 * @param {string} jobId
 */
async function fetchJobDetail(config, session, jobId) {
  for (const seq of [1, 2]) {
    const url = assertPeopleSoftUrl(buildDetailUrl(config, jobId, seq), config);
    const html = await getWithSession(session.ctx, session.jar, config, url);
    const detail = parseJobDetail(html, jobId);
    if (detail.valid) return detail;
    // Invalid page or id mismatch — try the next PostingSeq before giving up.
  }
  return null;
}

// ── misc small helpers ──────────────────────────────────────────────────

function resolveMaxLoadMore(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_LOAD_MORE_CAP);
  return DEFAULT_MAX_LOAD_MORE;
}

function parsePeoplesoftEntryConfig(entry) {
  const cfg = (entry && entry.peoplesoft) || {};
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, DEFAULT_DETAIL_LIMIT, 1, 100),
  };
}

// ── provider ─────────────────────────────────────────────────────────────

/** @type {Provider} */
export default {
  id: 'peoplesoft',

  detect(entry) {
    const config = resolveConfig(entry);
    return config ? { url: config.searchUrl } : null;
  },

  async fetch(entry, ctx) {
    const config = resolveConfig(entry);
    if (!config) {
      throw new Error(`peoplesoft: cannot resolve a PeopleSoft Candidate Gateway search URL for ${entry.name}`);
    }

    const session = { ctx, jar: createCookieJar(), config };

    // See the module header's "Probe-budget note" — ctx.fetchResponse is NOT
    // covered by verify-portals' external request-budget guard, so this
    // cooperation is the only thing bounding a probe's request count.
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const maxLoadMore = probing ? Math.max(0, ctxMaxPages - 1) : resolveMaxLoadMore(entry);

    const firstPage = await fetchSearchPage(config, session);
    if (!firstPage.valid) {
      // Never "0 postings" for this shape — see module header.
      throw new Error(
        `peoplesoft: ${entry.name} returned an unrecognized search response (no form[name="win0"]) — ` +
          `likely a login/session-expired/challenge page, not zero postings (reason: ${firstPage.errorReason})`,
      );
    }

    const byId = new Map();
    for (const row of firstPage.rows) byId.set(row.jobId, row);
    let reportedTotal = firstPage.reportedTotal;

    let currentState = firstPage;
    let loadMoreCount = 0;
    let stopCause = null;
    let stopDetail = '';
    while (loadMoreCount < maxLoadMore) {
      if (reportedTotal !== null && byId.size >= reportedTotal) break;
      await sleep(INTER_REQUEST_DELAY_MS, ctx);
      let next;
      try {
        next = await fetchAdditionalResults(currentState, session);
      } catch (err) {
        // Probe budget cut-off / any fetch rejection must propagate UNWRAPPED
        // while probing (ADDING_A_PROVIDER.md); a real scan keeps what it has.
        if (probing) throw err;
        stopCause = 'load-more-fetch-failed';
        stopDetail = err.message;
        break;
      }
      loadMoreCount++;
      if (!next.valid) {
        stopCause = 'load-more-response-unrecognized';
        break;
      }
      if (next.reportedTotal !== null) reportedTotal = next.reportedTotal;
      let fresh = 0;
      for (const row of next.rows) {
        if (byId.has(row.jobId)) continue;
        byId.set(row.jobId, row);
        fresh++;
      }
      currentState = next;
      if (fresh === 0) {
        stopCause = 'load-more-no-progress';
        break; // server stopped returning new rows — real end or a loop; either way, stop
      }
    }

    // Completeness is meaningless during a probe (it only ever fetches page
    // one on purpose) — skip the marker/warning there entirely.
    //
    // Completeness can only be asserted when either (a) a reported total was
    // actually reached, or (b) the load-more walk genuinely ran out of new
    // rows on its own (load-more-no-progress) — the one clean-exhaustion
    // signal available on a tenant that never reports a count at all. Every
    // other stop (a fetch failure, an unrecognized response, or hitting the
    // load-more ceiling) must NOT be silently treated as "done" just because
    // `reportedTotal` happened to stay null — that used to be exactly the
    // gap: a tenant whose win0divHRS_AGNT_RSLT_Irowcnt$0 element is absent or
    // unparseable (parseReportedTotal() correctly returning null, a shape
    // this code is supposed to handle) looked byte-identical to a clean,
    // complete sweep — no warning, no marker, no reason. Mirrors
    // workday.mjs's stopReason, which never depends on ever having seen a
    // total.
    const reachedKnownTotal = reportedTotal !== null && byId.size >= reportedTotal;
    const cleanlyExhausted = reachedKnownTotal || (reportedTotal === null && stopCause === 'load-more-no-progress');
    const complete = probing || cleanlyExhausted;
    if (!probing && !complete) {
      if (!stopCause) stopCause = 'pagination-ceiling-reached';
      const totalDesc = reportedTotal === null ? 'an unknown total of' : `${reportedTotal} reported`;
      const prefix = `⚠️  peoplesoft: ${entry.name} — parsed ${byId.size} of ${totalDesc} postings; `;
      if (stopCause === 'load-more-fetch-failed') {
        console.error(`${prefix}load-more request failed${stopDetail ? `: ${stopDetail}` : ''}.`);
      } else if (stopCause === 'load-more-response-unrecognized') {
        console.error(`${prefix}a load-more response was not recognizable.`);
      } else if (stopCause === 'load-more-no-progress') {
        console.error(`${prefix}the load-more response contained no new postings.`);
      } else {
        console.error(`${prefix}raise max_pages on this entry, or this may be PeopleSoft's own ~100-result anonymous-session cap.`);
      }
    }

    const jobs = [];
    for (const row of byId.values()) {
      const job = {
        title: row.title,
        // PostingSeq=1 is the canonical public posting URL; a candidate
        // clicking through gets redirected to the working seq regardless.
        url: buildDetailUrl(config, row.jobId, 1),
        company: entry.name,
        location: row.location,
      };
      // department was previously carried through as an extra Job field, but
      // it isn't one (_types.js) and nothing downstream (scan.mjs, the
      // tracker/report writers) reads it off an output row — dropped per
      // review, same reasoning as descriptionHtml/descriptionSections/
      // employmentType below.
      if (typeof row.postedAt === 'number') job.postedAt = row.postedAt;
      jobs.push(Object.assign(job, { _jobId: row.jobId }));
    }

    // Detail enrichment answers "what does this job say", not "is this
    // endpoint alive" — skip entirely during a probe, same rule as
    // adp-workforcenow.mjs/vdab.mjs.
    //
    // Sequential, not a bounded-concurrency pool: fetchJobDetail() reads
    // `cookieHeader(session.jar)` and then merges Set-Cookie back into that
    // SAME jar (a plain Map) after every hop, and this provider's own header
    // comment documents PeopleSoft rotating its session cookie across the
    // chain. Running several fetchJobDetail() calls concurrently over one
    // shared jar lets one worker's mid-flight cookie read interleave with
    // another worker's write, handing it a stale or half-updated session —
    // ultipro.mjs / adp-workforcenow.mjs keep their own detail enrichment
    // sequential for exactly this reason, and there's no throughput case here
    // strong enough to reintroduce the race for it (detailLimit already
    // bounds the burst; see DEFAULT_DETAIL_LIMIT).
    const { fetchDetails, detailLimit } = parsePeoplesoftEntryConfig(entry);
    if (fetchDetails && !probing) {
      const targets = jobs.slice(0, detailLimit);
      for (const job of targets) {
        await sleep(INTER_REQUEST_DELAY_MS, ctx);
        try {
          const detail = await fetchJobDetail(config, session, job._jobId);
          if (detail?.descriptionText) job.description = detail.descriptionText;
        } catch {
          // Detail fetch is enrichment only — keep the listing result
          // (same fail-open contract as adp-workforcenow.mjs/smartrecruiters.mjs).
        }
      }
    }

    const out = jobs.map(({ _jobId, ...job }) => job);
    // Same convention as icims.mjs's `all.icimsTruncated` — an extra property
    // on the returned array, not a Job field, so a caller that wants to know
    // "was this a complete sweep" can check without every consumer having to
    // understand a new per-job flag.
    if (!probing && !complete) {
      out.peoplesoftIncomplete = {
        complete: false,
        reason: stopCause,
        collected: byId.size,
        reportedTotal,
      };
    }
    return out;
  },
};
