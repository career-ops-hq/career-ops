/**
 * cv-jd-align.mjs — Honest JD vocabulary alignment for tailored CV JSON.
 *
 * Uses evaluation report Block B (requirement + evidence rows) to weave JD
 * phrases into competencies when cv.md already supports the claim.
 */

import { readFileSync, existsSync } from 'fs';
import {
  cvPayloadToText,
  requirementMatchStrength,
  extractBlockBRequirements,
} from './cv-jd-fit.mjs';

const NEGATIVE_EVIDENCE_RE = /^(no direct|no such|no specific|no explicit|not explicitly)\b/i;

function normText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[‑–—]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Short competency label derived from a Block B requirement line. */
export function competencyLabelFromRequirement(requirement) {
  const r = String(requirement ?? '').toLowerCase();
  if (r.includes('agile') && (r.includes('content') || r.includes('deliver') || r.includes('feature'))) {
    return 'Agile content delivery & iterative release';
  }
  if (r.includes('b2b') && r.includes('saas')) return 'B2B SaaS & enterprise software';
  if (r.includes('stakeholder') || r.includes('gathering requirements')) {
    return 'Stakeholder requirements & internal alignment';
  }
  if (r.includes('third') && r.includes('integration')) return 'Third-party content & data integration';
  if (r.includes('roadmap')) return 'Product roadmaps with engineering teams';
  if (r.includes('distributed team')) return 'Distributed / remote team collaboration';
  if (r.includes('analytical') || r.includes('attention to detail')) {
    return 'Analytical rigor & detail-oriented delivery';
  }
  if (r.includes('priorit') && r.includes('deadline')) return 'Priority setting & deadline delivery';
  if (r.includes('engagement') && r.includes('release')) return 'Engagement-to-release product delivery';
  if (r.includes('microsoft') || r.includes('google workspace') || r.includes('workspace')) {
    return 'Google Workspace & office productivity tooling';
  }
  if (r.includes('launch') && (r.includes('training') || r.includes('documentation'))) {
    return 'Launch support: training & documentation';
  }
  if (r.includes('partnership') || r.includes('project-managing')) {
    return 'Partnership & cross-functional program delivery';
  }
  const trimmed = String(requirement ?? '').replace(/\s+/g, ' ').trim();
  if (trimmed.length <= 52) return trimmed;
  const cut = trimmed.slice(0, 52).replace(/\s+\S*$/, '');
  return cut.length >= 20 ? cut : trimmed.slice(0, 52);
}

/**
 * @param {object} payload
 * @param {string} reportText
 */
export function alignCvPayloadToReport(payload, reportText) {
  const rows = extractBlockBRequirements(reportText);
  if (!rows.length) return { payload, added: [] };

  const out = {
    ...payload,
    competencies: [...(payload.competencies || [])],
    summary: payload.summary || '',
  };
  const added = [];
  const have = new Set((out.competencies || []).map((c) => normText(c)));
  let cvText = cvPayloadToText(out);

  for (const { requirement, evidence } of rows) {
    if (NEGATIVE_EVIDENCE_RE.test(evidence.trim())) continue;
    if (!/lines?\s+\d+/i.test(evidence) && evidence.trim().length < 35) continue;
    if (requirementMatchStrength(requirement, cvText) >= 0.65) continue;

    const label = competencyLabelFromRequirement(requirement);
    if (!label || have.has(normText(label))) continue;

    out.competencies.push(label);
    have.add(normText(label));
    added.push(`competency: ${label}`);
    cvText = cvPayloadToText(out);
  }

  return { payload: out, added };
}

export function alignCvPayloadFromReportFile(payload, reportPath) {
  if (!reportPath || !existsSync(reportPath)) return { payload, added: [] };
  const reportText = readFileSync(reportPath, 'utf-8');
  return alignCvPayloadToReport(payload, reportText);
}
