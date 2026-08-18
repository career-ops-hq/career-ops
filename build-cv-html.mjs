#!/usr/bin/env node

// Deterministic HTML CV renderer (#557 — the HTML twin of build-cv-latex.mjs).
//
// The agent reads cv.md + config/profile.yml, tailors the content, and writes a
// compact JSON payload. This script merges that payload into the resolved CV
// template (default templates/cv-template.html; pass a path resolved by
// cv-templates.mjs to honor config-selectable templates, #1691) — it owns every
// tag, class, and the HTML escaping,
// so the model never has to emit the full document. That moves the PDF step's
// output tokens from full HTML markup down to the structured JSON payload while
// producing byte-for-byte the same ATS-safe template the agent fills today.
//
// The script does NOT parse cv.md / YAML: the authoritative read of the source
// files stays in the agent (same contract as build-cv-latex.mjs / modes/latex.md).
// generate-pdf.mjs remains the single PDF renderer and is unchanged.
//
// Section HTML partials (#2183):
//   A template pack can ship a sections/ directory alongside the main template
//   file (e.g. templates/sections/ for the built-in templates). When a partial
//   file exists for a section (e.g. sections/experience.html), the builder uses
//   that file's markup instead of the hard-coded tag structure. Partials follow
//   the same {{PLACEHOLDER}} convention used by the main template but carry
//   entry-level field names (COMPANY, PERIOD, ROLE, etc.). When no partial file
//   is found the built-in fallback builder is used, preserving full backward
//   compatibility.

import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname, basename, join, extname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { stripEmptySections } from './cv-sections-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, 'templates', 'cv-template.html');
const PLACEHOLDER_RE = /\{\{[A-Z_]+\}\}/g;
const CONTACT_ROW_RE = /<div class="contact-row">[\s\S]*?<\/div>/;

const PAGE_WIDTHS = { letter: '8.5in', a4: '210mm' };
const PHOTO_MIME_BY_EXT = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);
const PHOTO_STYLES = new Set(['rounded', 'circle', 'square']);
const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i;

const DEFAULT_SECTION_TITLES = {
  summary: 'Professional Summary',
  competencies: 'Core Competencies',
  experience: 'Work Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  awards: 'Awards & Honors',
  skills: 'Skills',
};

// Escape user text for HTML text/attribute context. Covers the five characters
// that change meaning in markup so tailored bullets containing &, <, >, quotes
// (e.g. "R&D", "scaled 10x < budget", 'the "north star" metric') render as
// literal text instead of breaking the document or injecting tags.
function escapeHtml(text) {
  // Blank out only truly absent/structural values. A number or boolean scalar
  // (e.g. a payload with `year: 2024` instead of `"2024"`) must render its value,
  // not vanish: the old `typeof text !== 'string' → ''` guard silently dropped
  // numeric years/dates from the CV while `present` stayed true.
  if (text === null || text === undefined || typeof text === 'object') return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sanitize a URL for an href attribute: only allow the schemes the template's
// contact row uses, coerce bare emails/domains, drop javascript:/data: and other
// script-bearing schemes, then HTML-escape for the attribute context.
function sanitizeUrl(url) {
  if (typeof url !== 'string') return '';
  url = url.trim();
  if (!url) return '';
  const allowedSchemes = ['mailto:', 'tel:', 'http:', 'https:'];
  const lower = url.toLowerCase();
  const hasScheme = allowedSchemes.some(s => lower.startsWith(s));
  if (!hasScheme) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      // An explicit but disallowed scheme (javascript:, data:, …) — reject it.
      return '';
    }
    if (url.includes('@') && !url.includes('/')) {
      url = 'mailto:' + url;
    } else {
      url = 'https://' + url;
    }
  }
  return escapeHtml(url);
}

