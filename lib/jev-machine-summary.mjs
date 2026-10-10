// lib/jev-machine-summary.mjs — deterministic Machine Summary composer.
//
// Envelope B contract: the report's `## Machine Summary` YAML is never written
// free-form by the generative LLM. Bounded enum fields come from Jev (System
// One) decisions via lib/jev-atomic-core.mjs's machineSummaryFrom(); typed
// scalar and prose slot fields come from the evaluation layer; this module
// composes the block deterministically and validates it against the schema in
// batch/batch-prompt.md (Feature: Machine Summary).
//
// Consumers (analyze-patterns.mjs, upskill.mjs, salary-gap.mjs,
// check-jd-archive.mjs, verify-pipeline.mjs, web/src/lib/run-prompts.mjs) read
// the block by regexing the fence and js-yaml.load()ing it, so any structural
// shape this module emits stays compatible as long as field names are exact.
//
// This module is pure: read-only over its inputs, no state, no process usage.
// It never fabricates a field that is not supplied.

import { load as yamlLoad } from 'js-yaml';
import { dump as yamlDump } from 'js-yaml';

import { machineSummaryFrom } from './jev-atomic-core.mjs';

export const MACHINE_SUMMARY_VERSION = '1.0.0';

// ── Contract vocab (batch/batch-prompt.md Machine Summary) ────────────────
export const LEGITIMACY_TIERS = ['High Confidence', 'Proceed with Caution', 'Suspicious'];
export const RISK_LEVELS = ['Low', 'Medium', 'High'];
export const CONFIDENCE_LEVELS = ['Low', 'Medium', 'High'];
export const FINAL_DECISIONS = ['Apply', 'Consider', 'Research first', 'Skip'];
export const WORK_AUTH_OPTIONS = ['sponsors', 'not_needed', 'unstated', 'no_sponsorship'];

export const EVIDENCE_VALUES = ['stated', 'structural', 'inferred'];
export const IMPORTANCE_VALUES = ['critical', 'high', 'meaningful', 'preferred', 'low_signal'];
export const MATCH_VALUES = ['strong', 'partial', 'missing', 'na'];

export const RISK_SUMMARY_ENUMS = {
  legitimacy: ['high_confidence', 'proceed_with_caution', 'suspicious'],
  classification: ['clear', 'flagged', 'not_evaluated'],
  culture: ['pass', 'caution', 'fail', 'not_evaluated'],
  interview_redflags: ['none', 'caution', 'warning', 'not_evaluated'],
  ai_infra: ['consistent', 'mismatch', 'not_evaluated'],
  ai_screening_disclosure: ['disclosed', 'corroborating_only', 'no_match', 'not_evaluated'],
};

// Ordered set of accepted top-level keys, mirroring the allowlist consumers
// filter to (analyze-patterns.mjs MACHINE_SUMMARY_FIELDS) plus the newer keys.
export const MACHINE_SUMMARY_FIELDS = [
  'company',
  'role',
  'score',
  'legitimacy_tier',
  'archetype',
  'final_decision',
  'hard_stops',
  'soft_gaps',
  'top_strengths',
  'risk_level',
  'confidence',
  'next_action',
  'work_auth',
  'discard_reasons',
  'via',
  'company_confidential',
  'advertised_comp',
  'reports_to',
  'requirement_importance',
  'risk_summary',
];

/** Jev legitimacy key → top-level Machine Summary wording. */
export function jevTierToMachineTier(key) {
  return { high_confidence: 'High Confidence', proceed_with_caution: 'Proceed with Caution', suspicious: 'Suspicious' }[key] ?? null;
}

/** Jev risk key → top-level Machine Summary wording. */
export function jevRiskToMachineRisk(key) {
  return { low: 'Low', medium: 'Medium', high: 'High' }[key] ?? null;
}

/**
 * Map decoded Jev decisions to the four Machine Summary enum fields.
 * Returns only the fields Jev actually answered (absent otherwise); the caller
 * supplies the rest.
 */
