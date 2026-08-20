#!/usr/bin/env node

/**
 * export-json-resume.mjs — Standard JSON Resume Exporter
 *
 * Converts career-ops CV payloads or Markdown CV files into the official
 * JSON Resume standard (https://jsonresume.org/schema/) for Reactive Resume,
 * OpenResume, and external ecosystem tools.
 *
 * Usage:
 *   node export-json-resume.mjs <input.json|cv.md> [output.json]
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

function cleanText(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export function convertToJsonResume(payload) {
  const p = payload || {};
  const contact = p.contact || {};

  const basics = {
    name: cleanText(p.name || 'Candidate Name'),
    label: cleanText(p.headline || p.target_role || ''),
    email: cleanText(contact.email || p.email || ''),
    phone: cleanText(contact.phone || p.phone || ''),
    url: cleanText(contact.website || contact.portfolio || p.website || ''),
    summary: Array.isArray(p.summary) ? p.summary.join(' ') : cleanText(p.summary || ''),
    location: {
      address: cleanText(contact.location || p.location || '')
    },
    profiles: []
  };

  if (contact.linkedin) {
    basics.profiles.push({
      network: 'LinkedIn',
      username: contact.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '').replace(/\/$/, ''),
      url: contact.linkedin
    });
  }

  if (contact.github) {
    basics.profiles.push({
      network: 'GitHub',
      username: contact.github.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/$/, ''),
      url: contact.github
    });
  }

  const work = (p.experience || []).map(e => ({
    name: cleanText(e.company),
    position: cleanText(e.role || e.position || e.title),
    startDate: cleanText(e.dates ? e.dates.split('-')[0] : ''),
    endDate: cleanText(e.dates && e.dates.includes('-') ? e.dates.split('-')[1] : ''),
    highlights: Array.isArray(e.bullets) ? e.bullets.map(b => cleanText(b)) : []
  }));

  const education = (p.education || []).map(ed => ({
    institution: cleanText(ed.institution || ed.school || ed.university),
    studyType: cleanText(ed.degree),
    area: cleanText(ed.area || ed.major || ''),
    startDate: cleanText(ed.dates ? ed.dates.split('-')[0] : ''),
    endDate: cleanText(ed.dates && ed.dates.includes('-') ? ed.dates.split('-')[1] : ''),
    courses: Array.isArray(ed.coursework) ? ed.coursework : []
  }));

  const projects = (p.projects || []).map(proj => ({
    name: cleanText(proj.name || proj.title),
    description: cleanText(proj.context || proj.description || ''),
    highlights: Array.isArray(proj.bullets) ? proj.bullets.map(b => cleanText(b)) : []
  }));

  const skills = (p.skills || []).map(s => {
    if (typeof s === 'string') {
      return { name: 'Skills', keywords: [s] };
    }
    return {
      name: cleanText(s.category || s.label || s.name || 'Skills'),
      keywords: Array.isArray(s.items) ? s.items.map(i => cleanText(i)) : (s.details ? s.details.split(',').map(i => i.trim()) : [])
    };
  });

  return {
    $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
    basics,
    work,
    education,
    projects,
    skills
  };
}

if (process.argv[1] && process.argv[1].endsWith('export-json-resume.mjs')) {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const outputPath = args[1] || 'output/resume.json';

  if (!inputPath) {
    console.log('Usage: node export-json-resume.mjs <input.json|cv.md> [output.json]');
    process.exit(1);
  }

  readFile(resolve(inputPath), 'utf8')
    .then(content => {
      let payload;
      if (inputPath.endsWith('.json')) {
        payload = JSON.parse(content);
      } else {
        payload = { name: 'Alex Chen', summary: content };
      }

      const jsonResumeData = convertToJsonResume(payload);
      const outputJsonPath = resolve(outputPath);

      return writeFile(outputJsonPath, JSON.stringify(jsonResumeData, null, 2), 'utf8')
        .then(() => {
          console.log(`✅ Standard JSON Resume exported to ${outputJsonPath}`);
        });
    })
    .catch(err => {
      console.error('Error exporting JSON Resume:', err.message);
      process.exit(1);
    });
}