function sanitizeImageSrc(src) {
  if (typeof src !== 'string') return '';
  const value = src.trim();
  if (IMAGE_DATA_URL_RE.test(value)) return escapeHtml(value);
  if (/^https?:\/\//i.test(value)) return sanitizeUrl(value);
  return '';
}

async function prepareCandidatePhoto(candidate) {
  const c = candidate && typeof candidate === 'object' ? { ...candidate } : {};
  const photo = typeof c.photo === 'string' ? c.photo.trim() : '';
  const style = c.photo_style || c.photoStyle || 'rounded';

  if (!PHOTO_STYLES.has(style)) {
    throw new Error(`Unsupported profile photo style: ${style} (expected rounded, circle, or square)`);
  }
  c.photo_style = style;
  if (!photo) {
    c.photo = '';
    return c;
  }

  if (photo.startsWith('data:')) {
    if (!IMAGE_DATA_URL_RE.test(photo)) {
      throw new Error('Unsupported profile photo data URL (expected base64 PNG, JPEG, WebP, or GIF)');
    }
    c.photo = photo;
    return c;
  }

  if (/^https?:\/\//i.test(photo)) {
    c.photo = photo;
    return c;
  }

  if (/^[a-z][a-z0-9+.-]+:/i.test(photo)) {
    throw new Error(`Unsupported profile photo URL scheme: ${photo.split(':', 1)[0]}`);
  }

  const photoPath = isAbsolute(photo) ? photo : resolve(__dirname, photo);
  const mime = PHOTO_MIME_BY_EXT.get(extname(photoPath).toLowerCase());
  if (!mime) {
    throw new Error(`Unsupported profile photo format: ${photo} (expected PNG, JPEG, WebP, or GIF)`);
  }

  let bytes;
  try {
    bytes = await readFile(photoPath);
  } catch (err) {
    throw new Error(`Profile photo not found or unreadable: ${photo} (${err.code || err.message})`);
  }
  if (bytes.length === 0) {
    throw new Error(`Profile photo is empty: ${photo}`);
  }
  c.photo = `data:${mime};base64,${bytes.toString('base64')}`;
  return c;
}

function joinItems(items) {
  if (Array.isArray(items)) return items.join(', ');
  return typeof items === 'string' ? items : '';
}

// ── Section partials (#2183) ────────────────────────────────────────────────
//
// Resolve the sections/ directory co-located with a given template file.
// For "templates/cv-template.html" this is "templates/sections/".
// For a custom pack at "templates/cv-template.compact.html" we look for
// "templates/sections/" first (shared by all templates in that directory),
// then fall back to the built-in builders.
//
// Partial file format (v2 — ENTRY zone):
//   The file is split into two zones:
//
//   1. Documentation zone (before <!--ENTRY--> and after <!--/ENTRY-->):
//      Free-form HTML comments or text. Completely ignored by the parser.
//
//   2. Entry zone (inside <!--ENTRY-->...<!--/ENTRY-->):
//      Contains the per-entry HTML template. {{PLACEHOLDER}} references are
//      filled by fillEntry(). Optional conditional-block *definitions* are
//      placed here too, encoded as HTML comments:
//
//        <!--BLOCK_NAME--><tag>{{PLACEHOLDER}}</tag><!--/BLOCK_NAME-->
//
//      The builder extracts block definitions first, then the remaining markup
//      becomes the entry template. When a field is absent the entire block is
//      replaced with '' (or with the <!--BLOCK_NAME_EMPTY--> fallback if one
//      is defined, which the certifications partial uses for alignment).
//
// By keeping documentation outside the ENTRY zone we never need to strip
// arbitrary HTML comments from the entry template, which avoids the
// CodeQL js/incomplete-multi-character-sanitization rule entirely.

// Parse a partial file and return:
//   { entryTemplate: string, blocks: Map<name, {present: string, absent: string}> }
//
// The entry template is extracted from inside <!--ENTRY-->...<!--/ENTRY-->.
// Named conditional-block definitions are extracted from the same zone and
// removed to leave the clean entry template. No HTML comment stripping is
// performed on arbitrary content (no CodeQL sanitization concern).
function parsePartial(source) {
  // Step 1: locate the ENTRY zone.
  const entryZoneMatch = /<!--ENTRY-->([\s\S]*?)<!--\/ENTRY-->/.exec(source);
  const entryZone = entryZoneMatch ? entryZoneMatch[1] : source;

  // Step 2: extract named conditional-block definitions from the entry zone.
  const blockRe = /<!--([A-Z][A-Z0-9_]+)-->([\s\S]*?)<!--\/\1-->/g;
  const blocks = new Map();
  // Collect the exact definition strings (open-tag + content + close-tag) so we
  // can remove them verbatim from the entry zone in step 3, without needing any
  // broad HTML-comment regex (which would trigger CodeQL).
  const definitionStrings = [];
  // Collect every definition first. The _EMPTY fallbacks are resolved in a
  // second pass because a fallback may be defined before the block it belongs
  // to, and pairing needs to know which block names exist.
  const definitions = new Map();
  let m;
  while ((m = blockRe.exec(entryZone)) !== null) {
    const name = m[1];
    const content = m[2];
    if (name === 'ENTRY') continue; // skip the sentinel itself
    definitionStrings.push(m[0]); // full match, e.g. <!--FOO-->bar<!--/FOO-->
    definitions.set(name, content);
  }

  const EMPTY_SUFFIX = '_EMPTY';
  for (const [name, content] of definitions) {
    if (name.endsWith(EMPTY_SUFFIX)) continue;
    const existing = blocks.get(name) || { present: '', absent: '' };
    blocks.set(name, { ...existing, present: content });
  }
  // An EMPTY variant is the absent-field fallback for a sibling block, and the
  // renderer looks it up under the block's own name. Both spellings pair to the
  // same block: <!--ORG_EMPTY--> and <!--ORG_BLOCK_EMPTY--> attach to ORG_BLOCK.
  // Falling back to the bare stem keeps a FOO_EMPTY/FOO pair working.
  for (const [name, content] of definitions) {
    if (!name.endsWith(EMPTY_SUFFIX)) continue;
    const stem = name.slice(0, -EMPTY_SUFFIX.length);
    const base = definitions.has(`${stem}_BLOCK`) ? `${stem}_BLOCK` : stem;
    const existing = blocks.get(base) || { present: '', absent: '' };
    blocks.set(base, { ...existing, absent: content });
  }

  // Step 3: build the entry template by removing the captured block *definitions*
  // verbatim. Block *references* ({{BLOCKNAME}}) remain and are resolved by
  // fillEntry() at render time.
  // We use split/join on the exact captured strings — no broad HTML-comment regex,
  // so CodeQL js/incomplete-multi-character-sanitization cannot fire.
  let entryTemplate = entryZone;
  for (const def of definitionStrings) {
    entryTemplate = entryTemplate.split(def).join('');
  }
  entryTemplate = entryTemplate.trim();

  return { entryTemplate, blocks };
}

// Fill an entry template with a map of { PLACEHOLDER: value } substitutions,
// resolving conditional blocks before the normal field fill.
// blockValues: Map<name, { value: string, present: boolean }> drives which
// conditional markup variant to use.
function fillEntry(entryTemplate, blocks, fields, blockValues) {
  let out = entryTemplate;

  // Every replacement below passes a FUNCTION rather than the value directly.
  // A string replacement argument is scanned by JS for $-patterns, so candidate
  // text containing $&, $', $` or $$ (escaping leaves those sequences intact)
  // would splice part of the template into the CV instead of being inserted
  // literally. A replacer function's return value is never interpreted.

  // Resolve conditional blocks: replace {{BLOCK_NAME}} with the
  // present/absent markup depending on whether the field has a value.
  if (blockValues) {
    for (const [name, { value, present }] of blockValues) {
      const block = blocks.get(name);
      if (!block) continue;
      const markup = present ? block.present.replace(`{{${name}}}`, () => value) : block.absent;
      out = out.replace(`{{${name}}}`, () => markup);
    }
  }

  // Fill remaining scalar placeholders.
  for (const [key, value] of Object.entries(fields)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => value);
  }

  return out;
}

