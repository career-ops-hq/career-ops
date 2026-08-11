#!/usr/bin/env node

const PEOPLE_ROLE_PATTERNS = [
  /\bemployee success\b/i,
  /\bpeople\b/i,
  /\btotal rewards?\b/i,
  /\bhuman resources?\b/i,
  /\bhrbp\b/i,
  /\bbusiness partner\b/i,
  /\btalent\b/i,
  /\bworkforce\b/i,
  /\bcompensation\b/i,
  /\bbenefits?\b/i,
  /\borg(?:anizational)? planning\b/i,
  /\bsuccession\b/i,
  /\bpeople analytics\b/i,
];

function scorePeopleSignals(text) {
  const value = String(text || '');
  return PEOPLE_ROLE_PATTERNS.reduce((score, pattern) => score + (pattern.test(value) ? 1 : 0), 0);
}

export function classifyRoleTailoringTarget({ roleTitle = '', jdText = '', reportText = '' } = {}) {
  const titleScore = scorePeopleSignals(roleTitle) * 3;
  const jdScore = scorePeopleSignals(jdText);
  const reportScore = scorePeopleSignals(reportText);
  const total = titleScore + jdScore + reportScore;

  if (total >= 4) {
    return {
      key: 'people_hr',
      score: total,
      label: 'HR / People / Employee Success',
    };
  }

  return {
    key: 'default',
    score: total,
    label: 'Default',
  };
}

export function buildTailoringHintBlock(input = {}) {
  const classification = classifyRoleTailoringTarget(input);
  if (classification.key !== 'people_hr') return '';

  return [
    'ROLE-FAMILY OVERRIDE: HR / People / Employee Success',
    'This role must be tailored as an HR-adjacent / business-partner document, not a generic strategy-ops document.',
    'Required tailoring rules for this role family:',
    '1. Prefer People-function language: workforce analytics, executive advisory, org support, talent-cycle support, stakeholder coaching, compensation/benefits context, and leadership decision support when truthfully supported by the CV.',
    '2. Use the title semantics first: HRBP, Employee Success, talent cycles, succession, workforce planning, compensation reviews, executive coaching, org planning.',
    '3. Apply a hard negative filter: exclude plausible but distracting content that does not improve fit for a People-function reader.',
    '4. Suppress unrelated technical or project sections unless the JD makes them central. AI/agentic/homelab/project material is excluded by default for this role family.',
    '5. If multiple narratives are possible, prefer this order: people analytics / Total Rewards operator -> HR-adjacent business partner / executive advisor -> generic strategy / transformation operator.',
  ].join('\n');
}

