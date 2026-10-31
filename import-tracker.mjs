#!/usr/bin/env node
/**
 * import-tracker.mjs — bring a job tracker exported from another tool into
 * applications.md.
 *
 * Reads a CSV export (Teal, Huntr, Simplify, or a hand-kept spreadsheet), maps
 * its columns and stage names onto the tracker's, and adds one row per
 * application through the normal merge: a reserved number, a headed
 * tracker-addition TSV with the `N/A` score sentinel, then merge-tracker.mjs.
 * Rows the tracker already holds (same posting URL, or same company and role)
 * are skipped, so running it twice adds nothing the second time. Stages that
 * mean "not applied yet" (Bookmarked, Wishlist, Saved) are left out: in
 * career-ops those postings belong in the pipeline, where they get evaluated.
 *
 * Dry run by default. Nothing is written unless `--confirm` is passed.
 *
 * Usage:
 *   node import-tracker.mjs <export.csv>              # preview
 *   node import-tracker.mjs <export.csv> --confirm    # add the rows
 *   node import-tracker.mjs <export.csv> --day-first  # read 03/04/2026 as 3 April
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { basename, dirname, isAbsolute, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { parseCsv } from './linkedin-join.mjs';
import { resolveColumns, parseTrackerRow, normalizeTextKey } from './tracker-parse.mjs';
import { loadCanonicalStates, resolveCanonicalState } from './tracker-utils.mjs';
import { normalizeUrl } from './url-key.mjs';
import { getCareerOpsRoot, resolveTrackerPath, resolveTrackerPathForWrite } from './path-resolver.mjs';
import { reserveReportNumbers, releaseReportNumbers } from './reserve-report-num.mjs';
import { tsvSafe, slugifyCompany, isPostingUrl } from './lib/tracker-addition.mjs';
import { hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { localToday } from './lib/local-today.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const STATES_FILE = join(CODE_ROOT, 'templates/states.yml');
const RESERVE_CHUNK = 50;
const PREVIEW_ROWS = 20;

const usage = () => `Usage: node import-tracker.mjs <export.csv> [options]

Adds the applications in a CSV export from another tracker (Teal, Huntr,
Simplify, a spreadsheet) to data/applications.md. Dry run by default.

  --confirm     Add the rows (default is a preview that writes nothing)
  --day-first   Read slash dates as day/month/year (default: inferred from
                the file, month/day/year when every date fits both)
  -h, --help    Show this help and exit

The file needs a company column and a role column. Recognized headers:
${Object.entries(COLUMN_ALIASES).map(([f, a]) => `  ${f.padEnd(9)} ${a.join(', ')}`).join('\n')}`;

// Header names other trackers use, per tracker field. Earlier names win when a
// file has several, so "Date Applied" beats Huntr's "Created At".
export const COLUMN_ALIASES = {
  company: ['company', 'company name', 'employer', 'organization', 'organisation'],
  role: ['role', 'job title', 'title', 'position', 'job position', 'position title', 'job'],
  status: ['status', 'stage', 'list', 'application status', 'job status'],
  date: ['date applied', 'applied date', 'applied on', 'application date', 'applied', 'date', 'created at', 'date added', 'date saved'],
  url: ['url', 'job url', 'job link', 'posting link', 'posting url', 'link', 'apply url'],
  location: ['location', 'job location'],
  notes: ['notes', 'note', 'comments'],
};

const NOT_APPLIED = 'not-applied';

// Stage names from other trackers that states.yml does not already resolve.
// Teal: Bookmarked, Applying, Interviewing, Negotiating, Not Selected,
// No Response, Withdrawn, Archived. Huntr: Wishlist. Simplify: Saved, Screen.
export const OTHER_TRACKER_STAGES = {
  bookmarked: NOT_APPLIED,
  wishlist: NOT_APPLIED,
  saved: NOT_APPLIED,
  interested: NOT_APPLIED,
  applying: NOT_APPLIED,
  'to apply': NOT_APPLIED,
  'not applied': NOT_APPLIED,
  submitted: 'Applied',
  screen: 'Responded',
  'phone screen': 'Responded',
  'recruiter screen': 'Responded',
  interviewing: 'Interview',
  'final round': 'Interview',
  negotiating: 'Offer',
  'offer received': 'Offer',
  'not selected': 'Rejected',
  'no response': 'Discarded',
  ghosted: 'Discarded',
  withdrawn: 'Discarded',
  archived: 'Discarded',
};

// What happens to each source row, in the order the preview lists them.
export const OUTCOMES = {
  import: 'to import',
  tracked: 'already in the tracker',
  repeat: 'repeated in this file',
  'not-applied': 'not applied yet (add these to the pipeline to evaluate them)',
  'unknown-status': 'unknown stage (rename it in the file to a tracker state)',
  incomplete: 'missing company or role',
};

const headerKey = (h) => String(h ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Map tracker fields to column indexes by header name.
 * @param {string[]} header
 * @returns {{columns: Record<string, number>, ignored: string[]}}
 */
