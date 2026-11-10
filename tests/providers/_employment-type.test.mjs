// tests/providers/_employment-type.test.mjs — the shared employment-type
// normalizer (providers/_employment-type.mjs) and the employment_type_filter
// config parser that scan.mjs and validate-portals.mjs both call.
//
// The raw strings below are the values each source actually sends, read from
// its public feed or API on 2026-11-10: Himalayas `employmentType`, We Work
// Remotely `<type>`, Remotive `job_type`, Ashby `employmentType`, Lever
// `categories.commitment`.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — _employment-type normalizer');

const {
  EMPLOYMENT_TYPES,
  normalizeEmploymentType,
  employmentTypeField,
  isEmploymentType,
  parseEmploymentTypeFilterConfig,
} = await import(pathToFileURL(join(ROOT, 'providers/_employment-type.mjs')).href);

const check = (label, cases) => {
  const wrong = cases.filter(([raw, want]) => normalizeEmploymentType(raw) !== want);
  if (wrong.length === 0) pass(label);
  else fail(`${label}: ${JSON.stringify(wrong.map(([raw, want]) => ({ raw, want, got: normalizeEmploymentType(raw) })))}`);
};

check('Himalayas values normalize (Volunteer and Other stay unknown)', [
  ['Full Time', 'full_time'],
  ['Part Time', 'part_time'],
  ['Contractor', 'contract'],
  ['Temporary', 'temporary'],
  ['Intern', 'internship'],
  ['Volunteer', undefined],
  ['Other', undefined],
]);

check('We Work Remotely <type> values normalize', [
  ['Full-Time', 'full_time'],
  ['Contract', 'contract'],
  ['Part-Time', 'part_time'],
]);

check('Remotive job_type values normalize (freelance is a contract, other is unknown)', [
  ['full_time', 'full_time'],
  ['part_time', 'part_time'],
  ['contract', 'contract'],
  ['freelance', 'contract'],
  ['internship', 'internship'],
  ['other', undefined],
]);

check('Ashby employmentType values normalize', [
  ['FullTime', 'full_time'],
  ['PartTime', 'part_time'],
  ['Contract', 'contract'],
  ['Temporary', 'temporary'],
  ['Intern', 'internship'],
]);

check('Lever free-text commitments normalize; Permanent and Scholarship stay unknown', [
  ['Full-time', 'full_time'],
  ['Full Time', 'full_time'],
  ['Internship', 'internship'],
  ['Fixed-Term', 'temporary'],
  ['Short Term', 'temporary'],
  ['Contractor', 'contract'],
  ['Permanent', undefined],
  ['Scholarship', undefined],
]);

check('schema.org JobPosting values normalize, as a string or an array', [
  ['FULL_TIME', 'full_time'],
  ['CONTRACTOR', 'contract'],
  ['INTERN', 'internship'],
  [['FULL_TIME'], 'full_time'],
]);

check('a label naming two types keeps the more specific one', [
  ['Full-time Contract', 'contract'],
  ['Part-time, Temporary', 'temporary'],
  ['Contract-to-hire', 'contract'],
  [['FULL_TIME', 'PART_TIME'], 'part_time'],
  ['Summer Internship (Full-time)', 'internship'],
]);

check('whole words only: a type inside a longer word is not read', [
  ['Contractual', undefined],
  ['Internal Mobility', undefined],
  ['Temperature Controlled', undefined],
]);

check('empty, blank and non-string input is unknown', [
  ['', undefined],
  ['   ', undefined],
  [null, undefined],
  [undefined, undefined],
  [42, undefined],
  [{ type: 'Contract' }, undefined],
  [[], undefined],
  [[null, 7], undefined],
]);

{
  const notIdempotent = EMPLOYMENT_TYPES.filter((t) => normalizeEmploymentType(t) !== t);
  if (notIdempotent.length === 0) pass('every canonical value normalizes to itself (safe to normalize twice)');
  else fail(`not idempotent: ${JSON.stringify(notIdempotent)}`);
}

{
  const known = employmentTypeField('Contractor');
  const unknown = employmentTypeField('Volunteer');
  if (known.employmentType === 'contract' && Object.keys(unknown).length === 0 && !('employmentType' in unknown)) {
    pass('employmentTypeField gives { employmentType } for a known type and {} (no key) otherwise');
  } else {
    fail(`employmentTypeField: known=${JSON.stringify(known)} unknown=${JSON.stringify(unknown)}`);
  }
}

if (isEmploymentType('part_time') && !isEmploymentType('part-time') && !isEmploymentType('Contract') && !isEmploymentType(undefined)) {
  pass('isEmploymentType accepts only the canonical spelling');
} else {
  fail('isEmploymentType should accept exactly the canonical values');
}

// ── parseEmploymentTypeFilterConfig ─────────────────────────────────
{
  if (parseEmploymentTypeFilterConfig(undefined) === null && parseEmploymentTypeFilterConfig(null) === null) {
    pass('an absent employment_type_filter parses to null (no filter)');
  } else {
    fail('absent block should parse to null');
  }

  const cfg = parseEmploymentTypeFilterConfig({ allow: ['contract', 'part_time'] });
  if (cfg && cfg.includeUnknown === true && cfg.allow.has('contract') && cfg.allow.has('part_time') && cfg.allow.size === 2) {
    pass('include_unknown defaults to true');
  } else {
    fail(`default parse: ${JSON.stringify(cfg && { allow: [...cfg.allow], includeUnknown: cfg.includeUnknown })}`);
  }

  const strict = parseEmploymentTypeFilterConfig({ allow: ['full_time'], include_unknown: false });
  if (strict && strict.includeUnknown === false) pass('include_unknown: false is honoured');
  else fail('include_unknown: false not honoured');

  const throwsWith = (block, fragment) => {
    try {
      parseEmploymentTypeFilterConfig(block);
      return `did not throw for ${JSON.stringify(block)}`;
    } catch (err) {
      return err.message.includes(fragment) ? null : `message "${err.message}" lacks "${fragment}"`;
    }
  };
  const problems = [
    throwsWith(['contract'], 'must be an object'),
    throwsWith('contract', 'must be an object'),
    throwsWith({}, 'allow must be a non-empty list'),
    throwsWith({ allow: [] }, 'allow must be a non-empty list'),
    throwsWith({ allow: 'contract' }, 'allow must be a non-empty list'),
    throwsWith({ allow: ['contractor'] }, 'did you mean "contract"'),
    throwsWith({ allow: ['part-time'] }, 'did you mean "part_time"'),
    throwsWith({ allow: ['gig'] }, '"gig"'),
    throwsWith({ allow: ['contract'], include_unknown: 'no' }, 'include_unknown must be true or false'),
    throwsWith({ allow: ['contract'], deny: ['internship'] }, 'unknown key "deny"'),
  ].filter(Boolean);
  if (problems.length === 0) pass('malformed blocks throw a message naming the key, with a "did you mean" for near misses');
  else fail(problems.join('; '));
}
