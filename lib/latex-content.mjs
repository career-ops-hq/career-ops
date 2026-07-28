/**
 * Content-level extract/patch for user-owned LaTeX CV templates.
 * v1 families: resumeSubheading | tabularx-itemize
 */

import { escapeLatex } from './latex-escape.mjs';

export const SUPPORTED_FAMILIES = ['resumeSubheading', 'tabularx-itemize'];

export const UNSUPPORTED_HINT =
  'Unsupported LaTeX CV layout. v1 supports \\resumeSubheading + \\resumeItem macros, ' +
  'or tabularx + itemize without resume macros. Use /career-ops latex (cv.md → career-ops template) instead.';

/**
 * @param {string} tex
 * @returns {number}
 */
export function findMatchingBrace(tex, openIdx) {
  if (tex[openIdx] !== '{') return -1;
  let depth = 0;
  let escaped = false;
  for (let i = openIdx; i < tex.length; i++) {
    const ch = tex[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * @param {string} tex
 * @returns {'resumeSubheading'|'tabularx-itemize'|null}
 */
export function detectFamily(tex) {
  if (typeof tex !== 'string' || !tex.trim()) return null;
  if (/\\resumeSubheading\b/.test(tex) && /\\(resumeItem|resumeItemWithoutTitle|resumeSubItem)\b/.test(tex)) {
    return 'resumeSubheading';
  }
  const hasTabularx = /\\usepackage\{[^}]*tabularx[^}]*\}/.test(tex) || /\\begin\{tabularx\}/.test(tex);
  const hasItemize = /\\begin\{itemize\}/.test(tex);
  if (hasTabularx && hasItemize && !/\\resumeSubheading\b/.test(tex)) {
    return 'tabularx-itemize';
  }
  return null;
}

/**
 * Index where the document body starts, so extraction can skip macro
 * definitions in the preamble (e.g. `\newcommand{\resumeSubItem}[2]{\resumeItem{#1}{#2}}`
 * would otherwise be captured as a `#1` slot).
 *
 * @param {string} tex
 * @returns {number}
 */
function bodyStart(tex) {
  const docStart = tex.indexOf('\\begin{document}');
  return docStart === -1 ? 0 : docStart;
}

/**
 * True when `idx` sits on a line that is commented out at that position —
 * i.e. an unescaped `%` appears earlier on the same line. Commented macro
 * calls are inert LaTeX (often old bullets kept for reference) and must not
 * become editable slots.
 *
 * @param {string} tex
 * @param {number} idx
 * @returns {boolean}
 */
function isCommentedAt(tex, idx) {
  const lineStart = tex.lastIndexOf('\n', idx - 1) + 1;
  for (let i = lineStart; i < idx; i++) {
    if (tex[i] === '\\') {
      i++; // skip escaped char (\% is a literal percent)
      continue;
    }
    if (tex[i] === '%') return true;
  }
  return false;
}

/**
 * Extract macro argument bodies as editable slots. Spans are absolute
 * offsets into `tex`; scanning starts at the document body.
 *
 * `useNextGroupIfEmpty` handles the common `\resumeItemWithoutTitle{}{Text}`
 * pattern (one-parameter macro called with an empty first group followed by a
 * plain braced group): when the captured group is empty/whitespace, the slot
 * points at the immediately following braced group instead.
 *
 * @param {string} tex
 * @param {string} macroName
 * @param {string} kind
 * @param {{useNextGroupIfEmpty?: boolean}} [opts]
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractMacroBodies(tex, macroName, kind, { useNextGroupIfEmpty = false } = {}) {
  const slots = [];
  const needle = `\\${macroName}{`;
  let searchFrom = bodyStart(tex);
  while (searchFrom < tex.length) {
    const idx = tex.indexOf(needle, searchFrom);
    if (idx === -1) break;
    if (isCommentedAt(tex, idx)) {
      searchFrom = idx + needle.length;
      continue;
    }
    const openBrace = idx + needle.length - 1;
    const closeBrace = findMatchingBrace(tex, openBrace);
    if (closeBrace === -1) break;
    let innerStart = openBrace + 1;
    let innerEnd = closeBrace;
    searchFrom = closeBrace + 1;

    if (useNextGroupIfEmpty && !tex.slice(innerStart, innerEnd).trim()) {
      let cursor = closeBrace + 1;
      while (cursor < tex.length && /\s/.test(tex[cursor])) cursor++;
      if (tex[cursor] !== '{') continue; // empty group with no follow-up group — nothing editable
      const openNext = cursor;
      const closeNext = findMatchingBrace(tex, openNext);
      if (closeNext === -1) break;
      innerStart = openNext + 1;
      innerEnd = closeNext;
      searchFrom = closeNext + 1;
    }

    slots.push({
      id: `${kind}-${slots.length}`,
      kind,
      text: tex.slice(innerStart, innerEnd),
      span: { start: innerStart, end: innerEnd },
    });
  }
  return slots;
}

/**
 * Extract the value argument of `\resumeSubItem{Category}{Items}` calls as
 * skill slots. The category (first group) is left untouched; only the second
 * group is editable.
 *
 * @param {string} tex
 * @returns {Array<{kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractSubItemValues(tex) {
  const slots = [];
  const needle = '\\resumeSubItem{';
  let searchFrom = bodyStart(tex);
  while (searchFrom < tex.length) {
    const idx = tex.indexOf(needle, searchFrom);
    if (idx === -1) break;
    if (isCommentedAt(tex, idx)) {
      searchFrom = idx + needle.length;
      continue;
    }
    const openCat = idx + needle.length - 1;
    const closeCat = findMatchingBrace(tex, openCat);
    if (closeCat === -1) break;
    searchFrom = closeCat + 1;

    let cursor = closeCat + 1;
    while (cursor < tex.length && /\s/.test(tex[cursor])) cursor++;
    if (tex[cursor] !== '{') continue;
    const openVal = cursor;
    const closeVal = findMatchingBrace(tex, openVal);
    if (closeVal === -1) break;

    slots.push({
      kind: 'skill',
      text: tex.slice(openVal + 1, closeVal),
      span: { start: openVal + 1, end: closeVal },
    });
    searchFrom = closeVal + 1;
  }
  return slots;
}

/**
 * @param {string} tex
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractSkillValues(tex) {
  const slots = [];
  let searchFrom = bodyStart(tex);
  while (searchFrom < tex.length) {
    const idx = tex.indexOf('\\textbf{', searchFrom);
    if (idx === -1) break;
    if (isCommentedAt(tex, idx)) {
      searchFrom = idx + 8;
      continue;
    }
    const openCat = tex.indexOf('{', idx);
    const closeCat = findMatchingBrace(tex, openCat);
    if (closeCat === -1) break;

    let cursor = closeCat + 1;
    while (cursor < tex.length && /\s/.test(tex[cursor])) cursor++;
    if (tex[cursor] !== '{') {
      searchFrom = closeCat + 1;
      continue;
    }

    const openVal = cursor;
    const closeVal = findMatchingBrace(tex, openVal);
    if (closeVal === -1) break;

    const rawValue = tex.slice(openVal + 1, closeVal);
    const colon = rawValue.match(/^:\s*/);
    if (!colon) {
      searchFrom = closeVal + 1;
      continue;
    }

    const itemsStart = openVal + 1 + colon[0].length;
    const itemsText = tex.slice(itemsStart, closeVal);
    slots.push({
      kind: 'skill',
      text: itemsText,
      span: { start: itemsStart, end: closeVal },
    });
    searchFrom = closeVal + 1;
  }
  return slots;
}

