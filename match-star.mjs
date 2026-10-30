#!/usr/bin/env node

/**
 * match-star.mjs — Zero-LLM, zero-browser ATS behavioural question matcher.
 *
 * Parses interview-prep/story-bank.md, scores each STAR story against the
 * question text (and optionally a JD file), and returns the top match(es)
 * formatted to ATS paste length (250–500 words).
 *
 * The answer is meant to be pasted as-is, so its figures are checked here
 * rather than left to whoever reads it (AGENTS.md, Source-of-Truth Boundary):
 * a story marked `**Provenance:** user-cannot-confirm` has every number
 * replaced by a placeholder, and every other figure that does not trace to
 * cv.md gets a ⚠️ line, using story-provenance-check.mjs's classifier.
 *
 * Usage:
 *   node match-star.mjs "Tell me about a time you led a project under pressure"
 *   node match-star.mjs "Describe a conflict you resolved" --jd jds/acme.md
 *   node match-star.mjs "Give an example of handling ambiguity" --top 2
 *   node match-star.mjs --list    # list all stories with their tags
 */

import { readFileSync, existsSync } from 'fs';
import { isMainModule } from './lib/is-main-module.mjs';
import { join } from 'path';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { parseStories, splitStoryBlocks, isValidStory } from './lib/story-bank.mjs';
import { parseStoryBlocks, classifyEntries } from './story-provenance-check.mjs';

// ── Config ──────────────────────────────────────────────────────────

// From the data root, not the cwd. interview-prep/ is USER_PATHS in
// update-system.mjs, and a bare relative path resolves against wherever the
// process was started — so this read the checkout's story bank (usually absent)
// for anyone whose data lives elsewhere.
const STORY_BANK_PATH = join(getCareerOpsRoot(), 'interview-prep', 'story-bank.md');
const CV_PATH = join(getCareerOpsRoot(), 'cv.md');

const UNCONFIRMED = '[unconfirmed figure]';

const args       = process.argv.slice(2);
const LIST_MODE  = args.includes('--list');
const jdFlag     = args.indexOf('--jd');
const jdPath     = jdFlag !== -1 ? args[jdFlag + 1] : null;
const topFlag    = args.indexOf('--top');
const topRaw     = topFlag !== -1 ? parseInt(args[topFlag + 1], 10) : NaN;
const TOP_N      = Number.isInteger(topRaw) && topRaw > 0 ? topRaw : 1;
// Exclude flag operands by index position, not by value, to preserve repeated text in the question
const excludeIdx = new Set([
  ...(jdFlag  !== -1 ? [jdFlag + 1]  : []),
  ...(topFlag !== -1 ? [topFlag + 1] : []),
]);
const question = args
  .filter((a, i) => !a.startsWith('--') && !excludeIdx.has(i))
  .join(' ').trim();

// ── Parser ───────────────────────────────────────────────────────────
// parseStories lives in lib/story-bank.mjs so every story-bank reader shares
// one definition of a story (#4514). Re-exported below for existing callers.

// ── Scoring ──────────────────────────────────────────────────────────

/**
 * Tokenize text into lowercase words, stripping punctuation.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  // Letters, marks and digits of ANY script. The previous `[^a-z0-9\s]` class
  // deleted every non-Latin character, so a story bank written in Russian,
  // Hindi, Greek or Ukrainian tokenized to [] and scored 0 against a question
  // in the same language — the matcher was inert, not degraded, for anyone whose
  // `language.output` is not English (#2847).
  //
  // \p{M} is included deliberately: without it Devanagari matras become spaces
  // and shatter a word into fragments that match nothing (the mistake caught in
  // #2781's review of the sibling role tokenizer).
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'you','me','my','your','i','we','they','it','is','was','were','are',
  'be','been','have','had','has','do','did','does','tell','about','time',
  'when','how','give','example','describe','situation','where','what',
]);

/**
 * Score a story against a question + optional JD text.
 * Higher = better match.
 * @param {object} story
 * @param {string[]} queryTokens
 * @param {string[]} jdTokens
 * @returns {number}
 */
