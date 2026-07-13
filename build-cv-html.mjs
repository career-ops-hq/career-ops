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

import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, 'templates', 'cv-template.html');
const PLACEHOLDER_RE = /\{\{[A-Z_]+\}\}/g;
const CONTACT_ROW_RE = /<div class="contact-row">[\s\S]*?<\/div>/;

const PAGE_WIDTHS = { letter: '8.5in', a4: '210mm' };

const DEFAULT_SECTION_TITLES = {
  summary: 'Professional Summary',
  competencies: 'Core Competencies',
  experience: 'Work Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  skills: 'Skills',
};

// Escape user text for HTML text/attribute context. Covers the five characters
// that change meaning in markup so tailored bullets containing &, <, >, quotes
// (e.g. "R&D", "scaled 10x < budget", 'the "north star" metric') render as
// literal text instead of breaking the document or injecting tags.
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
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

function joinItems(items) {
  if (Array.isArray(items)) return items.join(', ');
  return typeof items === 'string' ? items : '';
}

// --- Section builders: each returns the inner HTML for one {{PLACEHOLDER}}. ---

function buildCompetencies(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  return entries
    .filter(Boolean)
    .map(tag => `<span class="competency-tag">${escapeHtml(String(tag))}</span>`)
    .join('\n      ');
}

function buildExperience(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
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

function buildProjects(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
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

function buildEducation(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
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

function buildCertifications(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
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

function buildSkills(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return '';
  const items = categories.filter(Boolean).map(c => {
    const cat = c.category
      ? `<span class="skill-category">${escapeHtml(c.category)}:</span> `
      : '';
    return `    <div class="skill-item">${cat}${escapeHtml(joinItems(c.items))}</div>`;
  }).join('\n');
  return `<div class="skills-grid">
${items}
  </div>`;
}

// Rebuild the whole .contact-row block. Its markup uses fixed "|" separators
// between phone / email / linkedin / portfolio / location, so an absent optional
// field (phone, linkedin, portfolio) must drop BOTH its <a> and one separator.
// Building the present items and joining them is more robust than excising
// separators from the template one placeholder at a time.
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
  return `<img class="cv-photo" src="${sanitizeUrl(photo)}" alt="${escapeHtml(name || '')}">`;
}

function renderReport(payload) {
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
    COMPETENCIES: buildCompetencies(payload.competencies),
    SECTION_EXPERIENCE: escapeHtml(sectionTitles.experience),
    EXPERIENCE: buildExperience(payload.experience),
    SECTION_PROJECTS: escapeHtml(sectionTitles.projects),
    PROJECTS: buildProjects(payload.projects),
    SECTION_EDUCATION: escapeHtml(sectionTitles.education),
    EDUCATION: buildEducation(payload.education),
    SECTION_CERTIFICATIONS: escapeHtml(sectionTitles.certifications),
    CERTIFICATIONS: buildCertifications(payload.certifications),
    SECTION_SKILLS: escapeHtml(sectionTitles.skills),
    SKILLS: buildSkills(payload.skills),
  };
  return { substitutions, candidate };
}

// Merge a payload into the template and return the final HTML (throws on any
// unresolved {{PLACEHOLDER}} so a malformed payload fails loudly, not silently).
function renderHtml(template, payload) {
  const { substitutions, candidate } = renderReport(payload);

  // The contact row and photo carry conditional markup (dropped separators /
  // no <img>), so they are rebuilt as whole blocks before placeholder fill.
  let html = template.replace(CONTACT_ROW_RE, () => buildContactRow(candidate));
  html = html.replace(/\{\{PHOTO\}\}/g, () => buildPhoto(candidate, candidate.name));

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
    console.error('  node build-cv-html.mjs --test');
    console.error('');
    console.error('  [template.html] defaults to templates/cv-template.html. Pass the path');
    console.error('  printed by `node cv-templates.mjs resolve cv` to use a selected template.');
    process.exit(args.includes('--help') ? 0 : 1);
  }

  if (args.includes('--test')) {
    await runSelfTest();
    return;
  }

  const [inputPath, outputPath, templateArg] = args;
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
  } catch (err) {
    console.error(`Failed to parse input JSON: ${err.message}`);
    process.exit(1);
  }

  const template = await readFile(templatePath, 'utf-8');

  let html;
  try {
    html = renderHtml(template, payload);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  await writeAndReport(html, absOutput, payload);
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
    html = renderHtml(template, sample);
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

  const absOutput = resolve(join(tmpdir(), 'build-cv-html-test.html'));
  await writeAndReport(html, absOutput, sample, { status: 'self-test-passed' });

  await import('fs/promises').then(fs => fs.rm(absOutput).catch(() => {}));
  process.exit(0);
}

main();
