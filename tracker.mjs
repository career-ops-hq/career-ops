#!/usr/bin/env node

/**
 * tracker.mjs — SQLite derived index for the applications tracker (RFC #918, phase 1).
 *
 * data/applications.md stays the source of truth. The SQLite DB is a derived
 * index, built and rebuilt from the markdown — safe to delete at any time, it
 * regenerates on the next sync. Tools and agents READ through the index for
 * schema-validated, model-independent results; all writes keep going to the
 * markdown exactly as today (merge-tracker.mjs, hand edits).
 *
 * Why: at hundreds of rows, a markdown table degrades structurally — encoding
 * corruption propagates, columns drift, a `|` inside a cell shifts every
 * column after it, and agents grepping the table get model-dependent results.
 * The index normalizes on sync (canonical statuses, repaired columns) so every
 * query returns the same rows for every model on every CLI, and corruption is
 * DETECTED at sync time instead of propagating silently.
 *
 * Phase 2 of #918 (DB becomes source of truth, markdown becomes a rendered
 * view) is a separate, explicit per-user opt-in — not implemented here.
 *
 * Zero new dependencies — uses node:sqlite (built into Node >= 22.5).
 *
 * Usage:
 *   node tracker.mjs sync [--check]             # (re)build applications.db from applications.md
 *                                               # --check: diagnose only, no write; exit 1 if issues found
 *   node tracker.mjs query [--status Applied] [--company acme] [--role designer]
 *                          [--since 2026-01-01] [--id N] [--limit 20] [--json]
 *   node tracker.mjs history --id N             # status transition log observed across syncs
 *   node tracker.mjs export [--out FILE] [--force]  # inverse: applications.db → markdown (stdout by default)
 *                                               # --force: write even when columns would be dropped
 *   node tracker.mjs delete --num N [--dry-run] # remove one application row from applications.md + reindex
 *
 * query/history auto-resync when applications.md changed since the last sync,
 * so the index can never serve stale reads.
 */

import { readFileSync, copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, resolve, join, basename } from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import * as yaml from 'js-yaml';
import {
  resolveColumns, detectColumns, isHeaderRow, isSeparatorRow, LEGACY_COLMAP,
} from './tracker-parse.mjs';
import {
  canonicalizeTrackerPath, openTrackerTransaction, writeFileAtomic,
} from './tracker-utils.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CAREER_OPS = getCareerOpsRoot();
const MD_PATH = resolveTrackerPath(CAREER_OPS);

/**
 * Where the derived SQLite index lives, resolved at call time.
 *
 * This used to be a module-scope `const`, which is the right shape for a CLI —
 * one process, one invocation, env fixed before node starts — and the wrong one
 * the moment the module is IMPORTED rather than executed. The first importer in
 * a process froze the path for every later one, so a subsequent
 * `process.env.CAREER_OPS_TRACKER_DB = ...` was silently ignored: no error, no
 * warning, and an assignment that reads as though it took effect.
 *
 * That is how the test suite came to create an applications.db outside its own
 * fixtures (#3506). tests/tracker-busy-timeout.test.mjs pins the variable before
 * importing this module, but test-all.mjs imports tracker.mjs earlier in the same
 * process for removeRowByNum, so module scope had already run and openDb() built
 * its schema at the unpinned path. The test passed either way — busy_timeout
 * reads back 5000 whichever file was opened — so nothing flagged it.
 *
 * Resolving per call costs nothing here (openDb is called once per command) and
 * makes the documented override mean the same thing to an importer as it does on
 * the command line.
 *
 * MD_PATH stays import-time on purpose: it is the source of truth, every writer
 * reaches it through openTrackerTransaction(MD_PATH), and a tracker path that
 * could change underneath an open transaction is a different and worse problem
 * than the one this solves.
 *
 * @returns {string} Absolute or relative path to the derived index.
 */
function dbPath() {
  const path = process.env.CAREER_OPS_TRACKER_DB
    || (MD_PATH.endsWith('.md') ? MD_PATH.slice(0, -3) + '.db' : MD_PATH + '.db');
  // SQLite must never open the source of truth itself (an explicit
  // CAREER_OPS_TRACKER_DB could point both names at the same file). Checked here
  // rather than at import: a module that exits the process as a side effect of
  // being imported takes its importer down with it, and the check is only
  // meaningful at the moment the path is actually used.
  if (resolve(MD_PATH) === resolve(path)) {
    console.error(`Error: DB path must differ from the markdown path (${MD_PATH}).`);
    process.exit(1);
  }
  return path;
}

// templates/states.yml ships with the code, so it is resolved from this module's
// own directory. It used to be a bare relative path, i.e. resolved against
// process.cwd(), which made every tracker.mjs command fail from anywhere but the
// repo root — including the shape the data-root mechanism invites, where you cd
// to your data directory and run the tool out of the checkout (#3508). Third
// variant of #3500: that one looked for this file under the data root, this one
// looked for it under whatever directory the shell happened to be in.
const CODEBASE_ROOT = dirname(fileURLToPath(import.meta.url));
const STATES_PATH = join(CODEBASE_ROOT, 'templates/states.yml');
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEPARATOR = '|---|------|---------|------|-------|--------|-----|--------|-------|';

