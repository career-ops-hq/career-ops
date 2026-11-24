import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProviders, resolveProvider } from '../providers/_registry.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('a Workable careers URL resolves to the workable provider', async () => {
  const providers = await loadProviders(join(ROOT, 'providers'));
  const match = resolveProvider(
    { name: 'Acme', careers_url: 'https://apply.workable.com/acme' },
    providers,
  );
  assert.equal(match?.provider?.id, 'workable');
});

test('the scan mode does not tell the agent to ignore every other provider', () => {
  const scan = readFileSync(join(ROOT, 'modes/scan.md'), 'utf8');
  const opening = scan.slice(0, scan.indexOf('## Recommended Execution'));
  assert.match(opening, /providers\//);
  assert.match(opening, /no provider matched/);
  assert.doesNotMatch(opening, /Greenhouse, Ashby, and Lever APIs/);
  assert.doesNotMatch(opening, /will ignore it/);

  const level0 = scan.split('\n').find((line) => line.includes('Recommended Level 0'));
  assert.ok(level0, 'Recommended Level 0 sentence missing');
  assert.match(level0, /does not name them/);
  assert.match(level0, /local parser failed/);
  assert.match(level0, /Level 1 \(Playwright\)/);
  assert.match(level0, /Level 3 general queries stay on/);
  assert.match(level0, /fetch threw/);
  assert.match(level0, /errors list/);
  assert.match(level0, /Report the error/);
  assert.match(level0, /without a working fallback/);
  assert.match(level0, /No provider matched these entries/);
  assert.match(level0, /used API fallback/);
  assert.match(level0, /Network errors/);
  assert.match(level0, /unreachable \(slug\?\)/);
  assert.match(level0, /FIX NEEDED/);
  assert.match(level0, /returned zero jobs without a successful HTTP response/);
  assert.match(level0, /only PARTLY read/);
  assert.match(level0, /returned without some job descriptions/);
  assert.match(level0, /descriptions omitted/);
  assert.match(scan, /add those jobs to candidates/);
  assert.match(scan, /name not listed in `local_parser_ok`/);
  assert.match(scan, /run Level 0 by hand/);
  assert.doesNotMatch(level0, /Level 1 \(Playwright\) or Level 3 \(WebSearch\)/);
  assert.doesNotMatch(level0, /local-parser` successfully/);
});
