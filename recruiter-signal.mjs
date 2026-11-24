#!/usr/bin/env node
/**
 * recruiter-signal.mjs — which recruiters and search firms are hiring in your
 * niche right now, and which mandates they hold (discussion #7694).
 *
 * career-ops follows postings and applications. A recruiter relationship fits
 * neither, yet for senior roles much of the market runs through search firms.
 * When the scanner surfaces an agency posting that does not fit, the useful
 * signal ("this firm recruits at my level, in my region, right now") used to be
 * lost with the skip. This script keeps it. Zero LLM, read-only, never writes.
 *
 * A firm counts as a recruiter when any of these says so:
 *   - profile:   you listed it in config/profile.yml → recruiters.firms
 *   - directory: it is in templates/recruiter-firms.yml and matches your
 *                recruiters.countries / sectors / levels (empty = no limit)
 *   - via:       it is the Via of a tracker row (#1596)
 *   - contact:   a `recruiter` contact in data/contacts.tsv works there
 *   - mandate:   it has a row in data/mandates.tsv
 *   - name:      its name reads like a search or staffing firm in one of
 *                several languages (FIRM_NAME_RE)
 *
 * For each firm it reports, over the last --days days of data/scan-history.tsv:
 * postings seen, postings whose title passes portals.yml `title_filter`
 * (on-target), the last date seen, a few on-target titles, the tracker rows
 * that went through it, saved contacts there, and its mandates.
 * --directory lists every firm you selected, posting or not: who to know.
 *
 * data/mandates.tsv (user layer, gitignored) records mandates a recruiter told
 * you about, including ones not posted yet. One line per mandate, `#` comment
 * lines and blank lines skipped, updated in place as a mandate moves on:
 *
 *   {date}\t{firm}\t{role}\t{client|?}\t{status}\t{notes}
 *
 * status: expected (announced, not open yet) | open | closed. `?` is an
 * undisclosed client: never infer it. Malformed rows land in `quality`, never
 * dropped silently.
 *
 * Run: node recruiter-signal.mjs                      (JSON)
 *      node recruiter-signal.mjs --summary            (ranked table)
 *      node recruiter-signal.mjs --directory --summary (every firm you selected)
 *      node recruiter-signal.mjs --firm "Acme Search" (one firm)
 *      node recruiter-signal.mjs --firm-file firm.txt  (same, name read from a file:
 *                                                   the agent's path for posting text)
 *      node recruiter-signal.mjs --days 180 --top 10
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadYaml } from './lib/yaml-document.mjs';
import { parseScanHistoryLine } from './lib/scan-history-columns.mjs';
import { buildTitleFilter } from './title-keywords.mjs';
import { parseContacts } from './contacts.mjs';
import { loadTrackerRows } from './company-history.mjs';
import { normalizeCompany, companiesMatchIgnoringCorporateForm } from './tracker-utils.mjs';
import { validateFlags, flagValue } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';

const DATA_ROOT = getCareerOpsRoot();
const PATHS = {
  history: join(DATA_ROOT, 'data/scan-history.tsv'),
  contacts: join(DATA_ROOT, 'data/contacts.tsv'),
  mandates: join(DATA_ROOT, 'data/mandates.tsv'),
  portals: join(DATA_ROOT, 'portals.yml'),
  profile: getProfilePath(),
  directory: join(dirname(fileURLToPath(import.meta.url)), 'templates/recruiter-firms.yml'),
};

export const MANDATE_STATUSES = ['expected', 'open', 'closed'];
const DEFAULT_DAYS = 90;

// Generic words only; brand names belong in templates/recruiter-firms.yml.
// shortcut: a word list misses one-word boutique brands; those count once they
// are in your profile list, a Via, a recruiter contact or mandates.tsv.
const FIRM_NAME_RE = /\b(executive search|search partners?|head ?hunt\w*|recruit(?:ment|ing|ers?)|staffing|interim management|recrutement|cabinet de recrutement|chasseurs? de t[eê]tes|werving|selectie|personalberatung|personalvermittlung|reclutamiento|selecci[oó]n de personal|recrutamento|reclutamento|selezione del personale|rekrytering|rekruttering|rekrutacja)\b/i;

const KNOWN_FLAGS = ['--summary', '--firm', '--firm-file', '--days', '--top', '--directory', '--help', '-h'];
const USAGE = `Usage:
  node recruiter-signal.mjs                      # JSON: firms ranked by on-target postings
  node recruiter-signal.mjs --summary            # human-readable table
  node recruiter-signal.mjs --directory          # every firm you selected, posting or not
  node recruiter-signal.mjs --firm "<name>"      # one firm only
  node recruiter-signal.mjs --firm-file <path>   # same, name read from a file (posting text never reaches a shell)
  node recruiter-signal.mjs --days <n>           # look-back window (default ${DEFAULT_DAYS})
  node recruiter-signal.mjs --top <n>            # keep the first n firms
  node recruiter-signal.mjs --help

Your choice lives in config/profile.yml:
  recruiters:
    countries: [BE, FR]          # ISO codes; empty = every country
    sectors: [technology]        # empty = every sector
    levels: [executive]          # executive | management | professional
    firms:                       # your own firms, always included
      - { name: "Acme Search", countries: [BE], sectors: [technology] }`;

// A posting often adds a branch or country to the firm name ("Hays Belgium",
// "Michael Page International (Belgium)"), so a whole-word prefix also matches.
const words = (v) => String(v ?? '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const sameFirm = (firmName, company) => {
  const f = words(firmName);
  const c = words(company);
  return (f.length > 0 && f.every((w, i) => c[i] === w))
    || (normalizeCompany(firmName) !== '' && normalizeCompany(firmName) === normalizeCompany(company))
    || companiesMatchIgnoringCorporateForm(firmName, company);
};
const firmMatches = (firm, company) => [firm.firm, ...firm.aliases].some((n) => sameFirm(n, company));

const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
const overlaps = (wanted, have, wildcard) => !wanted.length || have.includes(wildcard) || have.some((x) => wanted.includes(x));

/**
 * The firms the user chose: directory entries matching their countries,
 * sectors and levels (an empty choice means no limit), plus their own firms.
 */
