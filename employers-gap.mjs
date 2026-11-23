#!/usr/bin/env node
// @ts-check
/**
 * employers-gap.mjs: the job boards your career-ops already knows that the
 * public employer registry (employers/boards) does not have yet.
 *
 *   node employers-gap.mjs [--include-applied] [--offline] [--list] [--json] [--out <file>]
 *
 * It reads your own files and nothing else, with no network and no AI:
 *   portals.yml (or $CAREER_OPS_PORTALS), data/pipeline.md, data/scan-history.tsv,
 *   and with --include-applied also data/applications.md and reports/*.md.
 * Every URL goes through parseBoardUrl() (seeds/employers-import.mjs), the same
 * reader the registry's import uses, so a posting link counts as its board. A
 * board is new when no row of the registry has it, retired rows included.
 *
 * What it would share is the board address only (careers_url): never a posting,
 * a title, your tracker, or which of your files it came from. --out writes that
 * list, one URL per line; nothing is sent from here.
 *
 * By default each new board is asked, through the provider the scanner already
 * uses for its system, whether it lists jobs now (one page per board): only
 * boards that do are shared, so a board left behind when a company moved to
 * another system, or one with no jobs, is not. --offline skips that and sets
 * aside a board whose company the registry already has on another system.
 *
 * Boards that are never public are set aside with a reason: the examples in
 * templates/portals.example.yml, referral and internal boards, LinkedIn copies
 * of a board, and ids that are only a UUID. The rules are narrow on purpose:
 * real employers such as sandboxaq or testgorilla are in the registry.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { parseBoardUrl } from './seeds/employers-import.mjs';
import { boardIdentity, inboxLineProblems, loadAggregatorDomains } from './seeds/employers-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const UUID_REASON = 'id is a UUID, not a name';

/** @type {ReadonlyArray<[RegExp, string]>} */
export const NOT_PUBLIC_RULES = Object.freeze([
  [/referral/i, 'referral board (employees only)'],
  [/(internal(use)?only|internaluse|notexternal|employeesonly|employeeonly|staffonly)/i, 'internal board'],
  [/^internal|internal$/i, 'internal board'],
  [/(linkedin(jobs|limitedpostings|postings)?|liboard)$/i, 'copy of a board for LinkedIn'],
  [/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i, UUID_REASON],
  [/^(example|placeholder|your-?company|acme|demo-?company|sample)([-_.]|$)/i, 'example or placeholder'],
]);

/**
 * A board's own name that says it is not the employer's public board: a copy made for one
 * channel («Stone - Linkedin», «Stone - Indeed») or a sourcing, referral or internal board
 * («Coursera Sourcing»). Greenhouse publishes a board's name; the slug alone does not show it.
 */
export const NOT_PUBLIC_NAME = /(\s[-–—|:]\s*(linkedin|indeed|glassdoor|ziprecruiter|monster|handshake|wellfound|angellist|dice|jobboards?|job boards?|careerbuilder|seek|stepstone|xing)\s*$)|\b(sourcing|referrals?|internal|employees? only|staff only)\b/i;

/**
 * Why a board is never public, or null.
 * @param {{ats: string, board: string}} coords
 */
export function notPublicReason(coords) {
  const slug = coords.ats === 'workday' ? coords.board.split('/')[0] : coords.board;
  for (const [re, why] of NOT_PUBLIC_RULES) {
    // A ClearCompany board id is always a GUID: there the UUID is the public board, not a placeholder.
    if (coords.ats === 'clearcompany' && why === UUID_REASON) continue;
    if (re.test(slug)) return why;
  }
  return null;
}

/**
 * The public API URLs that portals.yml keeps under `api:`, read back to the board URL they name.
 * parseBoardUrl() reads board and posting links; these five API hosts name the same board.
 * @type {ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string]>}
 */
const API_FORMS = Object.freeze([
  [/^https?:\/\/boards-api\.(eu\.)?greenhouse\.io\/v1\/boards\/([A-Za-z0-9._-]+)/i, (m) => `https://job-boards.${m[1] ?? ''}greenhouse.io/${m[2]}`],
  [/^https?:\/\/api\.(eu\.)?lever\.co\/v0\/postings\/([A-Za-z0-9._-]+)/i, (m) => `https://jobs.${m[1] ?? ''}lever.co/${m[2]}`],
  [/^https?:\/\/api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9._-]+)/i, (m) => `https://jobs.ashbyhq.com/${m[1]}`],
  [/^https?:\/\/apply\.workable\.com\/api\/v[0-9]+\/(?:accounts|widget\/accounts)\/([A-Za-z0-9._-]+)/i, (m) => `https://apply.workable.com/${m[1]}`],
  [/^https?:\/\/api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9._-]+)/i, (m) => `https://careers.smartrecruiters.com/${m[1]}`],
]);

