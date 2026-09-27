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

// Backfill pool for sparse tailored CVs: the candidate's OWN builds only.
//
// SPARK Analytics MVP and the Donor Engagement Portal were Deloitte client
// deliveries and used to sit here, badged "Regulated Industry" and "Bilingual"
// -- badges naming no client at all, so a tailored CV presented them as
// personal work and carried a $500K savings claim into a Projects section the
// candidate does not own. They now appear only inside the Deloitte
// experience block, where the client is named.
//
// This pool is also what lets `enrichCvContent` reach its own
// `wantProjects` floor, so it must hold at least three entries. Adding a
// client engagement here is a silent regression; `verify-cv-style.mjs` fails
// the build if a project duplicates a bullet under a non-venture employer.
const CLEARSTATE_URL =
  'https://quilt-cuckoo-1da.notion.site/ClearState-Case-Study-30921d15774880c7b862e0c8e08eefca';

const CV_PROJECTS = [
  {
    name: 'kbcompress.com',
    badge: 'Open Source',
    tech: 'Web Application',
    description: 'Built and shipped kbcompress.com, a free image compression tool for Indian exam portals',
    url: null,
    keywords: ['kbcompress'],
  },
  {
    name: 'Hermes-Router',
    badge: 'Open Source',
    tech: 'Node/Express, OpenRouter',
    description: 'Built Hermes-Router, a model router in Node/Express sitting over OpenRouter',
    url: null,
    keywords: ['hermes-router', 'hermes router', 'openrouter'],
  },
  {
    name: 'ClearState',
    badge: 'Case study',
    tech: 'Cloudflare Workers, Granite 4.0',
    description:
      'Governance-aware executive reporting prototype: position-based isolation, governance checks before any AI access, and a constrained rewrite layer; the first shipped build under SigmaX Labs (Feb 2026)',
    url: CLEARSTATE_URL,
    keywords: ['clearstate', 'governance', 'cloudflare workers', 'granite'],
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

// The candidate's own ventures, plus the regulated-industry moat that the
// headline, the competency spine and the whole scoring depend on. Work under
// these is legitimately both a bullet and a project, so filling them first can
// never misattribute anything.
const PROTECTED_EMPLOYER_RE = /sigmax|goodtime|deloitte/i;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Months spanned by a `"Nov 2025 -- Present"` / `"Sep 2022 -- Oct 2024"` string. */
export function durationMonths(dates, now = new Date()) {
  const parts = String(dates ?? '')
    .split(/\s*(?:--|[-–—]|\bto\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return 0;
  const stamp = (s, isEnd) => {
    const m = /([a-z]{3,})\w*\s+(\d{4})/i.exec(s);
    if (!m) return null;
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon === undefined) return null;
    return { year: Number(m[2]), mon: isEnd ? mon + 1 : mon }; // inclusive of the closing month
  };
  const open = stamp(parts[0], false);
  // "Present"/"Current" carries no year of its own -- it means today.
  const end = /present|current|now|today/i.test(parts[1])
    ? { year: now.getFullYear(), mon: now.getMonth() + 1 }
    : stamp(parts[1], true);
  // Bare years ("2022 - 2024") carry no month; fall back to whole-year spans.
  if (!open || !end) {
    const y0 = Number((/(\d{4})/.exec(parts[0]) || [])[1]);
    const y1 = Number((/(\d{4})/.exec(parts[1]) || [])[1]);
    if (!y0 || !y1 || y1 <= y0) return 0;
    return (y1 - y0) * 12;
  }
  const months = (end.year - open.year) * 12 + (end.mon - open.mon);
  return months > 0 ? months : 0;
}

/**
 * Order cv.md roles for page-fill priority.
 *
 * Tier 1 -- the candidate's own ventures and the regulated moat, each filled
 * to its cv.md ceiling first.
 * Tier 2 -- everything else, longest tenure first.
 *
 * Sorting on duration alone would spend recovered page space on the longest
 * *stale* role: Synergy Teletech spans 24 months against SigmaX Labs' 11, and
 * InstaCure (12) would outrank the current founder role (11), so a decade-old
 * field-executive bullet could displace present-tense work the candidate can
 * discuss in detail. Duration therefore breaks ties within tier 2 only.
 */
export function fillPriority(roles, now = new Date()) {
  return [...roles].sort((a, b) => {
    const pa = PROTECTED_EMPLOYER_RE.test(a.company || '') ? 0 : 1;
    const pb = PROTECTED_EMPLOYER_RE.test(b.company || '') ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return durationMonths(b.dates, now) - durationMonths(a.dates, now);
  });
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
  const sourceRoles = fillPriority(parseCvWorkExperience(cvPath));

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
      url: next.url || null,
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
