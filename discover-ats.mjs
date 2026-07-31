#!/usr/bin/env node
/**
 * discover-ats.mjs — Company-list → scannable ATS board resolver for career-ops
 *
 * Takes a list of companies and resolves each to a scannable ATS board by
 * probing the public JSON APIs career-ops already supports (Greenhouse, Ashby,
 * Lever) via the existing providers/ layer — zero LLM tokens, zero auth. A
 * company "resolves" when a vendor's board exists AND currently lists ≥1 job.
 *
 * portals.yml is a USER-LAYER file, so by DEFAULT this command is preview-only:
 * it prints the entries it WOULD add (pendingEntries) and writes nothing. Pass
 * --write to explicitly opt in to appending them to portals.yml `tracked_companies`
 * (a text splice that preserves the file's comments and formatting; deduped;
 * idempotent; atomic temp-then-rename). Companies that don't resolve —
 * JS-rendered portals, non-standard slugs, or Workday without a hint — are
 * flagged for manual follow-up instead of being silently dropped.
 *
 * Input: a YAML file `companies: [{name, slug?, website?}]` (via --in), and/or
 * bare company names as positional CLI args.
 *
 * Run: node discover-ats.mjs --in companies.yml            (preview — writes nothing)
 *      node discover-ats.mjs --in companies.yml --write    (opt in: append to portals.yml)
 *      node discover-ats.mjs Stripe Ramp Mollie            (bare names)
 *      node discover-ats.mjs --in companies.yml --summary  (human table)
 *      node discover-ats.mjs --in companies.yml --vendors gh,ashby
 *      node discover-ats.mjs --self-test
 *
 * Probing hits live third-party APIs, so honor CAREER_OPS_PORTALS to point at a
 * scratch portals file during tests/experiments.
 *
 * Issue #1864 — github.com/santifer/career-ops
 */