function score(story, queryTokens, jdTokens) {
  const signal = queryTokens.filter(t => !STOPWORDS.has(t));
  let s = 0;

  // Tag match: highest weight (tags are explicit "best for" labels).
  // Tokenized exact membership (mirrors the JD-boost path below) so short query
  // tokens (ai, ml, go, qa…) can't spuriously collide inside longer tag words.
  const tagTokens = new Set(story.tags.flatMap(tokenize));
  for (const token of signal) {
    if (tagTokens.has(token)) s += 3;
  }

  // Title/theme match
  const titleTokens = tokenize(story.title + ' ' + story.theme);
  for (const token of signal) {
    if (titleTokens.includes(token)) s += 2;
  }

  // Action + result match (the most substantive parts)
  const bodyTokens = tokenize(story.action + ' ' + story.result);
  for (const token of signal) {
    if (bodyTokens.includes(token)) s += 1;
  }

  // JD boost: stopword-filtered JD tokens matched against tokenized tags (exact token overlap)
  if (jdTokens.length > 0) {
    const jdSignal = new Set(jdTokens.filter(t => !STOPWORDS.has(t)));
    for (const tag of story.tags) {
      const tagTokens = tokenize(tag);
      if (tagTokens.some(t => jdSignal.has(t))) s += 2;
    }
  }

  return s;
}

// ── Formatter ────────────────────────────────────────────────────────

// A number with what makes it a figure: a currency sign before it, and a
// magnitude, `%`, `+`, `x`, `h` or `/unit` rate after it ("$60/hr", "$40K",
// "3.5x", "1,200+", "8h"). Not inside a word, so "Q3" and "B2B" stay.
const FIGURE_RE = /(?<![\p{L}\p{N}])[$€£¥]?\d[\d,.]*(?:\s?(?:%|[kmbh]\b|x\b))?\+?(?:\/\p{L}+)?/giu;

/**
 * Replace every number in `text` with a placeholder, so a story the user
 * could not confirm can't carry its figures into a paste. Every number, not
 * only the checker's claims: its patterns are not exhaustive (a rate like
 * "$60/hr" is none of them), and a number the user could not confirm is not
 * safe to paste whatever its shape.
 * @param {string} text
 * @returns {string}
 */
function maskFigures(text) {
  return String(text ?? '').replace(FIGURE_RE, UNCONFIRMED);
}

/**
 * ⚠️ lines for the figures in `prose` that do not trace to cv.md.
 * @param {object} story
 * @param {string} prose - the exact text about to be printed
 * @param {string} cvText
 * @returns {string[]}
 */
function provenanceWarnings(story, prose, cvText) {
  if (story.provenance === 'user-cannot-confirm') {
    return [`   ⚠️  Provenance: user-cannot-confirm. Every number is replaced with ${UNCONFIRMED}: use this story as narrative only.`];
  }
  const buckets = classifyEntries([{ title: story.title, provenance: story.provenance ?? null, body: prose }], cvText);
  return [
    ...buckets.derivedUnverified.map((c) => `   ⚠️  "${c.claim}" is not in cv.md (derived-unverified): confirm it before pasting.`),
    ...buckets.supportedByResume.map((c) => `   ⚠️  "${c.claim}": cv.md supports the fact but not this figure (supportedByResume): confirm it before pasting.`),
  ];
}

/**
 * Format a STAR story as ATS-ready prose (250–500 words).
 * @param {object} story - a parseStories() story, plus `provenance` (its
 *   Provenance marker, lowercased, or null)
 * @param {string} question
 * @param {{cvText?: string}} [opts] - cv.md, to check the figures against
 * @returns {string}
 */
function formatAts(story, question, { cvText = '' } = {}) {
  const parts = [];

  if (story.situation) parts.push(story.situation);
  if (story.task)      parts.push(story.task);
  if (story.action)    parts.push(story.action);
  if (story.result)    parts.push(story.result);
  if (story.reflection) parts.push(story.reflection);

  // Every field this prints, not only the prose: a figure in a title or a tag
  // is still a figure. Source is left as written: it says where the story
  // came from ("Report #042"), which is what the user needs to check it.
  const cannotConfirm = story.provenance === 'user-cannot-confirm';
  const safe = (text) => (cannotConfirm ? maskFigures(text) : text);
  const joined = safe(parts.filter(Boolean).join(' '));
  const wordArr = joined.split(/\s+/).filter(Boolean);
  // Enforce 500-word ceiling; prose below 250 words gets a warning
  const prose   = wordArr.slice(0, 500).join(' ');
  const words   = Math.min(wordArr.length, 500);
  const notice  = wordArr.length < 250
    ? '\n   ⚠️  Under 250 words — consider expanding this story in story-bank.md.'
    : '';

  return [
    `— ${safe(story.title)}${story.theme ? ` [${safe(story.theme)}]` : ''}`,
    story.source ? `   Source: ${story.source}` : '',
    story.tags.length ? `   Tags: ${story.tags.map(safe).join(', ')}` : '',
    ...provenanceWarnings(story, prose, cvText),
    '',
    prose,
    '',
    `   (~${words} words)${notice}`,
  ].filter(s => s !== null).join('\n');
}

