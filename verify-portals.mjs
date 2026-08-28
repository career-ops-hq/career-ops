#!/usr/bin/env node

/**
 * verify-portals.mjs — ATS slug validator for portals.yml.
 *
 * When a company is added to portals.yml, its ATS slug (the path segment in
 * `careers_url`, e.g. `jobs.lever.co/<slug>`) is easy to guess wrong — and a
 * wrong slug 404s silently on every future scan, so the company never appears
 * in results and the mistake is invisible. This script probes the public
 * Greenhouse / Ashby / Lever endpoints for a company's slug (or for candidate
 * slugs derived from its name) and reports which resolve.
 *
 * A 200 that returns an empty job list is reported as 'live but empty' — a
 * legitimate state during between-hires periods — kept distinct from an
 * unresolved (404/wrong) slug so a quiet board isn't mistaken for a typo.
 *
 * Usage:
 *   node verify-portals.mjs                 # sweep tracked_companies in portals.yml
 *   node verify-portals.mjs --add cursor    # probe slug variants for one name
 *   node verify-portals.mjs --strict        # exit non-zero if any slug is unresolved
 *   node verify-portals.mjs --file <path>   # use a specific portals file
 *
 * Network: only the sweep / --add paths hit the network. Importing the module
 * (for tests) runs nothing — main() is guarded — and all network access goes
 * through an injectable `fetchJson`, so the pure logic is testable offline.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';

import { fetchJson as defaultFetchJson, fetchTextHead as defaultFetchText, makeHttpCtx } from './providers/_http.mjs';
import { decodeEntities } from './providers/_html-entities.mjs';
import { asciiFold } from './lib/ascii-fold.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const DEFAULT_PORTALS_PATH = process.env.CAREER_OPS_PORTALS || 'portals.yml';

// The core providers/ directory — the SAME plugins the scanner loads. Resolved
// from this file's location so it's independent of the caller's cwd.
const PROVIDERS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'providers');

// How to turn a slug into a probe URL, and where the job list lives in the
// response, for each supported ATS. Greenhouse/Ashby wrap jobs in `{ jobs }`;
// Lever returns a bare array. `includeCompensation` mirrors the ashby provider.
export const ATS = {
  greenhouse: {
    probeUrl: (slug) =>
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    jobCount: (json) => (Array.isArray(json?.jobs) ? json.jobs.length : null),
    // The board root publishes its owner: {"name":"Stripe","content":""}. The
    // Ashby and Lever posting APIs answer no such question, so those two read
    // their owner off the board page <title> instead (see below).
    ownerUrl: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}`,
    ownerKind: 'json',
    ownerName: (json) => (typeof json?.name === 'string' ? json.name.trim() : null),
  },
  ashby: {
    probeUrl: (slug) =>
      `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
    jobCount: (json) => (Array.isArray(json?.jobs) ? json.jobs.length : null),
    // The posting API returns only {jobs, apiVersion}; the board page titles
    // itself with the owner ('deepset Jobs'), which is the only name either
    // Ashby or Lever exposes publicly (#3019).
    ownerUrl: (slug) => `https://jobs.ashbyhq.com/${slug}`,
    ownerKind: 'html',
    ownerName: (html) => boardTitleOwner(html),
  },
  lever: {
    // EU boards (jobs.eu.lever.co) resolve to api.eu.lever.co, mirroring the
    // provider's resolveApiUrl; the default is the base instance.
    probeUrl: (slug, { eu = false } = {}) => `https://api.${eu ? 'eu.' : ''}lever.co/v0/postings/${slug}`,
    jobCount: (json) => (Array.isArray(json) ? json.length : null),
    ownerUrl: (slug, { eu = false } = {}) => `https://jobs.${eu ? 'eu.' : ''}lever.co/${slug}`,
    ownerKind: 'html',
    ownerName: (html) => boardTitleOwner(html),
  },
};

// Recognize an ATS + slug from a careers_url OR an `api:` URL. The careers_url
// patterns mirror the provider `resolveApiUrl` regexes; the api-URL patterns
// cover entries that pin the resolved endpoint directly. First match wins.
const ATS_URL_PATTERNS = [
  {
    ats: 'greenhouse',
    re: /boards-api\.greenhouse\.io\/v1\/boards\/([^/?#]+)/,
  },
  { ats: 'greenhouse', re: /job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/ },
  { ats: 'greenhouse', re: /boards\.greenhouse\.io\/([^/?#]+)/ },
  { ats: 'ashby', re: /api\.ashbyhq\.com\/posting-api\/job-board\/([^/?#]+)/ },
  { ats: 'ashby', re: /jobs\.ashbyhq\.com\/([^/?#]+)/ },
  // Lever entries pin an exact `host` (checked via new URL(), like
  // providers/lever.mjs's resolveApiUrl) instead of matching the hostname as a
  // loose substring anywhere in the URL — otherwise a crafted
  // https://evil.com/jobs.lever.co/x careers_url would falsely resolve as Lever.
  { ats: 'lever', host: 'api.eu.lever.co', re: /^\/v0\/postings\/([^/?#]+)/, eu: true },
  { ats: 'lever', host: 'jobs.eu.lever.co', re: /^\/([^/?#]+)/, eu: true },
  { ats: 'lever', host: 'api.lever.co', re: /^\/v0\/postings\/([^/?#]+)/ },
  { ats: 'lever', host: 'jobs.lever.co', re: /^\/([^/?#]+)/ },
];

/**
 * Identify the ATS and slug embedded in a careers_url or api URL.
 *
 * @param {string} url - A `careers_url` or `api` value from portals.yml.
 * @returns {{ats: string, slug: string, eu?: boolean}|null} Match, or null for
 *   non-ATS URLs (branded careers pages, Workday, job boards, etc.) which this
 *   tool skips. `eu` is set for Lever's EU data-residency instance.
 */
