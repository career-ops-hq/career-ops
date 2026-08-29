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
 * sentinels `N/A` / `DUP` / `—` (em dash) / `-` (hyphen). Markdown bold is
 * stripped first. `—`/`-` mirror the tracker's own "no data" convention used
 * in every other column (Report, PDF, etc.) — see #1799: a backfilled entry
 * with no evaluation (e.g. a rejection for a role never run through
 * `oferta`) needs a score-cell sentinel too, not just `N/A`. A status label
 * never matches this, which is what makes it a reliable discriminator between
 * the score and status columns regardless of their order (#1427).
 */
export const SCORE_CELL_RE = /^\d+(?:\.\d+)?\/5$/;

/** @param {string} v @returns {boolean} whether the cell reads as a score. */
export function looksLikeScoreCell(v) {
  const t = String(v ?? '').replace(/\*\*/g, '').trim();
  return SCORE_CELL_RE.test(t) || t === 'N/A' || t === 'DUP' || t === '—' || t === '-';
}

/**
 * A markdown table separator row: `|---|------|...|`, optionally with alignment
 * colons.
 *
 * Readers used to recognize this row with `line.includes('---')`, which also
 * matched any DATA row whose free text happened to contain three hyphens — a
 * URL slug such as `Senior-Engineer---Platform-Team`, or an em dash typed
 * as `---`. Matching the row's structure instead cannot false-positive that way.
 */
export const SEPARATOR_ROW_RE = /^\|(?:\s*:?-+:?\s*\|)+\s*$/;

/** @param {string} line @returns {boolean} whether the line is the `|---|` separator row. */
export function isSeparatorRow(line) {
  return typeof line === 'string' && SEPARATOR_ROW_RE.test(line);
}

/** The columns a row must label before it counts as the tracker header. */
const REQUIRED_HEADER_FIELDS = ['num', 'company', 'role', 'score', 'status'];

/**
 * The ONE definition of "this row is the tracker header", shared by
 * `isHeaderRow` and `detectColumns`.
 *
 * A row qualifies only by labelling the whole schema — every field in
 * REQUIRED_HEADER_FIELDS. One telltale cell is not enough: a company genuinely
 * named "Company", or a note consisting of that single word, would otherwise be
 * read as table furniture and skip row-format validation, which is the same
 * class of false positive this module exists to stop.
 *
 * Extracted rather than duplicated (PR #2267 review): the two callers had
 * drifted, and a header they disagree about is one that validation skips as
 * furniture while column detection cannot parse — silently falling back to the
 * fixed legacy layout.
 *
 * @param {string[]} cells - Lowercased, trimmed cells from `line.split('|')`.
 * @returns {Object<string,number>|null} Field → column index, or null.
 */
function headerSchemaMap(cells) {
  // The alias table is the whole contract — no literal `company`/`role`
  // pre-filter. There used to be one, which meant a FULLY localized header
  // (`| # | Fecha | Empresa | Puesto | … |`) never reached the aliases that
  // exist for exactly that case, and the tracker silently fell back to
  // LEGACY_COLMAP. On a plain 9-column table the fallback lines up and nothing
  // looks wrong; insert the Location column from #946's own use case and the
  // Score cell is read from Location instead (#2274).
  //
  // Requiring the full schema is what makes the pre-filter unnecessary: a data
  // row would have to carry five different header labels in five different
  // cells to qualify, which no real row does.
  const map = {};
  cells.forEach((c, i) => { if (HEADER_ALIASES[c] != null) map[HEADER_ALIASES[c]] = i; });
  return REQUIRED_HEADER_FIELDS.every(k => map[k] != null) ? map : null;
}

/**
 * Whether a table row is the tracker's header row.
 *
 * @param {string} line - One line from applications.md.
 * @returns {boolean}
 */
export function isHeaderRow(line) {
  if (typeof line !== 'string' || !line.startsWith('|')) return false;
  return headerSchemaMap(line.split('|').map(s => s.trim().toLowerCase())) !== null;
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
    const map = headerSchemaMap(line.split('|').map(s => s.trim().toLowerCase()));
    if (map) return map;
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
  // Dynamic width guard: a complete row splits into leading '' + one cell per
  // column (+ trailing '' when the row ends with a pipe). Anything shorter is
  // missing a cell, and a missing INTERIOR cell shifts every later column one
  // left while the trailing empty cell keeps the count plausible — so require
  // the full width rather than mere coverage of the highest mapped index.
  // Hand-edited rows without the trailing pipe are one part narrower but
  // still complete (tracker-utils rebuildRow supports them).
  const width = Math.max(...Object.values(colmap)) + (line.trimEnd().endsWith('|') ? 2 : 1);
  if (parts.length < width) return null;
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
  if (colmap.via != null) row.via = at('via');
  return row;
}

/**
 * Extract report IDs referenced by one tracker Report cell.
 *
 * Both the numeric markdown label and the local report filename are returned.
 * Keeping both makes tracker drift visible instead of silently trusting one
 * side of a malformed link. External URLs are ignored even when their path
 * happens to contain a reports/ segment.
 *
 * @param {string} reportCell - Raw Report cell value.
 * @returns {number[]} Unique positive report IDs in encounter order.
 */
function markdownLinkDestination(raw) {
  const value = String(raw).trimStart();
  if (value.startsWith('<')) {
    for (let i = 1; i < value.length; i++) {
      if (value[i] === '\\') {
        i++;
      } else if (value[i] === '>') {
        return value.slice(1, i).replace(/\\([\\()<> ])/g, '$1');
      }
    }
    return null;
  }

  let depth = 0;
  let end = value.length;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') {
      i++;
      continue;
    }
    if (value[i] === '(') depth++;
    else if (value[i] === ')' && depth > 0) depth--;
    else if (/\s/.test(value[i]) && depth === 0) {
      end = i;
      break;
    }
  }
  const destination = value.slice(0, end).trim();
  return destination ? destination.replace(/\\([\\()<> ])/g, '$1') : null;
}

