#!/usr/bin/env node
// coverage-check.mjs — when the user brings in a posting the scanners did not
// surface, say WHY, and propose the one change that would have caught it.
// Zero-network: it reads portals.yml, data/scan-history.tsv, data/pipeline.md,
// the tracker and the reverse-sweep company lists cached under
// data/cache/ats-companies/, and loads the provider modules only to run their
// offline detect().
//
// It proposes, never edits portals.yml. The verdict is a closed set (GAPS), so
// data/coverage-misses.tsv can be counted later to see which channel keeps
// missing roles. Whether a miss is a one-off (an agency or aggregator posting,
// an off-target role) is the caller's judgment, recorded with --note.

import { appendFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadYaml } from './lib/yaml-document.mjs';
import { buildLocationFilter, extractPipelineCompanyRole, seenJobKey, APPLICATIONS_PATH, PORTALS_PATH, SCAN_HISTORY_PATH, PIPELINE_PATH } from './scan.mjs';
import { buildTitleFilter } from './title-keywords.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { mergeProviderPlugins } from './plugins/_engine.mjs';
import { parseTrackerRow, resolveColumns } from './tracker-parse.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';
import { scanHistoryDataLines } from './lib/scan-history-columns.mjs';

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
  // A stray % in a pasted URL ("100%-remote") is not a valid escape and makes
  // decodeURIComponent throw; keep such a segment as written.
  const decode = (segment) => { try { return decodeURIComponent(segment); } catch { return segment; } };
  const seg = u.pathname.split('/').filter(Boolean).map(decode);
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

const hostOf = (url) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};

// Every posting on disk that names a URL: scan history, pipeline and tracker.
function knownPostings(ctx) {
  const rows = [...ctx.history.values()].map(row => ({ url: row[0], company: row[4], source: 'scan history' }));
  for (const line of ctx.pipelineText.split('\n')) {
    const entry = extractPipelineCompanyRole(line);
    if (entry) rows.push({ url: entry.url, company: entry.company, source: 'pipeline' });
  }
  const trackerLines = (ctx.trackerText || '').split('\n');
  const colmap = resolveColumns(trackerLines);
  for (const line of trackerLines) {
    const row = parseTrackerRow(line, colmap);
    if (row?.url) rows.push({ url: row.url, company: row.company, source: 'tracker' });
  }
  return rows;
}

// What else is on disk for the posting's host. Hosts match exactly, so tenants
// on their own subdomains (acme.example.com, beta.example.com) don't count as
// one site: without a public-suffix list, co.uk would look like a site too.
function othersOnHost(posting, ctx) {
  const host = hostOf(posting.url);
  const self = seenJobKey(posting.url);
  const selfCompany = companyKey(posting.company);
  const postings = new Set();
  const sources = new Set();
  const companies = new Map();
  for (const { url, company, source } of knownPostings(ctx)) {
    if (hostOf(url) !== host || seenJobKey(url) === self) continue;
    postings.add(seenJobKey(url));
    sources.add(source);
    const key = companyKey(company);
    if (key && key !== selfCompany && !companies.has(key)) companies.set(key, String(company).trim());
  }
  return { host, postings: postings.size, sources: [...sources], companies: [...companies.values()] };
}

// A provider that already reads this site. detect() alone misses some: it knows
// a careers page, and a posting URL can differ (Dover's /Acme/careers/<uuid> vs
// /apply/Acme/<id>), so a provider named after a label of the host counts too.
function siteProvider(posting, host, providers) {
  const resolved = resolveProvider({ name: posting.company, careers_url: posting.url }, providers);
  if (resolved && !resolved.error) return resolved.provider.id;
  const labels = host.split('.');
  return [...providers.keys()].find(id => labels.includes(id)) || null;
}

const MAX_NAMED_COMPANIES = 5;

// For a site no job-site rule recognizes: the host evidence, and whether a
// provider for the site is the better fix than one company's portals.yml line.
// A provider covers every company on a multi-tenant site at once, and only an
// outside look at the site can say if it has a source a provider may read.
function siteVerdict(posting, target, ctx) {
  if (target.ats || !target.host) return { provider: null, reads: '', count: '', lead: '' };
  const { host, postings, sources, companies } = othersOnHost(posting, ctx);
  const provider = siteProvider(posting, host, ctx.providers);
  const reads = provider ? `provider ${provider} looks like it reads ${host}` : `no provider reads ${host}`;
  const named = companies.slice(0, MAX_NAMED_COMPANIES).join(', ');
  const more = companies.length > MAX_NAMED_COMPANIES ? `, +${companies.length - MAX_NAMED_COMPANIES} more` : '';
  const count = postings > 0
    ? `${postings} other posting${postings === 1 ? '' : 's'} on ${host} (${sources.join(', ')})${named ? `: ${named}${more}` : ''}`
    : '';
  const others = companies.length === 1 ? '1 other company posts' : `${companies.length} other companies post`;
  const lead = companies.length && !provider
    ? `${others} on ${host} too: one provider could cover all of them, if the site has a public, no-auth source (providers/ADDING_A_PROVIDER.md). For "${posting.company}" alone: `
    : '';
  return { provider, reads, count, lead };
}

/**
 * @param {{url: string, company: string, title: string, location?: string}} posting
 * @param {{config: any, entries: any[], providers: Map<string, any>, history: Map<string, string[]>,
 *          historyCompanies: Map<string, Set<string>>, pipelineText: string, trackerText?: string,
 *          datasets: Map<string, Set<string>>}} ctx
 */