export function parseAtsSlug(url) {
  const text = String(url || '');
  let hostname = null;
  let pathname = null;
  try {
    ({ hostname, pathname } = new URL(text));
  } catch {
    // Not a parseable absolute URL — host-scoped patterns below simply won't match.
  }
  for (const { ats, re, eu, host } of ATS_URL_PATTERNS) {
    if (host) {
      if (hostname !== host) continue;
      const m = pathname.match(re);
      if (m && m[1]) return eu ? { ats, slug: m[1], eu: true } : { ats, slug: m[1] };
      continue;
    }
    const m = text.match(re);
    if (m && m[1]) return eu ? { ats, slug: m[1], eu: true } : { ats, slug: m[1] };
  }
  return null;
}

/**
 * Derive candidate ATS slugs from a company name.
 *
 * Slugs are conventionally the company name lowercased with separators dropped
 * or dashed, so we generate the common shapes plus the first word alone (many
 * boards use just the brand, e.g. 'Acme Corp' → 'acme'). Order is deterministic
 * and duplicates are removed so `--add` probes each distinct candidate once.
 *
 * SUFFIXES ON THE FIRST WORD ARE PROBE-ONLY (#2937). Every other candidate here
 * either reformats the whole name ('nimbus-data'), abbreviates it without
 * adding anything ('nimbus'), or extends it ('nimbusdataai'). Building a suffix
 * on the FIRST WORD is the one rule that both drops part of the name AND
 * substitutes a token for what it dropped, so what comes out is not a form of
 * this company's name, it is a different company's: 'Nimbus Data' yields
 * 'nimbusai', 'nimbustech', 'nimbuslabs'. The rule has no legitimate yield to
 * lose either. When the name already ends in a suffix word ('Scale AI'), it
 * just reproduces words.join('') and is deduped away, so every candidate it
 * contributes uniquely belongs to somebody else.
 *
 * Offering those to `--add` is fine: an operator reads the slug beside the
 * company name and picks one, and a wrong guess costs a 404. Offering them to
 * discoverAlternates is not. That result is attached as `suggested`, and
 * `fix-slugs --fix` writes it into portals.yml with no further identity check,
 * after which scan.mjs labels the other employer's postings with this
 * company's name. Pass `firstWordSuffixes: false` on any path that writes.
 *
 * The bare first word stays on both paths deliberately: many boards really are
 * just the brand ('Acme Corp' → 'acme'), and it adds no token that the company
 * does not have. It is a narrower risk than this change addresses, not a
 * blessed one.
 *
 * @param {string} name - Company display name.
 * @param {{firstWordSuffixes?: boolean}} [opts] - `false` omits the suffix
 *   variants built on the first word alone.
 * @returns {string[]} Distinct candidate slugs, most-specific first.
 */
