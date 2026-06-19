#!/usr/bin/env node

/**
 * discover-web3vacancy.mjs — Company discovery from web3vacancy.com
 *
 * Reads the web3vacancy.com sitemap-jobs.xml, extracts every {company-slug}
 * from URL pattern /job/{role}-at-{company-slug}-{numeric-id}, diffs against:
 *   1. tracked_companies in portals.yml (normalized to slugs)
 *   2. data/web3vacancy-dismissed.tsv (per-user dismiss ledger)
 *
 * Outputs a markdown table of NEW candidates so the user can decide per-company:
 *   add → add to portals.yml with canonical ATS careers_url
 *   dismiss → append slug to data/web3vacancy-dismissed.tsv
 *   defer → no action; will reappear next run
 *
 * Web3vacancy listing TTL is ~30 days, so a weekly cadence catches every new
 * company before its first posting expires.
 *
 * Zero LLM tokens. Single HTTP call. Idempotent (safe to run repeatedly).
 *
 * Usage:
 *   node discover-web3vacancy.mjs          # print markdown table
 *   node discover-web3vacancy.mjs --json   # print JSON instead
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';

// ── Config ──────────────────────────────────────────────────────────

const SITEMAP_URL = 'https://web3vacancy.com/sitemap-jobs.xml';
const PORTALS_PATH = 'portals.yml';
const DISMISSED_PATH = 'data/web3vacancy-dismissed.tsv';
const FETCH_TIMEOUT_MS = 25_000;

// ── Helpers ─────────────────────────────────────────────────────────

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (career-ops discover-web3vacancy)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize a company name to a slug for cross-source comparison.
 * Matches the conventions web3vacancy uses in its URLs.
 *
 * Examples:
 *   "Sanctum"           → "sanctum"
 *   "Magic Eden"        → "magic-eden"
 *   "Magic.Eden"        → "magic-eden"
 *   "Solana Foundation" → "solana-foundation"
 *   "Mango Markets (Blueberry Foundation)" → "mango-markets-blueberry-foundation"
 *   "Getro: DCG portfolio" → "getro-dcg-portfolio"  (we filter these out separately)
 */
