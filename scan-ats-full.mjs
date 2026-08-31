#!/usr/bin/env node

/**
 * scan-ats-full.mjs — Reverse ATS discovery scanner. Part of #230.
 *
 * Where scan.mjs scans the companies you track in portals.yml, this script
 * inverts the direction: it walks public directories of companies per ATS
 * (Greenhouse, Lever, Ashby, Workday, iCIMS) and surfaces fresh postings that match
 * your portals.yml `title_filter` / `location_filter` — no manual company
 * curation needed.
 *
 * Optional `title_filter_full` in portals.yml overrides `title_filter` for
 * THIS scanner only, so the keywords tuned for scan.mjs's curated company
 * list do not have to double as the filter for every public board. Absent,
 * `title_filter` is used exactly as before.
 *
 * Company directories come from the public job-board-aggregator dataset
 * (github.com/Feashliaa/job-board-aggregator), cached in data/cache/ for 24h.
 *
 * Zero LLM tokens — pure HTTP + JSON, same providers/ modules as scan.mjs.
 * Postings without a usable publish date are skipped: a reverse scan is only
 * useful for fresh postings, and stale results would flood the pipeline.
 *
 * Usage:
 *   node scan-ats-full.mjs                      # scan all ATS directories, last 3 days
 *   node scan-ats-full.mjs --since 7            # postings from the last 7 days
 *   node scan-ats-full.mjs --ats greenhouse,workday  # subset of sources
 *   node scan-ats-full.mjs --limit 200          # max companies per ATS (default: all)
 *   node scan-ats-full.mjs --dry-run            # preview without writing files
 *   node scan-ats-full.mjs --liveness           # Playwright-verify matches before writing
 *   node scan-ats-full.mjs --include-blacklisted # audit: let data/blacklist.md matches through, annotated
 *   node scan-ats-full.mjs --verbose            # log per-board fetch failures
 *   node scan-ats-full.mjs --md-out <dir>       # also write a dated markdown digest to <dir>
 *   node scan-ats-full.mjs --resume             # continue an interrupted sweep from its checkpoint
 *   node scan-ats-full.mjs --help               # print this usage block and exit
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import * as yaml from 'js-yaml';
import { renameSyncWithRetry } from './tracker-utils.mjs';

import { makeHttpCtx, fetchJson } from './providers/_http.mjs';
import { isResolverFailure, dnsPacingStats } from './providers/_dns-cache.mjs';
import greenhouse from './providers/greenhouse.mjs';
import lever from './providers/lever.mjs';
import ashby from './providers/ashby.mjs';
import workday from './providers/workday.mjs';
import icims from './providers/icims.mjs';
import { buildTitleFilter, buildLocationFilter, buildContentFilter, matchedTitleKeywords, loadSeenUrls, normalizeUrlForDedup, appendToPipeline, appendToScanHistory, loadBlacklist, parseSinceDays } from './scan.mjs';
import { localToday } from './lib/local-today.mjs';
import { SEED_SOURCES, toPortalEntry } from './seeds/vc-portfolios.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || 'portals.yml';
const PIPELINE_PATH = 'data/pipeline.md';
const CACHE_DIR = 'data/cache/ats-companies';
const CACHE_TTL_HOURS = 24;
// Tracks `main` deliberately: the dataset's value is freshness (new boards
// appear weekly), so pinning a commit would defeat the purpose. Integrity rests
// on two layers instead: SLUG_RE validates every entry against a safe charset
// before interpolation, and entryOnHost (below) re-parses each finished
// careers_url and drops anything that doesn't resolve to the ATS's own host —
// so a tampered dataset can at worst name boards that don't exist.
const DATASET_BASE = 'https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data';

// Default fan-out. Correct for sources whose boards each live on their OWN
// host — workday is {tenant}.{instance}.myworkdayjobs.com, so 20 in flight is
// 20 different servers and the resolver, not any one vendor, is the limit.
const CONCURRENCY = 20;

// Greenhouse, Lever and Ashby each serve their ENTIRE directory from a single
// hostname (boards-api.greenhouse.io, api.lever.co, api.ashbyhq.com), so the
// default is 20 sustained connections to ONE API across thousands of boards.
// That earns an HTTP throttle, and a throttled sweep loses live boards rather
// than failing loudly: two full sweeps an hour apart saw lever's unreachable
// count go 2,436 -> 4,100 and ashby's 683 -> 1,675, then recover to 2,525 / 684
// after a cooldown with no change to the dataset. The boards were never dead —
// they were refused, and the matches on them were silently missed.
const SINGLE_HOST_CONCURRENCY = 6;
// A refusing resolver fails every lookup in milliseconds, so a sweep that
// keeps going just feeds it (#2229). Stop after this many consecutive
// resolver-level failures — high enough that a handful of unlucky boards
// can't trip it, low enough to stop within seconds of a real outage.
const RESOLVER_FAILURE_LIMIT = 50;

// Crash insurance for multi-hour directory sweeps: progress + matches are
// checkpointed every CHECKPOINT_EVERY companies so --resume can continue a
// dead run (with its ORIGINAL date window) instead of restarting from zero.
const CHECKPOINT_PATH = 'data/cache/ats-full-checkpoint.json';
const CHECKPOINT_EVERY = 500;

export function loadCheckpoint(file = CHECKPOINT_PATH) {
  if (!existsSync(file)) return null;
  try {
    const cp = JSON.parse(readFileSync(file, 'utf-8'));
    if (cp?.version !== 1) return null;
    // A version tag alone isn't enough: `current` is consumed unchecked below
    // (`entriesAll.slice(resumeAt)`), so a truncated or hand-edited record with
    // a missing/non-numeric resumeAt would silently rescan from zero and then
    // persist `startAt + resumeAt === NaN` into every later checkpoint — a state
    // no subsequent resume can recover from. Reject the malformed record instead.
    if (cp.current !== null && cp.current !== undefined && !validCheckpointCurrent(cp.current)) return null;
    return cp;
  } catch {
    return null;
  }
}

function validCheckpointCurrent(cur) {
  return typeof cur === 'object'
    && typeof cur.name === 'string'
    && Number.isInteger(cur.resumeAt) && cur.resumeAt >= 0
    && Number.isInteger(cur.datasetLen) && cur.datasetLen >= 0;
}

// A checkpoint written under different scan settings must not be resumed —
// silently mixing sources, caps, or undated policy would corrupt the run's
// semantics. --shuffle is never resumable: the sampled order isn't reproducible.
export function checkpointCompatible(cp, opts) {
  return Boolean(cp)
    && !opts.shuffle
    && JSON.stringify(cp.ats) === JSON.stringify(opts.ats)
    && (cp.limit ?? null) === (opts.limit === Infinity ? null : opts.limit)
    && cp.includeUndated === opts.includeUndated;
}

// Never throws: this runs from parallelEach's `finally`, so an escaping error
// (ENOSPC, EACCES, read-only volume) would reject the whole sweep and discard
// every in-memory match from a multi-hour run — the checkpoint killing the work
// it exists to protect. A failed write costs resumability, not the results.
function writeCheckpoint(cp) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${CHECKPOINT_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(cp), 'utf-8');
    renameSyncWithRetry(tmp, CHECKPOINT_PATH); // atomic: a crash mid-write can't corrupt the checkpoint; retries Windows contention
    return true;
  } catch (err) {
    console.error(`\n⚠ checkpoint write failed (${err.message}) — sweep continues, --resume unavailable`);
    return false;
  }
}

// Cheap content fingerprint of a source's company list. --resume relies on the
// dataset order being byte-for-byte reproducible; a same-length regeneration
// with different members would pass a bare length check and silently resume at
// the wrong offset (companies skipped or re-scanned). Hashing the list detects
// that drift so we can fail loudly instead.
export function datasetFingerprint(list) {
  return createHash('sha1').update(JSON.stringify(list)).digest('hex').slice(0, 16);
}

// Dataset entries are external input destined for URL interpolation — reject
// anything outside a conservative slug charset.
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

// SSRF guard / defense in depth: confirm a constructed careers_url actually
// resolves to the expected ATS host before it reaches provider.fetch. Returns
// the synthetic entry, or null if the URL won't parse or the host isn't canonical.
export function entryOnHost(name, careersUrl, isCanonicalHost) {
  let hostname;
  try {
    ({ hostname } = new URL(careersUrl));
  } catch {
    return null;
  }
  return isCanonicalHost(hostname) ? { name, careers_url: careersUrl } : null;
}

// Each source: the provider module that does the fetching, plus how to turn a
// dataset entry into a synthetic PortalEntry the provider can detect/fetch.
export const SOURCES = {
  greenhouse: {
    provider: greenhouse,
    // Whole directory behind one host — see SINGLE_HOST_CONCURRENCY.
    concurrency: SINGLE_HOST_CONCURRENCY,
    dataset: `${DATASET_BASE}/greenhouse_companies.json`,
    toEntry: (slug) => SLUG_RE.test(String(slug))
      ? entryOnHost(String(slug), `https://job-boards.greenhouse.io/${slug}`, h => h === 'job-boards.greenhouse.io')
      : null,
  },
  lever: {
    provider: lever,
    // Whole directory behind one host — see SINGLE_HOST_CONCURRENCY.
    concurrency: SINGLE_HOST_CONCURRENCY,
    dataset: `${DATASET_BASE}/lever_companies.json`,
    toEntry: (slug) => SLUG_RE.test(String(slug))
      ? entryOnHost(String(slug), `https://jobs.lever.co/${slug}`, h => h === 'jobs.lever.co')
      : null,
  },
  ashby: {
    provider: ashby,
    // Whole directory behind one host — see SINGLE_HOST_CONCURRENCY.
    concurrency: SINGLE_HOST_CONCURRENCY,
    dataset: `${DATASET_BASE}/ashby_companies.json`,
    toEntry: (slug) => SLUG_RE.test(String(slug))
      ? entryOnHost(String(slug), `https://jobs.ashbyhq.com/${slug}`, h => h === 'jobs.ashbyhq.com')
      : null,
  },
  workday: {
    provider: workday,
    dataset: `${DATASET_BASE}/workday_companies.json`,
    // Dataset entries are "tenant|instance|site" triples.
    toEntry: (line) => {
      const [tenant, instance, site] = String(line).split('|');
      if (![tenant, instance, site].every(p => p && SLUG_RE.test(p))) return null;
      return entryOnHost(
        tenant,
        `https://${tenant}.${instance}.myworkdayjobs.com/${site}`,
        h => h === `${tenant}.${instance}.myworkdayjobs.com` && h.endsWith('.myworkdayjobs.com'),
      );
    },
  },
  icims: {
    provider: icims,
    dataset: `${DATASET_BASE}/icims_companies.json`,
    toEntry: (slug) => SLUG_RE.test(String(slug))
      ? entryOnHost(String(slug), `https://careers-${slug}.icims.com/jobs/search?ss=1&in_iframe=1`, h => h === `careers-${String(slug).toLowerCase()}.icims.com`)
      : null,
  },
};

// ── CLI args ────────────────────────────────────────────────────────

const KNOWN_FLAGS = [
  '--since', '--limit', '--ats', '--seeds', '--dry-run', '--liveness',
  '--verbose', '--md-out', '--json', '--include-undated', '--include-blacklisted',
  '--shuffle', '--resume', '--help', '-h',
];

// Flags that consume the next argv token as a value (space-separated form —
// the `--flag=value` form is self-contained and never needs this).
const VALUE_FLAGS = ['--since', '--limit', '--ats', '--seeds', '--md-out'];

const USAGE = `Usage:
  node scan-ats-full.mjs                      # scan all ATS directories, last 3 days
  node scan-ats-full.mjs --since 7            # postings from the last 7 days
  node scan-ats-full.mjs --ats greenhouse,workday  # subset of sources
  node scan-ats-full.mjs --limit 200          # max companies per ATS (default: all)
  node scan-ats-full.mjs --dry-run            # preview without writing files
  node scan-ats-full.mjs --liveness           # Playwright-verify matches before writing
  node scan-ats-full.mjs --include-blacklisted # audit: let data/blacklist.md matches through, annotated
  node scan-ats-full.mjs --verbose            # log per-board fetch failures
  node scan-ats-full.mjs --md-out <dir>       # also write a dated markdown digest to <dir>
  node scan-ats-full.mjs --resume             # continue an interrupted sweep from its checkpoint
  node scan-ats-full.mjs --help               # print this usage block and exit`;

function parseArgs(argv) {
  const args = argv.slice(2);

  // Shared with reply-watch.mjs/dedup-tracker.mjs/scan.mjs via
  // lib/cli-flags.mjs (#2775). This also fixes a latent ordering bug this
  // script had before the pattern was consolidated: the unrecognized-flag
  // check now runs BEFORE --help, so `--help --bogus` still errors instead
  // of exiting 0 having never looked at `--bogus` (the same ordering
  // CodeRabbit flagged on #2745/#2746).
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS });

  const valueOf = (flag) => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
    const kv = args.find(a => a.startsWith(flag + '='));
    return kv ? kv.split('=').slice(1).join('=') : null;
  };
  // Validated by the SAME parser scan.mjs uses, so one flag name cannot mean
  // two different things (#2498). `Number(...) || 3` silently swallowed every
  // malformed operand: `--since abc` and `--since 0` became 3 while the user
  // believed they had scanned the window they typed; `--since -5` put the
  // cutoff in the FUTURE so nothing was ever eligible, which reads exactly like
  // "no new postings"; `--since 1e400` became Infinity → an -Infinity cutoff,
  // i.e. no window at all. Only the DEFAULT stays local: absent --since means
  // 3 days here, where scan.mjs means no bound.
  const sinceArg = parseSinceDays(args);
  if (sinceArg.error) {
    console.error(`Error: ${sinceArg.error}`);
    process.exit(1);
  }
  const sinceDays = sinceArg.days ?? 3;
  const limit = Number(valueOf('--limit')) || Infinity;
  const atsArg = valueOf('--ats');
  // --seeds: optional comma-separated VC portfolio sources (e.g. yc,a16z).
  // When set, the seed companies are fetched and probed via the ATS providers
  // instead of (or in addition to) the regular ATS directory walk.
  const seedsArg = valueOf('--seeds');
  const seeds = seedsArg
    ? seedsArg.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];
  const unknownSeeds = seeds.filter(s => !SEED_SOURCES[s]);
  if (unknownSeeds.length) {
    console.error(`Error: unknown seed source(s): ${unknownSeeds.join(', ')}. Valid: ${Object.keys(SEED_SOURCES).join(', ')}`);
    process.exit(1);
  }
  // When --seeds is the only discovery flag (no --ats), default --ats to none
  // so we don't also walk the full ATS directories unintentionally.
  const ats = atsArg
    ? atsArg.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : (seeds.length > 0 ? [] : Object.keys(SOURCES));
  const unknown = ats.filter(a => !SOURCES[a]);
  if (unknown.length) {
    console.error(`Error: unknown ATS source(s): ${unknown.join(', ')}. Valid: ${Object.keys(SOURCES).join(', ')}`);
    process.exit(1);
  }
  return {
    sinceDays,
    limit,
    ats,
    seeds,
    dryRun: args.includes('--dry-run'),
    liveness: args.includes('--liveness'),
    verbose: args.includes('--verbose'),
    mdOut: valueOf('--md-out'),
    json: args.includes('--json'),
    includeUndated: args.includes('--include-undated'),
    includeBlacklisted: args.includes('--include-blacklisted'),
    shuffle: args.includes('--shuffle'),
    resume: args.includes('--resume'),
  };
}

// ── Company list cache (24h TTL) ────────────────────────────────────

// Returns { list, status } where status is:
//   'ok'    — fresh fetch, or a cache entry still within TTL
//   'stale' — network fetch failed; falling back to an expired cache
//   'empty' — no data at all (no cache, fetch failed/non-array)
// The status lets callers (and --json) distinguish a degraded scan from an empty one.
async function loadCompanyList(name, url) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${name}.json`);
  if (existsSync(cacheFile)) {
    const ageHours = (Date.now() - statSync(cacheFile).mtimeMs) / 3_600_000;
    if (ageHours < CACHE_TTL_HOURS) {
      try { return { list: JSON.parse(readFileSync(cacheFile, 'utf-8')), status: 'ok' }; } catch { /* refetch below */ }
    }
  }
  try {
    const data = await fetchJson(url, { timeoutMs: 30_000 });
    if (Array.isArray(data)) {
      writeFileSync(cacheFile, JSON.stringify(data), 'utf-8');
      return { list: data, status: 'ok' };
    }
  } catch (err) {
    console.error(`⚠️  ${name}: could not download company list — ${err.message}`);
  }
  // Stale cache beats nothing.
  if (existsSync(cacheFile)) {
    try { return { list: JSON.parse(readFileSync(cacheFile, 'utf-8')), status: 'stale' }; } catch { /* fall through */ }
  }
  return { list: [], status: 'empty' };
}

