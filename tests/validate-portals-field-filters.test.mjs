// tests/validate-portals-field-filters.test.mjs — #3438. `field_filters` and
// `filter_on` get the same structural checks title_filter_full gets, for the
// same reason: an unvalidated whitelist key fails silently, and this feature
// exists precisely to stop a whitelist from failing silently.
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, NODE } from './helpers.mjs';

console.log('\nvalidate-portals — field_filters / filter_on');

const tmp = mkdtempSync(join(tmpdir(), 'co-ff-'));
const write = (name, body) => {
  const p = join(tmp, name);
  writeFileSync(p, body, 'utf-8');
  return p;
};
const VALID = `
field_filters:
  noc:
    positive: ["stem:22", "stem:13"]
job_boards:
  - name: "Job Bank — help desk"
    careers_url: "https://www.jobbank.gc.ca/jobsearch/jobsearch"
    filter_on: noc
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`;

try {
  // The whole config, well formed.
  {
    const res = run(NODE, ['validate-portals.mjs', '--file', write('valid.yml', VALID)]);
    if (res !== null && res.includes('0 errors')) pass('a well-formed field_filters + filter_on config validates clean');
    else fail(`expected a clean run, got ${res}`);
  }

  // A portals.yml that says nothing about either key — every existing one.
  {
    const res = run(NODE, ['validate-portals.mjs', '--file', write('silent.yml', `
title_filter:
  positive: ["help desk"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`)]);
    if (res !== null && res.includes('0 errors')) pass('a config with neither key is unaffected');
    else fail(`expected a clean run, got ${res}`);
  }

  // The dangerous typo: `positve` leaves positive undefined, an empty positive
  // list reads as "no positive constraint", and the whitelist then matches
  // everything while looking configured.
  {
    const res = run(NODE, ['validate-portals.mjs', '--file', write('typo.yml', `
field_filters:
  noc:
    positve: ["stem:22"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`)]);
    if (res === null) pass('a misspelled field_filters field is rejected');
    else fail('expected rejection of a misspelled field_filters field');
  }

  // filter_on naming a block that does not exist. scan.mjs also exits on this
  // at startup; catching it here means the user never gets that far.
  {
    const res = run(NODE, ['validate-portals.mjs', '--file', write('missing-block.yml', `
field_filters:
  noc:
    positive: ["stem:22"]
job_boards:
  - name: "Board"
    careers_url: "https://example.com"
    filter_on: typo
tracked_companies: []
`)]);
    if (res === null) pass('filter_on without its field_filters block is rejected');
    else fail('expected rejection of a filter_on with no block');
  }

  // field_filters.title would be silently ignored: title routes to the
  // top-level title_filter by definition. Say so rather than ignore it.
  {
    const res = run(NODE, ['validate-portals.mjs', '--file', write('title-block.yml', `
field_filters:
  title:
    positive: ["help desk"]
tracked_companies: []
`)]);
    if (res === null) pass('field_filters.title is rejected, not silently ignored');
    else fail('expected rejection of a field_filters.title block');
  }

  // An explicitly empty positive list stays a deliberate choice, exactly as it
  // is for title_filter_full — only UNKNOWN fields are errors.
  {
    const res = run(NODE, ['validate-portals.mjs', '--file', write('empty.yml', `
field_filters:
  noc:
    positive: []
    negative: ["stem:65"]
tracked_companies: []
`)]);
    if (res !== null && res.includes('0 errors')) pass('an explicitly empty field_filters positive list stays valid');
    else fail(`expected a clean run, got ${res}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
