#!/usr/bin/env node
// coverage-check.mjs — when the user brings in a posting the scanners did not
// surface, say WHY, and propose the one change that would have caught it.
// Zero-network: it reads portals.yml, data/scan-history.tsv, data/pipeline.md
// and the reverse-sweep company lists cached under data/cache/ats-companies/,
// and loads the provider modules only to run their offline detect().
//
// It proposes, never edits portals.yml. The verdict is a closed set (GAPS), so
// data/coverage-misses.tsv can be counted later to see which channel keeps
// missing roles. Whether a miss is a one-off (an agency or aggregator posting,
// an off-target role) is the caller's judgment, recorded with --note.

import { appendFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { buildLocationFilter, normalizeUrlForDedup, PORTALS_PATH, SCAN_HISTORY_PATH, PIPELINE_PATH } from './scan.mjs';
import { buildTitleFilter } from './title-keywords.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';

const CODE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
const DATASET_DIR = path.join(DATA_ROOT, 'data/cache/ats-companies');
export const MISSES_PATH = path.join(DATA_ROOT, 'data/coverage-misses.tsv');
const MISSES_HEADER = 'date\turl\tcompany\ttitle\tgap\tfix\tnote';

const KNOWN_FLAGS = ['--company', '--title', '--location', '--note', '--log', '--json', '--help', '-h'];
const VALUE_FLAGS = ['--company', '--title', '--location', '--note'];
const USAGE = `Usage:
  node coverage-check.mjs <url> --company <name> --title <title> [--location <loc>]
  node coverage-check.mjs <url> ... --log [--note <text>]   # also append to data/coverage-misses.tsv
  node coverage-check.mjs <url> ... --json                  # machine-readable verdict
  node coverage-check.mjs --help                            # show this message`;

export const GAPS = {
  'surfaced': 'a scanner already surfaced it',
  'filtered': 'a scanner saw it and a filter dropped it',
  'tracked-disabled': 'tracked, but the entry is disabled',
  'tracked-no-provider': 'tracked, but no zero-token provider resolves the entry',
  'tracked-title-filter': 'tracked, but title_filter drops this title',
  'tracked-location-filter': 'tracked, but location_filter drops this location',
  'tracked-not-seen': 'tracked and passes the filters, but no scan has seen it yet',
  'untracked': 'company not in portals.yml',
  'untracked-unsupported-ats': 'company not in portals.yml, and no provider reads its job site',
};

// The job sites the reverse sweep (scan-ats-full.mjs) and the company-board
// providers understand, keyed the way data/cache/ats-companies/*.json lists them.
export function atsFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return { ats: null, host: null }; }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (seg[0] && !['embed', 'v1'].includes(seg[0])) return { ats: 'greenhouse', slug: seg[0].toLowerCase(), host };
    const forParam = u.searchParams.get('for');
    if (forParam) return { ats: 'greenhouse', slug: forParam.toLowerCase(), host };
  }
  if (/(^|\.)lever\.co$/.test(host) && seg[0]) return { ats: 'lever', slug: seg[0].toLowerCase(), host };
  if (host === 'jobs.ashbyhq.com' && seg[0]) return { ats: 'ashby', slug: seg[0].toLowerCase(), host };
  if (host === 'apply.workable.com' && seg[0]) return { ats: 'workable', slug: seg[0].toLowerCase(), host };
  const wd = host.match(/^([^.]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    // /{locale}/{site}/job/... or /{site}/job/...: the site is the segment before "job".
    const jobIdx = seg.indexOf('job');
    const site = (jobIdx > 0 ? seg[jobIdx - 1] : seg.find(s => !/^[a-z]{2}-[A-Z]{2}$/.test(s))) || '';
    return { ats: 'workday', slug: `${wd[1]}|${wd[2]}|${site}`.toLowerCase(), host };
  }
  const ic = host.match(/^(?:careers-)?([^.]+)\.icims\.com$/);
  if (ic) return { ats: 'icims', slug: ic[1].toLowerCase(), host };
  // A custom careers domain that embeds Greenhouse: the board token is not in the URL.
  if (u.searchParams.has('gh_jid')) return { ats: 'greenhouse', slug: null, host };
  return { ats: null, host };
}

