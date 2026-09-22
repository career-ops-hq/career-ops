#!/usr/bin/env node
/**
 * linkedin-join.mjs — Warm-intro finder: LinkedIn connections ⋈ job-search targets
 *
 * Joins a LinkedIn `Connections.csv` export (Settings → Data Privacy → Get a
 * copy of your data → Connections) against the two company lists the pipeline
 * already maintains:
 *
 *   - data/applications.md  → companies you have evaluated or applied to
 *   - portals.yml           → companies the scanner sweeps (tracked_companies)
 *
 * and reports only the intersection: the people you already know at a company
 * that is live in your funnel. Zero LLM cost, zero network.
 *
 * SCOPE (deliberate, see AGENTS.md "Source-of-Truth Boundary"): this is an
 * OPERATIONAL lookup — it changes who you contact and through which channel.
 * It is NOT an evaluation input (a connection does not make a role a better
 * fit; Blocks A-F own the score) and it is NOT a content source (nothing here
 * may produce a claim in a CV, cover letter, or form answer). The raw export
 * is third-party PII: it lives under data/ (user layer, outside this repo via
 * the data symlink) and only the handful of rows you promote by hand ever
 * reach data/contacts.tsv.
 *
 * MATCHING. LinkedIn company names are free text, so exact string equality
 * misses most real hits ("Siemens" vs "Siemens Digital Industries Software").
 * Names are tokenized, case/diacritic-folded, and split into all-tokens and
 * DISTINCTIVE tokens (generic industry/legal words removed), then tiered:
 *
 *   exact   full folded key equal          "GE HealthCare"  ~ "GE Healthcare"
 *   strong  distinctive token sets EQUAL,   "Siemens"        ~ "Siemens Digital
 *           only generic filler differs                        Industries Software"
 *   weak    distinctive tokens overlap      "Epic Systems"   ~ "Epic Games"
 *           but the sets are not equal
 *
 * Strong deliberately requires set EQUALITY, not containment: "Epic" ⊆ "Epic
 * Games" and "Blue" ⊆ "Blue Cloud Ventures" read as matches but name different
 * companies than Epic Systems and Optimal Blue. An extra distinctive token on
 * either side changes the entity; only generic filler may differ.
 *
 * Dropping generic tokens is what stops "Monogram Health" ~ "Advocate Health"
 * and substring matching is deliberately NOT used, so "Loop" never matches
 * "Loopio". A match whose only shared tokens are under 3 characters is demoted
 * to weak ("GE" ~ "GE Inc"). exact+strong show by default; weak needs
 * --include-weak. Every match prints both raw names — you are the last filter.
 *
 * SECOND DEGREE. The export carries first-degree contacts only; second-degree
 * edges live inside the platform UI and are not exportable. Every target
 * therefore also carries a prefilled people-search URL that career-ops builds
 * and never fetches, so the user opens it themselves in their own browser.
 *
 * Run: node linkedin-join.mjs                  (JSON: targets + quality + totals)
 *      node linkedin-join.mjs --company Acme --summary
 *                                              ("do I know anyone here?", one company;
 *                                               says so explicitly when the answer is no)
 *      node linkedin-join.mjs --summary        (human-readable, grouped by company)
 *      node linkedin-join.mjs --summary --include-weak
 *      node linkedin-join.mjs --tracker-only   (only companies in applications.md)
 *      node linkedin-join.mjs --portals-only   (only scanner targets, no application yet)
 *      node linkedin-join.mjs --since 2020     (connections made in/after 2020)
 *      node linkedin-join.mjs --tsv            (contacts.tsv-shaped rows on stdout)
 *      node linkedin-join.mjs --csv <path>     (override the export location)
 *      node linkedin-join.mjs --self-test
 *      node linkedin-join.mjs --help
 *
 * Argv goes through lib/cli-flags.mjs, so every flag accepts both `--flag value`
 * and `--flag=value`, an unrecognized flag exits 1 rather than falling through to
 * default behaviour, and a value flag with no operand is a usage error.
 *
 * --tsv PRINTS, never appends: review the rows, then paste the keepers into
 * data/contacts.tsv so contacts.mjs and `contacto` pick them up.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { resolveColumns, parseTrackerRow, normalizeTextKey } from './tracker-parse.mjs';
import { asciiFold } from './lib/ascii-fold.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
const DEFAULT_CSV = join(DATA_ROOT, 'data/Connections.csv');
const TRACKER_PATH = join(DATA_ROOT, 'data/applications.md');
const PORTALS_PATH = join(DATA_ROOT, 'portals.yml');
const CONTACTS_PATH = join(DATA_ROOT, 'data/contacts.tsv');

const args = process.argv.slice(2);

// lib/cli-flags.mjs rather than a local indexOf() lookup. A hand-rolled parser
// cannot see `--flag=value`, so `--csv=/other.csv` silently discarded the path
// and the tool read data/Connections.csv instead, printing a plausible report
// about a file nobody asked for. Same defect class as #2401/#2402.
const VALUE_FLAGS = ['--since', '--csv', '--company'];
const KNOWN_FLAGS = [
  '--summary', '--tsv', '--self-test', '--include-weak',
  '--tracker-only', '--portals-only', ...VALUE_FLAGS, '--help', '-h',
];

const USAGE = `Usage: node linkedin-join.mjs [options]

Joins a LinkedIn Connections.csv export against tracker + portals.yml companies
to answer "do I know anyone here?". Offline, read-only, zero token cost.

  --company <name>   Answer for ONE company; says so explicitly when nobody matches
  --summary          Human-readable output grouped by company (default: JSON)
  --tsv              contacts.tsv-shaped rows on stdout (never appends)
  --tracker-only     Only companies in data/applications.md
  --portals-only     Only portals.yml scanner targets
  --include-weak     Include weak name matches (noisier)
  --since <YYYY>     Only connections made in/after this 4-digit year
  --csv <path>       Override the export location
  --self-test        Run the inline checks
  --help, -h         Show this message`;

const summaryMode = hasFlag(args, '--summary');
const tsvMode = hasFlag(args, '--tsv');
const selfTestMode = hasFlag(args, '--self-test');
const includeWeak = hasFlag(args, '--include-weak');
const trackerOnly = hasFlag(args, '--tracker-only');
const portalsOnly = hasFlag(args, '--portals-only');
const sinceRaw = flagValue(args, '--since') ?? null;
// parseInt('2020x') is 2020 and parseInt('abc') is NaN, which the truthiness
// check below would read as "no filter" — a silently ignored flag is worse than
// an error, because the output looks like a filtered result.
const sinceYear = sinceRaw === null ? null : (/^\d{4}$/.test(sinceRaw) ? Number(sinceRaw) : NaN);
const csvPath = flagValue(args, '--csv') || DEFAULT_CSV;
const companyQuery = flagValue(args, '--company') ?? null;

// --- Company name normalization -------------------------------------------

/**
 * Tokens carrying no identifying signal: legal suffixes, corporate filler, and
 * the industry words that dominate this pipeline's verticals. Removing them is
 * what makes subset matching safe — two health companies must not match on
 * "health" alone. Placeholder markers (stealth, undisclosed, …) are included so
 * anonymized tracker rows reduce to zero distinctive tokens and drop out as
 * targets entirely rather than matching arbitrary connections.
 */