/**
 * @param {string} tex
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractItemizeItems(tex) {
  const docStart = tex.indexOf('\\begin{document}');
  const body = docStart === -1 ? tex : tex.slice(docStart);
  const offset = docStart === -1 ? 0 : docStart;
  const slots = [];
  const itemRe = /\\item\b/g;
  let match;
  while ((match = itemRe.exec(body)) !== null) {
    if (isCommentedAt(body, match.index)) continue;
    let i = match.index + match[0].length;
    while (i < body.length && /\s/.test(body[i])) i++;

    if (body[i] === '{') {
      const openBrace = i;
      const closeBrace = findMatchingBrace(body, openBrace);
      if (closeBrace === -1) continue;
      slots.push({
        id: `item-${slots.length}`,
        kind: 'item',
        text: body.slice(openBrace + 1, closeBrace),
        span: { start: offset + openBrace + 1, end: offset + closeBrace },
      });
      continue;
    }

    const lineEnd = body.indexOf('\n', i);
    const end = lineEnd === -1 ? body.length : lineEnd;
    const text = body.slice(i, end).trim();
    if (!text) continue;
    slots.push({
      id: `item-${slots.length}`,
      kind: 'item',
      text,
      span: { start: offset + i, end: offset + end },
    });
  }
  return slots;
}

/**
 * @param {string} tex
 * @param {'resumeSubheading'|'tabularx-itemize'} family
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
export function extractSlots(tex, family) {
  if (family === 'resumeSubheading') {
    const byPosition = (a, b) => a.span.start - b.span.start;
    const dedupe = (list) => {
      const seen = new Set();
      return list.filter(s => {
        const key = `${s.span.start}-${s.span.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const bullets = dedupe([
      ...extractMacroBodies(tex, 'resumeItem', 'bullet'),
      ...extractMacroBodies(tex, 'resumeItemWithoutTitle', 'bullet', { useNextGroupIfEmpty: true }),
    ].sort(byPosition)).map((s, i) => ({ ...s, id: `bullet-${i}` }));
    const skills = dedupe([
      ...extractSkillValues(tex),
      ...extractSubItemValues(tex),
    ].sort(byPosition)).map((s, i) => ({ ...s, id: `skill-${i}` }));
    return [...bullets, ...skills];
  }
  if (family === 'tabularx-itemize') {
    return extractItemizeItems(tex);
  }
  return [];
}

/**
 * @param {string} texPath
 * @param {string} tex
 * @returns {{supported: boolean, family: string|null, source: string, slots: Array, error?: string, hint?: string}}
 */
export function buildManifest(texPath, tex) {
  const family = detectFamily(tex);
  if (!family) {
    return {
      supported: false,
      family: null,
      source: texPath,
      slots: [],
      error: UNSUPPORTED_HINT,
      hint: 'Place resume.tex in the project root or set latex.source in config/profile.yml.',
    };
  }

  const slots = extractSlots(tex, family);
  return {
    supported: true,
    family,
    source: texPath,
    slots,
  };
}

/**
 * @param {string} tex
 * @param {Array<{id: string, text: string}>} patches
 * @param {Array<{id: string, span: {start: number, end: number}}>} slots
 * @param {{escape?: boolean}} [opts]
 * @returns {string}
 */
export function applyPatches(tex, patches, slots, { escape = true } = {}) {
  const slotById = new Map(slots.map(s => [s.id, s]));
  const ordered = [...patches]
    .map(p => {
      const slot = slotById.get(p.id);
      if (!slot) return null;
      return { slot, text: p.text };
    })
    .filter(Boolean)
    .sort((a, b) => b.slot.span.start - a.slot.span.start);

  let out = tex;
  for (const { slot, text } of ordered) {
    const replacement = escape ? escapeLatex(text) : text;
    out = out.slice(0, slot.span.start) + replacement + out.slice(slot.span.end);
  }
  return out;
}
