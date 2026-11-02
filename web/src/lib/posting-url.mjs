/**
 * Posting URL helpers for the tracker table and the apply checklist.
 * No Node imports: the pipeline table is a client component.
 */

/**
 * Undo the destination escapes tracker-parse.mjs undoes. A backslash before
 * `\`, `(`, `)`, `<`, `>`, or a space is the escape. Anything else stays.
 * @param {string} text
 * @returns {string}
 */
function unescapeDestination(text) {
  return text.replace(/\\([\\()<> ])/g, "$1");
}

/**
 * Markdown link destination, same rules as tracker-parse.mjs
 * `markdownLinkDestination`. Balanced parentheses stay in the URL. A space
 * at depth 0 ends it. An angle-bracket destination runs to the closing `>`.
 * @param {string} raw
 * @returns {string|null}
 */
function linkDestination(raw) {
  const value = String(raw).trimStart();
  if (value.startsWith("<")) {
    for (let i = 1; i < value.length; i++) {
      if (value[i] === "\\") i++;
      else if (value[i] === ">") return unescapeDestination(value.slice(1, i));
    }
    return null;
  }

  let depth = 0;
  let end = value.length;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\") {
      i++;
      continue;
    }
    if (value[i] === "(") depth++;
    else if (value[i] === ")" && depth > 0) depth--;
    else if (/\s/.test(value[i]) && depth === 0) {
      end = i;
      break;
    }
  }
  const destination = value.slice(0, end).trim();
  return destination ? unescapeDestination(destination) : null;
}

/**
 * Every markdown link in a tracker cell, in order, with its span in `value`
 * (`end` exclusive). The walk matches tracker-parse.mjs `scanMarkdownLinks`:
 * the label ends at an unescaped `]`, the destination ends at the matching
 * `)`, and a `\` skips the next character.
 * @param {string} value
 * @returns {{target: string, start: number, end: number}[]}
 */
function markdownLinks(value) {
  const links = [];
  let cursor = 0;
  while (cursor < value.length) {
    const labelStart = value.indexOf("[", cursor);
    if (labelStart === -1) break;

    let labelEnd = -1;
    for (let i = labelStart + 1; i < value.length; i++) {
      if (value[i] === "\\") i++;
      else if (value[i] === "]") {
        labelEnd = i;
        break;
      }
    }
    if (labelEnd === -1 || value[labelEnd + 1] !== "(") {
      cursor = labelStart + 1;
      continue;
    }

    let depth = 1;
    let linkEnd = -1;
    for (let i = labelEnd + 2; i < value.length; i++) {
      if (value[i] === "\\") i++;
      else if (value[i] === "(") depth++;
      else if (value[i] === ")" && --depth === 0) {
        linkEnd = i;
        break;
      }
    }
    if (linkEnd === -1) {
      cursor = labelStart + 1;
      continue;
    }

    const target = linkDestination(value.slice(labelEnd + 2, linkEnd));
    if (target != null) links.push({ target, start: labelStart, end: linkEnd + 1 });
    cursor = linkEnd + 1;
  }
  return links;
}

/**
 * Every markdown-link target in a tracker cell, in order.
 * @param {string} value
 * @returns {string[]}
 */
function markdownLinkTargets(value) {
  return markdownLinks(value).map((link) => link.target);
}

/**
 * First http(s) markdown-link target in a tracker cell.
 * @param {string} value
 * @returns {string|null}
 */
function firstHttpMarkdownTarget(value) {
  // The `<…>` strip mirrors tracker-parse.mjs `extractCellUrl`, so both read
  // the same href from a URL cell.
  const hrefs = markdownLinkTargets(value).map((target) => String(target).trim().replace(/^<|>$/g, ""));
  return hrefs.find((href) => /^https?:\/\//i.test(href)) ?? null;
}

/**
 * First markdown-link target in a tracker cell, such as the report path in
 * `[1](../reports/001-acme-(berlin)-2026-10-01.md)`, or null when the cell
 * holds no link. Balanced parentheses stay in the target (#5482). Same result
 * as tracker-parse.mjs `firstLinkTarget`.
 * @param {string | null | undefined} cell
 * @returns {string|null}
 */
export function firstMarkdownLinkTarget(cell) {
  return markdownLinkTargets(String(cell ?? ""))[0] ?? null;
}

/**
 * The target of a tracker cell that is exactly one markdown link, trimmed, with
 * nothing around it; null for no link, two links, or text beside the link.
 * Same result as tracker-parse.mjs `soleMarkdownLink`.
 * @param {string | null | undefined} cell
 * @returns {string|null}
 */
export function soleMarkdownLinkTarget(cell) {
  const value = String(cell ?? "").trim();
  const links = markdownLinks(value);
  if (links.length !== 1 || links[0].start !== 0 || links[0].end !== value.length) return null;
  return links[0].target;
}

/**
 * The posting URL a tracker URL cell points at.
 * A markdown link returns its href. A bare URL, `—`, `N/A`, or any other
 * cell comes back trimmed and unchanged. Same result as `extractCellUrl`
 * in tracker-parse.mjs for the cells merge-tracker writes (#3516).
 * @param {string} cell
 * @returns {string}
 */
export function readTrackerUrl(cell) {
  const value = String(cell ?? "").trim();
  if (!value) return "";
  // A value that is already a URL was extracted before (tracker-table.mjs
  // applies this reader to r.url). Parsing it again could pick up a link
  // nested inside its path and swap in a different posting.
  if (isBareHttpUrl(value)) return value;
  return firstHttpMarkdownTarget(value) ?? value;
}

/** True when the value starts with an http(s) scheme. */
function isBareHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

/**
 * Href from a tracker URL cell. Empty when the cell is not an http(s) URL.
 * A bare URL stops at the first space, so trailing text is dropped. A link
 * destination is kept whole, since an escaped space or a space inside
 * balanced parentheses is part of it.
 */
export function postingHref(cell) {
  const value = String(cell ?? "").trim();
  if (!value || value === "—" || value === "-") return "";
  if (isBareHttpUrl(value)) return value.split(/\s/)[0];
  return firstHttpMarkdownTarget(value) ?? "";
}

/** Short label for a posting link. The host, without a leading www. */
export function postingLabel(href) {
  try {
    const host = new URL(href).host.replace(/^www\./i, "");
    return host || "posting";
  } catch {
    return "posting";
  }
}

/** Tracker cell first, then the report's URL field. */
export function resolvePostingUrl(trackerCell, reportField) {
  return postingHref(trackerCell) || postingHref(reportField) || "";
}

const MAX_URL_LEN = 2048;

export function postingUrl(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL_LEN) return null;
  if (/[\0\r\n]/.test(s)) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  if (u.username || u.password) return null;
  return s;
}

export function unscoredInboxHref(url, evaluated) {
  if (evaluated) return null;
  return postingUrl(url);
}