/**
 * parseBoardUrl(), after reading an API URL back to its board URL.
 * @param {string} url
 */
export function readBoard(url) {
  for (const [re, toBoard] of API_FORMS) { const m = url.match(re); if (m) return parseBoardUrl(toBoard(m)); }
  return parseBoardUrl(url);
}

const URL_RE = /https?:\/\/[^\s<>"'`|)\]]+/g;
/** @param {string} text */
export const urlsIn = (text) => [...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:]+$/, ''));

/**
 * A board's company key: its id (the tenant for Workday), lowercase, letters and digits only,
 * so `furiosa-ai` and `furiosaai` meet.
 * @param {{ats: string, board: string}} coords
 */
export const slugKey = (coords) => (coords.ats === 'successfactors-classic' ? coords.board.split('/')[2] ?? '' : coords.ats === 'oraclecloud' ? coords.board.split('.')[0] : coords.board.split('/')[0]).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which systems the registry already has each company key on (retired rows included).
 * @param {string} boardsDir
 * @returns {Map<string, Set<string>>}
 */
export function loadRegistrySlugs(boardsDir) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const ats of readdirSync(boardsDir)) {
    for (const f of readdirSync(join(boardsDir, ats))) {
      if (!f.endsWith('.ndjson')) continue;
      for (const line of readFileSync(join(boardsDir, ats, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); const k = slugKey(r); if (k) (out.get(k) ?? out.set(k, new Set()).get(k))?.add(r.ats); } catch { /* skip */ }
      }
    }
  }
  return out;
}

/**
 * The board's own name where the system publishes it (Greenhouse, US host), else ''.
 * @param {string} careersUrl
 * @param {{fetchJson?: Function}} ctx
 */
export async function boardName(careersUrl, ctx) {
  const m = careersUrl.match(/^https:\/\/job-boards\.greenhouse\.io\/([A-Za-z0-9._-]+)$/);
  if (!m || typeof ctx?.fetchJson !== 'function') return '';
  try { const b = await ctx.fetchJson(`https://boards-api.greenhouse.io/v1/boards/${m[1]}`); return typeof b?.name === 'string' ? b.name.trim() : ''; } catch { return ''; }
}

/**
 * Ask each new board, through the provider the scanner uses for it, whether it lists jobs now.
 * One page per board, a few at a time. live: ≥1 job · empty: 0 jobs · gone: 404/410 ·
 * unchecked: no provider reads it, or the answer did not come (timeout, 5xx).
 * @param {Array<{careers_url: string}>} boards
 * @param {{providers: Map<string, any>, ctx: any, resolveProvider: Function, concurrency?: number}} deps
 * @returns {Promise<Map<string, {status: 'live'|'empty'|'gone'|'unchecked', jobs?: number, detail?: string}>>}
 */
