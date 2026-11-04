/**
 * scan-local-lib.mjs — filters, dedup and run-log writer shared by the local
 * scanners (scan-seek.mjs, scan-linkedin.mjs). Local-only; upstream does not ship it.
 *
 * Title matching reuses title-keywords.mjs and the role key reuses scan.mjs's
 * companyRoleDedupKey, so all three scanners agree on what a keyword and a
 * "same role" mean.
 */

import { readFileSync, appendFileSync, existsSync } from 'fs';
import { buildTitleFilter } from './title-keywords.mjs';
import { companyRoleDedupKey } from './scan.mjs';
import { normalizeCompanyName } from './invite-match.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';

// ---------------------------------------------------------------- filters

// Same predicate as scan.mjs: word:/stem: prefixes, " + " AND-groups, anchored acronyms.
export function makeTitleFilter(titleFilter = {}) {
  const ok = buildTitleFilter(titleFilter);
  return (title) => {
    if (!String(title || '').trim()) return { pass: false, reason: 'empty-title' };
    return ok(title) ? { pass: true } : { pass: false, reason: 'title' };
  };
}

// Backstop only: Seek/LinkedIn queries are already geo-scoped to NZ, so an
// unmatched location passes. Block wins unless always_allow matched.
export function makeLocationFilter(locationFilter) {
  if (!locationFilter) return () => ({ pass: true });
  const lower = (list) => (list || []).map((s) => String(s).toLowerCase());
  const always = lower(locationFilter.always_allow);
  const block = lower(locationFilter.block);
  return (location) => {
    const l = String(location || '').toLowerCase();
    if (!l) return { pass: true, reason: 'no-location' };
    if (always.some((k) => k && l.includes(k))) return { pass: true };
    const hit = block.find((k) => k && l.includes(k));
    return hit ? { pass: false, reason: `block:${hit}` } : { pass: true };
  };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blNorm = (s) => String(s || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();

// Whole-word match either way ("Randstad" catches "Randstad New Zealand";
// "Part" does not catch "Partly"). Empty company is never a match.
export function loadBlacklist(path) {
  if (!path || !existsSync(path)) return () => false;
  const names = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => blNorm(l.replace(/^[\s|]+/, '').split('|')[0]))
    .filter((n) => n && n !== 'company' && !/^[-:]+$/.test(n));
  const res = names.map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'u'));
  return (company) => {
    const c = blNorm(company);
    if (!c) return false;
    const cRe = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(c)}(?![\\p{L}\\p{N}])`, 'u');
    return res.some((re, i) => re.test(c) || cRe.test(names[i]));
  };
}

// Non-permanent signals in Seek's workTypes / salary label ("Contract/Temp",
// "Competitive Daily Rate", "$100/hr"). Titles are covered by title_filter negatives.
const CONTRACT_RE = /contract|\btemp|casual|daily rate|day rate|per hour|hourly|\/\s*(?:hr|hour)\b/i;
export function looksContract(...fields) {
  return fields.some((f) => CONTRACT_RE.test(String(f || '')));
}

// ---------------------------------------------------------------- dedup

// Trailing location / arrangement tails that vary between cross-listings of one
// role: "- Auckland", ", Auckland CBD", "(Remote)", "| Permanent".
const TAIL_WORDS =
  'auckland(?: cbd)?|wellington|christchurch|new zealand|nz|remote|hybrid|on[- ]?site|permanent|full[- ]time';
const TAIL_RE = new RegExp(`\\s*(?:[-–—|/,]\\s*|\\()(?:${TAIL_WORDS})\\)?\\s*$`, 'i');

export function stripTitleTail(title) {
  let t = String(title || '').trim();
  for (let prev = ''; prev !== t; ) {
    prev = t;
    t = t.replace(TAIL_RE, '').trim();
  }
  return t;
}

export function roleKey(company, title) {
  const t = stripTitleTail(title);
  if (!String(company || '').trim() || !t) return null;
  return companyRoleDedupKey(company, t, normalizeCompanyName);
}

// "- [ ] url | company | title (loc · salary · date)" and struck-through triage
// rows "- ~~url~~ | company | title (...) — _reason_". Drops the trailing
// metadata parenthetical, keeps a real qualifier like "(Angular)".
export function parsePipelineLine(line) {
  const m = String(line).match(/^\s*-\s+(?:\[[ x]\]\s+)?\S+\s*\|\s*([^|]+?)\s*\|\s*(.+)$/);
  if (!m) return null;
  let title = m[2].replace(/\s+—\s+_.*$/, '').split('|')[0].trim();
  title = title.replace(/\s*\(([^()]*)\)\s*$/, (all, inner) =>
    /\d{4}-\d{2}-\d{2}|·|auckland|new zealand|posted:/i.test(inner) ? '' : all
  );
  return { company: m[1], title: title.trim() };
}

/**
 * Seen-role index across tracker, scan-history (any source) and pipeline.
 * tracker: key -> first row #; seen: every key; employers: company -> row #s.
 * All paths are required arguments so callers get them from scan.mjs (which
 * honors CAREER_OPS_ROOT) instead of hardcoding relative paths.
 */
export function loadRoleIndex({
  applicationsPath,
  scanHistoryPath,
  pipelinePath,
} = {}) {
  if (!applicationsPath || !scanHistoryPath || !pipelinePath) {
    throw new Error('loadRoleIndex requires applicationsPath, scanHistoryPath and pipelinePath');
  }
  const tracker = new Map();
  const seen = new Set();
  const employers = new Map();
  if (existsSync(applicationsPath)) {
    const lines = readFileSync(applicationsPath, 'utf8').split('\n');
    const colmap = resolveColumns(lines);
    for (const line of lines) {
      const row = parseTrackerRow(line, colmap);
      if (!row) continue;
      const key = roleKey(row.company, row.role);
      if (!key) continue;
      if (!tracker.has(key)) tracker.set(key, row.num);
      seen.add(key);
      const c = normalizeCompanyName(row.company);
      if (!employers.has(c)) employers.set(c, []);
      employers.get(c).push(row.num);
    }
  }
  if (existsSync(scanHistoryPath)) {
    // url, first_seen, portal, title, company, status, location
    for (const line of readFileSync(scanHistoryPath, 'utf8').split('\n')) {
      const cols = line.split('\t');
      if (cols.length < 6 || !['added', 'new'].includes(cols[5])) continue;
      const key = roleKey(cols[4], cols[3]);
      if (key) seen.add(key);
    }
  }
  if (existsSync(pipelinePath)) {
    for (const line of readFileSync(pipelinePath, 'utf8').split('\n')) {
      const p = parsePipelineLine(line);
      const key = p && roleKey(p.company, p.title);
      if (key) seen.add(key);
    }
  }
  return {
    tracker,
    seen,
    employerRows: (company) => employers.get(normalizeCompanyName(company)) || [],
  };
}

// ---------------------------------------------------------------- run log

// Map counters onto scan-runs.tsv's own header so rows stay readable by name
// (stats.mjs skips rows narrower than the header). Unknown columns get 0.
export function appendRunRow(path, values) {
  if (!existsSync(path)) return;
  const header = readFileSync(path, 'utf8').split('\n', 1)[0].split('\t').map((h) => h.trim());
  const row = header.map((h) => (values[h] ?? 0));
  appendFileSync(path, row.join('\t') + '\n');
}

// ---------------------------------------------------------------- salary

/**
 * Read the advertised ceiling out of a Seek `salaryLabel`.
 *
 * Labels are free text, so this reads conservatively: collect every money-like
 * number, normalise `150k` and `150,000` to 150000, then drop anything below
 * PLAUSIBLE_MIN. That threshold is what stops "2k training budget" from being
 * read as a 2000 salary, and it also parks hourly and daily contractor rates in
 * the no-signal bucket — where they belong, since a $110/hr rate is not
 * comparable to an annual figure.
 *
 * Returns null for "no usable signal". A null NEVER filters: absence of a
 * number is not evidence of a low number.
 */
const PLAUSIBLE_MIN = 40_000;

export function parseSalaryCeiling(label) {
  if (!label) return null;
  const values = [];
  for (const m of String(label).matchAll(/(\d[\d,\.]*)\s*(k\b)?/gi)) {
    const raw = m[1].replace(/,/g, '');
    if (!raw || !/^\d/.test(raw)) continue;
    let n = parseFloat(raw);
    if (!Number.isFinite(n)) continue;
    if (m[2]) n *= 1000; // "150k"
    if (n >= PLAUSIBLE_MIN) values.push(n);
  }
  return values.length ? Math.max(...values) : null;
}

// ---------------------------------------------------------------- classify

/**
 * Per-listing verdict shared by both local scanners, in order: repost (tracker,
 * history, pipeline, earlier in this run) → title → location → blacklist →
 * non-permanent → salary floor → keep. URL/id dedup stays in each scanner.
 * `related` lists tracker rows at the same employer, as a triage hint.
 */
export function makeJobClassifier({ cfg = {}, index, isBlacklisted, salaryFloor = null, includeBlacklisted = false }) {
  const titleOk = makeTitleFilter(cfg.title_filter);
  const locationOk = makeLocationFilter(cfg.location_filter);
  const run = new Set();
  return (j) => {
    const key = roleKey(j.company, j.title);
    if (key) {
      const trackerNum = index.tracker.get(key);
      if (trackerNum != null) return { verdict: 'repost', trackerNum };
      if (index.seen.has(key) || run.has(key)) return { verdict: 'repost' };
      run.add(key);
    }
    if (!titleOk(j.title).pass) return { verdict: 'title' };
    const l = locationOk(j.location);
    if (!l.pass) return { verdict: 'location', reason: l.reason };
    if (!includeBlacklisted && isBlacklisted(j.company)) return { verdict: 'blacklist' };
    if (looksContract(j.workTypes, j.salary)) return { verdict: 'contract' };
    if (salaryFloor) {
      const ceiling = parseSalaryCeiling(j.salary);
      if (ceiling !== null && ceiling < salaryFloor) return { verdict: 'salary' };
    }
    return { verdict: 'keep', related: index.employerRows(j.company) };
  };
}