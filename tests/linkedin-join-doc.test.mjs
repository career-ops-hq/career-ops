// The sample output in docs/LINKEDIN_JOIN.md has to match what
// linkedin-join.mjs prints. The tool builds second-degree links at
// /search/results/people/ (linkedin-join.mjs). The guide used to show
// /search/people/, which is the old route.
//
// Run: node --test tests/linkedin-join-doc.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const doc = readFileSync(join(import.meta.dirname, '..', 'docs', 'LINKEDIN_JOIN.md'), 'utf8');
const urls = [...doc.matchAll(/https:\/\/www\.linkedin\.com\/search\/\S+/g)].map((m) => m[0]);

test('every people-search sample uses the results path the tool prints', () => {
  assert.ok(urls.length >= 5, `expected at least 5 sample search URLs, found ${urls.length}`);
  for (const url of urls) {
    assert.match(url, /\/search\/results\/people\/\?/);
  }
});
