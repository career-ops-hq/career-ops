// tests/validate-portals-title-filter-full.test.mjs — validate-portals rejects
// a misspelled `title_filter_full` field while keeping an explicitly empty
// positive list valid.
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, NODE } from './helpers.mjs';

console.log('\nvalidate-portals — title_filter_full field names');

const tmp = mkdtempSync(join(tmpdir(), 'co-tff-'));

try {
  // A misspelled field is the dangerous case, not a missing one: the typo
  // leaves `positive` undefined, buildTitleFilter reads an empty positive list
  // as "no positive constraint", and scan-ats-full then matches every title on
  // every board it sweeps — the precise failure the key exists to prevent,
  // arriving silently.
  const typoPath = join(tmp, 'typo-title-filter-full.yml');
  writeFileSync(typoPath, `
title_filter:
  positive: ["AI Engineer"]
title_filter_full:
  positve: ["Solana"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  // An explicitly empty positive list is a deliberate choice, not a typo, and
  // must stay valid — only UNKNOWN fields are rejected.
  const emptyPath = join(tmp, 'empty-title-filter-full.yml');
  writeFileSync(emptyPath, `
title_filter:
  positive: ["AI Engineer"]
title_filter_full:
  positive: []
  negative: ["intern"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  const typoResult = run(NODE, ['validate-portals.mjs', '--file', typoPath]);
  if (typoResult === null) pass('validate-portals rejects a misspelled title_filter_full field');
  else fail('validate-portals should reject a misspelled title_filter_full field');

  const emptyResult = run(NODE, ['validate-portals.mjs', '--file', emptyPath]);
  if (emptyResult !== null && emptyResult.includes('0 errors')) {
    pass('validate-portals accepts an explicitly empty title_filter_full.positive');
  } else {
    fail('validate-portals should accept an explicitly empty title_filter_full.positive');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
