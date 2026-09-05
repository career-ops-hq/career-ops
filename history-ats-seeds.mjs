import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { atsVendorOf } from './ats-vendor.mjs';
import { detectColumns, extractTrackerReportNumbers, isHeaderRow, isSeparatorRow } from './tracker-parse.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { resolveWorkspaceRoot } from './tracker-utils.mjs';

const WEB_URL_RE = /https?:\/\/[^\s|)>]+/i;

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

  const parts = u.pathname.split('/').filter(Boolean);
  if (vendor === 'greenhouse' || vendor === 'lever' || vendor === 'ashby' || vendor === 'smartrecruiters') {
    if (parts[0]) u.pathname = `/${parts[0]}`;
  } else if (vendor === 'workday') {
    const withoutLocale = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || '') ? parts.slice(1) : parts;
    if (withoutLocale[0]) u.pathname = `/${withoutLocale[0]}`;
  } else if (vendor === 'successfactors') {
    const endpointAt = parts.findIndex((part) => /^(?:job|search|tile-search-results|services)$/i.test(part));
    u.pathname = endpointAt > 0 ? `/${parts.slice(0, endpointAt).join('/')}` : '/';
  } else if (vendor === 'icims' || vendor === 'bamboohr') {
    u.pathname = '/';
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

function reportUrlForNumbers(reportNumbers, reportsRoot) {
  if (!reportsRoot || !existsSync(reportsRoot) || reportNumbers.length === 0) return null;
  let filenames;
  try { filenames = readdirSync(reportsRoot); } catch { return null; }
  for (const reportNum of reportNumbers) {
    const reportName = filenames.find((name) => new RegExp(`^0*${reportNum}-.*\\.md$`, 'i').test(name));
    if (!reportName) continue;
    let report;
    try { report = readFileSync(path.join(reportsRoot, reportName), 'utf-8'); } catch { continue; }
    const match = report.match(/\*\*URL:\*\*[ \t]*(\S+)/);
    if (!match) continue;
    const url = match[1].replace(/^<|>$/g, '').replace(/[),.;]+$/, '');
    if (atsVendorOf(url)) return url;
  }
  return null;
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
    const directUrl = columns.url == null ? null : cells[columns.url];
    const reportNumbers = extractTrackerReportNumbers(
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
    const cells = line.split('\t');
    if (String(cells[0]).trim().toLowerCase() === 'url') continue;
    const seed = seedOf(cells[4], cells[0], 'scan-history');
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
