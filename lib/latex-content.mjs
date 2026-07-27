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
  if (/\\resumeSubheading\b/.test(tex) && /\\resumeItem\b/.test(tex)) {
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
 * @param {string} tex
 * @param {string} macroName
 * @param {string} kind
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractMacroBodies(tex, macroName, kind) {
  const slots = [];
  const needle = `\\${macroName}{`;
  let searchFrom = 0;
  while (searchFrom < tex.length) {
    const idx = tex.indexOf(needle, searchFrom);
    if (idx === -1) break;
    const openBrace = idx + needle.length - 1;
    const closeBrace = findMatchingBrace(tex, openBrace);
    if (closeBrace === -1) break;
    const innerStart = openBrace + 1;
    const innerEnd = closeBrace;
    slots.push({
      id: `${kind}-${slots.length}`,
      kind,
      text: tex.slice(innerStart, innerEnd),
      span: { start: innerStart, end: innerEnd },
    });
    searchFrom = closeBrace + 1;
  }
  return slots;
}

/**
 * @param {string} tex
 * @returns {Array<{id: string, kind: string, text: string, span: {start: number, end: number}}>}
 */
function extractSkillValues(tex) {
  const slots = [];
  let searchFrom = 0;
  while (searchFrom < tex.length) {
    const idx = tex.indexOf('\\textbf{', searchFrom);
    if (idx === -1) break;
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
      id: `skill-${slots.length}`,
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
    return [
      ...extractMacroBodies(tex, 'resumeItem', 'bullet'),
      ...extractSkillValues(tex),
    ];
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
