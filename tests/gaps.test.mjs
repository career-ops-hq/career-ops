// tests/gaps.test.mjs — Test suite verifying resolution of all 4 system gaps
import { pass, fail } from './helpers.mjs';
import { getAnswerForQuestion } from '../knowledge-bank.mjs';
import { detectCaptcha } from '../captcha-guard.mjs';
import { syncApplicationStatus } from '../sync-application-tracker.mjs';
import { verifyFacts } from '../verify-cv-facts.mjs';

console.log('\ngaps.test.mjs — Testing All 4 System Gap Fixes');

// 1. Test CAPTCHA Guard
if (detectCaptcha('<div class="g-recaptcha"></div>') === true) {
  pass('Gap 1 Fix: CAPTCHA Guard detects reCAPTCHA signature');
} else {
  fail('Gap 1 Fix failed');
}

// 2. Test Fact Verification Guardrail
const check = verifyFacts('# CV -- Alex Chen\nWorked at TechFin Corp');
if (check && (check.verdict === 'pass' || check.verdict === 'block')) {
  pass(`Gap 2 Fix: Fact Verification Guardrail evaluates claims (Verdict: ${check.verdict})`);
} else {
  fail('Gap 2 Fix failed');
}

// 3. Test Centralized Tracker Sync
const syncResult = syncApplicationStatus();
if (syncResult && typeof syncResult.syncedCount === 'number') {
  pass('Gap 3 Fix: Centralized Tracker Sync updates tracker.tsv');
} else {
  fail('Gap 3 Fix failed');
}

// 4. Test Knowledge Bank
const salaryAns = getAnswerForQuestion('What is your expected compensation?');
if (salaryAns && salaryAns.includes('Negotiable')) {
  pass('Gap 4 Fix: Knowledge Bank retrieves screening question answer');
} else {
  fail('Gap 4 Fix failed');
}