import { readFileSync, existsSync, writeFileSync, renameSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';

import { makeHttpCtx } from './providers/_http.mjs';
import greenhouse from './providers/greenhouse.mjs';
import ashby from './providers/ashby.mjs';
import lever from './providers/lever.mjs';
import workday from './providers/workday.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || join(CAREER_OPS, 'portals.yml');

// Safe charset for a slug that will be interpolated into an ATS URL. Consistent
// with the SLUG_RE guard in scan-ats-full.mjs and seeds/vc-portfolios.mjs — a
// tampered or malformed input can never inject unexpected characters into a URL.
// Mixed case is intentional: Ashby boards are case-sensitive (AlephAlpha, DeepL).
export const SLUG_RE = /^[A-Za-z0-9._-]+$/;

// Bounded concurrency for live probes — lower than scan-ats-full.mjs's 20
// because Ashby's provider holds a ~30s connection per board.
const DEFAULT_CONCURRENCY = 8;

// Vendor probe registry. buildUrl(slug) produces a careers_url in the exact
// shape each provider's detect() recognizes, so the probe reuses the real scan
// path — a board we confirm here is exactly one scan.mjs can later read.
//
// Greenhouse/Ashby/Lever resolve from a single slug. Workday is different: it
// needs <tenant>.<instance>.myworkdayjobs.com/<site> — three coordinates, only
// one of which (tenant ≈ slug) is derivable from a name. The site name in
// particular is unguessable (e.g. "NVIDIAExternalCareerSite" vs
// "External_Career_Site"), so a name alone can't resolve a Workday board. It
// resolves from a Workday hint instead (see resolveWorkday): a full careers URL,
// or an explicit {tenant, site[, instance]} block — with a bounded instance
// auto-probe when the instance is the only missing coordinate.
const VENDORS = {
  gh:    { id: 'greenhouse', provider: greenhouse, host: 'job-boards.greenhouse.io', buildUrl: (s) => `https://job-boards.greenhouse.io/${s}`, api: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs` },
  ashby: { id: 'ashby',      provider: ashby,      host: 'jobs.ashbyhq.com',        buildUrl: (s) => `https://jobs.ashbyhq.com/${s}` },
  lever: { id: 'lever',      provider: lever,      host: 'jobs.lever.co',           buildUrl: (s) => `https://jobs.lever.co/${s}` },
};
// Slug-resolvable vendors, probed in order for each company (first match wins).
const VENDOR_ORDER = ['gh', 'ashby', 'lever'];

// Workday instance subdomains, most common first. Used only when the user gives
// a tenant + site but no instance: we try each `<tenant>.<inst>.myworkdayjobs.com`
// CXS endpoint and stop at the first that returns jobs. Bounded and ordered so a
// probe is cheap and polite (a handful of requests, not a brute-force sweep).
const WORKDAY_INSTANCES = ['wd1', 'wd2', 'wd3', 'wd5', 'wd10', 'wd12', 'wd101', 'wd103'];

const USAGE = `Usage:
  node discover-ats.mjs --in companies.yml            # PREVIEW — resolve + print entries, write nothing
  node discover-ats.mjs --in companies.yml --write    # opt in: append resolved entries to portals.yml
  node discover-ats.mjs Stripe Ramp Mollie            # company names as positional args
  node discover-ats.mjs --in companies.yml --summary  # human-readable table
  node discover-ats.mjs --in companies.yml --vendors gh,ashby,lever  # restrict probes
  node discover-ats.mjs --in companies.yml --vendors workday         # Workday only
  node discover-ats.mjs --self-test                   # inline test suite
  node discover-ats.mjs --help                        # print this usage block

portals.yml is a user-layer file: this command NEVER writes it unless you pass
--write. The default previews the entries it would add (see pendingEntries).

Vendors: gh, ashby, lever (resolve from a name/slug) and workday (resolves from
a coordinate hint — a name alone can't locate a Workday site). Default: all four.

Input YAML shape:
  companies:
    - name: Adyen
    - name: Monzo
      slug: monzo-bank      # optional explicit slug (needed for camelCase Ashby boards)
    - name: Mollie
      website: mollie.com   # optional; surfaced for unresolved companies
    # Workday — give a full careers URL ...
    - name: Nvidia
      workday: https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite
    # ... or the coordinates (instance auto-probed if omitted):
    - name: Salesforce
      workday: { tenant: salesforce, site: External_Career_Site }`;

// ── Pure functions (exported for tests) ──────────────────────────────

/**
 * Derive a URL-safe slug from a company name. Mirrors seeds/vc-portfolios.mjs.
 * Lowercases — so camelCase Ashby boards (AlephAlpha, DeepL) need an explicit
 * `slug` in the input; a derived slug will miss them.
 * @param {string} name
 * @returns {string}
 */
export function deriveSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parse the company list from an input YAML string and/or bare CLI names.
 * Never throws on malformed YAML — returns a warning instead. Drops entries
 * with no usable name; dedupes by lowercased name (input file wins over CLI).
 *
 * @param {string} rawYaml   Contents of the --in file, or '' when none given.
 * @param {string[]} [cliNames]  Bare positional company names.
 * @returns {{companies: {name:string, slug?:string, website?:string, workday?:string|object}[], warnings: string[]}}
 */
export function parseCompanyInput(rawYaml, cliNames = []) {
  const warnings = [];
  /** @type {Map<string, {name:string, slug?:string, website?:string, workday?:string|object}>} */
  const byName = new Map();

  const add = (raw, origin) => {
    if (!raw || typeof raw !== 'object') {
      if (raw !== undefined && raw !== null) warnings.push(`${origin}: dropped non-object entry`);
      return;
    }
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) {
      warnings.push(`${origin}: dropped entry with missing/empty name`);
      return;
    }
    const key = name.toLowerCase();
    if (byName.has(key)) return; // first occurrence wins
    /** @type {{name:string, slug?:string, website?:string, workday?:string|object}} */
    const entry = { name };
    if (typeof raw.slug === 'string' && raw.slug.trim()) entry.slug = raw.slug.trim();
    if (typeof raw.website === 'string' && raw.website.trim()) entry.website = raw.website.trim();
    // Workday hint: a full careers URL (string) or a {tenant, site, instance?}
    // object. parseWorkdayHint validates the contents downstream. Warn on a
    // present-but-wrong-typed value (e.g. a number) so it isn't dropped silently.
    if (typeof raw.workday === 'string' && raw.workday.trim()) entry.workday = raw.workday.trim();
    else if (raw.workday && typeof raw.workday === 'object') entry.workday = raw.workday;
    else if (raw.workday !== undefined && raw.workday !== null && raw.workday !== '') {
      warnings.push(`${origin}: ignored "workday" hint for "${name}" — expected a URL string or {tenant, site} object`);
    }
    byName.set(key, entry);
  };

  if (rawYaml && rawYaml.trim()) {
    let doc;
    try {
      doc = yaml.load(rawYaml);
    } catch (err) {
      warnings.push(`input: malformed YAML — ${err.message}`);
      doc = null;
    }
    const list = Array.isArray(doc?.companies) ? doc.companies
      : (Array.isArray(doc) ? doc : null);
    if (doc && !list) {
      warnings.push('input: expected a top-level `companies:` list (or a bare YAML list)');
    }
    for (const item of list || []) {
      // Allow bare strings in the list too: `- Adyen`.
      add(typeof item === 'string' ? { name: item } : item, 'input');
    }
  }

  for (const raw of cliNames) {
    if (typeof raw === 'string' && raw.trim()) add({ name: raw.trim() }, 'args');
  }

  return { companies: [...byName.values()], warnings };
}

/**
 * Build the candidate {vendor, slug, careers_url} probes for one company.
 * SLUG_RE is enforced before every interpolation — the SSRF choke point.
 * A vendor whose slug fails the guard is skipped (recorded in `skipped`).
 *
 * @param {{name:string, slug?:string}} company
 * @param {string[]} [vendors]  Subset of VENDOR_ORDER.
 * @returns {{candidates: {vendor:string, slug:string, careers_url:string}[], skipped: string[]}}
 */
export function buildCandidateUrls(company, vendors = VENDOR_ORDER) {
  const slug = company.slug || deriveSlug(company.name);
  const candidates = [];
  const skipped = [];
  for (const vendor of vendors) {
    const cfg = VENDORS[vendor];
    if (!cfg) continue;
    if (!SLUG_RE.test(slug)) {
      skipped.push(vendor);
      continue;
    }
    const careers_url = cfg.buildUrl(slug);
    // Defense-in-depth: re-parse the URL we just built and confirm its hostname
    // is EXACTLY the intended ATS host before it's ever probed — never trust the
    // string by shape alone. SLUG_RE already forbids '/', '@', etc., so a slug
    // can't smuggle in a host; this assertion makes that guarantee explicit and
    // survives any future change to buildUrl. (Mirrors each provider's own
    // new URL(...).hostname allowlist check.)
    let host;
    try { host = new URL(careers_url).hostname; } catch { host = null; }
    if (host !== cfg.host) {
      skipped.push(vendor);
      continue;
    }
    candidates.push({ vendor, slug, careers_url });
  }
  return { candidates, skipped };
}

// Coordinate token guard — tenant/instance/site segments interpolated into a
// Workday host/path. Workday site names contain letters, digits, `_` and `-`
// (e.g. NVIDIAExternalCareerSite, External_Career_Site); instances are wdNN.
const WORKDAY_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Extract Workday coordinates {tenant, instance?, site} from a company's hints.
 * Accepts, in priority order:
 *   1. A full Workday URL in `workday`, `careers_url`, or `website`:
 *      https://<tenant>.<instance>.myworkdayjobs.com[/<locale>]/<site>[/...]
 *   2. An explicit object `workday: { tenant, site, instance? }`.
 * Returns null when no Workday coordinates are present. `instance` may be null
 * (caller then auto-probes WORKDAY_INSTANCES). Every returned segment is
 * guaranteed to pass WORKDAY_SEGMENT_RE.
 *
 * @param {{name?:string, workday?:string|object, careers_url?:string, website?:string}} company
 * @returns {{tenant:string, instance:string|null, site:string}|null}
 */
export function parseWorkdayHint(company) {
  const clean = (v) => (typeof v === 'string' && WORKDAY_SEGMENT_RE.test(v) ? v : null);

  // 1. Explicit object form.
  if (company.workday && typeof company.workday === 'object') {
    const tenant = clean(company.workday.tenant);
    const site = clean(company.workday.site);
    const instance = clean(company.workday.instance);
    if (tenant && site) return { tenant, instance: instance || null, site };
  }

  // 2. URL form — check every field that might carry a Workday link. No
  // substring pre-filter here (CodeQL js/incomplete-url-substring-sanitization):
  // the anchored regex below is the actual gate and already rejects anything
  // that isn't a well-formed *.myworkdayjobs.com URL.
  const urlCandidates = [company.workday, company.careers_url, company.website]
    .filter((v) => typeof v === 'string');
  for (const raw of urlCandidates) {
    // Mirrors the tenant regex in providers/workday.mjs resolveEndpoint().
    const m = raw.match(/https?:\/\/([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/);
    if (!m) continue;
    const [, tenant, instance, site] = m;
    if (clean(tenant) && clean(instance) && clean(site)) {
      return { tenant, instance, site };
    }
  }
  return null;
}

/**
 * Build the candidate Workday careers_url list for a hint. When the instance is
 * known, that's the single candidate; when it's null, expand across
 * WORKDAY_INSTANCES so the caller can probe for the live one.
 *
 * @param {{tenant:string, instance:string|null, site:string}} coords
 * @returns {{careers_url:string, instance:string}[]}
 */
export function buildWorkdayCandidates(coords) {
  const instances = coords.instance ? [coords.instance] : WORKDAY_INSTANCES;
  return instances.map((instance) => ({
    instance,
    careers_url: `https://${coords.tenant}.${instance}.myworkdayjobs.com/${coords.site}`,
  }));
}

/**
 * Quote a YAML scalar only when it needs it. Bare values stay bare (matching the
 * existing hand-written portals.yml style); values with YAML-special characters
 * are double-quoted and escaped.
 * @param {string} value
 * @returns {string}
 */
export function yamlScalar(value) {
  const s = String(value ?? '');
  const needsQuote = s === '' || /^[\s]|[\s]$/.test(s) || /[:#"'{}\[\],&*!|>%@`]/.test(s);
  if (!needsQuote) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Render one resolved match as a portals.yml tracked_companies entry snippet.
 * Leads with a newline so it slots cleanly against surrounding entries. Only
 * Greenhouse gets an `api:` line (matching every GH entry in the shipped file).
 * Workday gets an explicit `provider: workday` line — its detect() keys off the
 * myworkdayjobs.com host, but pinning it is unambiguous and matches how
 * provider-specific entries are written elsewhere in portals.yml.
 *
 * @param {{name:string, careers_url:string, api?:string, provider?:string, notes?:string}} match
 * @returns {string}
 */
export function renderPortalEntry(match) {
  const lines = [`  - name: ${yamlScalar(match.name)}`];
  lines.push(`    careers_url: ${match.careers_url}`);
  if (match.api) lines.push(`    api: ${match.api}`);
  if (match.provider) lines.push(`    provider: ${match.provider}`);
  lines.push(`    enabled: true`);
  if (match.notes) lines.push(`    notes: ${yamlScalar(match.notes)}`);
  return '\n' + lines.join('\n') + '\n';
}

/** Normalize a careers_url/api for dedupe comparison: lowercase, strip trailing slash. */
function normalizeUrl(u) {
  return String(u || '').trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * Split resolved matches into {fresh, duplicates} against the tracker's existing
 * entries. A match is a duplicate if its lowercased name OR its normalized
 * careers_url/api already appears. Also self-dedupes within `fresh` (two input
 * companies resolving to the same board).
 *
 * @param {{name:string, careers_url:string, api?:string}[]} matches
 * @param {any[]} existingEntries  Parsed portals.yml tracked_companies (or []).
 * @returns {{fresh: any[], duplicates: any[]}}
 */
export function dedupeAgainstPortals(matches, existingEntries) {
  const names = new Set();
  const urls = new Set();
  for (const e of Array.isArray(existingEntries) ? existingEntries : []) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.name === 'string') names.add(e.name.trim().toLowerCase());
    if (e.careers_url) urls.add(normalizeUrl(e.careers_url));
    if (e.api) urls.add(normalizeUrl(e.api));
  }
  const fresh = [];
  const duplicates = [];
  for (const m of matches) {
    const nameKey = String(m.name || '').trim().toLowerCase();
    const urlKey = normalizeUrl(m.careers_url);
    const apiKey = m.api ? normalizeUrl(m.api) : null;
    const dup = names.has(nameKey) || urls.has(urlKey) || (apiKey && urls.has(apiKey));
    if (dup) {
      duplicates.push(m);
    } else {
      fresh.push(m);
      names.add(nameKey);
      urls.add(urlKey);
      if (apiKey) urls.add(apiKey);
    }
  }
  return { fresh, duplicates };
}

/**
 * Splice rendered entry snippets into the tracked_companies block of a
 * portals.yml text, preserving every other byte (comments, other blocks,
 * ordering). Never re-serializes the document.
 *
 * @param {string} fileText   Current portals.yml contents.
 * @param {string[]} snippets  Output of renderPortalEntry(), one per entry.
 * @returns {string}
 */
export function insertIntoTrackedCompanies(fileText, snippets) {
  if (!snippets.length) return fileText;
  const block = snippets.join('');

  const header = fileText.match(/^tracked_companies:[ \t]*$/m);
  if (!header) {
    // No block at all — append a fresh one at EOF.
    const sep = fileText.endsWith('\n') ? '\n' : '\n\n';
    return `${fileText}${sep}tracked_companies:${block}`;
  }

  const headerEnd = header.index + header[0].length; // index of the newline after the header
  const rest = fileText.slice(headerEnd);
  // Find the block's end: the next top-level key (a line starting with a
  // non-space, non-# char and containing a colon). Comments and indented lines
  // stay in-block. `m` anchors ^ to line starts; the leading \n keeps us from
  // matching the header line itself.
  const boundary = rest.match(/\n[^\s#][^\n]*:/);
  const insertAt = boundary ? headerEnd + boundary.index : fileText.length;

  let before = fileText.slice(0, insertAt);
  const after = fileText.slice(insertAt);
  // Trim trailing blank lines that belong to the block so our leading-newline
  // snippets don't stack extra blank lines before the next key.
  before = before.replace(/\n[ \t]*(?=\n*$)/g, (m2, off) => (off >= headerEnd ? '\n' : m2));

  return before + block + after;
}

// ── Network functions (separated from pure logic, like vc-portfolios.mjs) ──

/**
 * Probe a single vendor candidate for one company.
 * @returns {Promise<{status:'match'|'empty'|'error', jobCount:number, error?:string}>}
 */
export async function probeVendor(company, candidate, ctx) {
  const cfg = VENDORS[candidate.vendor];
  const entry = { name: company.name, careers_url: candidate.careers_url };
  if (!cfg || !cfg.provider.detect(entry)) {
    return { status: 'error', jobCount: 0, error: 'no API URL derivable' };
  }
  try {
    const jobs = await cfg.provider.fetch(entry, ctx);
    const jobCount = Array.isArray(jobs) ? jobs.length : 0;
    return { status: jobCount > 0 ? 'match' : 'empty', jobCount };
  } catch (err) {
    return { status: 'error', jobCount: 0, error: err?.message || String(err) };
  }
}

/**
 * Resolve a Workday board from parsed coordinates. Probes each candidate host
 * (one, when the instance is known; a bounded list otherwise) via the real
 * providers/workday.mjs fetch, capped to a single CXS page (ctx.maxPages: 1 —
 * the provider honors this as a live-probe). First host that returns ≥1 job
 * wins.
 *
 * @returns {Promise<{resolved:any}|{status:'empty'|'error', tried:string[], careers_url?:string, detail?:string}>}
 */
export async function resolveWorkday(company, coords, ctx) {
  const candidates = buildWorkdayCandidates(coords);
  const probeCtx = { ...ctx, maxPages: 1 };
  const tried = [];
  let emptyUrl = null;
  let lastError;

  for (const candidate of candidates) {
    tried.push(candidate.careers_url);
    const entry = { name: company.name, careers_url: candidate.careers_url };
    if (!workday.detect(entry)) { lastError = 'no CXS endpoint derivable'; continue; }
    try {
      const jobs = await workday.fetch(entry, probeCtx);
      const jobCount = Array.isArray(jobs) ? jobs.length : 0;
      if (jobCount > 0) {
        return {
          resolved: {
            name: company.name,
            vendor: 'workday',
            provider: 'workday',
            slug: coords.tenant,
            careers_url: candidate.careers_url,
            jobCount,
          },
        };
      }
      // Remember the FIRST host that was confirmed live-but-empty, so the
      // reported emptyBoards URL is one we actually probed (not always wd1).
      if (!emptyUrl) emptyUrl = candidate.careers_url;
    } catch (err) {
      lastError = err?.message || String(err);
    }
  }
  return emptyUrl
    ? { status: 'empty', tried, careers_url: emptyUrl }
    : { status: 'error', tried, detail: lastError };
}

/**
 * Resolve one company: probe slug vendors in VENDOR_ORDER (first with ≥1 job
 * wins), then — if unresolved and Workday coordinates are present/requested —
 * probe Workday. Returns either a resolved record or an unresolved record.
 */
export async function resolveCompany(company, { vendors = VENDOR_ORDER, ctx, includeWorkday = true } = {}) {
  const { candidates, skipped } = buildCandidateUrls(company, vendors);
  const triedVendors = [];
  const emptyBoards = [];
  const errors = [];

  for (const candidate of candidates) {
    triedVendors.push(candidate.vendor);
    const result = await probeVendor(company, candidate, ctx);
    if (result.status === 'match') {
      const cfg = VENDORS[candidate.vendor];
      /** @type {any} */
      const resolved = {
        name: company.name,
        vendor: cfg.id,
        slug: candidate.slug,
        careers_url: candidate.careers_url,
        jobCount: result.jobCount,
      };
      if (cfg.api) resolved.api = cfg.api(candidate.slug);
      return { resolved };
    }
    if (result.status === 'empty') {
      emptyBoards.push({ vendor: candidate.vendor, careers_url: candidate.careers_url });
    } else {
      errors.push({ vendor: candidate.vendor, error: result.error });
    }
  }

  // Workday: only when a coordinate hint is present (a name alone can't resolve
  // a Workday site). Confirmed live via the real workday provider.
  const coords = includeWorkday ? parseWorkdayHint(company) : null;
  if (coords) {
    triedVendors.push('workday');
    const wd = await resolveWorkday(company, coords, ctx);
    if (wd.resolved) return { resolved: wd.resolved };
    if (wd.status === 'empty') {
      // Use the host resolveWorkday actually confirmed empty, not always wd1.
      emptyBoards.push({ vendor: 'workday', careers_url: wd.careers_url });
    } else if (wd.detail) {
      errors.push({ vendor: 'workday', error: wd.detail });
    }
  }

  // A Workday hint was supplied (via any field parseWorkdayHint reads) but
  // produced no usable coords — i.e. it was malformed/rejected. Distinct from
  // "no hint at all", so the message can tell the user to fix their input
  // rather than suggesting they add one. `includeWorkday` gates this the same
  // way the probe above is gated.
  const workdayHintProvided = includeWorkday
    && (typeof company.workday === 'string' ? !!company.workday.trim()
      : (company.workday && typeof company.workday === 'object'));
  const reason = emptyBoards.length
    ? 'board(s) found but currently list 0 jobs — re-run later or force-add manually'
    // Every probe errored (transient network/HTTP), and nothing was confirmed
    // absent or empty — don't claim "no board found", the status is unknown.
    : (errors.length && !coords)
      ? 'probe error(s) occurred — board status unknown, see errors[] and re-run'
      // A hint was given but rejected by parseWorkdayHint (bad chars, missing
      // tenant/site): tell the user to fix it, not to add one.
      : (workdayHintProvided && !coords)
        ? 'Workday hint given but rejected (invalid/missing tenant or site) — check the `workday` field and re-run'
        : coords
          ? 'Workday coordinates given but no live board with open jobs found at the probed host(s).'
          : 'no Greenhouse/Ashby/Lever board found. If this company uses Workday, add a hint — '
            + 'a full careers URL (workday: https://<tenant>.wd<N>.myworkdayjobs.com/<site>) or '
            + 'workday: {tenant, site} — and re-run; discover-ats will confirm and add it.';

  /** @type {any} */
  const unresolved = { name: company.name, triedVendors, reason };
  if (skipped.length) unresolved.skippedUnsafeSlug = skipped;
  if (emptyBoards.length) unresolved.emptyBoards = emptyBoards;
  if (errors.length) unresolved.errors = errors;
  if (company.website) unresolved.website = company.website;
  return { unresolved };
}

/** Bounded-concurrency map (mirrors scan-ats-full.mjs parallelEach; not exported there). */
async function parallelEach(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

/**
 * Probe every company (bounded concurrency) and split into resolved/unresolved.
 * @returns {Promise<{resolved:any[], unresolved:any[]}>}
 */
export async function runDiscovery(companies, { vendors = VENDOR_ORDER, ctx, concurrency = DEFAULT_CONCURRENCY, includeWorkday = true } = {}) {
  const results = new Array(companies.length);
  const httpCtx = ctx || makeHttpCtx();
  await parallelEach(companies, concurrency, async (company, idx) => {
    results[idx] = await resolveCompany(company, { vendors, ctx: httpCtx, includeWorkday });
  });
  const resolved = [];
  const unresolved = [];
  for (const r of results) {
    if (r?.resolved) resolved.push(r.resolved);
    else if (r?.unresolved) unresolved.push(r.unresolved);
  }
  return { resolved, unresolved };
}

// ── Summary output ────────────────────────────────────────────────────

function printSummary({ resolved, unresolved, duplicates }) {
  console.log(`\n${'='.repeat(78)}`);
  console.log('  ATS Discovery — career-ops');
  console.log(`  resolved: ${resolved.length} | unresolved: ${unresolved.length} | duplicates skipped: ${duplicates.length}`);
  console.log(`${'='.repeat(78)}\n`);

  if (resolved.length) {
    console.log('  ' + 'Company'.padEnd(24) + 'Vendor'.padEnd(12) + 'Jobs'.padEnd(7) + 'Board');
    console.log('  ' + '-'.repeat(90));
    for (const r of resolved) {
      console.log('  ' + String(r.name).substring(0, 22).padEnd(24)
        + String(r.vendor).padEnd(12) + String(r.jobCount).padEnd(7) + r.careers_url);
    }
    console.log('');
  }

  if (unresolved.length) {
    console.log('  Unresolved (manual follow-up):');
    for (const u of unresolved) {
      const site = u.website ? ` [${u.website}]` : '';
      console.log(`    - ${u.name}${site}: ${u.reason}`);
    }
    console.log('');
  }
}

// ── Self-test (pure, no network) ────────────────────────────────────────

function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  // deriveSlug
  check(deriveSlug('Trade Republic') === 'trade-republic', 'deriveSlug spaces → dashes');
  check(deriveSlug('  N8N!  ') === 'n8n', 'deriveSlug trims + strips punctuation');
  check(deriveSlug('Adyen') === 'adyen', 'deriveSlug simple lowercases');

  // parseCompanyInput
  const p1 = parseCompanyInput('companies:\n  - name: Adyen\n  - name: Monzo\n    slug: monzo-bank\n', ['Ramp']);
  check(p1.companies.length === 3, 'parseCompanyInput merges file + CLI names');
  check(p1.companies[1].slug === 'monzo-bank', 'parseCompanyInput keeps explicit slug');
  const p2 = parseCompanyInput('companies:\n  - name: Adyen\n', ['adyen']);
  check(p2.companies.length === 1, 'parseCompanyInput dedupes by lowercased name');
  const p3 = parseCompanyInput(': : not valid yaml : :\n[', []);
  check(p3.companies.length === 0 && p3.warnings.length > 0, 'parseCompanyInput warns on malformed YAML, never throws');
  const p4 = parseCompanyInput('companies:\n  - name: ""\n  - slug: x\n', []);
  check(p4.companies.length === 0, 'parseCompanyInput drops nameless entries');

  // buildCandidateUrls
  const b1 = buildCandidateUrls({ name: 'Adyen' });
  check(b1.candidates.length === 3, 'buildCandidateUrls emits 3 candidates in vendor order');
  check(b1.candidates[0].vendor === 'gh' && b1.candidates[0].careers_url === 'https://job-boards.greenhouse.io/adyen', 'buildCandidateUrls GH url');
  const b2 = buildCandidateUrls({ name: 'X', slug: 'bad/slug' });
  check(b2.candidates.length === 0 && b2.skipped.length === 3, 'buildCandidateUrls SLUG_RE rejects unsafe slug (no URL built)');
  const b3 = buildCandidateUrls({ name: 'Adyen' }, ['ashby']);
  check(b3.candidates.length === 1 && b3.candidates[0].vendor === 'ashby', 'buildCandidateUrls honors vendor subset');

  // renderPortalEntry
  const gh = renderPortalEntry({ name: 'Adyen', careers_url: 'https://job-boards.greenhouse.io/adyen', api: 'https://boards-api.greenhouse.io/v1/boards/adyen/jobs' });
  check(gh.includes('  - name: Adyen') && gh.includes('    api: https://boards-api.greenhouse.io/v1/boards/adyen/jobs'), 'renderPortalEntry GH includes api line');
  const lv = renderPortalEntry({ name: 'Mistral AI', careers_url: 'https://jobs.lever.co/mistral' });
  check(!lv.includes('api:'), 'renderPortalEntry non-GH omits api line');
  const q = renderPortalEntry({ name: 'Foo: Bar', careers_url: 'https://jobs.ashbyhq.com/foo' });
  check(q.includes('name: "Foo: Bar"'), 'renderPortalEntry quotes name with colon');

  // dedupeAgainstPortals
  const existing = [{ name: 'Adyen', careers_url: 'https://job-boards.greenhouse.io/adyen/' }];
  const d1 = dedupeAgainstPortals([{ name: 'Adyen', careers_url: 'x' }], existing);
  check(d1.duplicates.length === 1 && d1.fresh.length === 0, 'dedupe by name hit');
  const d2 = dedupeAgainstPortals([{ name: 'Other', careers_url: 'https://job-boards.greenhouse.io/adyen' }], existing);
  check(d2.duplicates.length === 1, 'dedupe by careers_url hit (trailing slash normalized)');
  const d3 = dedupeAgainstPortals([{ name: 'A', careers_url: 'u1' }, { name: 'A', careers_url: 'u2' }], []);
  check(d3.fresh.length === 1, 'dedupe self-dedupes within fresh');

  // insertIntoTrackedCompanies — normal block with trailing top-level key
  const doc = 'title_filter:\n  positive: [a]\n\ntracked_companies:\n  - name: Existing\n    careers_url: https://jobs.lever.co/existing\n\njob_boards:\n  - name: Foo\n';
  const snippet = renderPortalEntry({ name: 'New', careers_url: 'https://jobs.lever.co/new' });
  const inserted = insertIntoTrackedCompanies(doc, [snippet]);
  check(inserted.indexOf('- name: New') < inserted.indexOf('job_boards:'), 'insert lands before job_boards:');
  check(inserted.indexOf('- name: New') > inserted.indexOf('tracked_companies:'), 'insert lands after tracked_companies:');
  check(inserted.startsWith('title_filter:\n  positive: [a]\n'), 'insert preserves leading bytes');
  check(inserted.includes('job_boards:\n  - name: Foo\n'), 'insert preserves trailing block');
  // idempotency via dedupe: the same board already present → nothing fresh → no insert
  const parsed = yaml.load(inserted);
  const again = dedupeAgainstPortals([{ name: 'New', careers_url: 'https://jobs.lever.co/new' }], parsed.tracked_companies);
  check(again.fresh.length === 0, 'insert is idempotent through dedupe');

  // missing header → appended
  const noHeader = insertIntoTrackedCompanies('title_filter:\n  positive: [a]\n', [snippet]);
  check(/tracked_companies:/.test(noHeader) && noHeader.includes('- name: New'), 'insert appends fresh block when header missing');

  // empty block
  const emptyBlock = insertIntoTrackedCompanies('tracked_companies:\njob_boards:\n  - name: Foo\n', [snippet]);
  check(emptyBlock.indexOf('- name: New') < emptyBlock.indexOf('job_boards:'), 'insert handles empty block');

  // parseWorkdayHint — URL form
  const wh1 = parseWorkdayHint({ name: 'Nvidia', workday: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite' });
  check(wh1 && wh1.tenant === 'nvidia' && wh1.instance === 'wd5' && wh1.site === 'NVIDIAExternalCareerSite', 'parseWorkdayHint parses full URL');
  const wh1b = parseWorkdayHint({ name: 'X', careers_url: 'https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/foo' });
  check(wh1b && wh1b.tenant === 'acme' && wh1b.instance === 'wd3' && wh1b.site === 'Careers', 'parseWorkdayHint strips locale + trailing path');
  // object form, instance optional
  const wh2 = parseWorkdayHint({ name: 'Salesforce', workday: { tenant: 'salesforce', site: 'External_Career_Site' } });
  check(wh2 && wh2.tenant === 'salesforce' && wh2.instance === null && wh2.site === 'External_Career_Site', 'parseWorkdayHint object form, null instance');
  // no hint → null
  check(parseWorkdayHint({ name: 'Adyen' }) === null, 'parseWorkdayHint returns null without hint');
  // unsafe segment rejected
  check(parseWorkdayHint({ name: 'X', workday: { tenant: 'bad/tenant', site: 'S' } }) === null, 'parseWorkdayHint rejects unsafe segment');

  // buildWorkdayCandidates
  const wc1 = buildWorkdayCandidates({ tenant: 'nvidia', instance: 'wd5', site: 'NVIDIAExternalCareerSite' });
  check(wc1.length === 1 && wc1[0].careers_url === 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', 'buildWorkdayCandidates known instance → single URL');
  const wc2 = buildWorkdayCandidates({ tenant: 'salesforce', instance: null, site: 'External_Career_Site' });
  check(wc2.length === WORKDAY_INSTANCES.length && wc2[0].careers_url.includes('salesforce.wd1.'), 'buildWorkdayCandidates null instance → expands across instances');

  // renderPortalEntry — workday provider line
  const wdEntry = renderPortalEntry({ name: 'Nvidia', careers_url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', provider: 'workday' });
  check(wdEntry.includes('    provider: workday') && !wdEntry.includes('api:'), 'renderPortalEntry emits provider: workday, no api line');

  console.log(`\n  discover-ats self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── CLI arg parsing ──────────────────────────────────────────────────

// --write is the explicit opt-in to modify portals.yml (a user-layer file);
// without it the run is preview-only. --dry-run is accepted as a harmless alias
// for "don't write" (the default) so an older invocation never surprises anyone.
const KNOWN_FLAGS = ['--in', '--vendors', '--write', '--dry-run', '--summary', '--self-test', '--help', '-h'];
const VALUE_FLAGS = ['--in', '--vendors'];

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const consumedValueIndices = new Set();
  args.forEach((a, idx) => {
    if (VALUE_FLAGS.includes(a) && args[idx + 1] !== undefined && !args[idx + 1].startsWith('--')) {
      consumedValueIndices.add(idx + 1);
    }
  });

  const unknownFlags = args.filter((a, idx) =>
    a.startsWith('-') && !consumedValueIndices.has(idx) && !KNOWN_FLAGS.includes(a.split('=')[0]));
  if (unknownFlags.length) {
    console.error(`Error: unrecognized flag(s): ${unknownFlags.join(', ')}. Valid flags: ${KNOWN_FLAGS.join(', ')}`);
    process.exit(1);
  }

  const valueOf = (flag) => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
    const kv = args.find((a) => a.startsWith(flag + '='));
    return kv ? kv.split('=').slice(1).join('=') : null;
  };

  // --vendors accepts the slug vendors (gh/ashby/lever) plus `workday` as a
  // toggle. Workday only fires when a company carries a coordinate hint; listing
  // it here alongside slug vendors lets a user scope a run to Workday alone
  // (--vendors workday) or drop it (--vendors gh,ashby,lever).
  const vendorsArg = valueOf('--vendors');
  const requested = vendorsArg
    ? vendorsArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [...VENDOR_ORDER, 'workday'];
  const validVendors = new Set([...VENDOR_ORDER, 'workday']);
  const unknownVendors = requested.filter((v) => !validVendors.has(v));
  if (unknownVendors.length) {
    console.error(`Error: unknown vendor(s): ${unknownVendors.join(', ')}. Valid: ${[...validVendors].join(', ')}`);
    process.exit(1);
  }
  const vendors = requested.filter((v) => VENDORS[v]);
  const includeWorkday = requested.includes('workday');

  // Positional args (not flags, not a consumed flag value) are company names.
  const names = args.filter((a, idx) => !a.startsWith('-') && !consumedValueIndices.has(idx));

  return {
    inPath: valueOf('--in'),
    vendors,
    includeWorkday,
    // Preview by default; only --write may touch portals.yml. --dry-run is an
    // accepted no-op alias (it just reaffirms the default).
    write: args.includes('--write'),
    summary: args.includes('--summary'),
    selfTest: args.includes('--self-test'),
    names,
  };
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.selfTest) runSelfTest();

  let rawYaml = '';
  if (opts.inPath) {
    const path = resolve(process.cwd(), opts.inPath);
    if (!existsSync(path)) {
      console.error(`Error: input file not found: ${opts.inPath}`);
      process.exit(1);
    }
    rawYaml = readFileSync(path, 'utf-8');
  }

  const { companies, warnings } = parseCompanyInput(rawYaml, opts.names);

  if (companies.length === 0) {
    // Emit the same metadata shape as the normal path (documented in
    // modes/discover.md) so a consumer reading previewOnly/portalsPath on a
    // zero-company run gets the documented envelope, not undefined fields.
    const out = {
      metadata: {
        resolved: 0, unresolved: 0, duplicatesSkipped: 0, fresh: 0, freshWritten: 0,
        written: false, previewOnly: true, portalsPath: PORTALS_PATH, warnings,
      },
      resolved: [], unresolved: [],
    };
    if (opts.summary) printSummary({ resolved: [], unresolved: [], duplicates: [] });
    else console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  const { resolved, unresolved } = await runDiscovery(companies, { vendors: opts.vendors, includeWorkday: opts.includeWorkday });

  // Dedupe resolved matches against the existing tracker.
  let existingEntries = [];
  if (existsSync(PORTALS_PATH)) {
    try {
      const parsed = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
      existingEntries = Array.isArray(parsed?.tracked_companies) ? parsed.tracked_companies : [];
    } catch (err) {
      warnings.push(`portals.yml: could not parse for dedupe — ${err.message}`);
    }
  }
  const { fresh, duplicates } = dedupeAgainstPortals(resolved, existingEntries);
  const snippets = fresh.map(renderPortalEntry);

  // Data-contract rule: portals.yml is a USER-LAYER file and is NEVER written
  // unless the user explicitly opts in with --write. The default is preview —
  // we print the entries we WOULD add and touch nothing. This mirrors how the
  // rest of career-ops treats user files (see DATA_CONTRACT.md).
  let written = false;
  if (opts.write && fresh.length && existsSync(PORTALS_PATH)) {
    const current = readFileSync(PORTALS_PATH, 'utf-8');
    // Write-to-temp-then-rename: atomic on the same filesystem, so a crash
    // mid-write can't leave the user's portals.yml truncated.
    const tmpPath = `${PORTALS_PATH}.tmp-${process.pid}`;
    writeFileSync(tmpPath, insertIntoTrackedCompanies(current, snippets), 'utf-8');
    renameSync(tmpPath, PORTALS_PATH);
    written = true;
  } else if (opts.write && fresh.length && !existsSync(PORTALS_PATH)) {
    warnings.push(`--write given but portals.yml not found at ${PORTALS_PATH} — printing entries instead`);
  } else if (!opts.write && fresh.length) {
    warnings.push(`preview only — ${fresh.length} new entr${fresh.length === 1 ? 'y' : 'ies'} shown in pendingEntries; re-run with --write to append them to portals.yml`);
  }

  const metadata = {
    resolved: resolved.length,
    unresolved: unresolved.length,
    duplicatesSkipped: duplicates.length,
    fresh: fresh.length,
    freshWritten: written ? fresh.length : 0,
    written,
    previewOnly: !written,
    portalsPath: PORTALS_PATH,
    warnings,
  };

  if (opts.summary) {
    printSummary({ resolved, unresolved, duplicates });
  } else {
    const out = { metadata, resolved, unresolved };
    // Show the would-be YAML whenever we didn't write it (preview, or --write
    // that couldn't find the file), so the user can paste it manually.
    if (!written) out.pendingEntries = snippets.join('');
    console.log(JSON.stringify(out, null, 2));
  }
  process.exit(0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`discover-ats: ${err?.stack || err?.message || err}`);
    process.exit(1);
  });
}
