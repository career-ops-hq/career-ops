#!/usr/bin/env node
/**
 * browser-extract.mjs — headless Playwright reader for the scan / JD-extraction
 * path (the opt-in alternative to the browser MCP; see #1449).
 *
 * The token cost of the MCP path is `browser_snapshot` streaming a page's whole
 * accessibility tree back to the model on every navigate. This helper renders
 * the same page headlessly and returns COMPACT JSON — just the fields the agent
 * needs — so the model processes a small result instead of a full snapshot.
 *
 * STRICTLY READ-ONLY: it navigates and reads the DOM. No clicks, typing, or form
 * fills — that boundary is exactly what keeps this separate from `apply`.
 *
 * Usage:
 *   node browser-extract.mjs <url> [--mode jd|listing] [--max N] [--max-chars N] [--timeout MS]
 *
 * `--max-chars` overrides the jd-mode text cap (default 12000) — raise it when a
 * long JD would otherwise be truncated at the tail, at the cost of more tokens.
 *
 * Modes:
 *   jd (default) — one posting page → { url, title, text }. `text` is the main
 *                  visible text, whitespace-collapsed and length-capped. For the
 *                  pipeline / oferta / auto-pipeline JD-extraction step.
 *   listing      — a careers/board page → { url, jobs: [{ title, url }] }. Visible
 *                  anchors that look like individual postings, deduped. For scan
 *                  Level 1 (reading a company's open roles).
 *
 * Workday (`*.myworkdayjobs.com`) is read through its public CXS JSON endpoint
 * instead of the rendered page: Workday hydrates the JD into a virtualized DOM
 * that readDom() below cannot see, so scraping it returned a well-formed result
 * with an EMPTY `text` — indistinguishable, to a caller, from a posting that
 * genuinely has no content. Same API family scan.mjs already uses for Workday
 * boards (providers/workday.mjs); the per-job URL derivation is reused from
 * liveness-api.mjs so the two cannot drift.
 *
 * Output: compact JSON to stdout. Exit 0 on success; exit 1 on a hard error,
 * printing `{ "error": "...", "code": "..." }` (so a caller/mode can fall back
 * to the MCP path silently). An empty/near-empty jd-mode extraction is one of
 * those hard errors (`code: "empty_text"`) rather than a successful-looking
 * empty JD — the documented silent fallback only fires if the tool actually
 * reports failure. Reuses liveness-browser.mjs's SSRF host guard and
 * realistic-UA context so it isn't instantly bot-walled.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { LIVENESS_CONTEXT_OPTIONS, rejectPrivateOrInvalid } from './liveness-browser.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { resolveAtsApi, JD_TEXT_API_ATS } from './liveness-api.mjs';
import { decodeEntities } from './providers/_html-entities.mjs';
import { isWorkModelOnly } from './providers/greenhouse.mjs';
import { DEFAULT_USER_AGENT } from './user-agent.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CAREER_OPS = getCareerOpsRoot();

const DEFAULT_TIMEOUT_MS = 15_000;
const HYDRATION_WAIT_MS = 2_000;
const JD_TEXT_CAP = 12_000;     // plenty for a JD; a fraction of a full snapshot
const DEFAULT_LISTING_MAX = 200;
const WORKDAY_TIMEOUT_MS = 10_000;

// Floor below which a jd-mode extraction is treated as failure, not content.
// A posting page whose main text is a couple of sentences is a render we
// missed (SPA shell, consent wall, bot interstitial), never a real JD; the
// cost of being wrong is one silent fallback to the MCP path, whereas the
// cost of NOT failing is an empty JD evaluated as if it were the posting.
// Only jd mode gets this guard: an empty `listing` result is legitimate — a
// company with no open roles.
const MIN_JD_TEXT_CHARS = 200;

// Anchor labels that are navigation chrome, not job postings. Kept small and
// lowercase; matched against the trimmed label.
const NAV_LABEL_STOPWORDS = new Set([
  'home', 'about', 'about us', 'contact', 'contact us', 'login', 'log in', 'sign in',
  'sign up', 'register', 'privacy', 'privacy policy', 'terms', 'cookies', 'cookie policy',
  'careers', 'jobs', 'search', 'menu', 'back', 'next', 'previous', 'apply', 'apply now',
  'learn more', 'read more', 'faq', 'blog', 'news', 'help', 'support', 'english',
]);

/**
 * Resolve the configured scan extractor: `cli` (this helper) or `mcp` (default).
 * Reads `scan.extractor` from config/profile.yml; anything unrecognized — or a
 * missing/unreadable file — yields `mcp` so behavior never breaks. Exported so
 * doctor.mjs reports the same value.
 * @param {string} [profilePath]
 * @returns {'cli'|'mcp'}
 */