const GENERIC = new Set([
  // articles / conjunctions
  'the', 'a', 'an', 'and', 'of', 'for',
  // legal forms
  'inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'mbh', 'ag', 'kg', 'sa', 'sas', 'sarl', 'bv', 'nv',
  'ab', 'oy', 'as', 'aps', 'plc', 'pty', 'srl', 'spa', 'kk', 'pte', 'pvt',
  // corporate filler
  'holdings', 'holding', 'group', 'groupe', 'international', 'global',
  'worldwide', 'enterprises', 'enterprise', 'ventures', 'capital', 'partners',
  'associates', 'consulting', 'consultancy', 'industries', 'industrial',
  // sector words common enough to be noise in this funnel
  'technologies', 'technology', 'tech', 'software', 'systems', 'system',
  'solutions', 'solution', 'services', 'service', 'labs', 'lab', 'digital',
  'data', 'cloud', 'ai', 'health', 'healthcare', 'medical', 'media', 'network',
  'networks', 'platform', 'platforms', 'security', 'cybersecurity', 'cyber',
  'financial', 'finance', 'insurance', 'energy', 'studio', 'studios',
  // anonymized-posting placeholders
  'stealth', 'startup', 'unknown', 'confidential', 'undisclosed', 'anon',
  'anonymous', 'client', 'various',
]);

/**
 * Fold a single token to a comparison key.
 *
 * Delegates to lib/ascii-fold.mjs — the tree's canonical name-folding rule —
 * rather than hand-rolling one. A naive NFKD-plus-strip-marks fold silently
 * misses NON-DECOMPOSING Latin, where the stroke or bar is part of the glyph
 * and no combining mark exists to remove: `Ørsted` never matched `Orsted`,
 * `Işık` never matched `Isik`, `Straße` never matched `Strasse`. asciiFold
 * carries the vetted mapping for those (ø→o, æ→ae, ß→ss, ı→i, ŋ→ng, …).
 *
 * `punctuation: 'delete'` because this runs per-token, AFTER companyTokens has
 * already split on punctuation — the word-splitting asciiFold's default 'space'
 * mode provides has happened by then, and re-splitting here would silently
 * produce two tokens where the caller counted one.
 *
 * FALLBACK. asciiFold returns '' for text with no Latin content (CJK, Cyrillic,
 * Greek) — the right answer when the comparison target is an ASCII hostname or
 * ATS slug, but wrong here: both sides of this join are free text, so 株式会社X
 * must still match 株式会社X. When the ASCII fold empties a non-empty token, fall
 * back to normalizeTextKey, which preserves script (and with it the Devanagari
 * क/का distinction that tracker-parse.mjs exists to protect).
 */
