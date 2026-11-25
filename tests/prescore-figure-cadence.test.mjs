import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prescore, extractJdComp } from '../prescore.mjs';

const profile = { target_roles: { primary: ['AI Developer'] }, pipeline: { prescore: { enabled: true, gate_threshold: 3.5 } }, compensation: { currency: 'USD', minimum: '$120k' } };
const jd = (salary) => 'Title: AI Engineer\n## Requirements\n- Python\n- Docker\n- Kubernetes\n\n## Compensation\n' + salary;
const evaluate = (salary) => prescore({ jdText: jd(salary), cvText: 'Python', profile });
const details = '(depending on experience; location and ' + 'other factors '.repeat(30) + ')';
const salaries = [
  'Salary: $150k per year (depending on experience and location), plus a $200 per month stipend',
  'Salary: $150k ' + details + ' per year, plus a $200 per month stipend',
  'Salary: $140k-$160k ' + details + ' per year, plus $200 per month stipend',
  'annual salary $150k and monthly stipend $200',
  'Annual salary $150k and monthly equipment stipend $200',
  'Annual salary $150k and monthly home office stipend $200',
  '$200 monthly stipend and annual salary $150k',
  'monthly stipend $200 and annual salary $150k',
  '$150k annual salary and $200 monthly stipend',
  'Salary: $150k per year (monthly team breakfast included)',
  'Salary: USD $140k-$160k USD per year, plus USD $200 per month stipend',
  'Salary: 140k USD - 160k USD per year, plus 200 USD per month stipend',
  'Salary: $150k+ per year, plus $200 per month stipend',
];
for (const salary of salaries) {
  test('a separate monthly figure preserves annual positive evidence: ' + salary.slice(0, 110), () => {
    const result = evaluate(salary);
    assert.equal(result.signals.comp.score, 5, JSON.stringify(result.signals.comp));
    assert.equal(result.signals.comp.unknown, false);
    assert.equal(result.score, 3.6);
    assert.equal(result.verdict, 'proceed');
  });
}
for (const salary of [
  'Monthly salary $40k and annual equipment stipend $200',
  'Monthly salary $40k and annual home office stipend $200',
  'Salary: $40k (per month)',
  'Salary: $40k (monthly)',
  'Salary: $40k ' + details + ' per month',
  'Salary: $40k (including a $200 equipment allowance) per month',
  'Monthly salary: $40k ' + details,
  'Salary: USD $40k USD ' + details + ' per month',
  'Salary: 40k USD ' + details + ' per month',
]) {
  test('monthly salary stays incomparable across parentheticals and overlapping currency matches: ' + salary.slice(0, 110), () => {
    const result = evaluate(salary);
    assert.equal(result.signals.comp.unknown, true);
    assert.equal(result.verdict, 'skip'); // 3.4: a positive annual salary would change this verdict.
    assert.ok(extractJdComp(salary).nonAnnual);
  });
}
test('cadence cannot cross a physical line or a top-level semicolon', () => {
  for (const suffix of ['\nMonthly team meeting', '; monthly team meeting', '\r\nMonthly team meeting']) {
    const result = evaluate('Salary: $150k' + suffix);
    assert.equal(result.signals.comp.score, 5);
    assert.equal(result.verdict, 'proceed');
  }
});
test('many same-line figures retain their own cadence', () => {
  const text = ('Salary $150k per year, stipend $200 per month; ').repeat(2000);
  const result = extractJdComp(text);
  assert.equal(result.annual.filter((figure) => figure.max === 150000).length, 2000);
  assert.ok(result.nonAnnual);
});
test('CLI preserves the real proceed decision and leaves discard bytes unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'prescore-figure-cadence-'));
  const selected = join(root, 'config', 'profile.yml');
  const log = join(root, 'data', 'discard.log');
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'data'));
  writeFileSync(selected, JSON.stringify(profile));
  writeFileSync(join(root, 'cv.md'), 'Python\n');
  const original = Buffer.from('2026-01-01\thttps://example.invalid/prior\tprior reason\n');
  writeFileSync(log, original);
  const cli = (salary) => spawnSync(process.execPath, [fileURLToPath(new URL('../prescore.mjs', import.meta.url)), '-', '--log', '--url', 'https://example.invalid/figure-cadence'], {
    input: jd(salary), encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: selected },
  });
  try {
    for (const salary of [salaries[0], salaries[2], salaries[3], salaries[4], salaries[5], salaries[6]]) {
      const child = cli(salary);
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.signals.comp.score, 5);
      assert.equal(result.verdict, 'proceed');
      assert.equal(result.discardLogged, false);
      assert.deepEqual(readFileSync(log), original);
    }
    const skipped = cli('Salary: $40k per year');
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.equal(JSON.parse(skipped.stdout).verdict, 'skip');
    assert.equal(JSON.parse(skipped.stdout).discardLogged, true);
    assert.equal(readFileSync(log, 'utf8').trimEnd().split('\n').length, 2);
  } finally {
    rmSync(root, {recursive:true, force:true, maxRetries:5});
  }
});