function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/[()&]/g, ' ')
    .replace(/[.,/_]/g, '-')
    .replace(/:\s+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract every job URL from web3vacancy sitemap-jobs.xml.
 * Returns [{ url, slug, role, id }, ...] where slug is the company-slug
 * portion of /job/{role}-at-{slug}-{id}.
 */
function parseSitemapEntries(xml) {
  // Sitemap entries look like:
  //   <url><loc>https://web3vacancy.com/job/senior-staff-pm-token-listing-at-okx-7638</loc>...</url>
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  const entries = [];
  // URL pattern: /job/{role-slug}-at-{company-slug}-{numeric-id}
  // company-slug may contain hyphens, numeric-id is at the end.
  // We anchor on the LAST `-{digits}$` for the id, and the LAST `-at-` for the role/company boundary.
  for (const url of urls) {
    const m = url.match(/\/job\/(.+)-at-([^/]+?)-(\d+)$/);
    if (!m) continue;
    const [, role, slug, id] = m;
    entries.push({ url, slug, role, id });
  }
  return entries;
}

/**
 * Load portals.yml and produce a Set of slugs for every tracked company name.
 * We also produce slug variants because portals.yml names use various forms
 * (e.g., "Getro: Solana Network Opportunities" vs the underlying domain).
 */
function loadKnownCompanySlugs() {
  const cfg = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = cfg.tracked_companies || [];
  const slugs = new Set();
  for (const c of companies) {
    if (!c.name) continue;
    slugs.add(nameToSlug(c.name));

    // Strip parenthetical disambiguators: "Anza (fka Solana Labs)" → "Anza"
    const stripped = c.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (stripped && stripped !== c.name) slugs.add(nameToSlug(stripped));

    // "Getro: <fund> portfolio" → also add <fund> slug for cross-matching
    const getroMatch = c.name.match(/^Getro:\s*(.+?)\s*(?:portfolio|ecosystem|opportunities)?$/i);
    if (getroMatch) slugs.add(nameToSlug(getroMatch[1]));

    // careers_url-based slug derivation (catches Greenhouse/Ashby/Lever slugs)
    if (c.careers_url) {
      const url = c.careers_url;
      const ashby = url.match(/ashbyhq\.com\/([^/?#]+)/i);
      if (ashby) slugs.add(ashby[1].toLowerCase());
      const lever = url.match(/lever\.co\/([^/?#]+)/i);
      if (lever) slugs.add(lever[1].toLowerCase());
      const gh = url.match(/greenhouse\.io\/([^/?#]+)/i);
      if (gh) slugs.add(gh[1].toLowerCase());
    }
  }
  return slugs;
}

function loadDismissedSlugs() {
  if (!existsSync(DISMISSED_PATH)) return new Set();
  const dismissed = new Set();
  const lines = readFileSync(DISMISSED_PATH, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const slug = trimmed.split('\t')[0].toLowerCase();
    if (slug) dismissed.add(slug);
  }
  return dismissed;
}

function ensureDismissedFile() {
  if (existsSync(DISMISSED_PATH)) return;
  mkdirSync('data', { recursive: true });
  writeFileSync(
    DISMISSED_PATH,
    '# discover-web3vacancy dismissed slugs (one per line)\n' +
      '# Format: slug<TAB>YYYY-MM-DD<TAB>note (date and note optional)\n' +
      '# Add a slug here to suppress it from future discovery runs.\n',
    'utf-8',
  );
}

// ── Main ────────────────────────────────────────────────────────────

function humanizeSlug(slug) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function humanizeRole(roleSlug) {
  return roleSlug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');

  ensureDismissedFile();

  console.error(`Fetching ${SITEMAP_URL}...`);
  let xml;
  try {
    xml = await fetchText(SITEMAP_URL);
  } catch (err) {
    console.error(`Failed to fetch sitemap: ${err.message}`);
    process.exit(1);
  }

  const entries = parseSitemapEntries(xml);
  console.error(`Parsed ${entries.length} job URLs from sitemap.`);

  // Group entries by company-slug, keep first-seen role + URL as sample.
  const bySlug = new Map();
  for (const e of entries) {
    if (bySlug.has(e.slug)) continue;
    bySlug.set(e.slug, e);
  }
  const allSlugs = [...bySlug.keys()];
  console.error(`Unique companies in sitemap: ${allSlugs.length}`);

  const knownSlugs = loadKnownCompanySlugs();
  const dismissedSlugs = loadDismissedSlugs();
  console.error(`Already tracked (portals.yml): ${knownSlugs.size}`);
  console.error(`Already dismissed (data/web3vacancy-dismissed.tsv): ${dismissedSlugs.size}`);

  // Compute candidates: in sitemap, not in portals.yml, not dismissed.
  const candidates = allSlugs
    .filter(slug => !knownSlugs.has(slug))
    .filter(slug => !dismissedSlugs.has(slug))
    .sort();

  console.error(`New candidates: ${candidates.length}`);
  console.error('');

  if (asJson) {
    const payload = candidates.map(slug => {
      const e = bySlug.get(slug);
      return {
        slug,
        sample_role: humanizeRole(e.role),
        sample_url: e.url,
      };
    });
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Markdown table output (human-readable default).
  if (candidates.length === 0) {
    console.log('No new candidates today. Re-run weekly.');
    return;
  }

  console.log('# Web3vacancy Discovery Candidates');
  console.log('');
  console.log(
    'Companies on web3vacancy.com NOT yet in portals.yml and NOT dismissed. ' +
      'For each, decide: add to portals.yml with canonical ATS careers_url, ' +
      `or append to ${DISMISSED_PATH} to suppress next run.`,
  );
  console.log('');
  console.log('| # | Company (humanized) | Slug | Sample role | Sample URL |');
  console.log('|---|---|---|---|---|');
  candidates.forEach((slug, i) => {
    const e = bySlug.get(slug);
    console.log(
      `| ${i + 1} | ${humanizeSlug(slug)} | \`${slug}\` | ${humanizeRole(e.role)} | ${e.url} |`,
    );
  });
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