function parseMarkdownLinks(value) {
  const links = [];
  let cursor = 0;
  while (cursor < value.length) {
    const labelStart = value.indexOf('[', cursor);
    if (labelStart === -1) break;

    let labelEnd = -1;
    for (let i = labelStart + 1; i < value.length; i++) {
      if (value[i] === '\\') i++;
      else if (value[i] === ']') {
        labelEnd = i;
        break;
      }
    }
    if (labelEnd === -1 || value[labelEnd + 1] !== '(') {
      cursor = labelStart + 1;
      continue;
    }

    let depth = 1;
    let linkEnd = -1;
    for (let i = labelEnd + 2; i < value.length; i++) {
      if (value[i] === '\\') {
        i++;
      } else if (value[i] === '(') {
        depth++;
      } else if (value[i] === ')' && --depth === 0) {
        linkEnd = i;
        break;
      }
    }
    if (linkEnd === -1) {
      cursor = labelStart + 1;
      continue;
    }

    const target = markdownLinkDestination(value.slice(labelEnd + 2, linkEnd));
    if (target != null) links.push({ label: value.slice(labelStart + 1, labelEnd), target });
    cursor = linkEnd + 1;
  }
  return links;
}

export function extractTrackerReportNumbers(reportCell, notesCell = '') {
  const value = String(reportCell ?? '').trim();
  if (!value || value === '-' || value === '—') return scanNotesForReportNumbers(notesCell);

  const numbers = new Set();
  const numberFromTarget = (rawTarget) => {
    const target = String(rawTarget).trim().replace(/^<|>$/g, '');
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;
    const pathname = target.split(/[?#]/, 1)[0];
    const match = pathname.match(/(?:^|[\\/])reports[\\/]0*(\d+)-/i)
      || pathname.match(/(?:^|[\\/])0*(\d+)-[^\\/]*\.md$/i);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    return Number.isInteger(num) && num > 0 ? num : null;
  };

  const markdownLinks = parseMarkdownLinks(value);
  for (const link of markdownLinks) {
    const pathNum = numberFromTarget(link.target);
    if (pathNum == null) continue;
    const label = link.label.trim();
    if (/^\d+$/.test(label)) {
      const labelNum = parseInt(label, 10);
      if (labelNum > 0) numbers.add(labelNum);
    }
    numbers.add(pathNum);
  }

  if (markdownLinks.length === 0) {
    const pathNum = numberFromTarget(value);
    if (pathNum != null) numbers.add(pathNum);
  }
  // A layout with a Report column that simply has no link yet still falls back
  // to Notes, so a customized tracker behaves the same whether its Report cell
  // is absent or empty.
  return numbers.size > 0 ? [...numbers] : scanNotesForReportNumbers(notesCell);
}

/**
 * Report numbers named by a report link inside a free-form Notes cell.
 *
 * Customized trackers with no dedicated Report column embed the link in Notes
 * prose instead — the layout merge-tracker.mjs learned to read in 8668ac1, via
 * its own `extractReportNum(reportStr, notesStr)`. set-status.mjs read only the
 * Report cell, so `--report N` could not find a row merge-tracker had linked
 * happily (#3075).
 *
 * DELIBERATELY STRICTER than the Report-cell scan above, which is the same
 * scoping merge-tracker applies. The Report cell holds a report link by
 * contract, so a loose match there is safe; Notes is prose, and a link like
 * `[9](../notes/9-thing.md)` satisfies the generic `N-*.md` shape without being
 * a report at all. Requiring a `reports/` path segment is what keeps an
 * unrelated markdown link — or a job-posting URL in the same sentence — from
 * claiming to be a report number.
 *
 * @param {string} [notesCell] - Free-form Notes cell.
 * @returns {number[]} Report numbers, or [] when the cell names none.
 */
function scanNotesForReportNumbers(notesCell) {
  const notes = String(notesCell ?? '').trim();
  if (!notes) return [];
  const numbers = new Set();
  for (const link of parseMarkdownLinks(notes)) {
    const target = String(link.target).trim().replace(/^<|>$/g, '');
    // Absolute URLs are never a local report path, and a posting URL is the
    // most likely thing to sit next to a report link in the same note.
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    const pathname = target.split(/[?#]/, 1)[0];
    if (!/(?:^|[\\/])reports[\\/]/i.test(pathname)) continue;
    const match = pathname.match(/(?:^|[\\/])reports[\\/]0*(\d+)-/i);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    if (Number.isInteger(num) && num > 0) numbers.add(num);
  }
  return [...numbers];
}

/**
 * Unicode-aware key for Via (agency) comparison.
 *
 * normalizeCompany()-style keys strip everything outside [a-z0-9], so
 * non-Latin agency names (リクルート, パーソル, …) all collapse to the same
 * empty key — which made the #1596 cross-channel guard treat two different
 * agencies as one channel and silently merge two real submissions. Keep
 * letters and digits of any script instead; NFKC first so full-width/
 * half-width variants compare equal.
 *
 * Shared by every Via consumer (merge-tracker dedup guard, analyze-patterns
 * channel buckets) so agency identity can't drift between scripts.
 *
 * @param {string} name - Raw Via cell or via= tag value.
 * @returns {string} Case-folded, punctuation-free, script-preserving key.
 */
export function normalizeVia(name) {
  return normalizeTextKey(name);
}

/**
 * Unicode-aware grouping key for any free-text tracker/report field.
 *
 * Same rule as normalizeVia(), generalized because Via is not the only field
 * keyed this way: verify-pipeline groups tracker rows and report files by
 * company+role with the same [a-z0-9] strip, so for a non-Latin pipeline every
 * company keys to '' and every role keys to '' — three unrelated 株式会社X all
 * land in one "possible duplicates" cluster (#2393). Keep letters and digits of
 * any script; NFKC first so full-width/half-width variants compare equal.
 *
 * Combining marks are kept too (\p{M}): NFKC composes Latin diacritics into
 * single code points, but Indic matras have no precomposed form, so stripping
 * marks would make Devanagari कंपनी and कपनी — or क and का — the same key and
 * re-introduce the exact collision this function exists to prevent.
 *
 * This is the one key every grouping consumer should share, so company/role
 * identity cannot drift between scripts the way Via identity did.
 *
 * `separator` exists because not every consumer wants a solid key: scan.mjs
 * keys role titles as space-separated words so "engineer (senior)" and
 * "engineer, senior" collapse without "data engineer" and "dataengineer"
 * merging. Passing ' ' keeps that shape while sharing this exact rule, so a
 * second private [a-z0-9] strip never has to exist to get it.
 *
 * @param {string} value - Raw cell value (company, role, agency, slug, …).
 * @param {string} [separator=''] - Replacement for each run of stripped chars.
 *   Passed straight to String.replace, so `$` is special ('$&' would re-insert
 *   the stripped run). Callers should pass a literal such as '' or ' '.
 * @returns {string} Case-folded, punctuation-free, script-preserving key.
 */
export function normalizeTextKey(value, separator = '') {
  // `value ?? ''` rather than String(value): a null/undefined cell must key to
  // '' like any other empty field, not to the literal strings "null"/"undefined"
  // — which would compare equal to each other and form a bogus group.
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // Drop the combining dot that lowercasing a Turkish dotted capital leaves
    // behind. `'İ'.toLowerCase()` yields `i` + U+0307, not a plain `i`, so
    // `İstanbul Tekstil` and `Istanbul Tekstil` keyed differently while reading
    // identically on screen: the tracker treated one employer as two, and the
    // user had no way to see why (#2705, #2736, and verify-pipeline's duplicate
    // check, which returned a false green because of it).
    //
    // NO `NFD` here, and that is the whole safety property. NFKC leaves ż, ė
    // and ġ as SINGLE precomposed code points, so this strip cannot reach
    // their dots — while `i` + U+0307 has no precomposed form and stays
    // exposed. Decomposing first (NFD → strip → NFC) looks equivalent and is
    // not: it collapsed Żubr/Zubr, Ėmė/Eme and Ġenerali/Generali, which is
    // Polish, Lithuanian and Maltese losing the distinction (caught in main
    // by career-ops-ui, 12-ago). The protection is structural, not a list.
    .replace(/̇/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, separator)
    .trim();
}