// Load section partials from the sections/ directory co-located with the
// template. Returns a Map<sectionName, { entryTemplate, blocks }> for each
// partial file found. Sections with no partial file are absent from the map
// and fall back to the built-in builders.
function loadSectionPartials(templatePath) {
  const sectionsDir = join(dirname(templatePath), 'sections');
  const partials = new Map();
  if (!existsSync(sectionsDir)) return partials;

  const sectionNames = [
    'competencies', 'experience', 'projects', 'education', 'certifications', 'awards', 'skills',
  ];
  for (const name of sectionNames) {
    const partialPath = join(sectionsDir, `${name}.html`);
    if (!existsSync(partialPath)) continue;
    try {
      const source = readFileSync(partialPath, 'utf-8');
      partials.set(name, parsePartial(source));
    } catch {
      // Silently skip malformed partial files — fall back to built-in builder.
    }
  }
  return partials;
}

// ── Section builders ────────────────────────────────────────────────────────
// Each builder accepts an optional `partial` argument ({ entryTemplate, blocks }).
// When a partial is provided the builder fills the partial's template instead
// of its built-in tag structure. When partial is undefined/null the original
// hard-coded output is produced (full backward compatibility).

function buildCompetencies(entries, partial) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  if (!partial) {
    return entries
      .filter(Boolean)
      .map(tag => `<span class="competency-tag">${escapeHtml(String(tag))}</span>`)
      .join('\n      ');
  }
  const { entryTemplate, blocks } = partial;
  return entries
    .filter(Boolean)
    .map(tag => fillEntry(entryTemplate, blocks, { TAG: escapeHtml(String(tag)) }, null))
    .join('\n      ');
}

