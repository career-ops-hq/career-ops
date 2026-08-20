#!/usr/bin/env node

/**
 * knowledge-bank.mjs — Persistent ATS Screening Question Knowledge Bank
 *
 * Stores and retrieves standard, personalized candidate answers for ATS screening forms.
 *
 * Usage:
 *   node knowledge-bank.mjs [--question="Why Acme?"]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_JSON = resolve(__dirname, 'config', 'application-answers.json');

const DEFAULT_BANK = {
  work_authorization: {
    legally_authorized: "Yes",
    require_sponsorship: "No",
    work_permit_type: "Citizen / Permanent Resident"
  },
  availability: {
    notice_period: "2 weeks",
    earliest_start_date: "Immediately / 2 weeks notice"
  },
  compensation: {
    salary_expectation: "Market Competitive / Negotiable ($120,000 - $160,000)",
    salary_currency: "USD"
  },
  common_questions: {
    "why_company": "I am drawn to your team's engineering culture, rapid growth, and commitment to building high-impact production systems.",
    "tell_me_about_yourself": "Full-stack engineer with 6+ years building scalable microservices, real-time data pipelines, and production systems.",
    "greatest_achievement": "Led the architecture of a real-time data streaming engine processing 99.7% precision at 50ms p99 latency."
  }
};

export function getAnswerForQuestion(questionText, companyName = '') {
  let bank = DEFAULT_BANK;
  if (existsSync(KNOWLEDGE_JSON)) {
    try {
      bank = JSON.parse(readFileSync(KNOWLEDGE_JSON, 'utf8'));
    } catch (_) {}
  }

  const q = (questionText || '').toLowerCase();

  if (q.includes('work auth') || q.includes('authorized') || q.includes('legally')) {
    return bank.work_authorization.legally_authorized;
  }
  if (q.includes('sponsor') || q.includes('visa')) {
    return bank.work_authorization.require_sponsorship;
  }
  if (q.includes('notice') || q.includes('start date') || q.includes('available')) {
    return bank.availability.earliest_start_date;
  }
  if (q.includes('salary') || q.includes('compensation') || q.includes('pay')) {
    return bank.compensation.salary_expectation;
  }
  if (q.includes('why') || q.includes('interest')) {
    return bank.common_questions.why_company.replace(/your team/g, companyName || 'your team');
  }

  return bank.common_questions.tell_me_about_yourself;
}

if (process.argv[1] && process.argv[1].endsWith('knowledge-bank.mjs')) {
  const args = process.argv.slice(2);
  let question = "salary expectations";
  for (const arg of args) {
    if (arg.startsWith('--question=')) question = arg.split('=')[1];
  }

  if (!existsSync(KNOWLEDGE_JSON)) {
    mkdirSync(dirname(KNOWLEDGE_JSON), { recursive: true });
    writeFileSync(KNOWLEDGE_JSON, JSON.stringify(DEFAULT_BANK, null, 2), 'utf8');
  }

  const ans = getAnswerForQuestion(question);
  console.log(`\n🧠 Knowledge Bank Lookup`);
  console.log(`Question: "${question}"`);
  console.log(`Answer:   "${ans}"\n`);
}
