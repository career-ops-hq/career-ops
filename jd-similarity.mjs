#!/usr/bin/env node
/**
 * jd-similarity.mjs — deterministic CV reuse recommendation for similar JDs.
 *
 * This is deliberately a recommendation layer. It never evaluates a JD and
 * never deletes or overwrites an existing CV.
 *
 * Usage:
 *   node jd-similarity.mjs new-jd.txt previous-jd-or-cv.txt
 */

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'have', 'will', 'you',
  'your', 'our', 'are', 'not', 'to', 'of', 'in', 'on', 'or', 'a', 'an',
  '负责', '岗位', '工作', '相关', '具备', '以及', '能够', '进行', '通过', '需要',
]);

const LEVELS = [
  ['intern', '实习', '实习生', '应届'],
  ['junior', '初级'],
  ['mid', '中级'],
  ['senior', '高级', '资深'],
  ['staff', 'principal', 'lead', '负责人'],
];

/** Tokenize JD/CV text into normalized, stop-word-filtered terms. */
export function tokenize(text) {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .match(/[\p{L}\p{N}+#./-]+/gu)
      ?.map(token => token.replace(/^[./-]+|[./-]+$/g, ''))
      .filter(token => token && (token.length > 1 || /\d/.test(token)) && !STOP_WORDS.has(token)) || [],
  );
}

/** Calculate Jaccard similarity between two texts or token sets. */
export function jaccardSimilarity(left, right) {
  const a = left instanceof Set ? left : tokenize(left);
  const b = right instanceof Set ? right : tokenize(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/** Detect the first recognized seniority level in text, or -1 when absent. */
function levelOf(text) {
  const normalized = String(text ?? '').toLowerCase();
  return LEVELS.findIndex(words => words.some(word => {
    if (/^[\p{Script=Han}]+$/u.test(word)) return normalized.includes(word);
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(normalized);
  }));
}

/** Return whether the new JD and previous document have different seniority levels. */
export function hardMismatch(newJd, previousText) {
  const newLevel = levelOf(newJd);
  const previousLevel = levelOf(previousText);
  return newLevel >= 0 && previousLevel >= 0 && newLevel !== previousLevel;
}

/** Recommend CV reuse, reuse with edits, or regeneration for a new JD. */
export function recommendCvReuse(newJd, previousText, options = {}) {
  const score = jaccardSimilarity(newJd, previousText);
  const high = Number(options.highThreshold ?? 0.72);
  const medium = Number(options.mediumThreshold ?? 0.45);
  if (hardMismatch(newJd, previousText)) {
    return { decision: 'regenerate', score, reason: 'level-mismatch' };
  }
  if (score >= high) return { decision: 'reuse', score, reason: 'high-similarity' };
  if (score >= medium) return { decision: 'reuse-with-edits', score, reason: 'medium-similarity' };
  return { decision: 'regenerate', score, reason: 'low-similarity' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [newJdPath, previousPath] = process.argv.slice(2);
  if (!newJdPath || !previousPath) {
    console.error('Usage: node jd-similarity.mjs <new-jd.txt> <previous-jd-or-cv.txt>');
    process.exit(1);
  }
  try {
    const result = recommendCvReuse(readFileSync(newJdPath, 'utf8'), readFileSync(previousPath, 'utf8'));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Unable to read input files: ${error.message}`);
    process.exit(1);
  }
}