// The nine fields the index stores as real columns, keyed by the field name
// tracker-parse.mjs's column map uses. Everything else a header declares
// (Location, Via, URL, a user's own column) is carried through the round-trip
// by POSITION in `applications.extras` instead of being widened into the
// schema — see the export section (#3703).
const SCHEMA_FIELDS = {
  num: 'id', date: 'date', company: 'company', role: 'role', score: 'score',
  status: 'status', pdf: 'pdf', report: 'report', notes: 'notes',
};

// Bumped whenever the derived index gains data an older sync did not record.
// ensureFresh() rebuilds on a mismatch, so a db written before `extras` and
// the stored header existed cannot serve an export that would silently drop
// the columns it never captured.
const SCHEMA_VERSION = '2';

// ── node:sqlite loading ─────────────────────────────────────────────

async function loadSqlite() {
  // node:sqlite is stable in behavior but still flagged experimental in some
  // Node lines — silence only that one warning, leave everything else alone.
  const origEmit = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const text = typeof warning === 'string' ? warning : warning?.message || '';
    if (text.includes('SQLite is an experimental feature')) return;
    return origEmit.call(process, warning, ...args);
  };
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return DatabaseSync;
  } catch {
    console.error('Error: node:sqlite is not available. tracker.mjs needs Node >= 22.5 (you are on ' + process.version + ').');
    console.error('The markdown tracker keeps working without it — the index is optional.');
    process.exit(1);
  } finally {
    process.emitWarning = origEmit; // the warning fires at import time — safe to restore here
  }
}