// ── Exports (for test-all.mjs and other consumers) ───────────────────
export { parseStories, tokenize, score, formatAts, STOPWORDS };

// ── Main ─────────────────────────────────────────────────────────────

if (isMainModule(import.meta.url)) {
if (!existsSync(STORY_BANK_PATH)) {
  console.error(`Error: ${STORY_BANK_PATH} not found.`);
  console.error('Run /career-ops interview-prep on a role first to populate your story bank.');
  process.exit(1);
}

const content = readFileSync(STORY_BANK_PATH, 'utf-8');
// The checker's own reading of each story's marker, matched by heading line,
// so a marker it honours is honoured here.
const provenanceAt = new Map(parseStoryBlocks(content)
  .filter(e => e.kind === 'story').map(e => [e.line, e.provenance]));
const stories = parseStories(content).map(s => ({ ...s, provenance: provenanceAt.get(s.line) ?? null }));
const cvText = existsSync(CV_PATH) ? readFileSync(CV_PATH, 'utf-8') : '';

// Say what is in the file but cannot be read, so an empty or short bank is
// never mistaken for the whole story (#4514). Never rewrites the file: it is
// user data, and converting it is the agent's job, with the user's say-so.
const { blocks, tableRows } = splitStoryBlocks(content);
const invalid = blocks.filter(b => !isValidStory(b));
if (tableRows.length || invalid.length) {
  console.error('⚠️  story-bank.md has entries this matcher cannot read:');
  if (tableRows.length) console.error(`   - ${tableRows.length} table row(s) (lines ${tableRows.map(r => r.line).join(', ')})`);
  for (const b of invalid) console.error(`   - "${b.title || '(untitled)'}" (line ${b.line}): no **A (Action):** line`);
  console.error('   Ask your agent to convert them to the format in templates/story-bank.template.md.\n');
}

if (stories.length === 0) {
  console.error('No stories found in story-bank.md yet.');
  console.error('Run /career-ops interview-prep on a role to add your first stories.');
  process.exit(1);
}

if (LIST_MODE) {
  console.log(`\nStory Bank — ${stories.length} stories\n${'─'.repeat(40)}`);
  stories.forEach((s, i) => {
    console.log(`${i + 1}. ${s.title}${s.theme ? ` [${s.theme}]` : ''}`);
    if (s.tags.length) console.log(`   Tags: ${s.tags.join(', ')}`);
    if (s.source)      console.log(`   ${s.source}`);
    console.log('');
  });
  process.exit(0);
}

if (!question) {
  console.error('Usage: node match-star.mjs "<behavioural question>" [--jd <file>] [--top <n>]');
  console.error('       node match-star.mjs --list');
  process.exit(1);
}

const queryTokens = tokenize(question);
let jdTokens = [];
if (jdPath) {
  if (!existsSync(jdPath)) {
    console.error(`Error: JD file not found at ${jdPath}`);
    process.exit(1);
  }
  jdTokens = tokenize(readFileSync(jdPath, 'utf-8'));
}

// Score and rank
const ranked = stories
  .map(s => ({ story: s, score: score(s, queryTokens, jdTokens) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, TOP_N);

console.log(`\nATS Behavioural Question Matcher`);
console.log('─'.repeat(40));
console.log(`Question: "${question}"`);
if (jdPath) console.log(`JD:       ${jdPath}`);
console.log(`Stories:  ${stories.length} in bank\n`);

for (let i = 0; i < ranked.length; i++) {
  const { story, score: s } = ranked[i];
  console.log(`${'─'.repeat(40)}`);
  console.log(`Match ${i + 1} of ${ranked.length} (score: ${s})\n`);
  console.log(formatAts(story, question, { cvText }));
  console.log('');
}

if (ranked.length > 0 && ranked[0].score === 0) {
  console.log('⚠️  No strong match found. Consider adding a story to story-bank.md that covers this competency.');
}
} // end CLI guard
