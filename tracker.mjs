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
 *   node tracker.mjs export [--out FILE]        # inverse: applications.db → canonical markdown (stdout by default)
 *   node tracker.mjs delete --num N [--dry-run] # remove one application row from applications.md + reindex
 *
 * query/history auto-resync when applications.md changed since the last sync,
 * so the index can never serve stale reads.
 */

import { readFileSync, copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, resolve, join } from 'path';
import { pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { resolveColumns } from './tracker-parse.mjs';
import {
  canonicalizeTrackerPath, openTrackerTransaction, writeFileAtomic,
} from './tracker-utils.mjs';

const MD_PATH = process.env.CAREER_OPS_TRACKER || 'data/applications.md';
const DB_PATH = process.env.CAREER_OPS_TRACKER_DB
  || (MD_PATH.endsWith('.md') ? MD_PATH.slice(0, -3) + '.db' : MD_PATH + '.db');

// SQLite must never open the source of truth itself (an explicit
// CAREER_OPS_TRACKER_DB could point both names at the same file).
if (resolve(MD_PATH) === resolve(DB_PATH)) {
  console.error(`Error: DB path must differ from the markdown path (${MD_PATH}).`);
  process.exit(1);
}
const STATES_PATH = 'templates/states.yml';
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEPARATOR = '|---|------|---------|------|-------|--------|-----|--------|-------|';

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

function openDb(DatabaseSync) {
  mkdirSync(dirname(DB_PATH) || '.', { recursive: true });
  const db = new DatabaseSync(DB_PATH);
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
      notes   TEXT NOT NULL DEFAULT ''
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
  return db;
}

// ── Canonical states (templates/states.yml is the source of truth) ──

function loadStates() {
  if (!existsSync(STATES_PATH)) {
    console.error(`Error: ${STATES_PATH} not found — cannot validate statuses. Run from the career-ops root.`);
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

// Mojibake left by a UTF-8 → GBK → UTF-8 round trip: an em-dash cell becomes
// "鈥?" / "鈥�" variants. Only short placeholder cells are repaired — free-text
// notes are preserved as-is rather than risk corrupting real content.
function repairPlaceholder(cell) {
  if (/^鈥.{0,2}$/.test(cell) || cell === '�') return '—';
  return cell;
}

// ── Markdown parsing ────────────────────────────────────────────────

function parseMarkdownRows(text, diag) {
  const lines = text.split('\n');
  // Map columns by header name (tracker-parse.mjs, #954) so a customized layout
  // (e.g. an inserted Location column) can't shift Score into Status. Falls back
  // to the legacy fixed 9-column layout when no header row is found.
  const colmap = resolveColumns(lines);
  // Expected `split('|')` width: highest mapped index + the trailing empty cell.
  const width = Math.max(...Object.values(colmap)) + 2;
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    let parts = t.split('|').map(c => c.trim());
    if (parts.length < 3) continue; // needs at least one real cell
    if ((parts[colmap.num] ?? '') === '#' || /^[-: ]*$/.test(parts.join(''))) continue; // header / separator
    if (parts.length > width && colmap.notes === width - 2) {
      // Stray pipes inside the trailing free-text column → fold back into notes.
      parts = [...parts.slice(0, colmap.notes), parts.slice(colmap.notes, parts.length - 1).join(' | '), ''];
      if (diag) diag.strayPipes++;
    }
    const at = (k) => (colmap[k] != null ? (parts[colmap[k]] ?? '') : '');
    rows.push([at('num'), at('date'), at('company'), at('role'), at('score'), at('status'), at('pdf'), at('report'), at('notes')]);
  }
  return rows;
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
  const colmap = resolveColumns(lines);
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
  const rows = parseMarkdownRows(readFileSync(MD_PATH, 'utf-8'), diag);

  const usedIds = new Set();
  let maxId = 0;
  const apps = [];

  for (const cells of rows) {
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

    let id = parseInt(idRaw, 10);
    if (!Number.isInteger(id) || id <= 0 || usedIds.has(id)) {
      id = 0; // assign after the pass, once maxId is known
      diag.badId++;
    } else {
      usedIds.add(id);
      if (id > maxId) maxId = id;
    }

    if (!DATE_RE.test(date)) diag.badDate++; // kept as-is — flagged, not destroyed

    apps.push({ id, pos: apps.length, date, company, role, score: score || '—', status, pdf: pdf || '❌', report: report || '—', notes });
  }
  for (const app of apps) if (app.id === 0) app.id = ++maxId;

  return { apps, diag };
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
  if (diag.badId) console.error(`  ${diag.badId} missing/duplicate id(s), reassigned in the index`);
  if (diag.badDate) console.error(`  ${diag.badDate} malformed date(s), kept as-is`);
  if (diag.strayPipes) console.error(`  ${diag.strayPipes} row(s) with stray pipes, folded into notes`);
  console.error('Fix at the source with `node normalize-statuses.mjs` / `node dedup-tracker.mjs`, then re-sync.');
  return total;
}

function syncIndex(db, states) {
  const { apps, diag } = parseTracker(states);
  const today = new Date().toISOString().slice(0, 10);

  db.exec('BEGIN');
  db.exec('PRAGMA defer_foreign_keys = ON'); // full rebuild — FKs settle at commit
  try {
    db.exec('DELETE FROM applications');
    const insertApp = db.prepare('INSERT INTO applications (id, pos, date, company, role, score, status, pdf, report, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const a of apps) insertApp.run(a.id, a.pos, a.date, a.company, a.role, a.score, a.status, a.pdf, a.report, a.notes);

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

    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('md_sha256', mdHash());
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
  console.error(`Indexed ${apps.length} applications from ${MD_PATH} into ${DB_PATH}`);
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
  if (synced && synced.value === mdHash()) return;
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

function rowToMarkdown(r) {
  const clean = (v) => String(v ?? '').replace(/\|/g, '│').replace(/\r?\n/g, ' ');
  return `| ${r.id} | ${clean(r.date)} | ${clean(r.company)} | ${clean(r.role)} | ${clean(r.score)} | ${clean(r.status)} | ${clean(r.pdf)} | ${clean(r.report)} | ${clean(r.notes)} |`;
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
  const id = flagValue(args, '--id');
  if (id) { where.push('id = ?'); params.push(parseInt(id, 10)); }

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
  const id = parseInt(flagValue(args, '--id') || '', 10);
  if (!Number.isInteger(id)) { console.error('Error: history requires --id N'); process.exit(1); }
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
  if (!app) { console.error(`Error: no application with id ${id}`); process.exit(1); }
  console.log(`#${app.id} ${app.company} — ${app.role}`);
  for (const e of db.prepare('SELECT status, date FROM status_events WHERE app_id = ? ORDER BY id').all(id)) {
    console.log(`  ${e.date}  ${e.status}`);
  }
}

// ── Export (index → canonical markdown) ─────────────────────────────
// The inverse of sync: regenerates the canonical table from the index. Used by
// the round-trip tests (md → db → md must be lossless for clean input), and as
// a repaired copy the user can review and adopt by hand. It never touches
// applications.md unless explicitly asked to via --out.

async function exportMd(args) {
  const outPath = flagValue(args, '--out');
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
    const out = [
      '# Applications Tracker',
      '',
      HEADER,
      SEPARATOR,
      ...rows.map(rowToMarkdown),
      '',
    ].join('\n');

    if (!outPath) {
      process.stdout.write(out);
      return;
    }
    mkdirSync(dirname(outPath) || '.', { recursive: true });
    // Never silently clobber — whatever was there is backed up first.
    const writeTarget = writesTracker ? trackerPath : outPath;
    if (existsSync(writeTarget)) {
      copyFileSync(writeTarget, writeTarget + '.bak');
      console.error(`Existing ${outPath} backed up to ${outPath}.bak`);
    }
    if (trackerTransaction) trackerTransaction.replace(out);
    else writeFileAtomic(outPath, out);
    console.error(`Exported ${rows.length} applications to ${outPath}`);
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

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