const SLUG_SUFFIXES = ['ai', 'tech', 'io', 'hq', 'labs'];

export function deriveSlugCandidates(name, { firstWordSuffixes = true } = {}) {
  if (!String(name ?? '').trim()) return [];
  // ASCII-fold BEFORE splitting. The previous `[^a-z0-9\s]` pass turned an
  // accented letter into a SEPARATOR, so "Telefónica" became the two words
  // "telef nica" and never produced "telefonica" — the slug the board actually
  // uses — while "Société Générale" shattered into four fragments and even the
  // first-word heuristic above yielded "soci" (#2930).
  const words = asciiFold(name).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const candidates = [
    words.join(''), // acmecorp
    words.join('-'), // acme-corp
    words.join('_'), // acme_corp
    words[0], // acme
  ];
  const bases = (firstWordSuffixes ? [words.join(''), words[0]] : [words.join('')]).filter(Boolean);
  for (const base of bases) {
    for (const suf of SLUG_SUFFIXES) candidates.push(`${base}${suf}`);
    candidates.push(`${base}.tech`, `${base}.io`);
  }
  return [...new Set(candidates)].filter(Boolean);
}

/**
 * Classify a fetch/probe failure for scan summaries and slug diagnostics.
 *
 * @param {Error|{status?: number, name?: string, message?: string}|null|undefined} err
 * @returns {'slug_gone'|'auth'|'network'|'server'|'unknown'}
 */
export function classifyFetchError(err) {
  if (!err) return 'unknown';
  if (err.name === 'AbortError') return 'network';
  const msg = String(err.message || err);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network/i.test(msg)) {
    return 'network';
  }
  const status = err.status;
  if (status === 404 || status === 410) return 'slug_gone';
  if (status === 401 || status === 403) return 'auth';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (/HTTP 404|HTTP 410/.test(msg)) return 'slug_gone';
  if (/HTTP 401|HTTP 403/.test(msg)) return 'auth';
  if (/HTTP 5\d\d/.test(msg)) return 'server';
  return 'unknown';
}

/**
 * Probe one ATS for one slug and classify the result.
 *
 * @param {string} ats - Key into ATS (greenhouse | ashby | lever).
 * @param {string} slug - Candidate slug to probe.
 * @param {{fetchJson?: Function, eu?: boolean}} [deps] - Injectable HTTP for
 *   testability; `eu` selects Lever's EU data-residency instance.
 * @returns {Promise<{ats,slug,url,status,jobCount?,httpStatus?,errorKind?,reason?}>}
 *   status is 'live' (jobs > 0), 'empty' (200, no jobs), or 'missing'
 *   (404/error/unexpected shape).
 */
export async function probeSlug(
  ats,
  slug,
  { fetchJson = defaultFetchJson, eu = false } = {},
) {
  const spec = ATS[ats];
  if (!spec)
    return {
      ats,
      slug,
      url: '',
      status: 'missing',
      errorKind: 'unknown',
      reason: `unknown ATS: ${ats}`,
    };
  const url = spec.probeUrl(slug, { eu });
  try {
    const json = await fetchJson(url);
    const count = spec.jobCount(json);
    if (count == null)
      return {
        ats,
        slug,
        url,
        status: 'missing',
        errorKind: 'unknown',
        reason: 'unexpected response shape',
      };
    return {
      ats,
      slug,
      url,
      status: count > 0 ? 'live' : 'empty',
      jobCount: count,
    };
  } catch (err) {
    return {
      ats,
      slug,
      url,
      status: 'missing',
      errorKind: classifyFetchError(err),
      httpStatus: err?.status,
      reason: err?.message || String(err),
    };
  }
}

