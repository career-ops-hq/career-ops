#!/usr/bin/env node
// Renders the Sponsors section of README.md, and the sponsor rows of every
// README.<lang>.md, from .github/sponsors.json.
//
//   node .github/scripts/sponsors.mjs           # print the rendered English section
//   node .github/scripts/sponsors.mjs --write   # rewrite the section / rows in every README
//   node .github/scripts/sponsors.mjs --check   # exit 1 if any README drifted
//
// There are no HTML markers in the READMEs: the English section is located by
// its "## Sponsors" heading and runs to the next "## " heading, and the rows
// (the logo <p> and the description <p> per sponsor) are located in every
// translation by their HTML shape. Heading, intro sentence and the
// independence note are translated prose owned by the i18n harness; the rows
// are language-invariant (name and description are rendered verbatim,
// untranslated) so they are byte-identical across all 17 files and can be
// pinned by one check. Adding a sponsor is one JSON entry plus --write;
// test-all.mjs runs --check so the READMEs and the JSON cannot disagree.
// Every logo must be a file inside docs/sponsors/ (no hotlinking). The link
// carries no tracking parameters.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../../lib/is-main-module.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const README = join(ROOT, 'README.md');
const DATA = join(ROOT, '.github', 'sponsors.json');
const LOGO_DIR = 'docs/sponsors/';
const LOGO_HEIGHT = 48;

// English copy of the section. Translations carry their own heading, intro and
// note; only the rows are shared.
export const HEADING = '## Sponsors';
export const INTRO = "career-ops is free for candidates, forever. The companies below fund the maintainer's time and keep it that way.";
export const NOTE = 'Sponsorship buys clearly labeled visibility, never influence: no amount of money changes the roadmap or places anything in the product. Sponsors never appear in evaluations, rankings or recommendations.';