export function selectFirms(directory = [], prefs = {}) {
  const countries = list(prefs.countries);
  const sectors = list(prefs.sectors);
  const levels = list(prefs.levels);
  const shape = (f, source) => ({ name: String(f.name ?? '').trim(), aliases: (f.aliases ?? []).map(String), countries: list(f.countries), sectors: list(f.sectors), levels: list(f.levels), source });
  const chosen = (Array.isArray(directory) ? directory : [])
    .map((f) => shape(f, 'directory'))
    .filter((f) => f.name
      && overlaps(countries, f.countries, 'global')
      && overlaps(sectors, f.sectors, 'generalist')
      && (!levels.length || f.levels.some((x) => levels.includes(x))));
  const own = (Array.isArray(prefs.firms) ? prefs.firms : []).map((f) => shape(typeof f === 'string' ? { name: f } : f, 'profile')).filter((f) => f.name);
  return [...own, ...chosen];
}

/** Parse data/mandates.tsv. Bad rows go to `quality`, never thrown. */
export function parseMandates(text) {
  const mandates = [];
  const quality = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const [date = '', firm = '', role = '', client = '', status = '', notes = ''] = line.split('\t').map((c) => c.trim());
    const problem = !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'date must be YYYY-MM-DD'
      : !firm ? 'firm is empty'
      : !role ? 'role is empty'
      : !MANDATE_STATUSES.includes(status) ? `status must be one of ${MANDATE_STATUSES.join('|')}`
      : null;
    if (problem) quality.push({ line: i + 1, problem });
    else mandates.push({ date, firm, role, client: client || '?', status, notes });
  });
  return { mandates, quality };
}

