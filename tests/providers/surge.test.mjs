import { test } from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseSurgePage } from '../../providers/surge.mjs';
import { boardTests } from './_scout-test-kit.mjs';
import { surgeCard } from './_scout-fixtures.mjs';

boardTests(provider, { fixture: surgeCard(), empty: '<div class="w-dyn-empty">No openings</div>', broken: ['<a href="/careers/role">Unknown layout</a>'] });
test('Surge: real location labels only; malformed cards and duplicate links', () => {
  const jobs = parseSurgePage(surgeCard() + surgeCard() + surgeCard('no-title', '') + surgeCard('%2e%2e') + '<a href="https://evil.example/careers/x">Bad</a>');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].location, 'Remote');
  assert.equal(jobs[0].salary, undefined);
  assert.equal(parseSurgePage(surgeCard().replace('Remote', 'San Francisco'))[0].location, 'San Francisco');
  assert.equal(parseSurgePage(surgeCard().replace('class="job-remote"', 'class="absent"'))[0].location, '');
});
