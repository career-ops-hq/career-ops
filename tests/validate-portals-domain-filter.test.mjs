// tests/validate-portals-domain-filter.test.mjs — validate-portals checks the
// shape of the opt-in `domain_filter` list (#3105).
//
// The reason to validate a key whose failure direction is SAFE: a malformed
// domain_filter builds no gate, which is exactly the pre-#3105 behaviour and
// loses nothing. But the user is then sweeping unguarded while believing the
// opposite, and scan-ats-full cannot warn them — an absent domain_filter is a
// legitimate configuration it has to stay silent about. This is the only place
// the typo can surface.
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, rmSync, NODE } from './helpers.mjs';

console.log('\nvalidate-portals — domain_filter shape');

const tmp = mkdtempSync(join(tmpdir(), 'co-df-'));

const TRAILER = `
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`;

const write = (name, body) => {
  const file = join(tmp, name);
  writeFileSync(file, body + TRAILER, 'utf-8');
  return file;
};

try {
  // A bare string is the plausible typo — `domain_filter: solana` reads fine in
  // YAML and yields a string, which normalizes to no keywords and no gate.
  const scalar = write('scalar.yml', `
title_filter:
  positive: ["AI Engineer"]
domain_filter: "solana"
`);

  // A non-string entry (a bare `web3` unquoted is fine, but a stray number or a
  // nested list is not) must be named by index rather than silently dropped.
  const badEntry = write('bad-entry.yml', `
title_filter:
  positive: ["AI Engineer"]
domain_filter:
  - "solana"
  - 42
  - ""
`);

  const valid = write('valid.yml', `
title_filter:
  positive: ["AI Engineer"]
domain_filter:
  - "solana"
  - "stem:smart contract"
  - "word:rwa"
`);

  // Absent is the state of every portals.yml written before the feature, and
  // must stay valid without a warning: it is the opt-out, not an omission.
  const absent = write('absent.yml', `
title_filter:
  positive: ["AI Engineer"]
`);

  if (run(NODE, ['validate-portals.mjs', '--file', scalar]) === null) pass('validate-portals rejects a scalar domain_filter');
  else fail('validate-portals should reject a scalar domain_filter');

  if (run(NODE, ['validate-portals.mjs', '--file', badEntry]) === null) pass('validate-portals rejects a non-string / empty domain_filter entry');
  else fail('validate-portals should reject a non-string / empty domain_filter entry');

  const validOut = run(NODE, ['validate-portals.mjs', '--file', valid]);
  if (validOut !== null && validOut.includes('0 errors')) pass('validate-portals accepts a prefixed domain_filter list');
  else fail('validate-portals should accept a prefixed domain_filter list');

  const absentOut = run(NODE, ['validate-portals.mjs', '--file', absent]);
  if (absentOut !== null && absentOut.includes('0 errors')) pass('an absent domain_filter stays valid — the gate is opt-in');
  else fail('an absent domain_filter must stay valid');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
