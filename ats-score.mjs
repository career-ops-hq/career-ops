#!/usr/bin/env node

/**
 * ats-score.mjs — ATS Keyword Overlap & Match Score Analyzer
 *
 * Usage:
 *   node career-ops/ats-score.mjs --resume <resume.json|cv.md> --jd <jd.txt>
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';

// Common stop words to exclude from keyword extraction
const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'can\'t', 'cannot',
  'could', 'did', 'do', 'does', 'doing', 'don\'t', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had',
  'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in',
  'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off',
  'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should',
  'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself',
  'experience', 'work', 'working', 'job', 'role', 'team', 'ability', 'required', 'preferred', 'skills', 'responsibilities'
]);

export function extractTokens(text) {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
  return words;
}

export function extractBigrams(tokens) {
  const bigrams = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

export function calculateAtsScore(resumeText, jdText) {
  const resumeTokens = extractTokens(resumeText);
  const jdTokens = extractTokens(jdText);

  const resumeSet = new Set(resumeTokens);
  const jdFreq = {};

  for (const token of jdTokens) {
    jdFreq[token] = (jdFreq[token] || 0) + 1;
  }

  // Rank keywords by frequency in JD
  const topJdKeywords = Object.entries(jdFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([kw]) => kw);

  let matches = 0;
  const matchedKeywords = [];
  const missingKeywords = [];

  for (const kw of topJdKeywords) {
    if (resumeSet.has(kw)) {
      matches++;
      matchedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  }

  const matchRatio = topJdKeywords.length > 0 ? (matches / topJdKeywords.length) : 0;
  const scorePct = Math.round(matchRatio * 100);

  let grade = 'F';
  if (scorePct >= 90) grade = 'A+';
  else if (scorePct >= 80) grade = 'A';
  else if (scorePct >= 70) grade = 'B';
  else if (scorePct >= 60) grade = 'C';

  return {
    scorePct,
    grade,
    matchedCount: matches,
    totalCount: topJdKeywords.length,
    matchedKeywords,
    missingKeywords,
    recommendations: missingKeywords.slice(0, 5).map(kw => `Add '${kw}' keyword into your skills or project bullets.`)
  };
}

// CLI runner
if (process.argv[1] && process.argv[1].endsWith('ats-score.mjs')) {
  const args = process.argv.slice(2);
  let resumePath = null;
  let jdPath = null;

  for (const arg of args) {
    if (arg.startsWith('--resume=')) resumePath = arg.split('=')[1];
    if (arg.startsWith('--jd=')) jdPath = arg.split('=')[1];
  }

  if (!resumePath || !jdPath) {
    console.log('Usage: node ats-score.mjs --resume=<path> --jd=<path>');
    process.exit(1);
  }

  Promise.all([
    readFile(resolve(resumePath), 'utf8'),
    readFile(resolve(jdPath), 'utf8')
  ]).then(([resumeText, jdText]) => {
    const result = calculateAtsScore(resumeText, jdText);
    console.log('\n📊 ATS Keyword Score Breakdown');
    console.log(`=================================`);
    console.log(`Match Score: ${result.scorePct}% (Grade: ${result.grade})`);
    console.log(`Matched Keywords (${result.matchedCount}/${result.totalCount}): ${result.matchedKeywords.join(', ')}`);
    console.log(`Missing Keywords: ${result.missingKeywords.join(', ')}`);
    console.log('\n💡 Recommendations:');
    result.recommendations.forEach(r => console.log(`  - ${r}`));
  }).catch(err => {
    console.error('Error calculating ATS score:', err.message);
    process.exit(1);
  });
}