export function mapColumns(header) {
  const keys = header.map(headerKey);
  const columns = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const at = keys.indexOf(alias);
      if (at !== -1 && !Object.values(columns).includes(at)) { columns[field] = at; break; }
    }
  }
  const used = new Set(Object.values(columns));
  return { columns, ignored: header.filter((h, i) => !used.has(i) && headerKey(h)) };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function isoDate(y, m, d) {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

const SLASH_DATE = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T,].*)?$/;

/**
 * Read a date the way trackers and spreadsheets export it.
 * @param {string} raw - "2026-07-03", "2026-07-03T14:00:00Z", "7/3/2026", "Jul 3, 2026", "3 Jul 2026".
 * @param {boolean} dayFirst - How to read a slash date.
 * @returns {string|null} YYYY-MM-DD, or null when the value is empty or unreadable.
 */
export function readSourceDate(raw, dayFirst) {
  const s = String(raw ?? '').trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return isoDate(m[1], +m[2], +m[3]);
  m = SLASH_DATE.exec(s);
  if (m) return dayFirst ? isoDate(m[3], +m[2], +m[1]) : isoDate(m[3], +m[1], +m[2]);
  m = /^(\d{1,2})[ -]([A-Za-z]{3,})\.?[ ,-]+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return isoDate(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = /^([A-Za-z]{3,})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return isoDate(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return null;
}

/**
 * Decide how to read the file's slash dates from the dates themselves.
 * A first part above 12 proves day/month, a second part above 12 proves
 * month/day. A file with both is refused rather than half misread.
 * @param {string[]} values
 * @returns {boolean} true for day/month/year.
 */
export function inferDayFirst(values) {
  let dayFirst = false;
  let monthFirst = false;
  for (const v of values) {
    const m = SLASH_DATE.exec(String(v ?? '').trim());
    if (!m) continue;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
  }
  if (dayFirst && monthFirst) {
    throw new Error('The date column mixes day/month/year and month/day/year dates. Make them one format and run again.');
  }
  return dayFirst;
}

/**
 * Resolve a source stage to a tracker state.
 * @returns {string|null} A canonical label, NOT_APPLIED, or null when unknown.
 */
export function resolveStage(raw, states) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Applied';
  const key = headerKey(s);
  return resolveCanonicalState(s, states)
    ?? (Object.hasOwn(OTHER_TRACKER_STAGES, key) ? OTHER_TRACKER_STAGES[key] : null);
}

const roleKey = (company, role) => `${normalizeTextKey(company)}\u0000${normalizeTextKey(role)}`;

/**
 * Plan an import without touching disk.
 * @param {string[][]} csvRows - parseCsv() output, header first.
 * @param {{states: object[], trackerRows: object[], today: string, dayFirst?: boolean, source: string}} ctx
 */
export function planImport(csvRows, { states, trackerRows, today, dayFirst, source }) {
  // `row` is the spreadsheet row number, so blank rows still count.
  const rows = csvRows.map((cells, i) => ({ cells, row: i + 1 })).filter((r) => r.cells.some((c) => c.trim()));
  if (!rows.length) throw new Error('The file is empty.');
  const header = rows[0].cells;
  const body = rows.slice(1);
  const { columns, ignored } = mapColumns(header);
  const missing = ['company', 'role'].filter((f) => columns[f] == null);
  if (missing.length) {
    throw new Error(`No ${missing.join(' or ')} column found. The file's headers are: ${header.map((h) => `"${h.trim()}"`).join(', ')}. Rename one to a recognized header (see --help).`);
  }
  const at = (r, f) => (columns[f] == null ? '' : String(r.cells[columns[f]] ?? '').trim());
  const dates = body.map((r) => at(r, 'date'));
  const readDayFirst = dayFirst ?? inferDayFirst(dates);

  // One posting is one key: the URL when both sides have one, otherwise the
  // company and role. Two different URLs under one title are two postings.
  const index = () => ({ byUrl: new Map(), byRole: new Map() });
  const remember = (idx, urlKey, rk, value) => {
    if (urlKey) idx.byUrl.set(urlKey, value);
    idx.byRole.set(rk, [...(idx.byRole.get(rk) ?? []), { urlKey, value }]);
  };
  const lookup = (idx, urlKey, rk) => (urlKey ? idx.byUrl.get(urlKey) : undefined)
    ?? (idx.byRole.get(rk) ?? []).find((c) => !(c.urlKey && urlKey && c.urlKey !== urlKey))?.value;
  const tracked = index();
  for (const t of trackerRows) remember(tracked, normalizeUrl(t.url), roleKey(t.company, t.role), t.num);
  const seen = index();

  const entries = body.map((r) => {
    const company = at(r, 'company');
    const role = at(r, 'role');
    const sourceStatus = at(r, 'status');
    const rawUrl = at(r, 'url');
    const url = isPostingUrl(rawUrl) ? rawUrl : '';
    const base = { row: r.row, company, role, sourceStatus, url, location: at(r, 'location'), sourceNotes: at(r, 'notes') };
    if (!company || !role) return { ...base, outcome: 'incomplete' };
    const status = resolveStage(sourceStatus, states);
    if (status === NOT_APPLIED) return { ...base, outcome: 'not-applied' };
    if (!status) return { ...base, outcome: 'unknown-status' };
    const urlKey = normalizeUrl(url);
    const rk = roleKey(company, role);
    const trackedNum = lookup(tracked, urlKey, rk);
    if (trackedNum != null) return { ...base, status, outcome: 'tracked', trackedNum };
    const firstRow = lookup(seen, urlKey, rk);
    if (firstRow != null) return { ...base, status, outcome: 'repeat', firstRow };
    remember(seen, urlKey, rk, r.row);
    const date = readSourceDate(at(r, 'date'), readDayFirst);
    return { ...base, status, date: date ?? today, undated: !date, outcome: 'import' };
  });

  const notes = (e) => [
    `imported from ${source}`,
    e.sourceStatus && e.sourceStatus.toLowerCase() !== e.status.toLowerCase() ? `source stage: ${e.sourceStatus}` : '',
    e.undated ? 'no date in source' : '',
    e.sourceNotes,
  ].filter(Boolean).join('; ');
  for (const e of entries) if (e.outcome === 'import') e.notes = notes(e);

  return { columns: Object.fromEntries(Object.entries(columns).map(([f, i]) => [f, header[i].trim()])), ignored, dayFirst: readDayFirst, slashDates: dates.some((d) => SLASH_DATE.test(d)), entries };
}

/** Headed tracker-addition TSV for one imported row. */
export function additionTsv(entry, num, { locationColumn, urlColumn }) {
  const labels = ['num', 'date', 'company', 'role', 'status', 'score', 'pdf', 'report', 'notes'];
  const notes = !locationColumn && entry.location ? `${entry.notes}; ${entry.location}` : entry.notes;
  const fields = [num, entry.date, entry.company, entry.role, entry.status, 'N/A', '❌', '—', notes];
  if (locationColumn && entry.location) { labels.push('location'); fields.push(entry.location); }
  if (urlColumn && entry.url) { labels.push('url'); fields.push(entry.url); }
  return `${labels.join('\t')}\n${fields.map(tsvSafe).join('\t')}\n`;
}

function readTracker(trackerPath) {
  if (!existsSync(trackerPath)) return { exists: false, rows: [], colmap: null };
  const lines = readFileSync(trackerPath, 'utf-8').split(/\r?\n/);
  const colmap = resolveColumns(lines);
  return { exists: true, colmap, rows: lines.map((l) => parseTrackerRow(l, colmap)).filter(Boolean) };
}

function printPreview(plan, { source, confirm, urlColumn, trackerExists }) {
  const count = (o) => plan.entries.filter((e) => e.outcome === o);
  const toImport = count('import');
  console.log(confirm && toImport.length ? `Importing ${source}` : `Import preview for ${source} (nothing written)`);
  console.log(`Columns: ${Object.entries(plan.columns).map(([f, h]) => `${f} <- "${h}"`).join(', ')}`);
  if (plan.ignored.length) console.log(`Ignored columns: ${plan.ignored.map((h) => h.trim()).join(', ')}`);
  console.log('');
  for (const [outcome, label] of Object.entries(OUTCOMES)) {
    const rows = count(outcome);
    if (!rows.length) continue;
    console.log(`${String(rows.length).padStart(4)} ${label}`);
    const shown = outcome === 'import' ? rows.slice(0, PREVIEW_ROWS) : rows.slice(0, 5);
    for (const e of shown) {
      const detail = {
        import: `${e.date}  ${e.status}`,
        tracked: `#${e.trackedNum}`,
        repeat: `same as row ${e.firstRow}`,
        'not-applied': e.sourceStatus,
        'unknown-status': `"${e.sourceStatus}"`,
        incomplete: '',
      }[outcome];
      console.log(`       row ${e.row}: ${e.company || '?'} | ${e.role || '?'}${detail ? `  (${detail})` : ''}`);
    }
    if (rows.length > shown.length) console.log(`       ... ${rows.length - shown.length} more`);
  }
  const undated = toImport.filter((e) => e.undated).length;
  if (undated) console.log(`\n${undated} row(s) have no readable date and get today's date, with "no date in source" in Notes.`);
  if (plan.slashDates) console.log(`\nSlash dates are read as ${plan.dayFirst ? 'day/month/year' : 'month/day/year'}.${plan.dayFirst ? '' : ' Pass --day-first if they are day/month/year.'}`);
  const links = toImport.filter((e) => e.url).length;
  if (links && !urlColumn) {
    console.log(`\n${links} row(s) carry a posting link, and the tracker has no URL column, so the links will not be kept. Run "node merge-tracker.mjs --backfill-urls" once to add the column, then import.`);
  }
  if (!trackerExists && toImport.length) console.log('\nNo tracker yet: --confirm creates data/applications.md.');
  if (!confirm && toImport.length) console.log(`\nRun again with --confirm to add ${toImport.length} row(s).`);
}

const TRACKER_HEADER = ['#', 'Date', 'Company', 'Role', 'Score', 'Status', 'PDF', 'Report', 'Notes'];

function createTracker(path, withUrl) {
  const cols = withUrl ? [...TRACKER_HEADER, 'URL'] : TRACKER_HEADER;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `# Applications Tracker\n\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n`, { flag: 'wx' });
}

