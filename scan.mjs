#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner with a plugin-based provider layer.
 *
 * Providers live in providers/*.mjs and are loaded at startup. Each provider
 * exports a default object with:
 *   - id: string — matched against `provider:` in portals.yml
 *   - detect(entry): {url}|null — optional auto-detection from careers_url
 *   - fetch(entry, ctx): [{title,url,company,location}] — required
 *
 * Files prefixed with _ are shared helpers (e.g. _http.mjs) and are never
 * loaded as providers. Adding a new HTTP/API source = drop a *.mjs into
 * providers/. Local executable parsers use `providers/local-parser.mjs` when
 * `parser.command` + `parser.script` are set in portals.yml.
 *
 * A tracked_companies entry can set `provider:` explicitly to bypass
 * URL-based auto-detection. The `transport:` field is reserved for future
 * transports — Phase A only ships the http transport.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 *   node scan.mjs --verify         # Playwright-check each new URL; drop expired postings
 *   node scan.mjs --verify --headed-fallback  # retry anti-bot-blocked URLs in a headed browser (needs a display)
 *   node scan.mjs --verify --throttle          # jittered ~5-10s gap between checks (stay under rate limits)
 *   node scan.mjs --verify --throttle=8000     # custom base gap in ms (waits base..2*base)
 *   node scan.mjs --include-blacklisted        # let data/blacklist.md matches through (annotated)
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';
import yaml from 'js-yaml';

import { makeHttpCtx } from './providers/_http.mjs';
import { buildTrustValidator } from './providers/_trust-validator.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { mergeProviderPlugins } from './plugins/_engine.mjs';
import { classifyFetchError } from './verify-portals.mjs';
import { fingerprintText, findCrossListings } from './fingerprint-core.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { normalizeCompanyName } from './invite-match.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { withPortalHealthLock } from './portal-health-lock.mjs';

try {
  const { config } = await import('dotenv');
  // quiet: dotenv's startup banner goes to stdout, which --json reserves for a
  // single JSON object (#1906).
  config({ quiet: true });
} catch {
  // dotenv is optional — fall back to process.env if not installed
}

const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || 'portals.yml';
const PROFILE_PATH = process.env.CAREER_OPS_PROFILE || 'config/profile.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';
const PROVIDERS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'providers');

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;

// Provider loading + routing live in providers/_registry.mjs so the portal
// health check (verify-portals.mjs) can reuse the exact same layer without
// importing this module.

// ── Title filter ────────────────────────────────────────────────────

// Compile a lowercased keyword into a matcher. Short all-letter acronyms
// (2-3 chars: cfo, coo, sdr, bdr, gsi…) match on WORD BOUNDARIES so "COO" no
// longer matches "Coordinator", "SDR" no longer matches anything mid-word, etc.
// Multi-word phrases and keywords containing non-letters (".NET", "SAP ",
// "L&D") keep fast, permissive substring matching.
export function compileKeyword(kw) {
  if (/^[a-z]{2,3}$/.test(kw)) {
    const re = new RegExp(`\\b${kw}\\b`);
    return (lower) => re.test(lower);
  }
  return (lower) => lower.includes(kw);
}

export function buildTitleFilter(titleFilter) {
  // Normalize defensively: a malformed title_filter (a null, numeric, or otherwise
  // non-string entry in the YAML) must not crash the scan via k.toLowerCase().
  const normalize = (arr) => (Array.isArray(arr) ? arr : [])
    .filter(k => typeof k === 'string')
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0)
    .map(compileKeyword);
  const positive = normalize(titleFilter?.positive);
  const negative = normalize(titleFilter?.negative);

  return (title) => {
    const lower = (title || '').toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(m => m(lower));
    const hasNegative = negative.some(m => m(lower));
    return hasPositive && !hasNegative;
  };
}

// Compiled-matcher cache for matchedTitleKeywords(), keyed by the
// `title_filter.positive` array reference. The scan loop calls this once per
// job with the same titleFilter config object, so caching avoids recompiling
// every keyword (compileKeyword()) on every single job.
const compiledPositiveCache = new WeakMap();

function compiledPositiveMatchers(positiveList) {
  if (compiledPositiveCache.has(positiveList)) return compiledPositiveCache.get(positiveList);
  const compiled = positiveList
    .filter(k => typeof k === 'string' && k.trim().length > 0)
    .map(k => ({ raw: k, match: compileKeyword(k.trim().toLowerCase()) }));
  compiledPositiveCache.set(positiveList, compiled);
  return compiled;
}

// Returns the raw (as-written in portals.yml) `title_filter.positive` keywords
// that matched a given title — used to scope `content_filter.by_title_keyword`
// overrides to only the categories that opted into a stricter content check.
export function matchedTitleKeywords(title, titleFilter) {
  const raw = Array.isArray(titleFilter?.positive) ? titleFilter.positive : [];
  const lower = (title || '').toLowerCase();
  return compiledPositiveMatchers(raw)
    .filter(({ match }) => match(lower))
    .map(({ raw: kw }) => kw);
}

// ── Location filter ─────────────────────────────────────────────────
// Optional. If `location_filter` is absent from portals.yml, all locations pass.
// Semantics (case-insensitive substring, in this order):
//   - Empty / whitespace-only / non-string location → pass (don't penalize
//     missing or malformed provider data)
//   - `always_allow` matches → pass (takes precedence over `block` — lets a
//     multi-location string like "Remote, Belgium or France" through because
//     the home region is an option, even though "france" is blocked)
//   - `block` matches → reject
//   - `allow` empty → pass (already cleared block)
//   - `allow` non-empty → must match at least one keyword, OR the TITLE carries
//     an explicit remote marker (see titleSignalsRemote below)

// Normalize a keyword list from portals.yml: tolerates a bare string
// (wrapped to a 1-item array), null/undefined (→ []), and non-string
// entries (filtered out). Survivors are lowercased, trimmed, and any
// resulting empty strings are dropped — an empty keyword would otherwise
// match every location via String.includes(''), silently bypassing the
// other tiers.
function normalizeKeywordList(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .filter(k => typeof k === 'string')
    .map(k => k.toLowerCase().trim())
    .filter(Boolean);
}

// Compile a location keyword into a word-boundary matcher.
//
// Plain String.includes() is wrong for location keywords because country and
// city names are prefixes of unrelated US place names. The motivating bug:
// blocking "india" also rejected "Indian Head, MD", "Indiana", and
// "Indianapolis" — real US locations, silently dropped from every scan.
// Likewise "china" would swallow "Chinatown" and "uk -" would swallow "Truck -".
//
// Lookarounds rather than \b so keywords that begin or end with punctuation
// (", IND", "UK -") still anchor correctly — \b is defined relative to word
// characters and behaves surprisingly at a punctuation edge.
// Note: distinct from compileKeyword() above, which serves the *title* filter and
// only boundary-anchors 2-3 letter acronyms. Location keywords need boundaries on
// every keyword, so they get their own compiler rather than changing title-matching
// behaviour. Returns a predicate, mirroring compileKeyword()'s shape.
function compileLocationKeyword(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startsWord = /[a-z0-9]/.test(keyword[0]);
  const endsWord = /[a-z0-9]/.test(keyword[keyword.length - 1]);
  const prefix = startsWord ? '(?<![a-z0-9])' : '';
  const suffix = endsWord ? '(?![a-z0-9])' : '';
  const re = new RegExp(`${prefix}${escaped}${suffix}`);
  return (lower) => re.test(lower);
}

function compileLocationKeywordList(value) {
  return normalizeKeywordList(value).map(compileLocationKeyword);
}

// Some providers report a rolled-up display string ("5 Locations", "2 Locations")
// while the canonical URL still names the real primary location. Workday is the
// common case: .../job/Hyderabad-Telangana-India/Network-Engineer_R-65193-1 shows
// up as "5 Locations", so no `block` keyword can ever match the location field.
// Recover that signal by reading the path segment right after `/job/`.
//
// Deliberately narrow: only the post-`/job/` segment is inspected, never the whole
// URL. Scanning the full URL would match company slugs and ATS subdomains by
// accident (a "china" or "india" substring inside an unrelated path). Providers
// without the `/job/{location}/` convention (Greenhouse, Lever, Ashby) yield no
// hint and keep their previous behaviour exactly.
export function locationHintFromUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return '';
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return '';
  }
  const segments = pathname.split('/').filter(Boolean);
  const jobIdx = segments.lastIndexOf('job');
  if (jobIdx === -1 || jobIdx === segments.length - 1) return '';
  let segment = segments[jobIdx + 1];
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // Malformed percent-encoding — fall back to the raw segment.
  }
  // "Hyderabad-Telangana-India" → "hyderabad telangana india" so multi-word
  // block keywords like "united arab emirates" can still match.
  return segment.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Some ATSs report the hiring office as the location even when the role is
// remote, and state the remoteness in the TITLE instead: Radancy/TalentBrew
// tenants return bare "City, State" strings, so
//   "Program Manager - Remote"  ->  location "Las Vegas, Nevada"
// An `allow` list written in country/region terms ("united states", "remote")
// then rejects a genuinely remote US role. Live measurement on
// careers.unitedhealthgroup.com: 14 PM-family postings, 0 passed `allow`,
// 5 of them said "Remote" outright in the title.
//
// Only an unambiguous work-arrangement marker counts. A bare /remote/ test
// would admit domain compounds — "Remote Sensing Program Manager" is an
// on-site GIS role, and Esri (a tracked company) posts exactly those. So
// "remote" must be followed by end-of-string, a non-letter (")", ",", "-"),
// or " in …" as in "Remote in MO" — never by another word, which is what makes
// "remote sensing" / "remote monitoring" compounds.
export const REMOTE_TITLE_RE = /(?<![a-z])remote(?=$|\s*[^a-z\s]|\s+in\b)/;

// …and a negation before the word has to lose, which the marker regex alone
// cannot see: in "Non-Remote" / "Not Remote" the delimiter clears the lookbehind
// and the trailing position clears the lookahead, so an explicitly on-site role
// would bypass a non-empty `allow` list — the exact opposite of the intent.
// The separator class must be at least as broad as the marker's own delimiter
// lookahead, or the guard is trivially sidestepped. An ASCII-only `[\s-]*` let
// every non-ASCII dash through — "Non–Remote" (en dash), "Non‑Remote"
// (non-breaking hyphen), em dash, figure dash and minus all still read as
// remote. `[^a-z]*` matches the marker's breadth: it spans any run of
// non-letters, so no punctuation variant can slip between the negation and the
// word.
// It cannot over-reach, because it never crosses a letter: in "Nonprofit
// Program Manager - Remote" the run after "non" starts with "profit", so the
// negation cannot reach "remote". Same for "Not-for-Profit … - Remote",
// "Nordic … - Remote", "Notary … - Remote".
// A negation anywhere in the title disqualifies it. Over-rejecting here is the
// safe direction: this tier only ever *rescues* a posting, so a false negative
// restores the previous behavior while a false positive admits an on-site role.
export const REMOTE_NEGATED_RE = /\b(?:non|not|no)[^a-z]*remote/;

/** @param {unknown} title @returns {boolean} whether the title marks the role remote. */
export function titleSignalsRemote(title) {
  if (typeof title !== 'string' || title.trim() === '') return false;
  const lower = title.toLowerCase();
  if (REMOTE_NEGATED_RE.test(lower)) return false;
  return REMOTE_TITLE_RE.test(lower);
}

// `url` and `title` are optional. Callers that omit them get the original
// location-only semantics, which is what the existing unit tests exercise.
export function buildLocationFilter(locationFilter) {
  if (!locationFilter) return () => true;
  const alwaysAllow = compileLocationKeywordList(locationFilter.always_allow);
  const allow = compileLocationKeywordList(locationFilter.allow);
  const block = compileLocationKeywordList(locationFilter.block);

  return (location, url, title) => {
    const lower = typeof location === 'string' ? location.trim().toLowerCase() : '';
    const hint = locationHintFromUrl(url);
    // Nothing to judge on either field → pass (don't penalize missing data).
    if (lower === '' && hint === '') return true;
    const matches = (m) => (lower !== '' && m(lower)) || (hint !== '' && m(hint));
    // always_allow still wins over block, and may be satisfied by either field:
    // a genuinely US role whose display string says "United States" is never
    // rejected because of what its URL happens to contain.
    if (alwaysAllow.length > 0 && alwaysAllow.some(matches)) return true;
    if (block.length > 0 && block.some(matches)) return false;
    if (allow.length === 0) return true;
    if (allow.some(matches)) return true;
    // Last resort only. Deliberately placed AFTER `block` so a remote title can
    // never rescue a blocked location — "Program Manager - Remote" in Bengaluru
    // stays rejected. This widens `allow`, never `block`.
    return titleSignalsRemote(title);
  };
}

// ── Posting-age filter ──────────────────────────────────────────────
// Optional opt-in. If `max_posting_age_days` is absent (or not a positive
// integer) in portals.yml, every offer passes. An offer is skipped only when
// the provider supplied a postedAt (epoch ms) AND it is older than N days.
// Offers with no date always pass — same "don't penalize missing data"
// convention as the location filter. `now` is injectable for deterministic tests.
export function buildPostingAgeFilter(maxAgeDays, now = Date.now()) {
  const max = Number(maxAgeDays);
  if (!Number.isInteger(max) || max <= 0) return () => true;
  const cutoff = now - max * 24 * 60 * 60 * 1000; // N days in ms, subtracted from now
  return (postedAt) => {
    if (typeof postedAt !== 'number' || !Number.isFinite(postedAt)) return true;
    return postedAt >= cutoff;
  };
}