function buildExperience(entries, partial) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  if (!partial) {
    return entries.filter(Boolean).map(e => {
      const bullets = Array.isArray(e.bullets)
        ? e.bullets.filter(Boolean).map(b => `        <li>${escapeHtml(b)}</li>`).join('\n')
        : '';
      const location = e.location
        ? `\n    <div class="job-location">${escapeHtml(e.location)}</div>`
        : '';
      return `<div class="job">
    <div class="job-header">
      <span class="job-company">${escapeHtml(e.company)}</span>
      <span class="job-period">${escapeHtml(e.dates || e.period || '')}</span>
    </div>
    <div class="job-role">${escapeHtml(e.role)}</div>${location}
    <ul>
${bullets}
    </ul>
  </div>`;
    }).join('\n  ');
  }

  const { entryTemplate, blocks } = partial;
  return entries.filter(Boolean).map(e => {
    const bullets = Array.isArray(e.bullets)
      ? e.bullets.filter(Boolean).map(b => `<li>${escapeHtml(b)}</li>`).join('\n    ')
      : '';
    const blockValues = new Map([
      ['LOCATION_BLOCK', { value: escapeHtml(e.location || ''), present: Boolean(e.location) }],
    ]);
    return fillEntry(entryTemplate, blocks, {
      COMPANY: escapeHtml(e.company || ''),
      PERIOD: escapeHtml(e.dates || e.period || ''),
      ROLE: escapeHtml(e.role || ''),
      LOCATION: escapeHtml(e.location || ''),
      BULLETS: bullets,
    }, blockValues);
  }).join('\n  ');
}

function buildProjects(entries, partial) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  if (!partial) {
    return entries.filter(Boolean).map(e => {
      const badge = e.badge
        ? `<span class="project-badge">${escapeHtml(e.badge)}</span>`
        : '';
      // Prefer a single description; fall back to joining bullets into one line so
      // a bullets-shaped payload still renders inside the .project-desc block.
      const descText = e.description
        || (Array.isArray(e.bullets) ? e.bullets.filter(Boolean).join(' ') : '');
      const desc = descText
        ? `\n    <div class="project-desc">${escapeHtml(descText)}</div>`
        : '';
      const tech = e.tech
        ? `\n    <div class="project-tech">${escapeHtml(e.tech)}</div>`
        : '';
      return `<div class="project">
    <div class="project-title">${escapeHtml(e.name)}${badge}</div>${desc}${tech}
  </div>`;
    }).join('\n  ');
  }

  const { entryTemplate, blocks } = partial;
  return entries.filter(Boolean).map(e => {
    const descText = e.description
      || (Array.isArray(e.bullets) ? e.bullets.filter(Boolean).join(' ') : '');
    const blockValues = new Map([
      ['BADGE_BLOCK', { value: escapeHtml(e.badge || ''), present: Boolean(e.badge) }],
      ['DESC_BLOCK',  { value: escapeHtml(descText),      present: Boolean(descText) }],
      ['TECH_BLOCK',  { value: escapeHtml(e.tech || ''),  present: Boolean(e.tech) }],
    ]);
    return fillEntry(entryTemplate, blocks, {
      NAME:  escapeHtml(e.name || ''),
      BADGE: escapeHtml(e.badge || ''),
      DESC:  escapeHtml(descText),
      TECH:  escapeHtml(e.tech || ''),
    }, blockValues);
  }).join('\n  ');
}

function buildEducation(entries, partial) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  if (!partial) {
    return entries.filter(Boolean).map(e => {
      const org = e.org
        ? ` <span class="edu-org">${escapeHtml(e.org)}</span>`
        : '';
      const desc = e.description
        ? `\n    <div class="edu-desc">${escapeHtml(e.description)}</div>`
        : '';
      return `<div class="edu-item">
    <div class="edu-header">
      <div class="edu-title">${escapeHtml(e.title)}${org}</div>
      <div class="edu-year">${escapeHtml(e.year || '')}</div>
    </div>${desc}
  </div>`;
    }).join('\n  ');
  }

  const { entryTemplate, blocks } = partial;
  return entries.filter(Boolean).map(e => {
    const blockValues = new Map([
      ['ORG_BLOCK',  { value: escapeHtml(e.org || ''),         present: Boolean(e.org) }],
      ['DESC_BLOCK', { value: escapeHtml(e.description || ''), present: Boolean(e.description) }],
    ]);
    return fillEntry(entryTemplate, blocks, {
      TITLE: escapeHtml(e.title || ''),
      ORG:   escapeHtml(e.org || ''),
      YEAR:  escapeHtml(e.year || ''),
      DESC:  escapeHtml(e.description || ''),
    }, blockValues);
  }).join('\n  ');
}

function buildCertifications(entries, partial) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  if (!partial) {
    return entries.filter(Boolean).map(e => {
      const org = e.org ? `<span class="cert-org">${escapeHtml(e.org)}</span>` : '<span class="cert-org"></span>';
      const year = e.year ? `<span class="cert-year">${escapeHtml(e.year)}</span>` : '<span class="cert-year"></span>';
      return `<div class="cert-item">
      <span class="cert-title">${escapeHtml(e.title)}</span>
      ${org}
      ${year}
    </div>`;
    }).join('\n    ');
  }

  const { entryTemplate, blocks } = partial;
  return entries.filter(Boolean).map(e => {
    const blockValues = new Map([
      // An absent field resolves to the partial's _EMPTY fallback, emitting an
      // empty <span> for table-cell alignment rather than being removed.
      ['ORG_BLOCK',  { value: escapeHtml(e.org || ''),  present: Boolean(e.org) }],
      ['YEAR_BLOCK', { value: escapeHtml(e.year || ''), present: Boolean(e.year) }],
    ]);
    return fillEntry(entryTemplate, blocks, {
      TITLE: escapeHtml(e.title || ''),
      ORG:   escapeHtml(e.org || ''),
      YEAR:  escapeHtml(e.year || ''),
    }, blockValues);
  }).join('\n    ');
}

