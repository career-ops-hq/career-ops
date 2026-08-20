#!/usr/bin/env node

/**
 * batch-match.mjs — Batch JD Matcher & Bulk Job Ranker
 *
 * Scores and ranks all live job postings from remote-job-pipeline by ATS keyword match score.
 *
 * Usage:
 *   node batch-match.mjs [--top=10]
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { calculateAtsScore } from './ats-score.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHORTLIST_PATH = resolve(__dirname, '..', 'remote-job-pipeline', 'output', '2026-08-18', 'daily-shortlist.json');

export function rankAllJobs(candidateResumeText, topCount = 10) {
  if (!existsSync(SHORTLIST_PATH)) {
    return [];
  }

  let jobs = [];
  try {
    jobs = JSON.parse(readFileSync(SHORTLIST_PATH, 'utf8'));
  } catch (_) {
    return [];
  }

  const scoredJobs = jobs.map(j => {
    const jdText = `${j.Role || ''} ${j.Company || ''} ${j['Tech Stack'] || ''}`;
    const score = calculateAtsScore(candidateResumeText, jdText);
    return {
      company: j.Company || 'Company',
      role: j.Role || 'Role',
      location: j.Location || 'Remote',
      scorePct: score.scorePct,
      grade: score.grade,
      applyUrl: j['Apply URL'] || '#'
    };
  });

  scoredJobs.sort((a, b) => b.scorePct - a.scorePct);
  return scoredJobs.slice(0, topCount);
}

if (process.argv[1] && process.argv[1].endsWith('batch-match.mjs')) {
  const candidateSample = "Senior ML Engineer Python Go AWS Kafka Terraform Docker Kubernetes PostgreSQL SQL";
  const ranked = rankAllJobs(candidateSample, 5);

  console.log('\n🔍 BATCH JD MATCHER — TOP RANKED JOBS');
  console.log(`======================================`);
  ranked.forEach((r, idx) => {
    console.log(`[#${idx + 1}] ${r.role} @ ${r.company}`);
    console.log(`     Match Score: ${r.scorePct}% (${r.grade}) | Location: ${r.location}`);
    console.log(`     Apply URL:   ${r.applyUrl}\n`);
  });
}