// Date gate for one posting in a reverse (fresh-first) scan:
//   'stale'   — dated, but older than the cutoff → always dropped
//   'undated' — no usable publish date → dropped by default, kept with --include-undated
//   'keep'    — dated and within the window
export function classifyPostingDate(job, cutoff) {
  if (job.postedAt && job.postedAt < cutoff) return 'stale';
  if (!job.postedAt) return 'undated';
  return 'keep';
}

// Apply the same user-owned do-not-apply gate as scan.mjs to reverse-scan
// results. Absent/empty blacklist is a no-op. Default skips are counted and
// never silent; --include-blacklisted keeps matches but marks them for audit.
export function filterBlacklistedOffers(offers, blacklist, { includeBlacklisted = false } = {}) {
  if (!blacklist || blacklist.size === 0) {
    return { offers, filteredBlacklist: 0, annotatedBlacklisted: 0 };
  }

  const kept = [];
  let filteredBlacklist = 0;
  let annotatedBlacklisted = 0;

  for (const offer of offers) {
    const entry = blacklist.get(normalizeCompany(offer.company || ''));
    if (!entry) {
      kept.push(offer);
      continue;
    }

    if (!includeBlacklisted) {
      filteredBlacklist++;
      continue;
    }

    annotatedBlacklisted++;
    const label = `blacklisted${entry.reason ? `: ${entry.reason}` : ''}`;
    kept.push({
      ...offer,
      blacklisted: true,
      note: typeof offer.note === 'string' && offer.note.trim()
        ? `${label} — ${offer.note}`
        : label,
    });
  }

  return { offers: kept, filteredBlacklist, annotatedBlacklisted };
}