// Awards mirror certifications: a title with an optional issuing body and year,
// laid out on one baseline. Kept as its own builder rather than an alias so the
// two can diverge (and so awards.html can be authored independently of
// certifications.html) without one section's markup leaking into the other.
function buildAwards(entries, partial) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  if (!partial) {
    return entries.filter(Boolean).map(e => {
      const org = e.org ? `<span class="award-org">${escapeHtml(e.org)}</span>` : '<span class="award-org"></span>';
      const year = e.year ? `<span class="award-year">${escapeHtml(e.year)}</span>` : '<span class="award-year"></span>';
      return `<div class="award-item">
      <span class="award-title">${escapeHtml(e.title)}</span>
      ${org}
      ${year}
    </div>`;
    }).join('\n    ');
  }

  const { entryTemplate, blocks } = partial;
  return entries.filter(Boolean).map(e => {
    const blockValues = new Map([
      // As with certifications, an absent field resolves to the partial's
      // _EMPTY fallback so the table cells stay aligned across rows.
      ['ORG_BLOCK',  { value: escapeHtml(e.org || ''),  present: Boolean(e.org) }],
      ['YEAR_BLOCK', { value: escapeHtml(e.year || ''), present: Boolean(e.year) }],
    ]);
    return fillEntry(entryTemplate, blocks, {
      TITLE: escapeHtml(e.title || ''),
      ORG:   escapeHtml(e.org || ''),
      YEAR:  escapeHtml(e.year || ''),
    }, blockValues);
  }).join('\n    ');
}

function buildSkills(categories, partial) {
  if (!Array.isArray(categories) || categories.length === 0) return '';
  if (!partial) {
    const items = categories.filter(Boolean).map(c => {
      const cat = c.category
        ? `<span class="skill-category">${escapeHtml(c.category)}:</span> `
        : '';
      return `    <div class="skill-item">${cat}${escapeHtml(joinItems(c.items))}</div>`;
    }).join('\n');
    return `<div class="skills-grid">\n${items}\n  </div>`;
  }

  const { entryTemplate, blocks } = partial;
  const items = categories.filter(Boolean).map(c => {
    const blockValues = new Map([
      ['CATEGORY_BLOCK', { value: escapeHtml(c.category || ''), present: Boolean(c.category) }],
    ]);
    return fillEntry(entryTemplate, blocks, {
      CATEGORY:    escapeHtml(c.category || ''),
      ITEMS_TEXT:  escapeHtml(joinItems(c.items)),
    }, blockValues);
  }).join('\n');
  return items;
}

// Rebuild the whole .contact-row block. Its markup uses fixed "|" separators
// between phone / email / linkedin / github / portfolio / location, so an
// absent optional field (phone, linkedin, github, portfolio) must drop BOTH
// its <a> and one separator. Building the present items and joining them is
// more robust than excising separators from the template one placeholder at
// a time.
function buildContactRow(candidate) {
  const c = candidate || {};
  const items = [];
  if (c.phone) {
    const tel = sanitizeUrl('tel:' + String(c.phone).replace(/\s+/g, ''));
    items.push(`<a href="${tel}">${escapeHtml(c.phone)}</a>`);
  }
  if (c.email) {
    items.push(`<a href="${sanitizeUrl('mailto:' + c.email)}">${escapeHtml(c.email)}</a>`);
  }
  if (c.linkedin && c.linkedin.url) {
    items.push(`<a href="${sanitizeUrl(c.linkedin.url)}">${escapeHtml(c.linkedin.display || c.linkedin.url)}</a>`);
  }
  if (c.github && c.github.url) {
    const githubHref = sanitizeUrl(c.github.url);
    if (githubHref) {
      items.push(`<a href="${githubHref}">${escapeHtml(c.github.display || c.github.url)}</a>`);
    }
  }
  if (c.portfolio && c.portfolio.url) {
    items.push(`<a href="${sanitizeUrl(c.portfolio.url)}">${escapeHtml(c.portfolio.display || c.portfolio.url)}</a>`);
  }
  if (c.location) {
    items.push(`<span>${escapeHtml(c.location)}</span>`);
  }
  const sep = '\n      <span class="separator">|</span>\n      ';
  return `<div class="contact-row">\n      ${items.join(sep)}\n    </div>`;
}

