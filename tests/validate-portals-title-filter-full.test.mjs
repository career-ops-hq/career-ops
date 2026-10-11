// tests/validate-portals-title-filter-full.test.mjs — validate-portals rejects
// a misspelled `title_filter_full` field while keeping an explicitly empty
// positive list valid, and counts its keywords as by_title_keyword targets.
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

  // content_filter.by_title_keyword is scoped by whichever title list matched,
  // and scan-ats-full matches against title_filter_full. A key present only
  // there is live for the sweep and must not be reported as dead config; a key
  // in neither list still is.
  const fullOnlyKeyPath = join(tmp, 'by-title-keyword-full-only.yml');
  writeFileSync(fullOnlyKeyPath, `
title_filter:
  positive: ["Solidity"]
title_filter_full:
  positive: ["Solidity", "Forward Deployed"]
content_filter:
  by_title_keyword:
    "Forward Deployed":
      positive: ["blockchain"]
    "Forward Deplyed":
      positive: ["blockchain"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  const fullOnlyResult = run(NODE, ['validate-portals.mjs', '--file', fullOnlyKeyPath]);
  if (fullOnlyResult !== null && fullOnlyResult.includes('1 warning')
      && fullOnlyResult.includes('Forward Deplyed') && !/"Forward Deployed" does not match/.test(fullOnlyResult)) {
    pass('validate-portals accepts a by_title_keyword key found only in title_filter_full.positive');
  } else {
    fail('validate-portals should accept a by_title_keyword key found only in title_filter_full.positive and still warn on one found nowhere');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
