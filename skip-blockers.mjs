/**
 * skip-blockers.mjs — which JD requirements keep showing up in the roles you skip.
 *
 * Reads the `requirement_importance` rows every Machine Summary carries (see
 * batch/batch-prompt.md) for your most recent skipped and discarded roles, and
 * counts each critical or high requirement the evaluator marked `missing` or
 * `partial`. upskill.mjs calls it and adds the result to its JSON as
 * `skipBlockers`.
 *
 * This differs from the upskill gap map in two ways that matter. It does not
 * subtract skills already in cv.md, because a `partial` verdict on a skill the
 * CV lists means the CV names the skill and the evaluator found the evidence
 * thin. And it keeps requirements that are not tool names, such as people
 * management, which the skill vocabulary cannot see.
 */

import { extractSkills } from './skill-extract.mjs';

export const SKIP_WINDOW = 20;
export const CLOSE_CALL_SCORE = 3.5;
const SKIP_STATES = new Set(['skip', 'discarded']);
const BLOCKING_IMPORTANCE = new Set(['critical', 'high']);
const UNMET = new Set(['missing', 'partial']);

// Requirements that are not tool names but recur across JDs in many wordings.
// A requirement that names a skill from skill-extract.mjs groups under the
// skill first. Anything else that matches no theme groups by its own wording.
const THEMES = [
  ['People management', /\b(?:people|team) manage|\bmanag(?:e|es|ed|ing)\s+(?:\S+\s+){0,2}(?:teams?|engineers|managers|people|direct reports)\b|\bdirect reports\b/i],
  ['Pre-sales', /\bpre-?sales\b/i],
  ['Security clearance', /\bclearance\b|\bTS\/SCI\b/i],
  ['PhD', /\bph\.?d\b|\bdoctorate\b/i],
];

/**
 * The groups one requirement counts under.
 *
 * @param {string} requirement
 * @returns {Array<{key: string, label: string, kind: 'skill'|'theme'|'requirement'}>}
 */
export function blockerGroups(requirement) {
  const skills = [...extractSkills(requirement)];
  if (skills.length > 0) return skills.map((s) => ({ key: `skill:${s}`, label: s, kind: 'skill' }));
  const theme = THEMES.find(([, re]) => re.test(requirement));
  if (theme) return [{ key: `theme:${theme[0]}`, label: theme[0], kind: 'theme' }];
  const text = requirement.trim().replace(/\s+/g, ' ');
  return [{ key: `requirement:${text.toLowerCase()}`, label: text, kind: 'requirement' }];
}

/**
 * Rank the requirements behind your most recent skips.
 *
 * @param {Array<{num: number, date: string, state: string|null, score: number|null,
 *   requirements: Array<{requirement: string, importance: string, match: string}>}>} reports
 *   `state` is the canonical tracker state id from templates/states.yml.
 * @param {{window?: number, minSkips?: number, limit?: number}} [options]
 * @returns {{window: number, skips: number, blockers: Array<{label: string,
 *   kind: string, skips: number, missing: number, partial: number,
 *   closeCalls: number, nudge: 'learn'|'evidence', reports: number[],
 *   wordings: string[]}>}}
 */
export function rankSkipBlockers(reports, { window = SKIP_WINDOW, minSkips = 2, limit = 5 } = {}) {
  const recent = reports
    .filter((r) => SKIP_STATES.has(r.state))
    .sort((a, b) => b.date.localeCompare(a.date) || b.num - a.num)
    .slice(0, window);

  const byKey = new Map();
  for (const report of recent) {
    const verdicts = new Map();
    for (const row of report.requirements) {
      if (!BLOCKING_IMPORTANCE.has(row.importance) || !UNMET.has(row.match)) continue;
      for (const group of blockerGroups(row.requirement)) {
        const seen = verdicts.get(group.key);
        const match = seen?.match === 'missing' ? 'missing' : row.match;
        verdicts.set(group.key, { group, match, wordings: [...(seen?.wordings ?? []), row.requirement] });
      }
    }
    for (const [key, { group, match, wordings }] of verdicts) {
      if (!byKey.has(key)) {
        byKey.set(key, { label: group.label, kind: group.kind, skips: 0, missing: 0, partial: 0, closeCalls: 0, reports: [], wordings: new Set() });
      }
      const entry = byKey.get(key);
      entry.skips += 1;
      entry[match] += 1;
      if (Number.isFinite(report.score) && report.score >= CLOSE_CALL_SCORE) entry.closeCalls += 1;
      entry.reports.push(report.num);
      for (const w of wordings) entry.wordings.add(w);
    }
  }

  const blockers = [...byKey.values()]
    .filter((b) => b.skips >= minSkips)
    .sort((a, b) => b.skips - a.skips || b.closeCalls - a.closeCalls || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((b) => ({
      ...b,
      nudge: b.partial >= b.missing ? 'evidence' : 'learn',
      wordings: [...b.wordings].slice(0, 3),
    }));

  return { window, skips: recent.length, blockers };
}

/**
 * The `requirement_importance` list from a parsed Machine Summary, keeping only
 * rows with the three string fields this module reads.
 *
 * @param {unknown} value
 * @returns {Array<{requirement: string, importance: string, match: string}>}
 */
export function parseRequirementImportance(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => row && typeof row.requirement === 'string' && row.requirement.trim()
      && typeof row.importance === 'string' && typeof row.match === 'string')
    .map((row) => ({ requirement: row.requirement.trim(), importance: row.importance.trim().toLowerCase(), match: row.match.trim().toLowerCase() }));
}
