import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { buildLocationFilter, buildPostingAgeFilter } from '../scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
const step3 = agents.split('#### Step 3: Portals')[1]?.split('#### Step 4')[0] ?? '';
const block = step3.match(/```yaml\n([\s\S]*?)```/)?.[1];
const example = block ? load(block) : null;
const DAY = 24 * 60 * 60 * 1000;

test('Step 3 shows the filters setup should write', () => {
  assert.ok(example, 'Step 3 has no yaml example');
});

test('a country-only answer keeps that country and drops every other one', () => {
  const keep = buildLocationFilter(example.location_filter);
  for (const place of ['Austin, TX', 'Remote - United States', 'New York, NY, USA', 'United States']) {
    assert.equal(keep(place, '', 'Product Designer'), true, `dropped ${place}`);
  }
  for (const place of ['Paris, France', 'Berlin', 'Manila, Philippines', 'Kraków, Poland']) {
    assert.equal(keep(place, '', 'Product Designer'), false, `kept ${place}`);
  }
});

test('the posting age default drops a two-month-old posting and keeps a recent one', () => {
  const now = Date.UTC(2026, 0, 31);
  const fresh = buildPostingAgeFilter(example.max_posting_age_days, now);
  assert.equal(fresh(now - 65 * DAY), false);
  assert.equal(fresh(now - 10 * DAY), true);
});

test('setup extends the template negatives instead of replacing them', () => {
  assert.equal(example.title_filter?.negative, undefined);
  assert.match(step3, /title_filter\.negative/);
  assert.match(step3, /never replace/i);
});
