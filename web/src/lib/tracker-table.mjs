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
 * Plain .mjs (same pattern as clean-chips.mjs) so tracker-columns-tests.mjs can
 * import it directly under Node and regression-test the REAL alias chain.
 */
import fs from "node:fs";
import path from "node:path";

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
};

/** @type {Map<string, {mtimeMs: number, size: number, aliases: Record<string, string>}>} */
const aliasCache = new Map();

/**
 * Load the shared header-alias table (lowercased header text → canonical field)
 * from `{rootDir}/tracker-aliases.json`. Cached per resolved file path so the
 * request-time read path (readApplications runs on every API route / page
 * render) doesn't re-read and re-parse the JSON each call — but the cache is
 * keyed on the file's mtime+size (one statSync per call, no full read), so a
 * system update that rewrites the alias table is picked up on the next request
 * instead of after a server restart. Failures are NEVER cached: a
 * missing/corrupt file (core checkout predating the JSON) yields an empty
 * table — no header row is then detected and parseApplications falls back to
 * the legacy fixed column order — and the cache entry is cleared so a later
 * recovered file is loaded immediately.
 * @param {string} rootDir - career-ops root (careerOpsRoot() on the web side).
 * @returns {Record<string, string>}
 */
export function loadHeaderAliases(rootDir) {
  const file = path.resolve(rootDir, "tracker-aliases.json");
  try {
    const { mtimeMs, size } = fs.statSync(file);
    const cached = aliasCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.aliases;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    // Guard non-object JSON (null, arrays, scalars) — treat like corrupt.
    /** @type {Record<string, string>} */
    const aliases = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    aliasCache.set(file, { mtimeMs, size, aliases });
    return aliases;
  } catch {
    aliasCache.delete(file); // never cache failure — recovery must not need a restart
    return {};
  }
}

/**
 * Split a tracker line into trimmed cells (outer pipes removed).
 * @param {string} line
 * @returns {string[]}
 */
function trackerCells(line) {
  return line.split("|").slice(1, -1).map((c) => c.trim());
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
    if (["n", "company", "role", "score", "status"].every((k) => m[k] != null)) return m;
  }
  return null;
}

/**
 * Parse the tracker markdown (source of truth) into application rows.
 * Columns are mapped by header name via the shared alias table in
 * `{rootDir}/tracker-aliases.json`; the legacy fixed order
 * (# | Date | Company | Role | Score | Status | PDF | Report | Notes)
 * is the fallback when no recognizable header row is present.
 * Rows without a numeric # cell (header, separator, stray pipes) are skipped,
 * mirroring parseTrackerRow in tracker-parse.mjs.
 * @param {string} md - content of data/applications.md.
 * @param {string} rootDir - career-ops root holding tracker-aliases.json.
 * @returns {{n: string, date: string, company: string, via: string, role: string, score: string, status: string, pdf: string, report: string, notes: string}[]}
 */
export function parseApplications(md, rootDir) {
  const lines = md.split("\n");
  const map = detectColumnMap(lines, loadHeaderAliases(rootDir));
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = trackerCells(line);
    if (cells.length < 8) continue;
    if (map) {
      const at = (/** @type {string} */ k) => cells[map[k]] ?? "";
      if (!/^\d+$/.test(at("n"))) continue; // header / separator / malformed
      rows.push({
        n: at("n"), date: at("date"), company: at("company"), via: at("via"), role: at("role"),
        score: at("score"), status: at("status"), pdf: at("pdf"), report: at("report"),
        notes: at("notes"),
      });
    } else {
      // Legacy fixed order; tolerate the 8-cell variant where Notes is absent.
      if (!/^\d+$/.test(cells[0])) continue; // header / separator / malformed
      const [n, date, company, role, score, status, pdf, report, ...rest] = cells;
      rows.push({ n, date, company, via: "", role, score, status, pdf, report, notes: rest.join(" | ") });
    }
  }
  return rows;
}
