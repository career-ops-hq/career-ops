import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import * as yaml from "js-yaml";

/**
 * A configuration error that lets the route distinguish a broken user-layer
 * file (409: the user must repair it) from an installation/read failure (500).
 */
export class PortalsConfigError extends Error {
  /**
   * @param {string} message
   * @param {"invalid-user-config" | "read-failed" | "invalid-template"} kind
   * @param {unknown} [cause]
   */
  constructor(message, kind, cause) {
    super(message, { cause });
    this.name = "PortalsConfigError";
    this.kind = kind;
  }
}

/** @param {unknown} value */
export function isMapping(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Load portals.yml without treating parse/read failures as a missing file.
 * The shipped template is used only when the user-layer file is absent.
 *
 * @param {string} file
 * @param {string} templateFile
 * @returns {{ doc: Record<string, unknown>, seeded: boolean, source: string }}
 */
export function loadPortalsDocument(file, templateFile) {
  let source;
  let seeded = false;

  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw new PortalsConfigError("could not read portals.yml", "read-failed", error);
    }

    seeded = true;
    try {
      source = fs.readFileSync(templateFile, "utf8");
    } catch (templateError) {
      throw new PortalsConfigError("could not read portals template", "read-failed", templateError);
    }
  }

  let parsed;
  try {
    parsed = yaml.load(source);
  } catch (error) {
    throw new PortalsConfigError(
      seeded ? "portals template contains invalid YAML" : "portals.yml contains invalid YAML",
      seeded ? "invalid-template" : "invalid-user-config",
      error,
    );
  }

  if (!isMapping(parsed)) {
    throw new PortalsConfigError(
      seeded ? "portals template must contain a YAML mapping" : "portals.yml must contain a YAML mapping",
      seeded ? "invalid-template" : "invalid-user-config",
    );
  }

  return { doc: parsed, seeded, source };
}

/**
 * Return a merge-safe document that changes only the filters owned by the web
 * onboarding flow. All scanner sources and user customizations are preserved.
 *
 * @param {Record<string, unknown>} doc
 * @param {string[]} roles
 * @param {string[] | undefined} locations
 */
export function mergePortalFilters(doc, roles, locations) {
  const merged = { ...doc };
  const titleFilter = isMapping(doc.title_filter) ? { ...doc.title_filter } : {};
  titleFilter.positive = [...roles];
  merged.title_filter = titleFilter;

  if (locations?.length) {
    const locationFilter = isMapping(doc.location_filter) ? { ...doc.location_filter } : {};
    locationFilter.allow = [...locations];
    merged.location_filter = locationFilter;
  }

  return merged;
}

const isTopLevelKey = (line) => /^[^\s#-]/.test(line);
const isNote = (line) => line.trim() === "" || line.trim().startsWith("#");
const indentOf = (line) => line.length - line.trimStart().length;

/**
 * Replace (or add) one list, `section.key`, in portals.yml text, line by line,
 * so every other line, comments included, stays byte-for-byte. Returns null
 * for a shape this edit does not handle (a flow-style section, a scalar
 * value), so the caller can fall back.
 *
 * @param {string[]} lines - edited in place.
 * @param {string} section
 * @param {string} key
 * @param {string[]} items
 * @returns {string[] | null}
 */
function setListInText(lines, section, key, items) {
  const head = lines.findIndex((l) => new RegExp(`^${section}:\\s*(#.*)?$`).test(l));
  if (head < 0) {
    if (lines.some((l) => l.startsWith(`${section}:`))) return null; // flow style or a value on the same line
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(`${section}:`, `  ${key}:`, ...items.map((i) => `    - ${JSON.stringify(i)}`), "");
    return lines;
  }
  let end = head + 1;
  while (end < lines.length && !isTopLevelKey(lines[end])) end++;
  const child = lines.slice(head + 1, end).find((l) => !isNote(l));
  const childIndent = child ? " ".repeat(indentOf(child)) : "  ";
  const at = lines.findIndex((l, i) => i > head && i < end && l.startsWith(`${childIndent}${key}:`));
  if (at < 0) {
    lines.splice(head + 1, 0, `${childIndent}${key}:`, ...items.map((i) => `${childIndent}  - ${JSON.stringify(i)}`));
    return lines;
  }
  const value = lines[at].slice(childIndent.length + key.length + 1).replace(/\s+#.*$/, "").trim();
  if (value !== "" && !/^\[.*\]$/.test(value)) return null;
  // The list's own lines: everything more indented than the key, up to its last
  // item. Notes between items stay (ahead of the new items, as onboard-write.mjs
  // keeps them); notes after the last item are left where they are.
  let last = at;
  for (let i = at + 1; i < end; i++) {
    if (isNote(lines[i])) continue;
    const sameIndentItem = indentOf(lines[i]) === childIndent.length && lines[i].trimStart().startsWith("- ");
    if (indentOf(lines[i]) <= childIndent.length && !sameIndentItem) break;
    last = i;
  }
  const body = lines.slice(at + 1, last + 1);
  const firstItem = body.find((l) => !isNote(l));
  const itemIndent = firstItem ? " ".repeat(indentOf(firstItem)) : `${childIndent}  `;
  lines.splice(at, last - at + 1, `${childIndent}${key}:`, ...body.filter(isNote), ...items.map((i) => `${itemIndent}- ${JSON.stringify(i)}`));
  return lines;
}

/**
 * portals.yml text with the web-owned filters replaced, keeping every comment
 * and every commented-out company block. A round-trip through yaml.dump would
 * drop all of them (fix-slugs.mjs edits this file as text for the same reason).
 * The result must parse to exactly `mergePortalFilters(doc, ...)`; when it does
 * not, or the file uses a shape the line edit does not handle, this returns
 * null and the caller falls back to serializing the merged document.
 *
 * @param {string} source - the text loadPortalsDocument parsed.
 * @param {string[]} roles
 * @param {string[] | undefined} locations
 * @returns {string | null}
 */
export function patchPortalFiltersText(source, roles, locations) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  let lines = source.split(/\r?\n/);
  lines = setListInText(lines, "title_filter", "positive", roles);
  if (lines && locations?.length) lines = setListInText(lines, "location_filter", "allow", locations);
  if (!lines) return null;
  const text = lines.join(eol);
  try {
    const expected = mergePortalFilters(/** @type {Record<string, unknown>} */ (yaml.load(source)), roles, locations);
    return isDeepStrictEqual(yaml.load(text), expected) ? text : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ name: string, enabled: boolean, host: string }} WatchedCompany
 */

/**
 * The companies in tracked_companies, scanned ones first, so the Portals page
 * can list them before any health check runs.
 *
 * @param {Record<string, unknown>} doc
 * @returns {WatchedCompany[]}
 */
export function watchedCompanies(doc) {
  const list = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
  const hostOf = (url) => {
    try {
      return new URL(String(url)).host;
    } catch {
      return "";
    }
  };
  return list
    .filter((c) => isMapping(c) && typeof c.name === "string" && c.name.trim())
    .map((c) => ({ name: c.name.trim(), enabled: c.enabled !== false, host: hostOf(c.careers_url ?? c.api) }))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled));
}
