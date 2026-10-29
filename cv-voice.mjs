import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { metricClaims, stripMarkup } from './verify-cv-facts.mjs';

export const BANNED_PHRASES = [
  'passionate about',
  'results-oriented',
  'results-driven',
  'proven track record',
  'leveraged',
  'leveraging',
  'leverage',
  'spearheaded',
  'spearheading',
  'spearhead',
  'facilitated',
  'facilitating',
  'synergies',
  'synergy',
  'cutting-edge',
  'cutting edge',
  "in today's fast-paced world",
  'demonstrated ability to',
  'best practices',
  'significant impact',
  'measurable impact',
  'orchestrated',
  'championed',
  'utilized',
  'delve',
  'tapestry',
  'pivotal',
];

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

function norm(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

// A dash between two years is how a range is written, not a stock tell.
// A month may sit before the end year: "Mar 2020 – Dec 2022".
// The HTML builder prints "2022–2024" from the start and end fields itself.
// A metric such as "20–30%" is not a date, so it stays a tell.
const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_RANGE_DASH = new RegExp(
  `((?:19|20)\\d{2})\\s*[\\u2013\\u2014]\\s*(?=(?:(?:${MONTH})\\b\\.?\\s+)?(?:(?:19|20)\\d{2}\\b|present\\b|current\\b|now\\b|today\\b))`,
  'giu',
);

function linesOf(text) {
  const broken = String(text)
    // The <head> is not printed. Its <title> carries the template's own
    // "Name — CV" separator, which the candidate never wrote.
    .replace(/<head[\s>][\s\S]*?<\/head>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|h\d|div|tr|section|article)>/gi, '\n');
  return stripMarkup(broken, { keepLineBreaks: true })
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function hasPhrase(text, phrase) {
  const body = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

// A heading that lists words to avoid is not the candidate's own wording.
// The shipped template uses both "banned" and "patterns to avoid".
function isAvoidHeading(title) {
  return /\bbanned\b/i.test(title) || /\bpatterns to avoid\b/i.test(title);
}

function wordingFromVoiceDna(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const kept = [];
  let skipping = false;
  let skipLevel = 0;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (skipping && level <= skipLevel) skipping = false;
      if (!skipping && isAvoidHeading(heading[2])) {
        skipping = true;
        skipLevel = level;
      }
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

function wordingFromFacts(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return '';
  }
  if (!data || typeof data !== 'object') return '';
  const parts = [];
  for (const key of ['allow_facts', 'allow_metrics']) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === 'string' && item.trim()) parts.push(item);
    }
  }
  return parts.join('\n');
}

/**
 * Words the candidate wrote down, outside cv.md. A missing file is normal.
 * A cv-facts.json that does not parse adds nothing, so a broken file cannot
 * allow a stock phrase by accident. forbidden_phrases stay blocked.
 *
 * @param {string} root
 * @returns {string}
 */
export function candidateOwnWords(root) {
  const chunks = [];
  const dnaPath = join(root, 'voice-dna.md');
  if (existsSync(dnaPath)) chunks.push(wordingFromVoiceDna(readFileSync(dnaPath, 'utf8')));
  const factsPath = join(root, 'config', 'cv-facts.json');
  if (existsSync(factsPath)) chunks.push(wordingFromFacts(readFileSync(factsPath, 'utf8')));
  return chunks.filter(Boolean).join('\n');
}

/**
 * @param {string} generated
 * @param {string} source
 * @returns {{kind: 'banned-phrase'|'em-dash'|'invented-number', value: string}[]}
 */
export function voiceIssues(generated, source) {
  const sourceText = String(source ?? '');
  const sourceNorm = norm(stripMarkup(sourceText));
  const sourceLines = new Set(linesOf(sourceText).map(norm));
  const issues = [];
  const seen = new Set();
  const push = (kind, value) => {
    const key = `${kind}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ kind, value });
  };

  for (const line of linesOf(generated)) {
    // A whole source line counts at any length, so a copied "2021–2024" stays.
    // A fragment of one has to be long enough not to match by accident.
    const lineNorm = norm(line);
    const alreadyInSource = sourceLines.has(lineNorm) || (lineNorm.length >= 12 && sourceNorm.includes(lineNorm));
    if (alreadyInSource) continue;
    const prose = line.replace(DATE_RANGE_DASH, '$1 ');
    if (prose.includes(EM_DASH)) push('em-dash', 'em dash');
    if (prose.includes(EN_DASH)) push('em-dash', 'en dash');
    for (const phrase of BANNED_PHRASES) {
      if (!hasPhrase(line, phrase)) continue;
      if (hasPhrase(sourceText, phrase)) continue;
      push('banned-phrase', phrase);
    }
  }

  const allowed = metricClaims(sourceText);
  for (const claim of metricClaims(String(generated ?? ''))) {
    if (!allowed.has(claim)) push('invented-number', claim);
  }
  return issues;
}

/**
 * The wording failure a renderer shows. A long dash is a warning, not a
 * failure: the PDF path already normalizes it. Null when nothing blocks.
 *
 * @param {{kind: string, value: string}[]} issues
 * @param {string} [label]
 * @returns {string|null}
 */
export function voiceTellMessage(issues, label) {
  const tells = issues.filter((issue) => issue.kind === 'banned-phrase');
  if (!tells.length) return null;
  const where = label ? ` for ${label}` : '';
  const bits = tells.map((issue) => `"${issue.value}"`);
  return `Voice check failed${where}: ${bits.join(', ')}. That wording is not in the source CV. Keep the candidate's own words.`;
}

/**
 * @param {{kind: string, value: string}[]} issues
 * @param {string} [label]
 * @returns {string|null}
 */
export function voiceDashWarning(issues, label) {
  const dashes = issues.filter((issue) => issue.kind === 'em-dash');
  if (!dashes.length) return null;
  const where = label ? ` for ${label}` : '';
  const bits = [...new Set(dashes.map((issue) => issue.value))];
  return `Voice check warning${where}: ${bits.map((value) => `an ${value}`).join(', ')}. The build continues. PDF generation normalizes long dashes for ATS. LaTeX and CV Studio leave the dash in the text.`;
}