function buildPhoto(candidate, name) {
  const photo = candidate && candidate.photo;
  if (!photo) return '';
  const style = PHOTO_STYLES.has(candidate.photo_style) ? candidate.photo_style : 'rounded';
  return `<img class="cv-photo cv-photo--${style}" src="${sanitizeImageSrc(photo)}" alt="${escapeHtml(name || '')}">`;
}

function renderReport(payload, partials) {
  const sectionTitles = { ...DEFAULT_SECTION_TITLES, ...(payload.sections || {}) };
  const candidate = payload.candidate || {};
  const pageWidth = PAGE_WIDTHS[payload.page_format] || PAGE_WIDTHS.letter;

  const substitutions = {
    LANG: escapeHtml(payload.lang || 'en'),
    PAGE_WIDTH: pageWidth,
    NAME: escapeHtml(candidate.name || ''),
    SECTION_SUMMARY: escapeHtml(sectionTitles.summary),
    SUMMARY_TEXT: escapeHtml(payload.summary || ''),
    SECTION_COMPETENCIES: escapeHtml(sectionTitles.competencies),
    COMPETENCIES: buildCompetencies(payload.competencies, partials.get('competencies')),
    SECTION_EXPERIENCE: escapeHtml(sectionTitles.experience),
    EXPERIENCE: buildExperience(payload.experience, partials.get('experience')),
    SECTION_PROJECTS: escapeHtml(sectionTitles.projects),
    PROJECTS: buildProjects(payload.projects, partials.get('projects')),
    SECTION_EDUCATION: escapeHtml(sectionTitles.education),
    EDUCATION: buildEducation(payload.education, partials.get('education')),
    SECTION_CERTIFICATIONS: escapeHtml(sectionTitles.certifications),
    CERTIFICATIONS: buildCertifications(payload.certifications, partials.get('certifications')),
    SECTION_AWARDS: escapeHtml(sectionTitles.awards),
    AWARDS: buildAwards(payload.awards, partials.get('awards')),
    SECTION_SKILLS: escapeHtml(sectionTitles.skills),
    SKILLS: buildSkills(payload.skills, partials.get('skills')),
  };
  return { substitutions, candidate };
}