// ── Posted-date lower bound (shared by the filter and the early-stop) ──
// --posted-after states a lower bound absolutely; --since <days> states the
// same thing relatively. They AND together with each other and with
// max_posting_age_days, so the NEWEST bound is what actually decides
// eligibility. Both consumers must agree on it: the downstream filter and the
// provider early-stop hint. Kept as one function so they cannot drift.

/**
 * Parse and validate `--since <days>` from an argv slice.
 *
 * Shared by scan.mjs and scan-ats-full.mjs so ONE flag name cannot mean two
 * different things. scan-ats-full.mjs used `Number(valueOf('--since')) || 3`,
 * which silently swallowed every malformed operand: `--since abc` and
 * `--since 0` both became 3 (the user believes they scanned the window they
 * typed), `--since -5` produced a cutoff in the FUTURE so nothing was ever
 * eligible (indistinguishable from "no new postings"), and `--since 1e400`
 * became Infinity → an -Infinity cutoff, i.e. no window at all (#2498).
 *
 * Returns the day count, or null when the flag is absent — the DEFAULT is the
 * caller's to choose (scan.mjs: no bound; scan-ats-full.mjs: 3 days), only the
 * validation is shared. `error` is a ready-to-print message; callers print and
 * exit rather than this throwing, so both CLIs fail the same way.
 *
 * @param {string[]} args - argv slice.
 * @returns {{days: number|null, error: string|null}}
 */
export function parseSinceDays(args) {
  // Every occurrence is collected, not just the first match of either form:
  // picking one and ignoring the rest means `--since=7 --since` succeeds while
  // an occurrence with no value goes unread.
  const occurrences = args.filter((a) => a === '--since' || a.startsWith('--since='));
  if (occurrences.length > 1) {
    return { days: null, error: `--since given ${occurrences.length} times; pass it once` };
  }
  if (occurrences.length === 0) return { days: null, error: null };
  const occ = occurrences[0];
  const next = args[args.indexOf('--since') + 1];
  const raw = occ.startsWith('--since=')
    ? occ.slice('--since='.length)
    : (next != null && !next.startsWith('--') ? next : null);
  const n = raw == null || raw === '' ? NaN : Number(raw);
  // Number.isFinite also rejects Infinity and 1e309, which pass a bare `> 0`
  // test and would yield an -Infinity cutoff (i.e. silently no window).
  if (!Number.isFinite(n) || n <= 0) {
    return { days: null, error: `--since expects a positive number of days, got ${raw == null || raw === '' ? '(no value)' : `"${raw}"`}` };
  }
  // Finite and positive is not enough: 1e300 days lands outside the ±8.64e15ms
  // range a Date can represent, so the derived cutoff is an Invalid Date and
  // toISOString() throws. Reject it here rather than let it surface as an
  // unhandled "Invalid time value" mid-scan.
  if (Number.isNaN(new Date(Date.now() - n * 86_400_000).getTime())) {
    return { days: null, error: `--since ${raw} is too large to express as a date` };
  }
  return { days: n, error: null };
}

/**
 * Collapse --posted-after and --since into a single absolute lower bound.
 *
 * @param {string|null} postedAfter - YYYY-MM-DD from --posted-after, or null.
 * @param {number|null} sinceDays - Positive day count from --since, or null.
 * @param {number} [now] - Injectable clock for tests.
 * @returns {string|null} YYYY-MM-DD, the newer of the two, or null if neither.
 */
export function resolveEffectiveAfter(postedAfter, sinceDays, now = Date.now()) {
  // Truncating --since to a date rather than an exact timestamp makes it
  // marginally more permissive, which is the safe direction for a bound that
  // also stops pagination.
  // Guarded rather than assumed valid: this is exported and unit-tested, so it
  // must not throw for any input. A day count large enough to push the cutoff
  // outside the representable Date range yields an Invalid Date, and
  // toISOString() would throw RangeError on it.
  const cutoff = Number.isFinite(sinceDays) && sinceDays > 0 ? new Date(now - sinceDays * 86_400_000) : null;
  const sinceIso = cutoff && !Number.isNaN(cutoff.getTime())
    ? cutoff.toISOString().slice(0, 10)
    : null;
  return [postedAfter, sinceIso].filter(Boolean).reduce((a, b) => (a > b ? a : b), null);
}

/**
 * The oldest posting the filters would still accept — the early-stop floor.
 *
 * Stopping pagination any NEWER than this would leave eligible postings
 * unfetched, which is the one thing the optimisation must never do. Returns
 * null when no CLI window is active: max_posting_age_days constrains the floor
 * but must not by itself switch early stopping on for configs that never asked.
 *
 * @param {string|null} effectiveAfter - Output of resolveEffectiveAfter.
 * @param {*} maxAgeDays - config.max_posting_age_days (may be absent/invalid).
 * @param {number} [now] - Injectable clock for tests.
 * @returns {number|null} Epoch ms floor, or null to disable early stopping.
 */
export function resolveEarlyStopMs(effectiveAfter, maxAgeDays, now = Date.now()) {
  if (!effectiveAfter) return null;
  const max = Number(maxAgeDays);
  const ageFloor = Number.isInteger(max) && max > 0 ? now - max * 86_400_000 : -Infinity;
  return Math.max(Date.parse(`${effectiveAfter}T00:00:00Z`), ageFloor);
}

// ── Absolute posted-date filter ─────────────────────────────────────
// CLI-only (--posted-after / --posted-before), unlike the config-driven
// relative max_posting_age_days above. Both bounds optional and inclusive
// (before is treated as end-of-day). A job with no postedAt always passes —
// same "don't penalize missing data" convention as buildPostingAgeFilter.
export function buildPostedDateFilter(afterIso, beforeIso) {
  const afterMs = afterIso ? Date.parse(afterIso) : NaN;
  const beforeMs = beforeIso ? Date.parse(`${beforeIso}T23:59:59.999Z`) : NaN;
  const hasAfter = Number.isFinite(afterMs);
  const hasBefore = Number.isFinite(beforeMs);
  if (!hasAfter && !hasBefore) return () => true;
  return (postedAt) => {
    if (typeof postedAt !== 'number' || !Number.isFinite(postedAt)) return true;
    if (hasAfter && postedAt < afterMs) return false;
    if (hasBefore && postedAt > beforeMs) return false;
    return true;
  };
}

// ── Content filter ──────────────────────────────────────────────────
// Optional. If `content_filter` is absent from portals.yml, all jobs pass.
// Filters on the job DESCRIPTION text to separate same-titled roles with
// different stacks (a "Software Engineer" listing that mentions "PHP" vs one
// that mentions "Rust"). Semantics (case-insensitive substring, in order):
//   - Empty / whitespace-only / non-string description → PASS. The scanner is
//     zero-token and only sees descriptions a provider already returns in its
//     list payload; providers without one must never be silently dropped.
//   - any `negative` keyword present → reject
//   - `positive` empty → pass (already cleared negatives)
//   - `positive` non-empty → at least one keyword must be present
//
// `content_filter.by_title_keyword` (optional): scopes a stricter positive/
// negative pair to only the jobs whose title matched a specific
// `title_filter.positive` keyword, so e.g. an "AI Engineer" title-match can
// require the description to actually mention a concrete AI tool, without
// that requirement leaking onto unrelated categories like "Instructional
// Designer". When one or more of a job's matched title keywords has an
// override, the overrides govern (any override passing is enough); the
// global `positive`/`negative` pair is the fallback for jobs whose matched
// keyword(s) have no override entry.
//
// Provider support: only providers whose list API ships the description for
// free (no extra per-job request, which would break the zero-token design)
// populate `job.description`. Lever (`descriptionPlain`) does today; others
// leave it empty and therefore always pass this filter.

export function buildContentFilter(contentFilter) {
  if (!contentFilter) return () => true;
  const positive = normalizeKeywordList(contentFilter.positive);
  const negative = normalizeKeywordList(contentFilter.negative);

  const byTitleKeyword = new Map();
  if (contentFilter.by_title_keyword && typeof contentFilter.by_title_keyword === 'object' && !Array.isArray(contentFilter.by_title_keyword)) {
    for (const [kw, rule] of Object.entries(contentFilter.by_title_keyword)) {
      if (typeof kw !== 'string' || !kw.trim()) continue;
      byTitleKeyword.set(kw.trim().toLowerCase(), {
        positive: normalizeKeywordList(rule?.positive),
        negative: normalizeKeywordList(rule?.negative),
      });
    }
  }

  return (description, matchedKeywords = []) => {
    if (typeof description !== 'string' || description.trim() === '') return true;
    const lower = description.toLowerCase();

    const overrides = matchedKeywords
      .filter(k => typeof k === 'string')
      .map(k => byTitleKeyword.get(k.trim().toLowerCase()))
      .filter(Boolean);

    if (overrides.length > 0) {
      return overrides.some(rule => {
        if (rule.negative.length > 0 && rule.negative.some(k => lower.includes(k))) return false;
        if (rule.positive.length === 0) return true;
        return rule.positive.some(k => lower.includes(k));
      });
    }

    if (negative.length > 0 && negative.some(k => lower.includes(k))) return false;
    if (positive.length === 0) return true;
    return positive.some(k => lower.includes(k));
  };
}

// ── Country-eligibility filter (#2093) ──────────────────────────────
// Optional, opt-in. If `country_eligibility_filter` is absent from
// portals.yml, all jobs pass — byte-identical to pre-#2093 behavior.
//
// Problem it solves: `location_filter` only reads the ATS provider's
// STRUCTURED location field (e.g. "Remote"), which many US companies use
// identically regardless of actual country eligibility. The real
// restriction — "US-based candidates only" vs. "US or Canada eligible" —
// often lives only in the JD DESCRIPTION body text, which this filter reads
// (same field `content_filter` already reads — `job.description`).
//
// Semantics (case-insensitive substring), mirroring location_filter's
// "don't penalize missing data" discipline exactly:
//   - Candidate's own `location.country` (config/profile.yml) is "United
//     States" → always pass, unconditionally. An exclusionary "US only"
//     phrase can never legitimately block a US-based candidate, so the
//     filter no-ops entirely rather than special-casing every keyword check.
//   - Empty / whitespace-only / non-string description → pass (no signal).
//   - No `exclusionary` phrase matched → pass (ambiguous stays ambiguous,
//     never guessed — this also means an `inclusive`-only match with no
//     exclusionary wording present is a no-op pass, same as having no
//     signal at all).
//   - `exclusionary` phrase matched AND an `inclusive` phrase is also
//     present → pass (the posting explicitly widens eligibility).
//   - `exclusionary` phrase matched AND the candidate's own country is
//     literally named in the JD text (e.g. a Canadian candidate scanning a
//     posting that separately mentions "Canada" elsewhere) → pass.
//   - `exclusionary` phrase matched, no `inclusive` phrase, and the
//     candidate's own country isn't named → reject.
//
// Config shape (portals.yml):
//   country_eligibility_filter:
//     exclusionary: ["must be located in the united states", ...]
//     inclusive: ["united states or canada", "north america", ...]
//
// Kept as a sibling block to `content_filter` rather than folded into its
// positive/negative shape: this filter cross-references
// `config/profile.yml`'s `location.country` and has its own three-way
// exclusionary/inclusive/candidate-country-named semantics, which doesn't
// fit content_filter's simpler two-list reject/require shape.

export function buildCountryEligibilityFilter(countryEligibilityFilter, candidateCountry) {
  if (!countryEligibilityFilter) return () => true;

  const candidateCountryLower = typeof candidateCountry === 'string'
    ? candidateCountry.toLowerCase().trim()
    : '';

  // A "US-based candidates only" restriction can never legitimately exclude
  // a candidate who is themselves US-based — no-op the whole filter rather
  // than relying on the literal-country-name check below (which would miss
  // phrasing like "US-based candidates only" that never spells out "united
  // states").
  if (candidateCountryLower === 'united states') return () => true;

  const exclusionary = normalizeKeywordList(countryEligibilityFilter.exclusionary);
  const inclusive = normalizeKeywordList(countryEligibilityFilter.inclusive);

  return (description) => {
    if (typeof description !== 'string' || description.trim() === '') return true;
    const lower = description.toLowerCase();

    if (exclusionary.length === 0) return true;
    if (!exclusionary.some(k => lower.includes(k))) return true;
    if (inclusive.length > 0 && inclusive.some(k => lower.includes(k))) return true;
    if (candidateCountryLower && lower.includes(candidateCountryLower)) return true;

    return false;
  };
}

// ── Visa / work-authorization filter ────────────────────────────────
// Optional. If `visa_filter` is absent (or `enabled: false`), all jobs pass.
// Surfaces roles that sponsor a work visa (H-1B / H-1B1 / O-1 for the US, plus
// the generic "visa sponsorship" wording) and drops roles that explicitly
// refuse sponsorship. Like content_filter it reads the job DESCRIPTION text, so
// it only has signal for providers whose list API ships a description (Lever
// today); jobs without one fall back to the require_mention rule below.
//
// Semantics (case-insensitive substring):
//   - any `negative` keyword present → reject (an explicit "no sponsorship")
//   - require_mention: false (default) → after clearing negatives, PASS —
//     including jobs with no description. Use this to only weed out the
//     explicit rejections while keeping everything unstated.
//   - require_mention: true → keep only jobs whose description contains at least
//     one `positive` keyword; a missing/empty description is rejected. Use this
//     to surface *only* postings that actively advertise sponsorship.
//
// `positive` / `negative` default to a curated US-sponsorship vocabulary when
// omitted, so `visa_filter: { enabled: true }` works out of the box; supplying
// either list overrides that default.

