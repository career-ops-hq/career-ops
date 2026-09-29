#!/usr/bin/env node

/** Node-era scan helpers retained only for migration parity tests. */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'node:crypto';
import { resolveColumns, parseTrackerRow, normalizeTextKey } from '../../tracker-parse.mjs';
import { normalizeCompany } from '../../tracker-utils.mjs';
import { compileKeyword, compilePositiveKeyword, buildTitleFilter } from '../../title-keywords.mjs';
import { localToday } from '../../lib/local-today.mjs';
import { evaluatePrescreen, hashValue } from '../../lib/prescreen-core.mjs';
import { writePrescreenCache } from '../../lib/prescreen-cache.mjs';
import { promoteKnownFragmentIdentity } from '../../url-key.mjs';
import { openOpportunityStore } from '../../src/opportunities/store.mjs';

try {
  const { config } = await import('dotenv');
  // quiet: dotenv's startup banner goes to stdout, which --json reserves for a
  // single JSON object (#1906).
  config({ quiet: true });
} catch {
  // dotenv is optional — fall back to process.env if not installed
}

// ── Config ──────────────────────────────────────────────────────────

const PROFILE_PATH = process.env.CAREER_OPS_PROFILE || 'config/profile.yml';
// Overridable for the same reason the two inputs above are (#2271). A second
// search lane - a bridge/income track, a career-change track, a partner sharing
// the checkout - already gets its own portals.yml and profile, but without these
// two it still writes into the one inbox and the one dedup history. That is not
// just untidy: scan-history.tsv IS the dedup source, so a posting surfaced in
// lane A is silently counted as a duplicate in lane B and never shown at all.
const SCAN_HISTORY_PATH = process.env.CAREER_OPS_SCAN_HISTORY || 'data/scan-history.tsv';
const PIPELINE_PATH = process.env.CAREER_OPS_PIPELINE || 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';
const PRESCREEN_CACHE_PATH = process.env.CAREER_OPS_PRESCREEN_CACHE || 'data/prescreen-cache';

// ── Title filter ────────────────────────────────────────────────────

// How a title_filter matches a title lives in title-keywords.mjs, because
// openrouter-runner.mjs filters titles too and uses the same matcher. It called a second, hand-kept copy of this
// logic until the two drifted; there is now one implementation and this file
// re-exports it for existing importers.
export { compileKeyword, compilePositiveKeyword, buildTitleFilter };

// Compiled-matcher cache for matchedTitleKeywords(), keyed by the
// `title_filter.positive` array reference. The scan loop calls this once per
// job with the same titleFilter config object, so caching avoids recompiling
// every keyword (compileKeyword()) on every single job.
const compiledPositiveCache = new WeakMap();

function compiledPositiveMatchers(positiveList) {
  if (compiledPositiveCache.has(positiveList)) return compiledPositiveCache.get(positiveList);
  const compiled = positiveList
    .filter(k => typeof k === 'string' && k.trim().length > 0)
    .map(k => ({ raw: k, match: compilePositiveKeyword(k.trim().toLowerCase()) }));
  compiledPositiveCache.set(positiveList, compiled);
  return compiled;
}

