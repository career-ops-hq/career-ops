#!/usr/bin/env node
/**
 * precheck-duplicate.mjs — "have I already applied here?", asked BEFORE a CV is written.
 *
 * READ-ONLY and ADVISORY: reads the applications tracker, never writes it, and
 * always exits 0 on a completed lookup (exit 1 only for a malformed command line).
 * merge-tracker.mjs matches when a row is WRITTEN; this runs earlier, so a
 * repost or a campus-level re-listing is caught before a second CV exists.
 *
 *   node precheck-duplicate.mjs --company "Acme Co" --title "Help Desk Analyst" \
 *        [--req JR-1234] [--url https://...] [--json]
 *
 * Candidates are ranked strongest first, reusing the repo's own matchers:
 *   1. url / req   exact normalizeUrl() match, or the same requisition ID
 *                  (REQ_NUMBER_RE via extractReqNumber) at the same or a parent
 *                  company. A bare req ID with an unrelated company never counts.
 *                  IDs are compared after normReq(), so JR9727 == JR-9727 == 9727.
 *   2. same-title  same normalized company and the same titleIdentityKey().
 *   Same-company tiers ignore one trailing parenthesised location/remote suffix
 *   on either title ("HR Generalist (Brampton, ON)" == "HR Generalist").
 *   3. parent-org / similar-title
 *                  same parent organisation (one name is a leading-token prefix
 *                  of the other, or differs only by a parenthesised unit) or the
 *                  same company, with a roleFuzzyMatch() title.
 * A Rejected row is surfaced with a warning flag, never as a block.
 *
 * The tracker comes from resolveTrackerPath(getCareerOpsRoot()), so
 * CAREER_OPS_TRACKER / CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR / .career-ops-data
 * are honoured exactly as in set-status.mjs.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveColumns, parseTrackerRow, extractReqNumber, normalizeTextKey } from './tracker-parse.mjs';
import {
  resolveTrackerPath, normalizeCompany, companiesMatchIgnoringCorporateForm,
  loadCanonicalStates, resolveCanonicalStateId,
} from './tracker-utils.mjs';
import { normalizeUrl } from './url-key.mjs';
import { titleIdentityKey } from './detect-reposts.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CANONICAL_STATES = loadCanonicalStates(join(dirname(fileURLToPath(import.meta.url)), 'templates', 'states.yml'));

/**
 * Requisition ID reduced to its identity, applied to BOTH the --req value and the
 * tracker note so the two sides compare equal however the site wrote the ID:
 * "REQ-2026-32061" == "REQ2026-32061" == "2026-32061", and "JR9727" == "JR-9727" == "9727". Only a
 * leading label (REQ / JR / R / JOB / POSTING / ID) is dropped, and only when an ID
 * with a digit follows it; the ID body is never altered. tracker-parse.mjs's
 * extractReqNumber() is deliberately left as is (merge-tracker, scan and
 * followup-cadence depend on it), so the normalization lives here.
 */