/**
 * Fold scan history, tracker, contacts, mandates and the chosen firms into a
 * ranked firm list. Pure: every input is passed in, so tests need no files.
 */
export function buildSignal({ history = [], trackerRows = [], contacts = [], mandates = [], selected = [], titleFilter, today, days = DEFAULT_DAYS, firm: firmQuery = null, directory: listAll = false }) {
  const since = new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
  const passesTitle = buildTitleFilter(titleFilter);
  const firms = [];

  const firmFor = (name, source, meta = null) => {
    if (!normalizeCompany(name)) return null; // `?`, `—`, empty
    let firm = firms.find((f) => firmMatches(f, name));
    if (!firm) {
      firm = { firm: name, aliases: [], sources: [], countries: [], sectors: [], levels: [], postings: 0, onTarget: 0, lastSeen: null, sampleTitles: [], applications: [], contacts: [], mandates: { expected: 0, open: 0, closed: 0, items: [] } };
      firms.push(firm);
    }
    if (meta) Object.assign(firm, { aliases: meta.aliases, countries: meta.countries, sectors: meta.sectors, levels: meta.levels });
    if (source && !firm.sources.includes(source)) firm.sources.push(source);
    return firm;
  };

  // --firm names an agency the user just skipped: count it even if nothing else knows it yet.
  if (firmQuery) firmFor(firmQuery, 'query');
  // Your own firms always show; directory firms only on --directory or once they post.
  for (const s of selected) if (s.source === 'profile' || listAll) firmFor(s.name, s.source, s);
  for (const row of trackerRows) {
    const via = String(row.via ?? '').trim();
    if (via && via !== '—' && via !== '-') firmFor(via, 'via')?.applications.push({ num: row.num, company: row.company, role: row.role, status: row.status });
  }
  for (const c of contacts) if (c.type === 'recruiter') firmFor(c.company, 'contact');
  for (const m of mandates) {
    const firm = firmFor(m.firm, 'mandate');
    if (!firm) continue;
    firm.mandates[m.status]++;
    firm.mandates.items.push(m);
  }
  // Contacts of any type at a known firm are warm paths, whatever their type.
  for (const c of contacts) firms.find((f) => firmMatches(f, c.company))?.contacts.push(c.name);

  const seenUrls = new Set();
  for (const h of history) {
    if (!h.company || !h.first_seen || h.first_seen < since) continue;
    if (h.url && seenUrls.has(h.url)) continue;
    if (h.url) seenUrls.add(h.url);
    let firm = firms.find((f) => firmMatches(f, h.company));
    if (!firm) {
      const sel = selected.find((s) => [s.name, ...s.aliases].some((n) => sameFirm(n, h.company)));
      firm = sel ? firmFor(sel.name, sel.source, sel) : FIRM_NAME_RE.test(h.company) ? firmFor(h.company, 'name') : null;
    }
    if (!firm) continue;
    firm.postings++;
    if (!firm.lastSeen || h.first_seen > firm.lastSeen) firm.lastSeen = h.first_seen;
    if (passesTitle(h.title)) {
      firm.onTarget++;
      if (firm.sampleTitles.length < 3 && !firm.sampleTitles.includes(h.title)) firm.sampleTitles.push(h.title);
    }
  }

  if (firmQuery) return { since, days, firms: firms.filter((f) => firmMatches(f, firmQuery)) };
  firms.sort((a, b) =>
    b.onTarget - a.onTarget
    || (b.mandates.open + b.mandates.expected) - (a.mandates.open + a.mandates.expected)
    || b.postings - a.postings
    || String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? ''))
    || a.firm.localeCompare(b.firm));
  return { since, days, firms };
}

