#!/usr/bin/env node
/**
 * writing-profile.mjs — measure how the user actually writes.
 *
 * Reads the files in writing-samples/ (not its README.md), counts a few plain
 * habits per file, and writes the numbers to data/writing-profile.json. Nothing
 * is sent anywhere and no model is involved. Each number keeps the sample it
 * came from, so a surprising range can be traced back to one file.
 *
 * The profile is a ruler, not the authority on voice: _profile.md stays that.
 * generate-cover-letter.mjs reads the file and, when a letter sits well outside
 * the range of the person's own samples, prints a note on stderr. The note
 * never stops the PDF (#6940).
 *
 * Usage:
 *   node writing-profile.mjs            Build or refresh data/writing-profile.json
 *   node writing-profile.mjs --check F  Measure text file F against the profile
 */

const USAGE = `Usage:
  node writing-profile.mjs            Build or refresh data/writing-profile.json from writing-samples/
  node writing-profile.mjs --check F  Measure the text file F against that profile
  --help, -h                          Print this and exit`;

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { listTree } from './lib/walk-tree.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { stripMarkup } from './verify-cv-facts.mjs';

export const PROFILE_VERSION = 1;
/** Fewer words than this across all samples is too little to call a habit. */
export const MIN_SAMPLE_WORDS = 300;
/** A letter shorter than this says too little to be measured. */
export const MIN_TEXT_WORDS = 120;
const SAMPLE_EXTENSIONS = new Set(['.txt', '.md']);

// The range of a handful of samples is narrow, so a text just past it is not
// yet unusual. These margins keep the note for texts that are clearly outside.
const LONGEST_SENTENCE_MARGIN = 1.25;
const MEAN_SENTENCE_MARGIN = 1.15;
const CONTRACTION_FLOOR = 0.5;

