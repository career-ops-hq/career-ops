import { test } from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseEfellowsPage } from '../../providers/efellows.mjs';
import { boardTests } from './_scout-test-kit.mjs';
import { nextPage, jobiqoRow } from './_scout-fixtures.mjs';

boardTests(provider, { fixture: nextPage([jobiqoRow(), null, {}, { ...jobiqoRow(102), organization: '' }]), empty: nextPage([]), broken: ['', nextPage(null), '<script id="__NEXT_DATA__">{}</script>'], full: nextPage([jobiqoRow(), ...Array(9).fill(null)]), delayMs: 10000 });
test('e-fellows: source-provided HTML destination preferred; no employer inferred from filename', () => {
  const rows = [{ ...jobiqoRow(), linkUrl: 'https://employer.example/role.html' }, { ...jobiqoRow(102), organization: '', linkUrl: 'https://employer.example/role2.html' }];
  const jobs = parseEfellowsPage(nextPage(rows)).jobs;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, 'https://employer.example/role.html');
});
