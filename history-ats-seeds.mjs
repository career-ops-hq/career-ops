import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { atsVendorOf } from './ats-vendor.mjs';
import { parseScanHistoryLine } from './lib/scan-history-columns.mjs';
import { detectColumns, extractCellUrl, isHeaderRow, isSeparatorRow, linkedReportNumbers, reportUrlForNumbers as reportUrlFromReports } from './tracker-parse.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { hireHiveTenantOf } from './providers/hirehive.mjs';
import { resolveHibobTenant } from './providers/hibob.mjs';
import { resolveHomerunFeedUrl } from './providers/homerun.mjs';
import { resolveBoardUrl as resolvePaylocityBoardUrl } from './providers/paylocity.mjs';
import { resolveBoard as resolveTalentlinkBoard } from './providers/talentlink.mjs';
import { extractClient as extractTrakstarClient } from './providers/trakstar.mjs';
import { resolveWorkspaceRoot } from './tracker-utils.mjs';

const WEB_URL_RE = /https?:\/\/[^\s|)>]+/i;

// Vendors whose provider reads only HTTPS boards. Every one serves its boards
// over HTTPS, so an http:// posting link is upgraded instead of becoming a seed
// detect() refuses after it has taken a --limit slot.
const HTTPS_VENDORS = new Set([
  'adp-workforcenow', 'applicantpro', 'breezy', 'comeet', 'gem', 'homerun', 'jazzhr',
  'jobvite', 'join', 'keka', 'mokahr', 'paylocity', 'personio', 'pinpoint', 'polymer',
  'prevueaps', 'recruitee', 'rippling', 'schoolspring', 'taleez', 'teamtailor',
  'trakstar', 'turbohire', 'workable', 'zoho-recruit',
]);

// Vendors whose provider reads the board from the tenant subdomain alone, so
// every posting on one board reduces to the same origin.
const TENANT_ORIGIN_VENDORS = new Set([
  'applicantpro', 'bamboohr', 'breezy', 'icims', 'jazzhr', 'keka', 'personio',
  'pinpoint', 'prevueaps', 'recruitee', 'schoolspring', 'taleez', 'teamtailor',
  'turbohire', 'zoho-recruit',
]);

// Vendors whose provider reads the board slug from the first path segment.
// A first segment in the set is a platform route, not a board (Workable's
// `/j/<shortcode>` feed links name no company).
const FIRST_SEGMENT_VENDORS = new Map([
  ['ashby', new Set()],
  ['jobvite', new Set(['api'])],
  ['lever', new Set()],
  ['rippling', new Set(['api'])],
  ['smartrecruiters', new Set()],
  ['workable', new Set(['api', 'j'])],
]);

// Vendors with exactly one board host: a URL on the vendor's other (API) host
// carries no board slug in its path.
const BOARD_HOST_OF = { gem: 'jobs.gem.com', polymer: 'jobs.polymer.co' };

function webUrlFrom(value) {
  const match = String(value ?? '').match(WEB_URL_RE);
  return match?.[0] ?? null;
}

/**
 * Convert a historical posting URL into the board-shaped URL expected by the
 * corresponding provider. Unknown vendors keep the original URL: they remain
 * visible in the derived seed set and become scannable automatically once a
 * provider with the same id exists.
 */