function normReq(v) {
  let s = String(v ?? '').trim().toUpperCase();
  const m = s.match(/^(?:REQ|JR|R|JOB|POSTING|ID)[-\s:#_]*(\S*\d\S*)$/);
  if (m) s = m[1];
  return s;
}

/** Trailing parenthesised level markers are part of the title, not a location. */
const LEVEL_SUFFIX_RE = /^(?:i{1,3}|iv|v|d+|sr.?|jr.?|senior|junior|lead|intern|co-?op|contract|temporary|part[- ]time|full[- ]time)$/i;

// How "location-like" is decided. There is no way to tell a city from a team name by
// shape alone ("(Toronto)" and "(Backend)" are both one capitalised word), so a
// parenthesised suffix is stripped ONLY when it is positively recognised:
//   - a work-mode word (remote, hybrid, on-site, in-office, work from home);
//   - a bare region name or code, country, or one of the major cities listed below;
//   - a comma/slash list of the above (every component is checked, see isLocationLike).
// Anything else ("(Backend)", "(Platform Team)", a town not in the list, "(Backend, TX)") is kept,
// so an unlisted bare city is simply not stripped: that can only cause a missed
// same-title match on a suffixed title (the pre-existing behaviour), never merge two
// distinct roles. What it cannot tell apart: a team or product name that happens to
// equal a listed city or region (e.g. "(Austin)" as a project name).
const REGION_CODES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC UK USA US CAN CA GB'.split(' '));
const REGION_NAMES = new Set(['alberta', 'british columbia', 'manitoba', 'new brunswick', 'newfoundland and labrador', 'nova scotia', 'ontario', 'prince edward island', 'quebec', 'saskatchewan', 'canada', 'united states', 'usa', 'united kingdom', 'uk', 'north america', 'emea', 'apac', 'gta', 'greater toronto area', 'california', 'texas', 'new york', 'florida', 'washington', 'illinois', 'massachusetts']);
const BARE_CITIES = new Set(['toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'edmonton', 'winnipeg', 'halifax', 'mississauga', 'brampton', 'markham', 'vaughan', 'hamilton', 'kitchener', 'waterloo', 'london', 'victoria', 'regina', 'saskatoon', 'quebec city', 'new york', 'chicago', 'austin', 'seattle', 'boston', 'san francisco', 'los angeles', 'denver', 'atlanta', 'dallas', 'houston', 'miami']);

const WORK_MODE_WORD_RE = /^(?:(?:fully |100% )?remote|hybrid|on[- ]?site|in[- ]office|work from home|wfh)$/;

// One component of a comma/slash separated label is recognised on its own.
function isKnownPlace(c) {
  return WORK_MODE_WORD_RE.test(c) || REGION_NAMES.has(c) || BARE_CITIES.has(c) || REGION_CODES.has(c.toUpperCase());
}

// EVERY component must be recognised (work-mode word, region code/name or listed city),
// so "(Remote Backend)", "(Hybrid, Platform Team)" and "(Backend, TX)" are never stripped
// just because one part looks like a location. There is deliberately NO free-form city
// allowance: "City, REGION" strips only when the city is in BARE_CITIES, so an unlisted
// small town such as "(Oakville, ON)" is simply not stripped (a missed same-title match,
// acceptable) rather than risking a false merge of "(Backend, TX)" and "(Frontend, TX)".
// Other trade-offs, stated plainly: a bare two-letter team or product code that equals a
// region code ("(ON)", "(CA)", "(ID)") is stripped as a location, and so is a team name
// that equals a listed city.
function isLocationLike(text) {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return false;
  const parts = t.split(/\s*[,/;]\s*/).filter(Boolean);
  return parts.length > 0 && parts.every(isKnownPlace);
}

/**
 * Title without one trailing parenthesised location/remote suffix:
 * "HR Generalist (Brampton, ON)" -> "HR Generalist". Only the LAST group at the
 * very end is removed, never when nothing would be left, never for a level marker
 * such as "(II)", and never for a qualifier that is not recognised as a location
 * (see isLocationLike): "Software Engineer (Backend)" is left alone.
 */
export function stripLocationSuffix(title) {
  const t = String(title ?? '').trim();
  const m = t.match(/^(.*\S)\s*\(([^()]*)\)$/);
  if (!m || LEVEL_SUFFIX_RE.test(m[2].trim()) || !isLocationLike(m[2])) return t;
  return m[1].trim();
}

// ADDING A FLAG: add it to BOTH lists below and to USAGE (validateFlags reads these).
const KNOWN_FLAGS = ['--company', '--title', '--req', '--url', '--json', '--help', '-h'];
const VALUE_FLAGS = ['--company', '--title', '--req', '--url'];

const USAGE = `Usage:
  node precheck-duplicate.mjs --company "Acme" --title "Role" [--req ID] [--url URL] [--json]

Read-only, advisory: lists tracker rows that could be the same opening
(url/req match, same company + title, same parent organisation). Never writes.`;

const TIER_RANK = { 'url': 1, 'req': 1, 'same-title': 2, 'parent-org': 3, 'similar-title': 3 };

/** Company name without parenthesised units: "Foo University (Campus)" -> "foo university". */
function baseTokens(name) {
  const stripped = String(name ?? '').replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  return normalizeTextKey(stripped, ' ').split(' ').filter(Boolean);
}

/** The bracketed unit text (round or square, as baseTokens strips both) of a company cell, normalized ("" when there is none). */
function unitKey(name) {
  const units = String(name ?? '').match(/\([^)]*\)|\[[^\]]*\]/g) || [];
  return normalizeTextKey(units.join(' '), ' ');
}

function isPrefix(shorter, longer) {
  return shorter.length > 0 && shorter.length <= longer.length && shorter.every((t, i) => t === longer[i]);
}

/**
 * Relation between two company cells.
 * @returns {'same'|'parent'|null} 'same' = identical normalized name (or only a
 *   corporate-form difference); 'parent' = shared parent organisation.
 */
export function companyRelation(a, b) {
  const ka = normalizeCompany(a);
  const kb = normalizeCompany(b);
  if (!ka || !kb) return null;
  const ta = baseTokens(a);
  const tb = baseTokens(b);
  // Same base name but different parenthesised units ("Fabrikam University (East)"
  // vs "(West)") are siblings under one parent, not the same employer unit.
  if (ta.length >= 2 && ta.join(' ') === tb.join(' ') && unitKey(a) !== unitKey(b)) return 'parent';
  if (ka === kb || companiesMatchIgnoringCorporateForm(a, b)) return 'same';
  // Two leading tokens minimum: "University of ..." counts, a lone "Acme" does not
  // fold "Acme Robotics" into "Acme Foods".
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shorter.length >= 2 && isPrefix(shorter, longer)) return shorter.length === longer.length ? 'same' : 'parent';
  return null;
}

/**
 * Rank tracker rows that could be the same opening as the candidate posting.
 * Pure: takes parsed rows, returns candidates.
 */
export function findDuplicateCandidates(rows, { company = '', title = '', req = '', url = '' } = {}) {
  const wantUrl = normalizeUrl(url);
  const wantReq = normReq(req);
  const cleanTitle = stripLocationSuffix(title);
  const wantTitleKey = cleanTitle ? titleIdentityKey(cleanTitle) : '';
  const out = [];
  for (const row of rows) {
    const rel = companyRelation(company, row.company);
    let reason = null;
    if (wantUrl && normalizeUrl(row.url) === wantUrl) {
      reason = 'url';
    } else if (wantReq && rel && normReq(extractReqNumber(row.notes)) === wantReq) {
      reason = 'req';
    } else if (rel === 'same' && wantTitleKey && titleIdentityKey(stripLocationSuffix(row.role)) === wantTitleKey) {
      reason = 'same-title';
    } else if (rel === 'parent' && title && roleFuzzyMatch(title, row.role)) {
      reason = 'parent-org';
    } else if (rel === 'same' && cleanTitle && roleFuzzyMatch(cleanTitle, stripLocationSuffix(row.role))) {
      reason = 'similar-title';
    }
    if (!reason) continue;
    const detail = {
      url: 'same posting URL', req: `same requisition ${wantReq}`,
      'same-title': 'same company, same title', 'parent-org': 'same parent organisation, similar title',
      'similar-title': 'same company, similar title',
    }[reason];
    out.push({
      num: row.num, company: row.company, role: row.role, status: row.status, date: row.date,
      reason, detail, tier: TIER_RANK[reason], warning: resolveCanonicalStateId(row.status, CANONICAL_STATES) === 'rejected',
    });
  }
  return out.sort((x, y) => x.tier - y.tier || String(y.date).localeCompare(String(x.date)) || y.num - x.num);
}

export function loadTrackerRows(trackerPath) {
  if (!existsSync(trackerPath)) return null;
  const lines = readFileSync(trackerPath, 'utf-8').split('\n');
  const colmap = resolveColumns(lines);
  return lines.map(l => parseTrackerRow(l, colmap)).filter(Boolean);
}

function formatLine(c) {
  return `${c.warning ? 'WARN ' : ''}#${c.num} | ${c.company} | ${c.role} | ${c.status} | ${c.date} | ${c.detail}`;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  const input = {
    company: flagValue(args, '--company') || '',
    title: flagValue(args, '--title') || '',
    req: flagValue(args, '--req') || '',
    url: flagValue(args, '--url') || '',
  };
  const json = args.includes('--json');
  if (!input.company && !input.url) {
    console.error('precheck-duplicate: --company (or --url) is required.\n' + USAGE);
    process.exit(1);
  }
  // A lookup needs at least one usable key, otherwise "no match" would be a
  // false all-clear: a URL that normalizes to nothing ("N/A"), or a company alone.
  if (input.url && !normalizeUrl(input.url)) {
    console.error(`precheck-duplicate: --url "${input.url}" is not a usable URL.\n` + USAGE);
    process.exit(1);
  }
  if (!input.title.trim() && !input.req.trim() && !input.url) {
    console.error('precheck-duplicate: give at least one of --title, --req or --url besides --company.\n' + USAGE);
    process.exit(1);
  }
  const trackerPath = resolveTrackerPath(getCareerOpsRoot());
  const rows = loadTrackerRows(trackerPath);
  const candidates = rows ? findDuplicateCandidates(rows, input) : [];
  if (json) {
    console.log(JSON.stringify({ tracker: rows ? trackerPath : null, checked: input, candidates }, null, 2));
  } else if (!rows) {
    console.log('No tracker found — nothing to compare against.');
  } else if (candidates.length === 0) {
    console.log('No possible duplicate in the tracker.');
  } else {
    console.log('Possible duplicate(s) in the tracker (advisory, nothing written):');
    for (const c of candidates) console.log(formatLine(c));
  }
  process.exit(0);
}