export function resolveExtractorMode(profilePath = join(CAREER_OPS, 'config/profile.yml')) {
  try {
    if (!existsSync(profilePath)) return 'mcp';
    const raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    const v = raw?.scan?.extractor;
    return v === 'cli' ? 'cli' : 'mcp';
  } catch {
    return 'mcp';
  }
}

// Collapse runs of whitespace and cap length so the JD text stays compact.
export function compactText(s, cap = JD_TEXT_CAP) {
  const text = String(s ?? '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * Shape a JD-mode result from the raw DOM read. Pure — exported for tests.
 * @param {{ title?: string, text?: string }} raw
 * @param {string} finalUrl
 */
export function normalizeJd(raw, finalUrl, textCap = JD_TEXT_CAP) {
  return {
    url: finalUrl,
    title: compactText(raw?.title || '', 300),
    text: compactText(raw?.text || '', textCap),
  };
}

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

// Tags whose CLOSE ends a block, so it becomes a line break. `li` is absent on
// purpose: its OPEN tag already emits the break plus a bullet below, and
// breaking on both ends double-spaces every list.
const BLOCK_END_RE = /<\/(p|div|ul|ol|h[1-6]|tr|section|article|blockquote)\s*>/gi;

/**
 * Description markup -> plain text, keeping block structure as newlines. Pure —
 * exported for tests.
 *
 * Not providers/_html-to-text.mjs's htmlToText: that one is tuned for scan
 * payloads and hard-caps at 4000 chars while collapsing ALL whitespace
 * (newlines included) into single spaces. A JD read for evaluation wants the
 * full body up to `--max-chars`, with its paragraph and bullet breaks intact.
 * The entity decoder itself IS shared, so the two cannot drift on the thing
 * that has actually drifted historically (#1555/#1639/#2623).
 *
 * Double-decode for the same reason htmlToText does: payloads often carry
 * entity-escaped markup (`&lt;p&gt;`), and text-level entities only become
 * decodable once the real tags are stripped.
 *
 * @param {unknown} html
 * @returns {string}
 */
export function jdHtmlToText(html) {
  if (typeof html !== 'string' || !html) return '';
  const stripped = decodeEntities(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(BLOCK_END_RE, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

  const body = jdHtmlToText(info.jobDescription);
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
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
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
async function fetchWorkdayJd(apiUrl, postingUrl, textCap, timeoutMs) {
  // Same host as the already-guarded input, but the guard is cheap and this is
  // the request that actually leaves the process.
  if (rejectPrivateOrInvalid(apiUrl)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, WORKDAY_TIMEOUT_MS));
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error', // a redirect off the derived host is not one to follow
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return normalizeWorkdayJob(await res.json(), postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
 * `descriptionPlain` is already plain text, so it needs no jdHtmlToText pass.
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
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
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
async function fetchAshbyJd(apiUrl, jobId, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return normalizeAshbyJob(json, jobId, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shape one Greenhouse per-job payload into a jd-mode result. Pure, same
 * contract as normalizeWorkdayJob/normalizeAshbyJob.
 *
 * `content` is HTML (and HTML-escaped at that), so it goes through
 * jdHtmlToText exactly like Workday's `jobDescription`. `requisition_id` is
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
  const body = jdHtmlToText(json?.content);
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
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
  };
}

/**
 * Fetch + shape one Greenhouse posting from its per-job boards-api endpoint.
 * Same failure contract as fetchWorkdayJd/fetchAshbyJd.
 *
 * `content=true` is required — without it the endpoint omits the JD body
 * entirely (same query param providers/greenhouse.mjs uses for its list scan).
 * `content` comes back as HTML, so it goes through jdHtmlToText like Workday's
 * `jobDescription`.
 *
 * @param {string} apiUrl - `resolveAtsApi(url).apiUrl` (no query string)
 * @param {string} postingUrl
 * @param {number} textCap
 * @param {number} timeoutMs
 */
async function fetchGreenhouseJd(apiUrl, postingUrl, textCap, timeoutMs) {
  const withContent = `${apiUrl}?content=true`;
  if (rejectPrivateOrInvalid(withContent)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(withContent, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return normalizeGreenhouseJob(json, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
 * Order is the contract, since compactText truncates the TAIL — a lowered
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
          const content = jdHtmlToText(l?.content);
          return content ? `${heading ? `${heading}\n` : ''}${content}` : '';
        })
        .filter(Boolean)
        .join('\n\n')
    : '';
  const body = [str(json.descriptionPlain), lists, str(json.additionalPlain)].filter(Boolean).join('\n\n');
  if (!body) return null;

  const meta = [];
  if (str(json?.categories?.location)) meta.push(`Location: ${str(json.categories.location)}`);
  if (str(json?.categories?.team)) meta.push(`Team: ${str(json.categories.team)}`);

  return {
    url: postingUrl,
    title: compactText(str(json.text), 300),
    text: compactText([meta.join('\n'), body].filter(Boolean).join('\n\n'), textCap),
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
async function fetchLeverJd(apiUrl, postingUrl, textCap, timeoutMs) {
  if (rejectPrivateOrInvalid(apiUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'application/json', 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return normalizeLeverJob(json, postingUrl, textCap);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
 * Every entry takes the same `(resolved, url, textCap, timeoutMs)` shape so
 * dispatch stays a lookup; Ashby's extra `parts.jobId` argument is unpacked
 * inside its own entry rather than widening the shared signature.
 */
export const JD_FETCHERS = {
  workday: (resolved, url, textCap, timeoutMs) =>
    fetchWorkdayJd(resolved.apiUrl, url, textCap, timeoutMs),
  ashby: (resolved, url, textCap, timeoutMs) =>
    fetchAshbyJd(resolved.apiUrl, resolved.parts.jobId, url, textCap, timeoutMs),
  greenhouse: (resolved, url, textCap, timeoutMs) =>
    fetchGreenhouseJd(resolved.apiUrl, url, textCap, timeoutMs),
  lever: (resolved, url, textCap, timeoutMs) =>
    fetchLeverJd(resolved.apiUrl, url, textCap, timeoutMs),
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
export async function fetchJdViaKnownApi(url, textCap = JD_TEXT_CAP, timeoutMs = WORKDAY_TIMEOUT_MS) {
  const resolved = resolveAtsApi(url);
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

/**
 * Write a jd-mode result to stdout, or fail with `empty_text` when the
 * extraction came back empty enough to be useless.
 *
 * A `--max-chars` below the floor is honored rather than made unsatisfiable: a
 * caller who asks for 50 chars gets 50, not a guaranteed failure.
 */
function emitJd(result, maxChars) {
  const floor = Math.min(MIN_JD_TEXT_CHARS, maxChars);
  if (result.text.length < floor) {
    console.error(JSON.stringify({
      error: `extracted ${result.text.length} chars of JD text (minimum ${floor}) — the page most likely renders its content client-side`,
      code: 'empty_text',
      url: result.url,
    }));
    process.exitCode = 1;
    return;
  }
  process.stdout.write(JSON.stringify(result));
}

/**
 * Shape a listing-mode result: keep visible anchors that look like individual
 * job postings, deduped by resolved URL, capped at `max`. Pure — exported for
 * tests. Anchors are dropped when the label is empty/too short or a nav
 * stopword, or the href isn't a resolvable http(s) URL.
 * @param {Array<{ href?: string, label?: string }>} anchors
 * @param {string} finalUrl - the page URL, used as the base to resolve relatives
 * @param {number} [max]
 */
export function normalizeListing(anchors, finalUrl, max = DEFAULT_LISTING_MAX) {
  const jobs = [];
  const seen = new Set();
  for (const a of Array.isArray(anchors) ? anchors : []) {
    const label = String(a?.label ?? '').replace(/\s+/g, ' ').trim();
    if (label.length < 3 || NAV_LABEL_STOPWORDS.has(label.toLowerCase())) continue;

    let url;
    try {
      url = new URL(String(a?.href ?? ''), finalUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:$/.test(new URL(url).protocol)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    jobs.push({ title: label, url });
    if (jobs.length >= max) break;
  }
  return { url: finalUrl, jobs };
}

const VALUE_FLAGS = ['--mode', '--max', '--max-chars', '--timeout'];
const KNOWN_FLAGS = [...VALUE_FLAGS, '--help', '-h'];

// One synopsis, used by both --help and the no_url error, so the two cannot
// drift apart: the error's own copy already omitted --timeout.
const USAGE_SYNOPSIS = 'browser-extract.mjs <url> [--mode jd|listing] [--max N] [--max-chars N] [--timeout MS]';

const USAGE = `Usage:
  node ${USAGE_SYNOPSIS}

  --mode jd|listing   jd (default) returns { url, title, text }; listing returns { url, jobs }
  --max N             listing: maximum postings to return (default ${DEFAULT_LISTING_MAX})
  --max-chars N       jd: text cap (default ${JD_TEXT_CAP}); raise it for a long JD
  --timeout MS        navigation timeout (default ${DEFAULT_TIMEOUT_MS})
  --help, -h          Show this help`;

/**
 * Parse CLI args into { url, mode, max, maxChars, timeout }.
 *
 * Value reads go through lib/cli-flags.mjs so BOTH accepted forms reach the
 * extractor. The hand-rolled loop this replaces matched tokens exactly against
 * its own `FLAGS` set, so `--max-chars=50000` was never recognized as a flag:
 * it fell to the `!tok.startsWith('--')` branch, was not the URL either, and
 * the run silently proceeded at the 12000 default — a JD truncated at the tail
 * for a caller who explicitly asked for more. Same silent-wrong-answer shape as
 * the `--from=…` class in #2401/#2402 that lib/cli-flags.mjs exists to end.
 *
 * The URL is still found positionally, and an explicit `0` is still honored
 * rather than silently replaced by the default.
 *
 * @param {string[]} argv - process.argv.slice(2)
 */
export function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];

  // A value token consumed by a space-separated flag is not the URL. Mirrors
  // validateFlags' own adjacency rule: only a token that does not itself start
  // with `--` is treated as a value, so `--mode --max 5` leaves `--max` to be
  // reported rather than swallowed as the mode.
  const consumed = new Set();
  args.forEach((a, i) => {
    if (VALUE_FLAGS.includes(a) && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
      consumed.add(i + 1);
    }
  });

  let url;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (typeof tok !== 'string' || consumed.has(i)) continue;
    if (!tok.startsWith('-') && url === undefined) url = tok;
  }

  // Each numeric read keeps its own range rule: `--max` admits 0 (a listing
  // capped at nothing is a meaningful request), the other two do not.
  const num = (flag, ok, fallback) => {
    if (!hasFlag(args, flag)) return fallback;
    const n = Number(flagValue(args, flag));
    return Number.isInteger(n) && ok(n) ? n : fallback;
  };

  const modeVal = hasFlag(args, '--mode') ? flagValue(args, '--mode') : undefined;

  return {
    url,
    mode: modeVal == null ? 'jd' : modeVal,
    max: num('--max', (n) => n >= 0, DEFAULT_LISTING_MAX),
    maxChars: num('--max-chars', (n) => n > 0, JD_TEXT_CAP),
    timeout: num('--timeout', (n) => n > 0, DEFAULT_TIMEOUT_MS),
  };
}

// Read the raw DOM inside the page: title, main visible text, and visible
// anchors. Runs in the browser context; returns plain data only.
async function readDom(page) {
  return page.evaluate(() => {
    const title = (document.querySelector('h1')?.innerText || document.title || '').trim();

    // Main text: prefer <main>/[role=main]/<article>, else body; strip nav chrome.
    const root =
      document.querySelector('main, [role="main"], article') || document.body;
    let text = '';
    if (root) {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script, style, nav, header, footer, noscript').forEach((el) => el.remove());
      text = clone.innerText || '';
    }

    const anchors = Array.from(document.querySelectorAll('a[href]'))
      .filter((el) => {
        if (el.closest('nav, header, footer')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.getClientRects().length > 0;
      })
      .map((el) => ({ href: el.getAttribute('href') || '', label: (el.innerText || '').trim() }));

    return { title, text, anchors };
  });
}

async function main() {
  const args = process.argv.slice(2);

  // Before anything launches a browser, because each of these used to fail in a
  // way that named the wrong thing (measured on 764f20f8):
  //   `--max-char 5000 <url>`  the typo was skipped, `5000` became the URL and
  //                            the real one was discarded — reported as
  //                            `invalid URL`, which is not what was wrong.
  //   `<url> --bogus`          skipped entirely; the scan ran and exited 0.
  //   `--help`                 exit 1 with a `no_url` error, never usage.
  //   `-h`                     one dash, so it was read AS the URL: `invalid URL`.
  // requireOperand: this script has nothing more specific to say about a missing
  // operand than the shared message, and without it `--max-chars --help` prints
  // usage and exits 0 with the malformed flag never reported (the ordering
  // CodeRabbit caught on #2961).
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  const { url, mode, max, maxChars, timeout } = parseArgs(args);

  if (!url) {
    console.error(JSON.stringify({ error: `usage: ${USAGE_SYNOPSIS}`, code: 'no_url' }));
    process.exit(1);
  }
  if (mode !== 'jd' && mode !== 'listing') {
    console.error(JSON.stringify({ error: `unknown mode "${mode}" (expected jd|listing)`, code: 'bad_mode' }));
    process.exit(1);
  }

  const guard = rejectPrivateOrInvalid(url);
  if (guard) {
    console.error(JSON.stringify({ error: guard.reason, code: guard.code }));
    process.exit(1);
  }

  // Known-ATS API first: Workday, Ashby, Greenhouse, and Lever all ship the
  // full JD body in a public JSON endpoint (see fetchJdViaKnownApi), so a
  // browser is never needed for those hosts. Workday additionally hydrates its
  // JD into a virtualized DOM the readDom() below cannot see at all, so this
  // isn't just an optimization for it — it's the only path that works.
  // Inconclusive -> fall through to Playwright, unchanged.
  if (mode === 'jd') {
    const apiResult = await fetchJdViaKnownApi(url, maxChars, timeout);
    if (apiResult) {
      emitJd(apiResult, maxChars);
      return;
    }
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(JSON.stringify({ error: 'playwright not installed', code: 'no_playwright' }));
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(LIVENESS_CONTEXT_OPTIONS);
    // Block every request (main navigation, redirect hop, or subresource) to a
    // private/loopback/link-local or non-http(s) host. Guarding only the initial
    // URL isn't enough once we return page CONTENT: a server-side redirect could
    // otherwise steer the browser at internal infrastructure (SSRF).
    await context.route('**/*', (route) => {
      if (rejectPrivateOrInvalid(route.request().url())) return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(HYDRATION_WAIT_MS); // let SPAs hydrate

    // Belt-and-suspenders: never emit content read from a private final URL.
    const finalUrl = page.url();
    const finalGuard = rejectPrivateOrInvalid(finalUrl);
    if (finalGuard) {
      console.error(JSON.stringify({ error: `blocked final URL: ${finalGuard.reason}`, code: finalGuard.code }));
      process.exitCode = 1;
      return;
    }
    const raw = await readDom(page);

    if (mode === 'listing') {
      process.stdout.write(JSON.stringify(normalizeListing(raw.anchors, finalUrl, max)));
    } else {
      emitJd(normalizeJd(raw, finalUrl, maxChars), maxChars);
    }
  } catch (err) {
    console.error(JSON.stringify({ error: `navigation error: ${String(err.message).split('\n')[0]}`, code: 'navigation_error' }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Only run main() when invoked directly, not when imported by tests.
if (isMainModule(import.meta.url)) {
  main();
}