export function foldToken(token) {
  const raw = String(token);
  const folded = asciiFold(raw, { punctuation: 'delete' });
  if (folded) return folded;
  return normalizeTextKey(raw);
}

/**
 * Split a company name into folded tokens.
 *
 * Parentheticals are dropped: tracker rows carry agency or disambiguation
 * context inline ("FORT (client undisclosed)", "Anon Cybersecurity Co.
 * (Harnham)") and that text is not part of the employer's name. The bracketed
 * content is returned separately so callers can index it as its own target —
 * knowing someone at the agency is a warm intro too.
 *
 * @param {string} name
 * @returns {{all: string[], distinctive: string[], key: string, parenthetical: string|null}}
 */
export function companyTokens(name) {
  const raw = String(name || '');
  const parens = [...raw.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim()).filter(Boolean);
  const base = raw.replace(/\([^)]*\)/g, ' ');
  const all = base
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .map(foldToken)
    .filter(Boolean);
  return {
    all,
    distinctive: all.filter(t => !GENERIC.has(t)),
    // Concatenated deliberately, NOT space-joined. LinkedIn employer strings
    // vary in spacing far more than they vary in words: "GoDaddy"/"Go Daddy",
    // "PayPal"/"Pay Pal", "Salesforce"/"Sales Force", "ServiceNow"/"Service
    // Now" are all the same employer typed two ways, and only a separator-free
    // key matches them. The cost is that "A B" and "AB" collide; the benefit is
    // five real variants per the tests below, and a contrived collision still
    // has to survive a human reading both raw names in the output.
    key: all.join(''),
    parenthetical: parens.length ? parens.join(' ') : null,
  };
}

/**
 * Compare two tokenized company names.
 *
 * @returns {'exact'|'strong'|'weak'|null} null when the names are unrelated.
 */
export function matchCompany(a, b) {
  if (!a.key || !b.key) return null;
  if (a.key === b.key) return 'exact';

  const da = new Set(a.distinctive);
  const db = new Set(b.distinctive);
  // A name made entirely of generic words ("Stealth Startup") has no identity
  // to match on — only full-key equality above can pair it.
  if (!da.size || !db.size) return null;

  const shared = [...da].filter(t => db.has(t));
  if (!shared.length) return null;

  // Strong requires the distinctive sets to be EQUAL, not merely nested. Mere
  // containment reads as a match but is not: "Epic" ⊆ "Epic Games" and "Blue" ⊆
  // "Blue Cloud Ventures" are different companies from Epic Systems and Optimal
  // Blue. An extra distinctive token on either side changes the entity; only
  // generic filler may differ, which is exactly what "Siemens" ~ "Siemens
  // Digital Industries Software" and "Akamai" ~ "Akamai Technologies" do.
  const identical = da.size === db.size && shared.length === da.size;
  // Two-letter overlaps are coincidence as often as signal ("GE" ~ "GE Inc").
  const substantive = shared.some(t => t.length >= 3);
  if (identical && substantive) return 'strong';
  return 'weak';
}

// --- CSV parsing (RFC 4180) -----------------------------------------------

/**
 * Parse CSV text into rows of raw cells. Handles quoted fields, doubled quotes
 * as escapes, and newlines inside quotes — LinkedIn quotes any Position or
 * Company containing a comma ("Director, Strategic Accounts").
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      if (c === '\r' && s[i + 1] === '\n') { field += '\n'; i += 2; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Locate the real header row.
 *
 * The export opens with a free-text "Notes:" preamble whose length LinkedIn has
 * changed before, so the header is found by content rather than a fixed offset.
 */
export function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].map(c => c.trim().toLowerCase());
    if (lower.includes('first name') && lower.includes('company')) return i;
  }
  return -1;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** True when an ISO yyyy-mm-dd names a day that actually exists. */
function isRealDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Parse LinkedIn's "03 Aug 2026" (or an ISO date) into `{iso, year, raw}`. */
export function parseConnectedOn(value) {
  const s = String(value || '').trim();
  if (!s) return { iso: null, year: null, raw: '' };

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isRealDate(s) ? { iso: s, year: Number(m[1]), raw: s } : { iso: null, year: null, raw: s };

  m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month) {
      const iso = `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
      // Regex shape is not calendar validity: "31 Feb" and "29 Feb 2026" (not a
      // leap year) both match the pattern. Round-trip through Date so an
      // impossible day is reported unparsed rather than becoming a real-looking
      // ISO string that later date math silently accepts.
      if (isRealDate(iso)) return { iso, year: Number(m[3]), raw: s };
    }
  }
  return { iso: null, year: null, raw: s };
}

/**
 * Turn raw CSV rows into connection objects, mapping cells by HEADER NAME so a
 * column reorder upstream cannot silently shift every field.
 *
 * @returns {{connections: object[], quality: object}}
 */
export function parseConnections(text) {
  const quality = { noHeader: false, noCompany: 0, noName: 0, unparsedDates: 0 };
  const rows = parseCsv(text);
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    quality.noHeader = true;
    return { connections: [], quality };
  }

  const header = rows[headerIdx].map(c => c.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const idx = {
    first: col('first name'),
    last: col('last name'),
    url: col('url'),
    email: col('email address'),
    company: col('company'),
    position: col('position'),
    connected: col('connected on'),
  };

  const connections = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells.length || cells.every(c => !c.trim())) continue;
    const get = (k) => (idx[k] !== -1 && cells[idx[k]] != null ? String(cells[idx[k]]).trim() : '');

    const name = [get('first'), get('last')].filter(Boolean).join(' ');
    const company = get('company');
    if (!name) { quality.noName++; continue; }
    // No employer means nothing to join on — counted, not dropped silently.
    if (!company) { quality.noCompany++; continue; }

    const connected = parseConnectedOn(get('connected'));
    if (connected.raw && !connected.iso) quality.unparsedDates++;

    connections.push({
      name,
      company,
      title: get('position'),
      linkedin: get('url'),
      email: get('email'),
      connectedOn: connected.iso,
      connectedYear: connected.year,
      tokens: companyTokens(company),
    });
  }
  return { connections, quality };
}

// --- Target lists ----------------------------------------------------------

/**
 * Companies from the tracker, one target per row (plus one for any inline
 * parenthetical, which is typically the agency).
 */
export function parseTrackerTargets(content) {
  const lines = String(content || '').split('\n');
  const colmap = resolveColumns(lines);
  const targets = [];
  const skipped = [];

  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row || !row.company) continue;

    const tokens = companyTokens(row.company);
    const meta = { num: row.num, role: row.role, status: row.status, score: row.score };
    // A row with no distinctive tokens is an anonymized posting ("?", "Stealth
    // Startup", "Unknown Co."). Matching it against a connection whose employer
    // happens to be typed the same way pairs two unrelated companies, so it is
    // dropped as a target rather than left to full-key equality.
    if (tokens.distinctive.length) {
      targets.push({ company: row.company, source: 'tracker', tokens, tracker: meta });
    } else {
      skipped.push({ company: row.company, reason: 'placeholder / no identifying tokens' });
    }
    if (tokens.parenthetical) {
      const alias = companyTokens(tokens.parenthetical);
      if (alias.key && alias.distinctive.length) {
        targets.push({
          company: tokens.parenthetical,
          source: 'tracker',
          tokens: alias,
          tracker: { ...meta, viaAlias: true },
        });
      }
    }
  }
  return { targets, skipped };
}

/** Enabled companies from portals.yml `tracked_companies`. */
export function parsePortalTargets(content) {
  let doc;
  try {
    doc = yaml.load(String(content || ''));
  } catch {
    return { targets: [], skipped: [{ company: '(portals.yml)', reason: 'YAML parse error' }] };
  }
  const list = Array.isArray(doc?.tracked_companies) ? doc.tracked_companies : [];
  const targets = [];
  const skipped = [];
  for (const entry of list) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (!name) continue;
    if (typeof entry === 'object' && entry.enabled === false) continue;
    const tokens = companyTokens(name);
    if (!tokens.distinctive.length) {
      skipped.push({ company: name, reason: 'placeholder / no identifying tokens' });
      continue;
    }
    targets.push({ company: name, source: 'portals', tokens, tracker: null });
  }
  return { targets, skipped };
}

/**
 * Name+company keys already present in the phonebook, so the report can mark
 * connections you have already promoted instead of re-suggesting them.
 */
export function parseKnownContacts(content) {
  const known = new Set();
  for (const raw of String(content || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const cells = line.split('\t').map(c => c.trim());
    if (cells.length < 2 || !cells[0] || !cells[1]) continue;
    known.add(`${normalizeTextKey(cells[0])}::${normalizeTextKey(cells[1])}`);
  }
  return known;
}

/**
 * Prefilled second-degree people-search URL for a company.
 *
 * The connections export carries first-degree contacts only. Second-degree
 * edges exist solely inside the platform UI and are not exportable, so the
 * honest answer is a link the USER opens in their own browser. career-ops
 * constructs the string and never fetches it, which keeps the feature clear of
 * any automated-access prohibition (#2679 acceptance criterion 3).
 *
 * @param {string} company - Target company display name.
 * @returns {string} linkedin.com people search, filtered to 2nd-degree.
 */
export function secondDegreeSearchUrl(company) {
  const q = encodeURIComponent(String(company || '').trim());
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&network=%5B%22S%22%5D`;
}

// --- Join ------------------------------------------------------------------

const TIER_RANK = { exact: 0, strong: 1, weak: 2 };

/**
 * Join connections against targets.
 *
 * Targets are deduped by folded key, preferring tracker rows over portals
 * entries so a company you have actually applied to keeps its tracker context.
 *
 * @returns {{targets: object[], matchedConnections: number}}
 */