function renderSummary({ since, days, firms }, quality) {
  const out = [`\nRECRUITER SIGNAL — last ${days} days (since ${since})\n`];
  if (!firms.length) out.push('  No recruiter or search firm found yet. Choose countries and sectors under config/profile.yml → recruiters, or run with --directory to see the firms you selected.');
  for (const f of firms) {
    const m = f.mandates;
    const tags = [f.countries.join('/'), f.sectors.join('/'), f.levels.join('/')].filter(Boolean).join(' · ');
    out.push(`  ${f.firm}  [${f.sources.join(', ')}]${tags ? `  ${tags}` : ''}`);
    out.push(`    postings: ${f.postings} (on-target ${f.onTarget})${f.lastSeen ? `, last seen ${f.lastSeen}` : ''}`
      + ` · applications: ${f.applications.length} · contacts: ${f.contacts.length || 'none'}`
      + ` · mandates: ${m.open} open, ${m.expected} expected, ${m.closed} closed`);
    for (const t of f.sampleTitles) out.push(`      - ${t}`);
    for (const it of m.items.filter((x) => x.status !== 'closed')) out.push(`      * ${it.status}: ${it.role} (client ${it.client}, ${it.date})${it.notes ? ` — ${it.notes}` : ''}`);
  }
  if (quality.length) out.push(`\n  data/mandates.tsv: ${quality.length} malformed row(s) skipped — ${quality.map((q) => `line ${q.line}: ${q.problem}`).join('; ')}`);
  out.push('');
  return out.join('\n');
}

function readIf(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: ['--firm', '--firm-file', '--days', '--top'], requireOperand: true });
  const days = Number(flagValue(args, '--days') ?? DEFAULT_DAYS);
  const top = flagValue(args, '--top') == null ? Infinity : Number(flagValue(args, '--top'));
  if (!Number.isInteger(days) || days < 1 || !(top === Infinity || (Number.isInteger(top) && top > 0))) {
    console.error('--days and --top take a positive whole number.');
    process.exit(1);
  }

  // A firm name taken from a posting is untrusted text: the agent writes it to a
  // file and passes the path, so no shell ever parses it.
  const firmFile = flagValue(args, '--firm-file');
  if (firmFile && !existsSync(firmFile)) {
    console.error(`--firm-file: ${firmFile} not found.`);
    process.exit(1);
  }
  const firmQuery = firmFile ? readFileSync(firmFile, 'utf-8').split(/\r?\n/)[0].trim() : flagValue(args, '--firm');
  if (firmFile && !firmQuery) {
    console.error(`--firm-file: ${firmFile} has no firm name on its first line.`);
    process.exit(1);
  }

  const history = readIf(PATHS.history).split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('url\t'))
    .map(parseScanHistoryLine);
  const portals = loadYaml(readIf(PATHS.portals)) || {};
  const prefs = (loadYaml(readIf(PATHS.profile)) || {}).recruiters || {};
  const selected = selectFirms((loadYaml(readIf(PATHS.directory)) || {}).firms, prefs);
  const { contacts } = parseContacts(readIf(PATHS.contacts));
  const { mandates, quality } = parseMandates(readIf(PATHS.mandates));
  const { rows: trackerRows } = loadTrackerRows(DATA_ROOT);

  const result = buildSignal({
    history, trackerRows, contacts, mandates, selected,
    titleFilter: portals.title_filter,
    today: new Date().toISOString().slice(0, 10),
    days, firm: firmQuery || null, directory: args.includes('--directory'),
  });
  result.firms = result.firms.slice(0, top);
  result.choice = { countries: list(prefs.countries), sectors: list(prefs.sectors), levels: list(prefs.levels), ownFirms: selected.filter((s) => s.source === 'profile').length, directoryFirms: selected.filter((s) => s.source === 'directory').length };

  if (args.includes('--summary')) console.log(renderSummary(result, quality));
  else console.log(JSON.stringify({ ...result, quality }, null, 2));
}

if (isMainModule(import.meta.url)) main();