export function openDb(DatabaseSync) {
  const path = dbPath();
  mkdirSync(dirname(path) || '.', { recursive: true });
  const db = new DatabaseSync(path);
  // Wait up to 5s for a lock instead of throwing SQLITE_BUSY on the first
  // contention. The index is read by concurrent callers — a CLI query, a
  // `set-status` write and the Go TUI dashboard can all hit the same db at
  // once — and the default busy_timeout of 0 makes any overlap fail instantly.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON'); // SQLite ignores REFERENCES without this
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id      INTEGER PRIMARY KEY,
      pos     INTEGER NOT NULL,
      date    TEXT NOT NULL,
      company TEXT NOT NULL,
      role    TEXT NOT NULL,
      score   TEXT NOT NULL DEFAULT '—',
      status  TEXT NOT NULL,
      pdf     TEXT NOT NULL DEFAULT '❌',
      report  TEXT NOT NULL DEFAULT '—',
      notes   TEXT NOT NULL DEFAULT '',
      -- Cells of columns the schema has no field for, keyed by their index in
      -- the source row's split by pipe. JSON object, '{}' when the layout is
      -- the canonical nine columns.
      extras  TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS status_events (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES applications(id),
      status TEXT NOT NULL,
      date   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_apps_company ON applications(company);
    CREATE INDEX IF NOT EXISTS idx_events_app ON status_events(app_id);
  `);
  // CREATE TABLE IF NOT EXISTS leaves a db built by an older version alone, so
  // a column added after the fact has to be migrated in explicitly. Cheap and
  // idempotent; the rows are refilled by the next sync either way.
  const columns = db.prepare('PRAGMA table_info(applications)').all().map(c => c.name);
  if (!columns.includes('extras')) {
    db.exec("ALTER TABLE applications ADD COLUMN extras TEXT NOT NULL DEFAULT '{}'");
  }
  return db;
}

// ── Canonical states (templates/states.yml is the source of truth) ──

function loadStates() {
  if (!existsSync(STATES_PATH)) {
    // No longer "run from the career-ops root" advice: the path is anchored to
    // the module, so a miss here is a broken install, not a wrong cwd.
    console.error(`Error: ${STATES_PATH} not found — cannot validate statuses (broken install: templates/states.yml ships with career-ops).`);
    process.exit(1);
  }
  const doc = yaml.load(readFileSync(STATES_PATH, 'utf-8'));
  const byKey = new Map(); // lowercased label/alias → canonical label
  const labels = [];
  for (const s of doc?.states || []) {
    if (!s?.label) continue;
    labels.push(s.label);
    byKey.set(s.label.toLowerCase(), s.label);
    if (s.id) byKey.set(String(s.id).toLowerCase(), s.label);
    for (const alias of s.aliases || []) byKey.set(String(alias).toLowerCase(), s.label);
  }
  return { byKey, labels };
}

// Strip markdown bold, trailing dates, and surrounding noise, then resolve
// against canonical labels/aliases. Returns the canonical label or null.
function normalizeStatus(raw, states) {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/\*\*/g, '')
    .replace(/\(?\d{4}-\d{2}-\d{2}\)?/g, '')
    .trim()
    .toLowerCase();
  return states.byKey.get(cleaned) || null;
}

const SCORE_RE = /^\*{0,2}(\d+(?:\.\d+)?\/5)\*{0,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseApplicationId(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Mojibake left by a UTF-8 → GBK → UTF-8 round trip: an em-dash cell becomes
// "鈥?" / "鈥�" variants. Only short placeholder cells are repaired — free-text
// notes are preserved as-is rather than risk corrupting real content.
function repairPlaceholder(cell) {
  if (/^鈥.{0,2}$/.test(cell) || cell === '�') return '—';
  return cell;
}

// ── Markdown parsing ────────────────────────────────────────────────

/**
 * Locate the tracker's header and separator lines, and the labels they declare.
 *
 * Recorded so `export` can rebuild the table it READ rather than the table it
 * assumes. Before #3703 the read side mapped columns by name and the write side
 * emitted nine fixed ones, so a Location/Via/URL column survived every query and
 * vanished on export — silently, over the user's own tracker with `--out`.
 *
 * TWO detection passes, and the second one matters. `isHeaderRow` only fires
 * when the alias table resolves the FULL schema, so a header career-ops cannot
 * name — a Spanish `| # | Fecha | Empresa | Puesto | Puntuación | Estado | … |`,
 * where `puntuación` and `estado` are absent from tracker-aliases.json — records
 * no layout at all and exports as the English default (PR #3794 review). Falling
 * back to the markdown SHAPE (the line above the first separator row) records
 * the header verbatim whether or not its labels can be resolved; field placement
 * still comes from `detectColumns`/LEGACY_COLMAP, exactly as the read side does,
 * so an unresolvable header round-trips as text without ever being trusted as a
 * column map.
 *
 * @param {string[]} lines - All lines of the tracker markdown, pre-trimmed.
 * @returns {{header: string, separator: string|null, labels: string[],
 *   headerIndex: number, separatorIndex: number|null}|null}
 *   null when the file holds no table at all.
 */
function detectLayout(lines) {
  const at = (i) => {
    const separatorIndex = isSeparatorRow(lines[i + 1] ?? '') ? i + 1 : null;
    return {
      header: lines[i],
      separator: separatorIndex === null ? null : lines[separatorIndex],
      labels: headerLabels(lines[i]),
      headerIndex: i,
      separatorIndex,
    };
  };
  for (let i = 0; i < lines.length; i++) if (isHeaderRow(lines[i])) return at(i);
  for (let i = 1; i < lines.length; i++) {
    if (isSeparatorRow(lines[i]) && lines[i - 1].startsWith('|')) return at(i - 1);
  }
  return null;
}

/**
 * Column labels of a table row, in `split('|')` order minus the padding cells.
 * Index 0 of the returned array is column index 1, matching the column maps.
 *
 * @param {string} row - A trimmed markdown table row.
 * @returns {string[]}
 */
function headerLabels(row) {
  const parts = row.split('|').map(c => c.trim());
  const cells = parts.slice(1);
  if (cells.length && cells[cells.length - 1] === '' && row.endsWith('|')) cells.pop();
  return cells;
}

function parseMarkdownRows(text, diag) {
  // Line endings are part of the file, not of the table: splitting on '\n' and
  // joining the export back with '\n' silently rewrote a CRLF tracker to LF
  // (PR #3794 review). Remember the dominant ending and restore it on export.
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  // TWO views of the same file, and the split is deliberate.
  //
  // `lines` is trimmed and drives DETECTION and parsing: resolveColumns needs a
  // line that starts with '|' and detectLayout used to trim on its own, so an
  // indented table gave the legacy map on READ and the real map on WRITE —
  // cells landed a column off (Berlin in Role, Applied in PDF) on a layout the
  // reader had never accepted in the first place.
  //
  // `raw` keeps the file's own whitespace and drives what is REPLAYED. The
  // prologue and epilogue are prose the export copies rather than renders, so
  // trimming them dropped a user's indentation and trailing spaces — a quiet
  // edit, since nothing in the loss list could see it (PR #3794 review).
  const raw = text.split('\n').map(l => l.replace(/\r$/, ''));
  const lines = raw.map(l => l.trim());
  // Map columns by header name (tracker-parse.mjs, #954) so a customized layout
  // (e.g. an inserted Location column) can't shift Score into Status. Falls back
  // to the legacy fixed 9-column layout when no header row is found.
  const colmap = resolveColumns(lines);
  const layout = detectLayout(lines);
  // Expected `split('|')` width: leading empty cell + one per column + the
  // trailing empty cell. Taken from the HEADER when there is one, not from the
  // highest mapped index: a header whose last column is one no field claims
  // (a user's own `| … | Notes | Priority |`) makes every row look one cell too
  // wide, and the stray-pipe fold below then swallows that column into notes.
  const width = layout ? layout.labels.length + 2 : Math.max(...Object.values(colmap)) + 2;
  // Column indices the nine schema fields occupy; everything else in a row is
  // carried through the round-trip positionally (see SCHEMA_FIELDS).
  const schemaIndices = new Set(Object.keys(SCHEMA_FIELDS).map(k => colmap[k]).filter(i => i != null));
  const rows = [];
  // Every line index the rebuilt table accounts for: the header, the separator,
  // and each row that became an indexed application. What is left INSIDE the
  // table's span is content export cannot place (see collectStructure).
  const consumed = new Set();
  if (layout) {
    consumed.add(layout.headerIndex);
    if (layout.separatorIndex !== null) consumed.add(layout.separatorIndex);
  }
  // Where a SECOND table begins. Markdown cannot start one without a fresh
  // separator row, so that (or a second header row) is the precise signal —
  // blank lines and prose between rows do not change the columns and must not
  // trip it. Rows below that point were indexed against the FIRST table's
  // header, so a forced export re-emitted an archived row under the active
  // table's columns, inventing an empty URL cell for it (PR #3794 review).
  // They stay in the index; they are reported rather than rebuilt.
  let secondaryFrom = null;
  for (let index = 0; index < lines.length; index++) {
    const t = lines[index];
    if (!t.startsWith('|')) continue;
    let parts = t.split('|').map(c => c.trim());
    if (parts.length < 3) continue; // needs at least one real cell
    const isStructure = index === layout?.headerIndex || isHeaderRow(t) || isSeparatorRow(t);
    if (isStructure && layout && index > (layout.separatorIndex ?? layout.headerIndex)
        && secondaryFrom === null) {
      secondaryFrom = rows.length;
    }
    if (index === layout?.headerIndex) continue;
    if ((parts[colmap.num] ?? '') === '#' || isHeaderRow(t) || /^[-: ]*$/.test(parts.join(''))) continue; // header / separator
    if (parts.length > width && colmap.notes === width - 2) {
      // Stray pipes inside the trailing free-text column → fold back into notes.
      parts = [...parts.slice(0, colmap.notes), parts.slice(colmap.notes, parts.length - 1).join(' | '), ''];
      if (diag) diag.strayPipes++;
    }
    const at = (k) => (colmap[k] != null ? (parts[colmap[k]] ?? '') : '');
    // Last index holding a real cell: the trailing empty part only exists when
    // the row ends with a pipe — a hand-edited row without one ends in data.
    const lastCell = t.endsWith('|') ? parts.length - 2 : parts.length - 1;
    const extras = {};
    for (let i = 1; i <= lastCell; i++) {
      if (schemaIndices.has(i)) continue;
      if (parts[i]) extras[i] = parts[i]; // empty cells re-materialize as '' on export
    }
    consumed.add(index);
    rows.push({
      cells: [at('num'), at('date'), at('company'), at('role'), at('score'), at('status'), at('pdf'), at('report'), at('notes')],
      extras,
    });
  }
  return {
    rows,
    layout: layout && { ...layout, ...collectStructure(raw, consumed), eol, secondaryFrom },
  };
}

/**
 * Split the file around the table export rebuilds.
 *
 * `export` used to emit a fixed skeleton — the literal title `# Applications
 * Tracker`, the header, the separator, the rows — so `--out data/applications.md`
 * deleted a localized title, any legend or preamble, an `## Archive` section and
 * any trailing note, and the drop gate never saw it because it only counted
 * cells past the header width (PR #3794 review).
 *
 * Everything BEFORE the table and everything AFTER it is recorded verbatim and
 * replayed on export. Everything left INSIDE the table's span — a heading
 * between two tables, a second table's header and separator — is content the
 * rebuilt single table genuinely cannot hold: it is reported as a drop and
 * gated behind `--force`, rather than being replayed into a layout it does not
 * belong to (the second table's rows are indexed against the FIRST table's
 * columns, so re-emitting its structure would frame a shifted row as intact).
 *
 * @param {string[]} lines - RAW lines of the tracker (whitespace intact): these
 *   are replayed verbatim, not re-rendered.
 * @param {Set<number>} consumed - Line indices the rebuilt table reproduces.
 * @returns {{prologue: string[], epilogue: string[], interior: string[]}}
 */
function collectStructure(lines, consumed) {
  const indices = [...consumed].sort((a, b) => a - b);
  if (indices.length === 0) return { prologue: [], epilogue: [], interior: [] };
  const first = indices[0];
  const last = indices[indices.length - 1];
  // Blank lines count too. Excluding them would put a "silently dropped" line
  // back into a function written to end silent drops — the blank line that
  // separates a tracker from a section below it is exactly the kind of
  // structure a user notices missing.
  const interior = [];
  for (let i = first + 1; i < last; i++) if (!consumed.has(i)) interior.push(lines[i]);
  return { prologue: lines.slice(0, first), epilogue: lines.slice(last + 1), interior };
}

// Remove every table row whose first cell (the application number) equals `num`,
// preserving the rest of the file (header, separators, spacing, other rows)
// byte-for-byte. Pure: returns { removed, removedCount, report, newContent }.
// `report` is the report-column value of the first removed row, so callers can
// surface the now-orphaned report file. Numbers are unique in practice, but any
// duplicates are all removed.
export function removeRowByNum(content, num) {
  const target = String(num).trim();
  const lines = content.split('\n');
  // Header-aware report-column lookup (#954) — fixed index 7 read the wrong
  // cell on customized layouts (e.g. with a Location column).
  // Trimmed for detection, raw for output: resolveColumns needs a line that
  // starts with '|', so an indented table resolved to the legacy map here while
  // the filter below matched on the trimmed line — the read/write split fixed in
  // parseMarkdownRows (PR #3794 review). Lines are still emitted byte-for-byte.
  const colmap = resolveColumns(lines.map(l => l.trim()));
  let removedCount = 0;
  let report = null;
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t.startsWith('|')) return true; // non-table line — keep verbatim
    const parts = t.split('|').map((c) => c.trim());
    const numCell = parts[colmap.num] ?? '';
    if (numCell === '#' || /^[-: ]*$/.test(parts.join(''))) return true; // header / separator
    if (numCell === target) {
      removedCount++;
      if (report === null) report = (colmap.report != null ? parts[colmap.report] : '') || null;
      return false;
    }
    return true;
  });
  return { removed: removedCount > 0, removedCount, report, newContent: kept.join('\n') };
}

