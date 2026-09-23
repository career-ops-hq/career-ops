#!/usr/bin/env node
/**
 * cv-pinned-experience.mjs — roles that must always appear on tailored CVs.
 *
 * Source of truth: every employer in cv.md → ## Work Experience (never omit any).
 * Overrides: config/profile.yml → cv.pinned_experience (aliases, min_bullets, default_bullet).
 * Used by verify-cv-facts.mjs (hard gate) and generate-pdf.mjs (safety-net inject).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';

const CV_PATH = join(getCareerOpsRoot(), 'cv.md');
const PROFILE_PATH = join(getCareerOpsRoot(), 'config', 'profile.yml');

/** Default when cv.md and profile.yml are both unavailable. */
export const DEFAULT_PINNED_EXPERIENCE = [
  {
    company: 'InstaCure',
    aliases: ['Instacure', 'Insta Cure'],
    role: 'Business Associate',
    dates: 'May 2016 -- May 2017',
    location: 'India',
    min_bullets: 1,
    default_bullet: 'Health-tech startup; regional sales operations, 30% vendor base growth',
  },
];

/**
 * Parse every role under cv.md → ## Work Experience.
 * @returns {Array<object>}
 */
export function parseCvWorkExperience(cvPath = CV_PATH) {
  if (!existsSync(cvPath)) return [];
  const md = readFileSync(cvPath, 'utf-8');
  const match = md.match(/^## Work Experience\s*\n([\s\S]*?)(?=\n## |\Z)/m);
  if (!match) return [];

  const roles = [];
  for (const block of match[1].split(/\n(?=### )/).filter((b) => b.trim())) {
    const lines = block.trim().split('\n');
    if (!lines[0]?.startsWith('### ')) continue;

    const header = lines[0].replace(/^### /, '');
    const dashIdx = header.indexOf(' -- ');
    const company = (dashIdx >= 0 ? header.slice(0, dashIdx) : header).trim();
    const location = dashIdx >= 0 ? header.slice(dashIdx + 4).trim() : '';

    let role = '';
    let dates = '';
    const bullets = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const bold = line.match(/^\*\*(.+)\*\*$/);
      if (bold) {
        role = bold[1];
        continue;
      }
      if (!dates && /\d{4}/.test(line) && !line.startsWith('-')) {
        dates = line;
        continue;
      }
      if (line.startsWith('- ')) bullets.push(line.slice(2).replace(/\*\*/g, ''));
    }
    if (!company) continue;

    roles.push({
      company,
      location,
      role,
      dates,
      min_bullets: 1,
      default_bullet: bullets[0] || '',
      source_bullets: bullets,
      aliases: [],
    });
  }
  return roles;
}

function normCompany(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function jobMatchesPin(job, pin) {
  const jobNorm = normCompany(job?.company);
  if (!jobNorm) return false;
  const names = [pin.company, ...(pin.aliases || [])].map(normCompany).filter(Boolean);
  return names.some((n) => jobNorm === n || jobNorm.includes(n) || n.includes(jobNorm));
}

function mergeRequiredRoles(fromCv, fromProfile) {
  const merged = fromCv.map((r) => ({ ...r }));
  for (const pin of fromProfile) {
    const idx = merged.findIndex((r) => jobMatchesPin({ company: r.company }, pin));
    if (idx >= 0) {
      merged[idx] = {
        ...merged[idx],
        ...pin,
        aliases: [...new Set([...(merged[idx].aliases || []), ...(pin.aliases || [])])],
        default_bullet: pin.default_bullet || merged[idx].default_bullet,
        min_bullets: pin.min_bullets ?? merged[idx].min_bullets ?? 1,
      };
    } else {
      merged.push({ min_bullets: 1, aliases: [], ...pin });
    }
  }
  return merged;
}

/** @returns {Array<object>} Every cv.md employer + profile overrides (never omit). */
export function loadPinnedExperience(profilePath = PROFILE_PATH) {
  const fromCv = parseCvWorkExperience();
  let fromProfile = [];
  if (existsSync(profilePath)) {
    try {
      const cfg = yamlLoad(readFileSync(profilePath, 'utf-8')) || {};
      if (Array.isArray(cfg.cv?.pinned_experience)) fromProfile = cfg.cv.pinned_experience;
    } catch {
      /* fall through */
    }
  }
  if (fromCv.length) return mergeRequiredRoles(fromCv, fromProfile);
  if (fromProfile.length) return fromProfile;
  return DEFAULT_PINNED_EXPERIENCE;
}

/**
 * @param {object} payload CV JSON payload (modes/pdf.md schema)
 * @returns {{ verdict: 'pass'|'block', missing: string[], thin: string[], message: string }}
 */
export function checkPinnedExperience(payload, pinned = loadPinnedExperience()) {
  const experience = payload?.experience || [];
  const missing = [];
  const thin = [];
  for (const pin of pinned) {
    const job = experience.find((j) => jobMatchesPin(j, pin));
    if (!job) {
      missing.push(pin.company);
      continue;
    }
    const count = (job.bullets || []).filter((b) => String(b).trim()).length;
    const need = pin.min_bullets ?? 1;
    if (count < need) thin.push(`${pin.company} (${count}/${need} bullets)`);
  }
  if (!missing.length && !thin.length) {
    return { verdict: 'pass', missing: [], thin: [], message: '' };
  }
  const message = [
    missing.length ? `missing required role(s): ${missing.join(', ')}` : '',
    thin.length ? `under-filled required role(s): ${thin.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  return { verdict: 'block', missing, thin, message };
}

function reorderExperienceToCvOrder(experience, pinned) {
  const sorted = [];
  const remaining = [...experience];
  for (const pin of pinned) {
    const idx = remaining.findIndex((j) => jobMatchesPin(j, pin));
    if (idx >= 0) {
      sorted.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
  }
  return [...sorted, ...remaining];
}

/**
 * Ensure every cv.md employer is present before PDF render. Inserts missing roles
 * and back-fills a default bullet when a required role has too few.
 *
 * @returns {{ payload: object, injected: string[] }}
 */
export function injectPinnedExperience(payload, pinned = loadPinnedExperience()) {
  const out = { ...payload, experience: [...(payload.experience || [])] };
  const injected = [];

  for (const pin of pinned) {
    let job = out.experience.find((j) => jobMatchesPin(j, pin));
    const need = pin.min_bullets ?? 1;
    const fallback = pin.default_bullet || '';

    if (!job) {
      job = {
        company: pin.company,
        role: pin.role || '',
        dates: pin.dates || '',
        location: pin.location || '',
        bullets: fallback ? [fallback] : [],
      };
      out.experience.push(job);
      injected.push(pin.company);
    } else {
      const bullets = (job.bullets || []).filter((b) => String(b).trim());
      if (bullets.length < need && fallback) {
        job.bullets = bullets.length ? bullets : [fallback];
        if (!bullets.length) injected.push(pin.company);
      }
    }
  }

  out.experience = reorderExperienceToCvOrder(out.experience, pinned);
  return { payload: out, injected };
}
