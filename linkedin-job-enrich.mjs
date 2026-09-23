#!/usr/bin/env node
/**
 * linkedin-job-enrich.mjs — Zero-LLM title/company verification for LinkedIn job URLs.
 *
 * Fetches the public job page HTML and parses og:title / h1 (no AI tokens).
 * Used to fix digest emails that assigned one subject title to many job links.
 *
 *   node linkedin-job-enrich.mjs --pipeline --limit 50
 *   node linkedin-job-enrich.mjs --self-test
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { withPipelineLock } from './pipeline-lock.mjs';
import { sanitizeMarkdownField } from './scan.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ROOT = getCareerOpsRoot();
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const CACHE_PATH = join(ROOT, 'data', 'linkedin-job-meta.tsv');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const GENERIC_OG_RE = /\d[\d,]*\+.*\bjobs?\b/i;

export function isLinkedInJobUrl(url) {
  return /linkedin\.com\/jobs\/view\/\d+/i.test(String(url ?? ''));
}

export function normTitle(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[|–—-]+/g, ' ')
    .trim();
}

/** True when stored title likely wrong vs canonical (not just minor punctuation). */
export function titlesDiffer(stored, canonical) {
  const a = normTitle(stored);
  const b = normTitle(canonical);
  if (!a || !b) return Boolean(canonical && canonical !== stored);
  if (a === b) return false;

  const tokenize = (s) => new Set(s.split(/\s+/).filter((w) => w.length > 2));
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  if (wordsA.size && wordsB.size) {
    const overlap = [...wordsA].filter((w) => wordsB.has(w)).length;
    const minSize = Math.min(wordsA.size, wordsB.size);
    // Same core role with a small suffix (e.g. "Product Manager" vs "Product Manager AI").
    if (overlap === minSize && Math.abs(wordsA.size - wordsB.size) <= 1) return false;
  }
  return true;
}

/**
 * Parse LinkedIn og:title — e.g. "Acme hiring Product Manager in Bengaluru | LinkedIn".
 * @returns {{ company?: string, title?: string, location?: string, expired?: boolean } | null}
 */
export function parseLinkedInOgTitle(content) {
  const text = String(content ?? '').trim();
  if (!text || GENERIC_OG_RE.test(text) || /open roles/i.test(text)) {
    return { expired: true };
  }

  let m = text.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)\s*\|\s*LinkedIn$/i);
  if (m) {
    return { company: m[1].trim(), title: m[2].trim(), location: m[3].trim() };
  }

  m = text.match(/^(.+?)\s+at\s+(.+?)\s*\|\s*LinkedIn$/i);
  if (m) return { title: m[1].trim(), company: m[2].trim(), location: '' };

  m = text.match(/^(.+?)\s*\|\s*LinkedIn$/i);
  if (m) return { title: m[1].trim(), company: '', location: '' };

  return null;
}

/** Extract job metadata from fetched HTML (no network). */
export function parseLinkedInJobHtml(html) {
  const og = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ?? '';
  const h1 =
    html.match(/class="[^"]*top-card-layout__title[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim() ??
    html.match(/topcard__title[^>]*>([^<]+)</i)?.[1]?.trim() ??
    '';
  const location =
    html.match(/class="[^"]*topcard__flavor[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim() ??
    html.match(/topcard__flavor--bullet[^>]*>([^<]+)</i)?.[1]?.trim() ??
    '';

  const fromOg = og ? parseLinkedInOgTitle(og) : null;
  if (fromOg?.expired) return { status: 'expired', ogTitle: og };
  if (fromOg?.title) {
    return {
      status: 'ok',
      title: fromOg.title,
      company: fromOg.company || '',
      location: fromOg.location || location,
      ogTitle: og,
    };
  }
  if (h1) {
    return { status: 'ok', title: h1, company: '', location, ogTitle: og };
  }
  return { status: 'error', ogTitle: og };
}

export async function fetchLinkedInJobPage(url, fetchFn = globalThis.fetch) {
  const canonical = String(url).replace(/^http:\/\//i, 'https://');
  const res = await fetchFn(canonical, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9' },
    redirect: 'follow',
  });
  if (!res.ok) return { url: canonical, status: 'error', httpStatus: res.status };
  const html = await res.text();
  return { url: canonical, html, excerpt: extractPageExcerpt(html), ...parseLinkedInJobHtml(html) };
}

export async function fetchLinkedInJobMeta(url, fetchFn = globalThis.fetch) {
  const page = await fetchLinkedInJobPage(url, fetchFn);
  const { html: _html, excerpt: _excerpt, ...meta } = page;
  return meta;
}

/** Compact excerpt from raw LinkedIn HTML (for agent / debug). */
export function extractPageExcerpt(html) {
  const og = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ?? '';
  const h1 =
    html.match(/top-card-layout__title[^>]*>([^<]+)</i)?.[1]?.trim() ??
    html.match(/topcard__title[^>]*>([^<]+)</i)?.[1]?.trim() ??
    '';
  const company =
    html.match(/topcard__org-name-link[^>]*>([^<]+)</i)?.[1]?.trim() ??
    html.match(/topcard__flavor--black-link[^>]*>([^<]+)</i)?.[1]?.trim() ??
    '';
  const location =
    html.match(/topcard__flavor--bullet[^>]*>([^<]+)</i)?.[1]?.trim() ??
    html.match(/topcard__flavor[^>]*>([^<]+)</i)?.[1]?.trim() ??
    '';
  const text = [og && `og: ${og}`, h1 && `h1: ${h1}`, company && `company: ${company}`, location && `location: ${location}`]
    .filter(Boolean)
    .join('\n');
  return text.slice(0, 1500);
}

export function collectLinkedInPipelineRows(lines) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (!m || m[1].toLowerCase() === 'x') continue;
    const parts = m[2].split('|').map((s) => s.trim());
    if (parts.length < 3 || !isLinkedInJobUrl(parts[0])) continue;
    rows.push({ lineIdx: i, url: parts[0], company: parts[1], title: parts[2], location: parts[3] || '' });
  }
  return rows;
}