/**
 * Pull the board owner's name out of a careers page <title>.
 *
 * Both providers title the board after its owner and append a jobs suffix:
 * 'deepset Jobs' on Ashby, 'Diabolocom' or 'Lever Demo 2' on Lever. The suffix is
 * stripped when present; everything else is left for canonicalNameTokens to judge.
 *
 * @param {string} html - The head of the board page.
 * @returns {string|null} The owner name, or null when no title is present.
 */
export function boardTitleOwner(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  if (!m) return null;
  // Decode before collapsing whitespace: `&nbsp;` is a space once decoded, and
  // collapsing first would leave it as literal text in the middle of a name.
  const title = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  if (!title) return null;
  return title.replace(/\s+jobs$/i, '').trim() || null;
}

// Tokens that carry no identity. A leading article and a trailing legal designator
// can differ between how a company writes its name and how its ATS board is titled,
// so they are dropped before comparing. Nothing else is: 'Systems', 'AI', 'Airlines'
// and 'Grumman' are exactly what distinguishes Mercury Systems from Mercury.
const NAME_ARTICLES = new Set(['the']);
const NAME_DESIGNATORS = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'plc', 'corp',
  'corporation', 'co', 'company', 'gmbh', 'ag', 'kg', 'sa', 'sas', 'sarl', 'srl',
  'spa', 'bv', 'nv', 'ab', 'as', 'oy', 'aps', 'pty', 'pte', 'kk', 'kft',
]);

/**
 * Reduce a company or board name to the tokens that actually identify it.
 *
 * Accents fold through the shared `asciiFold` (Café -> cafe), which also carries
 * the Latin letters NFD does not decompose — Işık -> isik, Møller -> moller,
 * Großmann -> grossmann, Đại -> dai — where a bare strip-the-marks pass deletes
 * the letter outright (#2930).
 *
 * THE AMPERSAND RULE RUNS BEFORE THE FOLD, AND THE ORDER IS LOAD-BEARING.
 * A spaced ampersand is a word ('Hims & Hers' -> hims and hers); an unspaced one
 * is punctuation ('AT&T' -> att). Only the raw string still tells them apart:
 * `asciiFold` has resolved every '&' by the time it returns, whichever
 * `punctuation` mode it ran in. Fold first and 'Hims & Hers' silently loses its
 * 'and' under 'delete', or 'AT&T' splits into two tokens under 'space'.
 *
 * `punctuation: 'delete'` because these tokens are compared for EQUALITY, never
 * substring-matched, so a hyphen or apostrophe must keep joining its word
 * ("L'Oréal" -> loreal) exactly as the inline strip this replaced did.
 * Whitespace is collapsed to single spaces first, so 'delete' — which removes a
 * tab rather than collapsing it — cannot weld two words together.
 *
 * A leading article and any trailing legal designators are dropped afterwards.
 *
 * @param {string} name
 * @returns {string[]} Canonical identifying tokens.
 */
function canonicalNameTokens(name) {
  const spaced = String(name || '').replace(/\s+/g, ' ');
  const words = asciiFold(spaced.replace(/\s+&\s+/g, ' and '), { punctuation: 'delete' })
    .split(' ')
    .filter(Boolean);
  let start = 0;
  if (words.length > 1 && NAME_ARTICLES.has(words[0])) start = 1;
  let end = words.length;
  while (end - start > 1 && NAME_DESIGNATORS.has(words[end - 1])) end -= 1;
  return words.slice(start, end);
}

/**
 * Does a discovered board's owner name refer to the company we are repairing?
 *
 * Canonical equality, deliberately not a prefix. A shorter tracked name is not
 * evidence that a longer board name is the same company: Mercury and Mercury
 * Systems, Scale and Scale AI, Northrop and Northrop Grumman are all real and
 * distinct. A prefix-only match ('Nimbus Data' against a board named 'Nimbus')
 * may well be the same company, but this path writes portals.yml unreviewed, so
 * it goes to `--add` where a human can judge it rather than being adopted here.
 *
 * @param {string} companyName - The tracked company being repaired.
 * @param {string} boardName - The name the ATS reports for the probed board.
 * @returns {boolean} True only when both canonicalize to the same tokens.
 */
