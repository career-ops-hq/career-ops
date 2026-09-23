#!/usr/bin/env node
/**
 * cv-enrich-content.mjs — backfill sparse tailored CV JSON with verified cv.md content.
 *
 * Fills one-page whitespace by adding real bullets/projects/skills from cv.md,
 * not by stretching PDF line spacing. Used by generate-pdf.mjs before render.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { jobMatchesPin, parseCvWorkExperience } from './cv-pinned-experience.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const CV_PATH = join(getCareerOpsRoot(), 'cv.md');

/** ~one page at tightness 0–1 on A4 (chars in renderable fields). */
export const TARGET_CONTENT_CHARS = 3600;

const CV_PROJECTS = [
  {
    name: 'SPARK Analytics MVP',
    badge: 'Regulated Industry',
    tech: 'Python, Analytics',
    description:
      'Delivered the SPARK analytics MVP for real-time clinical and regulatory KPIs -- $500K projected cost savings',
    keywords: ['spark', 'analytics mvp', 'clinical and regulatory'],
  },
  {
    name: 'Donor Engagement Portal',
    badge: 'Bilingual',
    tech: 'Agile/Scrum',
    description:
      'Drove Agile development of a bilingual Donor Engagement Portal; 25% faster release cycles; 18% client retention improvement via 20+ features shipped from user feedback',
    keywords: ['donor engagement', 'donor portal', 'bilingual'],
  },
  {
    name: 'kbcompress.com',
    badge: 'Open Source',
    tech: 'Web Application',
    description: 'Built and shipped kbcompress.com, a free image compression tool for Indian exam portals',
    keywords: ['kbcompress'],
  },
  {
    name: 'Hermes-Router',
    badge: 'Open Source',
    tech: 'Node/Express, OpenRouter',
    description: 'Built Hermes-Router, a model router in Node/Express sitting over OpenRouter',
    keywords: ['hermes-router', 'hermes router', 'openrouter'],
  },
];

function normText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\*\*/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bulletsSimilar(a, b) {
  const left = normText(a);
  const right = normText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftWords = new Set(left.split(/\s+/).filter((w) => w.length > 3));
  const rightWords = right.split(/\s+/).filter((w) => w.length > 3);
  if (!leftWords.size || !rightWords.length) return false;
  let overlap = 0;
  for (const w of rightWords) if (leftWords.has(w)) overlap++;
  return overlap / rightWords.length >= 0.55;
}

function projectListed(proj, projects) {
  const name = normText(proj.name);
  return (projects || []).some((p) => normText(p.name) === name);
}

export function parseCvSkills(cvPath = CV_PATH) {
  if (!existsSync(cvPath)) return [];
  const md = readFileSync(cvPath, 'utf-8');
  const heading = md.match(/^## Skills\s*$/m);
  if (!heading) return [];
  const body = md.slice(heading.index + heading[0].length).replace(/^\s*\n/, '').split(/\n## /)[0];
  const skills = [];
  for (const line of body.split('\n')) {
    const m = line.trim().match(/^- \*\*(.+?):\*\*\s*(.+)$/);
    if (m) skills.push({ category: m[1], items: m[2] });
  }
  return skills;
}

export function contentVolumeScore(payload) {
  const parts = [
    payload.summary,
    ...(payload.competencies || []),
    ...(payload.experience || []).flatMap((j) => [j.role, j.company, ...(j.bullets || [])]),
    ...(payload.projects || []).flatMap((p) => [p.name, p.badge, p.tech, p.description]),
    ...(payload.education || []).flatMap((e) => [e.title, e.org, e.year, e.description]),
    ...(payload.certifications || []).flatMap((c) => [c.title, c.org, c.year]),
    ...(payload.skills || []).flatMap((s) => [s.category, s.items]),
  ];
  return parts.filter(Boolean).join(' ').length;
}

/**
 * @param {object} payload CV JSON payload
 * @param {{ cvPath?: string, targetChars?: number }} [opts]
 * @returns {{ payload: object, added: string[], scoreBefore: number, scoreAfter: number }}
 */
export function enrichCvContent(payload, opts = {}) {
  const cvPath = opts.cvPath || CV_PATH;
  const targetChars = opts.targetChars ?? TARGET_CONTENT_CHARS;
  const out = {
    ...payload,
    experience: (payload.experience || []).map((j) => ({ ...j, bullets: [...(j.bullets || [])] })),
    projects: [...(payload.projects || [])],
    skills: [...(payload.skills || [])],
  };
  const scoreBefore = contentVolumeScore(out);
  if (scoreBefore >= targetChars) {
    return { payload: out, added: [], scoreBefore, scoreAfter: scoreBefore };
  }

  const added = [];
  const sourceRoles = parseCvWorkExperience(cvPath);

  for (const src of sourceRoles) {
    const job = out.experience.find((j) => jobMatchesPin(j, src));
    if (!job) continue;
    for (const bullet of src.source_bullets || []) {
      if (contentVolumeScore(out) >= targetChars) break;
      if ((job.bullets || []).some((b) => bulletsSimilar(b, bullet))) continue;
      job.bullets.push(bullet);
      added.push(`${src.company}: experience bullet`);
    }
  }

  const wantProjects = Math.max(3, (out.projects || []).length);
  while (out.projects.length < wantProjects && contentVolumeScore(out) < targetChars) {
    const next = CV_PROJECTS.find(
      (p) => !out.projects.some((x) => normText(x.name) === normText(p.name)) && !projectListed(p, out.projects),
    );
    if (!next) break;
    out.projects.push({
      name: next.name,
      badge: next.badge,
      tech: next.tech,
      description: next.description,
    });
    added.push(`project: ${next.name}`);
  }

  const srcSkills = parseCvSkills(cvPath);
  if (srcSkills.length) {
    const have = new Set((out.skills || []).map((s) => normText(s.category)));
    for (const sk of srcSkills) {
      if (contentVolumeScore(out) >= targetChars) break;
      if (have.has(normText(sk.category))) continue;
      out.skills.push(sk);
      have.add(normText(sk.category));
      added.push(`skills: ${sk.category}`);
    }
  }

  const scoreAfter = contentVolumeScore(out);
  return { payload: out, added, scoreBefore, scoreAfter };
}
