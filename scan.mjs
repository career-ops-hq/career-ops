#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, and Lever APIs directly, applies title
 * filters from portals.yml, deduplicates against existing history,
 * and appends new offers to pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 25_000; // Bumped from 10s -> 25s on 2026-05-29 after benchmarks showed
                                  // Ashby's posting-api/job-board endpoint responds in 10-19s even
                                  // single-thread (server-side delay, NOT concurrency queueing).
                                  // 25s catches all observed Ashby boards including outliers under
                                  // parallel load. Lever / Greenhouse / Workable all respond sub-2s
                                  // and are unaffected by this larger ceiling.

// ── API detection ───────────────────────────────────────────────────

const GETRO_HOST_RE = /^(?:jobs|careers|portfoliojobs)\.[a-z0-9-]+\.(?:com|org|io|xyz|vc|capital|fund|co|network)$|\.getro\.com$/i;

function detectApi(company) {
  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  // Getro: explicit `type: getro` in YAML OR known Getro host pattern.
  // Getro boards SSR up to 20 jobs per keyword query into `_next/data/{buildId}/jobs.json?q=...`.
  // Build ID rotates on each Getro deploy, so we detect it dynamically from the board HTML.
  if (company.type === 'getro' && url) {
    try {
      const host = new URL(url).host;
      return { type: 'getro', host };
    } catch { /* fall through */ }
  }

  // Onchainhires (Jobited-powered aggregator): explicit `type: onchainhires` in YAML.
  // Exposes a clean REST API at api.onchainhires.com/v1/jobs?page=N&limit=N (paginated).
  if (company.type === 'onchainhires') {
    return { type: 'onchainhires', host: 'api.onchainhires.com' };
  }

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever (covers both US and EU shards). EU shard support added 2026-05-30 after
  // Aave (`jobs.eu.lever.co/aavelabs`) was silently skipped, missing 12 active jobs
  // including "Staff Smart Contract Engineer".
  const leverMatch = url.match(/jobs(?:\.eu)?\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    const apiHost = url.includes('jobs.eu.lever.co') ? 'api.eu.lever.co' : 'api.lever.co';
    return {
      type: 'lever',
      url: `https://${apiHost}/v0/postings/${leverMatch[1]}`,
    };
  }

  // Workable (local patch — see notes at top of file)
  const workableMatch = url.match(/apply\.workable\.com\/([^/?#]+)/);
  if (workableMatch) {
    return {
      type: 'workable',
      url: `https://apply.workable.com/api/v1/widget/accounts/${workableMatch[1]}?details=true`,
    };
  }

  // Greenhouse boards: matches both newer `job-boards.greenhouse.io/{slug}` and older `boards.greenhouse.io/{slug}` patterns,
  // plus their `.eu` shard variants. Extended 2026-05-29 to cover ~10 portals.yml entries that were
  // silently skipped (Uniswap Labs, OP Labs, Offchain Labs, LayerZero, Chainlink, StarkWare, Scroll,
  // Render Network, Helium / Nova Labs, Hivemapper). All Greenhouse boards share the same API host
  // (`boards-api.greenhouse.io`), so the slug is the only thing that varies.
  const ghMatch = url.match(/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghMatch[1]}/jobs`,
    };
  }

  return null;
}

// ── API parsers ─────────────────────────────────────────────────────

// Coerce any of (ISO string, Unix ms, Unix seconds, YYYY-MM-DD) → Unix seconds, or null.
// Used to harvest a portable `postedAt` from each ATS so the freshness filter can apply uniformly.
function toUnixSeconds(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    // Heuristic: >1e12 → milliseconds; otherwise seconds.
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return isNaN(t) ? null : Math.floor(t / 1000);
  }
  return null;
}

function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
    postedAt: toUnixSeconds(j.updated_at || j.first_published),
  }));
}

function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
    postedAt: toUnixSeconds(j.publishedAt || j.updatedAt),
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
    postedAt: toUnixSeconds(j.createdAt),
  }));
}

function parseWorkable(json, companyName) {
  const jobs = json?.jobs || [];
  return jobs.map(j => {
    const locParts = [j.city, j.state, j.country].filter(Boolean);
    const baseLocation = locParts.join(', ');
    const location = j.telecommuting
      ? (baseLocation ? `Remote / ${baseLocation}` : 'Remote')
      : baseLocation;
    return {
      title: j.title || '',
      url: j.url || j.shortlink || '',
      company: companyName,
      location,
      postedAt: toUnixSeconds(j.published_on || j.published_at || j.created_at),
    };
  });
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever, workable: parseWorkable };

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Getro adapter ───────────────────────────────────────────────────
// Getro powers VC/ecosystem boards (jobs.solana.com, coinbase.getro.com, jobs.optimism.io, etc.).
// Their public API requires auth, but each board SSRs jobs into Next.js page data:
//   https://{host}/_next/data/{buildId}/jobs.json?q={keyword}
// Returns up to 20 keyword-matched jobs in `pageProps.initialState.jobs.found`.
// We probe one keyword per `title_filter.positive` term and union by job id.
// The `url` field on each job points to the underlying ATS (Lever/Ashby/Greenhouse), so the
// existing scan-history URL dedup naturally collapses cross-board overlaps.

const GETRO_UA = 'Mozilla/5.0 (career-ops scan.mjs)';

async function detectGetroBuildId(host) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${host}/jobs`, {
      headers: { 'User-Agent': GETRO_UA },
      signal: controller.signal,
      redirect: 'follow',
    });
    const html = await res.text();
    const m = html.match(/_next\/static\/([A-Za-z0-9_-]+)\/_buildManifest/);
    if (!m) throw new Error(`no buildId on ${host}`);
    return m[1];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGetroKeyword(host, buildId, kw) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://${host}/_next/data/${buildId}/jobs.json?q=${encodeURIComponent(kw)}`,
      { headers: { 'User-Agent': GETRO_UA, 'Accept': 'application/json' }, signal: controller.signal },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.pageProps?.initialState?.jobs?.found || [];
  } catch { return []; }
  finally { clearTimeout(timer); }
}

// ── Onchainhires adapter ────────────────────────────────────────────
// Onchainhires (Jobited-powered) is a per-job aggregator: many companies, one board.
// Public REST API at api.onchainhires.com/v1/jobs?page=N&limit=N returns
//   { success, message, data: [...jobs], meta: { total } }.
// Each job has: id, name (title), company.name, locations, createdAt, isActive, etc.
// Listing URL is constructed as https://onchainhires.com/jobs/{id}.

async function fetchOnchainhires(host, defaultCompanyName) {
  const PAGE_SIZE = 50;
  const MAX_PAGES = 20;
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let data;
    try {
      data = await fetchJson(`https://${host}/v1/jobs?page=${page}&limit=${PAGE_SIZE}`);
    } catch { break; }
    const items = Array.isArray(data?.data) ? data.data : [];
    if (!items.length) break;
    for (const j of items) {
      if (j?.isActive === false) continue;
      const locRaw = j.locations;
      const location = Array.isArray(locRaw)
        ? locRaw.map(l => l?.city || l?.country || l).filter(Boolean).join(', ')
        : (typeof locRaw === 'object' ? (locRaw?.city || locRaw?.country || '') : '');
      out.push({
        title: j.name || '',
        url: j.id ? `https://onchainhires.com/jobs/${j.id}` : '',
        company: j.company?.name || defaultCompanyName,
        location,
        postedAt: toUnixSeconds(j.createdAt),
      });
    }
    const total = data?.meta?.total;
    if (total != null && out.length >= total) break;
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

async function fetchGetroBoard(host, positiveKeywords, companyName) {
  const buildId = await detectGetroBuildId(host);

  // Fan out keyword queries in parallel (typically ~10 queries × ~1s each → ~1s total instead of ~10s).
  const results = await Promise.all(
    positiveKeywords.map(kw => fetchGetroKeyword(host, buildId, kw)),
  );

  const seen = new Map();
  for (const found of results) {
    for (const j of found) {
      if (!j?.url || seen.has(j.id)) continue;
      seen.set(j.id, {
        title: j.title || '',
        url: j.url,
        company: j.organization?.name || companyName,
        location: Array.isArray(j.locations) ? j.locations.join(', ') : '',
        postedAt: toUnixSeconds(j.createdAt),
      });
    }
  }
  return [...seen.values()];
}

// ── Title filter ────────────────────────────────────────────────────

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function formatOfferLine(o) {
  const now = Math.floor(Date.now() / 1000);
  let staleTag = '';
  if (o.stale && o.postedAt) {
    const ageDays = Math.floor((now - o.postedAt) / 86400);
    staleTag = ` | STALE ${ageDays}d`;
  }
  return `- [ ] ${o.url} | ${o.company} | ${o.title}${staleTag}`;
}

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = readFileSync(PIPELINE_PATH, 'utf-8');

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(formatOfferLine).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(formatOfferLine).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);

  // 2. Filter to enabled companies with detectable APIs
  const enabledAndFiltered = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }));

  const targets = enabledAndFiltered.filter(c => c._api !== null);
  // P0.1: track which companies were silently skipped so we can list them in the summary.
  // Without this, users have no visibility into which companies fell out of coverage
  // because their careers_url doesn't match any known ATS pattern, or they have no
  // careers_url at all (websearch-only entries).
  const skipped = enabledAndFiltered.filter(c => c._api === null);

  console.log(`Scanning ${targets.length} companies via API (${skipped.length} skipped — no API detected)`);
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFiltered = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];

  const positiveKeywords = config.title_filter?.positive || [];

  // Freshness gate (added 2026-05-30 after repeat misses surfaced expired postings).
  // Per user-memory rule: <30d fresh, 30-90d stale-with-warning, >90d EXCLUDE.
  // Applied here so the gate covers every adapter (greenhouse/ashby/lever/workable/getro)
  // — adapters now harvest `postedAt` (Unix seconds) when the source exposes it.
  // Jobs missing postedAt pass through (we cannot prove they are old).
  const NOW_SEC = Math.floor(Date.now() / 1000);
  const STALE_AFTER = 30 * 86400;
  const EXCLUDE_AFTER = 90 * 86400;
  let totalExpired = 0;
  let totalStale = 0;

  const tasks = targets.map(company => async () => {
    const { type, url, host } = company._api;
    try {
      let jobs;
      if (type === 'getro') {
        jobs = await fetchGetroBoard(host, positiveKeywords, company.name);
      } else if (type === 'onchainhires') {
        jobs = await fetchOnchainhires(host, company.name);
      } else {
        const json = await fetchJson(url);
        jobs = PARSERS[type](json, company.name);
      }
      totalFound += jobs.length;

      for (const job of jobs) {
        if (!titleFilter(job.title)) {
          totalFiltered++;
          continue;
        }
        // Freshness gate — exclude jobs proven to be older than EXCLUDE_AFTER.
        // Jobs without postedAt pass (cannot prove staleness).
        if (job.postedAt != null) {
          const ageSec = NOW_SEC - job.postedAt;
          if (ageSec > EXCLUDE_AFTER) {
            totalExpired++;
            continue;
          }
          if (ageSec > STALE_AFTER) totalStale++;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        const stale = job.postedAt != null && (NOW_SEC - job.postedAt) > STALE_AFTER;
        newOffers.push({ ...job, source: `${type}-api`, stale });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // 5. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // 6. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${targets.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFiltered} removed`);
  console.log(`Expired (>90d):        ${totalExpired} excluded`);
  console.log(`Stale (30-90d):        ${totalStale} included with warning`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  // P0.1: surface the names of skipped companies so the user knows what fell out of coverage.
  if (skipped.length > 0) {
    console.log(`\nSkipped (${skipped.length} — no API detected):`);
    for (const c of skipped) {
      const reason = c.careers_url
        ? `no recognized ATS pattern (${c.careers_url})`
        : 'no careers_url (websearch-only)';
      console.log(`  - ${c.name}: ${reason}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/8pRpHETxa4');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
