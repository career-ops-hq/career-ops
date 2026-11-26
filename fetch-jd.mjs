#!/usr/bin/env node
/**
 * fetch-jd.mjs — the one place a job description is fetched and read (#2582).
 *
 *   node fetch-jd.mjs <url> [--visible-text] [--browser]
 *
 * Three tiers, cheapest first; a later tier runs only when the earlier one found
 * nothing (fetchJd, at the bottom):
 *   1. the ATS's public JSON API (JD_TEXT_API_ATS in liveness-api.mjs), the same
 *      endpoint liveness checks use, which ships the whole JD for free where the
 *      rendered page is an unrendered shell;
 *   2. the page's own bytes: its schema.org JobPosting (JSON-LD) or embedded
 *      payload, read behind an egress guard. Phenom and bespoke career sites
 *      render the JD from script data, so any text conversion, WebFetch
 *      included, sees an empty shell;
 *   3. with --browser, the page rendered in headless Chromium.
 * browser-extract.mjs is a command line over the same fetchJd, so the two cannot
 * drift on which ATS is API-fetchable or what counts as a JD.
 *
 * JD text on stdout, exit 0, on a hit. Exit 3 with `CLOSED_POSTING <evidence>`
 * when the posting is closed: a JobPosting past its validThrough date, closure
 * text in the visible page, an HTTP 404 or 410, or (tier 3) a taken-down page.
 * Exit 2 with empty stdout when the page could not be reached at all (a transport
 * failure worth retrying). Exit 1 otherwise, with no stderr noise except a tier-3
 * failure reason: a miss is the expected "fall back" case, not an error, and a
 * visible miss is the whole point: never a fabricated JD.
 */

import { isMainModule } from './lib/is-main-module.mjs';
import { hasFlag } from './lib/cli-flags.mjs';

import { LIVENESS_CONTEXT_OPTIONS, rejectPrivateOrInvalid, validateUrlSecurity } from './liveness-browser.mjs';
import { browserLaunchOptions } from './lib/browser-launch.mjs';
import { DEFAULT_USER_AGENT } from './user-agent.mjs';
import { asciiLower, fromLdJson, fromEmbeddedDescription, embeddedDescriptionStrings, ldJsonBlocks, wordCount, htmlToText } from './lib/jd-parse.mjs';
import { classifyLiveness, cloudflareInterstitial } from './liveness-core.mjs';
import { resolveAtsApi, JD_TEXT_API_ATS } from './liveness-api.mjs';
import { resolveHimalayasPosting, retrieveHimalayasPosting } from './himalayas-posting.mjs';
import { fetchJson } from './providers/_http.mjs';
import { decodeEntities } from './providers/_html-entities.mjs';
import { isWorkModelOnly } from './providers/greenhouse.mjs';
import { buildLocation } from './providers/hirehive.mjs';
import { isZohoRecordClosed, parseZohoDetailPage } from './providers/zoho-recruit.mjs';
import { extractCandidateOpportunityDetail, extractLocations } from './providers/ultipro.mjs';
// Imported for its side effect: it installs the connect-time dns.lookup guard
// that providerFetchContext switches on. _http.mjs gets it the same way.
import { dnsLookupPatched } from './providers/_dns-cache.mjs';
import { providerFetchContext } from './providers/_ip-guard.mjs';

const MAX_REDIRECTS = 5;
// The most of one page ever downloaded, and of it ever inspected for a JD or closure.
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
// What this script's own command line keeps of a JD: a batch report reads the
// whole posting, so there is no token-budget reason to cap tighter than the
// library default (JD_TEXT_CAP).
export const CLI_TEXT_CAP = 20_000;
// Below this many words the "JD" is a stub, not a posting.
export const MIN_PAGE_JD_WORDS = 80;

// ========================================================================
// Shared — text helpers every tier uses
// ========================================================================

// What every fetch function keeps of a JD unless the caller asks otherwise.
export const JD_TEXT_CAP = 12_000;

export const TRUNCATION_NOTICE = (cap) =>
  `[Job description truncated here: the posting is longer than ${cap} characters. This text is NOT the complete job description.]`;

/**
 * Cap a JD without splitting a surrogate pair, and say so when it was cut. A
 * silent cut would let a caller score and archive a partial JD as the whole
 * thing, so the notice is part of the text. Pure — exported for tests.
 */
export function capJdText(text, cap) {
  if (text.length <= cap) return text;
  let cut = text.slice(0, cap);
  // A UTF-16 slice can land between the halves of a surrogate pair.
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  // Prefer to end on a paragraph boundary when one is near the cap.
  const para = cut.lastIndexOf('\n\n');
  if (para > cap * 0.6) cut = cut.slice(0, para);
  return `${cut.trimEnd()}\n\n${TRUNCATION_NOTICE(cap)}`;
}


