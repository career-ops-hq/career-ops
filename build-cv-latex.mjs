#!/usr/bin/env node

import { readFile, writeFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, 'templates', 'cv-template.tex');
const PLACEHOLDER_RE = /\{\{[A-Z_]+\}\}/g;

function escapeLatex(text, mode = 'text') {
  if (typeof text !== 'string') return '';
  if (mode === 'url') return text;
  const out = [];
  for (const ch of text) {
    switch (ch) {
      case '\\': out.push('\\textbackslash{}'); break;
      case '{': case '}': out.push('\\' + ch); break;
      case '^': out.push('\\textasciicircum{}'); break;
      case '~': out.push('\\textasciitilde{}'); break;
      case '_': out.push('\\_'); break;
      case '&': out.push('\\&'); break;
      case '%': out.push('\\%'); break;
      case '$': out.push('\\$'); break;
      case '#': out.push('\\#'); break;
      case '\u00B1': out.push('$\\pm$'); break;
      case '\u2192': out.push('$\\rightarrow$'); break;
      default: out.push(ch);
    }
  }
  return out.join('');
}

function sanitizeUrl(url) {
  if (typeof url !== 'string') return '';
  url = url.trim();
  if (!url) return '';
  const allowedSchemes = ['mailto:', 'http:', 'https:'];
  const hasScheme = allowedSchemes.some(s => url.toLowerCase().startsWith(s));
  if (!hasScheme) {
    if (url.includes('@') && !url.includes('/')) {
      url = 'mailto:' + url;
    } else {
      url = 'https://' + url;
    }
  }
  url = url.replace(/[{}%$#\\~^]/g, '');
  return url;
}

function buildEducation(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const blocks = [];
  for (const e of entries) {
    if (!e) continue;
    let block = `    \\resumeSubheading\n      {${escapeLatex(e.institution)}}{${escapeLatex(e.location)}}\n      {${escapeLatex(e.degree)}}{${escapeLatex(e.dates)}}`;
    if (Array.isArray(e.coursework) && e.coursework.length > 0) {
      const courses = e.coursework.map(c => escapeLatex(c)).join(', ');
      block += `\n        \\resumeItemListStart\n            \\resumeItem{\\textbf{Coursework:} ${courses}}\n        \\resumeItemListEnd`;
    }
    blocks.push(block);
  }
  return blocks.join('\n\n');
}

function buildExperience(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const blocks = [];
  for (const e of entries) {
    if (!e) continue;
    const bullets = Array.isArray(e.bullets) ? e.bullets.map(b => `            \\resumeItem{${escapeLatex(b)}}`).join('\n') : '';
    blocks.push(`    \\resumeSubheading\n      {${escapeLatex(e.company)}}{${escapeLatex(e.dates)}}\n      {${escapeLatex(e.role)}}{${escapeLatex(e.location)}}\n      \\resumeItemListStart\n${bullets}\n      \\resumeItemListEnd`);
  }
  return blocks.join('\n\n');
}

function buildProjects(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const blocks = [];
  for (const e of entries) {
    if (!e) continue;
    const context = e.context ? ` \\emph{$|$ ${escapeLatex(e.context)}}` : '';
    const bullets = Array.isArray(e.bullets) ? e.bullets.map(b => `            \\resumeItem{${escapeLatex(b)}}`).join('\n') : '';
    blocks.push(`    \\resumeProjectHeading\n      {\\textbf{${escapeLatex(e.name)}}${context}}{${escapeLatex(e.dates)}}\n      \\resumeItemListStart\n${bullets}\n      \\resumeItemListEnd`);
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

  if (!existsSync(TEMPLATE_PATH)) {
    console.error(`Template not found: ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  let template = await readFile(TEMPLATE_PATH, 'utf-8');

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
    SKILLS: buildSkills(payload.skills),
  };

  for (const [key, value] of Object.entries(substitutions)) {
    template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
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
    skills: [
      { category: 'Languages', items: 'Python, JavaScript, TypeScript' },
      { category: 'Frameworks', items: 'FastAPI, React, PyTorch' },
    ],
  };

  const testOutput = '/tmp/build-cv-latex-test.tex';
  const raw = JSON.stringify(sample, null, 2);
  const tmpInput = '/tmp/build-cv-latex-test-input.json';
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
    SKILLS: buildSkills(sample.skills),
  };

  for (const [key, value] of Object.entries(substitutions)) {
    template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
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