// Parse + normalize the markdown into index-ready rows. The markdown itself is
// never modified — normalization lives only in the derived index, and the
// diagnostics tell the user what to fix at the source (normalize-statuses.mjs,
// dedup-tracker.mjs).
function parseTracker(states) {
  const diag = { mojibake: 0, scoreInStatus: 0, unknownStatus: 0, badId: 0, badDate: 0, strayPipes: 0 };
  const { rows, layout } = parseMarkdownRows(readFileSync(MD_PATH, 'utf-8'), diag);

  const usedIds = new Set();
  let maxId = 0;
  const apps = [];

  for (const { cells, extras } of rows) {
    let [idRaw, date, company, role, score, status, pdf, report, notes] = cells;

    const before = [score, pdf, report].join('|');
    score = repairPlaceholder(score);
    pdf = repairPlaceholder(pdf);
    report = repairPlaceholder(report);
    if ([score, pdf, report].join('|') !== before) diag.mojibake++;

    // Score sitting in the status column (column drift)
    const scoreInStatus = status.match(SCORE_RE);
    if (scoreInStatus) {
      if (!SCORE_RE.test(score)) score = scoreInStatus[1];
      status = 'Evaluated';
      diag.scoreInStatus++;
    }

    const canonical = normalizeStatus(status, states);
    if (!canonical) {
      notes = notes ? `${notes} [sync: original status "${status}"]` : `[sync: original status "${status}"]`;
      status = 'Evaluated';
      diag.unknownStatus++;
    } else {
      status = canonical;
    }

    let id = parseApplicationId(idRaw);
    if (id === null || usedIds.has(id)) {
      id = 0; // assign after the pass, once maxId is known
      diag.badId++;
    } else {
      usedIds.add(id);
      if (id > maxId) maxId = id;
    }

    if (!DATE_RE.test(date)) diag.badDate++; // kept as-is — flagged, not destroyed

    apps.push({
      id, pos: apps.length, date, company, role, score: score || '—', status,
      pdf: pdf || '❌', report: report || '—', notes, extras: JSON.stringify(extras),
    });
  }
  for (const app of apps) if (app.id === 0) app.id = ++maxId;

  return { apps, diag, layout };
}

