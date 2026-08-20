#!/usr/bin/env node

/**
 * export-html-resume.mjs — Standalone HTML & Plain Text Resume Exporter
 *
 * Converts candidate profile into zero-dependency standalone HTML and plain text formats.
 *
 * Usage:
 *   node export-html-resume.mjs [--profile=<profile.json>] [--output=<resume.html>]
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function convertToHtmlResume(profilePayload) {
  const p = profilePayload || {};
  const c = p.contact || {};

  const expHtml = (p.experience || []).map(exp => `
    <div style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; font-weight: bold;">
        <span>${exp.role || ''} — ${exp.company || ''}</span>
        <span>${exp.dates || ''}</span>
      </div>
      <div style="color: #666; font-size: 0.9em;">${exp.location || ''}</div>
      <ul style="margin-top: 6px; padding-left: 20px;">
        ${(exp.bullets || []).map(b => `<li>${b}</li>`).join('')}
      </ul>
    </div>
  `).join('');

  const edHtml = (p.education || []).map(ed => `
    <div style="margin-bottom: 8px;">
      <strong>${ed.degree || ''} ${ed.area ? 'in ' + ed.area : ''}</strong> — ${ed.institution || ''} (${ed.dates || ''})
    </div>
  `).join('');

  const skillsHtml = (p.skills || []).map(sk => `
    <div style="margin-bottom: 6px;">
      <strong>${sk.category || 'Skills'}:</strong> ${Array.isArray(sk.items) ? sk.items.join(', ') : sk.details || ''}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${p.name || 'Resume'} — CV</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.5; color: #222; }
    h1 { margin-bottom: 4px; font-size: 28px; }
    .subtitle { color: #555; font-size: 16px; margin-bottom: 12px; }
    .contact { font-size: 14px; color: #444; border-bottom: 2px solid #eee; padding-bottom: 12px; margin-bottom: 24px; }
    h2 { font-size: 18px; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <h1>${p.name || ''}</h1>
  <div class="subtitle">${p.headline || ''}</div>
  <div class="contact">
    ${c.email ? '📧 ' + c.email : ''} ${c.phone ? '| 📞 ' + c.phone : ''} ${c.location ? '| 📍 ' + c.location : ''} ${c.website ? '| 🌐 ' + c.website : ''}
  </div>

  ${p.summary ? `<h2>Summary</h2><p>${Array.isArray(p.summary) ? p.summary.join(' ') : p.summary}</p>` : ''}

  <h2>Experience</h2>
  ${expHtml}

  <h2>Education</h2>
  ${edHtml}

  <h2>Skills</h2>
  ${skillsHtml}
</body>
</html>`;
}

export function convertToPlainTextResume(profilePayload) {
  const p = profilePayload || {};
  const c = p.contact || {};

  let txt = `${(p.name || '').toUpperCase()}\n`;
  txt += `${p.headline || ''}\n`;
  txt += `${c.email || ''} | ${c.phone || ''} | ${c.location || ''}\n`;
  txt += `=================================================================\n\n`;

  if (p.summary) {
    txt += `SUMMARY\n-------\n${Array.isArray(p.summary) ? p.summary.join(' ') : p.summary}\n\n`;
  }

  txt += `EXPERIENCE\n----------\n`;
  (p.experience || []).forEach(exp => {
    txt += `${exp.role || ''} - ${exp.company || ''} (${exp.dates || ''})\n`;
    (exp.bullets || []).forEach(b => {
      txt += `  * ${b}\n`;
    });
    txt += `\n`;
  });

  txt += `EDUCATION\n---------\n`;
  (p.education || []).forEach(ed => {
    txt += `${ed.degree || ''} in ${ed.area || ''} - ${ed.institution || ''} (${ed.dates || ''})\n`;
  });

  txt += `\nSKILLS\n------\n`;
  (p.skills || []).forEach(sk => {
    txt += `${sk.category || 'Skills'}: ${Array.isArray(sk.items) ? sk.items.join(', ') : sk.details || ''}\n`;
  });

  return txt;
}

if (process.argv[1] && process.argv[1].endsWith('export-html-resume.mjs')) {
  const args = process.argv.slice(2);
  let profilePath = resolve(__dirname, 'examples', 'cv-example.md');
  let outputPath = resolve(__dirname, 'output', 'resume.html');

  for (const arg of args) {
    if (arg.startsWith('--profile=')) profilePath = arg.split('=')[1];
    if (arg.startsWith('--output=')) outputPath = arg.split('=')[1];
  }

  try {
    const raw = readFileSync(resolve(profilePath), 'utf8');
    let payload;
    try { payload = JSON.parse(raw); } catch (_) { payload = { name: 'Alex Chen', headline: 'Senior Software Engineer' }; }

    const htmlContent = convertToHtmlResume(payload);
    writeFileSync(resolve(outputPath), htmlContent, 'utf8');
    console.log(`\n📄 Standalone HTML Resume exported to: ${outputPath}\n`);
  } catch (err) {
    console.error('Error exporting HTML resume:', err.message);
  }
}
