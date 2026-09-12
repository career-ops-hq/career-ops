#!/usr/bin/env node
/**
 * ATS Form Plain-Text Exporter (#2887)
 * Formats profile and experience data for seamless copy-pasting into ATS forms.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as yaml from 'js-yaml';
import { isMainModule } from '../lib/is-main-module.mjs';

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
 * Parses markdown CV (e.g. cv.md) into structured sections (experience, education, skills, contact).
 */
export function parseCvMarkdown(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    return {};
  }

  const result = {
    name: '',
    email: '',
    phone: '',
    location: '',
    linkedin: '',
    summary: '',
    experience: [],
    education: [],
    skills: [],
  };

  // 1. Parse top-level Header for Name
  const h1Match = markdown.match(/^#\s+(?:(?:CV|Resume)\s*(?:--|—|–|-|:)\s*)?(.+)$/im);
  if (h1Match) {
    result.name = h1Match[1].trim();
  }

  // 2. Parse contact info lines
  const contactLines = markdown.match(/^\*\*([A-Za-z]+):\*\*\s*(.+)$/gm) || [];
  for (const line of contactLines) {
    const m = line.match(/^\*\*([A-Za-z]+):\*\*\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'email') result.email = val;
    else if (key === 'location') result.location = val;
    else if (key === 'linkedin') result.linkedin = val;
    else if (key === 'phone') result.phone = val;
  }

  // 3. Split by H2 sections
  const sectionRegex = /^##\s+(.+)$/gm;
  let match;
  const sections = [];
  while ((match = sectionRegex.exec(markdown)) !== null) {
    sections.push({
      title: match[1].trim(),
      index: match.index + match[0].length,
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const current = sections[i];
    const endIndex = (i + 1 < sections.length) ? markdown.indexOf('\n## ', current.index) : markdown.length;
    const actualEnd = endIndex === -1 ? markdown.length : endIndex;
    const body = markdown.slice(current.index, actualEnd).trim();
    const titleLower = current.title.toLowerCase();

    if (titleLower.includes('summary')) {
      result.summary = body;
    } else if (titleLower.includes('experience') || titleLower.includes('work history') || titleLower.includes('recent engineering')) {
      const h3Regex = /^###\s+(.+)$/gm;
      let h3Match;
      const h3Sections = [];
      while ((h3Match = h3Regex.exec(body)) !== null) {
        h3Sections.push({
          title: h3Match[1].trim(),
          index: h3Match.index + h3Match[0].length,
        });
      }

      if (h3Sections.length > 0) {
        for (let j = 0; j < h3Sections.length; j++) {
          const h3Curr = h3Sections[j];
          const h3End = (j + 1 < h3Sections.length) ? body.indexOf('\n### ', h3Curr.index) : body.length;
          const h3ActualEnd = h3End === -1 ? body.length : h3End;
          const h3Body = body.slice(h3Curr.index, h3ActualEnd).trim();

          const entry = {
            company: h3Curr.title,
            role: '',
            duration: '',
            bullets: [],
          };

          const lines = h3Body.split('\n').map(l => l.trim()).filter(Boolean);
          for (const l of lines) {
            const roleMatch = l.match(/^\*\*(.+?)\*\*$/);
            if (roleMatch && !entry.role) {
              entry.role = roleMatch[1].trim();
            } else if (/^\d{4}/.test(l) && !entry.duration) {
              entry.duration = l.trim();
            } else if (l.startsWith('- ') || l.startsWith('* ') || l.startsWith('• ')) {
              entry.bullets.push(l.replace(/^[-*•]\s+/, '').trim());
            }
          }
          result.experience.push(entry);
        }
      }
    } else if (titleLower.includes('education')) {
      const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        const clean = l.replace(/^[-*•]\s+/, '').trim();
        if (!clean) continue;
        const eduMatch = clean.match(/^(.*?)[,\-–—]\s*(.*?)\s*\((.*?)\)$/);
        if (eduMatch) {
          result.education.push({
            degree: eduMatch[1].trim(),
            institution: eduMatch[2].trim(),
            year: eduMatch[3].trim(),
          });
        } else {
          result.education.push({ degree: clean });
        }
      }
    } else if (titleLower.includes('skills')) {
      const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        let content = l.replace(/^[-*•]\s+/, '').trim();
        content = content.replace(/^\*\*[^*]+:\*\*\s*/, '').replace(/^[A-Za-z/ ]+:\s*/, '');
        const items = content.split(/,\s*/).map(s => s.trim()).filter(Boolean);
        for (const item of items) {
          if (item && !result.skills.includes(item)) {
            result.skills.push(item);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Normalizes raw profile YAML and optional CV markdown data into standard section fields.
 */
export function normalizeProfile(raw = {}, cvData = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  if (!cvData || typeof cvData !== 'object') cvData = {};

  const candidate = raw.candidate || {};
  const narrative = raw.narrative || {};

  const name = candidate.full_name || raw.name || cvData.name || '';
  const email = candidate.email || raw.email || cvData.email || '';
  const phone = candidate.phone || raw.phone || cvData.phone || '';
  const location = candidate.location || raw.location || cvData.location || '';
  const linkedin = candidate.linkedin || raw.linkedin || cvData.linkedin || '';

  let summary = raw.summary || '';
  if (!summary && narrative.headline) {
    summary = narrative.headline + (narrative.exit_story ? `. ${narrative.exit_story}` : '');
  }
  if (!summary && cvData.summary) {
    summary = cvData.summary;
  }

  let skills = [];
  if (Array.isArray(raw.skills) && raw.skills.length > 0) {
    skills = raw.skills;
  } else if (Array.isArray(narrative.superpowers) && narrative.superpowers.length > 0) {
    skills = narrative.superpowers;
  } else if (Array.isArray(cvData.skills) && cvData.skills.length > 0) {
    skills = cvData.skills;
  }

  let experience = [];
  if (Array.isArray(raw.experience) && raw.experience.length > 0) {
    experience = raw.experience;
  } else if (Array.isArray(cvData.experience) && cvData.experience.length > 0) {
    experience = cvData.experience;
  }

  let education = [];
  if (Array.isArray(raw.education) && raw.education.length > 0) {
    education = raw.education;
  } else if (Array.isArray(cvData.education) && cvData.education.length > 0) {
    education = cvData.education;
  }

  return { name, email, phone, location, linkedin, summary, experience, education, skills };
}

/**
 * Loads profile and CV data from file paths or default paths.
 * Fails closed if real profile configuration is missing.
 */
export function loadProfile(customProfilePath = null, customCvPath = null) {
  let profileRaw = null;
  const profileSource = customProfilePath || process.env.CAREER_OPS_PROFILE || 'config/profile.yml';

  if (customProfilePath) {
    if (!existsSync(customProfilePath)) {
      throw new Error(`Profile configuration file not found at: ${customProfilePath}`);
    }
    try {
      const content = readFileSync(customProfilePath, 'utf8');
      profileRaw = yaml.load(content);
      if (!profileRaw || typeof profileRaw !== 'object') {
        throw new Error(`Invalid YAML in profile file: ${customProfilePath}`);
      }
    } catch (err) {
      throw new Error(`Failed to read profile file at ${customProfilePath}: ${err.message}`);
    }
  } else {
    if (!existsSync(profileSource)) {
      throw new Error('config/profile.yml not found: fill it in first');
    }
    try {
      const content = readFileSync(profileSource, 'utf8');
      profileRaw = yaml.load(content);
      if (!profileRaw || typeof profileRaw !== 'object') {
        throw new Error('config/profile.yml is empty or invalid YAML: fill it in first');
      }
    } catch (err) {
      throw new Error(`Failed to read profile file at ${profileSource}: ${err.message}`);
    }
  }

  let cvData = {};
  const cvSource = customCvPath || process.env.CAREER_OPS_CV || 'cv.md';
  if (customCvPath) {
    if (!existsSync(customCvPath)) {
      throw new Error(`CV file not found at: ${customCvPath}`);
    }
    try {
      const cvText = readFileSync(customCvPath, 'utf8');
      cvData = parseCvMarkdown(cvText);
    } catch (err) {
      throw new Error(`Failed to read CV file at ${customCvPath}: ${err.message}`);
    }
  } else if (existsSync(cvSource)) {
    try {
      const cvText = readFileSync(cvSource, 'utf8');
      cvData = parseCvMarkdown(cvText);
    } catch {
      // cv.md is optional if profile supplies necessary fields
    }
  }

  return normalizeProfile(profileRaw, cvData);
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
    const validExp = normalized.experience.filter(e => e && typeof e === 'object');
    const expText = validExp
      .map(e => {
        const role = sanitizeAtsText(e.role || '');
        const company = sanitizeAtsText(e.company || '');
        const headerParts = [];
        if (role && company) {
          headerParts.push(`${role} at ${company}`);
        } else if (role || company) {
          headerParts.push(role || company);
        }
        if (e.duration) {
          headerParts.push(`(${sanitizeAtsText(e.duration)})`);
        }
        const header = headerParts.join(' ');
        const bullets = Array.isArray(e.bullets)
          ? e.bullets.filter(b => typeof b === 'string' && b.trim()).map(b => `- ${sanitizeAtsText(b)}`).join('\n')
          : '';
        return bullets ? (header ? `${header}\n${bullets}` : bullets) : header;
      })
      .filter(Boolean)
      .join('\n\n');
    if (expText) {
      sections.experience = `--- EXPERIENCE ---\n${expText}`;
    }
  }

  if (Array.isArray(normalized.education) && normalized.education.length > 0) {
    const validEdu = normalized.education.filter(e => e && typeof e === 'object');
    const eduText = validEdu
      .map(e => {
        const degree = sanitizeAtsText(e.degree || e.degree_name || '');
        const inst = sanitizeAtsText(e.institution || e.school || '');
        const year = e.year ? `(${sanitizeAtsText(e.year)})` : '';
        if (degree && inst) {
          return `${degree} - ${inst}${year ? ` ${year}` : ''}`;
        }
        if (degree || inst) {
          return `${degree || inst}${year ? ` ${year}` : ''}`;
        }
        if (e.text) {
          return sanitizeAtsText(e.text);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (eduText) {
      sections.education = `--- EDUCATION ---\n${eduText}`;
    }
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

// Main CLI execution guard (repo convention: lib/is-main-module.mjs, #3170)
if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      section: { type: 'string' },
      out: { type: 'string' },
      profile: { type: 'string' },
      cv: { type: 'string' },
    },
    allowPositionals: true,
  });

  try {
    const profileData = loadProfile(values.profile, values.cv);
    const text = formatAtsText(profileData, { section: values.section });

    if (values.out) {
      const outDir = dirname(resolve(values.out));
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      writeFileSync(values.out, text, 'utf8');
      console.log(`Wrote ATS plain text export to ${values.out}`);
    } else {
      console.log(text);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