export function atsBoardUrlOf(rawUrl, vendor = atsVendorOf(rawUrl)) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (HTTPS_VENDORS.has(vendor)) u.protocol = 'https:';

  const parts = u.pathname.split('/').filter(Boolean);
  if (vendor === 'greenhouse') {
    // Older Greenhouse postings use boards.greenhouse.io, but the current
    // provider detects the public boards API at job-boards.greenhouse.io.
    if (u.hostname.toLowerCase() === 'boards.greenhouse.io') {
      u.hostname = 'job-boards.greenhouse.io';
    }
    if (parts[0]) u.pathname = `/${parts[0]}`;
  } else if (FIRST_SEGMENT_VENDORS.has(vendor)) {
    // The Jobvite provider reads a board from jobs.jobvite.com/<slug> only; an
    // app.jobvite.com feed URL works as `api:`, never as a careers_url.
    if (vendor === 'jobvite' && u.hostname.toLowerCase() !== 'jobs.jobvite.com') return null;
    // A bare host names no board; the provider would refuse it.
    if (!parts[0] || FIRST_SEGMENT_VENDORS.get(vendor).has(parts[0].toLowerCase())) return null;
    u.pathname = `/${parts[0]}`;
  } else if (Object.hasOwn(BOARD_HOST_OF, vendor)) {
    if (u.hostname.toLowerCase() !== BOARD_HOST_OF[vendor] || !parts[0]) return null;
    u.pathname = `/${parts[0]}`;
  } else if (vendor === 'join') {
    if (parts[0] !== 'companies' || !parts[1]) return null;
    u.pathname = `/companies/${parts[1]}`;
  } else if (vendor === 'homerun') {
    // <slug>.homerun.co and feed.homerun.co/<slug> are one board; the provider
    // maps both to the feed URL, so the seed uses that one spelling.
    return resolveHomerunFeedUrl({ careers_url: u.href });
  } else if (vendor === 'mokahr') {
    // The board is /<kind>/<orgId>/<siteId>; the posting itself sits in the hash.
    if (parts.length < 3) return null;
    u.pathname = `/${parts.slice(0, 3).join('/')}`;
  } else if (vendor === 'paylocity') {
    // Only a board URL names the company GUID; a posting URL carries a job id.
    // The provider rebuilds the board from a valid GUID in its own spelling,
    // so letter case cannot split a board and a malformed GUID gives no seed.
    return resolvePaylocityBoardUrl({ careers_url: u.href });
  } else if (vendor === 'adp-workforcenow') {
    // The tenant lives in the query (cid, ccId, lang), which the generic
    // cleanup below would drop; keep those three and nothing else.
    const cid = u.searchParams.get('cid');
    const ccId = u.searchParams.get('ccId');
    if (!cid || !ccId) return null;
    const lang = u.searchParams.get('lang');
    const board = new URL(`${u.origin}/mascsr/default/mdf/recruitment/recruitment.html`);
    board.searchParams.set('cid', cid);
    board.searchParams.set('ccId', ccId);
    if (lang) board.searchParams.set('lang', lang);
    return board.href;
  } else if (vendor === 'comeet') {
    // The provider reads only the careers-api URL with its secret token, which
    // a posting URL never carries.
    return null;
  } else if (vendor === 'workday') {
    const withoutLocale = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || '') ? parts.slice(1) : parts;
    if (withoutLocale[0]) u.pathname = `/${withoutLocale[0]}`;
  } else if (vendor === 'successfactors') {
    const endpointAt = parts.findIndex((part) => /^(?:job|search|tile-search-results|services)$/i.test(part));
    u.pathname = endpointAt > 0 ? `/${parts.slice(0, endpointAt).join('/')}` : '/';
  } else if (vendor === 'trakstar') {
    // <client>.hire.trakstar.com, the legacy <client>.recruiterbox.com and the
    // openings API's ?client_name= all name one board. The provider's parser
    // applies its path, slug and reserved-label rules; the seed uses the
    // current tenant host.
    const client = extractTrakstarClient(u.href);
    return client ? `https://${client}.hire.trakstar.com` : null;
  } else if (TENANT_ORIGIN_VENDORS.has(vendor)) {
    // www.applicantpro.com/openings/<tenant>/… is an alias of the tenant host.
    if (vendor === 'applicantpro' && u.hostname.toLowerCase() === 'www.applicantpro.com') {
      const tenant = parts[0]?.toLowerCase() === 'openings' ? parts[1]?.toLowerCase() : '';
      if (!tenant || !/^[a-z0-9][a-z0-9-]*$/.test(tenant)) return null;
      u.hostname = `${tenant}.applicantpro.com`;
    }
    u.pathname = '/';
  } else if (vendor === 'hibob') {
    // Seeds are sampled under --limit before detect() runs, so a host the
    // provider refuses is dropped here instead of taking a real board's slot.
    if (!resolveHibobTenant(rawUrl)) return null;
    u.pathname = '/';
  } else if (vendor === 'hirehive') {
    // Seeds are sampled under --limit before detect() runs, so a host the
    // provider refuses is dropped here instead of taking a real board's slot.
    if (u.protocol !== 'https:' || !hireHiveTenantOf(u.hostname)) return null;
    u.pathname = '/';
  } else if (vendor === 'talentlink') {
    // The site path (`/internal`, `/FO/<code>/components`) is part of the
    // board; only the page file (`details.html`, `index.html`) is dropped.
    // Seeds are sampled under --limit before detect() runs, so a URL the
    // provider refuses is dropped here instead of taking a real board's slot.
    const board = resolveTalentlinkBoard(rawUrl);
    if (!board) return null;
    u = new URL(board.boardDir);
  }
  u.search = '';
  u.hash = '';
  return u.href.replace(/\/$/, '');
}