export function joinConnections(connections, targetList, { known = new Set(), includeWeak = false } = {}) {
  // Deduplicate on MATCH EQUIVALENCE, not on identical keys. A tracker row
  // "Akamai" and a portals entry "Akamai Technologies" are the same employer
  // (a strong match — only generic filler differs) but have different keys, so
  // keying alone leaves both. Every connection then matches both and is
  // reported twice, with the portals copy captioned "no application yet" about
  // a company the user has already applied to. Tracker targets are placed
  // first so the surviving copy is the one carrying tracker context.
  const merged = [];
  const ordered = [...targetList].sort((a, b) =>
    (a.source === 'tracker' ? 0 : 1) - (b.source === 'tracker' ? 0 : 1));
  for (const t of ordered) {
    const twin = merged.find(m => {
      const tier = matchCompany(m.tokens, t.tokens);
      return tier === 'exact' || tier === 'strong';
    });
    // A weak twin is NOT merged: weak means the names may well be different
    // companies, and collapsing them would invent an equivalence the matcher
    // itself declines to assert.
    if (!twin) merged.push({ ...t, connections: [] });
  }
  const byKey = new Map(merged.map(t => [t.tokens.key, t]));

  const matched = new Set();
  for (const conn of connections) {
    for (const target of byKey.values()) {
      const tier = matchCompany(conn.tokens, target.tokens);
      if (!tier) continue;
      if (tier === 'weak' && !includeWeak) continue;
      target.connections.push({
        name: conn.name,
        title: conn.title,
        linkedinCompany: conn.company,
        linkedin: conn.linkedin,
        email: conn.email || null,
        connectedOn: conn.connectedOn,
        connectedYear: conn.connectedYear,
        match: tier,
        alreadyInPhonebook: known.has(`${normalizeTextKey(conn.name)}::${normalizeTextKey(target.company)}`),
      });
      matched.add(conn);
    }
  }

  const targets = [...byKey.values()]
    .filter(t => t.connections.length)
    .map(t => ({
      company: t.company,
      source: t.source,
      tracker: t.tracker,
      secondDegreeSearch: secondDegreeSearchUrl(t.company),
      // Best match first, then most recent connection — recency is the closest
      // thing the export carries to relationship strength.
      connections: t.connections.sort((a, b) =>
        TIER_RANK[a.match] - TIER_RANK[b.match] ||
        String(b.connectedOn || '').localeCompare(String(a.connectedOn || '')) ||
        a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === 'tracker' ? -1 : 1;
      if (a.source === 'tracker') {
        const an = Number(a.tracker?.num) || 0;
        const bn = Number(b.tracker?.num) || 0;
        if (an !== bn) return an - bn;
      }
      return a.company.localeCompare(b.company);
    });

  // targetCount is merged.length, NOT the caller's raw list length: dedup
  // collapses strong-equivalent targets, so counting the input would report two
  // target companies for the single Akamai / Akamai Technologies target the
  // output actually contains.
  return { targets, matchedConnections: matched.size, targetCount: merged.length };
}

// --- Output ----------------------------------------------------------------

function renderSummary(result) {
  const { targets, totals, quality } = result;
  const out = [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  out.push('LinkedIn warm-intro join');
  out.push(`  ${plural(totals.connections, 'connection', 'connections')} · ` +
           `${plural(totals.targets, 'target company', 'target companies')} · ` +
           `${plural(totals.matchedCompanies, 'company', 'companies')} with a connection · ` +
           `${plural(totals.matchedConnections, 'person', 'people')}`);
  out.push('');

  if (!targets.length) {
    out.push('  No overlap found.' + (includeWeak ? '' : ' Try --include-weak for looser name matches.'));
    return out.join('\n');
  }

  let section = null;
  for (const t of targets) {
    if (t.source !== section) {
      section = t.source;
      out.push(section === 'tracker'
        ? '── In your tracker ' + '─'.repeat(40)
        : '── Scanner targets (no application yet) ' + '─'.repeat(21));
      out.push('');
    }

    const head = t.source === 'tracker' && t.tracker
      ? `${t.company}  [#${t.tracker.num} ${t.tracker.status || '?'}${t.tracker.role ? ` · ${t.tracker.role}` : ''}]`
      : t.company;
    out.push(`  ${head}`);

    for (const c of t.connections) {
      const bits = [];
      if (c.title) bits.push(c.title);
      if (c.connectedOn) bits.push(`since ${c.connectedOn.slice(0, 7)}`);
      if (c.match !== 'exact') bits.push(`${c.match} match: "${c.linkedinCompany}"`);
      if (c.alreadyInPhonebook) bits.push('already in contacts.tsv');
      out.push(`    · ${c.name}${bits.length ? ` — ${bits.join(' — ')}` : ''}`);
      if (c.linkedin) out.push(`        ${c.linkedin}`);
    }
    out.push(`    2nd-degree: ${t.secondDegreeSearch}`);
    out.push('');
  }

  const notes = [];
  if (quality.noHeader) notes.push('CSV header row not found — is this a LinkedIn Connections export?');
  if (quality.noCompany) notes.push(`${quality.noCompany} connections have no employer listed (cannot join)`);
  if (quality.unparsedDates) notes.push(`${quality.unparsedDates} unparseable "Connected On" dates`);
  if (quality.skippedTargets.length) notes.push(`${quality.skippedTargets.length} target rows skipped (placeholder names)`);
  if (notes.length) {
    out.push('Notes:');
    for (const n of notes) out.push(`  ! ${n}`);
    out.push('');
  }
  out.push('Review before acting: a 1st-degree connection is not automatically a warm intro.');
  return out.join('\n');
}

/** contacts.tsv-shaped rows — printed for review, never appended automatically. */
function renderTsv(result) {
  const out = ['# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker#\tnotes'];
  for (const t of result.targets) {
    for (const c of t.connections) {
      if (c.alreadyInPhonebook) continue;
      const note = [
        `LinkedIn 1st-degree${c.connectedOn ? `, connected ${c.connectedOn}` : ''}.`,
        c.match === 'exact' ? '' : `Name match ${c.match}: "${c.linkedinCompany}".`,
        'Verify current employer before outreach.',
      ].filter(Boolean).join(' ');
      // Cells carry connection-controlled text (name, title, employer). A cell
      // starting =, +, - or @ executes as a formula when the reviewed TSV is
      // opened in a spreadsheet, so prefix it with an apostrophe. Applied AFTER
      // trimming, or leading whitespace would hide the leading character.
      const clean = (v) => {
        const value = String(v || '').replace(/[\t\r\n]+/g, ' ').trim();
        return /^[=+\-@]/.test(value) ? `'${value}` : value;
      };
      out.push([
        clean(c.name), clean(t.company), 'peer', clean(c.title), '',
        clean(c.email), clean(c.linkedin),
        t.tracker?.num ? String(t.tracker.num) : '-', clean(note),
      ].join('\t'));
    }
  }
  return out.join('\n');
}

/**
 * Single-company answer to "do I know anyone here?" (#2679).
 *
 * Distinct from renderSummary because the interesting case is the EMPTY one: a
 * company with no connections must say so in words. The bulk report filters
 * zero-match targets out, which is right for a digest and wrong for a direct
 * question — a blank reads as "not checked" rather than "checked, nobody".
 */
function renderCompanyAnswer(result, query) {
  const target = result.targets[0];
  const out = [`Do you know anyone at "${query}"?`, ''];

  if (!target || !target.connections.length) {
    out.push('  No. No first-degree connection in your export lists this company.');
    if (!includeWeak) out.push('  (Strict name matching. Try --include-weak for looser variants.)');
  } else {
    const n = target.connections.length;
    out.push(`  Yes — ${n} ${n === 1 ? 'connection' : 'connections'}:`);
    out.push('');
    for (const c of target.connections) {
      const bits = [];
      if (c.title) bits.push(c.title);
      if (c.connectedOn) bits.push(`since ${c.connectedOn.slice(0, 7)}`);
      if (c.match !== 'exact') bits.push(`${c.match} match: "${c.linkedinCompany}"`);
      if (c.alreadyInPhonebook) bits.push('already in contacts.tsv');
      out.push(`    · ${c.name}${bits.length ? ` — ${bits.join(' — ')}` : ''}`);
      if (c.linkedin) out.push(`        ${c.linkedin}`);
    }
  }

  out.push('');
  out.push('  Second-degree (not in any export — open it yourself, nothing is fetched):');
  out.push(`    ${secondDegreeSearchUrl(query)}`);
  return out.join('\n');
}

// --- Self-test -------------------------------------------------------------

function selfTest() {
  let passed = 0;
  const failures = [];
  const check = (name, cond) => { if (cond) passed++; else failures.push(name); };
  const tier = (a, b) => matchCompany(companyTokens(a), companyTokens(b));

  check('case-insensitive exact', tier('GE HealthCare', 'GE Healthcare') === 'exact');
  check('diacritics fold', tier('Estée Lauder', 'Estee Lauder') === 'exact');
  check('ampersand splits', tier('Crum & Forster', 'Crum Forster') === 'exact');
  check('conjunction is generic', tier('Crum & Forster', 'Crum and Forster') === 'strong');
  check('legal suffix ignored', tier('EXL', 'EXL Service Holdings, Inc.') === 'strong');
  check('subset match', tier('Siemens', 'Siemens Digital Industries Software') === 'strong');
  check('leading article', tier('New York Times', 'The New York Times') === 'strong');
  check('generic token alone does not match', tier('Monogram Health', 'Advocate Health') === null);
  check('no substring matching', tier('Loop', 'Loopio') === null);
  check('unrelated names', tier('Datavant', 'Snyk') === null);
  check('all-generic name is inert', tier('Stealth Startup', 'Acme Startup') === null);
  check('short shared token demoted', tier('GE', 'GE Inc') === 'weak');
  // Nesting is not identity: the extra distinctive token names another company.
  check('extra distinctive token demotes', tier('Epic Systems', 'Epic Games') === 'weak');
  check('nested name demotes', tier('Optimal Blue', 'Blue Cloud Ventures') === 'weak');
  check('extra token demotes', tier('Red Cell Partners', 'Red Rock Cell Co') === 'weak');
  // Neither side contains the other: one shared token, one unique each.
  check('partial overlap is weak', tier('Kixie Nimbus', 'Nimbus Chainguard') === 'weak');
  check('CJK preserved', companyTokens('株式会社テスト').key.length > 0);
  check('Cyrillic preserved', companyTokens('Яндекс').key.length > 0);
  check('CJK still matches itself', tier('株式会社テスト', '株式会社テスト') === 'exact');
  // Non-decomposing Latin: no combining mark to strip, so an NFKD-only fold
  // drops the letter entirely and the pair never matches (lib/ascii-fold.mjs).
  check('slashed O folds', tier('Ørsted', 'Orsted') === 'exact');
  check('dotless i folds', tier('Işık Holding', 'Isik Holding') === 'exact');
  check('eszett folds', tier('Straße GmbH', 'Strasse GmbH') === 'exact');
  check('ligature folds', tier('Æther Labs', 'Aether Labs') === 'exact');
  check('slashed l folds', tier('Łukasiewicz', 'Lukasiewicz') === 'exact');
  check('decomposing diacritics still fold', tier('Société Générale', 'Societe Generale') === 'exact');

  const csv = parseCsv('a,"b,c",d\n"line\nbreak","say ""hi""",z\n');
  check('csv quoted comma', csv[0][1] === 'b,c');
  check('csv embedded newline', csv[1][0] === 'line\nbreak');
  check('csv escaped quotes', csv[1][1] === 'say "hi"');

  const export_ = [
    'Notes:', '"preamble text"', '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Jane,Doe,https://linkedin.com/in/janedoe,,Datavant,"Director, Platform",03 Aug 2026',
    'No,Employer,https://x,,,Consultant,01 Jan 2020',
  ].join('\n');
  const { connections, quality } = parseConnections(export_);
  check('preamble skipped', connections.length === 1);
  check('name joined', connections[0].name === 'Jane Doe');
  check('quoted position kept', connections[0].title === 'Director, Platform');
  check('date parsed', connections[0].connectedOn === '2026-08-03');
  check('missing employer counted', quality.noCompany === 1);

  check('header by content, not offset',
    findHeaderRow(parseCsv('x\ny\nz\nFirst Name,Company\nA,B\n')) === 3);

  const joined = joinConnections(connections, [
    { company: 'Datavant', source: 'tracker', tokens: companyTokens('Datavant'), tracker: { num: '23', status: 'Applied' } },
    { company: 'Datavant', source: 'portals', tokens: companyTokens('Datavant'), tracker: null },
  ]);
  check('targets deduped, tracker wins', joined.targets.length === 1 && joined.targets[0].source === 'tracker');
  check('connection attached once', joined.targets[0].connections.length === 1);

  const weakOnly = joinConnections(
    [{ ...connections[0], company: 'GE', tokens: companyTokens('GE') }],
    [{ company: 'GE Vernova', source: 'tracker', tokens: companyTokens('GE Vernova'), tracker: { num: '1' } }],
  );
  check('weak excluded by default', weakOnly.targets.length === 0);

  const known = parseKnownContacts('# header\nJane Doe\tDatavant\tpeer\n\n');
  check('phonebook key built', known.has('janedoe::datavant'));

  const url = secondDegreeSearchUrl('Acme & Co');
  check('2nd-degree url encodes the company', url.includes('keywords=Acme%20%26%20Co'));
  check('2nd-degree url filters to 2nd degree', url.includes('network=%5B%22S%22%5D'));
  check('2nd-degree url is linkedin people search',
    url.startsWith('https://www.linkedin.com/search/results/people/?'));

  const placeholders = parseTrackerTargets([
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-01-01 | Stealth Startup | CTO | 4.0/5 | Evaluated | ❌ | [1](reports/x.md) | - |',
    '| 2 | 2026-01-01 | ? | CTO | 4.0/5 | Evaluated | ❌ | [2](reports/y.md) | - |',
    '| 3 | 2026-01-01 | Datavant | CTO | 4.0/5 | Applied | ❌ | [3](reports/z.md) | - |',
  ].join('\n'));
  check('placeholder targets dropped',
    placeholders.targets.length === 1 && placeholders.targets[0].company === 'Datavant');
  check('placeholder drops reported', placeholders.skipped.length === 2);

  console.log(failures.length
    ? `FAIL ${failures.length}/${passed + failures.length}\n  ${failures.join('\n  ')}`
    : `PASS ${passed}/${passed} self-test checks`);
  return failures.length ? 1 : 0;
}

// --- Main ------------------------------------------------------------------

/**
 * Read a file, or null when it cannot be read for ANY reason.
 *
 * Deliberately not `existsSync` + `readFileSync`: existsSync answers true for a
 * directory, and the read then throws a raw EISDIR stack at the user. Missing
 * optional inputs, an unreadable data/ mount and a permission error are all the
 * same answer here — "no input from this source".
 */
function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function main() {
  // Inside main(), not at module scope: validateFlags exits the process, and a
  // test importing this module for its exports must never trigger that on the
  // test runner's argv. requireOperand catches `--csv --summary`, where the
  // operand is missing and the next token is another flag.
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  if (selfTestMode) return selfTest();

  if (trackerOnly && portalsOnly) {
    console.error('--tracker-only and --portals-only are mutually exclusive: '
      + 'together they exclude every target source. Pass neither to search both.');
    return 1;
  }

  if (Number.isNaN(sinceYear)) {
    console.error(`--since expects a 4-digit year, got "${sinceRaw}".`);
    return 1;
  }

  // existsSync is true for a directory, and readFileSync then throws EISDIR as
  // a raw node:fs stack. Every input goes through readOrNull so a bad path,
  // permission error or missing data/ dir is a CLI message, not a crash.
  const csvText = readOrNull(csvPath);
  if (csvText === null) {
    console.error(`Connections export not readable: ${csvPath}\n` +
      'Export it from LinkedIn (Settings → Data Privacy → Get a copy of your data → Connections),\n' +
      'drop Connections.csv in data/, or pass --csv <path> pointing at the file.');
    return 1;
  }

  const { connections, quality } = parseConnections(csvText);

  const skippedTargets = [];
  let targetList = [];
  const trackerText = portalsOnly ? null : readOrNull(TRACKER_PATH);
  if (trackerText !== null) {
    const t = parseTrackerTargets(trackerText);
    targetList = targetList.concat(t.targets);
    skippedTargets.push(...t.skipped);
  }
  const portalsText = trackerOnly ? null : readOrNull(PORTALS_PATH);
  if (portalsText !== null) {
    const p = parsePortalTargets(portalsText);
    targetList = targetList.concat(p.targets);
    skippedTargets.push(...p.skipped);
  }

  const contactsText = readOrNull(CONTACTS_PATH);
  const known = contactsText === null ? new Set() : parseKnownContacts(contactsText);

  // "connections made in/after YYYY" cannot be true of a connection with no
  // parseable date, so undated rows are excluded rather than waved through.
  // Counted, not silently dropped: this feature is judged on recall, and a
  // vanished warm intro the user never learns about is the expensive failure.
  // `sinceYear !== null`, not truthiness: --since 0000 passes the four-digit
  // check and converts to 0, which a truthy test reads as "no filter" — the
  // same silently-ignored-flag failure the NaN guard above exists to prevent.
  const sinceActive = sinceYear !== null;
  const undatedExcluded = sinceActive
    ? connections.filter(c => c.connectedYear == null).length
    : 0;
  const filtered = sinceActive
    ? connections.filter(c => c.connectedYear != null && c.connectedYear >= sinceYear)
    : connections;

  // --company answers a direct question about one name, which may not be in the
  // tracker or portals.yml at all (the scan just surfaced it). Build an ad-hoc
  // target so the answer does not depend on the company already being tracked.
  if (companyQuery) {
    const tokens = companyTokens(companyQuery);
    if (!tokens.distinctive.length) {
      console.error(`"${companyQuery}" has no identifying words to match on `
        + '(all generic or placeholder terms). Give a more specific company name.');
      return 1;
    }
    targetList = [{ company: companyQuery, source: 'query', tokens, tracker: null }];
  }

  const { targets, matchedConnections, targetCount } = joinConnections(filtered, targetList, { known, includeWeak });

  const result = {
    targets,
    totals: {
      connections: connections.length,
      connectionsConsidered: filtered.length,
      targets: targetCount,
      matchedCompanies: targets.length,
      matchedConnections,
    },
    quality: { ...quality, skippedTargets, undatedExcludedBySince: undatedExcluded },
    filters: {
      includeWeak,
      since: sinceYear,
      scope: trackerOnly ? 'tracker' : portalsOnly ? 'portals' : 'all',
      csv: csvPath,
    },
  };

  if (tsvMode) console.log(renderTsv(result));
  else if (companyQuery && !summaryMode) console.log(JSON.stringify(result, null, 2));
  else if (companyQuery) console.log(renderCompanyAnswer(result, companyQuery));
  else if (summaryMode) console.log(renderSummary(result));
  else console.log(JSON.stringify(result, null, 2));
  return 0;
}

// Entry guard (repo convention, cf. contacts.mjs / stats.mjs / invite-match.mjs):
// without it, importing this module to unit-test its exports runs the whole CLI
// and exits the test process.
if (isMainModule(import.meta.url)) {
  process.exit(main());
}
