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
 *   - via:       it is the Via of a tracker row (#1596)
 *   - contact:   a `recruiter` contact in data/contacts.tsv works there
 *   - mandate:   it has a row in data/mandates.tsv
 *   - name:      its name looks like a search or staffing firm (FIRM_NAME_RE)
 *
 * For each firm it reports, over the last --days days of data/scan-history.tsv:
 * postings seen, postings whose title passes portals.yml `title_filter`
 * (on-target), the last date seen, a few on-target titles, the tracker rows
 * that went through it, saved contacts there, and its mandates.
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
 *      node recruiter-signal.mjs --firm "Acme Search" (one firm, for the skip offer)
 *      node recruiter-signal.mjs --days 180 --top 10
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadYaml } from './lib/yaml-document.mjs';
import { parseScanHistoryLine } from './lib/scan-history-columns.mjs';
import { buildTitleFilter } from './title-keywords.mjs';
import { parseContacts } from './contacts.mjs';
import { loadTrackerRows } from './company-history.mjs';
import { normalizeCompany, companiesMatchIgnoringCorporateForm } from './tracker-utils.mjs';
import { validateFlags, flagValue } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const DATA_ROOT = getCareerOpsRoot();
const PATHS = {
  history: join(DATA_ROOT, 'data/scan-history.tsv'),
  contacts: join(DATA_ROOT, 'data/contacts.tsv'),
  mandates: join(DATA_ROOT, 'data/mandates.tsv'),
  portals: join(DATA_ROOT, 'portals.yml'),
};

export const MANDATE_STATUSES = ['expected', 'open', 'closed'];
const DEFAULT_DAYS = 90;

// shortcut: a name heuristic misses one-word boutique brands; those count once
// they appear as a Via, a recruiter contact or a mandates.tsv row.
const FIRM_NAME_RE = /\b(executive search|search partners?|recruit(?:ment|ing|ers?)|staffing|headhunt\w*|interim management|hays|michael page|page executive|robert walters|robert half|randstad|adecco|korn ferry|spencer stuart|egon zehnder|heidrick|russell reynolds)\b/i;

const KNOWN_FLAGS = ['--summary', '--firm', '--days', '--top', '--help', '-h'];
const USAGE = `Usage:
  node recruiter-signal.mjs                      # JSON: firms ranked by on-target postings
  node recruiter-signal.mjs --summary            # human-readable table
  node recruiter-signal.mjs --firm "<name>"      # one firm only
  node recruiter-signal.mjs --days <n>           # look-back window (default ${DEFAULT_DAYS})
  node recruiter-signal.mjs --top <n>            # keep the first n firms
  node recruiter-signal.mjs --help`;

const sameFirm = (a, b) =>
  (normalizeCompany(a) !== '' && normalizeCompany(a) === normalizeCompany(b))
  || companiesMatchIgnoringCorporateForm(a, b);

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
 * Fold scan history, tracker, contacts and mandates into a ranked firm list.
 * Pure: every input is passed in, so tests need no files.
 */
export function buildSignal({ history = [], trackerRows = [], contacts = [], mandates = [], titleFilter, today, days = DEFAULT_DAYS, firm: firmQuery = null }) {
  const since = new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
  const passesTitle = buildTitleFilter(titleFilter);
  const firms = [];

  const firmFor = (name, source) => {
    if (!normalizeCompany(name)) return null; // `?`, `—`, empty
    let firm = firms.find((f) => sameFirm(f.firm, name));
    if (!firm) {
      firm = { firm: name, sources: [], postings: 0, onTarget: 0, lastSeen: null, sampleTitles: [], applications: [], contacts: [], mandates: { expected: 0, open: 0, closed: 0, items: [] } };
      firms.push(firm);
    }
    if (source && !firm.sources.includes(source)) firm.sources.push(source);
    return firm;
  };

  // --firm names an agency the user just skipped: count it even if nothing else knows it yet.
  if (firmQuery) firmFor(firmQuery, 'query');
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
  for (const c of contacts) firms.find((f) => sameFirm(f.firm, c.company))?.contacts.push(c.name);

  const seenUrls = new Set();
  for (const h of history) {
    if (!h.company || !h.first_seen || h.first_seen < since) continue;
    if (h.url && seenUrls.has(h.url)) continue;
    if (h.url) seenUrls.add(h.url);
    const firm = firms.find((f) => sameFirm(f.firm, h.company))
      ?? (FIRM_NAME_RE.test(h.company) ? firmFor(h.company, 'name') : null);
    if (!firm) continue;
    firm.postings++;
    if (!firm.lastSeen || h.first_seen > firm.lastSeen) firm.lastSeen = h.first_seen;
    if (passesTitle(h.title)) {
      firm.onTarget++;
      if (firm.sampleTitles.length < 3 && !firm.sampleTitles.includes(h.title)) firm.sampleTitles.push(h.title);
    }
  }

  if (firmQuery) return { since, days, firms: firms.filter((f) => sameFirm(f.firm, firmQuery)) };
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
  if (!firms.length) out.push('  No recruiter or search firm found yet. Firms appear once they post in a scanned source, are the Via of a tracker row, or are named in data/contacts.tsv (type recruiter) or data/mandates.tsv.');
  for (const f of firms) {
    const m = f.mandates;
    out.push(`  ${f.firm}  [${f.sources.join(', ')}]`);
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
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: ['--firm', '--days', '--top'] });
  const days = Number(flagValue(args, '--days') ?? DEFAULT_DAYS);
  const top = flagValue(args, '--top') == null ? Infinity : Number(flagValue(args, '--top'));
  if (!Number.isInteger(days) || days < 1 || !(top === Infinity || (Number.isInteger(top) && top > 0))) {
    console.error('--days and --top take a positive whole number.');
    process.exit(1);
  }

  const history = readIf(PATHS.history).split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('url\t'))
    .map(parseScanHistoryLine);
  const portals = loadYaml(readIf(PATHS.portals)) || {};
  const { contacts } = parseContacts(readIf(PATHS.contacts));
  const { mandates, quality } = parseMandates(readIf(PATHS.mandates));
  const { rows: trackerRows } = loadTrackerRows(DATA_ROOT);

  const result = buildSignal({ history, trackerRows, contacts, mandates, titleFilter: portals.title_filter, today: new Date().toISOString().slice(0, 10), days, firm: flagValue(args, '--firm') });
  result.firms = result.firms.slice(0, top);

  if (args.includes('--summary')) console.log(renderSummary(result, quality));
  else console.log(JSON.stringify({ ...result, quality }, null, 2));
}

if (isMainModule(import.meta.url)) main();
