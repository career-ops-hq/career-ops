#!/usr/bin/env node
/**
 * ATS Form Plain-Text Exporter (#2887)
 * Formats profile and experience data for seamless copy-pasting into ATS forms.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as yaml from 'js-yaml';

/**
 * Sanitizes plain text for ATS forms (converting bullets, dashes, quotes, and stripping emojis/non-breaking spaces).
 */
export function sanitizeAtsText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\u2022\u2023\u25B6\u25C6\u25CA\u25E6\u25AA\u25AB]/g, '-')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, ' ')
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .trim();
}

/**
 * Normalizes raw profile YAML/object into standard section fields.
 */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const candidate = raw.candidate || {};
  const narrative = raw.narrative || {};

  const name = candidate.full_name || raw.name || '';
  const email = candidate.email || raw.email || '';
  const phone = candidate.phone || raw.phone || '';
  const location = candidate.location || raw.location || '';
  const linkedin = candidate.linkedin || raw.linkedin || '';

  let summary = raw.summary || '';
  if (!summary && narrative.headline) {
    summary = narrative.headline + (narrative.exit_story ? `. ${narrative.exit_story}` : '');
  }

  const skills = Array.isArray(raw.skills)
    ? raw.skills
    : (Array.isArray(narrative.superpowers) ? narrative.superpowers : []);

  const experience = Array.isArray(raw.experience) ? raw.experience : [];
  const education = Array.isArray(raw.education) ? raw.education : [];

  return { name, email, phone, location, linkedin, summary, experience, education, skills };
}

/**
 * Loads profile data from file path or default configuration paths.
 */
export function loadProfile(customPath = null) {
  const profilePaths = [
    customPath,
    process.env.CAREER_OPS_PROFILE,
    'config/profile.yml',
    'config/profile.example.yml',
  ].filter(Boolean);

  for (const p of profilePaths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8');
        const parsed = yaml.load(raw);
        if (parsed && typeof parsed === 'object') {
          return normalizeProfile(parsed);
        }
      } catch (err) {
        // continue
      }
    }
  }

  return normalizeProfile({
    name: 'Candidate',
    email: 'candidate@example.com',
    summary: 'Experienced Software Engineer with full-stack track record.',
    experience: [{ role: 'Senior Engineer', company: 'Tech Corp', duration: '2022-Present', bullets: ['Led frontend migration', 'Optimized APIs'] }],
  });
}

/**
 * Formats profile object into structured plain-text section blocks.
 */
export function formatAtsText(profile = {}, options = {}) {
  const normalized = normalizeProfile(profile);
  const sectionFilter = options.section ? options.section.toLowerCase() : null;
  const sections = {};

  if (normalized.name || normalized.email || normalized.phone || normalized.location || normalized.linkedin) {
    const lines = ['--- PERSONAL INFORMATION ---'];
    if (normalized.name) lines.push(`Name: ${sanitizeAtsText(normalized.name)}`);
    if (normalized.email) lines.push(`Email: ${sanitizeAtsText(normalized.email)}`);
    if (normalized.phone) lines.push(`Phone: ${sanitizeAtsText(normalized.phone)}`);
    if (normalized.location) lines.push(`Location: ${sanitizeAtsText(normalized.location)}`);
    if (normalized.linkedin) lines.push(`LinkedIn: ${sanitizeAtsText(normalized.linkedin)}`);
    sections.personal = lines.join('\n');
  }

  if (normalized.summary) {
    sections.summary = `--- SUMMARY ---\n${sanitizeAtsText(normalized.summary)}`;
  }

  if (Array.isArray(normalized.skills) && normalized.skills.length > 0) {
    const skillsText = normalized.skills
      .map(s => (typeof s === 'string' ? sanitizeAtsText(s) : (s && s.name ? sanitizeAtsText(s.name) : '')))
      .filter(Boolean)
      .join(', ');
    if (skillsText) {
      sections.skills = `--- KEY SKILLS ---\n${skillsText}`;
    }
  }

  if (Array.isArray(normalized.experience) && normalized.experience.length > 0) {
    const expText = normalized.experience
      .map(e => {
        const header = `${sanitizeAtsText(e.role || '')} at ${sanitizeAtsText(e.company || '')}${e.duration ? ` (${sanitizeAtsText(e.duration)})` : ''}`;
        const bullets = Array.isArray(e.bullets)
          ? e.bullets.map(b => `- ${sanitizeAtsText(b)}`).join('\n')
          : '';
        return bullets ? `${header}\n${bullets}` : header;
      })
      .join('\n\n');
    sections.experience = `--- EXPERIENCE ---\n${expText}`;
  }

  if (Array.isArray(normalized.education) && normalized.education.length > 0) {
    const eduText = normalized.education
      .map(e => `${sanitizeAtsText(e.degree || e.degree_name || '')} - ${sanitizeAtsText(e.institution || e.school || '')}${e.year ? ` (${sanitizeAtsText(e.year)})` : ''}`)
      .join('\n');
    sections.education = `--- EDUCATION ---\n${eduText}`;
  }

  if (sectionFilter) {
    if (sections[sectionFilter]) {
      return sections[sectionFilter];
    }
    const matchedKey = Object.keys(sections).find(k => k.includes(sectionFilter) || sectionFilter.includes(k));
    if (matchedKey) {
      return sections[matchedKey];
    }
    return '';
  }

  return Object.values(sections).join('\n\n');
}

// Main CLI execution guard
const currentScriptPath = resolve(fileURLToPath(import.meta.url));
const entryScriptPath = process.argv[1] ? resolve(process.argv[1]) : '';

if (entryScriptPath === currentScriptPath || (process.argv[1] && process.argv[1].endsWith('export-ats-text.mjs'))) {
  const { values } = parseArgs({
    options: {
      section: { type: 'string' },
      out: { type: 'string' },
      profile: { type: 'string' },
    },
    allowPositionals: true,
  });

  const profileData = loadProfile(values.profile);
  const text = formatAtsText(profileData, { section: values.section });

  if (values.out) {
    writeFileSync(values.out, text, 'utf8');
    console.log(`Wrote ATS plain text export to ${values.out}`);
  } else {
    console.log(text);
  }
}