export function machineSummaryForJev(decodedDecisions) {
  const from = machineSummaryFrom(decodedDecisions);
  const out = {};
  if (from.legitimacy_tier !== undefined) {
    const tier = jevTierToMachineTier(from.legitimacy_tier);
    if (tier !== null) out.legitimacy_tier = tier;
  }
  if (from.risk_level !== undefined) {
    const risk = jevRiskToMachineRisk(from.risk_level);
    if (risk !== null) out.risk_level = risk;
  }
  if (from.work_auth !== undefined) out.work_auth = from.work_auth;
  if (from.archetype !== undefined) out.archetype = from.archetype;
  return out;
}

/** The snake_case legitimacy key for risk_summary.legitimacy, or null. */
export function riskSummaryLegitimacyFromJev(decodedDecisions) {
  const from = machineSummaryFrom(decodedDecisions);
  return from.legitimacy_tier ?? null;
}

function isString(v) {
  return typeof v === 'string' && v.length > 0;
}
function isStringOrNull(v) {
  return v === null || (typeof v === 'string' && v.length > 0);
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function isInEnum(v, values, label) {
  return (typeof v === 'string' && values.includes(v)) || `${label}: expected one of ${values.join(' | ')}, got ${JSON.stringify(v)}`;
}

/**
 * Validate a Machine Summary object against the batch-prompt.md contract.
 * Returns an array of violation strings; empty array means valid.
 */
export function validateMachineSummary(summary) {
  const problems = [];
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) {
    return ['machine summary must be a plain object'];
  }

  for (const key of ['company', 'role']) {
    if (!isString(summary[key])) problems.push(`${key}: must be a non-empty string`);
  }

  const score = summary.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 5) {
    problems.push(`score: must be a finite number between 0 and 5, got ${JSON.stringify(score)}`);
  }

  if (typeof summary.legitimacy_tier === 'string' && isInEnum(summary.legitimacy_tier, LEGITIMACY_TIERS, 'legitimacy_tier') !== true) {
    problems.push(`legitimacy_tier: expected one of ${LEGITIMACY_TIERS.join(' | ')}, got ${JSON.stringify(summary.legitimacy_tier)}`);
  } else if (typeof summary.legitimacy_tier !== 'string') {
    problems.push('legitimacy_tier: must be a string');
  }

  if (!isString(summary.archetype)) problems.push('archetype: must be a non-empty string');

  if (typeof summary.final_decision === 'string' && !FINAL_DECISIONS.includes(summary.final_decision)) {
    problems.push(`final_decision: expected one of ${FINAL_DECISIONS.join(' | ')}, got ${JSON.stringify(summary.final_decision)}`);
  } else if (typeof summary.final_decision !== 'string') {
    problems.push('final_decision: must be a string');
  }

  for (const key of ['hard_stops', 'soft_gaps', 'top_strengths', 'discard_reasons']) {
    if (summary[key] !== undefined && !isStringArray(summary[key])) {
      problems.push(`${key}: must be an array of strings`);
    }
  }

  if (typeof summary.risk_level === 'string' && !RISK_LEVELS.includes(summary.risk_level)) {
    problems.push(`risk_level: expected one of ${RISK_LEVELS.join(' | ')}, got ${JSON.stringify(summary.risk_level)}`);
  } else if (typeof summary.risk_level !== 'string') {
    problems.push('risk_level: must be a string');
  }

  if (typeof summary.confidence === 'string' && !CONFIDENCE_LEVELS.includes(summary.confidence)) {
    problems.push(`confidence: expected one of ${CONFIDENCE_LEVELS.join(' | ')}, got ${JSON.stringify(summary.confidence)}`);
  } else if (typeof summary.confidence !== 'string') {
    problems.push('confidence: must be a string');
  }

  if (!isString(summary.next_action)) problems.push('next_action: must be a non-empty string');

  if (typeof summary.work_auth === 'string' && !WORK_AUTH_OPTIONS.includes(summary.work_auth)) {
    problems.push(`work_auth: expected one of ${WORK_AUTH_OPTIONS.join(' | ')}, got ${JSON.stringify(summary.work_auth)}`);
  } else if (typeof summary.work_auth !== 'string') {
    problems.push('work_auth: must be a string');
  }

  if (!isStringOrNull(summary.via)) problems.push('via: must be a string or null');
  if (typeof summary.company_confidential !== 'boolean') problems.push('company_confidential: must be a boolean');
  if (!isStringOrNull(summary.advertised_comp)) problems.push('advertised_comp: must be a string or null');
  if (!isStringOrNull(summary.reports_to)) problems.push('reports_to: must be a string or null');

  if (summary.requirement_importance !== undefined && summary.requirement_importance !== null) {
    if (!Array.isArray(summary.requirement_importance)) {
      problems.push('requirement_importance: must be an array');
    } else {
      summary.requirement_importance.forEach((row, i) => {
        const at = `requirement_importance[${i}]`;
        if (row === null || typeof row !== 'object') {
          problems.push(`${at}: must be an object`);
          return;
        }
        if (!isString(row.requirement)) problems.push(`${at}.requirement: must be a non-empty string`);
        if (!isStringOrNull(row.jd_signal)) problems.push(`${at}.jd_signal: must be a string or null`);
        if (isInEnum(row.evidence, EVIDENCE_VALUES, `${at}.evidence`) !== true) {
          problems.push(isInEnum(row.evidence, EVIDENCE_VALUES, `${at}.evidence`));
        }
        if (isInEnum(row.importance, IMPORTANCE_VALUES, `${at}.importance`) !== true) {
          problems.push(isInEnum(row.importance, IMPORTANCE_VALUES, `${at}.importance`));
        }
        if (isInEnum(row.match, MATCH_VALUES, `${at}.match`) !== true) {
          problems.push(isInEnum(row.match, MATCH_VALUES, `${at}.match`));
        }
        if (row.evidence === 'stated' && (row.jd_signal === null || typeof row.jd_signal !== 'string')) {
          problems.push(`${at}: evidence "stated" requires a non-null verbatim jd_signal`);
        }
        if (row.evidence === 'inferred' && (row.importance === 'critical' || row.importance === 'high')) {
          problems.push(`${at}: evidence "inferred" cannot carry importance "critical" or "high"`);
        }
      });
    }
  }

  if (summary.risk_summary !== undefined && summary.risk_summary !== null) {
    if (typeof summary.risk_summary !== 'object' || Array.isArray(summary.risk_summary)) {
      problems.push('risk_summary: must be an object');
    } else {
      for (const [key, values] of Object.entries(RISK_SUMMARY_ENUMS)) {
        const v = summary.risk_summary[key];
        if (typeof v === 'string' && values.includes(v)) continue;
        if (typeof v === 'string') {
          problems.push(`risk_summary.${key}: expected one of ${values.join(' | ')}, got ${JSON.stringify(v)}`);
        } else {
          problems.push(`risk_summary.${key}: must be a string`);
        }
      }
    }
  }

  return problems;
}

export function isValidMachineSummary(summary) {
  return validateMachineSummary(summary).length === 0;
}

/**
 * Deterministically render the Machine Summary block body (the content inside
 * the ```yaml fence) as YAML. Field insertion follows MACHINE_SUMMARY_FIELDS
 * order; strings are always double-quoted so the output stays contract-shaped
 * even for prose with colons, hashes, or YAML keywords.
 */
export function renderMachineSummaryYaml(summary) {
  const ordered = {};
  for (const key of MACHINE_SUMMARY_FIELDS) {
    if (summary[key] !== undefined) ordered[key] = summary[key];
  }
  return yamlDump(ordered, { noRefs: true, forceQuotes: true, quotingType: '"' }).trimEnd();
}

const MS_REGEX = /##\s*Machine Summary\s*\n+```(?:yaml|yml|json)?\s*\n([\s\S]*?)\n```/i;

/**
 * Extract and parse a Machine Summary block from a report's markdown. Returns
 * the parsed object, or null when no parseable block is present.
 */
export function extractMachineSummary(markdown) {
  if (typeof markdown !== 'string') return null;
  const m = markdown.match(MS_REGEX);
  if (!m || !m[1].trim()) return null;
  try {
    const parsed = yamlLoad(m[1]);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}