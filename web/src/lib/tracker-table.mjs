/**
 * tracker-table.mjs — header-aware parsing of the `data/applications.md` table
 * for the web read path.
 *
 * The header-alias table is NOT mirrored here: it is loaded at runtime from
 * `tracker-aliases.json` in the career-ops root — the same single source
 * tracker-parse.mjs exports as HEADER_ALIASES — so the web reader and the Node
 * tracker tooling can never drift (PR #1598 review). A build-time import of the
 * core module is impossible: Turbopack's root is pinned to web/ (see
 * next.config.mjs) and refuses modules outside it, so the shared source is a
 * JSON file read with fs, like every other career-ops file this app consumes.
 *
 * Plain .mjs (same pattern as clean-chips.mjs) so tests/tracker-columns.test.mjs can
 * import it directly under Node and regression-test the REAL alias chain.
 */
import fs from "node:fs";
import path from "node:path";
import { readTrackerUrl } from "./posting-url.mjs";

/**
 * Canonical tracker-parse field name → web Application field. The web type
 * names the number column `n` (tracker-parse calls it `num`); every other
 * field maps 1:1. This maps FIELDS (a fixed schema, changing only with the
 * Application type itself), not header aliases — the alias table lives only
 * in tracker-aliases.json.
 * @type {Record<string, string>}
 */
const WEB_FIELD = {
  num: "n", date: "date", company: "company", via: "via", role: "role", location: "location",
  score: "score", status: "status", pdf: "pdf", report: "report", notes: "notes",
  url: "url",
  // The tracker's Apply Link / Follow-up columns (already in the shared alias
  // table) were mapped nowhere, so the web read path silently dropped them.
  applylink: "applyLink", followup: "followUp",
};

/**
 * The web field names, in map order — the row shape, exported so a test can
 * assert the emitter still delivers everything the map can name rather than
 * checking fields one at a time.
 * @type {string[]}
 */
export const WEB_FIELD_NAMES = Object.values(WEB_FIELD);

/** @type {Map<string, {mtimeMs: number, size: number, aliases: Record<string, string>}>} */
const aliasCache = new Map();

/** Canonical fields detectColumnMap needs to recognize a header row. */
const REQUIRED_FIELDS = ["num", "company", "role", "score", "status"];

/**
 * Load the shared header-alias table (lowercased header text → canonical field).
 *
 * `rootDir` is normally the data root so a complete external checkout keeps
 * using its own matching system files. A data-only root has no alias table;
 * `fallbackRootDir` then points at the checkout that runs the web app. Cache
 * entries remain keyed by the resolved file's mtime+size, and failures are
 * never cached so a recovered primary file is picked up immediately.
 * @param {string} rootDir - primary career-ops root.
 * @param {string} [fallbackRootDir] - running system checkout.
 * @returns {Record<string, string>}
 */
export function loadHeaderAliases(rootDir, fallbackRootDir) {
  const roots = [...new Set([rootDir, fallbackRootDir].filter(Boolean))];
  for (const [i, root] of roots.entries()) {
    const file = path.resolve(root, "tracker-aliases.json");
    try {
      const { mtimeMs, size } = fs.statSync(file);
      const cached = aliasCache.get(file);
      /** @type {Record<string, string>} */
      let aliases;
      if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
        aliases = cached.aliases;
      } else {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          aliasCache.delete(file);
          continue;
        }
        aliases = parsed;
        aliasCache.set(file, { mtimeMs, size, aliases });
      }
      // A table that cannot map the required columns (e.g. `{}`) would push
      // detectColumnMap onto the legacy positions and misread Via-style
      // trackers; while another root remains, try that one instead.
      const mapped = new Set(Object.values(aliases));
      if (i < roots.length - 1 && !REQUIRED_FIELDS.every((f) => mapped.has(f))) continue;
      return aliases;
    } catch {
      aliasCache.delete(file);
    }
  }
  return {};
}

/**
 * Split a tracker line into trimmed cells (outer pipes removed).
 *
 * The trailing empty part is dropped only when the row actually ENDS with a
 * pipe. Hand-edited rows without it are one part narrower but still complete —
 * tracker-utils rebuildRow supports them and parseTrackerRow reads their last
 * cell — so an unconditional `slice(1, -1)` silently ate real data (Notes read
 * as empty). Same rule as parseTrackerRow's width computation (#2369).
 * @param {string} line
 * @returns {string[]}
 */
function trackerCells(line) {
  const parts = line.split("|").map((c) => c.trim());
  return parts.slice(1, line.trimEnd().endsWith("|") ? -1 : undefined);
}

/**
 * Pre-scan for the header row and build the column map, exactly like
 * detectColumns in tracker-parse.mjs: ANY row whose cells resolve the essential
 * columns counts as the header (so alias headers like "Num" work too, not just
 * "#"). Returns null when no recognizable header exists.
 * @param {string[]} lines
 * @param {Record<string, string>} aliases - from loadHeaderAliases().
 * @returns {Record<string, number> | null}
 */
export function detectColumnMap(lines, aliases) {
  return detectHeader(lines, aliases)?.map ?? null;
}

/**
 * detectColumnMap plus the header row's own cell count.
 * @param {string[]} lines
 * @param {Record<string, string>} aliases
 * @returns {{ map: Record<string, number>, width: number } | null}
 */
function detectHeader(lines, aliases) {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = trackerCells(line);
    /** @type {Record<string, number>} */
    const m = {};
    cells.forEach((c, i) => {
      const k = WEB_FIELD[aliases[c.toLowerCase()]];
      if (k) m[k] = i; // unconditional: last occurrence wins, same as detectColumns
    });
    if (["n", "company", "role", "score", "status"].every((k) => m[k] != null)) return { map: m, width: cells.length };
  }
  return null;
}