export function boardIdentityMatches(companyName, boardName) {
  const a = canonicalNameTokens(companyName);
  const b = canonicalNameTokens(boardName);
  if (!a.length || !b.length) return false;
  return a.length === b.length && a.every((tok, i) => tok === b[i]);
}

/**
 * Confirm a candidate board belongs to this company before it can be written.
 *
 * Fails CLOSED for any ATS that publishes an owner, and does not distinguish
 * "owned by someone else" from "could not ask": both mean unconfirmed, and an
 * unconfirmed board must not be written into portals.yml unreviewed. A missed
 * suggestion costs an operator one `--add`, where the slug is shown beside the
 * company name; a wrong one relabels another employer's postings in scan.mjs.
 * The reason is recorded so a transient outage is not read as a mismatch.
 *
 * Every ATS in the table above publishes an owner, so all three are confirmed
 * here. The `no-owner-endpoint` pass-through is a guard for a FUTURE entry that
 * defines no `ownerUrl`: it keeps this function total instead of throwing on
 * one. Such an entry would need its own identity signal before boards found on
 * it could be adopted, so the reason is returned rather than swallowed.
 */
async function ownerConfirmed(ats, slug, companyName, { fetchJson, fetchText, eu = false, cache }) {
  const spec = ATS[ats];
  if (!spec?.ownerUrl) return { ok: true, reason: 'no-owner-endpoint' };
  const key = `${ats}|${eu ? 'eu' : 'base'}|${slug}`;
  if (cache?.has(key)) return cache.get(key);
  let out;
  try {
    const url = spec.ownerUrl(slug, { eu });
    const raw = spec.ownerKind === 'html' ? await fetchText(url) : await fetchJson(url);
    const boardName = spec.ownerName(raw);
    if (!boardName) out = { ok: false, reason: 'owner-unnamed' };
    else if (boardIdentityMatches(companyName, boardName)) out = { ok: true, reason: 'owner-match', boardName };
    else out = { ok: false, reason: 'owner-mismatch', boardName };
  } catch (err) {
    // A 404 here means the board root is gone; anything else (429, 5xx, network)
    // means we could not ask. Neither confirms identity, but they are different
    // facts and the summary should not report an outage as somebody else's board.
    out = { ok: false, reason: classifyFetchError(err) === 'slug_gone' ? 'owner-absent' : 'owner-unreachable' };
  }
  cache?.set(key, out);
  return out;
}

/**
 * Probe slug variants across all ATSes; prefer live boards over empty ones.
 *
 * No first-word suffix variants (#2937). Nothing downstream re-checks identity:
 * the winner is attached as `suggested` and `fix-slugs --fix` writes it into
 * portals.yml, so 'Nimbus Data' adopting the live board 'nimbusai' silently
 * relabels Nimbus AI's postings. Those candidates are never this company's name
 * to begin with, so dropping them here costs nothing and they stay available to
 * `--add`, where an operator sees the slug beside the name before adopting it.
 */
async function discoverAlternates(name, { fetchJson, fetchText }) {
  let bestEmpty = null;
  // One owner lookup per (ats, eu, slug) per company, so the added identity check
  // cannot multiply requests when candidates repeat across the probe order.
  const cache = new Map();
  for (const slug of deriveSlugCandidates(name, { firstWordSuffixes: false })) {
    for (const ats of Object.keys(ATS)) {
      // Lever no longer has a separate 'lever-eu' registry key (unified into a
      // single 'lever' + eu flag), so both instances must be probed explicitly
      // here or EU-only tenants become undiscoverable via --add.
      const euVariants = ats === 'lever' ? [false, true] : [false];
      for (const eu of euVariants) {
        const r = await probeSlug(ats, slug, { fetchJson, eu });
        if (r.status !== 'live' && r.status !== 'empty') continue;
        const owner = await ownerConfirmed(ats, slug, name, { fetchJson, fetchText, eu, cache });
        if (!owner.ok) continue;
        if (r.status === 'live') return r;
        if (!bestEmpty) bestEmpty = r;
      }
    }
  }
  return bestEmpty;
}

