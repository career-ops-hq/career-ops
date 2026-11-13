import { test } from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseKarriereAtPage } from '../../providers/karriere-at.mjs';
import { boardTests } from './_scout-test-kit.mjs';
import { karriereRow, karrierePage } from './_scout-fixtures.mjs';

boardTests(provider, { fixture: karrierePage([karriereRow(), null, {}]), empty: karrierePage([]), broken: [null, {}, 'bad', karrierePage(null)], full: karrierePage([karriereRow(), ...Array(14).fill(null)], true) });
test('karriere.at: not all activeItems are jobs; homeoffice is not full remote; hourly pay is not annual', () => {
  const rows = [karriereRow(), karriereRow('..'), { ...karriereRow('102'), jobsItem: { ...karriereRow('102').jobsItem, company: { name: 'Anonymous', isChiffre: true } } }, { disruptor: {} }, { jobsItem: { id: '103', title: 'Closed', isActive: false } }];
  const jobs = parseKarriereAtPage(karrierePage(rows)).jobs;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].location, 'Wien');
  assert.match(jobs[0].description, /Homeoffice possible/);
  assert.equal(jobs[0].salary, undefined);
});
