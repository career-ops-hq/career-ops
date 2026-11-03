import { isDeepStrictEqual } from "node:util";
import * as yaml from "js-yaml";

// Comment-preserving writes to config/profile.yml (#5662). js-yaml never emits
// comments, so a parse → merge → yaml.dump round trip drops every one of them,
// including the commented-out opt-in keys profile.example.yml documents. The
// routes that write this file only ever set known keys one level under a
// top-level section, so they edit those lines as text instead and leave every
// other line byte for byte (the approach onboard-write.mjs and fix-slugs.mjs
// take for the same reason).

/** @typedef {string | number | boolean | string[]} ProfileValue */

const q = (/** @type {string} */ s) => JSON.stringify(s);

/** @param {Exclude<ProfileValue, string[]>} value */
function scalar(value) {
  return typeof value === "string" ? q(value) : String(value);
}

/** @param {string} line */
function indentOf(line) {
  return /^[ ]*/.exec(line)?.[0] ?? "";
}

/** @param {string} line */
function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

/**
 * The trailing `# comment` of a `key: value` line, with its leading space.
 * A `#` inside a quoted scalar, including one inside a flow list such as
 * `["Role #1"]`, is not a comment. A quote opens a scalar only where a scalar
 * starts: at the start of the value, or inside a flow list or mapping after
 * `[ { ,` or a mapping `:` (one followed by a space, a flow indicator or the
 * end, or one right after a quoted key). The quotes in a plain `O'Brien`,
 * `John "Jack` or flow `[a:"b]` open nothing.
 * @param {string} value
 */
