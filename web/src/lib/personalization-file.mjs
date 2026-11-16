// The file half of personalization: reading modes/_profile.md and its template,
// and the one merge that is allowed to change the user's file. Server-only —
// personalization.mjs is the half the browser can import (see its header).
// Roots and the writer are parameters, as in profile-memory.mjs, so web/tests
// can run this against a temp directory under bare `node --test`.
import fs from "node:fs";
import path from "node:path";
import { NOTES_START, NOTES_END, profilePath } from "./profile-memory.mjs";
import { renderSection } from "./personalization.mjs";

/**
 * Thrown when a write cannot be proven safe: the file's section boundaries are
 * ambiguous, or the result would not have the structure we meant to produce.
 * The caller must NOT write — modes/_profile.md is the user's file, and a
 * refused save is recoverable where a wrong splice is not.
 */
export class UnsureProfileParseError extends Error {
  constructor(reason) {
    super(`modes/_profile.md was left untouched: ${reason}`);
    this.name = "UnsureProfileParseError";
    this.code = "PROFILE_PARSE_UNSURE";
  }
}


/**
 * Replace only the bodies of the given sections, by source offset: every byte
 * outside a replaced body — other sections, line endings, blank lines, the
 * notes block, hand edits — is the byte that was there. A section whose heading
 * is absent is appended — before the assistant's notes block when that lives in
 * its own section, so the notes stay last the way rememberFact() expects.
 * Throws UnsureProfileParseError rather than guess at a boundary.
 */
export function mergeSections(existingMd, rendered, core) {
  const { scanHeadings, SECTIONS } = core;
  // Contract: bodies arrive already rendered (renderSection). Fail loudly here
  // rather than let an array or object stringify into the user's file.
  for (const [id, body] of Object.entries(rendered ?? {})) {
    if (typeof body !== "string") throw new TypeError(`mergeSections: rendered["${id}"] must be a string (call renderSection first)`);
  }
  const text = String(existingMd ?? "");
  const { heads, unsure } = scanHeadings(text);
  if (unsure) throw new UnsureProfileParseError(unsure);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const bodyOf = (id) => rendered[id].replace(/\r?\n/g, eol);

  const edits = [];
  const missing = [];
  for (const s of SECTIONS) {
    if (rendered?.[s.id] === undefined) continue;
    const found = heads.filter((h) => h.level === 2 && h.heading === s.heading);
    if (found.length > 1) throw new UnsureProfileParseError(`"${s.heading}" appears ${found.length} times`);
    if (found.length === 0) {
      missing.push(s);
      continue;
    }
    const h = found[0];
    const region = text.slice(h.bodyStart, h.end);
    if (region.includes(NOTES_START) || region.includes(NOTES_END)) {
      throw new UnsureProfileParseError(`"${s.heading}" contains the assistant's notes block`);
    }
    // Keep the blank lines around the old body; swap only what sits between them.
    const lead = /^(?:[ \t]*\r?\n)*/.exec(region)[0];
    const trail = /\s*$/.exec(region.slice(lead.length))[0];
    if (lead.length === region.length) {
      // No body yet: there is no spacing to keep, so lay out a normal one.
      const open = h.bodyStart > h.start && text[h.bodyStart - 1] === "\n" ? eol : eol + eol;
      edits.push({ start: h.bodyStart, end: h.end, text: open + bodyOf(s.id) + eol + (h.end < text.length ? eol : "") });
    } else {
      edits.push({ start: h.bodyStart + lead.length, end: h.end - trail.length, text: bodyOf(s.id) });
    }
  }

  const notes = heads.findIndex((h) => h.level === 2 && text.slice(h.bodyStart, h.end).includes(NOTES_START));
  if (missing.length) {
    const at = notes === -1 ? text.length : heads[notes].start;
    const before = text.slice(0, at);
    const gap = !before ? "" : !before.endsWith("\n") ? eol + eol : /(?:^|\n)[ \t]*\r?\n$/.test(before) ? "" : eol;
    const block = missing.map((s) => `${s.heading}${eol}${eol}${bodyOf(s.id)}${eol}`).join(eol);
    edits.push({ start: at, end: at, text: gap + block + (at < text.length ? eol : "") });
  }

  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  // Last gate: the result must parse cleanly into exactly the headings we meant
  // to leave. A body that opens a fence or a comment would otherwise swallow
  // the sections after it on the NEXT read.
  const names = heads.map((h) => h.heading);
  names.splice(notes === -1 ? names.length : notes, 0, ...missing.map((s) => s.heading));
  const after = scanHeadings(out);
  if (after.unsure || after.heads.length !== names.length || after.heads.some((h, i) => h.heading !== names[i])) {
    throw new UnsureProfileParseError("the new text would change where the file's sections begin and end");
  }
  return out;
}

/**
 * The shipped template. A SYSTEM file: it lives in the engine checkout, never
 * in the data root — under the split layout (CAREER_OPS_ROOT pointing at a
 * data-only directory) the data root has no template at all.
 */
export function templatePath(codeRoot) {
  return path.join(/* turbopackIgnore: true */ codeRoot, "modes", "_profile.template.md");
}

// null only for ENOENT. Anything else — and bytes that are not valid UTF-8,
// which a decode + encode round trip would silently rewrite — is an error the
// caller must see: "" here would read as "nothing on file".
function readExact(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  const text = buf.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buf)) throw new UnsureProfileParseError(`${path.basename(file)} is not valid UTF-8`);
  return text;
}

function readTemplate(codeRoot) {
  const tpl = readExact(templatePath(codeRoot));
  if (tpl === null || !tpl.trim()) throw new Error("modes/_profile.template.md is missing from the career-ops checkout");
  return tpl;
}

/**
 * Section state of the user's file against the shipped template. Throws when
 * either cannot be read: with no template every section compares as "filled",
 * and an unreadable profile compares as "missing".
 *
 * @param {string} dataRoot career-ops home, i.e. careerOpsRoot()
 * @param {string} codeRoot engine checkout, i.e. resolveCodeRoot()
 */
export function readPersonalizationState(dataRoot, codeRoot, core) {
  const user = readExact(profilePath(dataRoot));
  return { exists: user !== null, sections: core.sectionState(user ?? "", readTemplate(codeRoot)) };
}

/**
 * Read, merge and write in ONE synchronous pass — no await between the read and
 * the rename, so two requests in this process cannot interleave and drop each
 * other's sections. A missing file is seeded from the template; an existing one
 * is merged, never replaced. Throws before writing on anything it cannot read
 * or is not sure how to splice.
 *
 * @param {{ dataRoot: string, codeRoot: string, patch: Record<string, unknown>, dryRun?: boolean, write: (file: string, content: string) => unknown, core: { scanHeadings: Function, SECTIONS: Array<{ id: string, heading: string }> } }} opts
 *   `patch` is already coerced (coercePersonalization); `write` is atomicWriteWithBackup.
 * @returns {{ ids: string[], merged: string }}
 */
export function savePersonalization({ dataRoot, codeRoot, patch, dryRun = false, write, core }) {
  const ids = Object.keys(patch);
  const file = profilePath(dataRoot);
  const base = readExact(file) ?? readTemplate(codeRoot);
  const rendered = {};
  for (const id of ids) rendered[id] = renderSection(id, patch[id]);
  const merged = mergeSections(base, rendered, core);
  if (!dryRun) write(file, merged);
  return { ids, merged };
}