function mdHash() {
  return createHash('sha256').update(readFileSync(MD_PATH)).digest('hex');
}

// ── Sync (markdown → derived index) ─────────────────────────────────

function reportDiagnostics(diag) {
  const total = Object.values(diag).reduce((a, b) => a + b, 0);
  if (total === 0) {
    console.error('No corruption detected — index matches the markdown cleanly.');
    return 0;
  }
  console.error(`Corruption detected in ${MD_PATH} (normalized in the index only — the markdown is untouched):`);
  if (diag.mojibake) console.error(`  ${diag.mojibake} mojibake placeholder cell(s)`);
  if (diag.scoreInStatus) console.error(`  ${diag.scoreInStatus} score(s) sitting in the status column`);
  if (diag.unknownStatus) console.error(`  ${diag.unknownStatus} non-canonical status(es), indexed as Evaluated (original kept in notes)`);
  if (diag.badId) console.error(`  ${diag.badId} missing/malformed/duplicate id(s), reassigned in the index`);
  if (diag.badDate) console.error(`  ${diag.badDate} malformed date(s), kept as-is`);
  if (diag.strayPipes) console.error(`  ${diag.strayPipes} row(s) with stray pipes, folded into notes`);
  console.error('Fix at the source with `node normalize-statuses.mjs` / `node dedup-tracker.mjs`, then re-sync.');
  return total;
}

function syncIndex(db, states) {
  const { apps, diag, layout } = parseTracker(states);
  const today = new Date().toISOString().slice(0, 10);

  db.exec('BEGIN');
  db.exec('PRAGMA defer_foreign_keys = ON'); // full rebuild — FKs settle at commit
  try {
    db.exec('DELETE FROM applications');
    const insertApp = db.prepare('INSERT INTO applications (id, pos, date, company, role, score, status, pdf, report, notes, extras) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const a of apps) insertApp.run(a.id, a.pos, a.date, a.company, a.role, a.score, a.status, a.pdf, a.report, a.notes, a.extras);

    // Status history: events persist across rebuilds, keyed by id. An app whose
    // status changed since the last sync gets a new event; rows that left the
    // markdown lose their events (the index never outlives its source).
    db.exec('DELETE FROM status_events WHERE app_id NOT IN (SELECT id FROM applications)');
    const latestEvent = db.prepare('SELECT status FROM status_events WHERE app_id = ? ORDER BY id DESC LIMIT 1');
    const insertEvent = db.prepare('INSERT INTO status_events (app_id, status, date) VALUES (?, ?, ?)');
    for (const a of apps) {
      const last = latestEvent.get(a.id);
      if (!last) insertEvent.run(a.id, a.status, DATE_RE.test(a.date) ? a.date : today);
      else if (last.status !== a.status) insertEvent.run(a.id, a.status, today);
    }

    const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    setMeta.run('md_sha256', mdHash());
    setMeta.run('schema_version', SCHEMA_VERSION);
    // The source layout, so export rebuilds this FILE rather than the default
    // skeleton: the header and separator it read, the lines around the table,
    // the lines inside it that no rebuilt table can hold, and the line ending.
    // Empty strings mean "no table in the source", which exports as the
    // canonical nine columns under the default title.
    setMeta.run('md_header', layout?.header ?? '');
    setMeta.run('md_separator', layout?.separator ?? '');
    setMeta.run('md_prologue', JSON.stringify(layout?.prologue ?? []));
    setMeta.run('md_epilogue', JSON.stringify(layout?.epilogue ?? []));
    setMeta.run('md_interior', JSON.stringify(layout?.interior ?? []));
    setMeta.run('md_eol', layout?.eol ?? '\n');
    // pos of the first indexed row that belongs to a LATER table, or '' when
    // every row belongs to the one export rebuilds.
    setMeta.run('md_secondary_from', layout?.secondaryFrom == null ? '' : String(layout.secondaryFrom));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { apps, diag };
}

async function sync(args) {
  if (!existsSync(MD_PATH)) {
    console.error(`Error: ${MD_PATH} not found — nothing to index.`);
    process.exit(1);
  }
  const states = loadStates();

  if (args.includes('--check')) {
    const { apps, diag } = parseTracker(states);
    console.error(`Parsed ${apps.length} data rows from ${MD_PATH}`);
    const issues = reportDiagnostics(diag);
    console.error('(--check — no index written)');
    process.exit(issues > 0 ? 1 : 0);
  }

  const DatabaseSync = await loadSqlite();
  const db = openDb(DatabaseSync);
  const { apps, diag } = syncIndex(db, states);
  console.error(`Indexed ${apps.length} applications from ${MD_PATH} into ${dbPath()}`);
  reportDiagnostics(diag);
}

// query/history must never serve stale reads: if the markdown changed since
// the last sync (or was never synced), rebuild the index first.
function ensureFresh(db, states) {
  if (!existsSync(MD_PATH)) {
    console.error(`Error: ${MD_PATH} not found — the index has no source of truth to read from.`);
    process.exit(1);
  }
  const synced = db.prepare('SELECT value FROM meta WHERE key = ?').get('md_sha256');
  // The schema version is part of freshness, not just the content hash: a db
  // written before `extras`/`md_header` existed matches the hash while missing
  // the columns an export needs, which is exactly the silent drop #3703 is
  // about. A version mismatch forces the rebuild that fills them in.
  const version = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
  if (synced && synced.value === mdHash() && version?.value === SCHEMA_VERSION) return;
  console.error(`(index stale — resyncing from ${MD_PATH})`);
  syncIndex(db, states);
}

// ── Query helpers ───────────────────────────────────────────────────

function flagValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] !== undefined && !args[idx + 1].startsWith('--')) return args[idx + 1];
  const kv = args.find(a => a.startsWith(flag + '='));
  return kv ? kv.split('=').slice(1).join('=') : null;
}

