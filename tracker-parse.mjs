/**
 * tracker-parse.mjs — shared header-aware column mapping for `data/applications.md`.
 *
 * The tracker is a markdown table that several scripts read. #946/#954 made the
 * column layout customizable (e.g. an inserted Location column) by mapping
 * columns *by header name* instead of fixed position — but that logic only
 * lived in `merge-tracker.mjs`. This module is the single home for it, so every
 * reader (merge-tracker, dedup-tracker, followup-cadence, analyze-patterns)
 * tolerates the same layouts and can't drift apart.
 *
 * Indexing matches `line.split('|')`: index 0 is the empty cell before the
 * leading pipe, so the first real column ("#"/num) is index 1.
 */

import { readFileSync } from 'fs';

/** The original fixed 9-column layout (num … notes at indices 1 … 9). */
export const LEGACY_COLMAP = {
  num: 1, date: 2, company: 3, role: 4, score: 5, status: 6, pdf: 7, report: 8, notes: 9,
};

/**
 * Header text (lowercased) → canonical field name. Includes ES aliases.
 * Loaded from tracker-aliases.json — the ONE shared alias table, which the web
 * read path (web/src/lib/tracker-table.mjs) also loads at runtime, so the two
 * can never drift (PR #1598 review). Add new aliases in the JSON, not here.
 *
 * A missing or corrupt JSON is a broken install (the file ships alongside this
 * module in SYSTEM_PATHS/BOOTSTRAP_PATHS): fail fast with an actionable
 * message rather than degrading silently — a quiet fallback here would
 * reintroduce exactly the reader drift the shared table exists to prevent.
 * (The web loader degrades to the legacy fixed order instead because it reads
 * the file from a user-configured root at request time.)
 */
export const HEADER_ALIASES = (() => {
  const src = new URL('./tracker-aliases.json', import.meta.url);
  try {
    return JSON.parse(readFileSync(src, 'utf-8'));
  } catch (e) {
    throw new Error(
      `tracker-parse.mjs: cannot load tracker-aliases.json (${e.message}). ` +
      'The file ships with career-ops next to tracker-parse.mjs — restore it ' +
      'from the repo or re-run: node update-system.mjs apply',
    );
  }
})();

/**
 * A score cell in the tracker: `N/5` or `N.N/5` (any precision), or the
 * sentinels `N/A` / `DUP`. Markdown bold is stripped first. A status label
 * never matches this, which is what makes it a reliable discriminator between
 * the score and status columns regardless of their order (#1427).
 */
export const SCORE_CELL_RE = /^\d+(?:\.\d+)?\/5$/;

/** @param {string} v @returns {boolean} whether the cell reads as a score. */
export function looksLikeScoreCell(v) {
  const t = String(v ?? '').replace(/\*\*/g, '').trim();
  return SCORE_CELL_RE.test(t) || t === 'N/A' || t === 'DUP';
}

/**
 * Given the two adjacent cells that carry score and status in EITHER order,
 * identify which is which by content — the score cell is recognizable by
 * pattern (`looksLikeScoreCell`), statuses never are. This lets TSV ingestion
 * tolerate the two known column orders (batch TSV writes status-then-score;
 * `applications.md` is score-then-status) instead of trusting position.
 *
 * Returns null when the order is undecidable — neither cell, or BOTH cells, look
 * like a score — so callers can fail loudly rather than merge a silent swap.
 *
 * @param {string} a - first of the two cells
 * @param {string} b - second of the two cells
 * @returns {{score: string, status: string}|null}
 */
export function resolveScoreStatus(a, b) {
  const aScore = looksLikeScoreCell(a);
  const bScore = looksLikeScoreCell(b);
  if (aScore === bScore) return null; // ambiguous: neither, or both
  return aScore ? { score: a, status: b } : { score: b, status: a };
}

/**
 * Scan the table for a header row and build a field-name → column-index map.
 * Indexing matches `line.split('|')`. Returns null — caller should fall back to
 * LEGACY_COLMAP — unless the essential columns are all present, so a stray pipe
 * line can't yield a bogus mapping.
 *
 * @param {string[]} lines - All lines of applications.md.
 * @returns {Object<string,number>|null}
 */
export function detectColumns(lines) {
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(s => s.trim().toLowerCase());
    if (!cells.includes('company') || !cells.includes('role')) continue;
    const map = {};
    cells.forEach((c, i) => { if (HEADER_ALIASES[c] != null) map[HEADER_ALIASES[c]] = i; });
    if (['num', 'company', 'role', 'score', 'status'].every(k => map[k] != null)) return map;
  }
  return null;
}

/**
 * Convenience: detect the header layout, falling back to the legacy fixed one.
 * @param {string[]} lines
 * @returns {Object<string,number>}
 */
export function resolveColumns(lines) {
  return detectColumns(lines) || LEGACY_COLMAP;
}

/**
 * Parse one markdown table row into a tracker object using a column map.
 *
 * Header and separator rows (non-numeric `num` cell) and malformed rows return
 * null. The raw line is preserved so callers can locate/replace the exact line.
 *
 * @param {string} line - One line from applications.md.
 * @param {Object<string,number>} [colmap] - From resolveColumns(); defaults to legacy.
 * @returns {object|null} `{num,date,company,role,score,status,pdf,report,notes,location?,raw}`.
 */
export function parseTrackerRow(line, colmap = LEGACY_COLMAP) {
  if (typeof line !== 'string' || !line.startsWith('|')) return null;
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 9) return null;
  const num = parseInt(parts[colmap.num], 10);
  if (isNaN(num)) return null;
  const at = (k) => (colmap[k] != null ? (parts[colmap[k]] ?? '') : '');
  const row = {
    num,
    date: at('date'),
    company: at('company'),
    role: at('role'),
    score: at('score'),
    status: at('status'),
    pdf: at('pdf'),
    report: at('report'),
    notes: at('notes'),
    raw: line,
  };
  if (colmap.location != null) row.location = at('location');
  return row;
}