// `title_filter` is written for scan.mjs, whose corpus is the curated
// tracked_companies list. That corpus is what makes a broad keyword safe:
// "Backend" at a company you already vetted is a real lead, and dropping it
// costs real roles — so tightening the shared key to protect this sweep is a
// regression for the scanner that actually produces applications.
//
// This sweep removes the corpus and leaves the same keywords carrying the
// whole burden against every public board. Broad keywords then match on a
// scale they were never chosen for, and ordinary English words land as
// unrelated product names: one 38,854-board sweep wrote 426 postings, of
// which 142 passed on "Backend" alone and the rest on Fuel Associate,
// Traffic Anchor, ICP Mass Spec, Principal Mechanical Canister Eng. Across
// 194 distinct companies, one matched a crypto name — a gas-station chain.
//
// Optional `title_filter_full` lets one portals.yml carry a strict profile
// for this sweep and a broad one for scan.mjs. Absent — the default — this
// returns `title_filter` and behaviour is byte-identical to before.
export function resolveTitleFilterConfig(config) {
  return config?.title_filter_full ?? config?.title_filter;
}

// Title/location/content filter chain for one posting, used by runSeedScan().
// The main ATS-directory loop below inlines the same three checks (it tracks
// a droppedContent counter per stage for the run summary), but this shared,
// pure, exported helper keeps the content_filter.by_title_keyword wiring
// (#1846) unit-testable without mocking providers or duplicating the rule
// order in two places for the caller that doesn't need per-stage counts.
export function passesFilters(job, { titleFilter, locationFilter, contentFilter, titleFilterConfig }) {
  if (!titleFilter(job.title)) return false;
  // job.url is passed so the location filter can fall back to the URL's own
  // location segment when the provider reports a rolled-up "N Locations" string;
  // job.title so a title-stated remote role survives a city-only location.
  if (!locationFilter(job.location, job.url, job.title)) return false;
  if (contentFilter && !contentFilter(job.description, matchedTitleKeywords(job.title, titleFilterConfig))) return false;
  return true;
}

