#!/usr/bin/env node
// @ts-check
/**
 * test-trust-validator.mjs — Comprehensive test suite for trust validation.
 * Run: node test-trust-validator.mjs
 *
 * Tests cover:
 *   - buildTrustValidator: disabled/enabled, config merging
 *   - validateUrl: valid, malformed, non-http protocols
 *   - matchesDomainList: exact, subdomain, no-match
 *   - companyMatchesHostname: slug, word-level, edge cases
 *   - Score calculation, clamping, and classification
 *   - Integration: multiple flags stacking
 */

import {
  buildTrustValidator,
  validateUrl,
  matchesDomainList,
  companyMatchesHostname,
  classifyTrustLevel,
} from './providers/_trust-validator.mjs';

// ── Test runner ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}`);
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

// ══════════════════════════════════════════════════════════════════════
// PART 1: classifyTrustLevel
// ══════════════════════════════════════════════════════════════════════

section('classifyTrustLevel');

assert(classifyTrustLevel(100) === 'high', '100 → high');
assert(classifyTrustLevel(95) === 'high', '95 → high');
assert(classifyTrustLevel(90) === 'high', '90 → high');
assert(classifyTrustLevel(89) === 'medium', '89 → medium');
assert(classifyTrustLevel(60) === 'medium', '60 → medium');
assert(classifyTrustLevel(59) === 'low', '59 → low');
assert(classifyTrustLevel(0) === 'low', '0 → low');

// ══════════════════════════════════════════════════════════════════════
// PART 2: validateUrl
// ══════════════════════════════════════════════════════════════════════

section('validateUrl — valid URLs');

assert(validateUrl('https://openai.com/careers').valid === true, 'https URL is valid');
assert(validateUrl('http://example.com/jobs/123').valid === true, 'http URL is valid');
assert(validateUrl('https://jobs.lever.co/company/abc-def').valid === true, 'lever URL is valid');
assert(validateUrl('https://boards.greenhouse.io/company/jobs/456').valid === true, 'greenhouse URL is valid');

section('validateUrl — invalid URLs');

assert(validateUrl('not-a-url').valid === false, 'plain text is invalid');
assert(validateUrl('openai').valid === false, 'single word is invalid');
assert(validateUrl('').valid === false, 'empty string is invalid');
assert(validateUrl('javascript:void(0)').valid === false, 'javascript: protocol is invalid');
assert(validateUrl('ftp://example.com').valid === false, 'ftp: protocol is invalid');
assert(validateUrl('file:///etc/passwd').valid === false, 'file: protocol is invalid');
assert(validateUrl('data:text/html,<h1>hi</h1>').valid === false, 'data: protocol is invalid');

// ══════════════════════════════════════════════════════════════════════
// PART 3: matchesDomainList
// ══════════════════════════════════════════════════════════════════════

section('matchesDomainList — exact matches');

assert(matchesDomainList('bit.ly', ['bit.ly']) === true, 'exact match bit.ly');
assert(matchesDomainList('tinyurl.com', ['tinyurl.com']) === true, 'exact match tinyurl.com');

section('matchesDomainList — subdomain matches');

assert(matchesDomainList('abc.bit.ly', ['bit.ly']) === true, 'subdomain of bit.ly');
assert(matchesDomainList('link.tinyurl.com', ['tinyurl.com']) === true, 'subdomain of tinyurl.com');

section('matchesDomainList — no match');

assert(matchesDomainList('example.com', ['bit.ly']) === false, 'example.com does not match bit.ly');
assert(matchesDomainList('notbit.ly', ['bit.ly']) === false, 'notbit.ly is not a subdomain of bit.ly');
assert(matchesDomainList('greenhouse.io', ['bit.ly', 'tinyurl.com']) === false, 'greenhouse not in shortener list');

section('matchesDomainList — empty list');

assert(matchesDomainList('bit.ly', []) === false, 'empty list never matches');

// ══════════════════════════════════════════════════════════════════════
// PART 4: companyMatchesHostname
// ══════════════════════════════════════════════════════════════════════

section('companyMatchesHostname — direct slug match');

assert(companyMatchesHostname('OpenAI', 'openai.com') === true, 'OpenAI matches openai.com');
assert(companyMatchesHostname('Google', 'careers.google.com') === true, 'Google matches careers.google.com');
assert(companyMatchesHostname('DeepMind', 'deepmind.google') === true, 'DeepMind matches deepmind.google');

section('companyMatchesHostname — word-level match');

assert(companyMatchesHostname('Acme Corp', 'acme.com') === true, 'Acme Corp matches acme.com (word "acme")');
assert(companyMatchesHostname('Meta Platforms', 'meta.com') === true, 'Meta Platforms matches meta.com (word "meta")');
assert(companyMatchesHostname('Big Company Inc.', 'bigcompany.com') === true, 'slug "bigcompanyinc" contains match');

section('companyMatchesHostname — short words skipped');

assert(companyMatchesHostname('AB Co', 'ab.com') === false, '"ab" is <3 chars, no slug match for "abco" in "ab.com"');
assert(companyMatchesHostname('AI Labs', 'ailabs.com') === true, 'slug "ailabs" matches hostname');