/**
 * A liveness probe must never paginate an entire board — that is slow and rude
 * to the careers site (many rate-limit or bot-block aggressively). We signal
 * this sentinel when a provider exhausts its request budget; the probe reads it
 * as "the budgeted pages came back fine → the endpoint is live", we just don't
 * learn the exact total. Distinct from a real HTTP error (a broken board).
 */
class ProbePageBudgetReached extends Error {}

/**
 * A handful of requests, not one: some providers must spend requests before
 * the first job can arrive — SuccessFactors CSB does a locale-discovery GET,
 * then one POST per advertised locale until it hits the job-bearing one. A
 * 1-request budget would misreport every such tenant as 'empty'.
 */
const PROBE_REQUEST_BUDGET = 4;

/**
 * Wrap an http context so a provider gets a bounded number of successful list
 * requests (PROBE_REQUEST_BUDGET).
 *
 * Cooperating providers also see `maxPages: 1` and stop on their own (we then
 * learn the first-page count). Providers that ignore the hint are cut off via
 * the sentinel above — so the probe is bounded for every provider, whether or
 * not it honors `maxPages`. `wasTripped()` reports a cut-off even when the
 * provider swallowed the sentinel internally (e.g. a per-locale try/catch).
 *
 * @param {import('./providers/_types.js').Context} base
 * @returns {{ctx: import('./providers/_types.js').Context, wasTripped: () => boolean}}
 */
function boundedProbeCtx(base) {
  let used = 0;
  let tripped = false;
  const guard = (fn) => async (url, opts) => {
    if (used >= PROBE_REQUEST_BUDGET) {
      tripped = true;
      throw new ProbePageBudgetReached();
    }
    used += 1;
    return fn(url, opts);
  };
  return {
    ctx: { ...base, maxPages: 1, fetchJson: guard(base.fetchJson), fetchText: guard(base.fetchText) },
    wasTripped: () => tripped,
  };
}

/**
 * Probe one non-ATS company through the provider plugin the scanner would use.
 *
 * @param {object} entry - tracked_companies entry.
 * @param {import('./providers/_types.js').Provider} provider
 * @param {import('./providers/_types.js').Context} baseCtx
 * @returns {Promise<{provider,status,jobCount?,partial?,httpStatus?,errorKind?,reason?}>}
 *   status is 'live' (postings found), 'empty' (endpoint OK, no postings), or
 *   'missing' (the board 404s/errors — the company would silently drop from
 *   every scan). `partial` marks a live board whose exact count the bounded
 *   probe didn't measure.
 */
export async function probeProvider(entry, provider, baseCtx) {
  const { ctx, wasTripped } = boundedProbeCtx(baseCtx);
  try {
    const jobs = await provider.fetch(entry, ctx);
    const count = Array.isArray(jobs) ? jobs.length : 0;
    if (count > 0) {
      const result = { provider: provider.id, status: 'live', jobCount: count };
      if (wasTripped()) result.partial = true;
      return result;
    }
    // Zero jobs but the budget guard fired: the provider swallowed the sentinel
    // (per-locale/per-page try/catch) after its budgeted requests all came back
    // fine — the endpoint is reachable, we just never reached a job-bearing
    // page. Same verdict as the propagated-sentinel case below.
    if (wasTripped()) return { provider: provider.id, status: 'live', partial: true };
    return { provider: provider.id, status: 'empty', jobCount: 0 };
  } catch (err) {
    if (err instanceof ProbePageBudgetReached) {
      return { provider: provider.id, status: 'live', partial: true };
    }
    return {
      provider: provider.id,
      status: 'missing',
      errorKind: classifyFetchError(err),
      httpStatus: err?.status,
      reason: err?.message || String(err),
    };
  }
}

/**
 * Verify each enabled tracked company's board is reachable.
 *
 * Two tiers, cheapest first:
 *   1. Greenhouse/Ashby/Lever slugs are probed directly (one JSON request each),
 *      with cross-probe suggestions when a slug 404s.
 *   2. Everything else is routed through the SAME provider plugins the scanner
 *      uses (Workday, SuccessFactors, SmartRecruiters, Avature, …), bounded to
 *      a few requests. This catches broken non-ATS boards that used to be
 *      reported as an un-actionable "skipped".
 * A company reaches `skipped` only when no provider claims it. Probing is
 * sequential to stay gentle on rate limits.
 *
 * @param {Array<object>} companies - tracked_companies entries.
 * @param {{fetchJson?: Function, providers?: Map, httpCtx?: object}} [deps]
 *   `providers`/`httpCtx` enable tier 2; omit them (as the ATS unit tests do) to
 *   get tier-1-only behavior where non-ATS entries stay `skipped`.
 * @returns {Promise<Array<object>>} One result row per company.
 */