// Cap-aware company sampling. Default: the dataset's natural (alphabetical)
// prefix. With --shuffle: a random sample of `limit` companies, so a capped
// scan isn't always biased to the same alphabetical-first slice. Pure; returns
// a new array and never mutates `list`.
export function sampleCompanies(list, limit, shuffle = false) {
  if (!shuffle || limit >= list.length) return list.slice(0, limit);
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, limit);
}

// ── VC portfolio seed scan ──────────────────────────────────────────

// ATS providers that can auto-detect from a careers_url, in probe order.
// Workday is excluded: its URL format requires a tenant|instance|site triple
// that can't be derived from a portfolio slug alone.
const SEED_PROVIDERS = [greenhouse, lever, ashby];

/**
 * Scan a VC portfolio seed source and return matching job offers.
 * Companies are converted to PortalEntry shape, then each ATS provider's
 * detect() is tried in order (greenhouse → lever → ashby). The first hit
 * wins and its fetch() is called — identical to how portals.yml tracked
 * companies flow through scan.mjs.
 *
 * @param {string}   seedId      Key from SEED_SOURCES (e.g. 'yc').
 * @param {object}   opts        Parsed CLI options.
 * @param {object}   ctx         HTTP context from makeHttpCtx().
 * @param {Set}      seenUrls    Shared dedup set (mutated in place).
 * @param {string}   label       Human-readable source label for logs.
 * @returns {Promise<object[]>}  New job offers (same shape as ATS scan offers).
 */
export async function runSeedScan(seedId, opts, ctx, seenUrls, label) {
  const source = SEED_SOURCES[seedId];
  if (!source) throw new Error(`runSeedScan: unknown seed "${seedId}"`);

  let companies;
  try {
    companies = await source.fetch();
  } catch (err) {
    console.error(`⚠️  ${seedId}: could not fetch portfolio — ${err.message}`);
    return [];
  }

  // Apply the --limit cap here too (by slug, consistent with sampleCompanies).
  const capped = opts.limit < companies.length
    ? (opts.shuffle
      ? (() => { const c = companies.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c.slice(0, opts.limit); })()
      : companies.slice(0, opts.limit))
    : companies;

  const cutoff = Date.now() - opts.sinceDays * 86_400_000;
  const offers = [];
  let errors = 0;

  await parallelEach(capped, CONCURRENCY, async (company) => {
    const entry = toPortalEntry(company);
    if (!entry.careers_url) return;

    // Try each ATS provider's detect() — first hit wins.
    let provider = null;
    for (const p of SEED_PROVIDERS) {
      try {
        if (p.detect?.(entry)) { provider = p; break; }
      } catch { /* no-op */ }
    }
    if (!provider) return; // No ATS detected — skip silently (or log in --verbose).

    let jobs;
    try {
      jobs = await provider.fetch(entry, ctx);
    } catch (err) {
      errors++;
      if (opts.verbose) console.error(`  ✗ ${seedId}/${entry.name}: ${err.message}`);
      return;
    }

    const sourceName = `${seedId}-seed`;
    for (const job of jobs) {
      if (!job.url || !job.title) continue;
      const dateClass = classifyPostingDate(job, cutoff);
      if (dateClass === 'stale') continue;
      if (dateClass === 'undated' && !opts.includeUndated) continue;
      if (!passesFilters(job, {
        titleFilter: opts.titleFilter,
        locationFilter: opts.locationFilter,
        contentFilter: opts.contentFilter,
        titleFilterConfig: opts.titleFilterConfig,
      })) continue;
      const dedupUrl = normalizeUrlForDedup(job.url);
      if (seenUrls.has(dedupUrl)) continue;
      seenUrls.add(dedupUrl);
      offers.push({ ...job, source: sourceName, dateStatus: job.postedAt ? 'dated' : 'unknown' });
    }
  });

  return { offers, errors, total: capped.length };
}

// ── Parallel fetch with concurrency limit ───────────────────────────

