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

/**
 * Level words that are also ordinary English, mapped to the words that follow
 * them in their NON-seniority sense. JD boilerplate is full of these: "Principal
 * responsibilities" means "main duties", "mid-market" is a customer segment, and
 * "lead" is usually a verb. Matching them as job levels made the gate below fire
 * on postings of identical seniority.
 *
 * Only the trailing word is inspected: "Principal Engineer" and "Lead Engineer"
 * stay levels because `engineer` is not in any of these lists.
 */
const NON_LEVEL_FOLLOWERS = {
  principal: ['responsibilities', 'responsibility', 'duties', 'accountabilities', 'objectives', 'purpose', 'tasks', 'activities'],
  lead: ['to', 'the', 'a', 'an', 'our', 'and', 'or', 'by', 'on', 'in', 'for', 'with', 'from', 'mentoring', 'projects'],
  mid: ['market', 'size', 'sized', 'cap', 'tier', 'funnel', 'term', 'sized-company'],
};

/** Whether a level word at `index` reads as a job level rather than plain English. */
function readsAsLevel(word, normalized, index) {
  const followers = NON_LEVEL_FOLLOWERS[word];
  if (!followers) return true;
  const after = normalized.slice(index + word.length).match(/^[^a-z0-9]*([a-z0-9-]+)/);
  return !after || !followers.includes(after[1]);
}

/**
 * Every distinct seniority level named in the text, as LEVELS indices.
 *
 * Returns ALL of them rather than the first: a document may name several (a CV
 * showing career progression names each rank it held), and `findIndex` used to
 * collapse that to whichever appeared earliest in the LEVELS table — reading a
 * junior-to-senior CV as junior.
 */
function levelsIn(text) {
  const normalized = String(text ?? '').toLowerCase();
  const found = new Set();
  LEVELS.forEach((words, level) => {
    for (const word of words) {
      if (/^[\p{Script=Han}]+$/u.test(word)) {
        if (normalized.includes(word)) { found.add(level); break; }
        continue;
      }
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, 'gi');
      let match;
      while ((match = pattern.exec(normalized)) !== null) {
        if (readsAsLevel(word, normalized, match.index + match[0].length - word.length)) {
          found.add(level);
          break;
        }
      }
      if (found.has(level)) break;
    }
  });
  return found;
}

/**
 * Detect the seniority level of a document, or -1 when it has no single
 * unambiguous one. Naming several levels counts as ambiguous, NOT as the lowest
 * one: the gate below exists to catch a clear level difference, and a guess is
 * worse than standing down and letting the similarity score decide.
 */
function levelOf(text) {
  const levels = levelsIn(text);
  return levels.size === 1 ? [...levels][0] : -1;
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

// ── CLI ─────────────────────────────────────────────────────────────

const KNOWN_FLAGS = ['--help', '-h'];

const USAGE = `Usage:
  node jd-similarity.mjs new-jd.txt previous-jd-or-cv.txt
  node jd-similarity.mjs --help                    # print this usage block and exit`;

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  const unknownFlags = args.filter(a => a.startsWith('-') && !KNOWN_FLAGS.includes(a));
  if (unknownFlags.length) {
    console.error(`Error: unrecognized flag(s): ${unknownFlags.join(', ')}. Valid flags: ${KNOWN_FLAGS.join(', ')}`);
    console.error(USAGE);
    process.exit(1);
  }
  const [newJdPath, previousPath] = args;
  if (args.length !== 2 || !newJdPath || !previousPath) {
    console.error('Error: expected two file paths.');
    console.error(USAGE);
    process.exit(1);
  }

  return { newJdPath, previousPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { newJdPath, previousPath } = parseArgs(process.argv);
  try {
    const result = recommendCvReuse(readFileSync(newJdPath, 'utf8'), readFileSync(previousPath, 'utf8'));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Unable to read input files: ${error.message}`);
    process.exit(1);
  }
}