export async function verifyCompanies(
  companies,
  { fetchJson = defaultFetchJson, fetchText = defaultFetchText, providers = null, httpCtx = null } = {},
) {
  const list = Array.isArray(companies) ? companies : [];
  const results = [];
  for (const company of list) {
    if (!company || typeof company !== 'object') continue;
    if (company.enabled === false) continue;
    const name = typeof company.name === 'string' ? company.name : '(unnamed)';
    const match =
      parseAtsSlug(company.api) || parseAtsSlug(company.careers_url);
    if (match) {
      const probe = await probeSlug(match.ats, match.slug, { fetchJson, eu: match.eu });
      if (probe.status === 'live' || probe.status === 'empty') {
        results.push({ name, ...probe });
        continue;
      }
      // Wrong slug or ATS migration — cross-probe only for slug/unknown failures.
      if (probe.errorKind === 'slug_gone' || probe.errorKind === 'unknown') {
        const suggested = await discoverAlternates(name, { fetchJson, fetchText });
        if (suggested) {
          results.push({ name, ...probe, suggested });
          continue;
        }
      }
      results.push({ name, ...probe });
      continue;
    }

    // Tier 2: hand the entry to the scanner's provider layer. Skip the
    // local-parser provider — a health check must stay network-only and never
    // execute a configured local command.
    if (providers && providers.size > 0) {
      const resolved = resolveProvider(company, providers, { skipIds: ['local-parser'] });
      if (resolved && resolved.provider) {
        const probe = await probeProvider(company, resolved.provider, httpCtx || makeHttpCtx());
        results.push({ name, ...probe });
        continue;
      }
    }

    results.push({
      name,
      status: 'skipped',
      reason: 'no provider matched careers_url or api',
    });
  }
  return results;
}

/**
 * Read a portals file and verify its tracked companies' slugs.
 *
 * @param {string} filePath - Path to a portals.yml.
 * @param {{fetchJson?: Function}} [deps]
 * @returns {Promise<{found: boolean, results: Array<object>}>} found=false when
 *   the file is absent (a graceful no-op for fresh setups / CI).
 */
export async function verifyPortalsFile(
  filePath,
  { fetchJson = defaultFetchJson, providers = null, httpCtx = null } = {},
) {
  if (!existsSync(filePath)) return { found: false, results: [] };
  const config = yaml.load(readFileSync(filePath, 'utf-8'));
  const companies = Array.isArray(config?.tracked_companies)
    ? config.tracked_companies
    : [];
  const results = await verifyCompanies(companies, { fetchJson, providers, httpCtx });
  return { found: true, results };
}

const ICON = { live: '✅', empty: '🟡', missing: '❌', skipped: '➖' };

const ERROR_KIND_LABEL = {
  slug_gone: 'slug not found',
  auth: 'auth blocked',
  network: 'network error',
  server: 'server error',
  unknown: 'unresolved',
};

function printResults(results) {
  for (const r of results) {
    const icon = ICON[r.status] || '?';
    // ATS rows carry ats/slug; provider-layer rows carry the provider id.
    const source = r.ats ? `${r.ats}/${r.slug}` : (r.provider || '?');
    let detail;
    if (r.status === 'live') {
      detail = r.partial ? `${source} (first page live)` : `${source} (${r.jobCount} live)`;
    } else if (r.status === 'empty') {
      detail = `${source} (live but empty)`;
    } else if (r.status === 'missing') {
      const kind = ERROR_KIND_LABEL[r.errorKind] || 'unresolved';
      detail = `${source} (${kind}) — ${r.reason || 'unresolved'}`;
      if (r.suggested) {
        detail += ` → try ${r.suggested.ats}/${r.suggested.slug}`;
      }
    } else {
      detail = r.reason || '';
    }
    console.log(`  ${icon} ${r.name} — ${detail}`);
  }
}