function seedOf(company, rawUrl, source) {
  const url = webUrlFrom(rawUrl);
  const vendor = atsVendorOf(url);
  if (!url || !vendor) return null;
  const careersUrl = atsBoardUrlOf(url, vendor);
  if (!careersUrl) return null;
  let host;
  try { host = new URL(careersUrl).hostname; } catch { return null; }
  return {
    company: String(company ?? '').trim() || host,
    vendor,
    careersUrl,
    source,
  };
}

export function reportUrlForNumbers(reportNumbers, reportsRoot, accept = atsVendorOf) {
  return reportUrlFromReports(reportNumbers, reportsRoot, accept);
}

export function parseTrackerAtsSeeds(text, { reportsRoot } = {}) {
  if (typeof text !== 'string' || !text) return [];
  const lines = text.split(/\r?\n/);
  const columns = detectColumns(lines);
  if (!columns || columns.company == null) return [];
  const seeds = [];
  for (const line of lines) {
    if (!line.startsWith('|') || isHeaderRow(line) || isSeparatorRow(line)) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    // The canonical nine-column tracker has no URL column. Its Report cell
    // links to the evaluation report that owns the posting's **URL:** field.
    // Custom trackers may carry URL directly; prefer it but never scrape an
    // arbitrary Notes URL, which may be unrelated evidence.
    // The URL cell may be a markdown link (#3516): read its HREF through the
    // shared extractor rather than relying on WEB_URL_RE happening to stop
    // at the link's closing paren — the same contract every tracker reader
    // follows, and one regex edit away from breaking if left implicit.
    const directUrl = columns.url == null ? null : extractCellUrl(cells[columns.url]);
    const reportNumbers = linkedReportNumbers(
      columns.report == null ? '' : cells[columns.report],
      columns.notes == null ? '' : cells[columns.notes],
    );
    const url = webUrlFrom(directUrl) || reportUrlForNumbers(reportNumbers, reportsRoot);
    const seed = seedOf(cells[columns.company], url, 'tracker');
    if (seed) seeds.push(seed);
  }
  return seeds;
}

export function parseScanHistoryAtsSeeds(text) {
  if (typeof text !== 'string' || !text) return [];
  const seeds = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = parseScanHistoryLine(line);
    if (row.url.trim().toLowerCase() === 'url') continue;
    const seed = seedOf(row.company, row.url, 'scan-history');
    if (seed) seeds.push(seed);
  }
  return seeds;
}

function readIfPresent(file) {
  if (!file || !existsSync(file)) return '';
  try { return readFileSync(file, 'utf-8'); } catch { return ''; }
}

/**
 * Read the user's tracker and scan history without writing either one.
 * Duplicate postings from the same board collapse to one provider fetch.
 */
export function loadHistoryAtsSeeds({
  dataRoot = getCareerOpsRoot(),
  trackerPath = resolveTrackerPath(dataRoot),
  scanHistoryPath = process.env.CAREER_OPS_SCAN_HISTORY || path.join(dataRoot, 'data/scan-history.tsv'),
} = {}) {
  const reportsRoot = path.join(resolveWorkspaceRoot(trackerPath), 'reports');
  const combined = [
    ...parseTrackerAtsSeeds(readIfPresent(trackerPath), { reportsRoot }),
    ...parseScanHistoryAtsSeeds(readIfPresent(scanHistoryPath)),
  ];
  const unique = new Map();
  for (const seed of combined) {
    const key = `${seed.vendor}\t${seed.careersUrl}`;
    if (!unique.has(key)) unique.set(key, seed);
  }
  return [...unique.values()];
}
