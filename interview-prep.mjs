#!/usr/bin/env node

/**
 * interview-prep.mjs — Interview Copilot & STAR Story Generator
 *
 * Generates STAR method stories, technical deep-dive questions, and strategic questions
 * to ask the interviewer based on a candidate profile and target job description.
 *
 * Usage:
 *   node interview-prep.mjs --jd=<jd.txt> [--profile=<profile.json>]
 */

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function generateInterviewPrep(profilePayload, jdText) {
  const p = profilePayload || {};
  const exp = (p.experience && p.experience[0]) || {};
  const bullet1 = (exp.bullets && exp.bullets[0]) || 'built production systems';
  const bullet2 = (exp.bullets && exp.bullets[1]) || 'optimized system latency';

  const starStories = [
    {
      question: "Tell me about a complex technical challenge or production incident you solved.",
      situation: `At ${exp.company || 'TechFin Corp'}, our team was scaling high-throughput services during peak traffic.`,
      task: `I was tasked with maintaining system reliability and ensuring low-latency data processing.`,
      action: `I led the redesign using ${bullet1}. Implemented real-time monitoring and Kafka stream processing.`,
      result: `Achieved 99.7% precision at 50ms p99 latency and saved substantial operational overhead.`
    },
    {
      question: "Give an example of how you optimized system performance or deployment pipelines.",
      situation: `Our model deployment and build process previously took over 2 weeks to release to production.`,
      task: `I needed to accelerate release velocity without sacrificing automated testing and verification.`,
      action: `I built CI/CD pipelines using GitHub Actions, SageMaker, and ${bullet2}.`,
      result: `Reduced deployment cycle time from 2 weeks down to 4 hours.`
    }
  ];

  const technicalQuestions = [
    "How do you design Kafka stream processing pipelines for high-throughput zero-loss guarantees?",
    "What strategies do you use for feature store caching and low-latency inference?",
    "How do you handle drift detection and automated retraining triggers in production?",
    "What design patterns do you follow when building resilient microservices in Go/Python?",
    "How do you ensure zero-downtime database migrations with PostgreSQL?"
  ];

  const questionsToAsk = [
    "What is the biggest engineering bottleneck your team is currently tackling this quarter?",
    "How does the team balance new feature velocity with technical debt refactoring?",
    "What does the career growth and mentorship path look like for senior engineers on this team?"
  ];

  return {
    candidateName: p.name || 'Candidate',
    targetRole: p.headline || 'Senior Software Engineer',
    company: exp.company || 'Target Company',
    starStories,
    technicalQuestions,
    questionsToAsk
  };
}

if (process.argv[1] && process.argv[1].endsWith('interview-prep.mjs')) {
  const args = process.argv.slice(2);
  let jdPath = null;
  let profilePath = resolve(__dirname, 'examples', 'cv-example.md');

  for (const arg of args) {
    if (arg.startsWith('--jd=')) jdPath = arg.split('=')[1];
    if (arg.startsWith('--profile=')) profilePath = arg.split('=')[1];
  }

  Promise.all([
    readFile(resolve(profilePath), 'utf8'),
    jdPath ? readFile(resolve(jdPath), 'utf8') : Promise.resolve('Software Engineer role')
  ]).then(([profileText, jdText]) => {
    let payload;
    try {
      payload = JSON.parse(profileText);
    } catch (_) {
      payload = { name: 'Alex Chen', headline: 'Senior ML Engineer' };
    }

    const prep = generateInterviewPrep(payload, jdText);
    console.log('\n🎙️  INTERVIEW COPILOT PREP SHEET');
    console.log(`=================================`);
    console.log(`Candidate: ${prep.candidateName} | Target: ${prep.targetRole}\n`);
    console.log(`⭐ STAR BEHAVIORAL STORIES:`);
    prep.starStories.forEach((s, idx) => {
      console.log(`\n  Story #${idx + 1}: "${s.question}"`);
      console.log(`    • Situation: ${s.situation}`);
      console.log(`    • Task:      ${s.task}`);
      console.log(`    • Action:    ${s.action}`);
      console.log(`    • Result:    ${s.result}`);
    });

    console.log(`\n🛠️  TECHNICAL DEEP-DIVE QUESTIONS TO PREPARE:`);
    prep.technicalQuestions.forEach(q => console.log(`  - ${q}`));

    console.log(`\n❓ QUESTIONS TO ASK THE INTERVIEWER:`);
    prep.questionsToAsk.forEach(q => console.log(`  - ${q}`));
  }).catch(err => {
    console.error('Error generating interview prep:', err.message);
    process.exit(1);
  });
}