// Where the section sits in README.md: after the community section, before the
// value proposition. Placement is part of the sponsorship agreement.
export const HEADING_BEFORE = "## You don't have to search alone";
export const HEADING_AFTER = '## What career-ops does for you';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function loadSponsors() {
  const { sponsors } = JSON.parse(readFileSync(DATA, 'utf8'));
  if (!Array.isArray(sponsors)) throw new Error('.github/sponsors.json: "sponsors" must be an array');
  const problems = [];
  const orders = new Set();
  for (const s of sponsors) {
    for (const k of ['id', 'name', 'url', 'logo', 'description']) if (!s[k]) problems.push(`${s.id || '?'}: missing "${k}"`);
    if (s.url && !/^https:\/\//.test(s.url)) problems.push(`${s.id}: url must be https`);
    // The sponsor's landing page is the agreed link, as-is: no UTM or other
    // tracking parameters of ours are appended.
    if (s.url && /[?&#]/.test(s.url)) problems.push(`${s.id}: url must carry no query string, tracking parameters or fragment`);
    if (s.logo && !s.logo.startsWith(LOGO_DIR)) problems.push(`${s.id}: logo must live in ${LOGO_DIR}`);
    if (s.logo && !existsSync(join(ROOT, s.logo))) problems.push(`${s.id}: logo file not found: ${s.logo}`);
    if (s.label !== undefined && typeof s.label !== 'string') problems.push(`${s.id}: "label" must be a string (empty unless the agreement grants a badge)`);
    // Placement is agreed per sponsor, so it is an explicit number: a sort by
    // date or name would silently reorder the row the day a second entry lands.
    if (!Number.isInteger(s.order) || s.order < 1) problems.push(`${s.id}: "order" must be a positive integer (1 = most visible)`);
    else if (orders.has(s.order)) problems.push(`${s.id}: "order" ${s.order} is already taken`);
    else orders.add(s.order);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return [...sponsors].sort((a, b) => a.order - b.order);
}

// The language-invariant part: per sponsor, a centered logo linked to the
// sponsor, then a centered one-line description led by the name.
export function renderRows(sponsors) {
  return sponsors.map((s) => {
    const label = s.label ? ` · ${esc(s.label)}` : '';
    return [
      '<p align="center">',
      `  <a href="${esc(s.url)}" title="${esc(s.name)}"><img src="${esc(s.logo)}" alt="${esc(s.name)}" height="${LOGO_HEIGHT}"></a>`,
      '</p>',
      '',
      `<p align="center"><strong>${esc(s.name)}</strong>${label} · ${esc(s.description)}</p>`,
    ].join('\n');
  }).join('\n\n');
}

// The whole English section, heading included, as it appears in README.md.
export function renderSection(sponsors) {
  return `${HEADING}\n\n${INTRO}\n\n${renderRows(sponsors)}\n\n> ${NOTE}`;
}

// README.md: the section runs from its heading to the next "## " heading.
export function sectionRange(text) {
  const start = text.indexOf(`\n${HEADING}\n`);
  if (start === -1) return null;
  const from = start + 1;
  const next = text.indexOf('\n## ', from + HEADING.length);
  return { from, to: next === -1 ? text.length : next + 1 };
}

export function currentSection(text = readFileSync(README, 'utf8')) {
  const r = sectionRange(text);
  return r ? text.slice(r.from, r.to).replace(/\s+$/, '') : null;
}

// Translations: the rows run from the centered <p> that opens the first logo
// linked from docs/sponsors/ up to the description <p> that precedes the
// blockquoted note. Shape-based so it survives a translated heading.
export function rowsRange(text) {
  const logo = text.indexOf(`src="${LOGO_DIR}`);
  if (logo === -1) return null;
  const open = text.lastIndexOf('<p align="center">\n  <a href=', logo);
  if (open === -1) return null;
  const note = text.indexOf('\n> ', logo);
  if (note === -1) return null;
  const closeP = text.lastIndexOf('</p>', note);
  if (closeP === -1 || closeP < logo) return null;
  return { from: open, to: closeP + '</p>'.length };
}

export function currentRows(text) {
  const r = rowsRange(text);
  return r ? text.slice(r.from, r.to) : null;
}

export function localizedReadmes() {
  return readdirSync(ROOT).filter((f) => /^README\..+\.md$/.test(f)).sort();
}

// Returns a list of drift descriptions; empty when every README matches.
export function checkAll() {
  const sponsors = loadSponsors();
  const problems = [];
  const en = readFileSync(README, 'utf8');
  const cur = currentSection(en);
  if (cur === null) problems.push(`README.md: no "${HEADING}" section`);
  else if (cur !== renderSection(sponsors)) problems.push('README.md: Sponsors section drifted from .github/sponsors.json');
  const iBefore = en.indexOf(`\n${HEADING_BEFORE}\n`);
  const iHere = en.indexOf(`\n${HEADING}\n`);
  const iAfter = en.indexOf(`\n${HEADING_AFTER}\n`);
  if (iBefore === -1 || iAfter === -1) problems.push(`README.md: expected both "${HEADING_BEFORE}" and "${HEADING_AFTER}" headings`);
  else if (!(iBefore < iHere && iHere < iAfter)) problems.push(`README.md: "${HEADING}" must sit between "${HEADING_BEFORE}" and "${HEADING_AFTER}"`);
  const rows = renderRows(sponsors);
  for (const file of localizedReadmes()) {
    const got = currentRows(readFileSync(join(ROOT, file), 'utf8'));
    if (got === null) problems.push(`${file}: sponsor rows not found`);
    else if (got !== rows) problems.push(`${file}: sponsor rows drifted from .github/sponsors.json`);
  }
  return problems;
}

export function writeAll() {
  const sponsors = loadSponsors();
  const written = [];
  const en = readFileSync(README, 'utf8');
  const r = sectionRange(en);
  if (!r) throw new Error(`README.md has no "${HEADING}" section to rewrite`);
  const next = en.slice(0, r.from) + renderSection(sponsors) + '\n\n' + en.slice(r.to).replace(/^\n+/, '');
  if (next !== en) { writeFileSync(README, next); written.push('README.md'); }
  const rows = renderRows(sponsors);
  for (const file of localizedReadmes()) {
    const path = join(ROOT, file);
    const text = readFileSync(path, 'utf8');
    const rr = rowsRange(text);
    if (!rr) throw new Error(`${file}: sponsor rows not found; the translated section must exist before --write can update its rows`);
    const out = text.slice(0, rr.from) + rows + text.slice(rr.to);
    if (out !== text) { writeFileSync(path, out); written.push(file); }
  }
  return written;
}

function main() {
  const mode = process.argv[2] || '';
  if (mode === '--write') {
    const written = writeAll();
    console.log(written.length ? `sponsors updated in: ${written.join(', ')}` : 'every README already matches .github/sponsors.json');
    return;
  }
  if (mode === '--check') {
    const problems = checkAll();
    if (!problems.length) { console.log('README.md and every README.<lang>.md match .github/sponsors.json'); return; }
    console.error(problems.join('\n'));
    console.error('Run: node .github/scripts/sponsors.mjs --write');
    process.exit(1);
  }
  console.log(renderSection(loadSponsors()));
}

if (isMainModule(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