async function runAdd(name, { fetchJson }) {
  const candidates = deriveSlugCandidates(name);
  if (candidates.length === 0) {
    // Distinguish "you gave me nothing" from "nothing sluggable survived".
    // A CJK/Cyrillic/Greek name folds to '' because ATS slugs are ASCII, and
    // reporting that as a missing argument told the user they had omitted an
    // argument they did supply (#2930).
    if (!String(name ?? '').trim()) {
      console.error('verify-portals: --add needs a company name');
    } else {
      console.error(
        `verify-portals: no ASCII slug can be derived from '${name}' — ` +
        'ATS slugs are ASCII, so pass the latinized brand name (or add the board URL to portals.yml directly).',
      );
    }
    process.exit(1);
  }
  console.log(
    `Probing ${candidates.length} slug candidate(s) for '${name}' across Greenhouse/Ashby/Lever...\n`,
  );
  const hits = [];
  for (const slug of candidates) {
    for (const ats of Object.keys(ATS)) {
      const r = await probeSlug(ats, slug, { fetchJson });
      if (r.status !== 'missing') {
        hits.push(r);
        console.log(
          `  ${ICON[r.status]} ${ats}: ${slug}` +
            (r.status === 'empty'
              ? ' (live but empty)'
              : ` (${r.jobCount} jobs)`),
        );
      }
    }
  }
  if (hits.length === 0) {
    console.log(
      '  ❌ No slug variant resolved on any ATS. Check the careers_url manually.',
    );
  } else {
    const best = hits.find((h) => h.status === 'live') || hits[0];
    console.log(
      `\nSuggested: careers_url for ${best.ats} → slug '${best.slug}'`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const fetchJson = defaultFetchJson;

  const addFlag = args.indexOf('--add');
  if (addFlag !== -1) {
    await runAdd(args[addFlag + 1] || '', { fetchJson });
    return;
  }

  const fileFlag = args.indexOf('--file');
  const filePath = resolve(
    fileFlag === -1 ? DEFAULT_PORTALS_PATH : args[fileFlag + 1] || '',
  );

  // Load the scanner's provider plugins so non-ATS boards (Workday,
  // SuccessFactors, SmartRecruiters, …) get a real reachability probe instead
  // of an un-actionable "skipped".
  const providers = await loadProviders(PROVIDERS_DIR);
  const httpCtx = makeHttpCtx();
  const { found, results } = await verifyPortalsFile(filePath, { fetchJson, providers, httpCtx });
  if (!found) {
    // Graceful no-op: fresh setups (and CI, which ships no portals.yml) have
    // nothing to verify. Not an error.
    console.log(
      `verify-portals: no portals file at ${filePath} — nothing to verify (run onboarding first).`,
    );
    return;
  }

  console.log(`verify-portals: ${filePath}\n`);
  printResults(results);

  const live = results.filter((r) => r.status === 'live').length;
  const empty = results.filter((r) => r.status === 'empty').length;
  const missing = results.filter((r) => r.status === 'missing');
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const kindCounts = Object.fromEntries(
    Object.keys(ERROR_KIND_LABEL).map((k) => [k, 0]),
  );
  for (const r of missing) {
    const k = r.errorKind && ERROR_KIND_LABEL[r.errorKind] ? r.errorKind : 'unknown';
    kindCounts[k]++;
  }
  const breakdown = Object.entries(kindCounts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${ERROR_KIND_LABEL[k]}`)
    .join(', ');
  console.log(
    `\n${live} live, ${empty} live-but-empty, ${missing.length} unresolved${breakdown ? ` (${breakdown})` : ''}, ${skipped} no-provider (skipped)`,
  );

  if (strict && missing.length > 0) {
    console.log('🔴 Unresolved slugs found (--strict).');
    process.exit(1);
  }
}

// Only run main() when invoked directly (`node verify-portals.mjs`), not when
// imported by tests. `|| ''` guards `node -e` invocations with no script arg.
if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(`verify-portals failed: ${err.message}`);
    process.exit(1);
  });
}
