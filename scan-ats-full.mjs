#!/usr/bin/env node

/**
 * scan-ats-full.mjs — Reverse ATS discovery scanner. Part of #230.
 *
 * Where scan.mjs scans the companies you track in portals.yml, this script
 * inverts the direction: it walks public directories of companies per ATS
 * (Greenhouse, Lever, Ashby, Workday) and surfaces fresh postings that match
 * your portals.yml `title_filter` / `location_filter` — no manual company
 * curation needed.
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
 *   node scan-ats-full.mjs --verbose            # log per-board fetch failures
 *   node scan-ats-full.mjs --md-out <dir>       # also write a dated markdown digest to <dir>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';
import yaml from 'js-yaml';

import { makeHttpCtx, fetchJson } from './providers/_http.mjs';
import greenhouse from './providers/greenhouse.mjs';
import lever from './providers/lever.mjs';
import ashby from './providers/ashby.mjs';
import workday from './providers/workday.mjs';
import { buildTitleFilter, buildLocationFilter, loadSeenUrls, appendToPipeline, appendToScanHistory } from './scan.mjs';

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || 'portals.yml';
const PIPELINE_PATH = 'data/pipeline.md';
const CACHE_DIR = 'data/cache/ats-companies';
const CACHE_TTL_HOURS = 24;
// Tracks `main` deliberately: the dataset's value is freshness (new boards
// appear weekly), so pinning a commit would defeat the purpose. The integrity
// boundary is SLUG_RE below — every entry is validated against a safe charset
// before it is interpolated into a provider URL, so a tampered dataset can at
// worst name boards that don't exist.
const DATASET_BASE = 'https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data';
const CONCURRENCY = 20;

// Dataset entries are external input destined for URL interpolation — reject
// anything outside a conservative slug charset.
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

// Each source: the provider module that does the fetching, plus how to turn a
// dataset entry into a synthetic PortalEntry the provider can detect/fetch.
const SOURCES = {
  greenhouse: {
    provider: greenhouse,
    dataset: `${DATASET_BASE}/greenhouse_companies.json`,
    toEntry: (slug) => SLUG_RE.test(String(slug))
      ? { name: String(slug), careers_url: `https://job-boards.greenhouse.io/${slug}` } : null,
  },
  lever: {
    provider: lever,
    dataset: `${DATASET_BASE}/lever_companies.json`,
    toEntry: (slug) => SLUG_RE.test(String(slug))
      ? { name: String(slug), careers_url: `https://jobs.lever.co/${slug}` } : null,
  },
  ashby: {
    provider: ashby,
    dataset: `${DATASET_BASE}/ashby_companies.json`,
    toEntry: (slug) => SLUG_RE.test(String(slug))
      ? { name: String(slug), careers_url: `https://jobs.ashbyhq.com/${slug}` } : null,
  },
  workday: {
    provider: workday,
    dataset: `${DATASET_BASE}/workday_companies.json`,
    // Dataset entries are "tenant|instance|site" triples.
    toEntry: (line) => {
      const [tenant, instance, site] = String(line).split('|');
      if (![tenant, instance, site].every(p => p && SLUG_RE.test(p))) return null;
      return { name: tenant, careers_url: `https://${tenant}.${instance}.myworkdayjobs.com/${site}` };
    },
  },
};

// ── CLI args ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const valueOf = (flag) => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
    const kv = args.find(a => a.startsWith(flag + '='));
    return kv ? kv.split('=').slice(1).join('=') : null;
  };
  const sinceDays = Number(valueOf('--since')) || 3;
  const limit = Number(valueOf('--limit')) || Infinity;
  const atsArg = valueOf('--ats');
  const ats = atsArg ? atsArg.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : Object.keys(SOURCES);
  const unknown = ats.filter(a => !SOURCES[a]);
  if (unknown.length) {
    console.error(`Error: unknown ATS source(s): ${unknown.join(', ')}. Valid: ${Object.keys(SOURCES).join(', ')}`);
    process.exit(1);
  }
  return {
    sinceDays,
    limit,
    ats,
    dryRun: args.includes('--dry-run'),
    liveness: args.includes('--liveness'),
    verbose: args.includes('--verbose'),
    mdOut: valueOf('--md-out'),
  };
}

// ── Company list cache (24h TTL) ────────────────────────────────────

async function loadCompanyList(name, url) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${name}.json`);
  if (existsSync(cacheFile)) {
    const ageHours = (Date.now() - statSync(cacheFile).mtimeMs) / 3_600_000;
    if (ageHours < CACHE_TTL_HOURS) {
      try { return JSON.parse(readFileSync(cacheFile, 'utf-8')); } catch { /* refetch below */ }
    }
  }
  try {
    const data = await fetchJson(url, { timeoutMs: 30_000 });
    if (Array.isArray(data)) {
      writeFileSync(cacheFile, JSON.stringify(data), 'utf-8');
      return data;
    }
  } catch (err) {
    console.error(`⚠️  ${name}: could not download company list — ${err.message}`);
  }
  // Stale cache beats nothing.
  if (existsSync(cacheFile)) {
    try { return JSON.parse(readFileSync(cacheFile, 'utf-8')); } catch { /* fall through */ }
  }
  return [];
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelEach(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
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
  console.log(`\nVerifying liveness of ${offers.length} match(es) with Playwright (sequential)...`);
  const browser = await chromium.launch({ headless: true });
  const live = [];
  try {
    const page = await newLivenessPage(browser);
    // Sequential — project rule: never Playwright in parallel
    for (const offer of offers) {
      const { result, reason } = await checkUrlLiveness(page, offer.url);
      const icon = result === 'active' ? '✅' : result === 'expired' ? '❌' : '⚠️';
      console.log(`  ${icon} ${result.padEnd(9)} ${offer.company} | ${offer.title}${result === 'expired' ? ` (${reason})` : ''}`);
      if (result !== 'expired') live.push(offer); // keep 'uncertain' — transient errors retry next scan
    }
  } finally {
    await browser.close();
  }
  console.log(`  → ${live.length}/${offers.length} passed liveness`);
  return live;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  const cutoff = Date.now() - opts.sinceDays * 86_400_000;

  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first — the reverse scan reuses its title_filter/location_filter.');
    process.exit(1);
  }
  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  const titleFilter = buildTitleFilter(config?.title_filter);
  const locationFilter = buildLocationFilter(config?.location_filter);
  if (!config?.title_filter?.positive?.length) {
    console.error('⚠️  portals.yml has no title_filter.positive — every fresh posting on every board will match. Consider adding keywords.');
  }

  console.log(`Reverse ATS scan — sources: ${opts.ats.join(', ')} | since ${opts.sinceDays}d${opts.limit < Infinity ? ` | limit ${opts.limit}/ats` : ''}${opts.liveness ? ' | liveness' : ''}${opts.dryRun ? ' | DRY RUN' : ''}`);

  const { seen: seenUrls } = loadSeenUrls();
  const ctx = makeHttpCtx();
  const date = new Date().toISOString().slice(0, 10);

  const newOffers = [];
  let totalCompanies = 0;
  let totalErrors = 0;

  for (const name of opts.ats) {
    const source = SOURCES[name];
    const list = await loadCompanyList(name, source.dataset);
    const entries = list.slice(0, opts.limit).map(source.toEntry).filter(Boolean);
    totalCompanies += entries.length;
    console.log(`\n⚙  ${name} — ${entries.length} companies`);

    let done = 0;
    let errors = 0;
    await parallelEach(entries, CONCURRENCY, async (entry) => {
      try {
        const jobs = await source.provider.fetch(entry, ctx);
        for (const job of jobs) {
          if (!job.url || !job.title) continue;
          if (!job.postedAt || job.postedAt < cutoff) continue;
          if (!titleFilter(job.title)) continue;
          if (!locationFilter(job.location)) continue;
          if (seenUrls.has(job.url)) continue;
          seenUrls.add(job.url); // intra-scan dedup
          newOffers.push({ ...job, source: `${name}-full` });
        }
      } catch (err) {
        // Mostly defunct boards in the public dataset — expected noise, so the
        // default stays quiet; --verbose surfaces per-board failures.
        errors++;
        if (opts.verbose) console.error(`  ✗ ${name}/${entry.name}: ${err.message}`);
      }
      done++;
      if (done % 200 === 0 || done === entries.length) {
        process.stdout.write(`  ${done}/${entries.length} scanned, ${newOffers.length} total matches\r`);
      }
    });
    totalErrors += errors;
    console.log(`\n  done (${errors} unreachable boards skipped)`);
  }

  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Reverse ATS Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:  ${totalCompanies}`);
  console.log(`Unreachable boards: ${totalErrors}`);
  console.log(`New matches:        ${newOffers.length}`);

  if (newOffers.length === 0) {
    console.log('\nNothing new.');
    return;
  }

  const offers = opts.liveness ? await filterLive(newOffers) : newOffers;
  if (offers.length === 0) {
    console.log('\nAll matches expired after liveness check.');
    return;
  }

  offers.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
  console.log('\nNew offers:');
  for (const o of offers) {
    const posted = o.postedAt ? new Date(o.postedAt).toISOString().slice(0, 10) : 'n/a';
    console.log(`  + [${o.source}] ${posted} | ${o.company} | ${o.title} | ${o.location || 'N/A'}\n    ${o.url}`);
  }

  if (opts.dryRun) {
    console.log('\n(dry run — run without --dry-run to save results)');
    return;
  }

  // appendToPipeline assumes the file exists (onboarding creates it) — cover fresh setups.
  if (!existsSync(PIPELINE_PATH)) {
    mkdirSync(path.dirname(PIPELINE_PATH), { recursive: true });
    writeFileSync(PIPELINE_PATH, '# Pipeline\n\n## Pendientes\n', 'utf-8');
  }
  appendToPipeline(offers);
  appendToScanHistory(offers, date);
  console.log(`\nResults saved to ${PIPELINE_PATH} and data/scan-history.tsv`);

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
      console.log(`Markdown digest saved to ${path.join(opts.mdOut, `${date}.md`)}`);
    } catch (err) {
      console.error(`⚠️  Could not write markdown digest: ${err.message}`);
    }
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
}

// Only run main() when invoked directly, not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