async function mapPool(items, concurrency, fn) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cachePath(root = ROOT) {
  return join(root, 'data', 'linkedin-job-meta.tsv');
}

export function readMetaCache(root = ROOT) {
  const path = cachePath(root);
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [url, title, company, location, status, date] = line.split('\t');
    if (!url) continue;
    map.set(url, { title, company, location, status, date });
  }
  return map;
}

export function writeMetaCache(entries, root = ROOT) {
  const path = cachePath(root);
  const lines = [
    '# url\ttitle\tcompany\tlocation\tstatus\tdate — linkedin-job-enrich.mjs (zero-LLM)',
    ...entries.map((e) =>
      [e.url, e.title ?? '', e.company ?? '', e.location ?? '', e.status ?? '', e.date ?? ''].join('\t'),
    ),
  ];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n') + '\n');
}

function upsertCache(cache, url, meta) {
  const date = new Date().toISOString().slice(0, 10);
  cache.set(url, {
    title: meta.title ?? '',
    company: meta.company ?? '',
    location: meta.location ?? '',
    status: meta.status ?? 'error',
    date,
  });
}

/**
 * Enrich a job list in-memory (for linkedin-alerts before pipeline append).
 * @param {Array<{url:string,title:string,company:string,location?:string}>} jobs
 */
export async function enrichJobList(jobs, opts = {}) {
  const concurrency = opts.concurrency ?? 4;
  const delayMs = opts.delayMs ?? 200;
  const cache = readMetaCache(opts.root ?? ROOT);
  const linkedin = jobs.filter((j) => isLinkedInJobUrl(j.url));
  if (!linkedin.length) return jobs;

  const toFetch = linkedin.filter((j) => {
    const c = cache.get(j.url);
    return !c || c.status === 'error' || opts.force;
  });

  if (toFetch.length) {
    const fetched = await mapPool(toFetch, concurrency, async (job) => {
      if (delayMs) await sleep(delayMs);
      try {
        return await fetchLinkedInJobMeta(job.url, opts.fetch);
      } catch {
        return { url: job.url, status: 'error' };
      }
    });
    for (const meta of fetched) {
      if (meta?.url) upsertCache(cache, meta.url, meta);
    }
    writeMetaCache([...cache.entries()].map(([url, v]) => ({ url, ...v })), opts.root ?? ROOT);
  }

  return jobs.map((job) => {
    if (!isLinkedInJobUrl(job.url)) return job;
    const c = cache.get(job.url);
    if (!c || c.status !== 'ok' || !c.title) return job;
    const out = { ...job };
    if (titlesDiffer(job.title, c.title)) out.title = c.title;
    if (c.company && (job.company === '(LinkedIn)' || titlesDiffer(job.company, c.company))) {
      out.company = c.company;
    }
    if (c.location && !job.location) out.location = c.location;
    return out;
  });
}

const LABELED_SEGMENT = /^([a-z][a-z_-]*):\s*(.*)$/i;

export function rewritePipelineLine(line, patch) {
  const m = line.match(/^(\s*-\s*\[([ xX])\]\s*)(.+)$/);
  if (!m) return line;
  const all = m[3].split('|').map((s) => s.trim());
  const labels = [];
  const parts = [];
  for (const [i, seg] of all.entries()) {
    const lm = i >= 3 ? seg.match(LABELED_SEGMENT) : null;
    if (lm) labels.push(seg);
    else parts.push(seg);
  }
  if (parts.length < 3) return line;

  if (patch.company) parts[1] = sanitizeMarkdownField(patch.company);
  if (patch.title) parts[2] = sanitizeMarkdownField(patch.title);
  if (patch.location) {
    if (parts.length >= 4) parts[3] = sanitizeMarkdownField(patch.location);
    else parts.push(sanitizeMarkdownField(patch.location));
  }
  return `${m[1]}${[...parts, ...labels].join(' | ')}`;
}