export function careersUrlFor({ ats, slug }) {
  if (!slug) return null;
  switch (ats) {
    case 'greenhouse': return `https://job-boards.greenhouse.io/${slug}`;
    case 'lever': return `https://jobs.lever.co/${slug}`;
    case 'ashby': return `https://jobs.ashbyhq.com/${slug}`;
    case 'workable': return `https://apply.workable.com/${slug}`;
    case 'icims': return `https://careers-${slug}.icims.com/jobs`;
    case 'workday': {
      const [tenant, wd, site] = slug.split('|');
      return `https://${tenant}.${wd}.myworkdayjobs.com/${site}`;
    }
    default: return null;
  }
}

// "Acme (EU roles only)" is Acme: entry names often carry a note in parentheses.
export const companyKey = (name) => normalizeCompany(String(name || '').replace(/\([^)]*\)/g, ' '));

// The boards an entry reads, as atsFromUrl() keys them.
const entryBoards = (e) => ['careers_url', 'api']
  .filter(field => typeof e[field] === 'string')
  .map(field => atsFromUrl(e[field]));

// A board match wins over a name match, so an entry named like the company
// but reading another board never shadows the entry that reads this one.
export function findTrackedEntry(entries, { ats, slug, company }) {
  const key = companyKey(company);
  return (slug && entries.find(e => entryBoards(e).some(b => b.ats === ats && b.slug === slug)))
    || (key && entries.find(e => companyKey(e.name) === key))
    || null;
}

/**
 * @param {{url: string, company: string, title: string, location?: string}} posting
 * @param {{config: any, entries: any[], providers: Map<string, any>, history: Map<string, string[]>,
 *          historyCompanies: Map<string, Set<string>>, pipelineText: string, datasets: Map<string, Set<string>>}} ctx
 */
