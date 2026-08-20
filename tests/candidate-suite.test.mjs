// tests/candidate-suite.test.mjs — Test suite for Candidate Career Acceleration Tools
import { pass, fail } from './helpers.mjs';
import { generateInterviewPrep } from '../interview-prep.mjs';
import { generateOutreachCadence } from '../outreach-generator.mjs';
import { evaluateSalaryOffer } from '../salary-advisor.mjs';
import { generateDailyDigest } from '../daily-digest.mjs';

console.log('\ncandidate-suite.test.mjs — Testing Candidate Acceleration Suite');

// 1. Test Interview Prep
const prep = generateInterviewPrep({ name: 'Alex Chen' }, 'Software Engineer role');
if (prep && prep.starStories && prep.starStories.length >= 2) {
  pass('Candidate Suite 1: Interview Copilot generates STAR behavioral stories');
} else {
  fail('Candidate Suite 1 failed');
}

// 2. Test Recruiter Outreach
const outreach = generateOutreachCadence({ company: 'Acme Corp', role: 'Senior Engineer' });
if (outreach && outreach.coldEmailSubject.includes('Senior Engineer')) {
  pass('Candidate Suite 2: Recruiter Outreach generates cold emails and follow-ups');
} else {
  fail('Candidate Suite 2 failed');
}

// 3. Test Salary Advisor
const salary = evaluateSalaryOffer({ role: 'Senior ML Engineer', offered: 150000 });
if (salary && salary.benchmarks && salary.suggestedCounter) {
  pass('Candidate Suite 3: Salary Advisor computes market benchmarks and counter-offer script');
} else {
  fail('Candidate Suite 3 failed');
}

// 4. Test Daily Digest
const digest = generateDailyDigest();
if (digest && digest.includes('DAILY 9:00 AM SMART JOB DIGEST')) {
  pass('Candidate Suite 4: Daily Digest generates morning job alerts summary');
} else {
  fail('Candidate Suite 4 failed');
}