section('companyMatchesHostname — no match');

assert(companyMatchesHostname('OpenAI', 'random-careers.xyz') === false, 'OpenAI does not match random-careers.xyz');
assert(companyMatchesHostname('Stripe', 'example-jobs.com') === false, 'Stripe does not match example-jobs.com');

section('companyMatchesHostname — edge cases');

assert(companyMatchesHostname('', 'example.com') === true, 'empty company → no flag (can\'t evaluate)');
assert(companyMatchesHostname('OpenAI', '') === true, 'empty hostname → no flag (can\'t evaluate)');
assert(companyMatchesHostname(null, 'example.com') === true, 'null company → no flag');
assert(companyMatchesHostname(undefined, 'example.com') === true, 'undefined company → no flag');
assert(companyMatchesHostname('   ', 'example.com') === true, 'whitespace-only company → no flag');

// ══════════════════════════════════════════════════════════════════════
// PART 5: buildTrustValidator — disabled / no-op cases
// ══════════════════════════════════════════════════════════════════════

section('buildTrustValidator — disabled / no-op');

{
  const v = buildTrustValidator(null);
  const r = v({ url: 'https://example.com', company: 'Test' });
  assert(r.score === 100, 'null config → score 100');
  assert(r.flags.length === 0, 'null config → no flags');
  assert(r.level === 'high', 'null config → level high');
}

{
  const v = buildTrustValidator(undefined);
  const r = v({ url: 'https://example.com', company: 'Test' });
  assert(r.score === 100, 'undefined config → score 100');
}

{
  const v = buildTrustValidator({ enabled: false });
  const r = v({ url: 'not-a-url', company: '' });
  assert(r.score === 100, 'enabled: false → score 100 even with bad URL');
  assert(r.flags.length === 0, 'enabled: false → no flags');
}

// ══════════════════════════════════════════════════════════════════════
// PART 6: buildTrustValidator — enabled, individual rules
// ══════════════════════════════════════════════════════════════════════

section('buildTrustValidator — Rule 1: missing URL');

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: '', company: 'Test' });
  assert(r.flags.includes('missing_apply_url'), 'empty URL → missing_apply_url flag');
  assert(r.score === 60, 'empty URL → score 60 (100 - 40)');
  assert(r.level === 'medium', 'empty URL → level medium');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ company: 'Test' });
  assert(r.flags.includes('missing_apply_url'), 'undefined URL → missing_apply_url flag');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: null, company: 'Test' });
  assert(r.flags.includes('missing_apply_url'), 'null URL → missing_apply_url flag');
}

section('buildTrustValidator — Rule 2: invalid URL');

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'not-a-url', company: 'Test' });
  assert(r.flags.includes('invalid_url'), 'malformed URL → invalid_url flag');
  assert(r.score === 50, 'malformed URL → score 50 (100 - 50)');
  assert(r.level === 'low', 'malformed URL → level low');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'javascript:void(0)', company: 'Test' });
  assert(r.flags.includes('invalid_url'), 'javascript: URL → invalid_url flag');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'ftp://example.com/job', company: 'Test' });
  assert(r.flags.includes('invalid_url'), 'ftp: URL → invalid_url flag');
}

section('buildTrustValidator — Rule 3: suspicious domain');

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://bit.ly/abc123', company: 'Test' });
  assert(r.flags.includes('suspicious_domain'), 'bit.ly → suspicious_domain flag');
  assert(r.score === 60, 'bit.ly → score 60 (100 - 25 - 15 company mismatch)');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://tinyurl.com/xyz', company: 'Test' });
  assert(r.flags.includes('suspicious_domain'), 'tinyurl.com → suspicious_domain flag');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://abc.bit.ly/job', company: 'Test' });
  assert(r.flags.includes('suspicious_domain'), 'subdomain of bit.ly → suspicious_domain flag');
}

section('buildTrustValidator — Rule 3: custom suspicious domains');

{
  const v = buildTrustValidator({ enabled: true, suspicious_domains: ['evil.com'] });
  const r = v({ url: 'https://evil.com/job', company: 'Test' });
  assert(r.flags.includes('suspicious_domain'), 'custom blocklist: evil.com → flagged');
}

{
  const v = buildTrustValidator({ enabled: true, suspicious_domains: ['evil.com'] });
  const r = v({ url: 'https://bit.ly/abc', company: 'Test' });
  assert(!r.flags.includes('suspicious_domain'), 'custom blocklist replaces defaults: bit.ly NOT flagged');
}

section('buildTrustValidator — Rule 4: company ↔ domain mismatch');

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://openai.com/jobs', company: 'OpenAI' });
  assert(!r.flags.includes('company_domain_mismatch'), 'OpenAI + openai.com → no mismatch');
  assert(r.score === 100, 'clean match → score 100');
  assert(r.level === 'high', 'clean match → level high');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://random-careers.xyz/apply', company: 'OpenAI' });
  assert(r.flags.includes('company_domain_mismatch'), 'OpenAI + random-careers.xyz → mismatch');
  assert(r.score === 85, 'mismatch → score 85 (100 - 15)');
}

