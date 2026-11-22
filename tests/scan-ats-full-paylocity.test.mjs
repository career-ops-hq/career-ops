// tests/scan-ats-full-paylocity.test.mjs — how Paylocity dataset rows become
// board entries. Rows are { guid, name, jobs } objects, not slugs.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — Paylocity source');

const { SOURCES } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const GUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const BOARD = `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`;
const source = SOURCES.paylocity;

if (source?.provider?.id === 'paylocity') pass('paylocity source wired to the paylocity provider');
else fail(`SOURCES.paylocity.provider is ${JSON.stringify(source?.provider?.id)}`);

if (source?.dataset?.endsWith('/paylocity_companies_clean.json')) pass('paylocity source reads paylocity_companies_clean.json');
else fail(`SOURCES.paylocity.dataset is ${JSON.stringify(source?.dataset)}`);

// Paylocity throttles well below the other single-host directories.
if (source?.singleHost === true && source.concurrency > 0 && source.concurrency < SOURCES.greenhouse.concurrency) {
  pass(`paylocity source runs unscoped at a lower concurrency (${source.concurrency}) than greenhouse (${SOURCES.greenhouse.concurrency})`);
} else {
  fail(`paylocity concurrency=${source?.concurrency} singleHost=${source?.singleHost}, greenhouse concurrency=${SOURCES.greenhouse?.concurrency}`);
}

{
  const e = source.toEntry({ guid: GUID, name: 'ExampleCo', jobs: 3 });
  if (e?.careers_url === BOARD && e.name === 'ExampleCo') pass('a dataset row becomes the canonical board URL with the dataset name');
  else fail(`toEntry: ${JSON.stringify(e)}`);
  if (source.provider.detect(e)?.url === BOARD) pass('the synthetic entry is claimed by the provider detect()');
  else fail(`detect() on the synthetic entry: ${JSON.stringify(source.provider.detect(e))}`);
}

{
  const e = source.toEntry({ guid: GUID, name: 'ExampleCo', jobs: 0 });
  if (e?.careers_url === BOARD) pass('a row with jobs: 0 is still scanned (the dataset count is out of date)');
  else fail(`jobs: 0 row: ${JSON.stringify(e)}`);
}

{
  const e = source.toEntry({ guid: GUID.toUpperCase(), name: '  ExampleCo  ' });
  if (e?.careers_url === BOARD && e.name === 'ExampleCo') pass('GUID is lower-cased and the name trimmed; a missing jobs field is fine');
  else fail(`upper-case GUID row: ${JSON.stringify(e)}`);
}

{
  const e = source.toEntry({ guid: GUID, name: 'A &amp; B Widgets &#39;West&#39;' });
  if (e?.name === "A & B Widgets 'West'") pass('HTML entities in the dataset name are decoded');
  else fail(`entity-escaped name: ${JSON.stringify(e?.name)}`);
}

{
  const e = source.toEntry({ guid: GUID });
  if (e?.careers_url === BOARD && e.name === '') pass('a row without a name keeps an empty name (provider falls back to the board title)');
  else fail(`nameless row: ${JSON.stringify(e)}`);
}

for (const [label, row] of [
  ['a non-GUID id', { guid: 'not-a-guid', name: 'X' }],
  ['a path-injection id', { guid: `${GUID}/../../evil`, name: 'X' }],
  ['a missing guid', { name: 'X' }],
  ['a numeric guid', { guid: 42, name: 'X' }],
  ['a bare string row', GUID],
  ['null', null],
]) {
  let e;
  try {
    e = source.toEntry(row);
  } catch (err) {
    fail(`toEntry threw on ${label}: ${err.message}`);
    continue;
  }
  if (e === null) pass(`toEntry rejects ${label}`);
  else fail(`toEntry should reject ${label}, got ${JSON.stringify(e)}`);
}
