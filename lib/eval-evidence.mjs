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

const CCY_ISO = 'USD|EUR|GBP|CHF|PLN|DKK|SEK|NOK|CAD|AUD|INR|JPY|CNY|BRL';
// TRY folds to the verb "try". Only the uppercase code counts.
const CCY_CODE = `${CCY_ISO}|${CCY_ISO.toLowerCase()}|TRY|kr|KR|zł|zl|ZL`;
const GROUPED_NUM = "\\d{1,3}(?:[.,'\\u00a0 ]\\d{3})+";
const MONEY_FIGURE = new RegExp(
  `(?:[$£€₹¥₩]\\s?\\d|\\b\\d+(?:\\.\\d+)?\\s?[kK]\\b|\\b\\d{2,3}(?:,\\d{3})+(?:\\.\\d+)?\\b|(?:${GROUPED_NUM}|\\d{2,})\\s?(?:[$£€₹¥₩]|\\b(?:${CCY_CODE})\\b))`,
);
// A symbol after the number, a currency code, or ₹/¥/₩ is a stated amount.
// A leading $50M is not, until the same sentence uses a pay word.
const STATED_AMOUNT = new RegExp(
  `(?:(?:${GROUPED_NUM}|\\d{2,})\\s?(?:[$£€₹¥₩]|\\b(?:${CCY_CODE})\\b)|[₹¥₩]\\s?(?:${GROUPED_NUM}|\\d{2,})(?!\\s?[mMbB]\\b))`,
);
// "base", "annual", and "range" also fit a customer base, annual revenue,
// and a product range. Pay words stay specific. "Band is 90k" still counts.
const PAY_CONTEXT = /\b(?:salary|compensation|pay|wages?|ote|band|hourly|gehalt|base pay|advertised range|per (?:year|annum|hour)|\/\s?(?:yr|year|hr|hour))\b/i;
const NOT_PAY_SENTENCE = /\b(?:revenue|funding|raised|customers?|employees?|headcount|series\s+[a-e])\b/i;
const PAY_HEADING = /^(?:#{1,6}\s+)?(?:compensation|salary|pay|wages?|ote|base pay|gehalt)(?:\s+range)?\s*:?\s*$/i;
const TRAINING_PAY_PHRASE = /salary estimates based on your training/i;
const TRAINING_NEAR_PAY_WORD = new RegExp(
  `(?:training[-\\s]?data).{0,80}\\b(?:salary|compensation|pay|wage|wages)\\b|\\b(?:salary|compensation|pay|wage|wages)\\b.{0,80}training[-\\s]?data`,
  'i',
);
// "estimate" also describes model accuracy. It marks a pay line only when
// the same line states pay or a money figure.
const TRAINING_NEAR_ESTIMATE = new RegExp(
  `(?:training[-\\s]?data).{0,80}\\bestimates?\\b|\\bestimates?\\b.{0,80}training[-\\s]?data`,
  'i',
);
const INVENTED_PAY = /salary estimate|estimated (?:salary|comp|base|range|pay)|market (?:rate|salary)|typical (?:salary|compensation|pay)/i;
const KNOWLEDGE_GUESS = /based on (?:my )?(?:knowledge|training)/i;
const PAY_TOPIC = /\b(?:salary|compensation|pay|wage|wages|ote)\b/i;
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
const DECISIONS = ['Apply', 'Consider', 'Research first', 'Skip'];
// Header labels and the four calls, in decision order. The words are the
// ones modes already publish. An unknown bold call is flagged, not guessed.
const DECISION_LABELS = new Set([
  'Decision', 'القرار', 'Beslutning', 'Entscheidung', 'Decisión', 'Décision',
  'निर्णय', 'Keputusan', 'Decisione', '決定', '결정', 'Beslissing', 'Decyzja',
  'Decisão', 'Решение', 'Karar', 'Рішення', 'Quyết định', '决定',
]);
const LOCALIZED_CALLS = [
  DECISIONS,
  ['تقدّم', 'فكّر', 'ابحث أولاً', 'تجاوز'],
  ['Søg', 'Overvej', 'Undersøg først', 'Spring over'],
  ['Bewerben', 'Prüfen', 'Zuerst recherchieren', 'Überspringen'],
  ['Presentarse', 'Valorar', 'Investigar primero', 'Descartar'],
  ['Postuler', 'Envisager', 'Chercher d\'abord', 'Passer'],
  ['आवेदन करें', 'विचार करें', 'पहले जाँचें', 'छोड़ें'],
  ['Lamar', 'Pertimbangkan', 'Teliti dulu', 'Lewati'],
  ['Candidarsi', 'Valutare', 'Approfondire prima', 'Scartare'],
  ['応募する', '検討する', '先に調べる', '見送る'],
  ['지원', '검토', '먼저 조사', '건너뛰기'],
  ['Søk', 'Vurder', 'Undersøk først', 'Hopp over'],
  ['Solliciteren', 'Overwegen', 'Eerst onderzoeken', 'Overslaan'],
  ['Aplikuj', 'Rozważ', 'Najpierw sprawdź', 'Pomiń'],
  ['Candidatar', 'Considerar', 'Pesquisar primeiro', 'Não candidatar'],
  ['Откликнуться', 'Рассмотреть', 'Сначала изучить', 'Пропустить'],
  ['Başvur', 'Değerlendir', 'Önce araştır', 'Geç'],
  ['Відгукнутися', 'Розглянути', 'Спочатку дослідити', 'Пропустити'],
  ['Nộp hồ sơ', 'Cân nhắc', 'Tìm hiểu trước', 'Bỏ qua'],
  ['申请', '考虑', '先调研', '跳过'],
  ['應徵', '考慮', '先調查', '略過'],
];
const UNMAPPED_LEAD_FLAG =
  'Score check: the lead call is not a known decision word, so it was left as written and may disagree with the score.';
const YAML_VALUE = /(?:"[^"]*"|'[^']*'|[^\n#]+)/;

// "Competitive salary" names no figure. It must not license a funding
// amount or a headcount in the same sentence. A figure attached to the
// phrase, as in "competitive salary of $140,000", still counts. "of"
// later in the sentence, as in "for a team of 10,000", does not.
function withoutBareCompetitivePay(part) {
  return part.replace(
    /\b(?:competitive\s+(?:salary|compensation|pay)|(?:salary|compensation|pay)(?:\s+is)?\s+competitive)\b/gi,
    (phrase, offset) => {
      const after = part.slice(offset + phrase.length, offset + phrase.length + 16);
      if (/^\s*(?:of|:)\s*(?:[$£€₹¥₩]|\d)/i.test(after)) return phrase;
      if (/^\s*[$£€₹¥₩]/.test(after) || /^\s*\d/.test(after)) return phrase;
      return ' ';
    },
  );
}

// A funding-sized figure ($50M) still has to sit next to the pay word.
// A salary figure may follow a description ("Salary depends on location,
// level, and experience: $120,000") when the words between them do not
// name funding, headcount, or revenue.
function isFundingFigure(text, index) {
  const tail = text.slice(index);
  return /^(?:[$£€₹¥₩]\s?)?\d[\d.,]*\s?(?:[mMbB]\b|million\b|billion\b)/i.test(tail);
}

function moneyTouchesPayWord(part) {
  const anchored = withoutBareCompetitivePay(part);
  const figures = [];
  const figureRe = new RegExp(MONEY_FIGURE.source, 'g');
  let match;
  while ((match = figureRe.exec(anchored)) !== null) figures.push(match);
  const words = [];
  const wordRe = new RegExp(PAY_CONTEXT.source, 'gi');
  while ((match = wordRe.exec(anchored)) !== null) words.push(match);
  for (const figure of figures) {
    const funding = isFundingFigure(anchored, figure.index);
    for (const word of words) {
      const betweenStart = Math.min(word.index + word[0].length, figure.index + figure[0].length);
      const betweenEnd = Math.max(word.index, figure.index);
      const gap = betweenStart < betweenEnd ? anchored.slice(betweenStart, betweenEnd) : '';
      // A semicolon starts another clause. "Funding: $50M; salary band
      // unpublished" must not let the salary word adopt the funding figure.
      if (gap.includes(';') || NOT_PAY_SENTENCE.test(gap)) continue;
      if (funding) {
        const start = Math.max(0, figure.index - 24);
        const end = Math.min(anchored.length, figure.index + figure[0].length + 24);
        if (!PAY_CONTEXT.test(anchored.slice(start, end))) continue;
      }
      return true;
    }
  }
  return false;
}

function barePayLine(line) {
  if (!MONEY_FIGURE.test(line)) return false;
  const words = line
    .replace(new RegExp(MONEY_FIGURE.source, 'g'), ' ')
    .replace(/[^A-Za-z]+/g, ' ')
    .trim();
  if (!words) return true;
  const allowed = new Set(['to', 'or', 'and', 'gbp', 'usd', 'eur', 'per', 'year', 'hour', 'hr', 'annum', 'base', 'ote', 'a']);
  return words.split(/\s+/).every((word) => allowed.has(word.toLowerCase()));
}

/**
 * The call in the same language as `current`, for the English decision.
 * @param {string} current
 * @param {string} decision
 * @returns {string | null}
 */
function mappedCall(current, decision) {
  const target = DECISIONS.indexOf(decision);
  if (target < 0) return null;
  const folded = current.toLowerCase();
  for (const row of LOCALIZED_CALLS) {
    if (row.some((word) => word.toLowerCase() === folded)) return row[target];
  }
  return null;
}

/**
 * True when the posting itself states a pay figure. "Competitive salary"
 * is not a figure, including when the same sentence names funding or
 * headcount. A figure attached to a pay word still counts, including
 * when only a description sits between them. A funding-sized figure
 * still has to sit next to the pay word, in the same clause. A funding
 * amount, a customer base, or annual revenue is not pay on its own,
 * unless that figure sits next to a pay word or under a compensation
 * heading. A trailing currency code is.
 * @param {string} jdText
 * @returns {boolean}
 */
export function postingStatesPay(jdText) {
  let underHeading = false;
  for (const raw of String(jdText ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (PAY_HEADING.test(line) && !MONEY_FIGURE.test(line)) {
      underHeading = true;
      continue;
    }
    const stated = line.split(/(?<=\.)\s+/).some((part) => (
      MONEY_FIGURE.test(part) && (
        moneyTouchesPayWord(part)
        || (STATED_AMOUNT.test(part) && !NOT_PAY_SENTENCE.test(part))
        || (underHeading && barePayLine(part))
      )
    ));
    if (stated) return true;
    underHeading = false;
  }
  return false;
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

function isTrainingPayLine(line) {
  if (TRAINING_PAY_PHRASE.test(line) || TRAINING_NEAR_PAY_WORD.test(line)) return true;
  return TRAINING_NEAR_ESTIMATE.test(line) && (PAY_TOPIC.test(line) || MONEY_FIGURE.test(line));
}

function setYaml(text, key, value) {
  // Indent keeps a prose line such as "Compensation: Medium" from winning.
  // Horizontal space after the colon cannot cross into the next line.
  const pattern = new RegExp(`(^[\\t ]+${key}:[\\t ]*)${YAML_VALUE.source}`, 'm');
  return text.replace(pattern, `$1"${value}"`);
}

function stripTrainingDataPay(text) {
  return text.split('\n').filter((line) => !isTrainingPayLine(line)).join('\n');
}

function isCvEvidenceRow(line) {
  return line.split('|').some((cell) => cell.trim() === 'CV');
}

function isInventedCompLine(line) {
  if (line.includes(COMP_SCORE_FLAG) || line.includes(UNKNOWN_COMP_SENTENCE)) return false;
  if (isCvEvidenceRow(line)) return false;
  if (INVENTED_PAY.test(line)) return true;
  if (KNOWLEDGE_GUESS.test(line) && (PAY_TOPIC.test(line) || MONEY_FIGURE.test(line))) return true;
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
    return sentences(line)
      .filter((sentence) => !sentenceMovesScore(sentence))
      .join(' ');
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
    && /no evidence(?!\s+of\b)|score(?:s|d)? 3 by default|default(?:s|ed)? to 3/i.test(line)
    && !/\bunknown\b/i.test(line)
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
  // recommendationFor returns null when the score did not parse, hard stop
  // included. The stop still forces Skip. A missing score with no stop stays
  // as written.
  const decision = reportHasHardStop(text)
    ? 'Skip'
    : recommendationFor(readGlobalScore(text), { suspicious: reportIsSuspicious(text) });
  if (!decision) return text;
  const withYaml = text.replace(
    new RegExp(`(final_decision:\\s*)["']?(?:${DECISION})["']?`, 'i'),
    `$1"${decision}"`,
  );
  const withHeader = withYaml.replace(
    /^\*\*([^*]+):\*\*\s*(\S.*?)\s*$/gm,
    (full, label, value) => {
      if (!DECISION_LABELS.has(label)) return full;
      const mapped = mappedCall(value, decision);
      if (!mapped || mapped === value) return full;
      return `**${label}:** ${mapped}`;
    },
  );
  return withHeader.replace(
    /^(## [^\n]*\(lead\)[^\n]*\n)((?:(?!^## )[\s\S])*)/m,
    (full, heading, body) => {
      const bold = body.match(/^\*\*([^*]+)\.\*\*/m);
      if (!bold) return full;
      const mapped = mappedCall(bold[1], decision);
      if (mapped == null) {
        if (body.includes(UNMAPPED_LEAD_FLAG)) return full;
        return `${heading}${UNMAPPED_LEAD_FLAG}\n\n${body}`;
      }
      if (mapped === bold[1]) return full;
      return heading + body.replace(bold[0], `**${mapped}.**`);
    },
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
