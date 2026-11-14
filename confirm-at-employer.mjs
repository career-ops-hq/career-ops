#!/usr/bin/env node
/**
 * confirm-at-employer.mjs — find an aggregator listing at the employer, zero tokens (#6166).
 *
 * AGENTS.md → "Aggregator Listings -- Confirm at the Employer" asks for every
 * aggregator listing to be found on the employer's own careers page / ATS before
 * it is evaluated or applied to. Done by hand that is several web calls per
 * posting. This script does the deterministic part through the public ATS APIs
 * the repo already reads (providers/, discover-ats.mjs, liveness-api.mjs):
 *
 *   1. The URL is not an aggregator → it already is the employer's posting
 *      (`employer_url`); liveness through checkLivenessViaApi when the ATS has an API.
 *   2. The posting names its employer link (`origin`, e.g. "apply on company site")
 *      and that link is not an aggregator → `found` via the origin.
 *   3. No employer name → `unidentified` (AGENTS.md step 5: a Block G signal; never guess).
 *   4. Find the employer's board: `tracked_companies` in portals.yml, then ATS links
 *      of the same company already in data/scan-history.tsv, then slug probing over
 *      the discover-ats vendors (plus Personio). No board → `no_board`.
 *   5. List every board found and match the title:
 *      - the same title (gender tags dropped, `Sr.` → `senior`), the only near
 *        title (token Dice ≥ 0.8) when both have three words or more, or the
 *        only board title that contains ours or is contained in it (three
 *        content words or more) → `found` with `match` saying which; a board
 *        title match is a candidate the agent compares with the listing;
 *      - otherwise → `board_without_role` with the three nearest titles, so the
 *        agent decides between "renamed" and "stale" (AGENTS.md step 3).
 *        `complete: false` when a board was read only in part or was found by
 *        slug probing alone: then the absence is not established.
 *
 * Read-only: it writes nothing. Untrusted strings (URL, company, title come
 * from the posting) never go through a shell: they are read from a JSON file.
 *
 * Usage:
 *   node confirm-at-employer.mjs --input posting.json [--json]
 *   posting.json: { "url": "…", "company": "…", "title": "…", "origin": "…" (optional) }
 *
 * Exit code: 0 with a verdict, 2 on bad input.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkLivenessViaApi, isAtsPosting, resolveAtsApi } from './liveness-api.mjs';
import { isAggregatorUrl } from './url-key.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { makeHttpCtx } from './providers/_http.mjs';
import { buildCandidateUrls, deriveSlug } from './discover-ats.mjs';
import { buildBoardUrl } from './lib/ats-board-url.mjs';
import { parsedScanHistory } from './lib/scan-history-columns.mjs';
import { loadYaml } from './lib/yaml-document.mjs';
import { validateFlags, flagValue, hasFlag } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { boardTruncation, markTruncated } from './lib/board-truncation.mjs';
import { resolveHost as builtinHost } from './providers/builtin.mjs';

export const VERDICTS = Object.freeze(['employer_url', 'found', 'board_without_role', 'no_board', 'unidentified']);
export const TITLE_MATCH = 0.8;

// ── Title matching ─────────────────────────────────────────────────────
// role-matcher.mjs is built for tracker dedup and never matches on baseline
// words alone ("Senior Product Manager" vs "Sr. Product Manager" is false
// there). On one employer's board that is exactly the match we need, so the
// comparison here is a plain token Dice over the same title on both sides.
const GENDER_TAG = /\((?:[^)]*\b(?:m|w|f|d|x|all|gn|div)\b[^)]*)\)/gi;
const SYNONYMS = { sr: 'senior', snr: 'senior', jr: 'junior', mgr: 'manager' };
const STOP = new Set(['m', 'w', 'f', 'd', 'x', 'gn', 'all', 'genders', 'and', 'und', 'the', 'of', 'for', 'in', 'a', 'an', 'at', 'with', 'mit']);

export function titleTokens(title) {
  return String(title || '').toLowerCase().normalize('NFKD').replace(/\p{Mn}/gu, '')
    .replace(GENDER_TAG, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/).map((w) => SYNONYMS[w] || w).filter((w) => w && !STOP.has(w));
}

/** Title similarity 0..1 (Dice coefficient over distinct tokens). */
export function titleSimilarity(a, b) {
  const A = new Set(titleTokens(a)), B = new Set(titleTokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** One title fully contains the other, and the shorter one has at least three words. */
export function titleContains(a, b) {
  const A = new Set(titleTokens(a)), B = new Set(titleTokens(b));
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  return small.size >= 3 && [...small].every((w) => large.has(w));
}

// ── Boards ─────────────────────────────────────────────────────────────
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

/**
 * The careers URL of the board a posting URL belongs to, or '' when the URL is
 * not a posting on a board the providers can list.
 */
export function boardOfPosting(url) {
  const api = resolveAtsApi(url);
  const host = hostOf(url);
  if (api) {
    const p = api.parts;
    switch (api.ats) {
      case 'greenhouse': return buildBoardUrl({ ats: 'greenhouse', region: /\.eu\.greenhouse\.io$/.test(host) ? 'eu' : 'us', board: p.board }) || '';
      case 'lever': return buildBoardUrl({ ats: 'lever', region: /\.eu\./.test(p.apiHost || host) ? 'eu' : 'us', board: p.slug }) || '';
      case 'ashby': return buildBoardUrl({ ats: 'ashby', board: p.org }) || '';
      case 'smartrecruiters': return buildBoardUrl({ ats: 'smartrecruiters', board: p.company }) || '';
      case 'workable': return buildBoardUrl({ ats: 'workable', board: p.account }) || '';
      case 'workday': return p.tenant && p.shard && p.site ? `https://${p.tenant}.${p.shard}.myworkdayjobs.com/${p.site}` : '';
      default: break;
    }
  }
  let u;
  try { u = new URL(url); } catch { return ''; }
  const seg = u.pathname.split('/').filter(Boolean);
  const sub = host.split('.')[0];
  if (/\.recruitee\.com$/.test(host)) return buildBoardUrl({ ats: 'recruitee', board: sub }) || '';
  if (host === 'join.com' && seg[0] === 'companies' && seg[1]) return buildBoardUrl({ ats: 'join', board: seg[1] }) || '';
  if (/^[a-z0-9-]+\.jobs\.personio\.(de|com)$/.test(host)) return `https://${host}`;
  return '';
}

// Trailing legal forms and group words that one source writes and another drops ("Acme GmbH" / "Acme").
const LEGAL = /(?:[\s,]+(?:GmbH(?:\s*&\s*Co\.?\s*KG)?|mbH|AG|SE|KGaA|KG|Inc\.?|Ltd\.?|LLC|B\.V\.|S\.A\.|Holding|Group))+\s*$/i;
const companyKey = (c) => normalizeCompany(String(c || '').replace(GENDER_TAG, ' ').trim().replace(LEGAL, '')) || '';

/** Boards the user's own data already ties to this company: portals.yml, then scan history. */
export function knownBoards(company, { portalsText = '', historyText = '' } = {}) {
  const key = companyKey(company);
  if (!key) return [];
  const out = new Set();
  try {
    for (const e of loadYaml(portalsText)?.tracked_companies || []) {
      if (e?.careers_url && e.enabled !== false && companyKey(e.name) === key) out.add(e.careers_url);
    }
  } catch { /* an unreadable portals.yml only means no hint from it */ }
  for (const row of parsedScanHistory(historyText)) {
    if (!row.url || (companyKey(row.company) !== key && companyKey(row.normalized_company) !== key)) continue;
    const board = boardOfPosting(row.url);
    if (board) out.add(board);
  }
  return [...out];
}

/** Slugs to probe for a company name: hyphenated and joined, legal suffixes dropped. */
export function companySlugs(company) {
  const base = String(company || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().replace(LEGAL, '');
  // deriveSlug keeps ASCII only: fold accents first, so "Café" probes "cafe", not "caf".
  const slug = deriveSlug(base.replace(/ß/g, 'ss').normalize('NFKD').replace(/\p{Mn}/gu, ''));
  return [...new Set([slug, slug.replace(/-/g, '')])].filter((s) => s && s.length >= 3);
}

/** Probe candidates for a company: the discover-ats vendors, then Personio. */
export function probeCandidates(company) {
  const out = [];
  for (const slug of companySlugs(company)) {
    const { candidates } = buildCandidateUrls({ name: company, slug });
    out.push(...candidates.map((c) => c.careers_url), `https://${slug}.jobs.personio.de`);
  }
  return [...new Set(out)];
}

/**
 * Default board lister: the provider that reads that board, through providers/.
 * The whole board is read (the provider's own page limit, no probe cap); a
 * board the provider read only in part keeps its lib/board-truncation.mjs mark.
 * null means the board did not answer; [] is an answered, empty board.
 */
// The Greenhouse provider reads a body without a jobs array as an empty board,
// which suits a scan. Here an empty board is evidence (board_without_role), so a
// malformed board response is refused before the provider sees it.
const GREENHOUSE_JOBS = /^https:\/\/boards-api(?:\.eu)?\.greenhouse\.io\/v1\/boards\/[^/]+\/jobs(?:[/?]|$)/;
function strictCtx(ctx) {
  if (typeof ctx?.fetchJson !== 'function') return ctx;
  return { ...ctx, fetchJson: async (url, opts) => {
    const json = await ctx.fetchJson(url, opts);
    if (GREENHOUSE_JOBS.test(String(url)) && !Array.isArray(json?.jobs)) throw new Error('greenhouse: the board returned no jobs array');
    return json;
  } };
}

export function makeBoardLister(httpCtx = makeHttpCtx()) {
  let providers = null;
  const ctx = strictCtx(httpCtx);
  return async (careersUrl, company) => {
    providers ||= await loadProviders(fileURLToPath(new URL('./providers', import.meta.url)));
    const entry = { name: company, careers_url: careersUrl };
    const resolved = resolveProvider(entry, providers, { skipIds: ['local-parser'] });
    if (!resolved?.provider) return null;
    try {
      const jobs = await resolved.provider.fetch(entry, ctx);
      if (!Array.isArray(jobs)) return null;
      const kept = jobs.filter((j) => j?.title && j?.url);
      const cut = boardTruncation(jobs);
      return cut ? markTruncated(kept, cut.reason || 'truncated') : kept;
    } catch { return null; }
  };
}

// ── The confirmation ───────────────────────────────────────────────────
const liveOf = (v) => (v?.result === 'active' ? 'open' : v?.result === 'expired' ? 'closed' : 'unknown');
// Built In runs one platform on several market hosts (builtinseattle.com, builtinchicago.org, ...);
// the shared list names builtin.com only, so the allowlist in providers/builtin.mjs covers the rest.
// AGENTS.md (Aggregator Listings) also names boards the shared list lacks. They are
// added here only: the shared list also drives dedup in merge-tracker and scan.
const EXTRA_AGGREGATORS = ['instahyre.com', 'cutshort.io', 'internshala.com', 'naukri.com'];
const isAggregator = (u) => {
  try { if (isAggregatorUrl(u)) return true; } catch { /* fall through */ }
  const h = hostOf(u).replace(/\.$/, '');
  if (!h) return false;
  if (EXTRA_AGGREGATORS.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  return builtinHost(h) !== null;
};
const unknownEmployer = (c) => !c || c === '?' || /^(confidential|undisclosed|unknown|vertraulich|anonym)/i.test(c);

/**
 * @param {{url: string, company?: string, title?: string, origin?: string}} posting
 * @param {{listBoard?: Function, checkLiveness?: Function, portalsText?: string, historyText?: string, candidates?: Function}} [deps]
 * @returns {Promise<{verdict: string, match: ''|'origin'|'exact'|'near'|'contained', employerUrl: string, board: string, live: 'open'|'closed'|'unknown', complete: boolean, near: Array<{title: string, url: string}>, evidence: string}>}
 */
export async function confirmAtEmployer(posting, deps = {}) {
  const {
    listBoard = makeBoardLister(),
    checkLiveness = (u) => checkLivenessViaApi(u).catch(() => null),
    portalsText = '', historyText = '',
    candidates = probeCandidates,
  } = deps;
  const url = String(posting?.url || '').trim();
  const company = String(posting?.company || '').trim();
  const title = String(posting?.title || '').trim();
  const origin = String(posting?.origin || '').trim();
  const out = (o) => ({ employerUrl: '', board: '', live: 'unknown', match: '', complete: false, near: [], evidence: '', ...o });

  // 1. Already the employer's posting.
  if (url && !isAggregator(url)) {
    const v = isAtsPosting(url) ? await checkLiveness(url) : null;
    return out({ verdict: 'employer_url', employerUrl: url, board: boardOfPosting(url), live: liveOf(v),
      evidence: v ? `employer posting; ATS API: ${v.result}${v.reason ? ` (${v.reason})` : ''}` : 'employer posting; no ATS API for this host' });
  }
  // 2. The posting links to the employer.
  if (origin && !isAggregator(origin)) {
    const v = isAtsPosting(origin) ? await checkLiveness(origin) : null;
    return out({ verdict: 'found', match: 'origin', employerUrl: origin, board: boardOfPosting(origin), live: liveOf(v),
      evidence: `employer link given by the posting${v ? `; ATS API: ${v.result}` : ''}` });
  }
  // 3. No employer to look for.
  if (unknownEmployer(company)) return out({ verdict: 'unidentified', evidence: 'the posting does not name the employer' });

  // 4. The employer's boards: known boards first; with none, every probe candidate that answers.
  // A board known from the user's own data is the employer's; a slug match alone is not proof of that.
  const lists = new Map();
  const boards = knownBoards(company, { portalsText, historyText }).map((url) => ({ url, source: 'known' }));
  if (!boards.length) {
    const probed = await Promise.all(candidates(company).map(async (c) => [c, await listBoard(c, company)]));
    for (const [c, jobs] of probed) if (Array.isArray(jobs)) { boards.push({ url: c, source: 'probe' }); lists.set(c, jobs); }
  }
  if (!boards.length) return out({ verdict: 'no_board', evidence: `no ATS board found for "${company}"` });

  // 5. Match the title across the boards.
  const jobs = [];
  const read = [];
  let complete = boards.every((b) => b.source === 'known');
  for (const b of boards) {
    const list = lists.has(b.url) ? lists.get(b.url) : await listBoard(b.url, company);
    if (!Array.isArray(list)) { complete = false; continue; }
    read.push(b.url);
    if (boardTruncation(list)) complete = false;
    for (const j of list) jobs.push({ ...j, board: b.url, s: titleSimilarity(title, j.title), c: titleContains(title, j.title) });
  }
  if (!read.length) return out({ verdict: 'no_board', evidence: `the board did not answer: ${boards[0].url}` });
  jobs.sort((a, b) => b.s - a.s);
  // An exact title (the same role listed per location counts once) is found. A near or containing title
  // is found only when it is the one such title and both titles have three words or more: "Product
  // Manager" vs "Product Manager - Realtime" is a guess, not a match.
  const key = (j) => titleTokens(j.title).join(' ');
  const sole = (list) => (list.length && new Set(list.map(key)).size === 1 ? list[0] : null);
  const words = (t) => new Set(titleTokens(t)).size;
  const exact = jobs.find((j) => j.s === 1);
  const near = sole(jobs.filter((j) => j.s >= TITLE_MATCH));
  const contained = sole(jobs.filter((j) => j.c));
  const [hit, match] = exact ? [exact, 'exact']
    : near && words(title) >= 3 && words(near.title) >= 3 ? [near, 'near']
    : contained ? [contained, 'contained'] : [null, ''];
  if (hit) {
    return out({ verdict: 'found', match, employerUrl: hit.url, board: hit.board, live: 'open',
      evidence: `"${hit.title}" is listed on ${hit.board} today (${match} title match): compare it with the listing before treating it as the same role` });
  }
  const nearest = [];
  for (const j of jobs) if (nearest.length < 3 && !nearest.some((n) => n.title === j.title)) nearest.push({ title: j.title, url: j.url });
  const why = complete ? '' : '; the absence is not established (a board was read in part, did not answer, or was found by slug probing only)';
  return out({ verdict: 'board_without_role', board: read[0], near: nearest, complete,
    evidence: `${read.join(', ')} list${read.length > 1 ? '' : 's'} ${jobs.length} roles today, none with this title${why}` });
}

// ── CLI ────────────────────────────────────────────────────────────────
const USAGE = `Usage: node confirm-at-employer.mjs --input <posting.json> [--json]

  --input   JSON file: { "url": "...", "company": "...", "title": "...", "origin": "..." }
            (origin is optional: an employer link the posting itself gives)
  --json    print the result as JSON

Verdicts: ${VERDICTS.join(', ')}`;

function readText(p) { try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; } }

async function main(argv) {
  validateFlags(argv, ['--input', '--json', '--help', '-h'], USAGE, { valueFlags: ['--input'], requireOperand: true, usageExitCode: 2 });
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) { console.log(USAGE); return 0; }
  const file = flagValue(argv, '--input');
  if (!file) { console.error(USAGE); return 2; }
  let posting;
  try { posting = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`confirm-at-employer: cannot read ${file}: ${e.message}`); return 2; }
  const httpUrl = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };
  if (!posting || typeof posting.url !== 'string' || !httpUrl(posting.url.trim())) { console.error('confirm-at-employer: "url" must be an http(s) URL'); return 2; }
  const { PORTALS_PATH, SCAN_HISTORY_PATH } = await import('./scan.mjs');
  const r = await confirmAtEmployer(posting, { portalsText: readText(PORTALS_PATH), historyText: readText(SCAN_HISTORY_PATH) });
  if (hasFlag(argv, '--json')) { console.log(JSON.stringify(r, null, 2)); return 0; }
  console.log(`verdict:  ${r.verdict}`);
  if (r.employerUrl) console.log(`employer: ${r.employerUrl}`);
  if (r.board) console.log(`board:    ${r.board}`);
  if (r.match) console.log(`match:    ${r.match}`);
  console.log(`live:     ${r.live}`);
  if (r.verdict === 'board_without_role') console.log(`complete: ${r.complete}`);
  for (const n of r.near) console.log(`nearest:  ${n.title} — ${n.url}`);
  console.log(`evidence: ${r.evidence}`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e?.message || e); process.exitCode = 1; });
}
