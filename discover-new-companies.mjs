#!/usr/bin/env node
/**
 * discover-new-companies.mjs — propose scanner-discovered companies for discovery
 *
 * The missing hop between the scanners and discover-ats.mjs. See modes/discover.md.
 *
 * ── The gap this closes ────────────────────────────────────────────────────
 * The zero-token scanners (scan.mjs, scan-ats-full.mjs) record every company
 * they touch in data/scan-history.tsv, including companies that are NOT in
 * portals.yml — the Gupy provider in particular sweeps that whole platform by
 * keyword, so it constantly surfaces employers nobody configured.
 *
 * Nothing ever fed those names back. They stayed in the history file, and each
 * run rediscovered them from scratch. discover-ats.mjs can resolve a company to
 * a scannable Greenhouse/Ashby/Lever/Workday board, but it takes a hand-written
 * list as input and does not read scan-history.tsv.
 *
 * This script is that missing hop:
 *
 *   scan-history.tsv → [this script] → companies.yml → discover-ats.mjs → portals.yml
 *
 * It only ever WRITES a candidate list. portals.yml is user-layer and is
 * touched exclusively by `discover-ats.mjs --write`, after you review the
 * preview. Zero LLM tokens; the only I/O is reading two local files.
 *
 * company-history.mjs also reads scan-history.tsv, but it is read-only and
 * renders per-company evidence cards; it never emits a discover-ats input, so
 * the two are complementary rather than overlapping.
 *
 * Issue #4181 — github.com/career-ops-hq/career-ops
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { buildCompanyCanonicalizer } from './scan.mjs';

const DATA_ROOT = getCareerOpsRoot();
const HISTORY_PATH = process.env.CAREER_OPS_SCAN_HISTORY || join(DATA_ROOT, 'data', 'scan-history.tsv');
const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || join(DATA_ROOT, 'portals.yml');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => {
  const i = args.indexOf(f);
  if (i === -1) return d;
  if (args.indexOf(f, i + 1) !== -1) {
    console.error(`ERROR: ${f} may only be specified once`);
    process.exit(1);
  }
  if (args[i + 1] === undefined || args[i + 1].startsWith('--')) {
    console.error(`ERROR: ${f} requires a value`);
    process.exit(1);
  }
  return args[i + 1];
};

if (has('--help')) {
  console.log(`Usage: node discover-new-companies.mjs [options]

Reads data/scan-history.tsv, subtracts every company already tracked in
portals.yml, and emits the remainder as a discover-ats.mjs input file.

Options:
  --since <n>       Only companies first seen in the last N days (default: 30)
  --min-rows <n>    Only companies with >= N history rows (default: 2)
  --added-only      Only companies that produced at least one 'added' row
  --limit <n>       Cap the output list (default: 40)
  --out <file>      Write YAML here (default: stdout)
  --summary         Human-readable table instead of YAML
  --json            JSON envelope instead of YAML
  --help            This message

Typical loop:
  node discover-new-companies.mjs --out /tmp/new.yml
  node discover-ats.mjs --in /tmp/new.yml --summary     # preview, writes nothing
  node discover-ats.mjs --in /tmp/new.yml --write       # only after you review
`);
  process.exit(0);
}

const SINCE_DAYS = Number(val('--since', '30'));
const MIN_ROWS   = Number(val('--min-rows', '2'));
const LIMIT      = Number(val('--limit', '40'));
const ADDED_ONLY = has('--added-only');
const OUT_FILE   = val('--out');

for (const [flag, v] of [['--since', SINCE_DAYS], ['--min-rows', MIN_ROWS], ['--limit', LIMIT]]) {
  if (!Number.isFinite(v) || v < 0) {
    console.error(`ERROR: ${flag} must be a non-negative number; got ${JSON.stringify(val(flag))}`);
    process.exit(1);
  }
}

if (!existsSync(HISTORY_PATH)) {
  console.error(`ERROR: ${HISTORY_PATH} not found — run a scan first.`);
  process.exit(1);
}

// ── Already-tracked set ─────────────────────────────────────────────────────
// Match on the canonicalized name so alias drift ("Stone" vs "Pagar.me (Stone)")
// does not resurface a company that is already configured. Disabled entries
// count as tracked: the user turned them off deliberately, and re-proposing
// them every run would be noise.
const portalsRaw = existsSync(PORTALS_PATH)
  ? (yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {})
  : {};
const canon = buildCompanyCanonicalizer(portalsRaw.company_aliases);

const tracked = new Set();
for (const entry of portalsRaw.tracked_companies || []) {
  if (entry && typeof entry.name === 'string') tracked.add(canon(entry.name));
}

// ── Walk the history ────────────────────────────────────────────────────────
const rows = readFileSync(HISTORY_PATH, 'utf-8').split('\n');
const header = rows[0]?.split('\t') ?? [];
const col = (n) => header.indexOf(n);
const iCompany = col('company') === -1 ? 4 : col('company');
const iFirstSeen = col('first_seen') === -1 ? 1 : col('first_seen');
const iStatus = col('status') === -1 ? 5 : col('status');
const iTitle = col('title') === -1 ? 3 : col('title');
const iUrl = col('url') === -1 ? 0 : col('url');

const cutoffMs = SINCE_DAYS > 0 ? Date.now() - SINCE_DAYS * 86_400_000 : null;

/** @type {Map<string, {name:string, rows:number, added:number, lastSeen:string, titles:Set<string>, hosts:Set<string>}>} */
const found = new Map();

