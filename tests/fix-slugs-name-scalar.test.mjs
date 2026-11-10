/**
 * tests/fix-slugs-name-scalar.test.mjs — fix-slugs must find a company block by
 * the name the YAML parser reads, not by the raw text after `name:`.
 *
 * verify-portals reports each company under its parsed name. A block keyed by
 * the raw line (`"Foo Bar"` with its quotes, `Foo Bar   # London` with its
 * comment) never matched, so --fix dropped the entry without a word and the run
 * ended "No resolvable slug fixes found" for a board verify-portals had just
 * flagged with a replacement.
 */

import * as yaml from 'js-yaml';
import { splitCompanyBlocks, computeFixes } from '../fix-slugs.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nfix-slugs.mjs — company names written with quotes or a trailing comment');

const SHAPES = [
  ['plain', '  - name: Foo Bar'],
  ['double-quoted', '  - name: "Foo Bar"'],
  ['single-quoted', "  - name: 'Foo Bar'"],
  ['trailing comment', '  - name: Foo Bar   # fintech, Berlin'],
  ['quoted with trailing comment', '  - name: "Foo Bar"   # fintech, Berlin'],
];

for (const [label, nameLine] of SHAPES) {
  const text = [
    'tracked_companies:',
    nameLine,
    '    careers_url: https://job-boards.greenhouse.io/foobar',
    '    enabled: true',
    '',
  ].join('\n');
  const results = [{ name: 'Foo Bar', status: 'missing', ats: 'greenhouse', suggested: { ats: 'lever', slug: 'foobar' } }];
  const { text: fixed, fixes } = computeFixes(text, results, { dateStr: '2026-10-12' });
  let parsed = null;
  try { parsed = yaml.load(fixed).tracked_companies[0]; } catch { /* reported below */ }
  if (fixes.length === 1 && parsed?.name === 'Foo Bar' && parsed.careers_url === 'https://jobs.lever.co/foobar') {
    pass(`a ${label} name is found and its board is rewritten`);
  } else {
    fail(`a ${label} name was not fixed: ${fixes.length} fix(es), parsed ${JSON.stringify(parsed)}`);
  }
}

// A quoted name containing a colon and an escaped quote reads the same way
// the YAML parser reads it.
{
  const text = 'tracked_companies:\n  - name: "Acme: \\"Labs\\""\n    careers_url: https://jobs.lever.co/acme\n';
  const { blocks } = splitCompanyBlocks(text);
  const expected = yaml.load(text).tracked_companies[0].name;
  if (blocks.length === 1 && blocks[0].name === expected) pass('an escaped double-quoted name matches the parser');
  else fail(`block name ${JSON.stringify(blocks[0]?.name)} != parser ${JSON.stringify(expected)}`);
}