async function writeImport(entries, { colmap }) {
  // Private directory: --confirm must not merge or delete TSVs that were already waiting,
  // and CAREER_OPS_ADDITIONS must not point merge at a different directory than these files.
  const additionsDir = mkdtempSync(join(tmpdir(), 'import-tracker-'));
  const shape = { locationColumn: colmap?.location != null, urlColumn: colmap?.url != null };
  const reservations = [];
  try {
    for (let i = 0; i < entries.length; i += RESERVE_CHUNK) {
      const chunk = entries.slice(i, i + RESERVE_CHUNK);
      const nums = await reserveReportNumbers(chunk.length);
      reservations.push(nums);
      chunk.forEach((entry, j) => {
        const file = join(additionsDir, `${nums[j]}-${slugifyCompany(entry.company)}.tsv`);
        writeFileSync(file, additionTsv(entry, nums[j], shape), { flag: 'wx' });
      });
    }
    const merge = spawnSync(process.execPath, [join(CODE_ROOT, 'merge-tracker.mjs')], {
      stdio: 'inherit',
      env: { ...process.env, CAREER_OPS_ADDITIONS: additionsDir },
    });
    return merge.status ?? 1;
  } finally {
    rmSync(additionsDir, { recursive: true, force: true });
    for (const nums of reservations) await releaseReportNumbers(nums);
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, ['--confirm', '--day-first', '--help', '-h'], usage(), { requireOperand: true });
  const fail = (msg) => { console.error(`import-tracker: ${msg}`); process.exit(1); };
  const named = args.find((a) => !a.startsWith('-'));
  if (!named) fail('name the CSV file to import. See --help.');
  const dataRoot = getCareerOpsRoot();
  const file = isAbsolute(named) ? named : join(dataRoot, named);
  if (!existsSync(file)) fail(`no such file: ${file}`);

  const confirm = hasFlag(args, '--confirm');
  let trackerPath = resolveTrackerPath(dataRoot);
  let tracker = readTracker(trackerPath);
  if (!tracker.exists) trackerPath = resolveTrackerPathForWrite(dataRoot);

  let plan;
  try {
    plan = planImport(parseCsv(readFileSync(file, 'utf-8')), {
      states: loadCanonicalStates(STATES_FILE),
      trackerRows: tracker.rows,
      today: localToday(),
      dayFirst: hasFlag(args, '--day-first') ? true : undefined,
      source: basename(file),
    });
  } catch (err) {
    fail(err.message);
  }
  const toImport = plan.entries.filter((e) => e.outcome === 'import');
  const withUrl = toImport.some((e) => e.url);
  const urlColumn = tracker.exists ? tracker.colmap?.url != null : withUrl;
  printPreview(plan, { source: basename(file), confirm, urlColumn, trackerExists: tracker.exists });
  if (!confirm || !toImport.length) process.exit(0);

  if (!tracker.exists) {
    createTracker(trackerPath, withUrl);
    tracker = readTracker(trackerPath);
  }
  console.log('');
  process.exit(await writeImport(toImport, { colmap: tracker.colmap }));
}