/** Update pipeline.md rows where LinkedIn page title differs from stored role. */
export async function enrichPipelineLinkedIn(opts = {}) {
  const root = opts.root ?? ROOT;
  const path = join(root, 'data', 'pipeline.md');
  if (!existsSync(path)) return { scanned: 0, updated: 0, skipped: 0 };

  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n');
  const cache = readMetaCache(root);
  const targets = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (!m || m[1].toLowerCase() === 'x') continue;
    const parts = m[2].split('|').map((s) => s.trim());
    if (parts.length < 3 || !isLinkedInJobUrl(parts[0])) continue;
    const stored = { url: parts[0], company: parts[1], title: parts[2], location: parts[3] || '' };
    const cached = cache.get(stored.url);
    const needsFetch =
      opts.force ||
      !cached ||
      cached.status === 'error' ||
      titlesDiffer(stored.title, cached.title) ||
      (stored.company === '(LinkedIn)' && cached.company);
    if (needsFetch) targets.push({ lineIdx: i, stored });
  }

  const limit = opts.limit ?? 80;
  const batch = targets.slice(0, limit);
  const concurrency = opts.concurrency ?? 4;
  const delayMs = opts.delayMs ?? 250;

  let updated = 0;
  let skipped = 0;

  if (batch.length) {
    const fetched = await mapPool(batch, concurrency, async ({ stored }) => {
      if (delayMs) await sleep(delayMs);
      try {
        return await fetchLinkedInJobMeta(stored.url, opts.fetch);
      } catch {
        return { url: stored.url, status: 'error' };
      }
    });
    for (const meta of fetched) {
      if (meta?.url) upsertCache(cache, meta.url, meta);
    }
    writeMetaCache([...cache.entries()].map(([url, v]) => ({ url, ...v })), root);
  }

  for (const { lineIdx, stored } of batch) {
    const c = cache.get(stored.url);
    if (!c || c.status !== 'ok' || !c.title) {
      skipped++;
      continue;
    }
    const titleDiff = titlesDiffer(stored.title, c.title);
    const companyDiff = c.company && (stored.company === '(LinkedIn)' || titlesDiffer(stored.company, c.company));
    const locDiff = c.location && !stored.location;
    if (!titleDiff && !companyDiff && !locDiff) {
      skipped++;
      continue;
    }
    lines[lineIdx] = rewritePipelineLine(lines[lineIdx], {
      title: titleDiff ? c.title : undefined,
      company: companyDiff ? c.company : undefined,
      location: locDiff ? c.location : undefined,
    });
    updated++;
  }

  if (updated > 0) {
    await withPipelineLock(path, async () => {
      writeFileSync(path, lines.join('\n'), 'utf-8');
    });
  }

  return { scanned: batch.length, updated, skipped, remaining: Math.max(0, targets.length - batch.length) };
}

function selfTest() {
  let failed = 0;
  const ok = (label, cond) => {
    if (cond) console.log(`  ✓ ${label}`);
    else { console.error(`  ✗ ${label}`); failed++; }
  };

  const html = `
    <meta property="og:title" content="Crossing Hurdles hiring Strategy Consultant | $70/hr Remote in APJ | LinkedIn">
    <h1 class="top-card-layout__title">Strategy Consultant | $70/hr Remote</h1>
  `;
  const meta = parseLinkedInJobHtml(html);
  ok('parses og:title company/title/location', meta.company === 'Crossing Hurdles' && meta.title?.includes('Strategy Consultant'));
  ok('detects generic search og as expired', parseLinkedInOgTitle('11,000+ Senior Product Manager jobs in United States')?.expired);

  const line = '- [ ] https://www.linkedin.com/jobs/view/1 | (LinkedIn) | Product Manager | Gurugram';
  const rewritten = rewritePipelineLine(line, { company: 'Nykaa', title: 'Senior Product Manager', location: 'Mumbai' });
  ok('rewrites pipeline line', rewritten.includes('Nykaa') && rewritten.includes('Senior Product Manager'));

  process.exit(failed ? 1 : 0);
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
  } else if (args.includes('--pipeline')) {
    const limit = args.includes('--all') ? 9999 : parseInt(args.find((a, i) => args[i - 1] === '--limit') ?? '80', 10);
    enrichPipelineLinkedIn({ limit, force: args.includes('--force') }).then(async (r) => {
      console.log(`LinkedIn pipeline enrich: ${r.updated} updated, ${r.skipped} unchanged/skipped, ${r.scanned} scanned${r.remaining ? `, ${r.remaining} remaining (re-run)` : ''}`);
      if (args.includes('--all') && r.remaining > 0) {
        const again = await enrichPipelineLinkedIn({ limit: 9999, force: args.includes('--force') });
        console.log(`LinkedIn pipeline enrich (cont): ${again.updated} updated, ${again.remaining} remaining`);
      }
    });
  } else {
    console.error('Usage: node linkedin-job-enrich.mjs --pipeline [--limit N] [--all] [--force] | --self-test');
    console.error('One-shot full fix via Cursor CLI: node linkedin-job-enrich-cli.mjs');
    process.exit(1);
  }
}
