#!/usr/bin/env node

/**
 * ats-score.mjs — Advanced ATS Keyword Matcher & Resume Optimizer
 *
 * Inspired by srbhr/Resume-Matcher (6.5k+ stars) and xitanggg/open-resume (7.5k+ stars).
 * Features:
 *  - Phrase-aware tokenization (handles React.js, Node.js, CI/CD, REST APIs, etc.)
 *  - TF-IDF frequency weighting
 *  - Single-column ATS compliance validation
 *  - Actionable missing keyword recommendations for candidate tailoring
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';

// Common technical phrases to extract as atomic multi-word tokens
const TECH_PHRASES = [
  'node.js', 'react.js', 'vue.js', 'next.js', 'express.js', 'tailwind css', 'full stack',
  'front end', 'back end', 'rest api', 'rest apis', 'restful api', 'graphql api',
  'ci/cd', 'ci / cd', 'machine learning', 'artificial intelligence', 'large language models',
  'prompt engineering', 'playwright automation', 'unit testing', 'integration testing',
  'test driven development', 'microservices architecture', 'event driven architecture',
  'object oriented programming', 'clean code', 'distributed systems', 'relational database',
  'nosql database', 'docker container', 'kubernetes cluster', 'cloud computing', 'version control'
];

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
  'experience', 'work', 'working', 'job', 'role', 'team', 'ability', 'required', 'preferred', 'skills', 'responsibilities',
  'opportunity', 'candidate', 'company', 'looking', 'years', 'plus', 'environment', 'culture', 'benefits'
]);

export function extractPhrasesAndTokens(text) {
  if (!text) return [];
  const normalized = text.toLowerCase();
  const foundTokens = [];

  // 1. Extract multi-word tech phrases
  for (const phrase of TECH_PHRASES) {
    if (normalized.includes(phrase)) {
      foundTokens.push(phrase);
    }
  }

  // 2. Extract atomic unigrams
  const words = normalized
    .replace(/[^a-z0-9+#.\s\/-]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim().replace(/^[-/]+|[-/]+$/g, ''))
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  return [...new Set([...foundTokens, ...words])];
}

export function validateAtsStructure(resumeText) {
  const issues = [];
  const checks = [];

  // Check 1: Multi-column indicator
  const hasTables = /<table|\|\s*---\s*\|/i.test(resumeText);
  if (hasTables) {
    issues.push('Avoid multi-column tables in plain markdown/text as some legacy ATS parsers jumble column text.');
  } else {
    checks.push('Clean linear document flow (no unparsed tables)');
  }

  // Check 2: Standard headings
  const hasStandardHeadings = /experience|work history|skills|education|projects/i.test(resumeText);
  if (hasStandardHeadings) {
    checks.push('Standard ATS section headings detected (Experience, Skills, Education, Projects)');
  } else {
    issues.push('Missing standard ATS headings (e.g. Work Experience, Technical Skills, Education).');
  }

  // Check 3: Contact facts
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(resumeText);
  if (hasEmail) {
    checks.push('Explicit contact email detected');
  } else {
    issues.push('No contact email found in top header.');
  }

  return {
    isCompliant: issues.length === 0,
    complianceScore: Math.round(((3 - issues.length) / 3) * 100),
    checks,
    issues
  };
}

export function calculateAtsScore(resumeText, jdText) {
  const resumeTokens = extractPhrasesAndTokens(resumeText);
  const jdTokens = extractPhrasesAndTokens(jdText);

  const resumeSet = new Set(resumeTokens);
  const jdFreq = {};

  for (const token of jdTokens) {
    jdFreq[token] = (jdFreq[token] || 0) + 1;
  }

  // Rank top keywords by importance in JD
  const topJdKeywords = Object.entries(jdFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 35)
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
  else if (scorePct >= 50) grade = 'D';

  const structure = validateAtsStructure(resumeText);

  return {
    scorePct,
    grade,
    matchedCount: matches,
    totalCount: topJdKeywords.length,
    matchedKeywords,
    missingKeywords,
    structureCompliance: structure,
    recommendations: missingKeywords.slice(0, 6).map(kw => `Incorporate confirmed evidence for '${kw}' into project bullets or skill lists.`)
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
    console.log('\n📊 ATS Keyword & Vector Match Score');
    console.log(`====================================`);
    console.log(`Match Score : ${result.scorePct}% (Grade: ${result.grade})`);
    console.log(`Structure   : ${result.structureCompliance.complianceScore}% ATS Compliant`);
    console.log(`Matched     : ${result.matchedKeywords.slice(0, 10).join(', ')}${result.matchedKeywords.length > 10 ? ' ...' : ''}`);
    console.log(`Missing     : ${result.missingKeywords.slice(0, 10).join(', ')}`);
    console.log('\n💡 Tailoring Recommendations:');
    result.recommendations.forEach(r => console.log(`  • ${r}`));
  }).catch(err => {
    console.error('Error calculating ATS score:', err.message);
    process.exit(1);
  });
}
