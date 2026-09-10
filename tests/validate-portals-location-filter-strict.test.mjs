// tests/validate-portals-location-filter-strict.test.mjs — validate-portals
// type-checks the opt-in `location_filter.strict` flag (#3276): a boolean is
// accepted, a non-boolean is rejected by name, and omitting it stays valid.
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, NODE } from './helpers.mjs';

console.log('\nvalidate-portals — location_filter.strict');

const tmp = mkdtempSync(join(tmpdir(), 'co-lfs-'));

const CONFIG = (strictLine) => `
title_filter:
  positive: ["AI Engineer"]
location_filter:
  allow: ["Puerto Rico"]
${strictLine}
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`;

try {
  const boolPath = join(tmp, 'strict-bool.yml');
  writeFileSync(boolPath, CONFIG('  strict: true'), 'utf-8');

  const stringPath = join(tmp, 'strict-string.yml');
  writeFileSync(stringPath, CONFIG('  strict: "yes"'), 'utf-8');

  const absentPath = join(tmp, 'strict-absent.yml');
  writeFileSync(absentPath, CONFIG(''), 'utf-8');

  const boolResult = run(NODE, ['validate-portals.mjs', '--file', boolPath]);
  if (boolResult !== null && boolResult.includes('0 errors')) {
    pass('validate-portals accepts location_filter.strict: true');
  } else {
    fail('validate-portals should accept a boolean location_filter.strict');
  }

  const stringResult = run(NODE, ['validate-portals.mjs', '--file', stringPath]);
  if (stringResult === null) {
    pass('validate-portals rejects a non-boolean location_filter.strict');
  } else {
    fail('validate-portals should reject location_filter.strict: "yes"');
  }

  const absentResult = run(NODE, ['validate-portals.mjs', '--file', absentPath]);
  if (absentResult !== null && absentResult.includes('0 errors')) {
    pass('validate-portals accepts a location_filter with no strict key');
  } else {
    fail('validate-portals should accept a location_filter that omits strict');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