export function diagnose(posting, ctx) {
  const { url, company, title, location } = posting;
  const evidence = [];
  const titleOk = buildTitleFilter(ctx.config.title_filter);
  const locationOk = location ? buildLocationFilter(ctx.config.location_filter)(location, url, title) : null;
  const target = atsFromUrl(url);

  const seen = ctx.history.get(normalizeUrlForDedup(url));
  if (seen) {
    const [, firstSeen, portal, , , status] = seen;
    evidence.push(`scan-history: ${status} on ${firstSeen} via ${portal}`);
    if (status === 'added') {
      const inPipeline = ctx.pipelineText.includes(url) || ctx.pipelineText.includes(seen[0]);
      evidence.push(inPipeline ? 'it is in data/pipeline.md' : 'not in data/pipeline.md any more (triaged or pruned)');
      return { gap: 'surfaced', evidence, fix: 'none: the scanners have it' };
    }
    const fix = status === 'skipped_title' ? 'title keyword: decide whether title_filter should match this title'
      : status === 'skipped_location' ? 'location: decide whether location_filter should keep this location'
        : `none, unless the ${status} decision was wrong`;
    return { gap: 'filtered', evidence, fix };
  }

  const entry = findTrackedEntry(ctx.entries, { ...target, company });
  if (entry) {
    evidence.push(`portals.yml entry "${entry.name}" (${entry.careers_url || entry.api || 'no careers_url'})`);
    // Matched by name only: the company may have moved ATS or run a second board.
    const boards = entryBoards(entry);
    const otherBoard = Boolean(target.ats && target.slug)
      && !boards.some(b => b.ats === target.ats && b.slug === target.slug);
    if (otherBoard) {
      const reads = boards.filter(b => b.ats).map(b => `${b.ats}:${b.slug ?? '?'}`).join(', ');
      evidence.push(`posting is on ${target.ats}:${target.slug}, entry reads ${reads || (entry.careers_url || entry.api || 'no board')}`);
    }
    if (entry.enabled === false) return { gap: 'tracked-disabled', evidence, fix: `re-enable "${entry.name}" if its board is live` };
    const resolved = resolveProvider(entry, ctx.providers);
    if (resolved && !resolved.error) {
      evidence.push(`provider: ${resolved.provider.id}`);
    } else {
      // Scanners with their own company lists (scan-hn.mjs, scan-interamt.mjs, ...)
      // show up only in scan-history, under their own portal names.
      const searches = new Set((ctx.config.search_queries || []).map(q => q.name));
      const scanners = [...(ctx.historyCompanies.get(companyKey(company)) || [])].filter(p => !searches.has(p));
      if (scanners.length === 0) {
        evidence.push(resolved?.error || `no provider detects ${entry.careers_url || entry.name}`
          + (entry.scan_method === 'websearch' ? ' (scan_method: websearch, so only a WebSearch pass covers it)' : ''));
        const better = careersUrlFor(target);
        return {
          gap: 'tracked-no-provider', evidence,
          fix: better ? `point "${entry.name}".careers_url at ${better} (the posting lives on ${target.ats})` : 'none zero-token: no provider reads this site; WebSearch only',
        };
      }
      evidence.push(`no provider for the portals.yml entry, but scanned as ${scanners.join(', ')}`);
    }
    if (!titleOk(title)) return { gap: 'tracked-title-filter', evidence, fix: `title keyword: no title_filter keyword matches "${title}"` };
    if (locationOk === false) return { gap: 'tracked-location-filter', evidence, fix: `location: location_filter drops "${location}"` };
    if (otherBoard) {
      return { gap: 'tracked-not-seen', evidence, fix: `the entry reads another board: point "${entry.name}".careers_url at ${careersUrlFor(target)}, or add that board as a second entry` };
    }
    return { gap: 'tracked-not-seen', evidence, fix: 'none: newer than the last scan, or the provider did not return it (check its board once)' };
  }

  // Untracked. Would anything that already runs have caught it?
  const seenVia = ctx.historyCompanies.get(companyKey(company));
  if (seenVia) evidence.push(`company seen before via ${[...seenVia].join(', ')}`);
  if (target.ats && target.slug) {
    const list = ctx.datasets.get(target.ats);
    if (list) {
      evidence.push(list.has(target.slug)
        ? `in the reverse-sweep company list (${target.ats}: ${target.slug})`
        : `NOT in the reverse-sweep company list for ${target.ats} (${target.slug})`);
      const full = buildTitleFilter(ctx.config.title_filter_full || ctx.config.title_filter);
      evidence.push(`${ctx.config.title_filter_full ? 'title_filter_full' : 'title_filter'} ${full(title) ? 'keeps' : 'drops'} this title in the reverse sweep`);
    }
  }
  const wouldPass = titleOk(title);
  evidence.push(`as a tracked company, title_filter would ${wouldPass ? 'keep' : 'drop'} this title`);
  if (locationOk === false) evidence.push(`location_filter drops "${location}"`);

  const caveat = locationOk === false ? ' (location_filter would still drop this posting)' : '';
  const careersUrl = careersUrlFor(target);
  if (!careersUrl) {
    evidence.push(target.ats ? `${target.ats} posting on a custom domain, board token unknown` : `no provider reads ${target.host || 'this URL'}`);
    return {
      gap: 'untracked-unsupported-ats', evidence,
      fix: `add "${company}" with its careers page; if no provider resolves it, scan_method: websearch${caveat}`,
    };
  }
  const resolves = resolveProvider({ name: company, careers_url: careersUrl }, ctx.providers);
  evidence.push(resolves && !resolves.error ? `proposed careers_url resolves to provider ${resolves.provider.id}` : 'proposed careers_url resolves to no provider');
  const fix = wouldPass
    ? `add to tracked_companies: { name: "${company}", careers_url: ${careersUrl} }${caveat}`
    : `add the company only with a title keyword that matches "${title}", or not at all`;
  return { gap: 'untracked', evidence, fix };
}