// Returns the raw (as-written in portals.yml) `title_filter.positive` keywords
// that matched a given title — used to scope `content_filter.by_title_keyword`
// overrides to only the categories that opted into a stricter content check.
// "Raw" includes a `word:` prefix if the entry carries one, so a
// `by_title_keyword` key must be written exactly as the positive entry is.
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
//   - `block_hard` matches → reject (the only tier `always_allow` cannot
//     override; for country-level terms that are never a false rejection)
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
// without the Workday hostname convention yield no hint and keep their previous
// behaviour exactly, even if their own routes also contain `/job/{id}`.
export function locationHintFromUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (!parsed.hostname.toLowerCase().endsWith('.myworkdayjobs.com')) return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
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
  const blockHard = compileLocationKeywordList(locationFilter.block_hard);

  return (location, url, title) => {
    const lower = typeof location === 'string' ? location.trim().toLowerCase() : '';
    const hint = locationHintFromUrl(url);
    // Nothing to judge on either field → pass (don't penalize missing data).
    if (lower === '' && hint === '') return true;
    const matches = (m) => (lower !== '' && m(lower)) || (hint !== '' && m(hint));
    // `block_hard` is the ONE tier always_allow cannot override. It exists because
    // a European city name can be a whole word inside a non-European location, so
    // word-boundary matching (#2087) does not catch it and always_allow's
    // unconditional win silently discards the user's own block entry:
    //
    //   "Porto Alegre, Rio Grande do Sul, Brazil"  always_allow "Porto" beats block "Brazil"
    //   "USA - New York - Malta"                   always_allow "Malta" beats block "USA"
    //
    // Both configs already listed the country under `block`. Plain `block` cannot
    // be promoted wholesale — always_allow was added in #650 precisely so a
    // multi-location posting survives one blocked city ("Stockholm · London ·
    // Madrid" must not die on a London entry) — so the user marks the entries
    // that are country-level and therefore never a false rejection. Opt-in and
    // additive: a config without `block_hard` behaves exactly as before.
    if (blockHard.length > 0 && blockHard.some(matches)) return false;
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
 * Returns the positive, finite day count, or null when the flag is absent.
 * `error` is ready to print so malformed operands fail before scanning.
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
  // Unicode-aware (#2393 family): the [a-z0-9] strip this used to carry erased
  // non-Latin scripts outright, so 株式会社アカネ and 合同会社ゾロ both cleaned
  // to '' and the equality check below reported two unrelated companies as the
  // same one. The empty guard is part of the fix, not decoration — "no usable
  // signal on either side" must never read as "identical".
  const c1NoSpaces = normalizeTextKey(jobCompany);
  const c2NoSpaces = normalizeTextKey(windowCompany);
  if (c1NoSpaces && c1NoSpaces === c2NoSpaces) return true;

  const c1WithSpaces = normalizeTextKey(jobCompany, ' ');
  const c2WithSpaces = normalizeTextKey(windowCompany, ' ');
  if (!c1WithSpaces || !c2WithSpaces) return false;

  // Containment: a short window name should still match a longer official one
  // ("Acme" vs "Acme Corp"), bounded so "Acme" does not match "Acmetric".
  //
  // The anchors are lookarounds, not \b: JS defines \b against ASCII \w even
  // under the u flag. Keeping the accent (rather than stripping it to a space,
  // as the [a-z0-9] filter did before) means '\bnestlé\b' can never hold —
  // neither side of the trailing anchor is a word character — so Nestlé
  // Deutschland vs Nestlé would silently stop matching. Same for Ørsted, Zoë
  // and every other name whose first or last letter is non-ASCII.
  //
  // The anchor class is the one normalizeTextKey keeps, deliberately. An anchor
  // class without \p{M} would treat a Devanagari matra as a boundary and split
  // कंपनी mid-word — the key and its boundaries have to agree on what a letter
  // is, or they drift the way #2397 and #2445 fixed elsewhere.
  //
  // Non-Latin containment does not fire here (株式会社メルカリ vs メルカリ): the
  // lookbehind sees 社, a letter, so there is no boundary to assert, and
  // Japanese is not space-delimited so no anchor rule recovers it. Note this
  // pair DID match before this change, but only via the '' === '' collision
  // that erased both names — not through this path. Making it match on purpose
  // needs corporate-form normalisation, tracked separately in #2570.
  //
  // compileLocationKeyword() above reached for lookarounds too, for a related
  // reason ("\b behaves surprisingly at a punctuation edge"); its escape set is
  // reused here because '\-' is an invalid identity escape under u. Both
  // operands are already normalizeTextKey output — letters, marks, digits and
  // spaces only — so the escape is defensive, not load-bearing.
  const bounded = (name) => new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}\\p{N}])`,
    'u',
  );
  return bounded(c2WithSpaces).test(c1WithSpaces) || bounded(c1WithSpaces).test(c2WithSpaces);
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

// `today` defaults to the LOCAL calendar day, not the UTC one. This function
// gates a COOLDOWN (`today < cooldownUntil`) — the user asked not to see a
// posting until a date — and the UTC day is tomorrow for a west-of-Greenwich
// evening run, so the cooldown opened a day early (#3070). The recheck window
// below reads one day high the same way. Callers may still pass `today`
// explicitly; only the default moves.
export function shouldDedupScanHistoryRow({ firstSeen, status = 'added' }, { recheckAfterDays = null, today = localToday() } = {}) {
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
 * The path is lowercased because configured and reverse discovery can
 * independently produce different casing for the identical posting — a
 * Workday tenant/site path segment reached via the curated portals.yml entry
 * vs. the reverse-ATS dataset, for instance. A
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
  promoteKnownFragmentIdentity(parsed);
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').toLowerCase() || '/';
  return parsed.toString();
}

/**
 * The leading checkbox marker of a `data/pipeline.md` entry.
 *
 * Only ` ` and `x` are recognized, matching the pre-existing gates: `- [!]`
 * marks a URL that could not be fetched, which is not evidence a posting was
 * surfaced.
 *
 * Anchored, because the URL it guards is then matched anywhere in the entry: a
 * hand-written note that happens to contain checkbox syntax mid-sentence and a
 * link would otherwise seed that link and silently bury a live posting. Leading
 * whitespace is tolerated so an indented entry still dedupes, as it did when the
 * URL had to sit immediately after the checkbox.
 */
const PIPELINE_CHECKBOX_RE = /^\s*- \[[ x]\]\s+/;

/**
 * As `PIPELINE_CHECKBOX_RE`, but rejecting indentation.
 *
 * The company/role gate stays exactly as strict as the `^- \[` anchor it
 * replaces: widening it would seed *more* role keys, and one role key suppresses
 * every other posting that shares it.
 */
const PIPELINE_CHECKBOX_STRICT_RE = /^- \[[ x]\]\s+/;

/**
 * The `~~…~~` wrapper an expired entry is written with.
 *
 * Matched only at the start of the entry body, never searched for line-wide.
 * `~` is a legal URL character and a documented `note:` column may carry its own
 * strikethrough, so treating `~` as a global signal both truncates real URLs and
 * strips live entries of their pair. Expiry is a property of the entry, so it is
 * read at the entry boundary.
 */
const PIPELINE_STRIKETHROUGH_RE = /^~~([\s\S]*?)~~/;

/**
 * A URL inside a pipeline entry.
 *
 * Terminates on whitespace and `|` only. `|` cannot appear unencoded in a URL
 * and is this format's cell separator, so it is the one safe boundary; every
 * other character stays legal. `~` (RFC 3986 unreserved) and `)` (a sub-delim)
 * in particular must not terminate the match — excluding them truncated `~user`
 * paths and parenthesised region suffixes, and a truncated URL both stops
 * deduping and seeds a bare-origin key that everything else on that host then
 * false-matches against.
 *
 * `local:` entries are deliberately not matched — the gates this feeds have
 * always been http(s)-only.
 */
const PIPELINE_URL_RE = /https?:\/\/[^\s|]+/;

/**
 * Split a `data/pipeline.md` checkbox line into its entry body and expiry state.
 *
 * The body is whatever follows the checkbox, unwrapped when the entry is struck
 * out, so every caller parses the same cell sequence either way. An unclosed
 * wrapper still reads as expired: the opening `~~` is the marker.
 *
 * @param {string} line - One raw line of `data/pipeline.md`.
 * @param {RegExp} checkboxRe - Which checkbox anchor this gate accepts.
 * @returns {{body: string, expired: boolean}|null} Null when the line is not an
 *   entry at all.
 */
function pipelineEntry(line, checkboxRe) {
  const checkbox = line.match(checkboxRe);
  if (!checkbox) return null;

  const rest = line.slice(checkbox[0].length);
  if (!rest.startsWith('~~')) return { body: rest, expired: false };

  const closed = rest.match(PIPELINE_STRIKETHROUGH_RE);
  return { body: closed ? closed[1] : rest.slice(2), expired: true };
}

/**
 * Extract the job URL from a `data/pipeline.md` checkbox line, wherever it sits.
 *
 * Six line shapes are documented across the modes. The pending form leads
 * with the URL; the others lead with a report
 * number (`#NNN`, `modes/pipeline.md`), a report link
 * (`[NNN](reports/…)`), a pre-screen marker (`#--`,
 * `modes/pipeline.md`), or a strikethrough (`~~…~~`, `modes/pipeline.md` and
 * `modes/oferta.md`). Anchoring the URL to the checkbox missed all five.
 *
 * An expired entry still seeds a URL key; only its company/role pair is withheld
 * (see `extractPipelineCompanyRole`).
 *
 * @param {string} line - One raw line of `data/pipeline.md`.
 * @returns {string|null} The URL, or null when the line carries none.
 */