const WORD = /[\p{L}\p{N}]+(?:['\u2019][\p{L}]+)*/gu;
const CONTRACTION = /\b(?:[\p{L}]+n['\u2019]t|[\p{L}]+['\u2019](?:ll|re|ve|d|m)|(?:i|it|that|there|here|he|she|what|let|who|where)['\u2019]s)\b/giu;

function round(n, places = 1) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Plain text for measuring, from a sample or a letter's HTML. Paragraphs are kept. */
export function toParagraphs(text) {
  let body = String(text ?? '').replace(/\r\n?/g, '\n');
  if (/<\/?(?:p|div|li|h[1-6]|br|body|html)\b/i.test(body)) {
    body = body
      .replace(/<head[\s>][\s\S]*?<\/head>/gi, '\n')
      .replace(/<!--[\s\S]*?-->/g, '\n')
      .replace(/<\/?(?:p|div|li|tr|h[1-6]|section|article|ul|ol|table|br)\b[^>\n]*>/gi, '\n\n');
  }
  body = stripMarkup(body, { keepLineBreaks: true, keepBlankLines: true })
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(?:^|\n)\s*(?:[-*]|\d+\.)\s+/g, '\n');
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/^(?:\.\s+)+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function sentencesOf(paragraphs) {
  const out = [];
  for (const paragraph of paragraphs) {
    const pieces = paragraph.split(/(?<=[.!?]["'\u201D\u2019)]*)\s+(?=[\p{Lu}"'\u201C(\d])/u).map((s) => s.trim()).filter(Boolean);
    // A greeting or a signature line is not a sentence of the writer's.
    if (pieces.length === 1 && !/[.!?]["'\u201D)]*$/.test(pieces[0]) && (pieces[0].match(WORD) ?? []).length < 5) continue;
    out.push(...pieces);
  }
  return out;
}

/**
 * Plain counts for one text.
 *
 * @param {string} text
 * @returns {{words:number, sentences:number, meanSentenceWords:number, longestSentenceWords:number, contractionsPer100:number, firstPersonPer100:number}}
 */
export function measure(text) {
  const paragraphs = toParagraphs(text);
  const sentences = sentencesOf(paragraphs);
  const lengths = sentences.map((s) => (s.match(WORD) ?? []).length);
  const words = lengths.reduce((a, b) => a + b, 0);
  const all = paragraphs.join(' ');
  const contractions = (all.match(CONTRACTION) ?? []).length;
  const firstPerson = (all.match(/\bI(?:['\u2019](?:ll|m|ve|d))?\b/g) ?? []).length;
  const per100 = (n) => (words ? round((n / words) * 100) : 0);
  return {
    words,
    sentences: sentences.length,
    meanSentenceWords: sentences.length ? round(words / sentences.length) : 0,
    longestSentenceWords: lengths.length ? Math.max(...lengths) : 0,
    contractionsPer100: per100(contractions),
    firstPersonPer100: per100(firstPerson),
  };
}

function rangeOf(files, key) {
  const values = files.map((f) => f[key]);
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * The profile for a set of samples. Below MIN_SAMPLE_WORDS it carries no range,
 * so nothing downstream can judge a text by a habit it cannot see yet.
 *
 * @param {{file:string, text:string}[]} samples
 */
export function buildProfile(samples, { now = new Date() } = {}) {
  const files = samples
    .map(({ file, text }) => ({ file, ...measure(text) }))
    .filter((f) => f.words > 0);
  const totalWords = files.reduce((sum, f) => sum + f.words, 0);
  const profile = {
    version: PROFILE_VERSION,
    generated_at: now.toISOString(),
    language: 'en',
    sample_count: files.length,
    total_words: totalWords,
    enough_samples: totalWords >= MIN_SAMPLE_WORDS,
    min_sample_words: MIN_SAMPLE_WORDS,
    files,
  };
  if (profile.enough_samples) {
    profile.ranges = {
      meanSentenceWords: rangeOf(files, 'meanSentenceWords'),
      longestSentenceWords: rangeOf(files, 'longestSentenceWords'),
      contractionsPer100: rangeOf(files, 'contractionsPer100'),
      firstPersonPer100: rangeOf(files, 'firstPersonPer100'),
    };
  }
  return profile;
}

function sourceOf(profile, key, extreme) {
  const pick = profile.files.reduce((best, f) => (best === null || (extreme === 'max' ? f[key] > best[key] : f[key] < best[key]) ? f : best), null);
  return pick ? pick.file : 'your samples';
}

/**
 * Notes for a text that sits clearly outside the range of the person's own
 * samples. Empty when the profile has no range, the text is too short, or
 * nothing is far enough out. Long dashes are left to the voice check.
 *
 * @param {object|null} profile
 * @param {string} text
 * @returns {string[]}
 */
export function profileNotes(profile, text) {
  if (!profile || !profile.enough_samples || !profile.ranges || !Array.isArray(profile.files)) return [];
  const m = measure(text);
  if (m.words < MIN_TEXT_WORDS) return [];
  const r = profile.ranges;
  const notes = [];
  if (m.longestSentenceWords > r.longestSentenceWords.max * LONGEST_SENTENCE_MARGIN) {
    notes.push(
      `has a ${m.longestSentenceWords}-word sentence; your longest sample sentence is ${r.longestSentenceWords.max} words (${sourceOf(profile, 'longestSentenceWords', 'max')})`,
    );
  }
  if (m.meanSentenceWords > r.meanSentenceWords.max * MEAN_SENTENCE_MARGIN) {
    notes.push(
      `averages ${m.meanSentenceWords} words a sentence; your samples average ${r.meanSentenceWords.min} to ${r.meanSentenceWords.max}`,
    );
  }
  if (r.contractionsPer100.min >= 1 && m.contractionsPer100 < r.contractionsPer100.min * CONTRACTION_FLOOR) {
    notes.push(
      `uses ${m.contractionsPer100} contractions per 100 words; your samples use ${r.contractionsPer100.min} to ${r.contractionsPer100.max}`,
    );
  }
  return notes.length ? [`Writing profile note: this text ${notes.join('; ')}. Compared with ${profile.sample_count} of your writing samples. The PDF still builds.`] : [];
}

export function profilePath(root = getCareerOpsRoot()) {
  return join(root, 'data', 'writing-profile.json');
}

/** The saved profile, or null when there is none or it cannot be read. */
export function loadProfile(root = getCareerOpsRoot()) {
  const path = profilePath(root);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    return data && typeof data === 'object' && data.version === PROFILE_VERSION ? data : null;
  } catch {
    return null;
  }
}

/** Samples under writing-samples/, text and Markdown only, never its README. */
export function readSamples(root = getCareerOpsRoot()) {
  const dir = join(root, 'writing-samples');
  if (!existsSync(dir)) return [];
  return listTree(dir)
    .filter((path) => SAMPLE_EXTENSIONS.has(extname(path).toLowerCase()) && basename(path).toLowerCase() !== 'readme.md')
    .sort()
    .map((path) => ({ file: path.slice(dir.length + 1).split('\\').join('/'), text: readFileSync(path, 'utf8') }));
}

function main(argv) {
  validateFlags(argv, ['--check', '--help', '-h'], USAGE, { valueFlags: ['--check'], requireOperand: true });
  const root = getCareerOpsRoot();
   if (hasFlag(argv, '--check')) {
    const target = flagValue(argv, '--check');
    if (!target || target.startsWith('--') || !existsSync(target)) {
      console.error('Usage: node writing-profile.mjs --check <text file>');
      return 1;
    }
    const profile = loadProfile(root);
    if (!profile) {
      console.error('No data/writing-profile.json yet. Run: node writing-profile.mjs');
      return 1;
    }
    const notes = profileNotes(profile, readFileSync(resolve(target), 'utf8'));
    console.log(notes.length ? notes.join('\n') : 'Inside the range of your samples (or too short to tell).');
    return 0;
  }
  const samples = readSamples(root);
  if (!samples.length) {
    console.error('No writing samples found in writing-samples/. Add a few .txt or .md files first.');
    return 1;
  }
  const profile = buildProfile(samples);
  mkdirSync(join(root, 'data'), { recursive: true });
  // Replaced in one step, so a letter being built never reads half a file.
  writeFileAtomic(profilePath(root), `${JSON.stringify(profile, null, 2)}\n`);
  if (profile.enough_samples) {
    console.log(`Wrote data/writing-profile.json from ${profile.sample_count} sample(s), ${profile.total_words} words.`);
  } else {
    console.log(`Wrote data/writing-profile.json, but ${profile.total_words} words is under ${MIN_SAMPLE_WORDS}. Add more samples before it is used.`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