/**
 * Parse the tracker markdown (source of truth) into application rows.
 * Columns are mapped by header name via the shared alias table. A data-only
 * `rootDir` falls back to `systemRootDir`; the legacy fixed order
 * (# | Date | Company | Role | Score | Status | PDF | Report | Notes)
 * remains the last resort for old trackers without recognizable headers.
 * Rows without a numeric # cell (header, separator, stray pipes) are skipped,
 * mirroring parseTrackerRow in tracker-parse.mjs.
 * @param {string} md - content of data/applications.md.
 * @param {string} rootDir - data root, which may also be a full checkout.
 * @param {string} [systemRootDir] - checkout holding system files; used as the
 *   fallback for tracker-aliases.json when rootDir is data-only.
 * @returns {Record<string, string>[]} One entry per tracker row, carrying every
 *   field in WEB_FIELD — the web `Application` shape (career-ops.ts).
 */
/**
 * One row with every web field the map can name, filled by `pick`.
 *
 * The single place the row's shape is decided. Adding a tracker column is two
 * edits — `WEB_FIELD` here and `Application` in career-ops.ts — and neither
 * can be forgotten quietly, because the emitter can no longer disagree with
 * the map it reads from.
 *
 * @param {(field: string) => string} pick
 * @returns {Record<string, string>}
 */
function emptyRow(pick) {
  /** @type {Record<string, string>} */
  const row = {};
  for (const field of Object.values(WEB_FIELD)) row[field] = pick(field);
  return row;
}

/**
 * The URL column is stored as `[label](href)` (#3516). Hand the caller the
 * href. Every other column stays the raw cell, including Apply Link.
 * @param {string} field
 * @param {string} raw
 * @returns {string}
 */
function urlCell(field, raw) {
  return field === "url" ? readTrackerUrl(raw) : raw;
}

export function parseApplications(md, rootDir, systemRootDir) {
  const lines = md.split("\n");
  const header = detectHeader(lines, loadHeaderAliases(rootDir, systemRootDir));
  const map = header?.map ?? null;
  const mappedWidth = map ? Math.max(...Object.values(map)) + 1 : 0;
  // The eight-cell floor for rows, lowered only for a header that is itself
  // narrower (no PDF/Report column, which parseTrackerRow reads). For a header
  // of eight or more cells it stays, so a seven-cell row that lost an interior
  // cell under a header with unrecognized trailing columns is still dropped
  // rather than read one column shifted.
  const minCells = Math.min(8, header?.width ?? 8);
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = trackerCells(line);
    if (cells.length < minCells) continue;
    if (map) {
      // Width guard, mirroring parseTrackerRow: a row missing an INTERIOR cell
      // shifts every later column one left, so requiring merely that the
      // highest mapped index EXISTS is not enough — the row must carry a cell
      // for every mapped column. Without this the reader rendered a
      // pre-`--migrate-via` row with Score in Role and Status in Score (#2369).
      if (cells.length < mappedWidth) continue;
      const at = (/** @type {string} */ k) => (map[k] == null ? "" : cells[map[k]] ?? "");
      if (!/^\d+$/.test(at("n"))) continue; // header / separator / malformed
      // Derived from WEB_FIELD, never listed by hand: a column the alias table
      // resolves has to REACH the caller, not merely be recognized. Spelling
      // the fields out here is what let `location` sit in the map for months
      // while the emitter dropped it, and Apply Link / Follow-up be resolved
      // by the shared alias table and thrown away the same way. A field the
      // map has no index for reads "", exactly as before.
      rows.push(emptyRow((k) => urlCell(k, at(k))));
    } else {
      // Legacy fixed order; tolerate the 8-cell variant where Notes is absent.
      if (!/^\d+$/.test(cells[0])) continue; // header / separator / malformed
      const [n, date, company, role, score, status, pdf, report, ...rest] = cells;
      // Same derivation, then the positional fields on top: everything the
      // fixed layout does not carry (via, location, applyLink, followUp)
      // stays "" without anyone having to remember to write it down.
      const positional = { n, date, company, role, score, status, pdf, report, notes: rest.join(" | ") };
      rows.push(emptyRow((k) => urlCell(k, positional[k] ?? "")));
    }
  }
  return rows;
}

/**
 * Why a tracker read produced the rows it did.
 *
 * `missing` is no file (the caller passes null). A new install is an empty
 * list, and the file must not be created here. `empty` is a blank file or a
 * real tracker table with no data rows. `malformed` is bytes that are not a
 * tracker table; callers must leave the file alone. `rows` is at least one
 * application.
 *
 * @param {string | null | undefined} md
 * @param {string} [rootDir]
 * @param {string} [systemRootDir]
 * @returns {"missing" | "empty" | "malformed" | "rows"}
 */
export function classifyTracker(md, rootDir, systemRootDir) {
  if (md == null) return "missing";
  const text = String(md).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (parseApplications(text, rootDir, systemRootDir).length > 0) return "rows";
  if (!text.trim()) return "empty";
  const lines = text.split("\n");
  if (detectHeader(lines, loadHeaderAliases(rootDir, systemRootDir))) return "empty";
  // Alias table missing: a header whose first cell is the number column is
  // still an empty tracker, not a damaged file.
  const legacyHeader = lines.some((raw) => {
    const line = raw.trim();
    if (!line.startsWith("|")) return false;
    const cells = trackerCells(line);
    return cells.length >= 8 && /^(#|num)$/i.test(cells[0] ?? "");
  });
  if (legacyHeader) return "empty";
  return "malformed";
}