function extractPipelineUrl(line) {
  const entry = pipelineEntry(line, PIPELINE_CHECKBOX_RE);
  if (!entry) return null;

  const match = entry.body.match(PIPELINE_URL_RE);
  return match ? match[0] : null;
}

/**
 * Extract the company/role pair from a `data/pipeline.md` checkbox line.
 *
 * Company and role are the two cells *after* the URL cell, not cells 1 and 2 —
 * see `extractPipelineUrl` for why the URL is not always first.
 *
 * Two shapes deliberately yield nothing, mirroring the `status !== 'added'`
 * rule the scan-history branch of `collectSeenCompanyRoles` already applies:
 *
 * - **Expired entries** (`~~…~~`). Strikethrough is how the pipeline records the
 *   same state scan-history records as `skipped_expired`; seeding a dead
 *   posting's role key would let a dead SF URL bury a live NY req. Read at the
 *   entry boundary, so a `note:` column containing its own strikethrough leaves
 *   a live entry's pair intact.
 * - **Pre-screen discards** (`#-- | {url} | skipped (…)`). The cell after the
 *   URL is a discard reason, not a company.
 *
 * @param {string} line - One raw line of `data/pipeline.md`.
 * @returns {{company: string, role: string}|null} The pair, or null when the
 *   line has none to contribute.
 */
