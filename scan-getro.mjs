#!/usr/bin/env node

/**
 * scan-getro.mjs — DISCOVERY sweep of Getro-powered VC-portfolio job boards.
 *
 * ⚠️ AGGREGATOR — READ THIS. Getro boards (jobs.solana.com, jobs.electriccapital.com,
 * jobs.polychain.capital, ...) keep STALE / CLOSED / GEO-GATED listings live for
 * months. Their on-card "posted" date is the aggregator's date, not the source
 * posting's. Output of this script is therefore NOT a lead list — it is raw,
 * UNVERIFIED candidates that MUST be Playwright liveness-verified on the company's
 * OWN posting (still hiring? geo works? <90d?) before being applied to or surfaced
 * to the user as a lead. See memory: verify-before-adding-to-pipeline.
 *
 * To enforce that, this script:
 *   - freshness-gates on the card's datePosted (drops > max_posting_age_days),
 *   - extracts location + comp so geo/pay are visible for triage,
 *   - and writes ONLY to a quarantine file (data/getro-candidates.md), NEVER to
 *     data/pipeline.md or scan-history.tsv. Nothing here is "added" to anything.
 *
 * The real value is DISCOVERY of company NAMES the ATS scan can't see. When a new
 * company surfaces, find its OWN careers page/ATS and verify a live role there.
 *
 * Usage:
 *   node scan-getro.mjs                       # sweep all boards → quarantine file
 *   node scan-getro.mjs --board electric      # single board (name substring)
 *   node scan-getro.mjs --queries solana,rust # override search queries
 *   node scan-getro.mjs --max-age 30          # override freshness cap (days)
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';
const OUT_PATH = 'data/getro-candidates.md';           // quarantine — NOT pipeline.md
const NAV_TIMEOUT_MS = 25_000;
const RENDER_WAIT_MS = 4000;
const DEFAULT_QUERIES = ['solana', 'anchor', 'rust', 'smart contract', 'svm'];

mkdirSync('data', { recursive: true });

// ── filters + dedup (self-contained; no scan.mjs import) ─────────────

function buildTitleFilter(tf) {
  const pos = (tf?.positive || []).map(k => String(k).toLowerCase());
  const neg = (tf?.negative || []).map(k => String(k).toLowerCase());
  return t => {
    const l = (t || '').toLowerCase();
    return (pos.length === 0 || pos.some(k => l.includes(k))) && !neg.some(k => l.includes(k));
  };
}

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const COMPANY_SUFFIXES = new Set(['labs', 'lab', 'foundation', 'network', 'tech', 'technologies', 'inc', 'llc', 'ltd', 'io', 'xyz', 'ai', 'hq', 'trade']);
function companyNorm(s) {
  const t = norm(s).split(' ').filter(Boolean);
  while (t.length > 1 && COMPANY_SUFFIXES.has(t[t.length - 1])) t.pop();
  return t.join(' ');
}
const roleKey = (c, t) => `${companyNorm(c)}|${norm(t)}`;

// Roles already applied / evaluated / dismissed — skip them (name-variant safe).
function loadSeenRoles() {
  const keys = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    for (const line of readFileSync(APPLICATIONS_PATH, 'utf-8').split('\n')) {
      const m = line.match(/^\|\s*\d+\s*\|[^|]*\|([^|]+)\|([^|]+)\|/);
      if (m) keys.add(roleKey(m[1], m[2]));
    }
  }
  if (existsSync(PIPELINE_PATH)) {
    for (const line of readFileSync(PIPELINE_PATH, 'utf-8').split('\n')) {
      const m = line.match(/^- \[[ x]\] \S+ \| ([^|]+) \| ([^|]+)/);
      if (m) keys.add(roleKey(m[1], m[2]));
    }
  }
  return keys;
}

// Runs in the page. Getro card exposes:
//   a[data-testid="job-title-link"] · meta[itemprop=description]="Title at Company"
//   [itemprop=datePosted]=YYYY-MM-DD · card text "Location: X  Compensation: Y  Posted: Zd"
function extractGetroCards() {
  const cards = Array.from(document.querySelectorAll('a[data-testid="job-title-link"]'));
  const out = [];
  for (const a of cards) {
    const scope = a.closest('[itemscope]');
    const info = a.closest('.job-info');
    const meta = info?.querySelector('meta[itemprop="description"]')?.getAttribute('content') || '';
    let title = info?.querySelector('[itemprop="title"]')?.textContent?.trim() || '';
    let company = '';
    const at = meta.lastIndexOf(' at ');
    if (at !== -1) { if (!title) title = meta.slice(0, at).trim(); company = meta.slice(at + 4).trim(); }
    if (!title) title = (a.textContent || '').trim().split('\n')[0].trim();
    const dp = scope?.querySelector('[itemprop="datePosted"]');
    const datePosted = (dp?.getAttribute('content') || dp?.textContent || '').trim();
    const txt = (scope?.textContent || '').replace(/\s+/g, ' ');
    const locM = txt.match(/Location:\s*(.*?)(?:Compensation:|Posted:|$)/i);
    const compM = txt.match(/Compensation:\s*(.*?)(?:Posted:|$)/i);
    const url = (a.href || '').split('#')[0];
    if (title && url && /\/jobs\//.test(url)) {
      out.push({
        title, company, url, datePosted,
        location: locM ? locM[1].trim().slice(0, 100) : '',
        comp: compM ? compM[1].trim().slice(0, 60) : '',
      });
    }
  }
  return out;
}

function ageDays(dateStr, todayMs) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;                 // no/unparseable date → unknown
  return Math.floor((todayMs - t) / 86_400_000);
}

async function sweepBoard(browser, board, queries, titleFilter, maxAge, seenRoles, todayMs) {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (career-ops scan-getro)' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  const res = { board: board.name, raw: 0, filtered: 0, stale: 0, cand: [], error: null };
  const seenUrl = new Set();
  try {
    for (const q of queries) {
      const url = `${board.url}${board.url.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`;
      try { await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(RENDER_WAIT_MS); }
      catch (e) { res.error = `nav (${q}): ${e.message}`; continue; }
      const cards = await page.evaluate(extractGetroCards).catch(() => []);
      for (const c of cards) {
        if (seenUrl.has(c.url)) continue;
        seenUrl.add(c.url);
        res.raw++;
        if (!titleFilter(c.title)) continue;
        res.filtered++;
        const age = ageDays(c.datePosted, todayMs);
        if (age != null && age > maxAge) { res.stale++; continue; }   // FRESHNESS GATE
        const rk = roleKey(c.company, c.title);
        if (seenRoles.has(rk)) continue;                               // already applied/known
        seenRoles.add(rk);
        res.cand.push({ ...c, age, board: board.name });
      }
    }
  } catch (err) { res.error = err.message; } finally { await ctx.close(); }
  return res;
}

function writeQuarantine(cands, maxAge, stamp) {
  const esc = s => (s || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const rows = cands.map(c => {
    const posted = c.datePosted ? `${c.datePosted} (${c.age}d)` : 'date-unknown';
    return `| ${esc(c.company)} | ${esc(c.title)} | ${posted} | ${esc(c.location) || '-'} | ${esc(c.comp) || '-'} | ${c.url} |`;
  }).join('\n');
  const body = `# Getro Sweep Candidates — UNVERIFIED (generated ${stamp})

> ⚠️ These are RAW aggregator listings, freshness-gated to <=${maxAge}d by the board's
> posted date. That date is the AGGREGATOR's, not the source posting's — CLOSED and
> GEO-GATED roles still appear here. This is NOT a lead list.
>
> Before treating ANY row as a lead: open it with Playwright, click through to the
> company's OWN posting, and confirm (a) still accepting applications, (b) geo works
> (remote or a geo you'd take), (c) truly fresh. Only verified survivors go to the user
> or the pipeline. See memory: verify-before-adding-to-pipeline.

| Company | Role | Posted | Location | Comp | URL |
|---|---|---|---|---|---|
${rows || '| _(none)_ | | | | | |'}
`;
  writeFileSync(OUT_PATH, body, 'utf-8');
}

async function main() {
  const args = process.argv.slice(2);
  const val = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  const boardFilter = val('--board')?.toLowerCase();
  const queries = val('--queries') ? val('--queries').split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_QUERIES;

  const yamlMod = await import('js-yaml');
  const config = yamlMod.default.load(readFileSync('portals.yml', 'utf-8'));
  const titleFilter = buildTitleFilter(config.title_filter);
  const maxAge = Number(val('--max-age') ?? config.max_posting_age_days ?? 90);
  // scripts run in plain node; Date is available here (unlike Workflow scripts).
  const todayMs = Date.now();
  const stamp = new Date().toISOString().slice(0, 10);

  const boards = (config.tracked_companies || [])
    .filter(c => c && typeof c.name === 'string' && c.name.startsWith('Getro:') && c.enabled !== false && c.careers_url)
    .map(c => ({ name: c.name, url: c.careers_url }))
    .filter(b => !boardFilter || b.name.toLowerCase().includes(boardFilter));

  console.log(`Getro DISCOVERY sweep (UNVERIFIED output) — ${boards.length} board(s), fresh<=${maxAge}d, queries [${queries.join(', ')}]`);
  const seenRoles = loadSeenRoles();
  const all = [];
  const summary = [];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const b of boards) {
      process.stdout.write(`  → ${b.name}... `);
      const r = await sweepBoard(browser, b, queries, titleFilter, maxAge, seenRoles, todayMs);
      summary.push(r);
      console.log(r.error ? `error: ${r.error}` : `${r.raw} raw, ${r.filtered} on-title, ${r.stale} stale-dropped, ${r.cand.length} fresh candidates`);
      all.push(...r.cand);
    }
  } finally { await browser.close(); }

  writeQuarantine(all, maxAge, stamp);

  console.log(`\n${'━'.repeat(48)}`);
  console.log(`Getro Sweep — ${stamp}  (freshness-gated, UNVERIFIED)`);
  console.log(`${'━'.repeat(48)}`);
  console.log(`Boards:              ${boards.length}`);
  console.log(`Raw jobs seen:       ${summary.reduce((s, r) => s + r.raw, 0)}`);
  console.log(`On-title:            ${summary.reduce((s, r) => s + r.filtered, 0)}`);
  console.log(`Dropped as stale:    ${summary.reduce((s, r) => s + r.stale, 0)}`);
  console.log(`Fresh candidates:    ${all.length}  → ${OUT_PATH}`);
  console.log(`\n⚠️  These are UNVERIFIED aggregator rows. Playwright-verify liveness/geo on each`);
  console.log(`   company's OWN posting before treating any as a lead. Nothing was added to the pipeline.`);
  const errored = summary.filter(r => r.error);
  if (errored.length) { console.log(`\nErrors (${errored.length}):`); for (const r of errored) console.log(`  ✗ ${r.board}: ${r.error}`); }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