export const DEFAULT_VISA_POSITIVE = [
  'visa sponsorship',
  'sponsor a visa',
  'sponsor visas',
  'will sponsor',
  'sponsorship available',
  'sponsorship is available',
  'eligible for sponsorship',
  'provide sponsorship',
  'offer sponsorship',
  'immigration support',
  'h-1b',
  'h1b',
  'h-1b1',
  'h1b1',
  'o-1 visa',
];

export const DEFAULT_VISA_NEGATIVE = [
  'no visa sponsorship',
  'no sponsorship',
  'without sponsorship',
  'unable to sponsor',
  'not able to sponsor',
  'cannot sponsor',
  'do not sponsor',
  'does not sponsor',
  'not offer sponsorship',
  'not provide sponsorship',
  'sponsorship is not available',
  'sponsorship not available',
  'not offer visa sponsorship',
];

export function buildVisaFilter(visaFilter) {
  if (!visaFilter || visaFilter.enabled === false) return () => true;
  const positive = visaFilter.positive != null
    ? normalizeKeywordList(visaFilter.positive)
    : DEFAULT_VISA_POSITIVE.slice();
  const negative = visaFilter.negative != null
    ? normalizeKeywordList(visaFilter.negative)
    : DEFAULT_VISA_NEGATIVE.slice();
  const requireMention = visaFilter.require_mention === true;

  return (description) => {
    const hasText = typeof description === 'string' && description.trim() !== '';
    if (!hasText) return !requireMention;
    const lower = description.toLowerCase();
    if (negative.length > 0 && negative.some(k => lower.includes(k))) return false;
    if (!requireMention) return true;
    if (positive.length === 0) return true;
    return positive.some(k => lower.includes(k));
  };
}

// ── Salary filter ───────────────────────────────────────────────────
// Optional. If `salary_filter` is absent from portals.yml, all salaries pass.
// Semantics:
//   - min/max are annual compensation filters (use annualized values)
//   - max: 0 means "no upper limit"
//   - If no salary data exists on a job, it passes (conservative behavior)
//   - If both currencies are known and mismatch (e.g., USD filter, EUR job), it fails
//   - Partial ranges (min only or max only) work correctly via overlap logic
// Uses null-safe checks (!= null, ??) to preserve 0 values correctly.

export function buildSalaryFilter(salaryFilter) {
  if (!salaryFilter) return () => true;

  // Coerce and validate bounds — malformed YAML must not silently mis-filter
  const min = Number(salaryFilter.min ?? 0);
  const max = Number(salaryFilter.max ?? 0);
  const filterCurrency = (salaryFilter.currency || '').trim().toUpperCase();

  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) {
    console.error('Warning: salary_filter.min/max must be non-negative numbers — salary filter disabled');
    return () => true;
  }
  if (max > 0 && min > max) {
    console.error('Warning: salary_filter.min cannot exceed salary_filter.max — salary filter disabled');
    return () => true;
  }

  // If both min and max are 0, no filtering applied
  if (min === 0 && max === 0) return () => true;

  return (salary) => {
    // If no salary data exists, pass (conservative - many providers don't expose salary)
    if (!salary) return true;

    const jobMin = salary.min ?? salary.max ?? null;
    const jobMax = salary.max ?? salary.min ?? null;

    // If we have no usable salary values, pass conservatively
    if (jobMin == null && jobMax == null) return true;

    // Currency handling - reject only if BOTH currencies exist and mismatch
    const jobCurrency = (salary.currency || '').trim().toUpperCase();
    if (filterCurrency && jobCurrency && filterCurrency !== jobCurrency) {
      return false;
    }

    // Range overlap logic - reject ONLY if job is completely outside filter range
    // Job entirely below user minimum
    if (min > 0 && jobMax != null && jobMax < min) {
      return false;
    }
    // Job entirely above user maximum
    if (max > 0 && jobMin != null && jobMin > max) {
      return false;
    }

    // Otherwise pass (overlap exists or no valid range to compare)
    return true;
  };
}

export function companyMatch(jobCompany, windowCompany) {
  const cleanNoSpaces = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const c1NoSpaces = cleanNoSpaces(jobCompany);
  const c2NoSpaces = cleanNoSpaces(windowCompany);
  if (c1NoSpaces === c2NoSpaces) return true;

  const cleanWithSpaces = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const c1WithSpaces = cleanWithSpaces(jobCompany);
  const c2WithSpaces = cleanWithSpaces(windowCompany);
  if (!c1WithSpaces || !c2WithSpaces) return false;

  const regex1 = new RegExp('\\b' + c2WithSpaces.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b');
  const regex2 = new RegExp('\\b' + c1WithSpaces.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b');
  return regex1.test(c1WithSpaces) || regex2.test(c2WithSpaces);
}

export function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Reads config/profile.yml's `location.country` (already a documented
// profile field — see config/profile.example.yml) for the country-
// eligibility filter (#2093). Missing file, missing field, or a malformed
// profile all resolve to '' — buildCountryEligibilityFilter treats an empty
// candidate country the same as "not the candidate's own country's US
// no-op" and simply skips the literal-country-name pass-through, which is
// the same conservative "don't penalize missing data" default used
// throughout this file.
export function loadCandidateCountry(profilePath = PROFILE_PATH) {
  if (!existsSync(profilePath)) return '';
  try {
    const raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    const country = raw?.location?.country;
    return typeof country === 'string' ? country.trim() : '';
  } catch {
    return '';
  }
}

export function loadReApplyWindows(profilePath = PROFILE_PATH) {
  if (!existsSync(profilePath)) return {};
  try {
    const raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    const windows = raw.re_apply_windows || {};
    const validWindows = {};
    for (const [company, win] of Object.entries(windows)) {
      if (!win || typeof win !== 'object') continue;
      const lastApplyDate = win.last_apply_date;
      if (typeof lastApplyDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(lastApplyDate)) continue;
      if (isNaN(Date.parse(lastApplyDate))) continue;

      const sameRoleDays = win.same_role_days;
      if (sameRoleDays !== undefined && (!Number.isInteger(sameRoleDays) || sameRoleDays < 0)) continue;

      if (win.applied_to !== undefined && !Array.isArray(win.applied_to)) continue;
      if (win.applied_to !== undefined && win.applied_to.some(x => typeof x !== 'string')) continue;

      if (win.cross_role_bucket !== undefined && typeof win.cross_role_bucket !== 'string') continue;

      validWindows[company] = win;
    }
    return validWindows;
  } catch {
    return {};
  }
}

export function buildCooldownFilter(windows, today) {
  if (!windows || Object.keys(windows).length === 0) {
    return () => ({ skip: false });
  }

  const genericKeywords = new Set(['all', 'roles', 'role', 'family', 'bucket', 'group', 'team']);

  return (job) => {
    const jobCompany = job.company || '';
    const jobTitleLower = (job.title || '').toLowerCase();

    for (const [windowCompany, window] of Object.entries(windows)) {
      if (companyMatch(jobCompany, windowCompany)) {
        const lastApplyDate = window.last_apply_date;
        const sameRoleDays = Number(window.same_role_days || 0);
        if (!lastApplyDate) continue;

        const cooldownUntil = addDays(lastApplyDate, sameRoleDays);
        if (today >= cooldownUntil) {
          continue;
        }

        if (Array.isArray(window.applied_to)) {
          const matchesApplied = window.applied_to.some(role => {
            const roleLower = role.toLowerCase();
            return jobTitleLower.includes(roleLower);
          });
          if (matchesApplied) {
            return { skip: true, reason: `cooldown:${windowCompany}:${cooldownUntil}`, cooldownUntil };
          }
        }

        if (window.cross_role_bucket) {
          const bucketKeywords = window.cross_role_bucket
            .toLowerCase()
            .split('_')
            .filter(kw => kw && !genericKeywords.has(kw));

          const matchesBucket = bucketKeywords.some(kw => {
            if (kw === 'em') {
              return /\bem\b/i.test(jobTitleLower) || jobTitleLower.includes('engineering manager');
            }
            return jobTitleLower.includes(kw);
          });

          if (matchesBucket) {
            return { skip: true, reason: `cooldown:${windowCompany}:${cooldownUntil}`, cooldownUntil };
          }
        }
      }
    }

    return { skip: false };
  };
}


// ── URL rediscovery (--rediscover-404) ──────────────────────────────
// When a tracked company's job URL returns 404/410, the role may have just
// moved to a new URL (Workday/Greenhouse rotate URLs without closing roles).
// These helpers back an opt-in search-and-reverify fallback before giving up.

// extractCareersUrlDomain returns the hostname of a company's careers_url, or
// null when it's missing/unparseable. The presence of a domain is what gates
// the fallback — broad-discovery offers without a careers_url stay ineligible.
export function extractCareersUrlDomain(careersUrl) {
  if (!careersUrl) return null;
  try {
    return new URL(careersUrl).hostname;
  } catch {
    return null;
  }
}

// resolveSearchHref unwraps a DuckDuckGo HTML redirect (`/l/?uddg=<encoded>`)
// to its real destination, so domain matching sees the actual host instead of
// duckduckgo.com. Non-redirect hrefs pass through unchanged.
function resolveSearchHref(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const isDdgHost = u.hostname === 'duckduckgo.com' || u.hostname.endsWith('.duckduckgo.com');
    if (isDdgHost && u.pathname === '/l/') {
      const target = u.searchParams.get('uddg');
      if (target) return target;
    }
  } catch {
    /* fall through to the raw href */
  }
  return href;
}

// pickRediscoveredUrl chooses the first result whose hostname *exactly* equals
// the careers domain (no substring/look-alike matches), unwrapping search-engine
// redirects first. Pure + exported so result-matching is unit-testable without
// driving a real browser. Returns null when nothing matches.
export function pickRediscoveredUrl(hrefs, domain) {
  if (!domain || !Array.isArray(hrefs)) return null;
  for (const raw of hrefs) {
    const href = resolveSearchHref(raw);
    let host;
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }
    if (host === domain) return href;
  }
  return null;
}

// REDISCOVER_TIMEOUT_MS bounds the single fallback search so a slow or blocked
// search engine can't stall the sequential verify loop.
const REDISCOVER_TIMEOUT_MS = 10_000;

// searchForNewUrl runs one site-scoped search for a moved tracked role and
// returns a same-domain URL if found, else null. Every failure path returns
// null — the fallback must never throw into the verify loop. Leaves the page on
// a blank document so the next checkUrlLiveness call starts clean.
async function searchForNewUrl(page, offer) {
  const domain = offer.careersUrlDomain;
  if (!domain) return null;
  const query = `"${offer.title}" "${offer.company}" site:${domain}`;
  try {
    await page.goto(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded', timeout: REDISCOVER_TIMEOUT_MS },
    );
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a.result__a'))
        .map((a) => a.getAttribute('href'))
        .filter(Boolean),
    );
    return pickRediscoveredUrl(hrefs, domain);
  } catch {
    return null;
  } finally {
    try {
      await page.goto('about:blank');
    } catch {
      /* ignore — best-effort cleanup */
    }
  }
}

// ── Dedup ───────────────────────────────────────────────────────────

const PERMANENT_SCAN_HISTORY_STATUSES = new Set([
  'skipped_invalid_url',
  'skipped_blocked_host',
]);

function daysBetweenIsoDates(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (startDate.toISOString().slice(0, 10) !== start || endDate.toISOString().slice(0, 10) !== end) return null;
  return Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
}