export function diagnose(posting, ctx) {
  const { url, company, title, location } = posting;
  const evidence = [];
  const titleOk = buildTitleFilter(ctx.config.title_filter);
  const locationOk = location ? buildLocationFilter(ctx.config.location_filter)(location, url, title) : null;
  const target = atsFromUrl(url);

  const seen = ctx.history.get(seenJobKey(url));
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
    const inactiveReason = resolved && !resolved.error ? resolved.provider.inactiveReason : undefined;
    if (resolved && !resolved.error) {
      evidence.push(`provider: ${resolved.provider.id}${inactiveReason ? ` (plugin inactive: ${inactiveReason})` : ''}`);
    } else {
      // Scanners with their own company lists (scan-hn.mjs, scan-interamt.mjs, ...)
      // show up only in scan-history, under their own portal names.
      const searches = new Set((ctx.config.search_queries || []).map(q => q.name));
      const scanners = [...(ctx.historyCompanies.get(companyKey(company)) || [])].filter(p => !searches.has(p));
      if (scanners.length === 0) {
        evidence.push(resolved?.error || `no provider detects ${entry.careers_url || entry.name}`
          + (entry.scan_method === 'websearch' ? ' (scan_method: websearch, so only a WebSearch pass covers it)' : ''));
        const better = careersUrlFor(target);
        if (better) {
          return { gap: 'tracked-no-provider', evidence, fix: `point "${entry.name}".careers_url at ${better} (the posting lives on ${target.ats})` };
        }
        const site = siteVerdict(posting, target, ctx);
        if (site.count) evidence.push(site.count);
        return {
          gap: 'tracked-no-provider', evidence,
          fix: site.provider
            ? `point "${entry.name}".careers_url at its careers page on ${target.host}: provider ${site.provider} looks like it reads that site`
            : `${site.lead}none zero-token: no provider reads this site; WebSearch only`,
        };
      }
      evidence.push(`no provider for the portals.yml entry, but scanned as ${scanners.join(', ')}`);
    }
    if (!titleOk(title)) return { gap: 'tracked-title-filter', evidence, fix: `title keyword: no title_filter keyword matches "${title}"` };
    if (locationOk === false) return { gap: 'tracked-location-filter', evidence, fix: `location: location_filter drops "${location}"` };
    // An enabled provider plugin that cannot run (missing key, failed
    // integrity check) resolves to a stub: the scanner never reads this board.
    if (inactiveReason) {
      return { gap: 'tracked-not-seen', evidence, fix: `activate the "${resolved.provider.id}" plugin: ${inactiveReason} (node doctor.mjs shows its setup)` };
    }
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
    const site = siteVerdict(posting, target, ctx);
    evidence.push(target.ats ? `${target.ats} posting on a custom domain, board token unknown` : site.reads || 'no provider reads this URL');
    if (site.count) evidence.push(site.count);
    return {
      gap: 'untracked-unsupported-ats', evidence,
      fix: `${site.lead}add "${company}" with its careers page; if no provider resolves it, scan_method: websearch${caveat}`,
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
  const config = loadYaml(readFileSync(PORTALS_PATH, 'utf8')) || {};
  const entries = [...(config.tracked_companies || []), ...(config.job_boards || [])].filter(e => e && typeof e === 'object');
  const history = new Map();
  const historyCompanies = new Map();
  if (existsSync(SCAN_HISTORY_PATH)) {
    for (const line of scanHistoryDataLines(readFileSync(SCAN_HISTORY_PATH, 'utf8'))) {
      const row = line.split('\t');
      if (!row[0]) continue;
      history.set(seenJobKey(row[0]), row);
      const key = companyKey(row[4]);
      if (key) (historyCompanies.get(key) || historyCompanies.set(key, new Set()).get(key)).add(row[2]);
    }
  }
  const datasets = loadDatasets(DATASET_DIR);
  const pipelineText = existsSync(PIPELINE_PATH) ? readFileSync(PIPELINE_PATH, 'utf8') : '';
  const trackerText = existsSync(APPLICATIONS_PATH) ? readFileSync(APPLICATIONS_PATH, 'utf8') : '';
  return { config, entries, history, historyCompanies, datasets, pipelineText, trackerText };
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
  const key = seenJobKey(posting.url);
  const logged = existing.split('\n').slice(1).some(l => {
    const url = l.split('\t')[1];
    return Boolean(url) && seenJobKey(url) === key;
  });
  if (logged) return false;
  const row = [date, posting.url, posting.company, posting.title, result.gap, result.fix, note].map(clean).join('\t');
  // An unterminated last row (a hand edit) is closed first, or the new row fuses onto it.
  const lead = existing ? (existing.endsWith('\n') ? '' : '\n') : MISSES_HEADER + '\n';
  appendFileSync(file, lead + row + '\n');
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
  if (!existsSync(PORTALS_PATH)) {
    console.error(`Error: portals.yml not found at ${PORTALS_PATH}. Run onboarding first - the check reads its title_filter and tracked_companies.`);
    process.exit(1);
  }
  const providers = await loadProviders(path.join(CODE_ROOT, 'providers'));
  // Same provider map scan.mjs builds (#4026): without the enabled provider
  // plugins, an entry the scanner reads through one is diagnosed as
  // tracked-no-provider. No-op when config/plugins.yml is absent.
  await mergeProviderPlugins(providers, { root: CODE_ROOT, dataRoot: DATA_ROOT });
  const ctx = { ...loadContext(), providers };
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