// A pipe inside a cell would split the row; a newline would end it.
const cleanCell = (v) => String(v ?? '').replace(/\|/g, '│').replace(/\r?\n/g, ' ');

function rowToMarkdown(r) {
  return `| ${r.id} | ${cleanCell(r.date)} | ${cleanCell(r.company)} | ${cleanCell(r.role)} | ${cleanCell(r.score)} | ${cleanCell(r.status)} | ${cleanCell(r.pdf)} | ${cleanCell(r.report)} | ${cleanCell(r.notes)} |`;
}

async function query(args) {
  const DatabaseSync = await loadSqlite();
  const db = openDb(DatabaseSync);
  const states = loadStates();
  ensureFresh(db, states);

  const where = [];
  const params = [];
  const status = flagValue(args, '--status');
  if (status) {
    const canonical = normalizeStatus(status, states);
    if (!canonical) { console.error(`Error: unknown status "${status}". Canonical: ${states.labels.join(', ')}`); process.exit(1); }
    where.push('status = ?'); params.push(canonical);
  }
  const company = flagValue(args, '--company');
  if (company) { where.push('company LIKE ?'); params.push(`%${company}%`); }
  const role = flagValue(args, '--role');
  if (role) { where.push('role LIKE ?'); params.push(`%${role}%`); }
  const since = flagValue(args, '--since');
  if (since) {
    if (!DATE_RE.test(since)) { console.error('Error: --since must be YYYY-MM-DD'); process.exit(1); }
    where.push('date >= ?'); params.push(since);
  }
  const idRaw = flagValue(args, '--id');
  if (args.some(arg => arg === '--id' || arg.startsWith('--id='))) {
    const id = parseApplicationId(idRaw);
    if (id === null) { console.error('Error: --id must be a positive integer'); process.exit(1); }
    where.push('id = ?'); params.push(id);
  }

  let sql = 'SELECT id, date, company, role, score, status, pdf, report, notes FROM applications'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC';
  const limit = parseInt(flagValue(args, '--limit') || '0', 10);
  if (limit > 0) { sql += ' LIMIT ?'; params.push(limit); }

  const rows = db.prepare(sql).all(...params);
  if (args.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(HEADER);
    console.log(SEPARATOR);
    for (const r of rows) console.log(rowToMarkdown(r));
    console.error(`\n${rows.length} row(s)`); // stderr so stdout stays pipeable
  }
}

async function history(args) {
  const DatabaseSync = await loadSqlite();
  const db = openDb(DatabaseSync);
  ensureFresh(db, loadStates());
  const id = parseApplicationId(flagValue(args, '--id'));
  if (id === null) { console.error('Error: history requires --id N (a positive integer)'); process.exit(1); }
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
  if (!app) { console.error(`Error: no application with id ${id}`); process.exit(1); }
  console.log(`#${app.id} ${app.company} — ${app.role}`);
  for (const e of db.prepare('SELECT status, date FROM status_events WHERE app_id = ? ORDER BY id').all(id)) {
    console.log(`  ${e.date}  ${e.status}`);
  }
}

