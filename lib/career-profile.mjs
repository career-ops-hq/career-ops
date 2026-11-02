/** Shared schema v1 validation and read-only loading for Master Career Profile. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadYaml } from './yaml-document.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';

const STATUS = new Set(['needs_review', 'verified']);

export function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object' || profile.schema_version !== 1) errors.push('schema_version must be 1');
  if (!profile?.candidate || typeof profile.candidate !== 'object') errors.push('candidate must be a mapping');
  const ids = new Set();
  const checkFact = (fact, path) => {
    if (!fact || typeof fact !== 'object') { errors.push(`${path} must be a mapping`); return; }
    if (typeof fact.id !== 'string' || !fact.id.trim()) errors.push(`${path}.id is required`);
    else if (ids.has(fact.id)) errors.push(`duplicate id: ${fact.id}`);
    else ids.add(fact.id);
    if (typeof fact.text !== 'string' || !fact.text.trim()) errors.push(`${path}.text is required`);
    if (!STATUS.has(fact.review_status)) errors.push(`${path}.review_status must be needs_review or verified`);
    if (!fact.evidence || typeof fact.evidence.source !== 'string' || !fact.evidence.source.trim() ||
        !Number.isInteger(fact.evidence.line) || fact.evidence.line < 1 ||
        typeof fact.evidence.quote !== 'string' || !fact.evidence.quote.trim()) errors.push(`${path}.evidence requires source, positive line, and quote`);
  };
  const arrays = ['summary', 'experiences', 'projects', 'education', 'certifications', 'skills'];
  for (const key of arrays) if (!Array.isArray(profile?.[key])) errors.push(`${key} must be a list`);
  for (const key of ['summary', 'certifications', 'skills']) {
    (Array.isArray(profile?.[key]) ? profile[key] : []).forEach((fact, i) => checkFact(fact, `${key}[${i}]`));
  }
  for (const key of ['experiences', 'projects', 'education']) {
    (Array.isArray(profile?.[key]) ? profile[key] : []).forEach((entry, i) => {
      const path = `${key}[${i}]`;
      if (!entry || typeof entry.label !== 'string' || !entry.label.trim()) errors.push(`${path}.label is required`);
      checkFact({ ...entry, text: entry?.label, review_status: entry?.review_status ?? 'verified' }, path);
      if (!Array.isArray(entry?.facts)) errors.push(`${path}.facts must be a list`);
      else entry.facts.forEach((fact, j) => checkFact(fact, `${path}.facts[${j}]`));
    });
  }
  return errors;
}

/** Missing/invalid profiles fail; only the importer may initialize a new one. */
export function loadValidatedProfile({ dataRoot = getCareerOpsRoot(), file = join(dataRoot, 'data', 'career-profile.yml') } = {}) {
  const profile = loadYaml(readFileSync(file, 'utf8'));
  const errors = validateProfile(profile);
  if (errors.length) throw new Error(`Invalid profile:\n- ${errors.join('\n- ')}`);
  return profile;
}