export function shouldDedupScanHistoryRow({ firstSeen, status = 'added' }, { recheckAfterDays = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (PERMANENT_SCAN_HISTORY_STATUSES.has(status)) return true;
  if (status.startsWith('cooldown:')) {
    const parts = status.split(':');
    const cooldownUntil = parts[parts.length - 1];
    return today < cooldownUntil;
  }
  if (status !== 'added') return true;
  if (recheckAfterDays == null) return true;
  const ageDays = daysBetweenIsoDates(firstSeen, today);
  if (ageDays == null) return true;
  return ageDays < recheckAfterDays;
}

function scanHistoryPolicy(config = {}) {
  const raw = config.scan_history?.recheck_after_days;
  const parsed = Number.parseInt(raw, 10);
  return {
    recheckAfterDays: Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
  };
}

// Query params that carry no identity information for a job posting — safe to
// strip when computing the dedup key. Deliberately an allowlist rather than
// "strip everything": several ATSes key the posting off a query param (e.g.
// Greenhouse's `gh_jid`), so a blanket strip would collapse distinct roles.
const DEDUP_STRIP_PARAMS = new Set([
  'language', 'lang', 'locale',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'src', 'source', 'gh_src', 'lever-origin', 'lever-source',
  'rltr', // StepStone: regenerated per request, so one posting returns as new every scan
]);

/**
 * Normalize a job posting URL into a stable dedup key.
 *
 * Strips cosmetic query params (locale/tracking), drops a trailing slash,
 * and lowercases scheme, host, and path. Only used to compute the
 * *comparison* key — callers keep writing/displaying the original URL so
 * links stay clickable and scan-history/pipeline.md stay faithful to what
 * the provider returned.
 *
 * The path is lowercased because scan.mjs and scan-ats-full.mjs run as
 * separate processes and can independently produce different casing for the
 * identical posting — a Workday tenant/site path segment reached via the
 * curated portals.yml entry vs. the reverse-ATS dataset, for instance. A
 * case-sensitive key silently treats those as two distinct URLs, so the same
 * role lands in pipeline.md twice. Path casing is not meaningfully distinct
 * for any provider these scanners target.
 *
 * Query *values* keep their original casing — those can be identity-bearing
 * (Greenhouse's `gh_jid`), which is also why DEDUP_STRIP_PARAMS is an
 * allowlist rather than a blanket strip.
 *
 * Falls back to the raw string when the URL is malformed, preserving the
 * old byte-for-byte behavior for unparsable history rows.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrlForDedup(url) {
  if (typeof url !== 'string' || !url) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const param of Array.from(parsed.searchParams.keys())) {
    if (DEDUP_STRIP_PARAMS.has(param.toLowerCase())) {
      parsed.searchParams.delete(param);
    }
  }
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').toLowerCase() || '/';
  return parsed.toString();
}

export function loadSeenUrls(policy = {}) {
  const seen = new Set();
  let recheckEligible = 0;

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const [url, firstSeen, , , , status = 'added'] = line.split('\t');
      if (!url) continue;
      if (shouldDedupScanHistoryRow({ firstSeen, status }, policy)) seen.add(normalizeUrlForDedup(url));
      else recheckEligible++;
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(normalizeUrlForDedup(match[1]));
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(normalizeUrlForDedup(match[0]));
    }
  }

  return { seen, recheckEligible };
}

/**
 * Normalize a company label when no alias map is configured.
 *
 * This deliberately does only the pre-existing behavior: trim and lowercase the
 * raw company name. `buildCompanyCanonicalizer` wraps this with the optional
 * alias map so installs without `company_aliases` keep byte-for-byte dedupe
 * semantics.
 *
 * @param {unknown} name - Raw company value from a tracker row or provider job.
 * @returns {string} Lowercased, trimmed company key.
 */
function defaultCompanyNormalizer(name) {
  return String(name ?? '').trim().toLowerCase();
}

/**
 * Build a company-name canonicalizer from `config.company_aliases`.
 *
 * The map is `{ CanonicalName: [alias, ...] }`; every alias and the canonical
 * name itself resolve to the lowercased canonical name. This closes the gap
 * where an ATS org name, for example Greenhouse "Intercom", differs from the
 * tracker/brand label, for example "Fin". Without it, the company+role dedupe
 * key never matches the tracker and the same role is re-scanned every run.
 *
 * Unknown names pass through as plain lowercased text, so behavior is unchanged
 * for companies with no alias entry.
 *
 * Canonical names always keep their own identity when an alias collides with
 * one. An alias claimed by multiple canonical companies also passes through
 * unchanged so malformed config cannot silently merge unrelated companies.
 *
 * @param {Record<string, unknown>|undefined|null} aliases - Optional canonical
 *   company name to alias list map.
 * @returns {(name: unknown) => string} Canonicalizer for tracker and scan-side
 *   company labels.
 */
export function buildCompanyCanonicalizer(aliases) {
  const map = new Map();
  if (aliases && typeof aliases === 'object' && !Array.isArray(aliases)) {
    const entries = Object.entries(aliases);
    const canonicalKeys = new Set();

    // Canonical names always own their identity, independent of YAML key order.
    for (const [canonical] of entries) {
      const canon = defaultCompanyNormalizer(canonical);
      if (!canon) continue;
      map.set(canon, canon);
      canonicalKeys.add(canon);
    }

    const aliasTargets = new Map();
    for (const [canonical, list] of entries) {
      const canon = defaultCompanyNormalizer(canonical);
      if (!canon) continue;
      const arr = Array.isArray(list) ? list : [list];
      for (const a of arr) {
        const alias = defaultCompanyNormalizer(a);
        if (!alias || canonicalKeys.has(alias)) continue;
        if (!aliasTargets.has(alias)) aliasTargets.set(alias, new Set());
        aliasTargets.get(alias).add(canon);
      }
    }

    // Ambiguous aliases fail open as their raw normalized label. This may allow
    // a duplicate through, but it cannot silently suppress another company.
    for (const [alias, targets] of aliasTargets) {
      if (targets.size === 1) map.set(alias, targets.values().next().value);
    }
  }

  /**
   * Canonicalize one raw company label through the alias map.
   *
   * @param {unknown} name - Raw company value from a tracker row or provider job.
   * @returns {string} Canonical lowercased company key.
   */
  return function canonicalizeCompany(name) {
    const key = defaultCompanyNormalizer(name);
    return map.get(key) ?? key;
  };
}

const ROLE_LOCATION_SUFFIXES = new Set([
  'amer',
  'americas',
  'amsterdam',
  'apac',
  'austin',
  'barcelona',
  'bay area',
  'belgium',
  'berlin',
  'boston',
  'brussels',
  'budapest',
  'canada',
  'chicago',
  'copenhagen',
  'dublin',
  'emea',
  'eu',
  'europe',
  'finland',
  'france',
  'frankfurt',
  'germany',
  'hamburg',
  'helsinki',
  'india',
  'ireland',
  'italy',
  'la',
  'latin america',
  'lisbon',
  'london',
  'los angeles',
  'madrid',
  'melbourne',
  'milan',
  'montreal',
  'munich',
  'netherlands',
  'new york',
  'north america',
  'nyc',
  'on site',
  'onsite',
  'oslo',
  'paris',
  'poland',
  'porto',
  'prague',
  'remote',
  'rome',
  'san francisco',
  'seattle',
  'sf',
  'singapore',
  'spain',
  'stockholm',
  'sydney',
  'tokyo',
  'toronto',
  'uk',
  'united kingdom',
  'united states',
  'us',
  'usa',
  'vancouver',
  'vienna',
  'warsaw',
  'zurich',
]);

const ROLE_REMOTE_SUFFIXES = new Set([
  'distributed',
  'hybrid',
  'on site',
  'onsite',
  'remote',
  'wfh',
  'work from home',
]);

/**
 * Normalize bracket text before checking whether it is a location suffix.
 *
 * @param {unknown} tag - Text from a trailing parenthetical or bracket suffix.
 * @returns {string} Lowercased, punctuation-normalized suffix text.
 */
function normalizeRoleSuffixTag(tag) {
  return String(tag ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Decide whether a trailing role-title suffix is a location/remote tag.
 *
 * Only known remote/location suffixes are stripped. Seniority, discipline, team,
 * and product qualifiers are intentionally preserved so distinct role variants
 * do not collapse to the same scanner dedupe key.
 *
 * @param {unknown} tag - Text from a trailing parenthetical or bracket suffix.
 * @returns {boolean} True when the suffix is safe to remove for dedupe.
 */
function isRoleLocationSuffix(tag) {
  const normalized = normalizeRoleSuffixTag(tag);
  if (!normalized) return false;
  if (ROLE_LOCATION_SUFFIXES.has(normalized)) return true;

  const raw = String(tag ?? '').toLowerCase();
  const parts = raw
    .split(/[,/|;]+|\s+(?:and|or)\s+/g)
    .map(normalizeRoleSuffixTag)
    .filter(Boolean);
  if (parts.length > 1 && parts.every(part => ROLE_LOCATION_SUFFIXES.has(part))) return true;

  for (const remote of ROLE_REMOTE_SUFFIXES) {
    const prefix = `${remote} `;
    if (normalized.startsWith(prefix) && ROLE_LOCATION_SUFFIXES.has(normalized.slice(prefix.length))) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize a role title for stable scan-time duplicate identity.
 *
 * Equivalent tracker/provider titles should collapse to one key when a company
 * splits a role per location with a trailing tag like "(Berlin)". Requisition
 * IDs live in URLs rather than titles, so this identity remains URL-agnostic.
 *
 * The normalizer lowercases the title, strips trailing location/remote
 * parenthetical/bracketed tags such as "(Berlin)" and "[Remote]", then
 * collapses punctuation and whitespace so em dash vs hyphen or double spaces do
 * not split a key.
 *
 * This helper does not infer posting churn or detect repost clusters. Those
 * post-tracking facts remain the responsibility of detect-reposts.mjs and the
 * company-history `postingChurn` axis.
 *
 * @param {unknown} role - Raw role title from a tracker row or provider job.
 * @returns {string} Normalized role key.
 */
export function normalizeRoleForDedup(role) {
  let title = String(role ?? '').toLowerCase();
  while (true) {
    const match = title.match(/\s*[\[(]([^[\]()]+)[\])]\s*$/);
    if (!match || !isRoleLocationSuffix(match[1])) break;
    title = title.slice(0, match.index).trimEnd();
  }
  return title.replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Build the canonical company+role dedupe key.
 *
 * This shared helper is used by both the tracker-side load and the scan-side
 * check so those two code paths cannot drift. `canonicalize` defaults to plain
 * lowercase/trim behavior when no alias map is configured.
 *
 * @param {unknown} company - Raw company label.
 * @param {unknown} role - Raw role title.
 * @param {(name: unknown) => string} [canonicalize] - Company canonicalizer.
 * @returns {string} Stable dedupe key in `company::role` form.
 */
export function companyRoleDedupKey(company, role, canonicalize = defaultCompanyNormalizer) {
  return `${canonicalize(company)}::${normalizeRoleForDedup(role)}`;
}

/**
 * Build the seen-role set from the same three sources as `loadSeenUrls`.
 *
 * Existing rows are canonicalized with the same company aliasing and role-title
 * normalization used for freshly scanned jobs. That lets URL-new duplicates match
 * older entries instead of being evaluated again.
 *
 * Seeding from applications.md alone made the key effectively intra-run: a role
 * added by a prior scan lives in scan-history and pipeline, and does not reach
 * applications.md until the user evaluates and applies. Companies that open one req
 * per city therefore leaked one city variant per scan — run 1 added the SF req
 * (marking the key in memory only), run 2 re-seeded from applications.md, found the
 * key absent, and the NY req cleared both the URL check and the role check.
 *
 * Two deliberate semantics on the scan-history source:
 *
 * - Only `added` rows seed a key. `skipped_expired` / `skipped_invalid_url` /
 *   `skipped_blocked_host` are URL-level failures, not evidence the role was
 *   surfaced; seeding from them would let a dead SF URL bury a live NY req. Because
 *   an expired posting is recorded as `skipped_expired` rather than `added`, this
 *   self-heals: when the canonical posting dies, its city variants become eligible
 *   again on the next scan.
 * - Seeding honours `scan_history.recheck_after_days` via the existing
 *   `shouldDedupScanHistoryRow` predicate, so the role key cannot outlive the URL
 *   key it mirrors.
 *
 * @param {{applicationsText?: string, scanHistoryText?: string, pipelineText?: string}} sources
 *   Raw text of each dedupe source; absent sources default to empty.
 * @param {{recheckAfterDays?: number|null, today?: string}} [policy] - Scan-history
 *   recheck policy, shared with `loadSeenUrls`.
 * @param {(name: unknown) => string} [canonicalize=defaultCompanyNormalizer] -
 *   Company canonicalizer shared with scan-side dedupe.
 * @returns {Set<string>} Existing company+role dedupe keys.
 */
export function collectSeenCompanyRoles(sources = {}, policy = {}, canonicalize = defaultCompanyNormalizer) {
  const { applicationsText = '', scanHistoryText = '', pipelineText = '' } = sources;
  const seen = new Set();
  const add = (company, role) => {
    const c = String(company ?? '').trim();
    const r = String(role ?? '').trim();
    if (!c || !r) return;
    // Header and markdown-separator cells are not roles.
    if (c.toLowerCase() === 'company') return;
    if (/^[-:]+$/.test(c) || /^[-:]+$/.test(r)) return;
    seen.add(companyRoleDedupKey(c, r, canonicalize));
  };

  // applications.md — header-aware parse (tracker-parse.mjs, #954). The old
  // positional regex captured the wrong cells on customized layouts (e.g. with a
  // Location column), so the seen-set keyed on garbage and dedup misfired.
  if (applicationsText) {
    const lines = applicationsText.split('\n');
    const colmap = resolveColumns(lines);
    for (const line of lines) {
      const row = parseTrackerRow(line, colmap);
      if (!row) continue;
      add(row.company, row.role);
    }
  }

  // scan-history.tsv — url, first_seen, portal, title, company, status, location
  for (const line of scanHistoryText.split('\n').slice(1)) { // skip header
    const [url, firstSeen, , title, company, status = 'added'] = line.split('\t');
    if (!url) continue;
    if (status !== 'added') continue;
    if (!shouldDedupScanHistoryRow({ firstSeen, status }, policy)) continue;
    add(company, title);
  }

  // pipeline.md — "- [ ] {url} | {company} | {title}" plus optional trailing
  // columns (location, compensation, posted:/trust:/note: segments).
  for (const match of pipelineText.matchAll(/^- \[[ x]\]\s+\S+\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*(?:\|[^\n]*)?$/gm)) {
    add(match[1], match[2]);
  }

  return seen;
}

function readIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
}

/**
 * Load company+role keys already surfaced by a prior scan or tracked by the user.
 *
 * Thin filesystem wrapper over {@link collectSeenCompanyRoles}, mirroring the
 * source list `loadSeenUrls` already reads.
 *
 * The two leading positional parameters are unchanged, so existing callers keep
 * working. The extra sources are injectable via the trailing options object: the
 * module-level paths are relative to `process.cwd()`, so a test that passes only a
 * sandbox tracker would otherwise pick up the developer's real scan-history and
 * pipeline (CI only avoids this because those files are gitignored).
 *
 * @param {string} [appsPath=APPLICATIONS_PATH] - Applications tracker path.
 * @param {(name: unknown) => string} [canonicalize=defaultCompanyNormalizer] -
 *   Company canonicalizer shared with scan-side dedupe.
 * @param {object} [options] - Additional sources and policy.
 * @param {{recheckAfterDays?: number|null, today?: string}} [options.policy] -
 *   Scan-history recheck policy, shared with `loadSeenUrls`.
 * @param {string} [options.scanHistoryPath=SCAN_HISTORY_PATH] - Scan-history path.
 * @param {string} [options.pipelinePath=PIPELINE_PATH] - Pipeline inbox path.
 * @returns {Set<string>} Existing company+role dedupe keys.
 */
export function loadSeenCompanyRoles(
  appsPath = APPLICATIONS_PATH,
  canonicalize = defaultCompanyNormalizer,
  { policy = {}, scanHistoryPath = SCAN_HISTORY_PATH, pipelinePath = PIPELINE_PATH } = {},
) {
  return collectSeenCompanyRoles({
    applicationsText: readIfExists(appsPath),
    scanHistoryText: readIfExists(scanHistoryPath),
    pipelineText: readIfExists(pipelinePath),
  }, policy, canonicalize);
}

// ── Pipeline writer ─────────────────────────────────────────────────

function normalizeScanScalar(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function normalizeScanUrl(value) {
  return String(value ?? '').trim().split(/\s+/)[0] || '';
}

const MARKDOWN_ESCAPE_CHARS = {
  '\\': '\\\\',
  '[': '\\[',
  ']': '\\]',
};

export function sanitizeMarkdownField(value) {
  return normalizeScanScalar(value)
    .replace(/[\\[\]]/g, char => MARKDOWN_ESCAPE_CHARS[char])
    .replace(/\|/g, '/');
}

function sanitizePipelineUrl(value) {
  return normalizeScanUrl(value)
    .replace(/[\\[\]]/g, char => MARKDOWN_ESCAPE_CHARS[char])
    .replace(/\|/g, '%7C');
}

export function sanitizeTsvField(value) {
  const normalized = normalizeScanScalar(value);
  return /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
}

// Format an offer's parsed compensation (the annualized {min,max,currency} that
// providers like Ashby attach as `offer.salary`) into a compact, sanitized cell
// such as `120000-160000 USD`. Returns '' when there is no usable salary data.
// Non-positive bounds are dropped (a 0 min/max is meaningless comp data, not "$0").
export function formatCompensation(salary) {
  if (!salary || typeof salary !== 'object') return '';
  const num = (n) => (Number.isFinite(n) && n > 0 ? String(Math.round(n)) : null);
  const lo = num(salary.min);
  const hi = num(salary.max);
  const range = lo && hi && lo !== hi ? `${lo}-${hi}` : (lo || hi || '');
  if (!range) return '';
  const currency = typeof salary.currency === 'string' ? salary.currency.trim() : '';
  return sanitizeMarkdownField(currency ? `${range} ${currency}` : range);
}

// Trust/legitimacy signal (#1743): the scanner sets offer.trustScore (0-100) +
// offer.trustFlags on every job (see buildTrustValidator). Surface it only when
// it's meaningful — a score below 100 means the validator penalized the posting
// (e.g. missing_apply_url, invalid_url, suspicious_domain). A clean posting
// (score 100) or a scan without trust_filter configured stays byte-identical
// (empty), exactly like the posted:/note: segments.
export function trustIsFlagged(offer) {
  return typeof offer.trustScore === 'number' && Number.isFinite(offer.trustScore) && offer.trustScore < 100;
}

function trustFlagList(offer) {
  return Array.isArray(offer.trustFlags)
    ? offer.trustFlags.filter((f) => typeof f === 'string' && f.trim())
    : [];
}

// Labeled pipeline segment, e.g. `trust: 60 missing_apply_url,suspicious_domain`.
// '' when the posting isn't flagged, so an unflagged offer produces no segment.
export function formatTrustSegment(offer) {
  if (!trustIsFlagged(offer)) return '';
  const flags = trustFlagList(offer);
  const body = flags.length ? `${offer.trustScore} ${flags.join(',')}` : String(offer.trustScore);
  return sanitizeMarkdownField(`trust: ${body}`);
}

export function formatPipelineOffer(offer) {
  const url = sanitizePipelineUrl(offer.url);
  const company = sanitizeMarkdownField(offer.company);
  const title = sanitizeMarkdownField(offer.title);
  // Optional trailing columns, each sanitized like every other field:
  //   4th = location, 5th = compensation.
  // Gate location on an actual string so malformed provider data (a number or
  // object) degrades to the 3-column form instead of stringifying into a
  // spurious column. The columns are positional, so a present compensation
  // forces the (possibly empty) location cell to keep comp in column 5.
  // loadSeenUrls dedups on the URL and ignores trailing columns (backward-compatible).
  const location = typeof offer.location === 'string' ? sanitizeMarkdownField(offer.location) : '';
  const compensation = formatCompensation(offer.salary);
  const base = `- [ ] ${url} | ${company} | ${title}`;
  let line = base;
  if (compensation) line = `${base} | ${location} | ${compensation}`;
  else if (location) line = `${base} | ${location}`;
  // Optional labeled posting-date segment (like note:) — keeps the positional
  // 1/3/4/5-column contract in modes/pipeline.md intact.
  const posted = postedAtIsoDate(offer.postedAt);
  if (posted) line = `${line} | posted: ${posted}`;
  // Labeled trust/legitimacy segment (#1743) — rides like posted:/note:, emitted
  // only when the scanner flagged the posting (score < 100). Ordered after
  // posted:, before note:, for a stable serialization.
  const trust = formatTrustSegment(offer);
  if (trust) line = `${line} | ${trust}`;
  // Optional free-text ranking signal (e.g. a curated-list flag an importer
  // attaches). Labeled — not positional like location/compensation — so it can
  // ride on any row shape (bare URL, 3-, 4-, or 5-column) without a reader
  // confusing it for a positional cell, and it stays generic: nothing here is
  // source-specific, and an offer without `note` produces byte-identical output.
  const note = typeof offer.note === 'string' ? sanitizeMarkdownField(offer.note) : '';
  return note ? `${line} | note: ${note}` : line;
}

// postedAt arrives as epoch ms (or absent). Convert to 'YYYY-MM-DD', or '' when missing.
function postedAtIsoDate(postedAt) {
  if (typeof postedAt !== 'number' || !Number.isFinite(postedAt) || postedAt <= 0) return '';
  return new Date(postedAt).toISOString().slice(0, 10);
}
export function formatScanHistoryRow(offer, date, status = 'added') {
  return [
    normalizeScanUrl(offer.url),
    date,
    offer.source,
    offer.title,
    offer.company,
    status,
    offer.location || '',
    // JD-content fingerprint (#1597): 16 hex chars when the provider's list
    // API shipped a usable description, '' otherwise. Lets later scans flag
    // the same body re-posted under a different company (agency cross-listing)
    // without storing the body. All readers tolerate the extra column.
    offer.fingerprint ?? fingerprintText(offer.description),
    // New trailing column: posting date. Existing readers index by position up to
    // col 7, so appending col 8 is backward-compatible.
    postedAtIsoDate(offer.postedAt),
    // Trust/legitimacy signal (#1743): score (only when the scanner flagged the
    // posting, i.e. < 100) + comma-joined flags. Trailing cols 9-10, so existing
    // index-based readers (fingerprint@7, postedAt@8) are unaffected; a clean
    // posting or a scan without trust_filter leaves both empty.
    trustIsFlagged(offer) ? String(offer.trustScore) : '',
    trustIsFlagged(offer) ? trustFlagList(offer).join(',') : '',
    // Normalized company key (#2093): the canonical company form shared across
    // the tracker (normalizeCompanyName — lowercased, punctuation/whitespace
    // folded, trailing legal-entity suffixes stripped) so "Acme Inc.",
    // "Acme, Inc." and "ACME  Inc" all key to `acme`. Stored at write time so
    // repost/name-matching never has to route through executing a script, and
    // the raw display company in col 5 stays faithful to what the provider
    // returned. Trailing col 12 — purely additive: index-based readers
    // (fingerprint@7, postedAt@8, trust@9-10, and the web parser's first 7
    // cols) are unaffected, and older rows that lack it are tolerated by
    // consumers normalizing the raw name on the fly.
    normalizeCompanyName(offer.company || ''),
  ].map(sanitizeTsvField).join('\t');
}

/**
 * Read scan-history.tsv rows that carry a fingerprint, for the cross-listing
 * check. Older rows without the 8th column simply never match.
 *
 * @param {string} [historyPath] - Override for tests.
 * @returns {Array<{url: string, dateStr: string, company: string, title: string, fingerprint: string}>}
 */
export function loadFingerprintHistory(historyPath = SCAN_HISTORY_PATH) {
  if (!existsSync(historyPath)) return [];
  const rows = [];
  for (const line of readFileSync(historyPath, 'utf-8').split('\n')) {
    const cols = line.split('\t');
    // Skip the header row. Older 7-col headers fall out of the `cols.length < 8`
    // guard below on their own, but the 12-col header names col 7 `fingerprint`
    // (non-empty), so it would otherwise pass that guard and be read as data.
    // Real rows always carry a URL in col 0, never the literal `url`.
    if (cols[0] === 'url') continue;
    if (cols.length < 8 || !cols[7].trim()) continue;
    rows.push({
      url: (cols[0] || '').trim(),
      dateStr: (cols[1] || '').trim(),
      title: (cols[3] || '').trim(),
      company: (cols[4] || '').trim(),
      fingerprint: cols[7].trim(),
    });
  }
  return rows;
}

// Standard skeleton created on fresh install — matches the format documented
// in modes/pipeline.md and expected by /career-ops pipeline.
const PIPELINE_SKELETON = `# Pipeline — Pending URLs

Paste job URLs below as \`- [ ] {url}\` then run \`/career-ops pipeline\`.

## Pending

## Processed
`;

// Current section names (English). Legacy Spanish names are checked as fallback
// so existing pipeline.md files created before this change keep working.
const PENDING_MARKERS = ['## Pending', '## Pendientes'];
const PROCESSED_MARKERS = ['## Processed', '## Procesadas'];

// Locked (pipeline-lock.mjs) so scan.mjs, scan-ats-full.mjs, and plugins.mjs
// (pipeline mode) — the three current callers — can never interleave their
// read-modify-write and silently drop each other's offers.
export async function appendToPipeline(offers) {
  if (offers.length === 0) return;

  await withPipelineLock(PIPELINE_PATH, async () => {
    // Auto-create with standard skeleton if missing (fresh-install guard).
    if (!existsSync(PIPELINE_PATH)) {
      writeFileSync(PIPELINE_PATH, PIPELINE_SKELETON, 'utf-8');
    }

    let text = readFileSync(PIPELINE_PATH, 'utf-8');

    const marker = PENDING_MARKERS.find(m => text.includes(m)) ?? null;
    const idx = marker !== null ? text.indexOf(marker) : -1;

    if (idx === -1) {
      // No Pending section found — insert one before Processed (or at end)
      const procIdx = PROCESSED_MARKERS.reduce((found, m) => {
        const i = text.indexOf(m);
        return (found === -1 || (i !== -1 && i < found)) ? i : found;
      }, -1);
      const insertAt = procIdx === -1 ? text.length : procIdx;
      const block = `\n## Pending\n\n` + offers.map(formatPipelineOffer).join('\n') + '\n\n';
      text = text.slice(0, insertAt) + block + text.slice(insertAt);
    } else {
      // Find the end of existing Pending content (next ## or end)
      const afterMarker = idx + marker.length;
      const nextSection = text.indexOf('\n## ', afterMarker);
      const insertAt = nextSection === -1 ? text.length : nextSection;

      const block = '\n' + offers.map(formatPipelineOffer).join('\n') + '\n';
      text = text.slice(0, insertAt) + block + text.slice(insertAt);
    }

    writeFileSync(PIPELINE_PATH, text, 'utf-8');
  });
}

export function appendToScanHistory(offers, date, status = 'added') {
  // Ensure file + header exist. The header names every column the row writer
  // (formatScanHistoryRow) emits, in the same order: the original 7 positional
  // cols (url…location) plus the append-only trailing cols added since —
  // fingerprint (7), posted_at (8), trust_score (9), trust_flags (10),
  // normalized_company (11). Written ONLY on fresh-file creation; existing files
  // (including headerless legacy files and older 7-col-header files) are never
  // rewritten. All readers either skip line 0 unconditionally, detect the header
  // by its `url\t` prefix, or skip non-URL col-0 rows, so widening it stays
  // backward-compatible. `status` is parameterized so callers can record verify
  // outcomes (`skipped_expired`, etc.) without the legacy `(expired)` suffix.
  if (!existsSync(SCAN_HISTORY_PATH)) {
    mkdirSync(path.dirname(SCAN_HISTORY_PATH), { recursive: true });
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company\n', 'utf-8');
  }

  const lines = offers.map(o => formatScanHistoryRow(o, date, status)).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Company blacklist (#1742) ───────────────────────────────────────

const BLACKLIST_PATH = 'data/blacklist.md';

/**
 * Parse the user's do-not-apply list (data/blacklist.md, user layer, opt-in).
 *
 * The file is a small markdown table the user owns:
 * `| Company | Since | Scope | Reason |`. Nothing here ever creates or writes
 * it — an absent file means no filtering. Companies are keyed with the same
 * normalization every tracker writer shares (normalizeCompany, #1460), so a
 * blacklist row "Acme Corp." still catches an ATS feed that says "acme corp".
 *
 * @param {string} text - Raw data/blacklist.md content.
 * @returns {Map<string, {company: string, since: string, scope: string, reason: string}>}
 *          Normalized company key → entry. First row wins on duplicate keys.
 */
export function parseBlacklist(text) {
  const entries = new Map();
  for (const line of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map(s => s.trim());
    const company = cells[1] || '';
    if (!company || /^[-: ]+$/.test(company)) continue; // separator row
    if (company.toLowerCase() === 'company') continue;  // header row
    const key = normalizeCompany(company);
    if (!key || entries.has(key)) continue;
    entries.set(key, {
      company,
      since: cells[2] || '',
      scope: cells[3] || '',
      reason: cells[4] || '',
    });
  }
  return entries;
}

/**
 * Load data/blacklist.md if the user opted in. Absent file = empty Map = no
 * filtering anywhere — the scan stays byte-identical to a pre-#1742 run.
 *
 * @param {string} [filePath] - Override for tests.
 * @returns {Map<string, {company: string, since: string, scope: string, reason: string}>}
 */
export function loadBlacklist(filePath = BLACKLIST_PATH) {
  if (!existsSync(filePath)) return new Map();
  return parseBlacklist(readFileSync(filePath, 'utf-8'));
}

// ── Scan-run persistence (#1604) ────────────────────────────────────

const SCAN_RUNS_PATH = 'data/scan-runs.tsv';

// One row of run counters per non-dry scan — today these numbers are printed
// once in the summary and lost when the terminal scrolls. Full ISO timestamp
// (two scans in one day must not collapse). `status` is reserved: always
// 'completed' in v1; a follow-up wires failure-path writes so trend stats can
// exclude survivorship bias. Consumers MUST parse by header name, never by
// position — columns may be appended in later versions.
export const SCAN_RUNS_HEADER = 'timestamp\tstatus\tcompanies\tboards\tfound\tfiltered_title\tfiltered_tier\tfiltered_location\tfiltered_posting_age\tfiltered_salary\tfiltered_content\tfiltered_cooldown\tdupes\tnew_added\terrors\tfiltered_blacklist\tfiltered_visa\tfiltered_posted_date\tfiltered_country_eligibility\n';

export function appendScanRunSummary(c, filePath = SCAN_RUNS_PATH) {
  if (!existsSync(filePath)) writeFileSync(filePath, SCAN_RUNS_HEADER, 'utf-8');
  const row = [
    c.timestamp, c.status ?? 'completed', c.companies, c.boards, c.found,
    c.filteredTitle, c.filteredTier, c.filteredLocation, c.filteredPostingAge,
    c.filteredSalary, c.filteredContent, c.filteredCooldown, c.dupes, c.newAdded, c.errors,
    // filtered_blacklist (#1742) appended at the END, per the header-name
    // contract above: files created with an older header keep parsing (the
    // extra trailing cell is simply not named there).
    c.filteredBlacklist ?? 0,
    // filtered_visa appended at the END for the same reason.
    c.filteredVisa ?? 0,
    // filtered_posted_date appended at the END for the same reason.
    c.filteredPostedDate ?? 0,
    // filtered_country_eligibility (#2093) appended at the END for the same reason.
    c.filteredCountryEligibility ?? 0,
  ].join('\t') + '\n';
  appendFileSync(filePath, row, 'utf-8');
}

// ── Portal health persistence (#1744) ───────────────────────────────

const PORTAL_HEALTH_PATH = 'data/portal-health.tsv';
export const PORTAL_HEALTH_HEADER = 'timestamp\tcompany\tstatus\n';

// Locked (portal-health-lock.mjs) so a concurrent read-modify-write of this
// same file — e.g. tests/portal-health-guard.mjs's regression-cleanup path —
// can never interleave with this append and silently discard one side.
export async function appendPortalHealth(healthRecords, filePath = PORTAL_HEALTH_PATH) {
  await withPortalHealthLock(filePath, async () => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) writeFileSync(filePath, PORTAL_HEALTH_HEADER, 'utf-8');
    let lines = '';
    for (const r of healthRecords) {
      lines += [r.timestamp, r.company, r.status].join('\t') + '\n';
    }
    if (lines) appendFileSync(filePath, lines, 'utf-8');
  });
}

export function loadPortalHealth(filePath = PORTAL_HEALTH_PATH) {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length >= 3) {
      records.push({ timestamp: parts[0], company: parts[1], status: parts[2] });
    }
  }
  return records;
}

export function computeConsecutiveFailures(healthRecords) {
  const streaks = new Map();
  for (const r of healthRecords) {
    // Healthy statuses reset the streak; every other status counts toward it.
    // Inverted (vs. listing failure statuses) so the newer error kinds
    // (auth/server/unknown) can't silently fall outside the streak again.
    // 'empty' is deliberately healthy: a live board with 0 jobs is reachable.
    if (r.status === 'reachable' || r.status === 'empty') {
      streaks.set(r.company, 0);
    } else {
      streaks.set(r.company, (streaks.get(r.company) || 0) + 1);
    }
  }
  return streaks;
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function verifyOffers(offers, { headedFallback = false, throttleBaseMs = 0, rediscover = false } = {}) {
  // Dynamic imports keep the default zero-token path free of Playwright startup
  let chromium;
  let checkUrlLiveness;
  let checkUrlLivenessWithFallback;
  let createHeadedPageProvider;
  let newLivenessPage;
  let jitteredDelayMs;
  let sleep;
  try {
    ({ chromium } = await import('playwright'));
    ({ checkUrlLiveness, checkUrlLivenessWithFallback, createHeadedPageProvider, newLivenessPage, jitteredDelayMs, sleep } = await import('./liveness-browser.mjs'));
  } catch (err) {
    throw new Error(
      `--verify requires Playwright with Chromium (run "npx playwright install chromium"): ${err.message}`,
      { cause: err },
    );
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    throw new Error(
      `--verify could not launch Chromium (run "npx playwright install chromium" or re-run without --verify): ${err.message}`,
      { cause: err },
    );
  }

  // Three permanent buckets + one transient passthrough:
  //   verified  → active pages and transient nav errors (retry next scan)
  //   expired   → classifier-confirmed dead postings (HTTP 4xx, redirect markers,
  //               body patterns, listing pages, insufficient content)
  //   dropped   → page loaded but classifier saw no Apply control. --verify is an
  //               opt-in stricter filter; keeping these defeats the purpose.
  //   invalid   → up-front URL guard rejections (malformed / non-http / private)
  const verified = [];
  const expired = [];
  const dropped = [];
  const invalid = [];
  const migrated = [];

  const headed = headedFallback ? createHeadedPageProvider(chromium) : null;
  const getHeadedPage = headed ? () => headed.get() : undefined;

  try {
    const page = await newLivenessPage(browser);
    // Sequential — project rule: never Playwright in parallel
    for (let i = 0; i < offers.length; i++) {
      const offer = offers[i];
      const { result, code, reason } = headed
        ? await checkUrlLivenessWithFallback(page, offer.url, { getHeadedPage })
        : await checkUrlLiveness(page, offer.url);
      if (result === 'expired') {
        // 404/410 on a tracked company may just be a moved role — run one
        // search + re-verify before giving up (opt-in via --rediscover-404).
        // Only http_gone (HTTP 404/410) qualifies; soft-expiry signals
        // (redirect/body/listing) are real closures, not URL moves.
        if (rediscover && code === 'http_gone' && offer.tracked && offer.careersUrlDomain) {
          const newUrl = await searchForNewUrl(page, offer);
          if (newUrl) {
            // Mirror the primary check: without the headed fallback, a
            // challenge-prone domain would flag the rediscovered URL as
            // expired just because the recheck hit the same anti-bot wall.
            const recheck = headed
              ? await checkUrlLivenessWithFallback(page, newUrl, { getHeadedPage })
              : await checkUrlLiveness(page, newUrl);
            // Require a *confirmed* live page before migrating. A transient
            // 'uncertain' (timeout/DNS/5xx) must not commit an unverified URL —
            // fall through to expired (the original 404/410 is a real closure).
            if (recheck.result === 'active') {
              migrated.push({ ...offer, url: newUrl, previousUrl: offer.url });
              console.log(`  🔄 migrated  ${offer.company} | ${offer.title} → ${newUrl}`);
              continue;
            }
          }
        }
        expired.push({ ...offer, reason });
        console.log(`  ❌ expired   ${offer.company} | ${offer.title} (${reason})`);
      } else if (result === 'uncertain' && GUARD_CODES.has(code)) {
        // Guard failures are permanent (not transient like a timeout) — record them
        // separately so they don't end up in pipeline.md but DO appear in scan-history
        // with a precise status, dedup-blocking them on subsequent scans.
        invalid.push({ ...offer, code, reason });
        console.log(`  ⛔ invalid   ${offer.company} | ${offer.title} (${reason})`);
      } else if (result === 'uncertain' && code === 'no_apply_control') {
        // Page loaded but classifier could not find an Apply control. Treat like
        // expired for routing — drop from pipeline AND record in scan-history so
        // we don't burn a verify cycle on the same URL next scan.
        dropped.push({ ...offer, reason });
        console.log(`  ⚠️ no-apply  ${offer.company} | ${offer.title} (${reason})`);
      } else {
        // 'active' or 'uncertain' due to navigation_error (transient — retry next scan)
        verified.push(offer);
        const icon = result === 'active' ? '✅' : '⚠️';
        console.log(`  ${icon} ${result.padEnd(9)} ${offer.company} | ${offer.title}`);
      }

      const wait = i < offers.length - 1 ? jitteredDelayMs(throttleBaseMs) : 0;
      if (wait) await sleep(wait);
    }
  } finally {
    if (headed) await headed.close();
    await browser.close();
  }

  return { verified, expired, dropped, invalid, migrated };
}

// Stable codes from liveness-browser's up-front URL guard. Routing dispatches
// on these codes (not on regex over reason strings) so wording can change
// without breaking the pipeline.
const GUARD_CODES = new Set(['invalid_url', 'unsupported_protocol', 'blocked_host']);

// guardStatusFor maps a guard code to the canonical scan-history status string.
function guardStatusFor(code) {
  if (code === 'blocked_host') return 'skipped_blocked_host';
  // invalid_url and unsupported_protocol both surface as malformed input
  return 'skipped_invalid_url';
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verify = args.includes('--verify');
  // Opt-in: on an anti-bot challenge (e.g. pracuj.pl Cloudflare wall), retry the
  // URL in a headed browser. Off by default — headed Chromium needs a display, so
  // scheduled/unattended scans should not rely on it.
  const headedFallback = args.includes('--headed-fallback');
  // --throttle or --throttle=<ms>: jittered gap between --verify checks to stay
  // under rate-based WAF limits (pracuj.pl flags the session after a few rapid
  // hits). Default base 5000ms. Off by default — most ATS feeds don't need it.
  const throttleArg = args.find((a) => a === '--throttle' || a.startsWith('--throttle='));
  const throttleBaseMs = throttleArg ? (Number(throttleArg.split('=')[1]) || 5000) : 0;
  // --rediscover-404: when a tracked company's URL 404/410s, search for the
  // moved role and re-verify before marking it expired. Opt-in; rides on --verify.
  const rediscover = args.includes('--rediscover-404');
  // --include-blacklisted: bypass the data/blacklist.md filter for auditing.
  // Matching postings flow through annotated instead of being counted out.
  const includeBlacklisted = args.includes('--include-blacklisted');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;
  // --posted-after / --posted-before <YYYY-MM-DD>: absolute-date bounds on the
  // employer's real posting date (job.postedAt), gated against a typo since a
  // silently-ignored bound would look like "no jobs matched" instead of an error.
  const isValidIsoDate = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  const postedAfterFlag = args.indexOf('--posted-after');
  const postedAfter = postedAfterFlag !== -1 ? args[postedAfterFlag + 1] : null;
  const postedBeforeFlag = args.indexOf('--posted-before');
  const postedBefore = postedBeforeFlag !== -1 ? args[postedBeforeFlag + 1] : null;
  if (postedAfter != null && !isValidIsoDate(postedAfter)) {
    console.error(`Error: --posted-after expects YYYY-MM-DD, got "${postedAfter}"`);
    process.exit(1);
  }
  if (postedBefore != null && !isValidIsoDate(postedBefore)) {
    console.error(`Error: --posted-before expects YYYY-MM-DD, got "${postedBefore}"`);
    process.exit(1);
  }

  // --since <days>: a RELATIVE lower bound on the employer's posting date —
  // the same thing --posted-after expresses absolutely, and it filters exactly
  // like it does. Matches scan-ats-full.mjs, which has always treated --since
  // as a filter; one flag name should not mean two different things.
  //
  // It additionally unlocks an optimisation. providers/workday.mjs returns
  // postings newest-first and can stop paginating once a page is entirely past
  // the window, but that only fires when ctx carries sinceMs — and scan.mjs
  // built a bare makeHttpCtx(), so every Workday tenant paginated to its
  // max_pages cap on every run however stale the deep pages were.
  //
  // Flag presence, operand validity, duplicate occurrences and the
  // out-of-Date-range case are all handled by the SHARED parseSinceDays(), so
  // scan-ats-full.mjs cannot disagree about what --since means (#2498).
  const since = parseSinceDays(args);
  if (since.error) {
    console.error(`Error: ${since.error}`);
    process.exit(1);
  }
  const sinceDays = since.days;

  const effectiveAfter = resolveEffectiveAfter(postedAfter, sinceDays);

  // 1. Load providers
  const providers = await loadProviders(PROVIDERS_DIR);
  // Opt-in: merge enabled keyed/auth-gated provider plugins. Returns immediately
  // (no discovery, no dotenv, no process.env mutation) when config/plugins.yml is
  // absent — so a plain scan with no plugins configured stays byte-identical.
  await mergeProviderPlugins(providers, { root: path.dirname(PROVIDERS_DIR) });
  if (providers.size === 0) {
    console.error('Error: no providers loaded from providers/');
    process.exit(1);
  }

  // 2. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  let rawConfig;
  try {
    rawConfig = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  } catch (err) {
    console.error(`Error: failed to parse ${PORTALS_PATH}: ${err.message}`);
    process.exit(1);
  }
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const companies = Array.isArray(config.tracked_companies) ? config.tracked_companies : [];
  const boards = Array.isArray(config.job_boards) ? config.job_boards : [];
  const titleFilter = buildTitleFilter(config.title_filter);

  // Seniority tier classifier integration
  let classifyTier = null;
  const skipTiers = Array.isArray(config.skip_tiers)
    ? config.skip_tiers.filter(t => typeof t === 'string').map(t => t.toLowerCase())
    : [];
  if (skipTiers.length > 0) {
    const mod = await import('./classify-tier.mjs');
    classifyTier = mod.classifyTier || mod.default;
  }

  const locationFilter = buildLocationFilter(config.location_filter);
  const postingAgeFilter = buildPostingAgeFilter(config.max_posting_age_days);
  const postedDateFilter = buildPostedDateFilter(effectiveAfter, postedBefore);

  // Same bound the filter above uses, widened by max_posting_age_days when set.
  // Derived by the same helper so the hint and the filter cannot disagree.
  const earlyStopSinceMs = resolveEarlyStopMs(effectiveAfter, config.max_posting_age_days);
  const salaryFilter = buildSalaryFilter(config.salary_filter);
  const trustValidator = buildTrustValidator(config.trust_filter);
  const contentFilter = buildContentFilter(config.content_filter);
  const candidateCountry = loadCandidateCountry();
  const countryEligibilityFilter = buildCountryEligibilityFilter(config.country_eligibility_filter, candidateCountry);
  const visaFilter = buildVisaFilter(config.visa_filter);
  const visaEnabled = Boolean(config.visa_filter) && config.visa_filter.enabled !== false;

  // 3. Resolve a provider for each enabled company / board
  const targets = [];
  let skippedCount = 0;
  let boardCount = 0;
  const resolveErrors = [];
  const agentHandoff = [];

  /**
   * Processes a list of configuration entries, resolves their appropriate data providers,
   * and appends valid entries to the global scanning targets list.
   * @param {Array<{ name?: string, enabled?: boolean, [key: string]: unknown }>} entries - List of entries.
   * @param {{ isBoard?: boolean }} [options={}] - Configuration options.
   */
  function resolveEntries(entries, { isBoard = false } = {}) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.enabled === false) continue;
      if (typeof entry.name !== 'string' || !entry.name.trim()) {
        console.error(`⚠️  Skipping entry — missing or non-string 'name' field: ${JSON.stringify(entry)}`);
        continue;
      }
      if (filterCompany && !entry.name.toLowerCase().includes(filterCompany)) continue;

      const resolved = resolveProvider(entry, providers);
      if (!resolved) {
        skippedCount++;
        if (entry.scan_method === 'websearch') {
          agentHandoff.push({
            company: entry.name,
            method: 'websearch',
            query: entry.scan_query || entry.search_query || entry.careers_url || '',
          });
        }
        continue;
      }

      if (resolved.error) {
        resolveErrors.push({ company: entry.name, error: resolved.error });
        continue;
      }

      targets.push({ ...entry, _provider: resolved.provider, _isBoard: isBoard });
      if (isBoard) boardCount++;
    }
  }

  resolveEntries(companies);
  resolveEntries(boards, { isBoard: true });

  const localParserCount = targets.filter(t => t._provider.id === 'local-parser').length;
  const companyCount = targets.length - boardCount;
  const parts = [`${companyCount} companies`];
  if (boardCount > 0) parts.push(`${boardCount} job boards`);
  parts.push(`${localParserCount} local parser`);
  parts.push(`${skippedCount} skipped — no provider matched`);
  console.log(`Scanning ${parts.join('; ')} via providers`);
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3.5. Load the user's do-not-apply list (#1742). Opt-in: absent file =
  // empty Map = the filter below never fires.
  const blacklist = loadBlacklist();

  // 4. Load dedup sets
  const historyPolicy = scanHistoryPolicy(config);
  const seenUrlState = loadSeenUrls(historyPolicy);
  const seenUrls = seenUrlState.seen;
  const canonicalizeCompany = buildCompanyCanonicalizer(config.company_aliases);
  const seenCompanyRoles = loadSeenCompanyRoles(APPLICATIONS_PATH, canonicalizeCompany, { policy: historyPolicy });

  // 5. Fetch from each target
  const date = new Date().toISOString().slice(0, 10);
  const windows = loadReApplyWindows();
  const cooldownFilter = buildCooldownFilter(windows, date);
  let totalFilteredCooldown = 0;
  const cooldownOffers = [];
  let totalFound = 0;
  let totalFilteredTitle = 0;
  let totalFilteredTier = 0;
  let totalFilteredLocation = 0;
  let totalFilteredPostingAge = 0;
  let totalFilteredPostedDate = 0;
  let totalFilteredSalary = 0;
  let totalFilteredContent = 0;
  let totalFilteredCountryEligibility = 0;
  let totalFilteredBlacklist = 0;
  let annotatedBlacklisted = 0;
  let totalFilteredVisa = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [...resolveErrors];
  const emptyTargets = [];

  const tasks = targets.map(company => async () => {
    let provider = company._provider;
    // includeUndated is deliberately ALWAYS true, independent of the window.
    // It does not mean "include undated postings in the results" — scan.mjs
    // already decides that downstream, where buildPostedDateFilter passes a
    // posting with no parseable date. It means "provider, do not pre-empt that
    // decision": without it, workday.mjs's no-date-skip returns page 0 only for
    // any tenant whose CXS payload omits postedOn entirely, silently dropping
    // postings this scanner would have kept.
    //
    // It covers the all-undated tenant, not the mixed one. workday.mjs's
    // pageIsPastWindow reads dated postings only, so on a page mixing stale
    // dated postings with undated ones the early-stop still fires and undated
    // postings on later pages go unfetched. Documented in modes/scan.md; the
    // fix belongs in workday.mjs, where closing it costs the optimisation on
    // every tenant that mixes.
    const ctx = { ...makeHttpCtx(), sinceMs: earlyStopSinceMs, includeUndated: true };
    let sourceName = provider.id === 'local-parser' ? 'local-parser' : `${provider.id}-api`;
    try {
      let jobs;
      try {
        jobs = await provider.fetch(company, ctx);
      } catch (parserErr) {
        if (provider.id !== 'local-parser') throw parserErr;
        const fallback = resolveProvider(company, providers, { skipIds: ['local-parser'] });
        if (!fallback || fallback.error) throw parserErr;
        provider = fallback.provider;
        sourceName = `${provider.id}-api`;
        jobs = await provider.fetch(company, ctx);
        errors.push({
          company: company.name,
          error: `local parser failed, used API fallback: ${parserErr.message}`,
        });
      }
      if (!Array.isArray(jobs)) {
        throw new Error(`${provider.id}: fetch() did not return an array`);
      }
      totalFound += jobs.length;
      if (!company._isBoard && jobs.length === 0) {
        emptyTargets.push(company.name);
      }

      for (const job of jobs) {
        // Trust enrichment — runs before filters, never drops
        const trustResult = trustValidator(job);
        job.trustScore = trustResult.score;
        job.trustFlags = trustResult.flags;
        job.trustLevel = trustResult.level;

        // Company blacklist (#1742) — the user's own do-not-apply decision,
        // checked first: it's company-level, not a per-posting signal. Never
        // silent: skips are counted and reported in the run summary, and
        // --include-blacklisted lets the posting through annotated instead.
        if (blacklist.size > 0) {
          const blEntry = blacklist.get(normalizeCompany(job.company || company.name || ''));
          if (blEntry) {
            if (!includeBlacklisted) {
              totalFilteredBlacklist++;
              continue;
            }
            annotatedBlacklisted++;
            job.blacklisted = true;
            const label = `blacklisted${blEntry.reason ? `: ${blEntry.reason}` : ''}`;
            job.note = typeof job.note === 'string' && job.note.trim()
              ? `${label} — ${job.note}`
              : label;
          }
        }

        if (!titleFilter(job.title)) {
          totalFilteredTitle++;
          continue;
        }
        if (classifyTier && skipTiers.includes(classifyTier(job.title))) {
          totalFilteredTier++;
          continue;
        }
        // job.title is passed so a role whose remoteness is stated in the title
        // ("Program Manager - Remote") isn't rejected for a city-only location.
        if (!locationFilter(job.location, job.url, job.title)) {
          totalFilteredLocation++;
          continue;
        }
        if (!postingAgeFilter(job.postedAt)) {
          totalFilteredPostingAge++;
          continue;
        }
        if (!postedDateFilter(job.postedAt)) {
          totalFilteredPostedDate++;
          continue;
        }
        if (!salaryFilter(job.salary)) {
          totalFilteredSalary++;
          continue;
        }
        if (!contentFilter(job.description, matchedTitleKeywords(job.title, config.title_filter))) {
          totalFilteredContent++;
          continue;
        }
        if (!countryEligibilityFilter(job.description)) {
          totalFilteredCountryEligibility++;
          continue;
        }
        if (!visaFilter(job.description)) {
          totalFilteredVisa++;
          continue;
        }
        const dedupUrl = normalizeUrlForDedup(job.url);
        if (seenUrls.has(dedupUrl)) {
          totalDupes++;
          continue;
        }
        const key = companyRoleDedupKey(job.company, job.title, canonicalizeCompany);
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        const cooldownResult = cooldownFilter(job);
        if (cooldownResult.skip) {
          totalFilteredCooldown++;
          cooldownOffers.push({
            job: { ...job, source: sourceName },
            status: cooldownResult.reason,
          });
          continue;
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(dedupUrl);
        seenCompanyRoles.add(key);
        // Tag with the company's careers domain so verify can offer a 404/410
        // rediscovery fallback. A null domain (no careers_url) marks the offer
        // as broad-discovery — ineligible for the fallback, per the issue scope.
        const careersUrlDomain = extractCareersUrlDomain(company.careers_url);
        newOffers.push({
          ...job,
          source: sourceName,
          tracked: Boolean(careersUrlDomain),
          careersUrlDomain,
        });
      }
    } catch (err) {
      errors.push({
        company: company.name,
        error: err.message,
        kind: classifyFetchError(err),
      });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // 5.5. Optional liveness verification — drop expired and guard-rejected postings
  let verifiedOffers = newOffers;
  let expiredOffers = [];
  let droppedOffers = [];
  let invalidOffers = [];
  let migratedOffers = [];
  if (verify && newOffers.length > 0) {
    console.log(`\nVerifying liveness of ${newOffers.length} new offer(s) with Playwright (sequential)...`);
    const result = await verifyOffers(newOffers, { headedFallback, throttleBaseMs, rediscover });
    verifiedOffers = result.verified;
    expiredOffers = result.expired;
    droppedOffers = result.dropped;
    invalidOffers = result.invalid;
    migratedOffers = result.migrated;
    // Migrated offers re-enter the pipeline at their newly discovered URL.
    if (migratedOffers.length > 0) {
      verifiedOffers = [...verifiedOffers, ...migratedOffers];
    }
  }

  // 5.7. Cross-listing check (#1597): fingerprint each new offer's JD body and
  // compare against recent history rows from a DIFFERENT company — the same
  // requirements text under two names is usually an agency re-post of a direct
  // listing (or vice versa), which URL and company+role dedup both miss.
  // Fingerprints are computed once here and reused by appendToScanHistory.
  for (const offer of verifiedOffers) {
    offer.fingerprint = fingerprintText(offer.description);
  }
  const crossListings = findCrossListings(verifiedOffers, loadFingerprintHistory());

  // 6. Write results
  if (!dryRun && verifiedOffers.length > 0) {
    await appendToPipeline(verifiedOffers);
    appendToScanHistory(verifiedOffers, date);
  }
  if (!dryRun && cooldownOffers.length > 0) {
    const cooldownGroups = {};
    for (const item of cooldownOffers) {
      if (!cooldownGroups[item.status]) {
        cooldownGroups[item.status] = [];
      }
      cooldownGroups[item.status].push(item.job);
    }
    for (const [status, group] of Object.entries(cooldownGroups)) {
      appendToScanHistory(group, date, status);
    }
  }
  // Expired postings — plus the old URLs of migrated offers — are recorded as
  // skipped_expired so subsequent scans dedup-skip the dead URLs.
  const expiredForHistory = [
    ...expiredOffers,
    ...migratedOffers.map(o => ({ ...o, url: o.previousUrl })),
  ];
  if (!dryRun && expiredForHistory.length > 0) {
    appendToScanHistory(expiredForHistory, date, 'skipped_expired');
  }
  // Pages that loaded but had no Apply control: record so we don't re-verify
  // them next scan, but never let them reach pipeline.md.
  if (!dryRun && droppedOffers.length > 0) {
    appendToScanHistory(droppedOffers, date, 'skipped_no_apply_control');
  }
  // Guard-rejected URLs (invalid / unsupported protocol / blocked host) are
  // recorded with a precise status so subsequent scans dedup-skip them via
  // loadSeenUrls, but they never reach pipeline.md.
  if (!dryRun && invalidOffers.length > 0) {
    // Group by code so the TSV reflects the actual reason category.
    const byStatus = new Map();
    for (const o of invalidOffers) {
      const status = guardStatusFor(o.code);
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status).push(o);
    }
    for (const [status, group] of byStatus) {
      appendToScanHistory(group, date, status);
    }
  }

  // 7. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  const summaryCompanies = targets.filter(t => !t._isBoard).length;
  const summaryBoards = targets.filter(t => t._isBoard).length;
  console.log(`Companies scanned:     ${summaryCompanies}`);
  if (summaryBoards > 0) console.log(`Job boards scanned:    ${summaryBoards}`);
  console.log(`Total jobs found:      ${totalFound}`);
  if (config.title_filter || totalFilteredTitle > 0) {
    console.log(`Filtered by title:     ${totalFilteredTitle} removed`);
  }
  if (skipTiers.length > 0) {
    console.log(`Filtered by tier:      ${totalFilteredTier} removed`);
  }
  if (config.location_filter || totalFilteredLocation > 0) {
    console.log(`Filtered by location:  ${totalFilteredLocation} removed`);
  }
  if (config.max_posting_age_days != null || totalFilteredPostingAge > 0) {
    console.log(`Filtered by age:       ${totalFilteredPostingAge} removed`);
  }
  // effectiveAfter, not postedAfter — --since sets a lower bound too, and a
  // scan that filtered by date should say so regardless of which flag set it.
  if (effectiveAfter || postedBefore) {
    console.log(`Filtered by posted date: ${totalFilteredPostedDate} removed`);
  }
  if (config.salary_filter || totalFilteredSalary > 0) {
    console.log(`Filtered by salary:    ${totalFilteredSalary} removed`);
  }
  if (config.content_filter || totalFilteredContent > 0) {
    console.log(`Filtered by content:   ${totalFilteredContent} removed`);
  }
  if (config.country_eligibility_filter || totalFilteredCountryEligibility > 0) {
    console.log(`Filtered by country eligibility: ${totalFilteredCountryEligibility} removed`);
  }
  if (visaEnabled) {
    console.log(`Filtered by visa:      ${totalFilteredVisa} removed`);
  }
  if (Object.keys(windows).length > 0 || totalFilteredCooldown > 0) {
    console.log(`Filtered by cooldown:  ${totalFilteredCooldown} removed`);
  }
  console.log(`Duplicates:            ${totalDupes} skipped`);
  if (blacklist.size > 0) {
    if (includeBlacklisted) {
      console.log(`Blacklisted:           ${annotatedBlacklisted} let through annotated (--include-blacklisted)`);
    } else {
      console.log(`Blacklisted:           ${totalFilteredBlacklist} skipped (blacklist)`);
    }
  }
  if (crossListings.length > 0) {
    console.log(`\n⚠️  Possible cross-listings (same JD text, different company) — warn only, nothing was dropped:`);
    for (const { offer, row, score } of crossListings) {
      console.log(`  - ${offer.company} — ${offer.title}`);
      console.log(`    ≈ ${Math.round(score * 100)}% of ${row.company} — ${row.title} (seen ${row.dateStr})`);
      console.log(`    ${offer.url}`);
      console.log(`    vs ${row.url}`);
    }
    console.log(`  If one side is an agency, apply through ONE channel only — a double submission burns both (#1596).`);
  }
  if (historyPolicy.recheckAfterDays != null) {
    console.log(`Recheck eligible:      ${seenUrlState.recheckEligible} old scan-history URL(s)`);
  }
  if (verify) {
    console.log(`Expired (verified):    ${expiredOffers.length} dropped`);
    console.log(`Rediscovered (moved):  ${migratedOffers.length} migrated`);
    console.log(`No apply control:      ${droppedOffers.length} dropped`);
    console.log(`Invalid (guarded):     ${invalidOffers.length} dropped`);
  }
  console.log(`New offers added:      ${verifiedOffers.length}`);

  // Trust validation summary (only when trust_filter is configured)
  if (config.trust_filter && config.trust_filter.enabled !== false && verifiedOffers.length > 0) {
    const trustHigh = verifiedOffers.filter(o => o.trustLevel === 'high').length;
    const trustMedium = verifiedOffers.filter(o => o.trustLevel === 'medium').length;
    const trustLow = verifiedOffers.filter(o => o.trustLevel === 'low').length;
    console.log(`Trust validation:      ${trustHigh} high, ${trustMedium} medium, ${trustLow} low`);
    // Flag breakdown
    /** @type {Record<string, number>} */
    const flagCounts = {};
    for (const o of verifiedOffers) {
      for (const f of (o.trustFlags || [])) {
        flagCounts[f] = (flagCounts[f] || 0) + 1;
      }
    }
    if (Object.keys(flagCounts).length > 0) {
      const parts = Object.entries(flagCounts).map(([k, v]) => `${k}: ${v}`);
      console.log(`Trust flags:           ${parts.join(', ')}`);
    }
  }

  if (agentHandoff.length > 0) {
    console.log(`Agent/WebSearch handoff: ${agentHandoff.length} compan${agentHandoff.length === 1 ? 'y' : 'ies'} not handled by zero-token providers`);
    for (const item of agentHandoff.slice(0, 25)) {
      const hint = item.query ? ` — ${item.query}` : '';
      console.log(`  • ${item.company} (${item.method})${hint}`);
    }
    if (agentHandoff.length > 25) {
      console.log(`  … ${agentHandoff.length - 25} more omitted; narrow with --company or inspect portals.yml`);
    }
  }

  const unreachableTargets = errors.filter((e) => e.kind === 'slug_gone');
  const networkTargets = errors.filter((e) => e.kind === 'network');
  const otherErrors = errors.filter((e) => e.kind !== 'slug_gone' && e.kind !== 'network');
  
  const STREAK_THRESHOLD = config.portal_health_threshold || 3;
  const nowStr = new Date().toISOString();
  const healthRecords = [];
  
  // Record each errored target under its real classifyFetchError kind. Before
  // this, only slug_gone/network were recorded and auth (401/403), server
  // (5xx), and unknown fell through to 'reachable' — so a portal WAF-403ing
  // every run was logged as healthy forever and never reached the 🚨 streak
  // escalation. The TSV status vocabulary is additive: auth/server/unknown
  // join the existing reachable|slug_gone|network|empty.
  const errorKindByCompany = new Map(
    errors.filter((e) => e.kind).map((e) => [e.company, e.kind])
  );
  for (const t of targets) {
    const isEmpty = emptyTargets.includes(t.name);

    let status = errorKindByCompany.get(t.name) || 'reachable';
    if (status === 'reachable' && isEmpty) status = 'empty';

    healthRecords.push({ timestamp: nowStr, company: t.name, status });
  }

  const pastHealth = loadPortalHealth();
  const currentStreaks = computeConsecutiveFailures([...pastHealth, ...healthRecords]);

  const persistentlyDead = [];
  const newlyDeadSlug = [];
  const newlyDeadNetwork = [];
  
  // All error kinds can reach the 🚨 persistent list (auth/server/unknown
  // included — a WAF that 403s the scanner every run is coverage decay too).
  // Below threshold, only slug_gone/network keep their dedicated warnings;
  // auth/server/unknown stay in the one-off `Errors (N):` print below.
  for (const e of [...unreachableTargets, ...networkTargets, ...otherErrors.filter((x) => x.kind)]) {
    const streak = currentStreaks.get(e.company) || 1;
    if (streak >= STREAK_THRESHOLD) {
      if (!persistentlyDead.includes(e.company)) persistentlyDead.push(e.company);
    } else if (e.kind === 'slug_gone') {
      if (!newlyDeadSlug.some(x => x.company === e.company)) newlyDeadSlug.push(e);
    } else if (e.kind === 'network') {
      newlyDeadNetwork.push(e);
    }
  }

  if (persistentlyDead.length > 0) {
    console.log(`\n🚨 FIX NEEDED: ${persistentlyDead.length} target(s) have been unreachable for ${STREAK_THRESHOLD}+ runs:`);
    console.log(`   ${persistentlyDead.join(', ')}`);
    console.log(`   Run: node verify-portals.mjs to check if the ATS migrated, or update their board slugs.`);
  }
  if (newlyDeadSlug.length > 0) {
    const names = newlyDeadSlug.map(x => x.company).join(', ');
    console.log(`\n⚠️  ${newlyDeadSlug.length} target(s) unreachable (slug?): ${names} — run: node verify-portals.mjs`);
  }
  if (emptyTargets.length > 0) {
    console.log(`🟡 ${emptyTargets.length} target(s) live but empty: ${emptyTargets.join(', ')}`);
  }
  if (newlyDeadNetwork.length > 0) {
    console.log(`\nNetwork errors (${newlyDeadNetwork.length}):`);
    for (const e of newlyDeadNetwork) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }
  if (otherErrors.length > 0) {
    console.log(`\nErrors (${otherErrors.length}):`);
    for (const e of otherErrors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (verifiedOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of verifiedOffers) {
      const trustSuffix = o.trustScore != null && o.trustScore < 100
        ? ` [Trust: ${o.trustScore}/100${o.trustFlags?.length ? ' — ' + o.trustFlags.join(', ') : ''}]`
        : '';
      const blacklistSuffix = o.blacklisted ? ' [BLACKLISTED — on your do-not-apply list]' : '';
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}${trustSuffix}${blacklistSuffix}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  // Persist this run's counters (#1604) — guarded exactly like the other
  // writes; a --dry-run must leave no trace.
  if (!dryRun) {
    await appendPortalHealth(healthRecords);
    appendScanRunSummary({
      timestamp: new Date().toISOString(), status: 'completed',
      companies: summaryCompanies, boards: summaryBoards, found: totalFound,
      filteredTitle: totalFilteredTitle, filteredTier: totalFilteredTier,
      filteredLocation: totalFilteredLocation, filteredPostingAge: totalFilteredPostingAge,
      filteredSalary: totalFilteredSalary,
      filteredContent: totalFilteredContent, filteredCooldown: totalFilteredCooldown,
      dupes: totalDupes, newAdded: verifiedOffers.length, errors: errors.length,
      filteredBlacklist: totalFilteredBlacklist,
      filteredVisa: totalFilteredVisa,
      filteredPostedDate: totalFilteredPostedDate,
      filteredCountryEligibility: totalFilteredCountryEligibility,
    });
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/8pRpHETxa4');

  // One-time-ever manifesto note: first successful REAL run only. The state
  // file keeps it from ever repeating; --dry-run must leave no trace, and a
  // piped/quiet run is not the moment for it.
  if (!dryRun && process.stdout.isTTY && !process.argv.includes('--quiet') && !existsSync('.manifesto-noted')) {
    // OSC 8 hyperlink where support is known, so the click attributes as
    // utm_source=cli while the visible text stays clean; otherwise print the
    // URL with the utm so typed visits attribute too.
    const osc8 = ['iTerm.app', 'WezTerm', 'vscode', 'ghostty', 'Hyper', 'Tabby'].includes(process.env.TERM_PROGRAM)
      || !!process.env.WT_SESSION || !!process.env.KITTY_WINDOW_ID
      || parseInt(process.env.VTE_VERSION || '0', 10) >= 5000;
    const link = osc8
      ? '\x1b]8;;https://career-ops.org/manifesto?utm_source=cli\x1b\\career-ops.org/manifesto\x1b]8;;\x1b\\'
      : 'career-ops.org/manifesto?utm_source=cli';
    console.log(`\nthe practice behind this tool has a name and a manifesto: ${link}`);
    try { writeFileSync('.manifesto-noted', new Date().toISOString() + '\n'); } catch { /* best-effort */ }
  }
}

// Only run main() when invoked directly (`node scan.mjs`), not when imported by tests.
// `|| ''` guards the case where Node is invoked without a script arg (e.g. `node -e`).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
