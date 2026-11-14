// @ts-check
/**
 * tests/workplace-filter.test.mjs — Comprehensive test suite for workplaceType and workplace_filter.
 * Run: node test-all.mjs --only workplace-filter
 */

import { buildWorkplaceFilter } from '../scan.mjs';
import { normalizeWorkplaceType, workplaceField } from '../providers/_workplace-type.mjs';
import { validatePortalsConfig, portalTopLevelTypos } from '../validate-portals.mjs';
import ashby from '../providers/ashby.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nworkplace filter + workplaceType normalization');

function assert(condition, testName) {
  if (condition) pass(testName);
  else fail(testName);
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

// ══════════════════════════════════════════════════════════════════════
// PART 1: normalizeWorkplaceType & workplaceField
// ══════════════════════════════════════════════════════════════════════

section('normalizeWorkplaceType — basic mappings and normalization');

assert(normalizeWorkplaceType('remote') === 'remote', 'lowercase "remote" → "remote"');
assert(normalizeWorkplaceType('hybrid') === 'hybrid', 'lowercase "hybrid" → "hybrid"');
assert(normalizeWorkplaceType('onsite') === 'onsite', 'lowercase "onsite" → "onsite"');
assert(normalizeWorkplaceType('on-site') === 'onsite', 'hyphenated "on-site" → "onsite"');

assert(normalizeWorkplaceType('  Remote  ') === 'remote', 'whitespace padded "  Remote  " → "remote"');
assert(normalizeWorkplaceType('HYBRID') === 'hybrid', 'uppercase "HYBRID" → "hybrid"');
assert(normalizeWorkplaceType('On-Site') === 'onsite', 'mixed case "On-Site" → "onsite"');
assert(normalizeWorkplaceType('Onsite') === 'onsite', 'mixed case "Onsite" → "onsite"');

section('normalizeWorkplaceType — omitted and invalid values');

assert(normalizeWorkplaceType('') === undefined, 'empty string → undefined');
assert(normalizeWorkplaceType('   ') === undefined, 'whitespace-only → undefined');
assert(normalizeWorkplaceType('unspecified') === undefined, '"unspecified" → undefined');
assert(normalizeWorkplaceType('unknown') === undefined, '"unknown" → undefined');
assert(normalizeWorkplaceType('flexible') === undefined, 'unknown word "flexible" → undefined');
assert(normalizeWorkplaceType(null) === undefined, 'null → undefined');
assert(normalizeWorkplaceType(undefined) === undefined, 'undefined → undefined');
assert(normalizeWorkplaceType(123) === undefined, 'number → undefined');
assert(normalizeWorkplaceType(true) === undefined, 'boolean → undefined');

section('workplaceField — object spreading helper');

{
  const remote = workplaceField('Remote');
  assert(remote.workplaceType === 'remote', 'workplaceField("Remote") has workplaceType: "remote"');

  const onsite = workplaceField('on-site');
  assert(onsite.workplaceType === 'onsite', 'workplaceField("on-site") has workplaceType: "onsite"');

  const omitted = workplaceField('unknown');
  assert(!('workplaceType' in omitted) && Object.keys(omitted).length === 0, 'workplaceField("unknown") returns empty object');

  const fromBlank = workplaceField('   ');
  assert(!('workplaceType' in fromBlank) && Object.keys(fromBlank).length === 0, 'workplaceField("   ") returns empty object');
}

// ══════════════════════════════════════════════════════════════════════
// PART 2: buildWorkplaceFilter — disabled / no-op cases
// ══════════════════════════════════════════════════════════════════════

section('buildWorkplaceFilter — disabled / no-op cases');

{
  const nullFilter = buildWorkplaceFilter(null);
  assert(nullFilter('remote') === true && nullFilter('onsite') === true && nullFilter(undefined) === true, 'null config → pass all');

  const undefinedFilter = buildWorkplaceFilter(undefined);
  assert(undefinedFilter('hybrid') === true && undefinedFilter(undefined) === true, 'undefined config → pass all');

  const emptyFilter = buildWorkplaceFilter({});
  assert(emptyFilter('remote') === true && emptyFilter(undefined) === true, 'empty object (no allow) → pass all');

  const emptyAllow = buildWorkplaceFilter({ allow: [] });
  assert(emptyAllow('remote') === true && emptyAllow('onsite') === true, 'empty allow list → pass all (no-op)');

  const nonArrayAllow = buildWorkplaceFilter({ allow: 'remote' });
  assert(nonArrayAllow('remote') === true && nonArrayAllow('onsite') === true, 'non-array allow → pass all (no-op)');

  const allInvalidAllow = buildWorkplaceFilter({ allow: ['invalid', 'unspecified'] });
  assert(allInvalidAllow('remote') === true && allInvalidAllow('onsite') === true, 'all-invalid allow entries → pass all (no-op)');
}

// ══════════════════════════════════════════════════════════════════════
// PART 3: buildWorkplaceFilter — allow list and alias/case handling
// ══════════════════════════════════════════════════════════════════════

section('buildWorkplaceFilter — basic allow filtering');

{
  const filter = buildWorkplaceFilter({ allow: ['remote'] });
  assert(filter('remote') === true, 'allow: [remote] matches job workplaceType: "remote"');
  assert(filter('hybrid') === false, 'allow: [remote] rejects job workplaceType: "hybrid"');
  assert(filter('onsite') === false, 'allow: [remote] rejects job workplaceType: "onsite"');
}

{
  const filter = buildWorkplaceFilter({ allow: ['remote', 'hybrid'] });
  assert(filter('remote') === true, 'allow: [remote, hybrid] matches "remote"');
  assert(filter('hybrid') === true, 'allow: [remote, hybrid] matches "hybrid"');
  assert(filter('onsite') === false, 'allow: [remote, hybrid] rejects "onsite"');
}

section('buildWorkplaceFilter — config alias, case, and whitespace normalization');

{
  const filter = buildWorkplaceFilter({ allow: ['  REMOTE  ', 'On-Site'] });
  assert(filter('remote') === true, 'allow with "  REMOTE  " matches "remote"');
  assert(filter('onsite') === true, 'allow with "On-Site" matches "onsite"');
  assert(filter('hybrid') === false, 'allow with [remote, on-site] rejects "hybrid"');
}

{
  const filter = buildWorkplaceFilter({ allow: ['remote', 'invalid_entry'] });
  assert(filter('remote') === true, 'partially valid allow retains valid "remote"');
  assert(filter('onsite') === false, 'partially valid allow still rejects "onsite"');
}

// ══════════════════════════════════════════════════════════════════════
// PART 4: buildWorkplaceFilter — include_unknown semantics
// ══════════════════════════════════════════════════════════════════════

section('buildWorkplaceFilter — default include_unknown (true)');

{
  const filter = buildWorkplaceFilter({ allow: ['remote'] });
  assert(filter(undefined) === true, 'default include_unknown: undefined workplaceType passes');
  assert(filter(null) === true, 'default include_unknown: null workplaceType passes');
  assert(filter('') === true, 'default include_unknown: empty string workplaceType passes');
  assert(filter('unspecified') === true, 'default include_unknown: unspecified workplaceType passes');
  assert(filter('flexible') === true, 'default include_unknown: unrecognized workplaceType passes');
  assert(filter('remote') === true, 'default include_unknown: allowed remote passes');
  assert(filter('hybrid') === false, 'default include_unknown: disallowed hybrid rejected');
}

section('buildWorkplaceFilter — explicit include_unknown: true');

{
  const filter = buildWorkplaceFilter({ allow: ['remote', 'hybrid'], include_unknown: true });
  assert(filter(undefined) === true, 'explicit include_unknown=true: missing workplaceType passes');
  assert(filter('unspecified') === true, 'explicit include_unknown=true: unrecognized workplaceType passes');
  assert(filter('hybrid') === true, 'explicit include_unknown=true: hybrid passes');
  assert(filter('onsite') === false, 'explicit include_unknown=true: onsite rejected');
}

section('buildWorkplaceFilter — explicit include_unknown: false');

{
  const filter = buildWorkplaceFilter({ allow: ['remote'], include_unknown: false });
  assert(filter('remote') === true, 'include_unknown=false: allowed remote passes');
  assert(filter('hybrid') === false, 'include_unknown=false: disallowed hybrid rejected');
  assert(filter('onsite') === false, 'include_unknown=false: disallowed onsite rejected');
  assert(filter(undefined) === false, 'include_unknown=false: missing workplaceType rejected');
  assert(filter(null) === false, 'include_unknown=false: null workplaceType rejected');
  assert(filter('') === false, 'include_unknown=false: empty string workplaceType rejected');
  assert(filter('unspecified') === false, 'include_unknown=false: unspecified workplaceType rejected');
  assert(filter('unknown') === false, 'include_unknown=false: unknown workplaceType rejected');
}

// ══════════════════════════════════════════════════════════════════════
// PART 5: validatePortalsConfig — schema validation
// ══════════════════════════════════════════════════════════════════════

section('validatePortalsConfig — valid workplace_filter configurations');

{
  const valid = await validatePortalsConfig({
    workplace_filter: {
      allow: ['remote', 'hybrid', 'on-site'],
      include_unknown: false,
    },
  });
  assert(valid.errors.length === 0, 'valid workplace_filter passes validation with 0 errors');
}

{
  const valid = await validatePortalsConfig({
    workplace_filter: {
      allow: ['remote'],
    },
  });
  assert(valid.errors.length === 0, 'workplace_filter with allow only passes validation');
}

section('validatePortalsConfig — typo and invalid structure detection');

{
  const typos = portalTopLevelTypos({ workpalce_filter: { allow: ['remote'] } });
  assert(
    typos.length === 1 && typos[0].key === 'workpalce_filter' && typos[0].suggestion === 'workplace_filter',
    'portalTopLevelTypos detects "workpalce_filter" and suggests "workplace_filter"',
  );
}

{
  const nonObject = await validatePortalsConfig({ workplace_filter: 'remote' });
  assert(
    nonObject.errors.some((e) => e.path === 'workplace_filter' && e.message.includes('must be an object')),
    'non-object workplace_filter reports error',
  );
}

{
  const unknownField = await validatePortalsConfig({
    workplace_filter: { allow: ['remote'], extra_param: 123 },
  });
  assert(
    unknownField.errors.some((e) => e.path === 'workplace_filter.extra_param' && e.message.includes('unknown key')),
    'unknown field in workplace_filter reports error',
  );
}

{
  const badIncludeUnknown = await validatePortalsConfig({
    workplace_filter: { allow: ['remote'], include_unknown: 'yes' },
  });
  assert(
    badIncludeUnknown.errors.some((e) => e.path === 'workplace_filter.include_unknown' && e.message.includes('must be a boolean')),
    'non-boolean include_unknown reports error',
  );
}

{
  const badAllowType = await validatePortalsConfig({
    workplace_filter: { allow: 'remote' },
  });
  assert(
    badAllowType.errors.some((e) => e.path === 'workplace_filter.allow' && e.message.includes('must be an array')),
    'non-array allow reports error',
  );
}

{
  const invalidAllowItem = await validatePortalsConfig({
    workplace_filter: { allow: ['remote', 'flexible', 123] },
  });
  assert(
    invalidAllowItem.errors.some((e) => e.path === 'workplace_filter.allow[1]' && e.message.includes('must be one of: remote, hybrid, onsite')),
    'invalid string in allow reports error',
  );
  assert(
    invalidAllowItem.errors.some((e) => e.path === 'workplace_filter.allow[2]' && e.message.includes('must be one of: remote, hybrid, onsite')),
    'non-string item in allow reports error',
  );
}

// ══════════════════════════════════════════════════════════════════════
// PART 4: End-to-end (ashby.fetch → buildWorkplaceFilter)
// ══════════════════════════════════════════════════════════════════════

section('End-to-end — Ashby postings through workplace filter');

{
  const jobs = await ashby.fetch(
    { name: 'Acme', careers_url: 'https://jobs.ashbyhq.com/acme' },
    {
      fetchJson: async () => ({
        jobs: [
          { id: '1', title: 'Remote Role', workplaceType: 'Remote' },
          { id: '2', title: 'Hybrid Role', workplaceType: 'Hybrid' },
          { id: '3', title: 'Onsite Role', workplaceType: 'OnSite' },
          { id: '4', title: 'Unspecified Role', workplaceType: 'Unspecified' },
          { id: '5', title: 'No Workplace Role' },
        ],
      }),
    },
  );

  const filter = buildWorkplaceFilter({
    allow: ['remote', 'hybrid'],
    include_unknown: false,
  });

  const survivors = jobs.filter((job) => filter(job.workplaceType));

  assert(survivors.length === 2, 'e2e: exactly 2 survivors pass allow:[remote, hybrid] with include_unknown:false');
  assert(survivors[0]?.title === 'Remote Role', 'e2e: Remote Role survived');
  assert(survivors[1]?.title === 'Hybrid Role', 'e2e: Hybrid Role survived');
  assert(
    !survivors.some((j) => j.title === 'Onsite Role' || j.title === 'Unspecified Role' || j.title === 'No Workplace Role'),
    'e2e: Onsite and unknown/unspecified roles were rejected',
  );
}