function extractPipelineCompanyRole(line) {
  const entry = pipelineEntry(line, PIPELINE_CHECKBOX_STRICT_RE);
  if (!entry || entry.expired) return null;

  const cells = entry.body.split('|').map(cell => cell.trim());
  if (cells[0].startsWith('#--')) return null;

  const urlIndex = cells.findIndex(cell => PIPELINE_URL_RE.test(cell));
  if (urlIndex === -1) return null;

  const [company = '', role = ''] = cells.slice(urlIndex + 1);
  return { company, role };
}

/**
 * Build the seen-URL set from already-read source texts. An absent file is
 * passed as '' (the readIfExists convention shared with
 * `collectSeenCompanyRoles`) — every parse below yields nothing on ''.
 */
export function collectSeenUrls(sources = {}, policy = {}) {
  const { scanHistoryText = '', pipelineText = '', applicationsText = '' } = sources;
  const seen = new Set();
  let recheckEligible = 0;

  // scan-history.tsv
  for (const line of scanHistoryText.split('\n').slice(1)) { // skip header
    const [url, firstSeen, , , , status = 'added'] = line.split('\t');
    if (!url) continue;
    if (shouldDedupScanHistoryRow({ firstSeen, status }, policy)) seen.add(normalizeUrlForDedup(url));
    else recheckEligible++;
  }

  // pipeline.md — extract URLs from checkbox lines, wherever the URL sits in the
  // line (see extractPipelineUrl: five of the six documented shapes lead with a
  // report number, a report link, or a strikethrough rather than the URL).
  for (const line of pipelineText.split('\n')) {
    const url = extractPipelineUrl(line);
    if (url) seen.add(normalizeUrlForDedup(url));
  }

  // applications.md — extract URLs from report links and any inline URLs
  for (const match of applicationsText.matchAll(/https?:\/\/[^\s|)]+/g)) {
    seen.add(normalizeUrlForDedup(match[0]));
  }

  return { seen, recheckEligible };
}