// Merge a payload into the template and return the final HTML (throws on any
// unresolved {{PLACEHOLDER}} so a malformed payload fails loudly, not silently).
function renderHtml(template, payload, templatePath) {
  // Load section partials from the sections/ directory co-located with the
  // template. Falls back to built-in builders when no partials directory exists.
  const partials = templatePath ? loadSectionPartials(templatePath) : new Map();

  const { substitutions, candidate } = renderReport(payload, partials);

  // The contact row and photo carry conditional markup (dropped separators /
  // no <img>), so they are rebuilt as whole blocks before placeholder fill.
  let html = template.replace(CONTACT_ROW_RE, () => buildContactRow(candidate));
  html = html.replace(/\{\{PHOTO\}\}/g, () => buildPhoto(candidate, candidate.name));

  // Drop the optional sections (projects, education) that have no entries, so
  // an absent one leaves no bare header behind. See cv-sections-core.mjs.
  html = stripEmptySections(html, payload, 'html');

  for (const [key, value] of Object.entries(substitutions)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => value);
  }

  const unresolved = html.match(PLACEHOLDER_RE);
  if (unresolved) {
    throw new Error(`Unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
  }
  return html;
}

function countBullets(payload) {
  const ex = Array.isArray(payload.experience)
    ? payload.experience.flatMap(e => (Array.isArray(e?.bullets) ? e.bullets : []))
    : [];
  return ex.length;
}

async function writeAndReport(html, absOutput, payload, extra = {}) {
  const outDir = dirname(absOutput);
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });
  await writeFile(absOutput, html, 'utf-8');

  const fileInfo = await stat(absOutput);
  const report = {
    ...extra,
    file: basename(absOutput),
    path: absOutput,
    sizeKB: parseFloat((fileInfo.size / 1024).toFixed(1)),
    counts: {
      competencies: (payload.competencies || []).length,
      experienceEntries: (payload.experience || []).length,
      projectEntries: (payload.projects || []).length,
      educationEntries: (payload.education || []).length,
      certificationEntries: (payload.certifications || []).length,
      awardEntries: (payload.awards || []).length,
      skillCategories: (payload.skills || []).length,
      totalBullets: countBullets(payload),
    },
    valid: true,
  };
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.error('Usage:');
    console.error('  node build-cv-html.mjs <input.json> <output.html> [template.html]');
    console.error('  node build-cv-html.mjs --preview <input.json> [template.html]');
    console.error('  node build-cv-html.mjs --test');
    console.error('');
    console.error('  [template.html] defaults to templates/cv-template.html. Pass the path');
    console.error('  printed by `node cv-templates.mjs resolve cv` to use a selected template.');
    console.error('');
    console.error('  Section partials (#2183):');
    console.error('  If a sections/ directory exists alongside the template file,');
    console.error('  the builder loads per-section HTML partial files from it');
    console.error('  (e.g. sections/experience.html). Partials control the DOM');
    console.error('  structure, tag names, and class names for each section.');
    console.error('  When no partial file is found the built-in builder is used.');
    process.exit(args.includes('--help') ? 0 : 1);
  }

  if (args.includes('--test')) {
    await runSelfTest();
    return;
  }

  const preview = args[0] === '--preview';
  const [inputPath, outputPath, templateArg] = preview
    ? [args[1], resolve(__dirname, 'output', 'cv-preview.html'), args[2]]
    : args;
  if (!inputPath || !outputPath) {
    console.error('Usage: node build-cv-html.mjs <input.json> <output.html> [template.html]');
    process.exit(1);
  }

  const absInput = resolve(inputPath);
  const absOutput = resolve(outputPath);
  const templatePath = templateArg ? resolve(templateArg) : TEMPLATE_PATH;

  if (!existsSync(absInput)) {
    console.error(`Input file not found: ${absInput}`);
    process.exit(1);
  }
  if (!existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(await readFile(absInput, 'utf-8'));
    payload.candidate = await prepareCandidatePhoto(payload.candidate);
  } catch (err) {
    console.error(`Failed to prepare CV input: ${err.message}`);
    process.exit(1);
  }

  const template = await readFile(templatePath, 'utf-8');

  let html;
  try {
    html = renderHtml(template, payload, templatePath);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  await writeAndReport(html, absOutput, payload, preview ? { status: 'preview-ready' } : {});
  process.exit(0);
}

async function runSelfTest() {
  const sample = {
    lang: 'en',
    page_format: 'letter',
    candidate: {
      name: 'Test Candidate',
      phone: '+1 234 567 8900',
      email: 'test@example.com',
      linkedin: { url: 'https://linkedin.com/in/test', display: 'linkedin.com/in/test' },
      github: { url: 'https://github.com/test', display: 'github.com/test' },
      portfolio: { url: 'https://test.example.com', display: 'test.example.com' },
      location: 'City, State',
    },
    summary: 'Backend engineer with a focus on R&D and cost-efficient "north star" systems.',
    competencies: ['Cloud Architecture', 'RESTful API Design', 'Kubernetes & Docker'],
    experience: [{
      company: 'Test Corp',
      role: 'Test Engineer',
      location: 'Remote',
      dates: 'June 2024 - Present',
      bullets: [
        'Built automated testing pipelines with CI/CD integration',
        'Reduced regression test time by 60% through parallel execution',
      ],
    }],
    projects: [{
      name: 'Test Project',
      badge: 'Open Source',
      tech: 'Python, FastAPI, Docker',
      description: 'Built a REST API with automated test coverage exceeding 90%.',
    }],
    education: [{
      title: 'Bachelor of Science in Computer Science',
      org: 'Test University',
      year: '2024',
      description: 'Coursework: Data Structures, Algorithms, Machine Learning.',
    }],
    certifications: [{ title: 'Certified Kubernetes Administrator', org: 'CNCF', year: '2025' }],
    awards: [{ title: 'Gold Medal, International Olympiad in Informatics', org: 'IOI', year: '2023' }],
    skills: [
      { category: 'Languages', items: 'Python, JavaScript, TypeScript' },
      { category: 'Frameworks', items: ['FastAPI', 'React', 'PyTorch'] },
    ],
  };

  if (!existsSync(TEMPLATE_PATH)) {
    console.error(`Self-test failed: template not found at ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  const template = await readFile(TEMPLATE_PATH, 'utf-8');

  let html;
  try {
    html = renderHtml(template, sample, TEMPLATE_PATH);
  } catch (err) {
    console.error(`Self-test failed: ${err.message}`);
    process.exit(1);
  }

  // Guard the escaping contract: the raw ampersand from "Kubernetes & Docker"
  // must reach the output escaped, and no unescaped literal must survive.
  if (!html.includes('Kubernetes &amp; Docker')) {
    console.error('Self-test failed: HTML escaping did not apply to competency text');
    process.exit(1);
  }
  if (/Kubernetes & Docker/.test(html)) {
    console.error('Self-test failed: found an unescaped ampersand in output');
    process.exit(1);
  }

  // Guard the github contact-row case added for #2170: the link must render
  // with the sanitized href from the sample.
  if (!html.includes('href="https://github.com/test"')) {
    console.error('Self-test failed: github contact link missing from output');
    process.exit(1);
  }

  // Guard the absent-field side of the same case: omitting candidate.github
  // must drop both its anchor and its separator, leaving no dangling item.
  const { github, ...candidateWithoutGithub } = sample.candidate;
  const htmlWithoutGithub = renderHtml(template, { ...sample, candidate: candidateWithoutGithub });
  const countSeparators = (h) => (h.match(/class="separator"/g) || []).length;
  if (htmlWithoutGithub.includes('github.com/test')) {
    console.error('Self-test failed: github contact link rendered when candidate.github is absent');
    process.exit(1);
  }
  if (countSeparators(htmlWithoutGithub) !== countSeparators(html) - 1) {
    console.error('Self-test failed: omitting candidate.github left a dangling separator in the contact row');
    process.exit(1);
  }

  // Guard the rejected-scheme side: sanitizeUrl() must reject javascript:/data:
  // github URLs, which must drop the item and separator exactly like an
  // absent field, never fall through to an empty href="".
  const htmlWithRejectedGithub = renderHtml(template, {
    ...sample,
    candidate: { ...sample.candidate, github: { url: 'javascript:alert(1)', display: 'github.com/test' } },
  });
  if (htmlWithRejectedGithub.includes('href=""') || htmlWithRejectedGithub.includes('github.com/test')) {
    console.error('Self-test failed: rejected github URL still rendered a contact item');
    process.exit(1);
  }
  if (countSeparators(htmlWithRejectedGithub) !== countSeparators(html) - 1) {
    console.error('Self-test failed: rejected github URL left a dangling separator in the contact row');
    process.exit(1);
  }

  // Guard that section partial rendering produces expected class names (so a
  // broken partial file doesn't silently remove structural markup).
  if (!html.includes('class="job"')) {
    console.error('Self-test failed: experience section is missing .job class — partial may be broken');
    process.exit(1);
  }
  if (!html.includes('class="competency-tag"')) {
    console.error('Self-test failed: competencies section is missing .competency-tag class');
    process.exit(1);
  }
  if (!html.includes('class="project"')) {
    console.error('Self-test failed: projects section is missing .project class');
    process.exit(1);
  }
  if (!html.includes('class="edu-item"')) {
    console.error('Self-test failed: education section is missing .edu-item class');
    process.exit(1);
  }
  if (!html.includes('class="cert-item"')) {
    console.error('Self-test failed: certifications section is missing .cert-item class');
    process.exit(1);
  }
  if (!html.includes('class="award-item"')) {
    console.error('Self-test failed: awards section is missing .award-item class');
    process.exit(1);
  }

  // Guard that partials-based rendering produces the correct field values.
  if (!html.includes('Test Corp') || !html.includes('Test Engineer')) {
    console.error('Self-test failed: experience entry fields not found in output');
    process.exit(1);
  }

  // Guard that conditional blocks work: location present → rendered; absent → not.
  if (!html.includes('class="job-location"')) {
    console.error('Self-test failed: job-location block not rendered when location is present');
    process.exit(1);
  }

  // Test with an experience entry that has no location to verify the LOCATION_BLOCK
  // conditional removal path.
  const noLocSample = {
    ...sample,
    experience: [{ company: 'Acme', role: 'Engineer', dates: '2023', bullets: [] }],
    projects: [],
  };
  let noLocHtml;
  try {
    noLocHtml = renderHtml(template, noLocSample, TEMPLATE_PATH);
  } catch (err) {
    console.error(`Self-test failed (no-location variant): ${err.message}`);
    process.exit(1);
  }
  if (noLocHtml.includes('class="job-location"')) {
    console.error('Self-test failed: job-location block rendered when location is absent');
    process.exit(1);
  }

  // Test with certifications that are missing optional org/year fields to verify
  // the EMPTY block fallback (empty <span> for table-cell alignment).
  const noOrgCert = {
    ...sample,
    certifications: [{ title: 'No Org Cert' }, { title: 'With Org', org: 'CNCF', year: '2025' }],
    projects: [],
  };
  let certHtml;
  try {
    certHtml = renderHtml(template, noOrgCert, TEMPLATE_PATH);
  } catch (err) {
    console.error(`Self-test failed (cert variant): ${err.message}`);
    process.exit(1);
  }
  // The partial should emit an empty <span class="cert-org"> for alignment.
  if (!certHtml.includes('class="cert-org"')) {
    console.error('Self-test failed: cert-org empty-block not emitted for table alignment');
    process.exit(1);
  }

  const absOutput = resolve(join(tmpdir(), 'build-cv-html-test.html'));
  await writeAndReport(html, absOutput, sample, { status: 'self-test-passed' });

  await import('fs/promises').then(fs => fs.rm(absOutput).catch(() => {}));
  process.exit(0);
}

main();
