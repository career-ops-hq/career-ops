/**
 * eval-evidence.mjs — keep a written evaluation honest about missing facts.
 *
 * The CLI evaluators have no web search. They must not fill a salary from
 * training data, and a missing salary or a culture dimension with no evidence
 * must not move the 1-5 score. The numeric score stays whatever the model
 * wrote. This module only removes the invented claim and sets the decision
 * from lib/score-action.mjs.
 */

import { recommendationFor } from './score-action.mjs';

export const NO_INVENTED_PAY_RULE =
  'Block D (Comp research): if the posting states no pay figure, mark compensation unknown. Do not estimate a salary from training data. Unknown compensation does not move the global score.';

export const UNKNOWN_COMP_SENTENCE = 'Unknown compensation does not move the global score.';

const UNKNOWN_CULTURE_SENTENCE =
  'Cultural signals: unknown. No evidence in the posting, so this dimension does not move the global score.';

export const CULTURE_SCORE_FLAG =
  'Score check: the global score was written before culture was marked unknown and was not recalculated, so it may still count a default 3 for culture.';

export const COMP_SCORE_FLAG =
  'Score check: an invented pay estimate was removed. This score was not recalculated, so it may still include that estimate.';

// A line that applies the user's deprioritize_if_absent penalty, or scores
// culture below 3, is a deliberate call and stays as written. A cap that is
// named only to say it does not apply ("no cap applies") is not a penalty.
const CULTURE_LOW_SCORE = /\b[0-2](?:\.\d+)?\s*\/\s*5\b/;
const CULTURE_PENALTY_WORD = /deprioritize_if_absent|\bcap(?:s|ped)?\b/i;
const NEGATED_PENALTY = [
  /(?:deprioritize_if_absent|\bcap(?:s|ped)?\b)[^.;,]{0,20}?\b(?:does not|doesn't|did not|is not|isn't|not)\b[^.;,]*/gi,
  /\b(?:no|not|without|never)\b[^.;,]{0,30}?(?:deprioritize_if_absent|\bcap(?:s|ped)?\b)/gi,
];

/**
 * @param {string} line
 * @returns {boolean}
 */
function isCulturePenalty(line) {
  const affirmed = NEGATED_PENALTY.reduce((rest, pattern) => {
    pattern.lastIndex = 0;
    return rest.replace(pattern, ' ');
  }, line);
  if (CULTURE_LOW_SCORE.test(affirmed)) return true;
  return CULTURE_PENALTY_WORD.test(affirmed);
}

const MONEY_FIGURE = /(?:[$£€]\s?\d|\b\d+(?:\.\d+)?\s?k\b|\b\d{2,3}(?:,\d{3})+(?:\.\d+)?\b)/i;
const TRAINING_PAY = /training[-\s]?data|salary estimates based on your training/i;
const INVENTED_PAY = /salary estimate|estimated (?:salary|comp|base|range|pay)|market (?:rate|salary)|based on (?:my )?(?:knowledge|training)|typical (?:salary|compensation|pay)/i;
// A CV line can quote a budget or a saving. That figure is not a salary the
// posting never stated, so a money mark alone is not enough to drop the line.
const PAY_LINE = /\b(?:salary|compensation|wage|wages|ote|payroll)\b|\badvertised range\b|\bbase pay\b|\bguaranteed base\b/i;
const IMPACT_VERB = 'lower|lowers|raise|raises|hold|holds|holding|reduce|reduces|increase|increases|pull|pulls|drag|drags|move|moves|affect|affects|hurt|hurts|help|helps';
const COMP_TOPIC = 'comp(?:ensation)?|salary|salaries|wage|wages|pay|payroll|ote';
const COMP_MOVES_SCORE_SOURCE = `[^\\n.]*\\b(?:${COMP_TOPIC})\\b[^\\n.]{0,120}\\b(?:${IMPACT_VERB})\\b[^\\n.]*\\bscore\\b[^\\n.]*`;
const NEGATED_SCORE_IMPACT = new RegExp(
  `\\b(?:does not|doesn't|did not|do not|don't|is not|isn't|will not|won't|cannot|can't|never|not)\\s+(?:${IMPACT_VERB})\\b`,
  'i',
);
const DECISION = 'Apply|Consider|Research first|Skip';
const YAML_VALUE = /(?:"[^"]*"|'[^']*'|[^\n#]+)/;