function trailingComment(value) {
  const flow = /^\s*[[{]/.test(value);
  let quote = "";
  let closedAt = -1;
  let scalarStart = true;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    const prev = i === 0 ? " " : value[i - 1];
    if (quote) {
      if (quote === '"' && c === "\\") i++;
      else if (c === quote && quote === "'" && value[i + 1] === "'") i++;
      else if (c === quote) [quote, closedAt] = ["", i];
    } else if (/\s/.test(c)) {
      continue;
    } else if ((c === '"' || c === "'") && scalarStart) {
      quote = c;
      scalarStart = false;
    } else if (c !== "#" || !/\s/.test(prev)) {
      const mappingColon = c === ":" && (closedAt === i - 1 || /^$|[\s,[\]{}]/.test(value[i + 1] ?? ""));
      scalarStart = flow && (/[[{,]/.test(c) || mappingColon);
    } else {
      let start = i;
      while (start > 0 && /\s/.test(value[start - 1])) start--;
      return value.slice(start);
    }
  }
  return "";
}

/**
 * The lines of one top-level block mapping: `[header, end)`, where `end` is
 * the next line that starts another top-level key. -1 when the section is
 * absent; null when its header is not a plain `section:` line.
 * @param {string[]} lines
 * @param {string} section
 */
function findSection(lines, section) {
  const headers = lines.flatMap((line, i) => (line.startsWith(`${section}:`) ? [i] : []));
  if (headers.length === 0) return -1;
  if (headers.length > 1 || !/^\s*(#.*)?$/.test(lines[headers[0]].slice(section.length + 1))) return null;
  const start = headers[0];
  let end = start + 1;
  while (end < lines.length && (isBlankOrComment(lines[end]) || /^\s/.test(lines[end]))) end++;
  // Comment lines at column 0 just before the next section document that
  // section, so they are not part of this one.
  while (end > start + 1 && (lines[end - 1].trim() === "" || /^#/.test(lines[end - 1]))) end--;
  return { start, end };
}

/**
 * The block-list items under the key at `at`. Comment lines between them, and
 * the trailing comment of an item line (`- "Old" # note`, which has no new
 * item to stay on), are returned as comment lines to keep ahead of the new
 * items.
 * @param {string[]} lines
 * @param {number} at
 * @param {number} end
 * @param {string} indent the key's own indent
 */
function listItems(lines, at, end, indent) {
  let last = at;
  for (let i = at + 1; i < end; i++) {
    if (isBlankOrComment(lines[i])) continue;
    if (/^\s*- /.test(lines[i]) && indentOf(lines[i]).length >= indent.length) last = i;
    else break;
  }
  const kept = lines.slice(at + 1, last + 1).flatMap((line) => {
    if (line.trim().startsWith("#")) return [line];
    const comment = /^\s*- /.test(line) ? trailingComment(line.replace(/^\s*-/, "")).trim() : "";
    return comment ? [`${indentOf(line)}${comment}`] : [];
  });
  const itemIndent = lines.slice(at + 1, last + 1).find((line) => /^\s*- /.test(line));
  return { last, kept, itemIndent: itemIndent ? indentOf(itemIndent) : `${indent}  ` };
}

/**
 * @param {string[]} lines
 * @param {string} section
 * @param {Record<string, ProfileValue>} values
 * @returns {boolean} false when the section has a shape this edit does not place
 */
function setSection(lines, section, values) {
  const found = findSection(lines, section);
  if (found === null) return false;
  if (found === -1) {
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(`${section}:`, "");
    return setSection(lines, section, values);
  }

  const { start } = found;
  let { end } = found;
  const firstChild = lines.slice(start + 1, end).find((line) => !isBlankOrComment(line));
  const indent = firstChild ? indentOf(firstChild) : "  ";
  for (const [key, value] of Object.entries(values)) {
    let at = -1;
    for (let i = start + 1; i < end && at === -1; i++) {
      if (lines[i].startsWith(`${indent}${key}:`)) at = i;
    }
    let block;
    if (Array.isArray(value)) {
      const items = value.map((item) => q(item));
      if (at === -1) {
        block = items.length ? [`${indent}${key}:`, ...items.map((item) => `${indent}  - ${item}`)] : [`${indent}${key}: []`];
      } else {
        const rest = lines[at].slice(indent.length + key.length + 1);
        const comment = trailingComment(rest);
        if (rest.slice(0, rest.length - comment.length).trim() === "") {
          const { last, kept, itemIndent } = listItems(lines, at, end, indent);
          const next = items.length
            ? [`${indent}${key}:${comment}`, ...kept, ...items.map((item) => `${itemIndent}- ${item}`)]
            : [`${indent}${key}: []${comment}`, ...kept];
          lines.splice(at, last - at + 1, ...next);
          end += next.length - (last - at + 1);
          continue;
        }
        lines[at] = `${indent}${key}: [${items.join(", ")}]${comment}`;
        continue;
      }
    } else if (at !== -1) {
      lines[at] = `${indent}${key}: ${scalar(value)}${trailingComment(lines[at].slice(indent.length + key.length + 1))}`;
      continue;
    } else {
      block = [`${indent}${key}: ${scalar(value)}`];
    }
    // A new key goes after the section's last indented line.
    let insert = start + 1;
    for (let i = start + 1; i < end; i++) if (/^\s+\S/.test(lines[i])) insert = i + 1;
    lines.splice(insert, 0, ...block);
    end += block.length;
  }
  return true;
}

/**
 * Set `section.key` values in profile.yml text, keeping every other line.
 *
 * The edited text must parse to exactly `expected`, the document the route's
 * own merge produced. When it does not, or the file uses a shape the line edit
 * does not place (a flow `section: { … }`, a block scalar, an anchor), this
 * returns null and the caller writes `yaml.dump(expected)` as before, so no
 * input writes a different document than the merge did.
 *
 * @param {string} source the profile text the route parsed
 * @param {Record<string, Record<string, ProfileValue>>} patch section → key → value
 * @param {unknown} expected
 * @returns {string | null}
 */
export function patchProfileText(source, patch, expected) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  for (const [section, values] of Object.entries(patch)) {
    if (!setSection(lines, section, values)) return null;
  }
  if (lines[lines.length - 1] !== "") lines.push("");
  const text = lines.join(eol);
  try {
    return isDeepStrictEqual(yaml.load(text), expected) ? text : null;
  } catch {
    return null;
  }
}
