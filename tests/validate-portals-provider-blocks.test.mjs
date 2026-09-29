// tests/validate-portals-provider-blocks.test.mjs — validate-portals warns when
// an amazon/ibm/phenom block is present but carries no filter the provider
// sends, since the scan then reads the provider's whole board. A populated
// block, an absent block and a disabled entry stay silent.
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, NODE } from './helpers.mjs';

console.log('\nvalidate-portals — provider config blocks');

const tmp = mkdtempSync(join(tmpdir(), 'co-vpb-'));

const entry = (name, provider, blockLines) => `
  - name: "${name}"
    provider: "${provider}"
    careers_url: "https://careers.example.com/${name.toLowerCase().replace(/\W+/g, '-')}"
${blockLines}`;

// Parses the "N errors, M warnings" summary exactly, so 19 never passes for 9.
function summarize(output) {
  const m = output?.match(/^(\d+) errors, (\d+) warnings$/m);
  if (!m) return null;
  const warnings = [...output.matchAll(/^warning: ([^:]+):/gm)].map((w) => w[1]);
  return { errors: Number(m[1]), warnings };
}

try {
  const emptyPath = join(tmp, 'empty.yml');
  writeFileSync(emptyPath, `
tracked_companies:${[
    entry('Null block', 'amazon', '    amazon:'),
    entry('Brace block', 'amazon', '    amazon: {}'),
    entry('Empty list block', 'amazon', '    amazon: []'),
    entry('Empty string block', 'amazon', '    amazon: ""'),
    entry('Bare scalar block', 'amazon', '    amazon: DEU'),
    entry('Empty facet', 'amazon', '    amazon:\n      normalized_country_code: []\n      base_query: ""'),
    entry('Sort only', 'amazon', '    amazon:\n      sort: recent'),
    entry('Ibm null block', 'ibm', '    ibm:'),
    entry('Ibm blank values', 'ibm', '    ibm:\n      country: " "\n      categories: [""]'),
    entry('Phenom brace block', 'phenom', '    phenom: {}'),
    entry('Phenom non-filter keys', 'phenom', '    phenom:\n      lang: en_global\n      country: global\n      selectedFields: { country: [] }'),
  ].join('')}
job_boards:${entry('Board null block', 'amazon', '    amazon:')}
`, 'utf-8');

  const filledPath = join(tmp, 'filled.yml');
  writeFileSync(filledPath, `
tracked_companies:${[
    entry('Amazon facet', 'amazon', '    amazon:\n      normalized_country_code: [DEU]'),
    entry('Amazon query', 'amazon', '    amazon:\n      base_query: backend'),
    entry('Ibm country', 'ibm', '    ibm:\n      country: Germany'),
    entry('Ibm categories', 'ibm', '    ibm:\n      categories: [Software Engineering]'),
    entry('Phenom facet', 'phenom', '    phenom:\n      selectedFields: { country: [Germany] }'),
    entry('Phenom country', 'phenom', '    phenom:\n      country: de'),
    entry('No block', 'amazon', ''),
  ].join('')}
  - name: "Disabled leftover"
    enabled: false
    provider: "amazon"
    amazon:
`, 'utf-8');

  const expected = [
    ...Array.from({ length: 7 }, (_, i) => `tracked_companies[${i}].amazon`),
    'tracked_companies[7].ibm',
    'tracked_companies[8].ibm',
    'tracked_companies[9].phenom',
    'tracked_companies[10].phenom',
    'job_boards[0].amazon',
  ];
  const empty = summarize(run(NODE, ['validate-portals.mjs', '--file', emptyPath]));
  if (empty && empty.errors === 0 && JSON.stringify(empty.warnings) === JSON.stringify(expected)) {
    pass('validate-portals warns on every provider config block that sets no filter');
  } else {
    fail(`validate-portals should warn exactly on ${expected.join(', ')}; got ${JSON.stringify(empty)}`);
  }

  const filled = summarize(run(NODE, ['validate-portals.mjs', '--file', filledPath]));
  if (filled && filled.errors === 0 && filled.warnings.length === 0) {
    pass('validate-portals stays silent on a filtering block, no block, and a disabled entry');
  } else {
    fail(`validate-portals should not warn on filtering, absent, or disabled provider blocks; got ${JSON.stringify(filled)}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