// Collapse runs of whitespace.
export function tidyText(s) {
  return String(s ?? '').replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// A short field (title, page excerpt) kept to `cap` characters, cut with a bare `…`.
export function compactText(s, cap = JD_TEXT_CAP) {
  const text = tidyText(s);
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

// A JD body kept to `cap` characters; a cut says so (capJdText), so nobody archives it as whole.
export function jdText(s, cap = JD_TEXT_CAP) {
  return capJdText(tidyText(s), cap);
}

// ========================================================================
// Tier 1 — the ATS's public API: one fetcher and one normalizer per ATS
// ========================================================================

export const API_TIMEOUT_MS = 10_000;

/**
 * Map a `*.myworkdayjobs.com` posting URL to its public per-job CXS endpoint,
 * or null for any other URL.
 *
 * Derivation (tenant/shard/site/jobPath -> `/wday/cxs/{tenant}/{site}/job/{path}`)
 * is delegated to liveness-api.mjs's Workday provider so there is exactly one
 * copy of it, including its SSRF guard: every path segment taken from the input
 * URL is charset-validated and ".." -rejected before it reaches the fixed
 * `{tenant}.{shard}.myworkdayjobs.com` host template.
 *
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function workdayCxsUrl(rawUrl) {
  const ats = resolveAtsApi(rawUrl);
  return ats && ats.ats === 'workday' ? ats.apiUrl : null;
}

/**
 * Shape a jd-mode result from a Workday CXS job payload, into the SAME
 * `{ url, title, text }` contract as the scraped path so no caller has to know
 * which route produced it. Pure — exported for tests.
 *
 * Returns null when the payload isn't a job (`jobPostingInfo` missing) or
 * carries no description, so the caller can fall through to the browser rather
 * than emit a confidently empty JD.
 *
 * `url` is the POSTING url the user passed, not the CXS endpoint: it is what
 * ends up in reports and the tracker.
 *
 * The metadata header is prepended to `text` because each of those fields is
 * evaluation signal the rendered page shows and the description alone does not
 * — location for the location filter, `jobReqId` for the tracker's same-title
 * disambiguation rule, and `canApply: false` as a liveness signal on a posting
 * still served but no longer accepting applications.
 *
 * @param {any} json - parsed CXS response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeWorkdayJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  const info = json && typeof json === 'object' ? json.jobPostingInfo : null;
  if (!info || typeof info !== 'object') return null;

  const body = htmlToText(info.jobDescription);
  if (!body) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const locations = [
    str(info.location),
    ...(Array.isArray(info.additionalLocations) ? info.additionalLocations.map(str) : []),
  ].filter(Boolean);

  const meta = [];
  if (locations.length) meta.push(`Location: ${locations.join(' | ')}`);
  if (str(info.timeType)) meta.push(`Job type: ${str(info.timeType)}`);
  if (str(info.postedOn)) meta.push(`Posted: ${str(info.postedOn)}`);
  if (str(info.jobReqId)) meta.push(`Req ID: ${str(info.jobReqId)}`);
  if (info.canApply === false) meta.push('Applications closed (canApply: false)');

  return {
    url: postingUrl,
    title: compactText(str(info.title), 300),
    text: jdText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

/**
 * Read the body of a response no fetcher will use, dropping each chunk as it
 * arrives, and return null. Left unread, a body still arriving keeps its
 * socket open, and with it the process: fetch-jd.mjs exits once nothing is
 * left to run. Fetchers await this inside their try, so the read stays under
 * their abort timer and a body that never ends stops at the same timeout as
 * the rest of the request. Reading, not cancelling: these error bodies are
 * small, while a cancel aborts the request mid-body and undici then opens a
 * new connection that the process waits for (0.1 to 2.5 s on real Greenhouse
 * and Workday misses, Node 24).
 *
 * @param {Response} res
 */
async function drainBody(res) {
  try {
    const reader = res.body?.getReader();
    while (reader && !(await reader.read()).done) { /* drop the chunk */ }
  } catch { /* cut off by the abort timer, or unreadable */ }
  return null;
}

/**
 * GET one ATS endpoint and return its body, parsed as JSON (default) or read as
 * text, or null for ANY inconclusive outcome: a blocked host, a redirect (never
 * followed: one off the derived host is not one to trust), a non-200, an
 * unparseable body or a timeout. Every per-ATS fetcher goes through here, so the
 * guard, the abort timer and the error-body drain exist once.
 *
 * @param {string} apiUrl
 * @param {{timeoutMs: number, as?: 'json'|'text', headers?: Record<string, string>}} opts
 * @returns {Promise<any|null>}
 */
async function fetchApiBody(apiUrl, { timeoutMs, as = 'json', headers = {} }) {
  if (rejectPrivateOrInvalid(apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: as === 'json' ? 'application/json' : 'text/html', 'user-agent': DEFAULT_USER_AGENT, ...headers },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return await drainBody(res);
    return as === 'json' ? await res.json() : await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch + shape one Workday posting from its CXS endpoint. Returns null for
 * ANY inconclusive outcome (blocked host, redirect, non-200, unparseable or
 * unexpected body, timeout) so the caller falls through to the browser path —
 * where a removed posting still yields the real "this job is no longer
 * available" page rather than a hard error.
 *
 * @param {string} apiUrl
 * @param {string} postingUrl
 * @param {number} textCap
 * @param {number} timeoutMs
 */
async function fetchWorkdayJd(resolved, postingUrl, textCap, timeoutMs) {
  const json = await fetchApiBody(resolved.apiUrl, { timeoutMs: Math.max(timeoutMs, API_TIMEOUT_MS) });
  return json && normalizeWorkdayJob(json, postingUrl, textCap);
}

/**
 * Shape one Ashby board entry into a jd-mode result. Pure, so the field
 * mapping is unit-testable without a network round trip.
 *
 * Ashby's public API is ORG-level (the whole board), not per-job, so the job
 * is selected here by a case-insensitive `id` compare — mirroring
 * classifyAshbyBoard's match logic without importing it, since that function
 * returns a liveness verdict, not a job record.
 *
 * `descriptionPlain` is already plain text, so it needs no htmlToText pass.
 * The metadata header carries what the rendered page shows and the description
 * does not, same rationale as normalizeWorkdayJob.
 *
 * @param {any} json - parsed board response body
 * @param {string} jobId - the {jobId} path segment from the posting URL
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeAshbyJob(json, jobId, postingUrl, textCap = JD_TEXT_CAP) {
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  const target = String(jobId ?? '').toLowerCase();
  const job = jobs.find((j) => typeof j?.id === 'string' && j.id.toLowerCase() === target);
  if (!job) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const body = str(job.descriptionPlain);
  if (!body) return null;

  const meta = [];
  if (str(job.location)) meta.push(`Location: ${str(job.location)}`);
  if (Array.isArray(job.secondaryLocations)) {
    const extra = job.secondaryLocations.map((l) => str(l?.location)).filter(Boolean);
    if (extra.length) meta.push(`Additional locations: ${extra.join(' | ')}`);
  }
  if (str(job.employmentType)) meta.push(`Type: ${str(job.employmentType)}`);
  // Remote work model, same precedence providers/ashby.mjs:160 settled on:
  // `workplaceType` wins whenever present and `isRemote` is only the fallback.
  // The two disagree constantly — 52 of 60 sampled ramp postings carry
  // `isRemote: true` beside `workplaceType: "Hybrid"` — so trusting isRemote
  // alone labels office-anchored roles Remote. The fallback still earns its
  // place: `workplaceType` is absent on 41 of 60 sampled openai postings.
  const workplaceType = str(job.workplaceType);
  if (workplaceType) meta.push(`Work model: ${workplaceType}`);
  else if (job.isRemote === true) meta.push('Work model: Remote');
  if (job.isListed === false) meta.push('Not currently listed (isListed: false)');

  return {
    url: postingUrl,
    title: compactText(str(job.title), 300),
    text: jdText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
    // isListed:false is NOT closure: Ashby serves an unlisted posting by direct
    // link and it can still take applications. The note in the text is the only
    // carrier; closure needs independent evidence.
  };
}

/**
 * Fetch + shape one Ashby posting from its org's job-board API. Returns null
 * for ANY inconclusive outcome (blocked host, non-200, unparseable body, job
 * not found on the board, timeout) so the caller falls through to the browser
 * path, same contract as fetchWorkdayJd.
 *
 * Ashby's public API is ORG-level (the whole board), not per-job — this fetches
 * the board once and picks out `jobId`, mirroring classifyAshbyBoard's match
 * logic (case-insensitive `id` compare) without importing it, since that
 * function returns a liveness verdict, not a job record.
 *
 * @param {string} apiUrl - the org board URL (`resolveAtsApi(url).apiUrl`)
 * @param {string} jobId - the {jobId} path segment from the original URL
 * @param {string} postingUrl
 * @param {number} textCap
 * @param {number} timeoutMs
 */
async function fetchAshbyJd(resolved, postingUrl, textCap, timeoutMs) {
  const json = await fetchApiBody(resolved.apiUrl, { timeoutMs });
  return json && normalizeAshbyJob(json, resolved.parts.jobId, postingUrl, textCap);
}

/**
 * Shape one Greenhouse per-job payload into a jd-mode result. Pure, same
 * contract as normalizeWorkdayJob/normalizeAshbyJob.
 *
 * `content` is HTML (and HTML-escaped at that), so it goes through
 * htmlToText exactly like Workday's `jobDescription`. `requisition_id` is
 * carried for the tracker's same-title disambiguation rule.
 *
 * `location.name` is the PRIMARY location field and `offices[]` is enrichment
 * — the same precedence providers/greenhouse.mjs:196 applies, reusing its
 * exported isWorkModelOnly so the two cannot drift. Some boards put the work
 * model ("Hybrid", "Distributed") in `location.name` and keep the actual city
 * only in `offices[]`; for exactly those the two are joined, and everywhere
 * else `location.name` stands alone rather than being shadowed by a
 * near-duplicate office entry (a live figma posting carries
 * `location.name: "Berlin, Germany"` beside `offices[0].name: "Berlin, DE "`).
 * Reading `offices[]` alone — as this did before — dropped the `Location:`
 * line entirely for any job whose offices array is empty, which is 7 of 20
 * sampled gitlab postings.
 *
 * The provider pays a separate /offices request for this because the boards
 * LIST endpoint omits offices; the per-job endpoint here returns them inline,
 * so the enrichment is free and can also serve as the fallback when a board
 * ships no `location.name` at all.
 *
 * @param {any} json - parsed boards-api response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeGreenhouseJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  const body = htmlToText(json?.content);
  if (!body) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const meta = [];
  const offices = Array.isArray(json?.offices) ? json.offices.map((o) => str(o?.name)).filter(Boolean) : [];
  let location = str(json?.location?.name);
  if (offices.length && (!location || isWorkModelOnly(location))) {
    location = [location, ...offices].filter(Boolean).join(' · ');
  }
  if (location) meta.push(`Location: ${location}`);
  if (str(json?.requisition_id)) meta.push(`Req ID: ${str(json.requisition_id)}`);

  return {
    url: postingUrl,
    title: compactText(str(json?.title), 300),
    text: jdText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

/**
 * Fetch + shape one Greenhouse posting from its per-job boards-api endpoint.
 * Same failure contract as fetchWorkdayJd/fetchAshbyJd.
 *
 * `content=true` is required — without it the endpoint omits the JD body
 * entirely (same query param providers/greenhouse.mjs uses for its list scan).
 * `content` comes back as HTML, so it goes through htmlToText like Workday's
 * `jobDescription`.
 *
 * @param {string} apiUrl - `resolveAtsApi(url).apiUrl` (no query string)
 * @param {string} postingUrl
 * @param {number} textCap
 * @param {number} timeoutMs
 */
async function fetchGreenhouseJd(resolved, postingUrl, textCap, timeoutMs) {
  const json = await fetchApiBody(`${resolved.apiUrl}?content=true`, { timeoutMs });
  return json && normalizeGreenhouseJob(json, postingUrl, textCap);
}

/**
 * Shape one Lever posting into a jd-mode result. Pure, same contract as the
 * other normalizers.
 *
 * `descriptionPlain` is already plain text but is only the first slice of the
 * JD. `lists` carries the labeled sections ("Requirements", "Nice to have")
 * as separate HTML blocks, and `additionalPlain` the trailing "Life at …" /
 * benefits / comp copy — both appended in the order the rendered page shows
 * them, or the JD loses its requirements and its comp entirely. The share is
 * not marginal: on a sampled gopuff posting `descriptionPlain` is 760 chars
 * against 938 in `additionalPlain`, and `additionalPlain` is never contained
 * in `descriptionPlain` (checked over 10 postings on two boards). Do NOT also
 * append `openingPlain` / `descriptionBodyPlain`: `descriptionPlain` already
 * equals their concatenation, so adding them duplicates the description.
 *
 * Order is the contract, since jdText truncates the TAIL — a lowered
 * `--max-chars` has to drop boilerplate, not requirements.
 *
 * There is no closed-state check. The public v0 endpoint 404s a closed posting
 * (liveness-api.mjs:91) and emits no `state` field at all on a live one
 * (verified over 10 postings on two boards), so the fetcher's non-OK guard is
 * the whole of it.
 *
 * @param {any} json - parsed postings-api response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeLeverJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  if (!json || typeof json !== 'object') return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const lists = Array.isArray(json.lists)
    ? json.lists
        .map((l) => {
          const heading = str(l?.text);
          const content = htmlToText(l?.content);
          return content ? `${heading ? `${heading}\n` : ''}${content}` : '';
        })
        .filter(Boolean)
        .join('\n\n')
    : '';
  // Lever can leave descriptionPlain empty while description holds the HTML.
  const intro = str(json.descriptionPlain) || htmlToText(json.description);
  const body = [intro, lists, str(json.additionalPlain)].filter(Boolean).join('\n\n');
  if (!body) return null;

  const meta = [];
  if (str(json?.categories?.location)) meta.push(`Location: ${str(json.categories.location)}`);
  if (str(json?.categories?.team)) meta.push(`Team: ${str(json.categories.team)}`);

  return {
    url: postingUrl,
    title: compactText(str(json.text), 300),
    text: jdText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

/**
 * Fetch + shape one Lever posting from its per-job postings endpoint. Same
 * failure contract as fetchWorkdayJd/fetchAshbyJd/fetchGreenhouseJd.
 *
 * `descriptionPlain` is already plain text (no HTML stripping needed, unlike
 * Greenhouse/Workday). `lists` carries the JD's labeled sections (e.g.
 * "Requirements", "Nice to have") as separate HTML blocks — appended after
 * the main description the same way the rendered page shows them.
 *
 * @param {string} apiUrl - `resolveAtsApi(url).apiUrl`
 * @param {string} postingUrl
 * @param {number} textCap
 * @param {number} timeoutMs
 */
async function fetchLeverJd(resolved, postingUrl, textCap, timeoutMs) {
  const json = await fetchApiBody(resolved.apiUrl, { timeoutMs });
  return json && normalizeLeverJob(json, postingUrl, textCap);
}

/**
 * Greenhouse posting reached through a company careers page (`?gh_jid=` only,
 * no board in the URL). The embed redirect names the board — the same
 * `followEmbed` hop liveness uses, which also pins the redirect target to
 * greenhouse.io — and the per-job boards-api endpoint then ships the JD.
 */
async function fetchGreenhouseEmbeddedJd(resolved, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(resolved.apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let jobApiUrl;
  try {
    const res = await fetch(resolved.apiUrl, {
      headers: { 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'manual',
      signal: controller.signal,
    });
    jobApiUrl = await resolved.followEmbed(res, resolved.parts);
    await drainBody(res); // only its status and Location header are read
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return jobApiUrl ? fetchGreenhouseJd({ ...resolved, apiUrl: jobApiUrl }, postingUrl, textCap, timeoutMs) : null;
}

/**
 * Shape one SmartRecruiters posting into a jd-mode result. Pure, same contract
 * as the other normalizers. The body is `jobAd.sections`, HTML blocks appended
 * in the order the rendered page shows them; the location object also carries
 * remote/hybrid flags, surfaced because they are often the only work-model
 * signal the posting has.
 *
 * @param {any} json - parsed postings-API response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeSmartRecruitersJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  const sections = json?.jobAd?.sections;
  if (!sections || typeof sections !== 'object') return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const blocks = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
    .map((key) => {
      const body = htmlToText(sections[key]?.text);
      return body ? [str(sections[key]?.title), body].filter(Boolean).join('\n') : '';
    })
    .filter(Boolean);
  if (!blocks.length) return null;

  const loc = json?.location || {};
  const meta = [];
  const where = str(loc.fullLocation) || [str(loc.city), str(loc.country)].filter(Boolean).join(', ');
  if (where) meta.push(`Location: ${where}`);
  if (loc.remote === true) meta.push('Work model: Remote');
  else if (loc.hybrid === true) meta.push('Work model: Hybrid');
  // A closed posting can still ship its ad. The marker carries `active: false`
  // with the text the way Workday carries `canApply: false`, so the caller
  // reads the closure instead of falling back to a page that hides it.
  if (json?.active === false) meta.push('Applications closed (active: false)');

  return {
    url: postingUrl,
    title: compactText(str(json?.name), 300),
    text: jdText([meta.join('\n'), ...blocks].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchSmartRecruitersJd(resolved, postingUrl, textCap, timeoutMs) {
  const json = await fetchApiBody(resolved.apiUrl, { timeoutMs });
  return json && normalizeSmartRecruitersJob(json, postingUrl, textCap);
}

/**
 * Shape one Zoho Recruit posting page into a jd-mode result. Pure, same
 * contract as the other normalizers. The page embeds the posting record
 * (providers/zoho-recruit.mjs parseZohoDetailPage); its `Job_Description` is
 * HTML. The record must be THIS posting's: a page carrying another id, or no
 * record (a removed posting), returns null so the caller falls through.
 *
 * @param {any} html - the posting page's body
 * @param {string} id - the {id} path segment from the posting URL
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeZohoJob(html, id, postingUrl, textCap = JD_TEXT_CAP) {
  const record = parseZohoDetailPage(html);
  if (!record || String(record.id) !== String(id)) return null;
  const body = htmlToText(record.Job_Description);
  if (!body) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const meta = [];
  const location = [str(record.City), str(record.State), str(record.Country)].filter(Boolean).join(', ');
  if (location) meta.push(`Location: ${location}`);
  if (record.Remote_Job === true) meta.push('Work model: Remote');
  if (str(record.Job_Type)) meta.push(`Job type: ${str(record.Job_Type)}`);
  if (str(record.Salary)) meta.push(`Salary: ${str(record.Salary)}`);
  if (str(record.Date_Opened)) meta.push(`Posted: ${str(record.Date_Opened)}`);
  if (isZohoRecordClosed(record)) meta.push('Applications closed (the career site shows the posting as filled)');

  return {
    url: postingUrl,
    title: compactText(str(record.Posting_Title) || str(record.Job_Opening_Name), 300),
    text: jdText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchZohoJd(resolved, postingUrl, textCap, timeoutMs) {
  const html = await fetchApiBody(resolved.apiUrl, { timeoutMs, as: 'text' });
  return html && normalizeZohoJob(html, resolved.parts.id, postingUrl, textCap);
}

/**
 * Shape one HireHive per-posting API answer into a jd-mode result. Pure, same
 * contract as the other normalizers. The body must be THIS posting's: another
 * id returns null so the caller falls through.
 *
 * @param {any} json - parsed `/api/v1|v2/jobs/<id>` response body
 * @param {string} id - `job_<shortid>` (v2) or the posting number (v1)
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeHireHiveJob(json, id, postingUrl, textCap = JD_TEXT_CAP) {
  if (!json || String(json.id) !== String(id)) return null;
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const body = htmlToText(json.description?.html) || str(json.description?.text);
  if (!body) return null;
  const meta = [];
  const location = buildLocation(json);
  if (location) meta.push(`Location: ${location}`);
  if (str(json.type?.name)) meta.push(`Job type: ${str(json.type.name)}`);
  const posted = str(json.published_date) || (Number.isFinite(json.publishedDate) ? new Date(json.publishedDate * 1000).toISOString() : '');
  if (posted) meta.push(`Posted: ${posted.slice(0, 10)}`);
  return {
    url: postingUrl,
    title: compactText(str(json.title), 300),
    text: jdText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchHireHiveJd(resolved, postingUrl, textCap, timeoutMs) {
  const json = await fetchApiBody(resolved.apiUrl, { timeoutMs });
  return json && normalizeHireHiveJob(json, resolved.parts.id, postingUrl, textCap);
}

// `JobLocationType` as the board labels it. The page maps the number in script
// it loads from elsewhere, so this was read off rendered pages: on 2026-10-29,
// of 103 postings read in a browser, the 41 with 1 showed "On-site", the 6
// with 2 "Remote" and the 8 with 0 "Hybrid"; the 48 without one showed none.
const ULTIPRO_WORK_MODELS = { 0: 'Hybrid', 1: 'On-site', 2: 'Remote' };

// The record's criteria lists, in the order the page's Qualifications section
// shows them, each item worded as the page words it.
const ULTIPRO_CRITERIA = [
  ['SkillCriteria', 'Skill', (c) => [c.SkillName, c.MinimumScaleValueCode && c.MinimumScaleValueCode !== 'NONE' ? c.MinimumScaleValueDescription : '', c.SkillDescription]],
  ['BehaviorCriteria', 'Behavior', (c) => [c.BehaviorName, c.BehaviorDescription]],
  ['MotivationCriteria', 'Motivation', (c) => [c.MotivationName, c.MotivationDescription]],
  ['EducationCriteria', 'Education', (c) => [c.DegreeName && `${c.DegreeName} or better${c.MajorName ? ` in ${c.MajorName}${c.Related ? ' or related field' : ''}` : ''}`]],
  ['WorkExperienceCriteria', 'Experience', (c) => [ultiproYears(c.MinimumRequiredYears, c.MaximumRequiredYears), c.Description]],
  ['LicenseAndCertificationCriteria', 'License or certification', (c) => [c.LicenseAndCertificationName]],
];

// The page reads "8-10 years" for a range and "5 years" for a minimum alone. No
// sampled posting had a maximum alone; "Up to" keeps it from reading as a floor.
function ultiproYears(min, max) {
  if (Number.isFinite(min) && Number.isFinite(max)) return `${min}-${max} years`;
  if (Number.isFinite(min)) return `${min} years`;
  return Number.isFinite(max) ? `Up to ${max} years` : '';
}

/**
 * Shape one UltiPro (UKG Pro Recruiting) detail page into a jd-mode result.
 * Pure, same contract as normalizeZohoJob: UKG has no per-posting JSON API
 * either, and the page embeds the posting record (providers/ultipro.mjs
 * extractCandidateOpportunityDetail), whose `Description` is HTML. The record
 * must be THIS posting's: the extractor throws on another id or on a page
 * that changed shape, and finds nothing on the board's empty page (a removed
 * posting). Each of those returns null so the caller falls through.
 *
 * The page shows more than the description: the header facts and a
 * Qualifications section built from the record's criteria lists. Both are kept,
 * so this text holds what a browser read of the page does, without its
 * buttons and the equal-opportunity notice: on 2026-10-29, of 103 postings
 * read both ways, every work model, pay line, travel line and criteria list
 * the page showed was here too. Qualifications go before the description
 * because jdText cuts the tail, and a long description must not push the
 * requirements out.
 *
 * A closed posting keeps its record, so its JD is still returned, with the
 * closure in the header, as normalizeWorkdayJob does for `canApply: false`.
 *
 * @param {any} html - the detail page's body
 * @param {string} id - the posting's opportunityId, lower-cased as the rung requests it
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeUltiproJob(html, id, postingUrl, textCap = JD_TEXT_CAP) {
  let record;
  try {
    const found = extractCandidateOpportunityDetail(html, id);
    if (found.status !== 'ok') return null;
    record = found.detail;
  } catch {
    return null;
  }
  const body = htmlToText(record.Description);
  if (!body) return null;

  const str = (v) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : '');
  const meta = [];
  const location = extractLocations(record.Locations);
  if (location) meta.push(`Location: ${location}`);
  const workModel = ULTIPRO_WORK_MODELS[record.JobLocationType];
  if (workModel) meta.push(`Work model: ${workModel}`);
  if (typeof record.FullTime === 'boolean') meta.push(`Job type: ${record.FullTime ? 'Full time' : 'Part time'}`);
  if (str(record.JobCategoryName)) meta.push(`Job category: ${str(record.JobCategoryName)}`);
  const pay = record.PayRangeVisible === true ? record.PayRange : null;
  if (str(pay?.PayRangeMinimum) && str(pay?.PayRangeMaximum)) {
    meta.push(`Pay range: ${str(pay.PayRangeMinimum)} to ${str(pay.PayRangeMaximum)} ${str(record.PayRangeCurrencyCode)}`.trim());
  }
  const amount = record.CompensationAmount;
  if (str(amount?.Value)) {
    const salaried = record.Salaried === true;
    meta.push(`${salaried ? 'Salary' : 'Pay'}: ${[str(amount.Value), str(amount.Code), salaried ? 'per year' : ''].filter(Boolean).join(' ')}`);
  }
  if (typeof record.TravelRequired === 'boolean') {
    const travel = str(record.TravelDescription);
    meta.push(`Travel required: ${record.TravelRequired ? 'Yes' : 'No'}${travel ? ` (${travel})` : ''}`);
  }
  const posted = str(record.PostedDate).match(/^\d{4}-\d{2}-\d{2}/);
  if (posted) meta.push(`Posted: ${posted[0]}`);
  if (str(record.RequisitionNumber)) meta.push(`Req ID: ${str(record.RequisitionNumber)}`);
  if (record.OpportunityIsClosed === true) meta.push('Applications closed (OpportunityIsClosed: true)');

  const qualifications = [];
  for (const [key, label, words] of ULTIPRO_CRITERIA) {
    const items = Array.isArray(record[key]) ? record[key].filter((c) => c && typeof c === 'object') : [];
    // Required first, then preferred, as the page groups them.
    for (const required of [true, false]) {
      for (const c of items.filter((item) => (item.Required === true) === required)) {
        const text = words(c).map(str).filter(Boolean).join(': ');
        if (text) qualifications.push(`- ${label} (${required ? 'required' : 'preferred'}): ${text}`);
      }
    }
  }

  return {
    url: postingUrl,
    title: compactText(str(record.Title), 300),
    text: jdText([
      meta.join('\n'),
      qualifications.length ? `Qualifications:\n${qualifications.join('\n')}` : '',
      body,
    ].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchUltiproJd(resolved, postingUrl, textCap, timeoutMs) {
  const html = await fetchApiBody(resolved.apiUrl, { timeoutMs, as: 'text' });
  return html && normalizeUltiproJob(html, resolved.parts.id, postingUrl, textCap);
}

/**
 * Shape one HiBob `/api/job-ad/{uuid}/application-form` answer into a jd-mode
 * result. Pure, same contract as the other normalizers. `data.jobAd` carries
 * the title, the site as the page shows it ("Berlin, Germany"), the work model
 * and the employment type; `jobDescription` keys each field by a path ending
 * in `/jobDescription/{field}` and wraps the value as `{ value }`. The four
 * text sections are HTML and keep the tenant's own section labels when it set
 * them.
 *
 * @param {any} json - parsed application-form response body
 * @param {string} postingUrl
 * @param {number} [textCap]
 */
export function normalizeHibobJob(json, postingUrl, textCap = JD_TEXT_CAP) {
  const ad = json?.data?.jobAd;
  if (!ad || typeof ad !== 'object') return null;
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const fields = ad.jobDescription && typeof ad.jobDescription === 'object' ? ad.jobDescription : {};
  const field = (name) => {
    const key = Object.keys(fields).find((k) => k.endsWith(`/jobDescription/${name}`));
    return key ? fields[key]?.value : undefined;
  };
  const labels = field('sectionLabels') && typeof field('sectionLabels') === 'object' ? field('sectionLabels') : {};
  const blocks = [];
  for (const [key, label] of [['description', 'Description'], ['responsibilities', 'Responsibilities'], ['requirements', 'Requirements'], ['benefits', 'Benefits']]) {
    const body = htmlToText(typeof field(key) === 'string' ? field(key) : '');
    if (body) blocks.push(`${str(labels[key]) || label}:\n${body}`);
  }
  if (!blocks.length) return null;

  const meta = [];
  if (str(ad.site)) meta.push(`Location: ${str(ad.site)}`);
  if (str(ad.workspaceType)) meta.push(`Work model: ${str(ad.workspaceType)}`);
  if (str(ad.employmentType)) meta.push(`Type: ${str(ad.employmentType)}`);
  const min = field('payTransparencyMinSalary');
  const max = field('payTransparencyMaxSalary');
  const range = [min, max].filter((v) => typeof v === 'number' && v > 0).map((v) => v.toLocaleString('en-US')).join(' – ');
  if (range) meta.push(`Salary: ${[range, str(field('payTransparencySalaryCurrency')), str(field('payTransparencySalaryPayPeriod'))].filter(Boolean).join(' ')}`);

  return {
    url: postingUrl,
    title: compactText(str(ad.title), 300),
    text: jdText([meta.join('\n'), ...blocks].filter(Boolean).join('\n\n'), textCap),
  };
}

async function fetchHibobJd(resolved, postingUrl, textCap, timeoutMs) {
  const json = await fetchApiBody(resolved.apiUrl, { timeoutMs, headers: resolved.headers });
  return json && normalizeHibobJob(json, postingUrl, textCap);
}

/** Workable full-body JD, independent of liveness state and listing text caps. */
export function normalizeWorkableJob(json, shortcode, postingUrl, textCap = JD_TEXT_CAP) {
  if (!json || typeof json !== 'object' || json.shortcode !== shortcode ||
      typeof json.title !== 'string' || !json.title.trim()) return null;
  const title = compactText(htmlToText(json.title), 300);
  if (!title) return null;
  const blocks = [];
  for (const [key, label] of [['description', 'Description'], ['requirements', 'Requirements'], ['benefits', 'Benefits']]) {
    const html = typeof json[key] === 'string' ? json[key] : '';
    // Decode before removing chrome: the API can entity-escape its HTML tags.
    const body = htmlToText(decodeEntities(html).replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '));
    if (/[\p{L}\p{N}]/u.test(body)) blocks.push(`${label}:\n${body}`);
  }
  if (!blocks.length) return null;
  return {
    url: postingUrl,
    title,
    text: jdText(blocks.join('\n\n'), textCap),
  };
}

/** Reuse the resolver's guarded share-link hop; never follow API redirects. */
async function fetchWorkableJd(resolved, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(resolved.apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const options = {
    headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
    redirect: 'error',
    signal: controller.signal,
  };
  // The share link's redirect, of which only the status and Location header
  // are read. Its body is drained last: both requests share one timer, so a
  // slow body read first would spend the posting request's budget.
  let redirect;
  try {
    let apiUrl = resolved.apiUrl;
    if (resolved.followEmbed) {
      redirect = await fetch(apiUrl, { ...options, redirect: 'manual' });
      apiUrl = await resolved.followEmbed(redirect, resolved.parts);
      if (!apiUrl || rejectPrivateOrInvalid(apiUrl)) return null;
    }
    const res = await fetch(apiUrl, options);
    if (!res.ok) return await drainBody(res);
    return normalizeWorkableJob(await res.json(), resolved.parts.shortcode, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    if (redirect) await drainBody(redirect);
    clearTimeout(timer);
  }
}

/** JD-only sources leave the liveness resolver and its classifications unchanged. */
export function resolveJdApi(url) {
  const himalayas = resolveHimalayasPosting(url);
  if (himalayas) return { ats: 'himalayas', apiUrl: himalayas.apiUrl };

  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const bambooHost = /^[a-z0-9][a-z0-9-]*\.bamboohr\.com$/.test(parsed.hostname);
  if (bambooHost && parsed.protocol === 'https:' && !parsed.port && !parsed.username && !parsed.password) {
    const posting = /^\/careers\/(\d+)\/?$/.exec(parsed.pathname);
    if (posting) {
      const postingPath = parsed.origin + '/careers/' + posting[1];
      return { ats: 'bamboohr', apiUrl: postingPath + '/detail', postingPath };
    }
  }

  return resolveAtsApi(url);
}

/**
 * Shape a BambooHR posting JSON into a JD, or null when the posting is not open
 * or its share URL is not the posting that was asked for. Pure — exported for tests.
 */
export function normalizeBambooHrJob(data, postingPath, url, textCap = JD_TEXT_CAP) {
  const job = data?.result?.jobOpening;
  if (job?.jobOpeningStatus !== 'Open' || typeof job.jobOpeningShareUrl !== 'string') return null;
  const shareUrl = new URL(job.jobOpeningShareUrl);
  const sharePath = shareUrl.origin + shareUrl.pathname.replace(/\/$/, '');
  if (shareUrl.username || shareUrl.password || sharePath !== postingPath) return null;
  const text = htmlToText(job.description);
  if (!text) return null;
  return { url, title: compactText(htmlToText(job.jobOpeningName), 300), text: jdText(text, textCap) };
}
async function fetchBambooHrJd(resolved, url, textCap, timeoutMs) {
  try {
    const data = await fetchJson(resolved.apiUrl, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      timeoutMs,
      maxBytes: 1024 * 1024,
    });
    return normalizeBambooHrJob(data, resolved.postingPath, url, textCap);
  } catch {
    return null;
  }
}
/**
 * Shape a Himalayas posting (retrieveHimalayasPosting's result) into a JD, or
 * null when the publisher does not list it as open. Pure — exported for tests.
 */
export function normalizeHimalayasJob(result, url, textCap = JD_TEXT_CAP) {
  if (result.publisherStatus !== 'open') return null;
  const text = htmlToText(result.job.description);
  if (!text) return null;
  return { url, title: compactText(result.job.title, 300), text: jdText(text, textCap) };
}
async function fetchHimalayasJd(_resolved, url, textCap, timeoutMs) {
  return normalizeHimalayasJob(await retrieveHimalayasPosting(url, { timeoutMs }), url, textCap);
}

/**
 * ats id → fetcher. THE routing table `fetchJdViaKnownApi` dispatches through,
 * exported so the owned test can assert its key set IS `JD_TEXT_API_ATS`.
 *
 * A `switch` could not carry that guarantee: deleting `case 'lever'` leaves a
 * test that only re-derives ids from `resolveAtsApi` green, because such a
 * test never touches the dispatcher. A map's keys ARE the dispatcher, so the
 * same deletion reddens it.
 *
 * Every entry is `fetch<Ats>Jd(resolved, url, textCap, timeoutMs)`: it takes what
 * it needs from `resolved` (`apiUrl`, `parts`, `headers`), gets the body, and
 * hands it to that ATS's `normalize<Ats>Job`. Dispatch stays a lookup.
 */
export const JD_FETCHERS = {
  bamboohr: fetchBambooHrJd,
  himalayas: fetchHimalayasJd,
  workable: fetchWorkableJd,
  'workable-short': fetchWorkableJd,
  workday: fetchWorkdayJd,
  ashby: fetchAshbyJd,
  greenhouse: fetchGreenhouseJd,
  lever: fetchLeverJd,
  'greenhouse-embedded': fetchGreenhouseEmbeddedJd,
  smartrecruiters: fetchSmartRecruitersJd,
  'zoho-recruit': fetchZohoJd,
  ultipro: fetchUltiproJd,
  hirehive: fetchHireHiveJd,
  hibob: fetchHibobJd,
};

/**
 * Try every known JD-text-capable ATS API for one posting URL before anyone
 * reaches for a browser. This is the single dispatch point both this script's
 * own CLI (jd mode) and `fetch-jd.mjs` (the bash-callable front door) call —
 * one copy of the routing table, so the interactive and headless paths cannot
 * drift on which ATS is API-fetchable.
 *
 * @param {string} url
 * @param {number} [textCap]
 * @param {number} [timeoutMs]
 * @returns {Promise<{url: string, title: string, text: string, ats: string}|null>}
 *   null = not a JD_TEXT_API_ATS host, or the fetch/parse was inconclusive —
 *   caller should fall through to a browser-backed read.
 */
export async function fetchJdViaKnownApi(url, textCap = JD_TEXT_CAP, timeoutMs = API_TIMEOUT_MS) {
  const resolved = resolveJdApi(url);
  if (!resolved || !JD_TEXT_API_ATS.has(resolved.ats)) return null;
  const fetcher = JD_FETCHERS[resolved.ats];
  if (!fetcher) return null;

  // `resolveAtsApi` carries a per-ATS timeout for the APIs that need one
  // (Ashby: 20 s, liveness-api.mjs:113); without it a slow Ashby board that
  // liveness waits for falls through here on the generic 15 s both callers
  // pass. Same precedence liveness-api.mjs:357 applies to the same field —
  // the resolved value wins, the argument is the fallback for every ATS that
  // declares none.
  const budgetMs = resolved.timeoutMs || timeoutMs;
  const result = await fetcher(resolved, url, textCap, budgetMs);
  return result ? { ...result, ats: resolved.ats } : null;
}

// ========================================================================
// Tier 2 — the page's own bytes: fetch it and read its structured data
// ========================================================================

/** LinkedIn hosts, which this module never requests. */
export function isLinkedInHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * GET one HTML document, following redirects by hand so each hop is guarded.
 * Null on any failure: the caller falls through to its next source.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{html: string, finalUrl: string}|{gone: number, finalUrl: string}|null>}
 */
async function fetchHtml(url, timeoutMs) {
  // The connect-time guard lives in the patched dns.lookup. With the patch opted
  // out (CAREER_OPS_NO_DNS_CACHE=1) a name could pass the pre-check and resolve
  // to a private address at connect time, so fail closed: a miss sends the
  // worker back to WebFetch.
  if (!dnsLookupPatched()) return null;
  // NODE_USE_ENV_PROXY=1 makes Node's own fetch go through HTTP(S)_PROXY, where
  // the address check above no longer sees the destination. Providers only use a
  // proxy when CAREER_OPS_TRUST_PROXY_EGRESS=1 says it blocks private addresses;
  // hold this fetch to the same rule and miss otherwise.
  if (/^(1|true)$/i.test(process.env.NODE_USE_ENV_PROXY ?? '') && process.env.CAREER_OPS_TRUST_PROXY_EGRESS !== '1') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let transportFailed = false;
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (rejectPrivateOrInvalid(current)) return null;
      if (isLinkedInHost(new URL(current).hostname)) return null;
      await validateUrlSecurity(current);
      const targetHost = new URL(current).hostname.replace(/^\[|\]$/g, '');
      // The whole hop, body read included, runs inside the provider-fetch
      // context: the socket's DNS lookup happens inside fetch(), after its
      // synchronous part returns, and the context has to still be entered then.
      const outcome = await providerFetchContext.run({ url: current, targetHost }, async () => {
        let res;
        try {
          res = await fetch(current, {
            headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': DEFAULT_USER_AGENT },
            redirect: 'manual',
            signal: controller.signal,
          });
        } catch (err) {
          // No HTTP response at all (DNS, refused, timeout, TLS): the caller can retry
          // this. The address guard refusing a private address is a verdict on the
          // destination, not a transport problem, so a retry would change nothing.
          if ((err?.cause?.code ?? err?.code) !== 'ECAREEROPS_BLOCKED_ADDRESS') transportFailed = true;
          throw err;
        }
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          await res.body?.cancel().catch(() => {});
          return location ? { redirect: new URL(location, current).href } : null;
        }
        // 404/410 is the server saying the posting is gone, the same answer
        // classifyLiveness reads as expired. Any other error status may be a
        // block or an outage, so it stays a miss.
        if (res.status === 404 || res.status === 410) { await res.body?.cancel().catch(() => {}); return { gone: res.status, finalUrl: current }; }
        if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
        const type = res.headers.get('content-type') || '';
        if (type && !/html|xml/i.test(type)) { await res.body?.cancel().catch(() => {}); return null; }
        const html = await readCapped(res, MAX_BODY_BYTES);
        return html == null ? null : { html, finalUrl: current };
      });
      if (!outcome) return null;
      if (outcome.redirect) { current = outcome.redirect; continue; }
      return outcome;
    }
    return null;
  } catch {
    return transportFailed ? { unreachable: true } : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every schema.org JobPosting node in the page's JSON-LD blocks. A malformed
 * block is skipped, and a block may be an array or an @graph wrapper.
 *
 * @param {string} html
 * @returns {object[]}
 */
function jobPostingNodes(html) {
  const found = [];
  for (const block of ldJsonBlocks(html)) {
    let parsed;
    try { parsed = JSON.parse(block.trim()); } catch { continue; }
    const queue = [parsed];
    for (let qi = 0; qi < queue.length; qi += 1) {
      const node = queue[qi];
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { for (const child of node) queue.push(child); continue; }
      if (Array.isArray(node['@graph'])) for (const child of node['@graph']) queue.push(child);
      const type = node['@type'];
      if (Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting') found.push(node);
    }
  }
  return found;
}

/** Distinct large description-like strings in a hydration payload (see fromEmbeddedDescription). */
function embeddedDescriptionCount(html) {
  const seen = new Set();
  for (const raw of embeddedDescriptionStrings(html, { lenient: true })) {
    if (wordCount(String(raw).replace(/<([^>]*)(>?)/g, (tag, body, close) => (close && body ? ' ' : tag))) >= MIN_PAGE_JD_WORDS) seen.add(String(raw).replace(/\s+/g, ' ').trim());
  }
  return seen.size;
}

const collapseWs = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);

/** Stable form of a JSON value: object keys sorted at every depth, strings whitespace-collapsed. */
function canonicalJson(v) {
  if (Array.isArray(v)) return v.map(canonicalJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonicalJson(v[k])]));
  return collapseWs(v);
}

// Tokens that identify a job in a posting URL: path segments containing a digit, and id-like query values.
function jobIdTokens(u) {
  try {
    const x = new URL(u);
    // SPA routes carry the job id in the fragment (/careers#/job/2), so read it like the path.
    const toks = `${x.pathname}/${x.hash.replace(/^#/, '').split('?')[0]}`.split('/').filter((seg) => /\d/.test(seg)).map((seg) => seg.toLowerCase());
    // id-like query values, from the real query and from a query inside the fragment (#/job?jobId=1).
    const fragQuery = x.hash.includes('?') ? x.hash.slice(x.hash.indexOf('?') + 1) : '';
    for (const params of [x.searchParams, new URLSearchParams(fragQuery)]) {
      for (const [k, val] of params) if (/(^|_)(id|jid|jobid|job_id|reqid|req)$/i.test(k) && val) toks.push(val.toLowerCase());
    }
    return toks;
  } catch { return []; }
}

// A bare year or version segment (/2024/, /v2/) is shared structure, not a job id.
const STRUCTURAL_TOKEN_RE = /^(?:(?:19|20)\d\d|v\d+(?:\.\d+)*)$/;

/**
 * Does this JobPosting's own URL clearly name a different job than the one requested? Only when both are
 * absolute URLs on the same host, both carry id-like tokens, and the tokens share nothing. Postings with no
 * URL, a different host (CDN or alias), or no identifying tokens are not rejected.
 */
function postingNamesOtherJob(node, requestedUrl) {
  if (!requestedUrl) return false;
  const own = typeof node?.url === 'string' ? node.url : (typeof node?.['@id'] === 'string' ? node['@id'] : '');
  if (!own) return false;
  try {
    const a = new URL(requestedUrl); const b = new URL(own);
    if (a.hostname.replace(/^www\./, '').toLowerCase() !== b.hostname.replace(/^www\./, '').toLowerCase()) return false;
  } catch { return false; }
  let want = jobIdTokens(requestedUrl); let got = jobIdTokens(own);
  // Compare without year/version segments when both sides still have a real id; otherwise the
  // raw tokens are the only identity there is (/job/2031 vs /job/2044 must still differ).
  const wantStrong = want.filter((t) => !STRUCTURAL_TOKEN_RE.test(t));
  const gotStrong = got.filter((t) => !STRUCTURAL_TOKEN_RE.test(t));
  if (wantStrong.length && gotStrong.length) { want = wantStrong; got = gotStrong; }
  if (!want.length || !got.length) return false;
  return !want.some((t) => got.includes(t));
}

/**
 * What a page's own structured data (JSON-LD, then an embedded payload) says about
 * the one posting it should hold. The single reader both extractJd (is there a JD?)
 * and pageClosureEvidence (is the posting closed?) ask, so they cannot disagree
 * about which posting the page is about. Pure — exported for tests.
 *
 *   `ambiguous` — the page names several postings, one for another job, or holds
 *                 several description-sized payloads: nothing on it, closure
 *                 included, belongs to one URL.
 *   `expired`   — its JobPosting is past `validThrough`; `evidence` says so.
 *   `jd`        — one posting of at least MIN_PAGE_JD_WORDS words: `{text, title, method}`.
 *   `none`      — no usable structured data.
 *
 * @param {string} html
 * @param {string} [requestedUrl] when given, a posting that names another job is `ambiguous`
 * @param {number} [now] epoch ms, injectable for tests
 * @returns {{kind: 'ambiguous'|'none'}|{kind: 'expired', evidence: string}|{kind: 'jd', jd: {text: string, title: string, method: string}}}
 */
export function readPostingData(html, requestedUrl = '', now = Date.now()) {
  const postings = jobPostingNodes(html);
  // A page that names more than one posting is a listing, or a page whose other
  // postings we cannot tell apart from the requested one. Postings are
  // told apart by title, description, url, @id, identifier, employer and location, and an identical
  // duplicate representation of one posting does not count twice.
  const distinctLd = new Set(postings.map((node) => JSON.stringify(canonicalJson([node.title ?? '', node.description ?? '', node.url ?? '', node['@id'] ?? '', node.identifier ?? '', node.hiringOrganization ?? '', node.jobLocation ?? ''])))).size;
  if (distinctLd > 1) return { kind: 'ambiguous' };
  // A single posting that names a different job than the requested URL is that other job's, not ours.
  if (postings.length && postingNamesOtherJob(postings[0], requestedUrl)) return { kind: 'ambiguous' };

  const expired = postings.find((node) => isPastValidThrough(node, now));
  if (expired) return { kind: 'expired', evidence: `JobPosting validThrough ${String(expired.validThrough).slice(0, 40)}` };

  let ld = null;
  try { ld = fromLdJson(html); } catch { /* malformed JSON-LD fields: ignore, the ambiguity and expiry checks still ran */ }
  if (ld && wordCount(ld.text) >= MIN_PAGE_JD_WORDS) {
    const rawTitle = postings[0]?.title;
    const title = typeof rawTitle === 'string' ? rawTitle.trim().slice(0, 300) : '';
    return { kind: 'jd', jd: { ...ld, title } };
  }

  // The embedded-payload fallback picks the LONGEST description on the page. It
  // is only trusted when the page holds one description-sized string (and, above,
  // at most one posting), so what it returns can only be this posting's.
  if (embeddedDescriptionCount(html) > 1) return { kind: 'ambiguous' };
  const embedded = fromEmbeddedDescription(html);
  return embedded && wordCount(embedded.text) >= MIN_PAGE_JD_WORDS ? { kind: 'jd', jd: { title: '', ...embedded } } : { kind: 'none' };
}

/**
 * Did the fetch land on the page that was asked for? A job URL that redirects to
 * a listing or another job would otherwise lend that page's one JobPosting (or
 * its closure) to the requested job. Host `www.` and a trailing slash are not a
 * different page; tracking parameters are ignored.
 */
export function sameDocument(requested, final) {
  try {
    const norm = (u) => {
      const x = new URL(u);
      const q = [...x.searchParams].filter(([k]) => !/^(utm_|gclid$|fbclid$)/i.test(k)).map(([k, v]) => `${k}=${v}`).sort().join('&');
      return `${x.hostname.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '').toLowerCase()}?${q}`;
    };
    return norm(requested) === norm(final);
  } catch { return false; }
}

/**
 * The one place a fetched page becomes a JD. Takes what a fetch returned
 * (fetchHtml's result, or a page the batch runner downloaded with curl) and
 * returns the JD, or null when the page holds no JD that can be attributed to
 * this URL. Whether the posting is still open is not decided here; that is
 * fetchedPageClosure's job, asked first by the caller.
 *
 * Attribution: a page that landed on another document, names several postings,
 * or is too large to inspect whole yields nothing. Then structured data (JSON-LD,
 * an embedded payload), then, only when the caller asks for it, the visible text.
 *
 * `visibleText` is opt-in because text with no structured data cannot prove it
 * belongs to one posting. The networked reader keeps its contract ("never the
 * longest description on a listing"); the batch runner, which has always handed
 * its worker that text, asks for it.
 *
 * @param {{html?: string, finalUrl?: string}} page what the fetch returned
 * @param {string} url the URL that was requested
 * @param {{textCap?: number, minWords?: number, visibleText?: boolean}} [opts]
 * @returns {{url: string, title: string, text: string, method: string}|null}
 */
export function extractJd(page, url, { textCap = JD_TEXT_CAP, minWords = MIN_PAGE_JD_WORDS, visibleText: allowVisibleText = false } = {}) {
  const html = String(page?.html ?? '');
  if (!html || html.length > MAX_BODY_BYTES || !sameDocument(url, page?.finalUrl || url)) return null;
  const data = readPostingData(html, url);
  if (data.kind === 'ambiguous' || data.kind === 'expired') return null;
  if (data.kind === 'jd') return { url, title: data.jd.title ?? '', text: capJdText(data.jd.text, textCap), method: data.jd.method };
  if (!allowVisibleText) return null;
  const text = htmlToText(withoutExpiryViews(withoutScripts(html))).replace(/\s+/g, ' ').trim();
  return wordCount(text) >= minWords ? { url, title: '', text: capJdText(text, textCap), method: 'visible-text' } : null;
}

/**
 * @param {string} url
 * @param {number} [textCap]
 * @param {number} [timeoutMs]
 * @returns {Promise<{url: string, title: string, text: string, method: string, closed?: boolean, evidence?: string, unreachable?: boolean}|null>}
 */
export async function fetchJdViaPage(url, textCap = JD_TEXT_CAP, timeoutMs = DEFAULT_TIMEOUT_MS, { visibleText = false } = {}) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (isLinkedInHost(host)) return null;
  const page = await fetchHtml(url, timeoutMs);
  if (!page) return null;
  if (page.unreachable) return { url, title: '', text: '', method: 'unreachable', unreachable: true };
  const closure = fetchedPageClosure(page, url);
  if (closure) return { url, title: '', text: '', method: page.gone ? 'http-gone' : 'page-closure', closed: true, evidence: closure };
  return extractJd(page, url, { textCap, visibleText });
}

// ========================================================================
// Closure — is the posting still open? Read from the page, never guessed
// ========================================================================

// Closure codes classifyLiveness can reach from page text alone. The softer
// codes (listing page, missing apply control) lean on a rendered DOM's apply
// buttons, which a plain download does not have, so they are not trusted here.
const VISIBLE_CLOSURE_CODES = new Set(['expired_url', 'expired_body', 'deadline_passed']);

/** Is a posting's `validThrough` in the past? An absent or unparseable date is not evidence. */
function isPastValidThrough(node, now) {
  const raw = node?.validThrough;
  if (typeof raw !== 'string' || !raw.trim()) return false;
  let when = Date.parse(raw);
  // A date-only value parses as UTC midnight, but means "through that day".
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) when += 24 * 60 * 60 * 1000;
  return Number.isFinite(when) && when < now;
}

// A script-toggled expiry view that is always present in the static markup (Phenom).
const EXPIRE_TEMPLATE_RE = /\b(?:job-expire-view|expire-job-view|job-expire-block)\b/i;

// The most of a page's markup scanned for closure text.
const VISIBLE_SCAN_CAP = 1_000_000;

/** The markup with script/style elements and comments removed (linear, indexOf-based). */
function withoutScripts(html) {
  const src = String(html).slice(0, VISIBLE_SCAN_CAP);
  const lower = asciiLower(src);
  const out = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out.push(src.slice(i)); break; }
    out.push(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    const m = /^<(script|style)\b/.exec(lower.slice(lt, lt + 10));
    if (m) {
      const close = lower.indexOf(`</${m[1]}`, lt + 1);
      const closeEnd = close === -1 ? -1 : src.indexOf('>', close);
      i = closeEnd === -1 ? src.length : closeEnd + 1;
      continue;
    }
    out.push('<');
    i = lt + 1;
  }
  return out.join('');
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * Remove every element whose opening tag carries the expiry-view marker. One forward pass: the next
 * '>' is cached, tags are length-capped before the marker test, and nesting is a counter, so hostile
 * markup (a run of '<a', deep nesting) costs time linear in the page, never quadratic.
 */
function withoutExpiryViews(html) {
  const src = String(html);
  const lower = asciiLower(src);
  const out = [];
  let i = 0; let nextGt = -2; let skipName = ''; let depth = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { if (!skipName) out.push(src.slice(i)); break; }
    if (!skipName) out.push(src.slice(i, lt));
    if (nextGt !== -1 && nextGt <= lt) nextGt = src.indexOf('>', lt + 1);
    const gt = nextGt;
    const m = /^<(\/?)([a-z][a-z0-9]*)/.exec(lower.slice(lt, lt + 24));
    if (!m || gt === -1) { if (!skipName) out.push('<'); i = lt + 1; continue; }
    if (skipName) {
      if (m[2] === skipName) {
        if (m[1]) { if (--depth === 0) skipName = ''; } else depth++;
      }
      i = gt + 1;
      continue;
    }
    if (!m[1] && EXPIRE_TEMPLATE_RE.test(src.slice(lt, Math.min(gt, lt + 4096)))) {
      out.push(' ');
      // A void element (img, br, ...) or a self-closed tag has no end tag: drop just the tag.
      if (!VOID_ELEMENTS.has(m[2]) && lower[gt - 1] !== '/') { skipName = m[2]; depth = 1; }
    } else out.push(src.slice(lt, gt + 1));
    i = gt + 1;
  }
  return out.join('');
}

/**
 * Does the page's visible text say the posting is closed? JSON-LD often carries
 * no expiry, and a closure banner lives in the visible markup that the JD
 * extraction never reads, so check it with the repo's own classifier.
 *
 * @returns {string|null} evidence, or null when the page does not say so
 */
function visibleClosureEvidence(html, url, finalUrl, now = new Date()) {
  // Phenom career sites (observed on careers.roberthalf.com, every live posting) ship the
  // "the job you are trying to apply for has been filled" view inside the page markup and
  // show or hide it with script. Static HTML cannot say which, so the banner text proves
  // nothing there; only structured data (validThrough, an ATS flag) can still close it.
  // Only a marker in the page's own markup counts: one inside a script, style or comment
  // (a bundle that merely names the class) must not suppress a separate closure banner.
  // The expiry view itself is dropped; any other closure banner on the page still counts.
  const markup = withoutExpiryViews(withoutScripts(html));
  const verdict = classifyLiveness({ status: 200, requestedUrl: url, finalUrl, bodyText: htmlToText(markup), now });
  return verdict.result === 'expired' && VISIBLE_CLOSURE_CODES.has(verdict.code)
    ? `page text: ${verdict.reason}`.slice(0, 200)
    : null;
}

/**
 * Closure evidence for a page already downloaded (the batch runner's static fetch): an
 * expired JobPosting validThrough, or closure text in the visible page. Null when the
 * page does not say it is closed.
 * @returns {string|null}
 */
export function pageClosureEvidence(html, url, finalUrl = url) {
  // Same gates as fetchJdViaPage: a redirect to another page is not this posting's closure,
  // an ambiguous page proves nothing, and the HTML is capped so hostile input stays cheap.
  if (finalUrl && !sameDocument(url, finalUrl)) {
    // Off the requested page: its text is not this posting's. Only the URL itself can still
    // say closed (a redirect to an error or "job not found" address).
    const verdict = classifyLiveness({ status: 200, requestedUrl: url, finalUrl, bodyText: '', now: new Date() });
    return verdict.result === 'expired' && verdict.code === 'expired_url' ? `redirect: ${verdict.reason}`.slice(0, 200) : null;
  }
  // A page past the cap cannot be checked whole: a second posting after the prefix could be hidden,
  // so nothing page-derived counts as closure (the URL check above and the ATS API still do).
  if (String(html).length > MAX_BODY_BYTES) return null;
  const capped = String(html);
  const data = readPostingData(capped, url);
  if (data.kind === 'ambiguous') return null;
  if (data.kind === 'expired') return data.evidence;
  return visibleClosureEvidence(capped, url, finalUrl);
}

/**
 * Closure evidence for a fetched page: an HTTP 404/410 on the requested page, or
 * what pageClosureEvidence finds in the page and its final URL. Null when the
 * fetch does not say the posting is closed. A 404 reached through a redirect is
 * the other page's, not this posting's.
 *
 * @param {{html?: string, finalUrl?: string, gone?: number}} page
 * @param {string} url
 * @returns {string|null}
 */
export function fetchedPageClosure(page, url) {
  const finalUrl = page?.finalUrl || url;
  if (page?.gone && sameDocument(url, finalUrl)) return `HTTP ${page.gone}`;
  return pageClosureEvidence(String(page?.html ?? ''), url, finalUrl);
}

// ========================================================================
// Tier 3 — a rendered page in headless Chromium (only with browser: true)
// ========================================================================

// Floor below which a jd-mode extraction is treated as failure, not content.
// A posting page whose main text is a couple of sentences is a render we
// missed (SPA shell, consent wall, bot interstitial), never a real JD; the
// cost of being wrong is one silent fallback to the MCP path, whereas the
// cost of NOT failing is an empty JD evaluated as if it were the posting.
// Only jd mode gets this guard: an empty `listing` result is legitimate — a
// company with no open roles.
const MIN_JD_TEXT_CHARS = 200;

/**
 * A Cloudflare challenge or block page served in place of the posting, as a
 * jd-mode failure, or null. Pure — exported for tests.
 *
 * jdFailure() never rejects a result above the length floor, and a
 * site-branded challenge body clears it (#6713: 838 characters, "Humans
 * only"), so the interstitial was emitted as the JD. Cloudflare titles the page
 * itself, and archive-posting.mjs refuses the same pages by that title on an
 * HTTP error (#6724). `bot_challenge` is the code liveness gives the same wall.
 *
 * @param {{ status?: number, pageTitle?: string, url?: string }} page
 */
export function challengeFailure({ status = 0, pageTitle = '', url = '' } = {}) {
  if (!(status >= 400)) return null;
  const kind = cloudflareInterstitial(pageTitle);
  if (!kind) return null;
  return { error: `HTTP ${status} Cloudflare ${kind} ("${String(pageTitle).trim()}"), not the posting`, code: 'bot_challenge', url };
}

/**
 * Why a jd-mode result cannot be emitted, or null when it can. Pure — exported
 * for tests.
 *
 * A page whose cleaned text is below the floor is either unreadable (a client-
 * rendered shell: `empty_text`, worth another attempt) or gone (the posting
 * was taken down: `unavailable`, terminal). Both produce the same empty text,
 * because the "no longer available" banner usually sits in a header or footer
 * that readDom() strips — so the unstripped body is checked too. A result at or
 * above the floor is never reclassified: a full JD may quote such a phrase.
 */
export function jdFailure(result, maxChars) {
  const floor = Math.min(MIN_JD_TEXT_CHARS, maxChars);
  if (result.text.length >= floor) return null;
  // The shared liveness classifier, not a second phrase list. Only its
  // posting-specific expiry verdicts count: `insufficient_content` is what a
  // page that has not rendered yet looks like (liveness-browser treats it the
  // same way), so it stays empty_text and remains worth retrying.
  const verdict = classifyLiveness({
    requestedUrl: result.url,
    finalUrl: result.url,
    bodyText: `${result.text}\n${result.bodyText || ''}`,
  });
  if (verdict.result === 'expired' && (verdict.code === 'expired_body' || verdict.code === 'expired_body_soft')) {
    return { error: `posting is no longer available (${verdict.reason})`, code: 'unavailable', url: result.url };
  }
  return {
    error: `extracted ${result.text.length} chars of JD text (minimum ${floor}) — the page most likely renders its content client-side`,
    code: 'empty_text',
    url: result.url,
    body_text: String(result.bodyText || '').slice(0, 4000),
  };
}

const HYDRATION_WAIT_MS = 2_000;

/**
 * The JD a rendered page holds: its structured data (extractJd, read from the
 * page's HTML) or its rendered text, whichever is longer.
 *
 * A schema.org JobPosting, when the page ships one, beats the rendered DOM: it is
 * the posting body as the employer published it, not as their template happened
 * to lay it out. On Phenom boards (careers.roche.com) the rendered <main> holds
 * title, location and Apply chrome only (~300 characters) while the body never
 * becomes visible text, so reading the DOM alone emitted a JD with no
 * requirements and reported success. Longer wins rather than structured data
 * always winning: plenty of pages carry a stub JobPosting alongside a fully
 * rendered body, and preferring the stub would break the common case to fix the
 * rare one. Lengths are compared after whitespace is collapsed: raw DOM text on a
 * chrome-heavy page is mostly repeated newlines and would out-length a shorter
 * but substantive description.
 *
 * `bodyText` is for jdFailure() only, never emitted: `text` has had nav, header and
 * footer stripped, and an expired-posting banner often sits in one of them.
 * Pure — exported for tests.
 *
 * @param {{title?: string, text?: string, bodyText?: string}} raw readDom's result
 * @param {string} html the rendered page's HTML
 * @param {string} finalUrl
 * @param {number} [textCap]
 */
export function jdFromRenderedPage(raw, html, finalUrl, textCap = JD_TEXT_CAP) {
  const structured = extractJd({ html, finalUrl }, finalUrl, { textCap: Infinity });
  const domText = tidyText(raw?.text);
  const useStructured = structured && structured.text.length > domText.length;
  return {
    url: finalUrl,
    title: compactText(raw?.title || structured?.title || '', 300),
    text: jdText(useStructured ? structured.text : domText, textCap),
    bodyText: compactText(raw?.bodyText || '', 4100),
  };
}

// Read the raw DOM inside the page: title, main visible text, and visible
// anchors. Runs in the browser context; returns plain data only.
export async function readDom(page) {
  return page.evaluate(() => {
    const title = (document.querySelector('h1')?.innerText || document.title || '').trim();

    // Main text: prefer <main>/[role=main]/<article>, else body; strip nav chrome.
    // Keep the candidate with the most text left after stripping, not the first
    // match: a board can lead with a short <article> (a share widget) ahead of
    // the one holding the posting, and a <main> that is mostly menu would
    // otherwise outrank it.
    // Read innerText from the live element: on a detached clone it degrades to
    // textContent, so CSS-hidden text would count and could outrank the posting.
    // The chrome is hidden only for the read and its style attribute restored.
    // script/style/noscript are never rendered, so innerText already skips them.
    const strippedText = (el) => {
      if (el.getClientRects().length === 0 && getComputedStyle(el).display !== 'contents') return '';
      const chrome = Array.from(el.querySelectorAll('nav, header, footer'));
      const saved = chrome.map((n) => n.getAttribute('style'));
      // Attribute writes only: setting a property through n.style leaves style=""
      // behind after removeAttribute. The prefix is the browser's serialized
      // cssText, not the raw attribute, so an unterminated token in the original
      // (an open /* comment) cannot swallow the appended display:none.
      chrome.forEach((n) => n.setAttribute('style', `${n.style.cssText} display: none !important;`));
      try {
        return el.innerText || '';
      } finally {
        chrome.forEach((n, i) => (saved[i] == null ? n.removeAttribute('style') : n.setAttribute('style', saved[i])));
      }
    };
    const candidates = Array.from(document.querySelectorAll('main, [role="main"], article'));
    let text = '';
    for (const el of candidates) {
      const t = strippedText(el);
      if (t.length > text.length) text = t;
    }
    if (candidates.length === 0 && document.body) text = strippedText(document.body);

    const anchors = Array.from(document.querySelectorAll('a[href]'))
      .filter((el) => {
        if (el.closest('nav, header, footer')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.getClientRects().length > 0;
      })
      .map((el) => ({ href: el.getAttribute('href') || '', label: (el.innerText || '').trim() }));

    // The unstripped body: `text` above removes nav/header/footer, where an
    // expired-posting banner often lives.
    // Head and tail, so a banner in the footer is still in the sample when the
    // leading content fills the first 4000 characters.
    const fullBody = document.body?.innerText || '';
    const bodyText = fullBody.length > 4000 ? `${fullBody.slice(0, 2000)}\n…\n${fullBody.slice(-2000)}` : fullBody;

    // The document's own title, which `title` above passes over for an <h1>:
    // challengeFailure() reads it.
    return { title, text, anchors, bodyText, pageTitle: document.title || '' };
  });
}

/**
 * Open one posting in headless Chromium and hand the loaded page to `read`. The
 * browser tier of the JD waterfall, and the listing reader in browser-extract.mjs.
 *
 * Every request the page makes (navigation, redirect hop, subresource) to a
 * private, loopback, link-local or non-http(s) host is aborted: guarding only the
 * first URL is not enough once page CONTENT is returned, since a server-side
 * redirect could steer the browser at internal infrastructure (SSRF).
 *
 * @template T
 * @param {string} url
 * @param {number} timeoutMs
 * @param {(ctx: {page: any, response: any, finalUrl: string}) => Promise<T>} read
 * @returns {Promise<{ok: true, value: T}|{ok: false, failure: {error: string, code: string}}>}
 */
export async function withBrowserPage(url, timeoutMs, read) {
  const guard = rejectPrivateOrInvalid(url);
  if (guard) return { ok: false, failure: { error: guard.reason, code: guard.code } };
  let chromium;
  try {
    ({ chromium } = await import('./lib/hardened-chromium.mjs'));
  } catch {
    return { ok: false, failure: { error: 'playwright not installed', code: 'no_playwright' } };
  }
  let browser;
  try {
    browser = await chromium.launch(browserLaunchOptions({ headless: true }));
    const context = await browser.newContext(LIVENESS_CONTEXT_OPTIONS);
    await context.route('**/*', (route) => {
      if (rejectPrivateOrInvalid(route.request().url())) return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(HYDRATION_WAIT_MS); // let SPAs hydrate
    // Belt-and-suspenders: never return content read from a private final URL.
    const finalUrl = page.url();
    const finalGuard = rejectPrivateOrInvalid(finalUrl);
    if (finalGuard) return { ok: false, failure: { error: `blocked final URL: ${finalGuard.reason}`, code: finalGuard.code } };
    return { ok: true, value: await read({ page, response, finalUrl }) };
  } catch (err) {
    return { ok: false, failure: { error: `navigation error: ${String(err.message).split('\n')[0]}`, code: 'navigation_error' } };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * The last JD tier: render the page and read its DOM. A JSON-LD JobPosting on the
 * page wins over the rendered text when it is longer (jdFromRenderedPage). A Cloudflare
 * challenge, an empty render or a taken-down posting comes back as `failure`
 * instead of a JD-shaped result; `failure.code === 'unavailable'` means closed.
 *
 * @param {string} url
 * @param {number} [textCap]
 * @param {number} [timeoutMs]
 * @returns {Promise<{url: string, title: string, text: string, bodyText: string, method: 'browser'}|{failure: {error: string, code: string}}>}
 */
export async function fetchJdViaBrowser(url, textCap = JD_TEXT_CAP, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const read = await withBrowserPage(url, timeoutMs, async ({ page, response, finalUrl }) => {
    const raw = await readDom(page);
    const challenge = challengeFailure({ status: response?.status() ?? 0, pageTitle: raw.pageTitle, url: finalUrl });
    if (challenge) return { failure: challenge };
    const result = jdFromRenderedPage(raw, await page.content(), finalUrl, textCap);
    const failure = jdFailure(result, textCap);
    return failure ? { failure } : { ...result, method: 'browser' };
  });
  return read.ok ? read.value : { failure: read.failure };
}

// ========================================================================
// The waterfall, and the command line over it
// ========================================================================

/**
 * The whole waterfall, cheapest first; a later tier runs only when the earlier one
 * found nothing. 1: the ATS's public API. 2: the page's own bytes (JSON-LD, and
 * visible text when asked). 3, only with `browser: true`: a rendered page.
 * A closed posting stops the walk, since a later tier could read a cached or
 * stale body of it.
 *
 * @param {string} url
 * @param {{textCap?: number, timeoutMs?: number, visibleText?: boolean, browser?: boolean}} [opts]
 * @returns {Promise<object|null>} a JD result, `{closed, evidence}`, `{unreachable}`,
 *   `{failure}` from the browser tier, or null when no tier found anything
 */
export async function fetchJd(url, { textCap = JD_TEXT_CAP, timeoutMs = DEFAULT_TIMEOUT_MS, visibleText = false, browser = false } = {}) {
  const viaApi = await fetchJdViaKnownApi(url, textCap, timeoutMs);
  if (viaApi) return viaApi;
  const viaPage = await fetchJdViaPage(url, textCap, timeoutMs, { visibleText });
  if (viaPage && !viaPage.unreachable) return viaPage;
  if (!browser) return viaPage;
  return await fetchJdViaBrowser(url, textCap, timeoutMs);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node fetch-jd.mjs <url> [--visible-text] [--browser]
  node fetch-jd.mjs --help

Options:
  --visible-text  When the page has no structured JD, use its visible text (at least
                  80 words). Off by default: such text cannot prove it belongs to
                  one posting
  --browser       Last tier: render the page in headless Chromium when the API and the
                  page's own bytes found no JD (needs Playwright). A failure reason is
                  printed to stderr as JSON
  --help, -h      Print this usage block and exit`);
    process.exit(0);
  }

  const url = args[0];

  if (!url) {
    console.error('usage: node fetch-jd.mjs <url>');
    process.exit(1);
  }

  // The waterfall: ATS API, then the page's own bytes, then (only with --browser)
  // a rendered page. A later tier runs only when the earlier one found nothing.
  const result = await fetchJd(url, {
    textCap: CLI_TEXT_CAP,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    visibleText: hasFlag(args, '--visible-text'),
    browser: hasFlag(args, '--browser'),
  });
  // No stderr, by design: the caller's browser/WebFetch fallback is the
  // intended next step, and warning on every non-covered host would make the
  // normal path look broken.
  // Signal the miss via exitCode, not process.exit(1). On Windows, Node 24
  // aborts when process.exit() runs right after a request (nodejs/node#56645):
  // it prints a libuv assertion and exits with a crash code instead of 1.
  // Measured 2026-11-04 on Node 24.14.1: misses on Greenhouse, Workable,
  // SmartRecruiters and Workday aborted 4 times out of 4. Returning lets the
  // process exit 1 once the event loop drains, right after the answer.
  if (!result) {
    process.exitCode = 1;
    return;
  }

  // No HTTP response at all (DNS, refused, timeout, TLS): a transport problem, not
  // a page that cannot be read, so a caller may retry it. Exit 2, empty stdout.
  if (result.unreachable) {
    process.exitCode = 2;
    return;
  }

  // The browser tier ran and could not return a JD: a taken-down posting is
  // closed (exit 3), anything else (challenge, empty render, no Playwright) is a
  // miss whose reason goes to stderr as JSON, as browser-extract.mjs prints it.
  if (result.failure) {
    if (result.failure.code === 'unavailable') {
      process.stdout.write(`CLOSED_POSTING ${result.failure.error}`);
      process.exitCode = 3;
      return;
    }
    console.error(JSON.stringify(result.failure));
    process.exitCode = 1;
    return;
  }

  // The posting's own data says it is closed: the page's JobPosting, its visible
  // text, or an ATS API flag such as Ashby's isListed: false. Say so with a
  // distinct exit code instead of a plain miss, so a caller does not fall back
  // to a fetch that could return the JD from the visible page and score it.
  if (result.closed) {
    process.stdout.write(`CLOSED_POSTING ${result.evidence}`);
    process.exitCode = 3;
    return;
  }

  // The structured-page reader already includes the posting title in its text.
  const header = result.title && result.method !== 'ld+json' ? `${result.title}\n\n` : '';
  process.stdout.write(header + result.text);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(`fetch-jd: unexpected error — ${err?.message || err}`);
    process.exitCode = 1; // not process.exit(1), for the reason given at the miss
  });
}