// One company's whole fetch may not exceed this — even with per-request
// timeouts in _http.mjs, an unforeseen hang (DNS, a provider bug) must cost
// one company, not freeze a worker slot for the rest of a 12k-company sweep.
const COMPANY_TIMEOUT_MS = 5 * 60_000;

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function parallelEach(items, limit, fn, onItemDone = null, shouldStop = null) {
  let next = 0;
  let done = 0;
  const inFlight = new Set();
  async function worker() {
    while (next < items.length) {
      // Checked before claiming an index, so a stopped run leaves `next` where
      // the unclaimed work starts and onItemDone's resumeAt stays truthful.
      if (shouldStop && shouldStop()) return;
      const idx = next++;
      inFlight.add(idx);
      try {
        await fn(items[idx], idx);
      } finally {
        inFlight.delete(idx);
        done++;
        // Lowest not-yet-finished index: everything below it is complete, so
        // a resumed run can restart exactly here without skipping work.
        const resumeAt = inFlight.size ? Math.min(...inFlight) : next;
        if (onItemDone) onItemDone({ done, resumeAt });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

// ── Liveness verification (reuses liveness-browser.mjs) ────────────

async function filterLive(offers) {
  let chromium, checkUrlLiveness, newLivenessPage;
  try {
    ({ chromium } = await import('playwright'));
    ({ checkUrlLiveness, newLivenessPage } = await import('./liveness-browser.mjs'));
  } catch (err) {
    throw new Error(
      `--liveness requires Playwright with Chromium (run "npx playwright install chromium"): ${err.message}`,
      { cause: err },
    );
  }
  console.error(`\nVerifying liveness of ${offers.length} match(es) with Playwright (sequential)...`);
  const browser = await chromium.launch({ headless: true });
  const live = [];
  try {
    const page = await newLivenessPage(browser);
    // Sequential — project rule: never Playwright in parallel
    for (const offer of offers) {
      const { result, reason } = await checkUrlLiveness(page, offer.url);
      const icon = result === 'active' ? '✅' : result === 'expired' ? '❌' : '⚠️';
      console.error(`  ${icon} ${result.padEnd(9)} ${offer.company} | ${offer.title}${result === 'expired' ? ` (${reason})` : ''}`);
      if (result !== 'expired') live.push(offer); // keep 'uncertain' — transient errors retry next scan
    }
  } finally {
    await browser.close();
  }
  console.error(`  → ${live.length}/${offers.length} passed liveness`);
  return live;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  let checkpoint = null;
  if (opts.resume) {
    const cp = loadCheckpoint();
    if (!cp) {
      console.error(`Error: --resume passed but no checkpoint found at ${CHECKPOINT_PATH}.`);
      process.exit(1);
    }
    if (!checkpointCompatible(cp, opts)) {
      console.error('Error: checkpoint was written with different settings (--ats/--limit/--include-undated, or --shuffle is set) — rerun with the original flags, or delete the checkpoint to start fresh.');
      process.exit(1);
    }
    checkpoint = cp;
  } else if (loadCheckpoint() && !opts.dryRun) {
    console.error(`⚠️  Unfinished sweep checkpoint found at ${CHECKPOINT_PATH} — pass --resume to continue it; this fresh run will overwrite it.`);
  }
  // Resume reuses the ORIGINAL cutoff so the date window stays consistent
  // across the interruption instead of silently sliding forward.
  const cutoff = checkpoint ? checkpoint.cutoffMs : Date.now() - opts.sinceDays * 86_400_000;
  // In --json mode, stdout is reserved for the single machine-readable result,
  // so every human-facing line goes to stderr instead.
  const log = opts.json ? (...a) => console.error(...a) : (...a) => console.log(...a);
  // Same rule as `log` above: under --json the counter goes to stderr rather
  // than being dropped. Suppressing it left a sweep with no progress signal on
  // either stream, and `--dry-run --json` has no checkpoint to fall back on
  // (dry runs write no state), so a long run was indistinguishable from a hung
  // one.
  const progress = (s) => { if (opts.json) process.stderr.write(s); else process.stdout.write(s); };

  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first — the reverse scan reuses its title_filter/location_filter.');
    process.exit(1);
  }
  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  const fullTitleFilterConfig = resolveTitleFilterConfig(config);
  const titleFilter = buildTitleFilter(fullTitleFilterConfig);
  const locationFilter = buildLocationFilter(config?.location_filter);
  // Same content_filter (incl. by_title_keyword scoping) scan.mjs applies —
  // see #1846. Built once here from the same portals.yml config.
  const contentFilter = buildContentFilter(config?.content_filter);
  if (!fullTitleFilterConfig?.positive?.length) {
    const key = config?.title_filter_full ? 'title_filter_full' : 'title_filter';
    console.error(`⚠️  portals.yml has no ${key}.positive — every fresh posting on every board will match. Consider adding keywords.`);
  }
  // Attach filters to opts so runSeedScan can use them without extra parameters.
  opts.titleFilter = titleFilter;
  opts.locationFilter = locationFilter;
  opts.contentFilter = contentFilter;
  // Raw title_filter config, needed by matchedTitleKeywords() to scope
  // content_filter.by_title_keyword the same way scan.mjs does.
  opts.titleFilterConfig = fullTitleFilterConfig;

  const atsSummary = opts.ats.length ? `ats: ${opts.ats.join(', ')}` : '';
  const seedsSummary = opts.seeds.length ? `seeds: ${opts.seeds.join(', ')}` : '';
  const sourcesSummary = [atsSummary, seedsSummary].filter(Boolean).join(' | ');
  log(`Reverse ATS scan — ${sourcesSummary} | since ${opts.sinceDays}d${opts.limit < Infinity ? ` | limit ${opts.limit}/ats` : ''}${opts.shuffle ? ' | shuffled' : ''}${opts.includeUndated ? ' | +undated' : ''}${opts.liveness ? ' | liveness' : ''}${opts.dryRun ? ' | DRY RUN' : ''}`);

  const { seen: seenUrls } = loadSeenUrls();
  const blacklist = loadBlacklist();
  // sinceMs and includeUndated let providers (currently only workday.mjs)
  // stop paginating a tenant early instead of always walking to max_pages:
  // sinceMs once postings are confidently past the --since window, and
  // includeUndated (when false) for a tenant that exposes no postedOn at
  // all, since its postings would all be dropped as undated below anyway.
  //
  // syntheticEntries states what this scanner's entries ARE: built from the
  // external ATS dataset, not read from portals.yml tracked_companies.
  // workday.mjs picks its cap-hit warning from it — there is no portal entry
  // here for the user to edit, so "raise max_pages on this entry" would be
  // inactionable. It used to infer that from sinceMs being set, which stopped
  // being true once #2418 taught scan.mjs --since to set it too (#2495).
  const ctx = { ...makeHttpCtx(), sinceMs: cutoff, includeUndated: opts.includeUndated, syntheticEntries: true };
  // The LOCAL calendar day, not the UTC one. This value lands in
  // scan-history.tsv's first_seen, which shouldDedupScanHistoryRow measures the
  // recheck window against using the local day (#3070). Stamping it in UTC put
  // the two sides of that comparison on different clocks.
  const date = localToday();

  // Same defensive default as completedSources/counters below: a version-1
  // checkpoint that lost its offers array would otherwise set this to undefined
  // and throw on the next line, instead of degrading to an empty resume.
  const newOffers = checkpoint?.offers || [];
  // Checkpointed matches were already deduped once — without re-seeding, a
  // resumed run re-scanning the in-flight overlap would duplicate them.
  for (const o of newOffers) seenUrls.add(normalizeUrlForDedup(o.url));
  const completedSources = new Set(checkpoint?.completedSources || []);
  const cc = checkpoint?.counters || {};
  let totalCompaniesScanned = cc.totalCompaniesScanned || 0;
  let totalCompaniesAvailable = 0;
  let totalErrors = cc.totalErrors || 0;
  let droppedNoDate = cc.droppedNoDate || 0;
  let droppedContent = cc.droppedContent || 0;
  let capHit = false;
  // Aggregated from providers/workday.mjs's jobs.workdayNoDateSkip tag — see
  // there for why this is a counter instead of a per-company console.error
  // (thousands of tenants hit this on a full directory scan; one line each
  // would just be the same message repeated thousands of times).
  let noDateSkipCompanies = cc.noDateSkipCompanies || 0;
  let noDateSkipJobs = cc.noDateSkipJobs || 0;
  // Boards that hit a provider's hard page cap (icims). Unlike a Workday
  // truncation this isn't a network hiccup, so a sequential retry would just
  // re-hit the cap — it's reported, not retried, so capped coverage is visible
  // instead of passing for a fully-walked board.
  let cappedBoards = cc.cappedBoards || 0;
  const datasetStatus = {};

  const snapshotCounters = () => ({
    totalCompaniesScanned, totalErrors, droppedNoDate, droppedContent,
    noDateSkipCompanies, noDateSkipJobs, cappedBoards,
  });
  const checkpointBase = () => ({
    version: 1,
    cutoffMs: cutoff,
    ats: opts.ats,
    limit: opts.limit === Infinity ? null : opts.limit,
    includeUndated: opts.includeUndated,
    completedSources: [...completedSources],
    offers: newOffers,
    savedAt: new Date().toISOString(),
  });

  // Per-job filter chain, shared by the parallel sweep, the truncation retry
  // pass (workday), and date enrichment (icims). Closure over the filters and
  // counters so both passes update the same run totals.
  const processJobs = async (jobs, sourceName, provider) => {
    for (const job of jobs) {
      if (!job.url || !job.title) continue;
      // Confirmed-stale postings are always dropped. Undated postings are
      // dropped by default (a reverse scan targets *fresh* roles) but
      // COUNTED so callers see the gap; --include-undated keeps them, marked.
      let dateClass = classifyPostingDate(job, cutoff);
      if (dateClass === 'stale') continue;
      // Providers whose list pages carry no date (icims) get one shot at dating
      // the posting from its detail page — but only after the cheap title and
      // location filters pass, so a 10k-tenant sweep never pays a detail-page
      // request for noise. The same (location, url) pair as the real filter
      // below: a stricter gate here would deny enrichment to jobs the final
      // check would have kept.
      //
      // Deliberately OUTSIDE the includeUndated branch. Gating enrichment on
      // !includeUndated meant --include-undated left every icims posting
      // undated, and since classifyPostingDate can never call an undated
      // posting stale, --since was silently ignored for the entire source.
      // Enrich first, then let the undated policy decide.
      if (dateClass === 'undated' && provider.enrichDate
          && titleFilter(job.title) && locationFilter(job.location, job.url, job.title)) {
        try { await provider.enrichDate(job, ctx); } catch { /* stays undated */ }
        dateClass = classifyPostingDate(job, cutoff);
      }
      if (dateClass === 'stale') continue;
      if (dateClass === 'undated' && !opts.includeUndated) { droppedNoDate++; continue; }
      if (!titleFilter(job.title)) continue;
      // job.url is passed so the location filter can fall back to the URL's own
      // location segment when the provider reports a rolled-up "N Locations" string;
      // job.title so a title-stated remote role survives a city-only location.
      if (!locationFilter(job.location, job.url, job.title)) continue;
      if (!contentFilter(job.description, matchedTitleKeywords(job.title, fullTitleFilterConfig))) { droppedContent++; continue; }
      const dedupUrl = normalizeUrlForDedup(job.url);
      if (seenUrls.has(dedupUrl)) continue;
      seenUrls.add(dedupUrl); // intra-scan dedup
      newOffers.push({ ...job, source: `${sourceName}-full`, dateStatus: job.postedAt ? 'dated' : 'unknown' });
    }
  };

  // Run-level, because resolverOutage below is per-source and long out of
  // scope by the time the checkpoint's fate is decided at the end of main().
  let stoppedByOutage = false;

  for (const name of opts.ats) {
    const source = SOURCES[name];
    // Stats are accumulated BEFORE the completed-source skip: on --resume a
    // source finished before the checkpoint was written still contributed its
    // companies to the sweep, so it must still count toward the availability /
    // cap figures the final report and --json output show.
    const { list, status } = await loadCompanyList(name, source.dataset);
    datasetStatus[name] = status;
    totalCompaniesAvailable += list.length;
    if (opts.limit < list.length) capHit = true;
    if (completedSources.has(name)) {
      log(`\n⚙  ${name} — already complete in resumed checkpoint, skipping`);
      continue;
    }
    const datasetHash = datasetFingerprint(list);
    const entriesAll = sampleCompanies(list, opts.limit, opts.shuffle).map(source.toEntry).filter(Boolean);

    let startAt = 0;
    if (checkpoint && checkpoint.current?.name === name) {
      // datasetHash is absent in checkpoints written before this guard existed;
      // fall back to the length-only check for those rather than hard-failing.
      const hashMismatch = checkpoint.current.datasetHash != null
        && checkpoint.current.datasetHash !== datasetHash;
      if (checkpoint.current.datasetLen !== list.length || hashMismatch) {
        console.error(`Error: ${name} company dataset changed since the checkpoint — resume order is no longer valid. Delete ${CHECKPOINT_PATH} and rerun.`);
        process.exit(1);
      }
      startAt = checkpoint.current.resumeAt;
    }
    const entries = entriesAll.slice(startAt);
    totalCompaniesScanned += entries.length;
    log(`\n⚙  ${name} — ${entriesAll.length} companies${status !== 'ok' ? ` (dataset: ${status})` : ''}${startAt ? ` — resuming at ${startAt}` : ''}`);

    let errors = 0;
    let consecutiveResolverFailures = 0;
    let resolverOutage = false;
    // The board whose failure tripped the breaker. `name` is only the ATS
    // vendor, and the resume offset is only a position — neither tells the user
    // which board to try by hand once the resolver is back.
    let resolverOutageCompany = null;
    // Latest progress reported by parallelEach. It computes both on every item
    // but keeps neither, and a run stopped mid-source needs them after the
    // call returns to checkpoint where it actually stopped (#2283).
    let lastDone = 0;
    let lastResumeAt = 0;
    const truncated = [];
    await parallelEach(entries, source.concurrency ?? CONCURRENCY, async (entry) => {
      try {
        // The whole per-company unit — fetch AND processJobs (which may issue
        // per-job detail-page requests via provider.enrichDate) — runs inside
        // one watchdog, so enrichment latency can't blow past COMPANY_TIMEOUT_MS.
        await withTimeout((async () => {
          const jobs = await source.provider.fetch(entry, ctx);
          consecutiveResolverFailures = 0;
          if (jobs.workdayTruncated) truncated.push(entry);
          if (jobs.icimsTruncated) {
            cappedBoards++;
            if (opts.verbose) console.error(`  ⚠ ${name}/${entry.name}: hit the page cap — later postings not scanned`);
          }
          if (jobs.workdayNoDateSkip) { noDateSkipCompanies++; noDateSkipJobs += jobs.length; }
          await processJobs(jobs, name, source.provider);
        })(), COMPANY_TIMEOUT_MS, `${name}/${entry.name}`);
      } catch (err) {
        // Mostly defunct boards in the public dataset — expected noise, so the
        // default stays quiet; --verbose surfaces per-board failures.
        errors++;
        // A dead board and a dead resolver look identical one at a time; only
        // the *consecutive* run tells them apart, so any non-resolver outcome
        // resets the count (#2229).
        if (isResolverFailure(err)) {
          // Record only the first board past the limit: in-flight boards keep
          // failing after the flag is set, and the last of them is not the one
          // that tripped it.
          if (++consecutiveResolverFailures >= RESOLVER_FAILURE_LIMIT && !resolverOutage) {
            resolverOutage = true;
            resolverOutageCompany = entry.name;
          }
        } else {
          consecutiveResolverFailures = 0;
        }
        if (opts.verbose) console.error(`  ✗ ${name}/${entry.name}: ${err.message}`);
      }
    }, ({ done, resumeAt }) => {
      lastDone = done;
      lastResumeAt = resumeAt;
      if (done % 200 === 0 || done === entries.length) {
        progress(`  ${done}/${entries.length} scanned, ${newOffers.length} total matches\r`);
      }
      if (done % CHECKPOINT_EVERY === 0 && !opts.dryRun) {
        writeCheckpoint({
          ...checkpointBase(),
          current: { name, resumeAt: startAt + resumeAt, datasetLen: list.length, datasetHash },
          counters: {
            ...snapshotCounters(),
            // totalCompaniesScanned was bumped by the FULL entries.length up
            // front; a checkpoint must store only work actually attempted, or
            // a resumed run (which re-adds its own slice) double-counts the
            // completed portion in the final summary.
            totalCompaniesScanned: totalCompaniesScanned - (entries.length - done),
            totalErrors: totalErrors + errors,
          },
        });
      }
    }, () => resolverOutage);
    // Second chance for boards the parallel sweep truncated: retry alone on a
    // quiet line. Re-processing the full board is safe — seenUrls already
    // holds every match from the partial first pass.
    // Skipped entirely under a resolver outage: retrying boards one by one is
    // more of exactly the traffic the breaker just stopped.
    if (truncated.length && !resolverOutage) {
      log(`\n  ↻ retrying ${truncated.length} truncated board(s) sequentially...`);
      for (const entry of truncated) {
        try {
          await withTimeout((async () => {
            const jobs = await source.provider.fetch(entry, ctx);
            await processJobs(jobs, name, source.provider);
            if (jobs.workdayTruncated) {
              errors++; // still truncated on a quiet line — genuine board problem, move on
              if (opts.verbose) console.error(`  ✗ ${name}/${entry.name}: still truncated after sequential retry`);
            }
          })(), COMPANY_TIMEOUT_MS, `${name}/${entry.name} (retry)`);
        } catch (err) {
          errors++;
          if (opts.verbose) console.error(`  ✗ ${name}/${entry.name} (retry): ${err.message}`);
        }
      }
    }
    totalErrors += errors;
    if (resolverOutage) {
      // Deliberately before completedSources/checkpoint: this source did NOT
      // finish, and marking it done would make --resume skip the rest of it.
      stoppedByOutage = true;
      // The counter was bumped by the FULL entries.length up front, but the
      // breaker left entries.length - lastDone boards unattempted. Correct the
      // live counter, not just the checkpoint payload: this run's own summary
      // and --json would otherwise report companies nobody ever contacted as
      // scanned. Correcting it here also gives the checkpoint the right figure
      // for free — a resumed run re-adds its own slice, so a checkpoint holding
      // the full slice makes the completed portion count twice.
      totalCompaniesScanned -= entries.length - lastDone;
      // Pin the resume point here rather than leaving the last periodic write
      // to stand for it. That one fires every CHECKPOINT_EVERY companies, so
      // it can be up to 500 boards behind where the breaker actually stopped —
      // and --resume would replay all of them against the resolver that just
      // refused.
      let checkpointWritten = false;
      if (!opts.dryRun) {
        checkpointWritten = writeCheckpoint({
          ...checkpointBase(),
          current: { name, resumeAt: startAt + lastResumeAt, datasetLen: list.length, datasetHash },
          counters: snapshotCounters(),
        });
      }
      log(`\n  ⛔ stopped ${name}/${resolverOutageCompany}: ${RESOLVER_FAILURE_LIMIT} consecutive DNS failures.`);
      log(`     Your resolver is refusing queries — it may be rate-limiting this host.`);
      log(`     Lower CONCURRENCY, raise the resolver's per-client limit, or set`);
      log(`     CAREER_OPS_NO_DNS_CACHE=1 only if you know the cache is at fault.`);
      // Only claim resumability when a checkpoint actually exists: --dry-run
      // writes none, and a failed write (ENOSPC, read-only volume) leaves at
      // best the last periodic checkpoint — nothing at the offset named here.
      if (checkpointWritten) log(`     Rerun with --resume once the resolver recovers — checkpointed at company ${startAt + lastResumeAt} of ${name}.`);
      break;
    }
    completedSources.add(name);
    if (!opts.dryRun) {
      writeCheckpoint({ ...checkpointBase(), current: null, counters: snapshotCounters() });
    }
    log(`\n  done (${errors} unreachable boards skipped)`);
  }

  // ── VC portfolio seed sources (--seeds flag) ───────────────────────
  for (const seedId of opts.seeds) {
    const seedSource = SEED_SOURCES[seedId];
    log(`\n🌱 ${seedSource.label} (${seedId}-seed) — fetching portfolio...`);
    const result = await runSeedScan(seedId, opts, ctx, seenUrls, seedSource.label);
    if (result && result.offers) {
      totalCompaniesScanned += result.total || 0;
      totalErrors += result.errors || 0;
      newOffers.push(...result.offers);
      log(`  done — ${result.total} companies probed, ${result.offers.length} matches (${result.errors} errors)`);
    }
  }

  const blacklistResult = filterBlacklistedOffers(newOffers, blacklist, { includeBlacklisted: opts.includeBlacklisted });
  let offers = blacklistResult.offers;
  if (offers.length && opts.liveness) offers = await filterLive(offers);
  offers.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));

  log(`\n${'━'.repeat(45)}`);
  log(`Reverse ATS Scan — ${date}`);
  log(`${'━'.repeat(45)}`);
  log(`Companies scanned:  ${totalCompaniesScanned}${capHit ? ` of ${totalCompaniesAvailable} (capped)` : ''}`);
  log(`Unreachable boards: ${totalErrors}`);
  if (cappedBoards) log(`Page-capped boards: ${cappedBoards} (partial coverage — later postings not scanned)`);
  // A paced sweep is slower on purpose. Say so, or the operator reads the
  // wall-clock time as a hang (#2229).
  const pacing = dnsPacingStats();
  if (pacing.delayed > 0) {
    log(`DNS pacing:         ${pacing.delayed} lookup${pacing.delayed === 1 ? '' : 's'} delayed, ${Math.round(pacing.waitedMs / 1000)}s total wait (CAREER_OPS_DNS_LOOKUPS_PER_MIN to tune, 0 disables)`);
  }
  // noDateSkipJobs is a subset of droppedNoDate, not a separate pool: every
  // no-postedOn workday posting counted here also hits the per-job undated
  // filter in the scan loop above and gets dropped there too. Report it as
  // a breakdown, not a second count — the two aren't additive.
  if (droppedNoDate) {
    const breakdown = noDateSkipCompanies
      ? ` (incl. ${noDateSkipJobs} from ${noDateSkipCompanies} workday companies with no postedOn)`
      : '';
    log(`Undated dropped: ${droppedNoDate}${breakdown}${opts.includeUndated ? '' : '. Use --include-undated to keep'}`);
  }
  if (blacklist.size > 0) {
    if (opts.includeBlacklisted) {
      log(`Blacklisted:      ${blacklistResult.annotatedBlacklisted} let through annotated (--include-blacklisted)`);
    } else {
      log(`Blacklisted:      ${blacklistResult.filteredBlacklist} skipped (blacklist)`);
    }
  }
  if (droppedContent) log(`Content-filtered:   ${droppedContent}`);
  log(`New matches:        ${offers.length}`);

  if (offers.length) {
    log('\nNew offers:');
    for (const o of offers) {
      const posted = o.postedAt ? new Date(o.postedAt).toISOString().slice(0, 10) : 'n/a';
      const blacklistSuffix = o.blacklisted ? ' [BLACKLISTED — on your do-not-apply list]' : '';
      log(`  + [${o.source}] ${posted} | ${o.company} | ${o.title} | ${o.location || 'N/A'}${blacklistSuffix}\n    ${o.url}`);
    }
  }

  // Persist (unless dry-run, or nothing to save).
  let saved = false;
  if (offers.length && !opts.dryRun) {
    // appendToPipeline assumes the file exists (onboarding creates it) — cover fresh setups.
    if (!existsSync(PIPELINE_PATH)) {
      mkdirSync(path.dirname(PIPELINE_PATH), { recursive: true });
      writeFileSync(PIPELINE_PATH, '# Pipeline\n\n## Pendientes\n', 'utf-8');
    }
    await appendToPipeline(offers);
    await appendToScanHistory(offers, date);
    saved = true;
    log(`\nResults saved to ${PIPELINE_PATH} and data/scan-history.tsv`);

    if (opts.mdOut) {
      try {
        mkdirSync(opts.mdOut, { recursive: true });
        const digest = [
          `# Reverse ATS Scan — ${date}`,
          `> ${offers.length} jobs | since ${opts.sinceDays}d | ${opts.liveness ? 'liveness ✓' : 'no liveness check'}`,
          '',
          ...offers.map(o => {
            const posted = o.postedAt ? new Date(o.postedAt).toISOString().slice(0, 10) : 'n/a';
            return `- [${o.title} @ ${o.company}](${o.url}) — ${o.location || 'N/A'} | ${o.source} | ${posted}`;
          }),
          '',
        ].join('\n');
        writeFileSync(path.join(opts.mdOut, `${date}.md`), digest, 'utf-8');
        log(`Markdown digest saved to ${path.join(opts.mdOut, `${date}.md`)}`);
      } catch (err) {
        console.error(`⚠️  Could not write markdown digest: ${err.message}`);
      }
    }
  }

  // Sweep completed — the checkpoint's job is done. A run the breaker stopped
  // did NOT complete: deleting here would destroy the resume point the outage
  // branch just wrote, which is the one case --resume exists for (#2283).
  if (!opts.dryRun && !stoppedByOutage && existsSync(CHECKPOINT_PATH)) unlinkSync(CHECKPOINT_PATH);

  // The authoritative machine-readable result: lets a caller (e.g. the web)
  // tell a *degraded* scan (capped / stale dataset / undated dropped) apart
  // from a genuinely *empty* one. In --json mode stdout carries ONLY this.
  if (opts.json) {
    process.stdout.write(JSON.stringify({
      date,
      sources: opts.ats,
      resumed: Boolean(checkpoint),
      sinceDays: opts.sinceDays,
      companiesAvailable: totalCompaniesAvailable,
      companiesScanned: totalCompaniesScanned,
      capHit,
      // The most degraded outcome this payload can report: the sweep did not
      // finish its sources, and a checkpoint is waiting for --resume. Without
      // it a caller can't tell a stopped run from a complete one except by
      // stat'ing the checkpoint file itself.
      stoppedByOutage,
      datasetStatus,
      postingsKept: offers.length,
      postingsDroppedNoDate: droppedNoDate,
      postingsFilteredBlacklist: blacklistResult.filteredBlacklist,
      postingsAnnotatedBlacklisted: blacklistResult.annotatedBlacklisted,
      postingsDroppedContent: droppedContent,
      unreachableBoards: totalErrors,
      cappedBoards,
      dnsPacing: { delayed: pacing.delayed, waitedMs: Math.round(pacing.waitedMs) },
      saved,
      offers: offers.map(o => ({
        company: o.company,
        title: o.title,
        url: o.url,
        location: o.location || null,
        postedAt: o.postedAt ? new Date(o.postedAt).toISOString().slice(0, 10) : null,
        dateStatus: o.dateStatus || (o.postedAt ? 'dated' : 'unknown'),
        blacklisted: Boolean(o.blacklisted),
        note: o.note || null,
        source: o.source,
      })),
    }) + '\n');
    return;
  }

  if (!offers.length) {
    log('\nNothing new.');
    return;
  }
  if (opts.dryRun) {
    log('\n(dry run — run without --dry-run to save results)');
    return;
  }
  log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
}

// Only run main() when invoked directly, not when imported by tests.
if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
