#!/usr/bin/env node

import { readFile, writeFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { escapeLatex, sanitizeUrl } from './lib/latex-escape.mjs';
import { resolveTemplate } from './cv-templates.mjs';
import { stripEmptySections } from './cv-sections-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, 'templates', 'cv-template.tex');
const PLACEHOLDER_RE = /\{\{[A-Z_]+\}\}/g;

// Markdown bold inside bullets — the LaTeX half of #1728, which taught the HTML
// path to render `**text**` as <strong> (normalizeTextForATS in generate-pdf.mjs).
// escapeLatex() leaves `*` alone because it is not a LaTeX special character, so
// the markers reached the .tex verbatim and printed as literal asterisks (#3351).
//
// Order is the safety property, and it mirrors the HTML twin: escapeLatex() runs
// FIRST, so every backslash and brace in the payload is already neutralized
// (`\` becomes \textbackslash{}, braces become \{ \}). Nothing the candidate wrote
// can survive as a real control sequence — this pass only reinterprets the `**`
// markers, which escaping deliberately left untouched. Same regex as the HTML
// path so the two twins agree on what counts as bold.
//
// The gate covers every field this builder emits inside a \resumeItem: experience
// bullets, project bullets, and the education coursework line. Coursework does not
// carry the payload key `bullets`, but it renders as a bullet, and a bullet whose
// emphasis silently prints as `**` is the bug being fixed — the shape of the
// output decides what goes through the gate, not the name of the payload field.
const MARKDOWN_BOLD_RE = /\*\*([^*]+?)\*\*/g;

/**
 * Escape bullet text, then restore markdown bold as \textbf.
 *
 * Use this for every value that ends up inside a \resumeItem; use escapeLatex
 * directly everywhere else, where `**` is meant to stay literal.
 *
 * @param {string} text raw payload text, not yet escaped
 * @returns {string} LaTeX-safe text with `**…**` spans rendered as \textbf{…}
 */
function escapeLatexBullet(text) {
  // Replacer FUNCTION, not a string: escaped text is full of `\$` and `\&`, and a
  // string replacement would reinterpret `$&` and friends as match references
  // (same trap the render path documents below).
  return escapeLatex(text).replace(MARKDOWN_BOLD_RE, (_, inner) => `\\textbf{${inner}}`);
}

/**
 * Render the Education section as \resumeSubheading blocks.
 *
 * An entry's optional `coursework` becomes a single \resumeItem line, which is
 * why it goes through escapeLatexBullet rather than escapeLatex.
 *
 * @param {Array<object>} entries `education[]` from the payload
 * @returns {string} LaTeX for the section body, or '' when there is nothing to render
 */
function buildEducation(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const blocks = [];
  for (const e of entries) {
    if (!e) continue;
    let block = `    \\resumeSubheading\n      {${escapeLatex(e.institution)}}{${escapeLatex(e.location)}}\n      {${escapeLatex(e.degree)}}{${escapeLatex(e.dates)}}`;
    if (Array.isArray(e.coursework) && e.coursework.length > 0) {
      const courses = e.coursework.map(c => escapeLatexBullet(c)).join(', ');
      block += `\n        \\resumeItemListStart\n            \\resumeItem{\\textbf{Coursework:} ${courses}}\n        \\resumeItemListEnd`;
    }
    blocks.push(block);
  }
  return blocks.join('\n\n');
}

/**
 * Render the Work Experience section as \resumeSubheading blocks.
 *
 * @param {Array<object>} entries `experience[]` from the payload
 * @returns {string} LaTeX for the section body, or '' when there is nothing to render
 */
function buildExperience(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const blocks = [];
  for (const e of entries) {
    if (!e) continue;
    const bullets = Array.isArray(e.bullets) ? e.bullets.map(b => `            \\resumeItem{${escapeLatexBullet(b)}}`).join('\n') : '';
    blocks.push(`    \\resumeSubheading\n      {${escapeLatex(e.company)}}{${escapeLatex(e.dates)}}\n      {${escapeLatex(e.role)}}{${escapeLatex(e.location)}}\n      \\resumeItemListStart\n${bullets}\n      \\resumeItemListEnd`);
  }
  return blocks.join('\n\n');
}

/**
 * Render the Projects section as \resumeProjectHeading blocks.
 *
 * A valid `url` turns the project name into an \href link (#3198); the name
 * itself stays escaped either way.
 *
 * @param {Array<object>} entries `projects[]` from the payload
 * @returns {string} LaTeX for the section body, or '' when there is nothing to render
 */
function buildProjects(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const blocks = [];
  for (const e of entries) {
    if (!e) continue;
    const context = e.context ? ` \\emph{$|$ ${escapeLatex(e.context)}}` : '';
    const url = sanitizeUrl(e.url);
    const nameFormatted = url
      ? `\\href{${escapeLatex(url, 'url')}}{\\textbf{${escapeLatex(e.name)}}}`
      : `\\textbf{${escapeLatex(e.name)}}`;
    const bullets = Array.isArray(e.bullets) ? e.bullets.map(b => `            \\resumeItem{${escapeLatexBullet(b)}}`).join('\n') : '';
    blocks.push(`    \\resumeProjectHeading\n      {${nameFormatted}${context}}{${escapeLatex(e.dates || '')}}\n      \\resumeItemListStart\n${bullets}\n      \\resumeItemListEnd`);
  }
  return blocks.join('\n\n');
}

// Awards are one line each — no bullet list — so they reuse
// \resumeProjectHeading (bold left column, year right) rather than
// \resumeSubheading, which would leave an empty second row. The issuing body
// follows the title in the same $|$ style buildProjects() uses for context.
function buildAwards(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const blocks = [];
  for (const e of entries) {
    if (!e) continue;
    const org = e.org ? ` \\emph{$|$ ${escapeLatex(e.org)}}` : '';
    blocks.push(`    \\resumeProjectHeading\n      {\\textbf{${escapeLatex(e.title)}}${org}}{${escapeLatex(e.year)}}`);
  }
  return blocks.join('\n\n');
}

function buildSkills(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return '';
  return categories.map(c => {
    if (!c) return '';
    const items = Array.isArray(c.items) ? c.items.join(', ') : (c.items || '');
    return `        \\textbf{${escapeLatex(c.category)}}{: ${escapeLatex(items)}} \\\\`;
  }).filter(Boolean).join('\n');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.error('Usage:');
    console.error('  node build-cv-latex.mjs <input.json> <output.tex>');
    console.error('  node build-cv-latex.mjs --test');
    process.exit(1);
  }

  if (args.includes('--test')) {
    await runSelfTest();
    return;
  }

  const [inputPath, outputPath] = args;

  if (!inputPath || !outputPath) {
    console.error('Usage: node build-cv-latex.mjs <input.json> <output.tex>');
    process.exit(1);
  }

  const absInput = resolve(inputPath);
  const absOutput = resolve(outputPath);
  const outDir = dirname(absOutput);

  if (!existsSync(absInput)) {
    console.error(`Input file not found: ${absInput}`);
    process.exit(1);
  }

  let payload;
  try {
    const raw = await readFile(absInput, 'utf-8');
    payload = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse input JSON: ${err.message}`);
    process.exit(1);
  }

  // Honor a selected .tex template variant (cv.template default or --template=<name>),
  // falling back to the base cv-template.tex when no variant exists.
  const texName = (process.argv.find((a) => a.startsWith('--template=')) || '').split('=')[1];
  let TEMPLATE_PATH_RESOLVED;
  try {
    TEMPLATE_PATH_RESOLVED = resolveTemplate('cv', texName, { format: 'tex', fallback: true });
  } catch {
    TEMPLATE_PATH_RESOLVED = TEMPLATE_PATH;
  }

  if (!existsSync(TEMPLATE_PATH_RESOLVED)) {
    console.error(`Template not found: ${TEMPLATE_PATH_RESOLVED}`);
    process.exit(1);
  }

  let template = await readFile(TEMPLATE_PATH_RESOLVED, 'utf-8');

  // Drop the optional sections (projects, education) that have no entries, so
  // an absent one leaves no bare header behind. See cv-sections-core.mjs.
  template = stripEmptySections(template, payload, 'tex');

  const emailUrl = sanitizeUrl(payload.email?.url || '');
  const emailDisplay = payload.email?.display || emailUrl;
  const linkedinUrl = sanitizeUrl(payload.linkedin?.url || '');
  const linkedinDisplay = payload.linkedin?.display || '';
  const githubUrl = sanitizeUrl(payload.github?.url || '');
  const githubDisplay = payload.github?.display || '';

  const substitutions = {
    NAME: escapeLatex(payload.name || ''),
    CONTACT_LINE: escapeLatex(payload.contact_line || ''),
    EMAIL_URL: emailUrl,
    EMAIL_DISPLAY: escapeLatex(emailDisplay),
    LINKEDIN_URL: linkedinUrl,
    LINKEDIN_DISPLAY: escapeLatex(linkedinDisplay),
    GITHUB_URL: githubUrl,
    GITHUB_DISPLAY: escapeLatex(githubDisplay),
    EDUCATION: buildEducation(payload.education),
    EXPERIENCE: buildExperience(payload.experience),
    PROJECTS: buildProjects(payload.projects),
    AWARDS: buildAwards(payload.awards),
    SKILLS: buildSkills(payload.skills),
  };

  // Replacer FUNCTION, not a string: escapeLatex turns `$` into `\$` but leaves
  // the next character alone, so a bullet containing `$'` survives as the JS
  // replacement pattern meaning "everything after the match" and splices the
  // rest of the template into the document — silently, with a valid-looking
  // exit 0. A replacer function's return value is inserted literally.
  for (const [key, value] of Object.entries(substitutions)) {
    template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => value);
  }

  const unresolved = template.match(PLACEHOLDER_RE);
  if (unresolved) {
    console.error(`Unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
    process.exit(1);
  }

  if (!existsSync(outDir)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(outDir, { recursive: true });
  }

  await writeFile(absOutput, template, 'utf-8');

  const fileInfo = await stat(absOutput);
  const sizeKB = (fileInfo.size / 1024).toFixed(1);

  const report = {
    file: basename(absOutput),
    path: absOutput,
    sizeKB: parseFloat(sizeKB),
    counts: {
      educationEntries: (payload.education || []).length,
      experienceEntries: (payload.experience || []).length,
      projectEntries: (payload.projects || []).length,
      awardEntries: (payload.awards || []).length,
      skillCategories: (payload.skills || []).length,
      totalBullets: (() => {
        const ex = Array.isArray(payload.experience) ? payload.experience.flatMap(e => Array.isArray(e?.bullets) ? e.bullets : []) : [];
        const pr = Array.isArray(payload.projects) ? payload.projects.flatMap(p => Array.isArray(p?.bullets) ? p.bullets : []) : [];
        return ex.length + pr.length;
      })(),
    },
    valid: true,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

async function runSelfTest() {
  const sample = {
    name: 'Test Candidate',
    contact_line: 'City, State | +1 234 567 8900',
    email: { url: 'test@example.com', display: 'test@example.com' },
    linkedin: { url: 'https://linkedin.com/in/test', display: 'linkedin.com/in/test' },
    github: { url: 'https://github.com/test', display: 'github.com/test' },
    education: [{
      institution: 'Test University',
      location: 'City, State',
      degree: 'Bachelor of Science in Testing',
      dates: '2020 - 2024',
      coursework: ['Data Structures', 'Algorithms', 'Machine Learning'],
    }],
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
      context: 'Python, FastAPI, Docker',
      dates: '2024',
      bullets: [
        'Built a REST API with automated test coverage exceeding 90%',
      ],
    }],
    awards: [
      { title: 'Gold Medal, International Olympiad in Informatics', org: 'IOI', year: '2023' },
      { title: "Dean's List", org: 'Test University', year: '2022' },
    ],
    skills: [
      { category: 'Languages', items: 'Python, JavaScript, TypeScript' },
      { category: 'Frameworks', items: 'FastAPI, React, PyTorch' },
    ],
  };

  const testOutput = join(tmpdir(), 'build-cv-latex-test.tex');
  const raw = JSON.stringify(sample, null, 2);
  const tmpInput = join(tmpdir(), 'build-cv-latex-test-input.json');
  await writeFile(tmpInput, raw, 'utf-8');

  const absInput = resolve(tmpInput);
  const absOutput = resolve(testOutput);

  if (!existsSync(TEMPLATE_PATH)) {
    console.error(`Self-test failed: template not found at ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  let template = await readFile(TEMPLATE_PATH, 'utf-8');

  const emailUrl = sanitizeUrl(sample.email?.url || '');
  const emailDisplay = sample.email?.display || emailUrl;
  const linkedinUrl = sanitizeUrl(sample.linkedin?.url || '');
  const linkedinDisplay = sample.linkedin?.display || '';
  const githubUrl = sanitizeUrl(sample.github?.url || '');
  const githubDisplay = sample.github?.display || '';

  const substitutions = {
    NAME: escapeLatex(sample.name),
    CONTACT_LINE: escapeLatex(sample.contact_line),
    EMAIL_URL: emailUrl,
    EMAIL_DISPLAY: escapeLatex(emailDisplay),
    LINKEDIN_URL: linkedinUrl,
    LINKEDIN_DISPLAY: escapeLatex(linkedinDisplay),
    GITHUB_URL: githubUrl,
    GITHUB_DISPLAY: escapeLatex(githubDisplay),
    EDUCATION: buildEducation(sample.education),
    EXPERIENCE: buildExperience(sample.experience),
    PROJECTS: buildProjects(sample.projects),
    AWARDS: buildAwards(sample.awards),
    SKILLS: buildSkills(sample.skills),
  };

  // Replacer function, same reason as the render path above.
  for (const [key, value] of Object.entries(substitutions)) {
    template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => value);
  }

  const unresolved = template.match(PLACEHOLDER_RE);
  if (unresolved) {
    console.error(`Self-test failed: unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
    process.exit(1);
  }

  const outDir = dirname(absOutput);
  if (!existsSync(outDir)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(outDir, { recursive: true });
  }

  await writeFile(absOutput, template, 'utf-8');

  const fileInfo = await stat(absOutput);
  const sizeKB = (fileInfo.size / 1024).toFixed(1);

  const report = {
    status: 'self-test-passed',
    file: basename(absOutput),
    path: absOutput,
    sizeKB: parseFloat(sizeKB),
    counts: {
      educationEntries: sample.education.length,
      experienceEntries: sample.experience.length,
      projectEntries: sample.projects.length,
      awardEntries: sample.awards.length,
      skillCategories: sample.skills.length,
      totalBullets: (() => {
        const ex = Array.isArray(sample.experience) ? sample.experience.flatMap(e => Array.isArray(e?.bullets) ? e.bullets : []) : [];
        const pr = Array.isArray(sample.projects) ? sample.projects.flatMap(p => Array.isArray(p?.bullets) ? p.bullets : []) : [];
        return ex.length + pr.length;
      })(),
    },
  };

  console.log(JSON.stringify(report, null, 2));

  await import('fs/promises').then(fs =>
    Promise.all([
      fs.rm(tmpInput).catch(() => {}),
      fs.rm(testOutput).catch(() => {}),
    ])
  );

  process.exit(0);
}

main();