/**
 * True when the posting itself states a pay figure. "Competitive salary"
 * is not a figure.
 * @param {string} jdText
 * @returns {boolean}
 */
export function postingStatesPay(jdText) {
  return MONEY_FIGURE.test(String(jdText ?? ''));
}

/**
 * @param {string} text
 * @returns {number | null}
 */
export function readGlobalScore(text) {
  const fromSummary = String(text ?? '').match(/^SCORE:\s*(\d+(?:\.\d+)?)\s*$/m);
  if (fromSummary) return Number(fromSummary[1]);
  const fromHeader = String(text ?? '').match(/^\*\*Score:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*5\s*$/m);
  if (fromHeader) return Number(fromHeader[1]);
  const fromYaml = String(text ?? '').match(/^score:\s*["']?(\d+(?:\.\d+)?)["']?\s*$/m);
  if (fromYaml) return Number(fromYaml[1]);
  return null;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function reportHasHardStop(text) {
  const listed = String(text ?? '').match(/hard_stops:\s*\n((?:[ \t]+-[ \t]*\S[^\n]*\n?)*)/);
  if (listed && listed[1].trim()) return true;
  const inline = String(text ?? '').match(/hard_stops:\s*\[([^\]]*)\]/);
  return Boolean(inline && inline[1].trim());
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function reportIsSuspicious(text) {
  const body = String(text ?? '');
  return /legitimacy_tier:\s*["']?Suspicious["']?/i.test(body)
    || /^LEGITIMACY:\s*Suspicious\s*$/im.test(body)
    || /^\*\*Legitimacy:\*\*\s*Suspicious\s*$/im.test(body);
}

function dropLines(text, pattern) {
  return text.split('\n').filter((line) => !pattern.test(line)).join('\n');
}

function setYaml(text, key, value) {
  const pattern = new RegExp(`(^[\\t ]*${key}:\\s*)${YAML_VALUE.source}`, 'im');
  return text.replace(pattern, `$1"${value}"`);
}

function stripTrainingDataPay(text) {
  return dropLines(text, TRAINING_PAY);
}

function isCvEvidenceRow(line) {
  return line.split('|').some((cell) => cell.trim() === 'CV');
}

function isInventedCompLine(line) {
  if (line.includes(COMP_SCORE_FLAG) || line.includes(UNKNOWN_COMP_SENTENCE)) return false;
  if (isCvEvidenceRow(line)) return false;
  if (INVENTED_PAY.test(line)) return true;
  return MONEY_FIGURE.test(line) && PAY_LINE.test(line);
}

function stripInventedPay(text) {
  return text.split('\n').filter((line) => !isInventedCompLine(line)).join('\n');
}

function insertUnknownComp(text) {
  if (text.includes(UNKNOWN_COMP_SENTENCE)) return text;
  const marker = '---SCORE_SUMMARY---';
  const at = text.indexOf(marker);
  if (at >= 0) return `${text.slice(0, at).trimEnd()}\n\n${UNKNOWN_COMP_SENTENCE}\n\n${text.slice(at)}`;
  return `${text.trimEnd()}\n\n${UNKNOWN_COMP_SENTENCE}\n`;
}

function sentences(line) {
  return line.split(/(?<=\.)\s+/);
}

function sentenceMovesScore(sentence) {
  if (NEGATED_SCORE_IMPACT.test(sentence)) return false;
  return new RegExp(COMP_MOVES_SCORE_SOURCE, 'i').test(sentence);
}

function compClaimMovedScore(text) {
  return text.split('\n').some((line) => {
    if (line.includes(UNKNOWN_COMP_SENTENCE) || line.includes(COMP_SCORE_FLAG)) return false;
    return sentences(line).some(sentenceMovesScore);
  });
}

function stripCompScoreClaims(text) {
  return text.split('\n').map((line) => {
    if (line.includes(UNKNOWN_COMP_SENTENCE) || line.includes(COMP_SCORE_FLAG)) return line;
    return sentences(line).map((sentence) => (
      sentenceMovesScore(sentence)
        ? sentence.replace(new RegExp(COMP_MOVES_SCORE_SOURCE, 'gi'), '')
        : sentence
    )).join(' ');
  }).join('\n');
}

function insertCompScoreFlag(text) {
  if (text.includes(COMP_SCORE_FLAG)) return text;
  if (text.includes(UNKNOWN_COMP_SENTENCE)) {
    return text.replace(UNKNOWN_COMP_SENTENCE, `${UNKNOWN_COMP_SENTENCE}\n\n${COMP_SCORE_FLAG}`);
  }
  return `${text.trimEnd()}\n\n${COMP_SCORE_FLAG}\n`;
}

/**
 * A culture line that admits there is no evidence must not keep a default 3.
 * A line that cites evidence, or applies an explicit penalty such as the
 * deprioritize_if_absent cap at 2/5, is left alone. The score number is not
 * rewritten, so the report says it may still include the default 3.
 * @param {string} text
 * @returns {string}
 */
export function neutralizeDefaultCulture(text) {
  const lines = String(text ?? '').split('\n');
  const index = lines.findIndex((line) => (
    /cultural signals/i.test(line)
    && line.trim() !== UNKNOWN_CULTURE_SENTENCE
    && !/^#{1,6}\s/.test(line.trim())
    && /no evidence|score(?:s|d)? 3 by default|default(?:s|ed)? to 3/i.test(line)
    && !isCulturePenalty(line)
  ));
  if (index < 0) return text ?? '';
  lines.splice(index, 1, UNKNOWN_CULTURE_SENTENCE, '', CULTURE_SCORE_FLAG);
  return setYaml(lines.join('\n'), 'culture', 'unknown');
}

/**
 * Point final_decision, the header Decision line, and the lead call at the
 * band for the written score. The score number is not rewritten.
 * @param {string} text
 * @returns {string}
 */
export function alignDecisionToScore(text) {
  const decision = recommendationFor(readGlobalScore(text), {
    hardStop: reportHasHardStop(text),
    suspicious: reportIsSuspicious(text),
  });
  if (!decision) return text;
  return text
    .replace(new RegExp(`(final_decision:\\s*)["']?(?:${DECISION})["']?`, 'i'), `$1"${decision}"`)
    .replace(new RegExp(`(\\*\\*Decision:\\*\\*\\s*)(?:${DECISION})\\b`, 'i'), `$1${decision}`)
    .replace(
      new RegExp(
        `(^## [^\\n]*\\(lead\\)[^\\n]*\\n(?:(?!^## )[\\s\\S])*?^\\*\\*)(?:${DECISION})(\\.\\*\\*)`,
        'm',
      ),
      `$1${decision}$2`,
    );
}

/**
 * @param {string} text - Model reply, including the SCORE_SUMMARY block.
 * @param {string} jdText - The posting the model was given.
 * @returns {string}
 */
export function normalizeEvaluationText(text, jdText) {
  if (typeof text !== 'string' || text.length === 0) return text ?? '';
  let next = stripTrainingDataPay(text);
  if (!postingStatesPay(jdText)) {
    const movedScore = compClaimMovedScore(next);
    next = stripInventedPay(next);
    next = stripCompScoreClaims(next);
    next = setYaml(next, 'compensation', 'unknown');
    next = insertUnknownComp(next);
    if (movedScore) next = insertCompScoreFlag(next);
  }
  next = neutralizeDefaultCulture(next);
  return alignDecisionToScore(next);
}