export async function checkBoards(boards, { providers, ctx, resolveProvider, concurrency = 4 }) {
  /** @type {Map<string, any>} */
  const out = new Map();
  const queue = [...boards];
  const worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const entry = { name: b.careers_url, careers_url: b.careers_url };
      const r = resolveProvider(entry, providers, { skipIds: ['local-parser'] });
      if (!r || 'error' in r) { out.set(b.careers_url, { status: 'unchecked', detail: 'no provider reads this system' }); continue; }
      try {
        const jobs = await r.provider.fetch(entry, ctx);
        const n = Array.isArray(jobs) ? jobs.length : 0;
        out.set(b.careers_url, { status: n > 0 ? 'live' : 'empty', jobs: n, name: await boardName(b.careers_url, ctx) });
      } catch (err) {
        const status = /** @type {any} */ (err)?.status;
        // A board too large to read in one page lists jobs: that is an answer, not a failure.
        if (/maxBytes/i.test(String(/** @type {any} */ (err)?.message))) { out.set(b.careers_url, { status: 'live', jobs: -1, name: await boardName(b.careers_url, ctx) }); continue; }
        out.set(b.careers_url, status === 404 || status === 410 ? { status: 'gone', detail: `HTTP ${status}` }
          : { status: 'unchecked', detail: String(/** @type {any} */ (err)?.message ?? err).slice(0, 80) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out;
}

/**
 * Identities of every row in a registry directory (boards/<ats>/<initial>.ndjson), retired rows included.
 * @param {string} boardsDir
 */
export function loadRegistryIdentities(boardsDir) {
  const known = new Set();
  for (const ats of readdirSync(boardsDir)) {
    for (const f of readdirSync(join(boardsDir, ats))) {
      if (!f.endsWith('.ndjson')) continue;
      for (const line of readFileSync(join(boardsDir, ats, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { known.add(boardIdentity(JSON.parse(line))); } catch { /* the validator reports broken rows */ }
      }
    }
  }
  return known;
}

/**
 * Board identities named in a text (the template's examples).
 * @param {string|null} text
 */
export function boardsIn(text) {
  const out = new Set();
  for (const u of urlsIn(text ?? '')) { const p = readBoard(u); if (!("error" in p)) out.add(boardIdentity(p)); }
  return out;
}

/**
 * The URLs of one install, each with the file it came from.
 * @param {{root: string, portalsPath?: string, includeApplied?: boolean}} opts
 * @returns {Array<{source: string, url: string}>}
 */
export function collectInstanceUrls({ root, portalsPath, includeApplied = false }) {
  /** @type {Array<{source: string, url: string}>} */
  const out = [];
  const read = (/** @type {string} */ p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  const add = (/** @type {string} */ source, /** @type {string|null} */ text) => { if (text) for (const url of urlsIn(text)) out.push({ source, url }); };
  add('portals.yml', read(portalsPath ?? join(root, 'portals.yml')));
  add('pipeline.md', read(join(root, 'data/pipeline.md')));
  const history = read(join(root, 'data/scan-history.tsv'));
  if (history) for (const line of history.split('\n')) { const u = line.split('\t')[0]; if (/^https?:\/\//.test(u)) out.push({ source: 'scan-history', url: u }); }
  if (includeApplied) {
    add('applications.md', read(join(root, 'data/applications.md')));
    const rdir = join(root, 'reports');
    if (existsSync(rdir)) for (const f of readdirSync(rdir).sort()) if (f.endsWith('.md')) add('reports', read(join(rdir, f)));
  }
  return out;
}

/**
 * Sort URLs into boards already in the registry, new boards, and boards set aside.
 * @param {Array<{source: string, url: string}>} urls
 * @param {{known: Set<string>, templateBoards?: Set<string>, aggregatorDomains?: Set<string>}} ctx
 */
export function findGap(urls, { known, templateBoards = new Set(), aggregatorDomains = loadAggregatorDomains() }) {
  /** @type {Record<string, {urls: number, boards: Set<string>, fresh: Set<string>}>} */
  const perSource = {};
  /** @type {Map<string, {careers_url: string, ats: string, key: string, sources: Set<string>, check?: any}>} */
  const fresh = new Map();
  /** @type {Map<string, {careers_url: string, why: string}>} */
  const setAside = new Map();
  const inRegistry = new Set();
  let notBoard = 0;
  for (const { source, url } of urls) {
    const s = (perSource[source] ??= { urls: 0, boards: new Set(), fresh: new Set() });
    s.urls++;
    const p = readBoard(url);
    if ('error' in p) { notBoard++; continue; }
    const { careers_url: careersUrl, ...coords } = p;
    const id = boardIdentity(p);
    s.boards.add(id);
    if (known.has(id)) { inRegistry.add(id); continue; }
    if (setAside.has(id)) continue;
    let why = templateBoards.has(id) ? 'example from templates/portals.example.yml' : notPublicReason(coords);
    if (!why) {
      const line = { ats: coords.ats, ...(coords.region !== undefined ? { region: coords.region } : {}), board: coords.board,
        ...(coords.workday_host ? { workday_host: coords.workday_host } : {}), name: 'x' };
      const problems = inboxLineProblems(line, aggregatorDomains);
      if (problems.length) why = problems.join('; ');
    }
    if (why) { setAside.set(id, { careers_url: careersUrl, why }); fresh.delete(id); continue; }
    s.fresh.add(id);
    const f = fresh.get(id);
    if (f) f.sources.add(source); else fresh.set(id, { careers_url: careersUrl, ats: coords.ats, key: slugKey(coords), sources: new Set([source]) });
  }
  const boards = new Set(Object.values(perSource).flatMap((s) => [...s.boards])).size;
  return { perSource, fresh, setAside, inRegistry, notBoard, boards, urls: urls.length };
}

/**
 * Settle the new boards: with checks (the default), keep the ones that list jobs now and set aside
 * the empty and the gone ones; a board no provider reads stays, marked unchecked. Offline (no checks),
 * set aside a board whose company key the registry already has on another system: the company moved
 * and the registry has its current board (doctolib, mistral, temporal… in the first trial).
 * @param {ReturnType<typeof findGap>} gap
 * @param {{checks?: Map<string, {status: string, jobs?: number, detail?: string}>, slugs?: Map<string, Set<string>>}} opts
 */
export function settle(gap, { checks, slugs }) {
  for (const [id, f] of gap.fresh) {
    let why = null;
    if (checks) {
      const c = checks.get(f.careers_url);
      f.check = c;
      if (c?.status === 'empty') why = 'lists no jobs now';
      else if (c?.name && NOT_PUBLIC_NAME.test(c.name)) why = `board's own name «${c.name}» marks a channel copy or a sourcing/internal board`;
      else if (c?.status === 'gone') why = `board is gone (${c.detail})`;
    } else if (slugs) {
      const other = [...(slugs.get(f.key) ?? [])].filter((a) => a !== f.ats);
      if (other.length) why = `the registry has this company on ${other.join(', ')}`;
    }
    if (why) { gap.setAside.set(id, { careers_url: f.careers_url, why }); gap.fresh.delete(id); }
  }
  return gap;
}

/** The list that would be shared: board addresses only, sorted, no duplicates. */
export const shareList = (/** @type {ReturnType<typeof findGap>} */ gap) => [...gap.fresh.values()].map((f) => f.careers_url).sort();

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (/** @type {string} */ k) => args.includes(k);
  const value = (/** @type {string} */ k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const root = getCareerOpsRoot();
  const known = loadRegistryIdentities(join(HERE, 'employers/boards'));
  const templatePath = join(HERE, 'templates/portals.example.yml');
  const templateBoards = boardsIn(existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : null);
  const urls = collectInstanceUrls({ root, portalsPath: process.env.CAREER_OPS_PORTALS, includeApplied: flag('--include-applied') });
  const extra = value('--extra');
  if (extra) for (const url of urlsIn(readFileSync(extra, 'utf8'))) urls.push({ source: 'extra', url });
  const gap = findGap(urls, { known, templateBoards });
  if (flag('--offline')) settle(gap, { slugs: loadRegistrySlugs(join(HERE, 'employers/boards')) });
  else {
    const { loadProviders, resolveProvider } = await import('./providers/_registry.mjs');
    const { makeHttpCtx } = await import('./providers/_http.mjs');
    const providers = await loadProviders(join(HERE, 'providers'));
    console.error(`checking ${gap.fresh.size} new boards with the scanner's providers (one page each)…`);
    const checks = await checkBoards([...gap.fresh.values()], { providers, ctx: { ...makeHttpCtx(), maxPages: 1 }, resolveProvider });
    settle(gap, { checks });
  }
  const list = shareList(gap);
  if (flag('--json')) {
    console.log(JSON.stringify({ registry: known.size, urls: gap.urls, boards: gap.boards, in_registry: gap.inRegistry.size, new: list, set_aside: gap.setAside.size }, null, 2));
  } else {
    console.log(`registry: ${known.size} boards · your files: ${gap.urls} URLs, ${gap.boards} boards`);
    for (const [k, s] of Object.entries(gap.perSource)) console.log(`  ${k}: ${s.urls} URLs → ${s.boards.size} boards, ${s.fresh.size} new`);
    console.log(`already in the registry: ${gap.inRegistry.size} · new: ${list.length} · set aside: ${gap.setAside.size}`);
    if (flag('--list')) {
      for (const f of [...gap.fresh.values()].sort((a, b) => a.careers_url.localeCompare(b.careers_url))) {
        const c = f.check;
        const jobs = c?.jobs === -1 ? 'many jobs' : `${c?.jobs} jobs`;
        console.log(`  + ${f.careers_url}${c ? (c.status === 'live' ? `  (${jobs}${c.name ? `, «${c.name}»` : ''})` : `  (unchecked: ${c.detail})`) : ''}`);
      }
      for (const r of [...gap.setAside.values()].sort((a, b) => a.careers_url.localeCompare(b.careers_url))) console.log(`  - ${r.careers_url}  (${r.why})`);
    }
  }
  const out = value('--out');
  if (out) { writeFileSync(out, list.join('\n') + (list.length ? '\n' : '')); console.error(`wrote ${list.length} board addresses to ${out}`); }
}
