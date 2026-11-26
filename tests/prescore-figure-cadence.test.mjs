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
const evaluate = (salary, threshold = null) => prescore({ jdText: jd(salary), cvText: 'Python', profile, threshold });
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
const wrapperCases = [
  ['Salary $40k excluding bonus and paid out pro rata in arrears per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and is paid in CAD by wire transfer in advance per month', 4, 3.4, 'proceed', 3],
  ['Salary $150k excluding bonus and paid by direct deposit. Staff training is held twice per month.', 5, 3.6, 'proceed', 3.5],
  ['Salary $40k excluding bonus and paid by bank transfer per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid by direct deposit per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid in USD per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid in full per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid to your bank account per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and is paid in USD per month', 4, 3.4, 'proceed', 3],
  ['Salary $150k excluding bonus and paid in-house training one day per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $40k excluding bonus and paid in arrears per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid in advance per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid gross per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid net per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid pro rata per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid out per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid via bank transfer per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid out in arrears per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus and paid via bank transfer in advance per month', 4, 3.4, 'proceed', 3],
  ['Salary $150k excluding bonus and paid on site training scheduled per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k excluding bonus and paid time off accrued at 2 days per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k excluding bonus and paid leave accrued per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k excluding bonus and paid training one day per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $40k excluding bonus per month, per year', 1, 2.8, 'skip', 3],
  ['Salary $150k excluding bonus per month, per year', 5, 3.6, 'proceed', 3.5],
  ['Salary $40k excluding bonus and paid per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k, excluding taxes, per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k excluding bonus paid weekly, per month', 4, 3.4, 'proceed', 3],
  ['Salary $150k excluding a bonus paid per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k without a bonus paid per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k excluding bonus paid weekly or per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k plus a stipend, excluding bonus, paid per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $40k, excluding bonus, per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k, without bonus, per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k, except bonus, per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k, excluding bonus and allowance, per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k, excluding bonus or allowance, per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k, excluding bonus, paid weekly or per month', 4, 3.4, 'proceed', 3],
  ['Salary $150k, excluding bonus, plus a stipend paid per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k excluding bonus plus a stipend paid per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k, excluding bonus, and a stipend paid per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k, a stipend paid per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k plus a stipend paid weekly or per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k plus a stipend paid per month', 5, 3.6, 'proceed', 3.5],
  ['Salary ($150k) plus a stipend paid per month', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k and an equipment allowance paid per month', 5, 3.6, 'proceed', 3.5],
  ['$40k gross and paid per month', 4, 3.4, 'proceed', 3],
  ['Salary $150k, excluding monthly equipment allowance', 5, 3.6, 'proceed', 3.5],
  ['Salary ($150k) and monthly on-call rotation', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k, monthly performance review', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k plus a monthly stipend', 5, 3.6, 'proceed', 3.5],
  ['Salary ($150k) plus a monthly stipend', 5, 3.6, 'proceed', 3.5],
  ['Monthly salary $40k and annual bonus', 4, 3.4, 'proceed', 3],
  ['Salary $40k (per month, depending on locale)', 4, 3.4, 'proceed', 3],
  ['Salary $40k ((per month, depending on locale))', 4, 3.4, 'proceed', 3],
  ['$40k monthly salary', 4, 3.4, 'proceed', 3],
  ['$40k, per month', 4, 3.4, 'proceed', 3],
  ['$40k, monthly salary', 4, 3.4, 'proceed', 3],
  ['Salary $40k ($200 annual equipment allowance included) per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k ($200 per year equipment allowance included) per month', 4, 3.4, 'proceed', 3],
  ['Salary ($150k) and monthly stipend ($200 for equipment)', 5, 3.6, 'proceed', 3.5],
  ['Salary ($150k) and stipend ($200 for equipment) per month', 5, 3.6, 'proceed', 3.5],
  ['Monthly salary ($40k depending on experience)', 4, 3.4, 'proceed', 3],
  ['Salary ($40k depending on experience) per month', 4, 3.4, 'proceed', 3],
  ['Monthly salary $40k, annual bonus ($200 per year)', 4, 3.4, 'proceed', 3],
  ['Salary ($40k (including a $200 annual equipment allowance)) per month', 4, 3.4, 'proceed', 3],
  ['Annual salary ($150k including a $200 monthly home office allowance)', 5, 3.6, 'proceed', 3.5],
  ['Salary ($150k) and monthly stipend ($200 per month)', 5, 3.6, 'proceed', 3.5],
  ['Salary $150k and monthly stipend ($200 per month)', 5, 3.6, 'proceed', 3.5],
  ['Salary ($150k) and monthly stipend of ($200 per month)', 5, 3.6, 'proceed', 3.5],
  ['Salary (($150k)) and monthly stipend (($200 per month))', 5, 3.6, 'proceed', 3.5],
  ['Salary ($150k) and ($200 per month) monthly stipend', 5, 3.6, 'proceed', 3.5],
  ['Monthly stipend ($200 per month) and annual salary ($150k)', 5, 3.6, 'proceed', 3.5],
  ['Monthly salary ($40k) and annual stipend ($200 per year)', 4, 3.4, 'proceed', 3],
  ['Salary ($40k) per month and annual stipend ($200 per year)', 4, 3.4, 'proceed', 3],
  ['Monthly salary ($40k per month) and annual stipend ($200)', 4, 3.4, 'proceed', 3],
  ['Monthly salary (($40k)) and annual stipend (($200 per year))', 4, 3.4, 'proceed', 3],
  ['Salary ($150k) and monthly stipend (monthly $200)', 5, 3.6, 'proceed', 3.5],
  ['Salary ($150k) and monthly stipend ((($200 per month)))', 5, 3.6, 'proceed', 3.5],
  ['Salary $40k (including a $200 monthly equipment allowance) per month', 4, 3.4, 'proceed', 3],
  ['Salary $40k (including an annual $200 equipment allowance) per month', 4, 3.4, 'proceed', 3],
  ['Annual salary $150k and monthly stipend of $200', 5, 3.6, 'proceed', 3.5],
  ['Annual salary of $150k and monthly stipend of $200', 5, 3.6, 'proceed', 3.5],
  ['Monthly stipend of $200 and annual salary of $150k', 5, 3.6, 'proceed', 3.5],
  ['$200 monthly stipend and annual salary of $150k', 5, 3.6, 'proceed', 3.5],
  ['Monthly salary of $40k and annual stipend of $200', 4, 3.4, 'proceed', 3],
  ['Monthly salary ($40k)', 4, 3.4, 'proceed', 3],
  ['Monthly salary (($40k))', 4, 3.4, 'proceed', 3],
  ['($40k) per month', 4, 3.4, 'proceed', 3],
  ['(($40k)) per month', 4, 3.4, 'proceed', 3],
  ['Annual salary ($150k)', 5, 3.6, 'proceed', 3.5],
  ['Annual salary (($150k)) and monthly stipend of ($200)', 5, 3.6, 'proceed', 3.5],
  ['Monthly salary ($40k per year)', 1, 2.8, 'skip', 3],
  ['Monthly salary (($40k per year))', 1, 2.8, 'skip', 3],
  ['Monthly salary ($150k per year)', 5, 3.6, 'proceed', 3.5],
  ['Salary $40k (including a $200 equipment allowance) per month', 4, 3.4, 'proceed', 3],
  ['Annual salary $150k (including a $200 monthly equipment allowance)', 5, 3.6, 'proceed', 3.5],
  ['Monthly salary ($40k) and annual equipment stipend of ($200)', 4, 3.4, 'proceed', 3],
];
for (const [salary, comp, score, verdict, threshold] of wrapperCases) {
  test('cadence labels and bare wrappers retain their owner: ' + salary, () => {
    const result = evaluate(salary, threshold);
    assert.equal(result.signals.comp.failed, undefined);
    assert.equal(result.signals.comp.score, comp);
    assert.equal(result.signals.comp.unknown, comp === 4);
    assert.equal(result.score, score);
    assert.equal(result.verdict, verdict);
  });
}
test('an explanatory annual allowance cannot steal the outer salary cadence', () => {
  for (const salary of [
    'Salary $40k ($200 annual equipment allowance included) per month',
    'Salary $40k ($200 per year equipment allowance included) per month',
    'Salary $40k (including a $200 equipment allowance) per month',
    'Salary ($40k (including a $200 annual equipment allowance)) per month',
  ]) {
    const result = extractJdComp(salary);
    assert.ok(result.nonAnnual, salary);
    assert.ok(result.annual.every((figure) => figure.max !== 40000), salary);
  }
});
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
  const cli = (salary, threshold = 3.5) => spawnSync(process.execPath, [fileURLToPath(new URL('../prescore.mjs', import.meta.url)), '-', '--log', '--url', 'https://example.invalid/figure-cadence', '--threshold', String(threshold)], {
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
    for (const [salary, comp, score, verdict, threshold] of wrapperCases) {
      writeFileSync(log, original);
      const child = cli(salary, threshold);
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.signals.comp.failed, undefined, salary);
      assert.equal(result.signals.comp.score, comp, salary);
      assert.equal(result.signals.comp.unknown, comp === 4, salary);
      assert.equal(result.score, score, salary);
      assert.equal(result.verdict, verdict, salary);
      assert.equal(result.discardLogged, verdict === 'skip', salary);
      if (verdict === 'proceed') assert.deepEqual(readFileSync(log), original, salary);
      else assert.equal(readFileSync(log, 'utf8').trimEnd().split('\n').length, 2, salary);
    }
    writeFileSync(log, original);
    const skipped = cli('Salary: $40k per year');
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.equal(JSON.parse(skipped.stdout).verdict, 'skip');
    assert.equal(JSON.parse(skipped.stdout).discardLogged, true);
    assert.equal(readFileSync(log, 'utf8').trimEnd().split('\n').length, 2);
  } finally {
    rmSync(root, {recursive:true, force:true, maxRetries:5});
  }
});