for (let i = 1; i < rows.length; i++) {
  const cells = rows[i].split('\t');
  if (cells.length < 6) continue;

  const rawName = (cells[iCompany] || '').trim();
  if (!rawName) continue;

  const seen = (cells[iFirstSeen] || '').trim();
  if (cutoffMs != null) {
    const t = Date.parse(seen);
    // Undated rows pass — same "don't penalize missing data" rule the scanners use.
    if (Number.isFinite(t) && t < cutoffMs) continue;
  }

  const key = canon(rawName);
  if (!key || tracked.has(key)) continue;

  if (!found.has(key)) {
    found.set(key, { name: rawName, rows: 0, added: 0, lastSeen: seen, titles: new Set(), hosts: new Set() });
  }
  const rec = found.get(key);
  rec.rows++;
  if ((cells[iStatus] || '').trim() === 'added') rec.added++;
  if (seen > rec.lastSeen) rec.lastSeen = seen;
  const title = (cells[iTitle] || '').trim();
  if (title && rec.titles.size < 3) rec.titles.add(title);
  try { rec.hosts.add(new URL(cells[iUrl]).hostname); } catch { /* malformed URL — skip host hint */ }
}

// ── Rank and cut ────────────────────────────────────────────────────────────
// Companies that actually produced pipeline entries rank above ones that only
// ever got filtered out — those are the boards most worth resolving.
let candidates = [...found.values()]
  .filter((c) => c.rows >= MIN_ROWS)
  .filter((c) => (ADDED_ONLY ? c.added > 0 : true))
  .sort((a, b) => b.added - a.added || b.rows - a.rows || a.name.localeCompare(b.name));

const totalBeforeLimit = candidates.length;
candidates = candidates.slice(0, LIMIT);

// ── Emit ────────────────────────────────────────────────────────────────────
if (has('--summary')) {
  console.log('='.repeat(78));
  console.log('  New companies seen by scanners but absent from portals.yml');
  console.log(`  candidates: ${totalBeforeLimit} | shown: ${candidates.length} | window: ${SINCE_DAYS}d`);
  console.log('='.repeat(78));
  for (const c of candidates) {
    console.log(`  ${c.name}`);
    console.log(`    rows: ${c.rows} | added: ${c.added} | last: ${c.lastSeen} | ${[...c.hosts][0] || 'n/a'}`);
    if (c.titles.size) console.log(`    e.g. ${[...c.titles][0]}`);
  }
  if (!candidates.length) console.log('  (nothing new — every scanned company is already tracked)');
  console.log('\nNext: node discover-new-companies.mjs --out /tmp/new.yml');
  console.log('      node discover-ats.mjs --in /tmp/new.yml --summary');
  process.exit(0);
}

if (has('--json')) {
  console.log(JSON.stringify({
    metadata: { candidates: totalBeforeLimit, emitted: candidates.length, sinceDays: SINCE_DAYS, minRows: MIN_ROWS, addedOnly: ADDED_ONLY },
    companies: candidates.map((c) => ({
      name: c.name, rows: c.rows, added: c.added, lastSeen: c.lastSeen,
      hosts: [...c.hosts], sampleTitles: [...c.titles],
    })),
  }, null, 2));
  process.exit(0);
}

const doc = yaml.dump({ companies: candidates.map((c) => ({ name: c.name })) });
const banner = `# Generated by discover-new-companies.mjs — ${new Date().toISOString().slice(0, 10)}\n`
  + `# ${totalBeforeLimit} candidate(s) found, ${candidates.length} emitted (window ${SINCE_DAYS}d, min-rows ${MIN_ROWS}).\n`
  + `# Feed to: node discover-ats.mjs --in <this file> --summary\n`;

if (OUT_FILE) {
  writeFileSync(OUT_FILE, banner + doc);
  console.error(`Wrote ${candidates.length} company/companies to ${OUT_FILE}`);
} else {
  process.stdout.write(banner + doc);
}