export function loadContext() {
  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf8')) || {};
  const entries = [...(config.tracked_companies || []), ...(config.job_boards || [])].filter(e => e && typeof e === 'object');
  const history = new Map();
  const historyCompanies = new Map();
  if (existsSync(SCAN_HISTORY_PATH)) {
    for (const line of readFileSync(SCAN_HISTORY_PATH, 'utf8').split('\n').slice(1)) {
      const row = line.split('\t');
      if (!row[0]) continue;
      history.set(normalizeUrlForDedup(row[0]), row);
      const key = companyKey(row[4]);
      if (key) (historyCompanies.get(key) || historyCompanies.set(key, new Set()).get(key)).add(row[2]);
    }
  }
  const datasets = loadDatasets(DATASET_DIR);
  const pipelineText = existsSync(PIPELINE_PATH) ? readFileSync(PIPELINE_PATH, 'utf8') : '';
  return { config, entries, history, historyCompanies, datasets, pipelineText };
}

// The reverse sweep's company lists are optional evidence: a file truncated
// by an interrupted sweep, or holding anything but an array, is skipped.
export function loadDatasets(dir) {
  const datasets = new Map();
  for (const ats of ['greenhouse', 'lever', 'ashby', 'workday', 'icims']) {
    const file = path.join(dir, `${ats}.json`);
    if (!existsSync(file)) continue;
    try {
      const list = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(list)) datasets.set(ats, new Set(list.map(s => String(s).toLowerCase())));
    } catch { /* unreadable: no reverse-sweep evidence for this ATS */ }
  }
  return datasets;
}

const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();

export function appendMiss(file, posting, result, note, date) {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const key = normalizeUrlForDedup(posting.url);
  const logged = existing.split('\n').slice(1).some(l => {
    const url = l.split('\t')[1];
    return Boolean(url) && normalizeUrlForDedup(url) === key;
  });
  if (logged) return false;
  const row = [date, posting.url, posting.company, posting.title, result.gap, result.fix, note].map(clean).join('\t');
  appendFileSync(file, (existing ? '' : MISSES_HEADER + '\n') + row + '\n');
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  const valueIdx = new Set(args.flatMap((a, i) => (VALUE_FLAGS.includes(a) ? [i + 1] : [])));
  const url = args.find((a, i) => !a.startsWith('-') && !valueIdx.has(i));
  const posting = { url, company: flagValue(args, '--company') || '', title: flagValue(args, '--title') || '', location: flagValue(args, '--location') || '' };
  if (!posting.url || !posting.company || !posting.title) {
    console.error(`Error: a URL, --company and --title are required\n\n${USAGE}`);
    process.exit(1);
  }
  const ctx = { ...loadContext(), providers: await loadProviders(path.join(CODE_ROOT, 'providers')) };
  const result = diagnose(posting, ctx);
  const log = args.includes('--log');
  const logged = log && result.gap !== 'surfaced'
    ? appendMiss(MISSES_PATH, posting, result, flagValue(args, '--note') || '', localToday())
    : false;
  if (args.includes('--json')) {
    console.log(JSON.stringify({ ...posting, ...result, meaning: GAPS[result.gap], logged }, null, 2));
    return;
  }
  console.log(`${posting.company} | ${posting.title}`);
  console.log(`gap: ${result.gap} (${GAPS[result.gap]})`);
  for (const e of result.evidence) console.log(`  - ${e}`);
  console.log(`fix: ${result.fix}`);
  if (log) console.log(logged ? `logged to ${path.relative(DATA_ROOT, MISSES_PATH)}` : 'not logged (already surfaced, or URL already in the log)');
}

if (isMainModule(import.meta.url)) await main();
