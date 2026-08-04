/**
 * tests/privacy-filter.test.mjs — Unit tests for utils/privacy-filter.mjs
 */

import { redactCandidatePII, anonymizeContext } from '../utils/privacy-filter.mjs';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('🧪 Testing privacy-filter.mjs...');

const sampleProfileYml = `
candidate:
  full_name: "Jane Doe"
  email: "jane.doe@example.org"
  phone: "+1-555-987-6543"
  linkedin: "linkedin.com/in/janedoe"
  github: "github.com/janedoe"
`;

const sampleCv = `
# Jane Doe
Email: jane.doe@example.org | Phone: +1-555-987-6543
LinkedIn: linkedin.com/in/janedoe | GitHub: github.com/janedoe

## Summary
Experienced Engineer. Contact Jane Doe at jane.doe@example.org.
`;

// Test 1: redactCandidatePII
const redactedCv = redactCandidatePII(sampleCv, sampleProfileYml);
assert(!redactedCv.includes('Jane Doe'), 'Full name should be redacted');
assert(!redactedCv.includes('jane.doe@example.org'), 'Email should be redacted');
assert(!redactedCv.includes('+1-555-987-6543'), 'Phone should be redacted');
assert(!redactedCv.includes('linkedin.com/in/janedoe'), 'LinkedIn should be redacted');
assert(!redactedCv.includes('github.com/janedoe'), 'GitHub should be redacted');
assert(redactedCv.includes('Candidate Name'), 'Placeholder Candidate Name should be present');

// Test 2: anonymizeContext
const ctx = {
  cv: sampleCv,
  profile: sampleProfileYml,
  profileMode: 'Built by Jane Doe (jane.doe@example.org)'
};

const anonymizedCtx = anonymizeContext(ctx);
assert(!anonymizedCtx.cv.includes('Jane Doe'), 'ctx.cv should be redacted');
assert(!anonymizedCtx.profileMode.includes('jane.doe@example.org'), 'ctx.profileMode should be redacted');

// Test 3: Handles null / empty inputs gracefully
assert(redactCandidatePII(null, sampleProfileYml) === null, 'Handles null text');
assert(redactCandidatePII('Text', '') === 'Text', 'Handles empty profile YML');

console.log('✅ privacy-filter.test.mjs passed!');