export function loadSeenUrls(policy = {}) {
  return collectSeenUrls({
    scanHistoryText: readIfExists(SCAN_HISTORY_PATH),
    pipelineText: readIfExists(PIPELINE_PATH),
    applicationsText: readIfExists(APPLICATIONS_PATH),
  }, policy);
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
  // NFKC up front so full-width brackets fold to their ASCII forms while the
  // suffix loop can still see them: "Engineer （Remote）" now strips the same
  // way "Engineer (Remote)" always did.
  //
  // This does NOT make the loop understand non-Latin suffixes — the tag itself
  // is still matched against the English-only ROLE_LOCATION_SUFFIXES set via
  // normalizeRoleSuffixTag(), which carries its own [a-z0-9] strip. So
  // "エンジニア（東京）" and "エンジニア（大阪）" remain two keys. Teaching the
  // suffix vocabulary other scripts is a separate change (new vocabulary, not
  // a key fix) and is deliberately out of scope here.
  let title = String(role ?? '').normalize('NFKC').toLowerCase();
  while (true) {
    const match = title.match(/\s*[\[(]([^[\]()]+)[\])]\s*$/);
    if (!match || !isRoleLocationSuffix(match[1])) break;
    title = title.slice(0, match.index).trimEnd();
  }
  // Unicode-aware (#2393 family): the [a-z0-9] strip this used to carry keyed
  // every non-Latin title to '', so バックエンドエンジニア and フロントエンド
  // エンジニア at one company shared a dedupe key and the scan dropped the
  // second as already-seen. Space separator keeps the word-collapsing shape.
  return normalizeTextKey(title, ' ');
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

  // pipeline.md — company/title are the two cells after the URL cell, plus
  // optional trailing columns (location, compensation, posted:/trust:/note:
  // segments). The URL is not always first, and expired/pre-screen shapes
  // contribute no pair at all — see extractPipelineCompanyRole. Same failure the
  // applications.md branch above fixed in #954: a positional regex read the
  // wrong cells, so the seen-set keyed on garbage.
  for (const line of pipelineText.split('\n')) {
    const pair = extractPipelineCompanyRole(line);
    if (pair) add(pair.company, pair.role);
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

function normalizeScanUrl(value) {
  return String(value ?? '').trim().split(/\s+/)[0] || '';
}

/** Persist an honest Stage 0 placeholder; listing metadata is not a complete JD assessment. */
export function persistScanPrescreens(offers, {
  cacheRoot = PRESCREEN_CACHE_PATH,
  candidateSourceHash = hashValue({
    cv: readIfExists('cv.md'),
    profile: readIfExists(PROFILE_PATH),
    profileRules: readIfExists('modes/_profile.md'),
  }),
} = {}) {
  return offers.map((offer) => {
    const input = {
      job: {
        url: normalizeScanUrl(offer.url),
        title: offer.title || null,
        company: offer.company || null,
        listing_hash: hashValue({ location: offer.location || null, salary: offer.salary || null, description: offer.description || null }),
      },
      candidate_source_hash: candidateSourceHash,
      complete_jd: false,
      assessment_complete: false,
    };
    const result = evaluatePrescreen(input);
    return writePrescreenCache(input.job.url, input, result, cacheRoot);
  });
}

/**
 * Parse scan-history.tsv rows that carry a fingerprint, for the cross-listing
 * check. Older rows without the 8th column simply never match. Takes the file
 * text ('' for an absent file), like its `collect*` siblings.
 *
 * @param {string} [scanHistoryText] - Full scan-history.tsv contents.
 * @returns {Array<{url: string, dateStr: string, company: string, title: string, fingerprint: string}>}
 */
export function collectFingerprintHistory(scanHistoryText = '') {
  const rows = [];
  for (const line of scanHistoryText.split('\n')) {
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

/**
 * Filesystem wrapper over {@link collectFingerprintHistory}.
 *
 * @param {string} [historyPath] - Override for tests.
 */
export function loadFingerprintHistory(historyPath = SCAN_HISTORY_PATH) {
  return collectFingerprintHistory(readIfExists(historyPath));
}

/**
 * Read the three dedup sources once and derive every per-run dedup structure
 * from that single read (#2382). A scan run used to parse scan-history.tsv
 * three times and pipeline.md/applications.md twice each — at 50k history rows
 * that is ~600 ms of redundant parsing per run.
 *
 * The snapshot is deliberately per-run: callers hold the returned object in
 * run-scoped locals and nothing is cached at module level, so a later run
 * always re-reads the files. Dedup state is therefore frozen at run start;
 * rows appended by a concurrent process mid-run are picked up by the next run
 * (the previous re-read at the cross-listing step could not safely observe
 * them anyway — scan-history appends are not locked).
 *
 * @param {{recheckAfterDays?: number|null, today?: string}} [policy] -
 *   Scan-history recheck policy, shared by the URL and company+role sets.
 * @param {(name: unknown) => string} [canonicalize=defaultCompanyNormalizer] -
 *   Company canonicalizer for the role keys.
 * @returns {{seen: Set<string>, recheckEligible: number, seenCompanyRoles: Set<string>, fingerprintHistory: Array<{url: string, dateStr: string, company: string, title: string, fingerprint: string}>}}
 */
export function loadDedupSnapshot(policy = {}, canonicalize = defaultCompanyNormalizer) {
  const scanHistoryText = readIfExists(SCAN_HISTORY_PATH);
  const pipelineText = readIfExists(PIPELINE_PATH);
  const applicationsText = readIfExists(APPLICATIONS_PATH);
  const { seen, recheckEligible } = collectSeenUrls({ scanHistoryText, pipelineText, applicationsText }, policy);
  const seenCompanyRoles = collectSeenCompanyRoles({ applicationsText, scanHistoryText, pipelineText }, policy, canonicalize);
  const fingerprintHistory = collectFingerprintHistory(scanHistoryText);
  return { seen, recheckEligible, seenCompanyRoles, fingerprintHistory };
}

/** SQLite scans use the same URL identity without consulting legacy workflow files. */
export async function loadDatabaseDedupSnapshot(databasePath, policy = {}, canonicalize = defaultCompanyNormalizer) {
  const store = await openOpportunityStore(databasePath);
  try {
    const rows = store.dedupRows();
    const seen = new Set(rows.filter(row => shouldDedupScanHistoryRow(row, policy)).map(row => normalizeUrlForDedup(row.url)));
    const seenCompanyRoles = new Set(rows.filter(row => row.company && row.role && shouldDedupScanHistoryRow(row, policy))
      .map(row => companyRoleDedupKey(row.company, row.role, canonicalize)));
    return { seen, recheckEligible: rows.length - seen.size, seenCompanyRoles, fingerprintHistory: store.fingerprintHistory() };
  } finally { store.close(); }
}

// Standard skeleton created on fresh install — matches the format documented
// in modes/pipeline.md and expected by /career-ops pipeline.
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