section('buildTrustValidator — Rule 4: ATS allowlist bypasses mismatch');

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://boards.greenhouse.io/openai/jobs/123', company: 'OpenAI' });
  assert(!r.flags.includes('company_domain_mismatch'), 'greenhouse.io → ATS allowlist, no mismatch');
  assert(r.score === 100, 'ATS-hosted → score 100');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://jobs.lever.co/stripe/abc', company: 'Stripe' });
  assert(!r.flags.includes('company_domain_mismatch'), 'lever.co → ATS allowlist, no mismatch');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://company.wd1.myworkdayjobs.com/careers', company: 'Acme' });
  assert(!r.flags.includes('company_domain_mismatch'), 'myworkdayjobs.com → ATS allowlist, no mismatch');
}

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://acme.ashbyhq.com/jobs', company: 'Acme' });
  assert(!r.flags.includes('company_domain_mismatch'), 'ashbyhq.com → ATS allowlist, no mismatch');
}

section('buildTrustValidator — Rule 4: empty company → no mismatch flag');

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://random-site.xyz/job', company: '' });
  assert(!r.flags.includes('company_domain_mismatch'), 'empty company → no mismatch (can\'t evaluate)');
}

// ══════════════════════════════════════════════════════════════════════
// PART 7: Score stacking and clamping
// ══════════════════════════════════════════════════════════════════════

section('buildTrustValidator — multiple flags stacking');

{
  // suspicious_domain (-25) + company_domain_mismatch (-15) = 60
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'https://bit.ly/abc', company: 'OpenAI' });
  assert(r.flags.includes('suspicious_domain'), 'stacking: suspicious_domain present');
  assert(r.flags.includes('company_domain_mismatch'), 'stacking: company_domain_mismatch present');
  assert(r.score === 60, 'stacking: 100 - 25 - 15 = 60');
  assert(r.level === 'medium', 'stacking: score 60 → medium');
}

section('buildTrustValidator — score clamping');

{
  // missing_apply_url (-40) + can't stack further since missing URL returns early
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: '', company: 'Test' });
  assert(r.score >= 0, 'score never goes below 0');
  assert(r.score <= 100, 'score never exceeds 100');
}

// ══════════════════════════════════════════════════════════════════════
// PART 8: Clean jobs pass through perfectly
// ══════════════════════════════════════════════════════════════════════

section('buildTrustValidator — clean jobs');

{
  const v = buildTrustValidator({ enabled: true });

  const clean1 = v({ url: 'https://openai.com/careers/apply', company: 'OpenAI' });
  assert(clean1.score === 100, 'OpenAI + openai.com → 100');
  assert(clean1.flags.length === 0, 'no flags');

  const clean2 = v({ url: 'https://stripe.com/jobs/senior-eng', company: 'Stripe' });
  assert(clean2.score === 100, 'Stripe + stripe.com → 100');
  assert(clean2.flags.length === 0, 'no flags');

  const clean3 = v({ url: 'https://boards.greenhouse.io/acme/jobs/123', company: 'Acme' });
  assert(clean3.score === 100, 'ATS-hosted Acme → 100');
  assert(clean3.flags.length === 0, 'no flags');
}

// ══════════════════════════════════════════════════════════════════════
// PART 9: Custom ATS allowlist
// ══════════════════════════════════════════════════════════════════════

section('buildTrustValidator — custom ATS allowlist');

{
  const v = buildTrustValidator({
    enabled: true,
    ats_allowlist: ['custom-ats.io'],
  });
  const r = v({ url: 'https://custom-ats.io/company/jobs', company: 'Test' });
  assert(!r.flags.includes('company_domain_mismatch'), 'custom ATS allowlist: custom-ats.io → no mismatch');
}

{
  const v = buildTrustValidator({
    enabled: true,
    ats_allowlist: ['custom-ats.io'],
  });
  // Default ATS (greenhouse) is no longer in the allowlist, and "test" is not
  // a substring of "boards.greenhouse.io", so mismatch IS expected here.
  const r = v({ url: 'https://boards.greenhouse.io/test/jobs/1', company: 'Test' });
  assert(r.flags.includes('company_domain_mismatch'), 'custom ATS replaces defaults: greenhouse no longer exempt → mismatch');
}

// ══════════════════════════════════════════════════════════════════════
// PART 10: config.enabled: true (explicit)
// ══════════════════════════════════════════════════════════════════════

section('buildTrustValidator — explicit enabled: true');

{
  const v = buildTrustValidator({ enabled: true });
  const r = v({ url: 'not-a-url', company: 'Test' });
  assert(r.flags.includes('invalid_url'), 'enabled: true processes rules');
}

// ══════════════════════════════════════════════════════════════════════
// PART 11: config without enabled key (defaults to enabled)
// ══════════════════════════════════════════════════════════════════════

section('buildTrustValidator — config without enabled key');

{
  const v = buildTrustValidator({});
  const r = v({ url: 'not-a-url', company: 'Test' });
  assert(r.flags.includes('invalid_url'), 'empty config (no enabled key) → defaults to enabled');
}

// ══════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(50)}`);

if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${passed} tests passed!`);
}