// ── Export (index → canonical markdown) ─────────────────────────────
// The inverse of sync: regenerates the table from the index. Used by the
// round-trip tests (md → db → md must be lossless), and as a repaired copy the
// user can review and adopt by hand. It never touches applications.md unless
// explicitly asked to via --out.
//
// "Lossless" means the LAYOUT too, not only the values (#3703). The read side
// maps columns by header name, so a tracker with Location/Via/URL — or a user's
// own column — indexes perfectly; the write side used to emit nine fixed
// columns in a fixed order, so adopting the export cost the user those columns
// with no warning, and `sync` had just said the index matched cleanly. Export
// now rebuilds the header it read and re-materializes unmapped cells from
// `applications.extras` by position, and refuses to write over an existing
// tracker at all when something genuinely cannot be placed.

/** @param {string} raw - the `extras` JSON column. @returns {Object<number,string>} */
function parseExtras(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // a hand-corrupted index cell must not abort the export
  }
}

/**
 * Rebuild the markdown table from indexed rows and the recorded source layout.
 *
 * @param {object[]} rows - `applications` rows, ordered by pos.
 * @param {{header: string, separator: string}} layout - Recorded source layout;
 *   empty header means the source had no header row (legacy positional table).
 * @returns {{header: string, separator: string, body: string[], dropped: string[]}}
 *   `dropped` names every column carrying content this export cannot place —
 *   empty for every layout career-ops can reproduce.
 */
/**
 * The recorded source layout, decoded from `meta` with safe defaults.
 *
 * An index written before these keys existed (or one whose meta was edited by
 * hand) yields the canonical skeleton, which is what the export emitted for
 * every tracker before #3703.
 *
 * @param {Object<string,string>} meta - The `meta` table as a plain object.
 * @returns {{header: string, separator: string, prologue: string[],
 *   epilogue: string[], interior: string[], eol: string}}
 */
function readLayout(meta) {
  const list = (raw, fallback) => {
    try {
      const parsed = JSON.parse(raw ?? '');
      return Array.isArray(parsed) ? parsed.map(String) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    header: meta.md_header || '',
    separator: meta.md_separator || '',
    prologue: list(meta.md_prologue, ['# Applications Tracker', '']),
    epilogue: list(meta.md_epilogue, ['']),
    interior: list(meta.md_interior, []),
    eol: meta.md_eol === '\r\n' ? '\r\n' : '\n',
    secondaryFrom: /^\d+$/.test(meta.md_secondary_from ?? '') ? Number(meta.md_secondary_from) : null,
  };
}

function renderTable(rows, layout) {
  const header = layout.header || HEADER;
  const labels = layout.header ? headerLabels(layout.header) : headerLabels(HEADER);
  const colmap = (layout.header ? detectColumns([layout.header]) : null) || LEGACY_COLMAP;

  // Column index → the indexed field that owns it. Everything else is filled
  // from the row's extras, so a Location/Via/URL/custom column comes back in
  // its own place with its own value.
  const fieldAt = new Map();
  for (const [field, dbField] of Object.entries(SCHEMA_FIELDS)) {
    if (colmap[field] != null) fieldAt.set(colmap[field], dbField);
  }

  const width = labels.length;
  const unplaceable = new Set();
  const sanitized = [];
  const body = rows.map((r) => {
    const extras = parseExtras(r.extras);
    for (const key of Object.keys(extras)) {
      if (Number(key) > width) unplaceable.add(Number(key));
    }
    const cells = [];
    for (let i = 1; i <= width; i++) {
      const field = fieldAt.get(i);
      const value = field ? r[field] : extras[i] ?? '';
      const rendered = cleanCell(value);
      // A cell that had to be rewritten to survive as a table cell — a stray
      // pipe folded into notes comes back as '│'. The VALUE changed, so a
      // silent `--out` would edit the tracker; it belongs in the loss list
      // like any other thing export cannot reproduce (PR #3794 review).
      if (rendered !== String(value ?? '')) {
        sanitized.push(`row #${r.id}, column ${i}${labels[i - 1] ? ` (${labels[i - 1]})` : ''}: "${value}" → "${rendered}"`);
      }
      cells.push(rendered);
    }
    return `| ${cells.join(' | ')} |`;
  });

  const separator = layout.separator
    || (layout.header
      ? `|${labels.map(l => '-'.repeat(Math.max(3, l.length + 2))).join('|')}|`
      : SEPARATOR);

  const dropped = [
    ...[...unplaceable].sort((a, b) => a - b)
      .map(i => `column ${i}${labels[i - 1] ? ` (${labels[i - 1]})` : ''}`),
    ...sanitized,
  ];
  return { header, separator, body, dropped };
}

async function exportMd(args) {
  const outPath = flagValue(args, '--out');
  const force = args.includes('--force');
  if (outPath && existsSync(outPath) && statSync(outPath).isDirectory()) {
    console.error(`Error: --out ${outPath} is a directory — pass a file path.`);
    process.exit(1);
  }

  const trackerPath = canonicalizeTrackerPath(MD_PATH);
  const writesTracker = outPath
    ? canonicalizeTrackerPath(outPath) === trackerPath
    : false;
  const trackerTransaction = writesTracker
    ? await openTrackerTransaction(trackerPath)
    : null;

  try {
    const DatabaseSync = await loadSqlite();
    const db = openDb(DatabaseSync);
    ensureFresh(db, loadStates());
    const rows = db.prepare('SELECT * FROM applications ORDER BY pos').all();
    const meta = db.prepare('SELECT key, value FROM meta').all()
      .reduce((acc, m) => Object.assign(acc, { [m.key]: m.value }), {});
    const layout = readLayout(meta);
    // Rows below a second table's header were indexed against the FIRST
    // table's columns, so rebuilding them here would move archived data into
    // the active table under a header it never had. They are named instead.
    const primary = layout.secondaryFrom == null ? rows : rows.slice(0, layout.secondaryFrom);
    const secondary = layout.secondaryFrom == null ? [] : rows.slice(layout.secondaryFrom);
    const { header, separator, body, dropped } = renderTable(primary, layout);
    // The lines around the table are replayed verbatim; the ones inside it that
    // no single rebuilt table can hold are reported instead, never invented.
    const out = [...layout.prologue, header, separator, ...body, ...layout.epilogue]
      .join(layout.eol);

    const losses = [
      ...dropped,
      ...layout.interior.map(line => `line between table rows: ${line === '' ? '(blank)' : `"${line}"`}`),
      ...secondary.map(r => `row #${r.id} (${r.company} — ${r.role}) belongs to a later table; the rebuilt one has no place for it`),
    ];
    // Never lose anything quietly. Worth reporting even though the rebuild above
    // leaves `losses` empty for every file career-ops itself produces: it is
    // what turns data loss into a decision the user makes.
    if (losses.length) {
      console.error(`Warning: ${losses.length} item(s) in ${MD_PATH} cannot be reproduced by export and will be dropped:`);
      for (const d of losses) console.error(`  ${d}`);
      console.error('Cells outside the declared header, and content between the first and last table row, have nowhere to go in a single rebuilt table.');
    }

    if (!outPath) {
      process.stdout.write(out);
      return;
    }
    mkdirSync(dirname(outPath) || '.', { recursive: true });
    const writeTarget = writesTracker ? trackerPath : outPath;
    // Overwriting an existing file with a table known to be missing columns is
    // the failure mode of #3703 — the .bak below makes it recoverable, but only
    // for a user who was told there was something to recover.
    if (losses.length && existsSync(writeTarget) && !force) {
      console.error(`Refusing to overwrite ${outPath} — that would drop the item(s) listed above.`);
      console.error('Re-run with --force if you have read the list and want the export anyway.');
      // exitCode + return, never process.exit(): exiting here would skip the
      // finally below and leave the tracker lock dir held until it goes stale.
      process.exitCode = 1;
      return;
    }
    // Never silently clobber — whatever was there is backed up first.
    if (existsSync(writeTarget)) {
      copyFileSync(writeTarget, writeTarget + '.bak');
      console.error(`Existing ${outPath} backed up to ${outPath}.bak`);
    }
    if (trackerTransaction) trackerTransaction.replace(out);
    else writeFileAtomic(outPath, out);
    console.error(`Exported ${body.length} applications to ${outPath}`);
  } finally {
    trackerTransaction?.close();
  }
}

// ── Main ────────────────────────────────────────────────────────────

// `delete --num N` removes one application row from applications.md and rebuilds
// the derived index. The markdown stays the source of truth: callers (incl. the
// web) orchestrate this script rather than editing applications.md directly.
// The read and atomic replacement share merge-tracker's cross-process lock.
async function deleteApp(args) {
  const num = flagValue(args, '--num');
  if (!num) {
    console.error('Usage: node tracker.mjs delete --num <N> [--dry-run]   (remove one application row by its number)');
    process.exit(1);
  }
  if (!existsSync(MD_PATH)) {
    console.error(`Error: ${MD_PATH} not found — nothing to delete.`);
    process.exit(1);
  }
  if (args.includes('--dry-run')) {
    const { removed, removedCount, report } = removeRowByNum(readFileSync(MD_PATH, 'utf-8'), num);
    if (!removed) {
      console.error(`No application numbered ${num} in ${MD_PATH}.`);
      process.exit(1);
    }
    console.error(`Would remove application ${num} (${removedCount} row${removedCount > 1 ? 's' : ''}) from ${MD_PATH}.`);
    if (report) console.error(`(report file would be orphaned: ${report})`);
    return;
  }

  const trackerTransaction = await openTrackerTransaction(MD_PATH);

  let removal;
  try {
    removal = removeRowByNum(trackerTransaction.read(), num);
    if (!removal.removed) {
      console.error(`No application numbered ${num} in ${MD_PATH}.`);
      process.exitCode = 1;
      return;
    }
    trackerTransaction.replace(removal.newContent);
  } finally {
    trackerTransaction.close();
  }

  const { removedCount, report } = removal;
  // Rebuild the derived SQLite index from the now-updated markdown.
  try {
    const states = loadStates();
    const DatabaseSync = await loadSqlite();
    const db = openDb(DatabaseSync);
    syncIndex(db, states);
  } catch (e) {
    console.error(`(row removed; index resync skipped: ${e.message})`);
  }
  console.error(`Removed application ${num} (${removedCount} row${removedCount > 1 ? 's' : ''}) from ${MD_PATH} and reindexed.`);
  if (report) console.error(`Note: report file may now be orphaned — ${report}`);
}

const COMMANDS = { sync, query, history, export: exportMd, delete: deleteApp };

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const fn = COMMANDS[command];
  if (!fn) {
    console.log('Usage: node tracker.mjs <sync|query|history|export|delete> [flags]');
    console.log('See the header comment of this file for examples, or docs/SCRIPTS.md.');
    process.exit(command ? 1 : 0);
  }
  await fn(args);
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
