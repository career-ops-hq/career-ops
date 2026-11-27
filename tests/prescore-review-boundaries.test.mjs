import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prescore, extractJdComp, scoreComp, profileFloor, resolveThreshold, DEFAULT_THRESHOLD, discardLogLine } from '../prescore.mjs';

const profile = { target_roles: { primary: ['Backend Developer'] }, pipeline: { prescore: { enabled: true } }, compensation: { currency: 'USD', minimum: '$120k' } };
const required = '## Requirements\n- Python\n- Docker\n- Kubernetes\n';
const evaluate = (jdText, selected = profile, threshold = null) => prescore({ jdText, cvText: 'Python', profile: selected, threshold });
const compScore = (text, currency = 'USD', minimum = '120000') => scoreComp(extractJdComp(text), profileFloor({ compensation: { currency, minimum } }));

test('related-jobs heading ends the opening title evidence window', () => {
  const jd = '# Ingénieur backend\n## Related jobs: Registered Nurse\n' + required;
  const result = evaluate(jd);
  assert.equal(result.signals.title.unknown, true);
  assert.equal(result.signals.domain.unknown, true);
  assert.equal(result.verdict, 'proceed');
  assert.equal(evaluate('# Acme\n## Registered Nurse\n' + required).verdict, 'skip');
});

test('allowance clauses do not become must-have currency skills', () => {
  const jd = 'Title: Backend Developer\n## Requirements\n- Python experience; training budget EUR 15000\n- Python experience; stipend USD 15000\n- Python experience; relocation bonus CAD 15000\n';
  const result = evaluate(jd, profile, 4);
  assert.match(result.signals.requirements.evidence, /1 of 1 must-have/);
  assert.equal(result.verdict, 'proceed');
  assert.match(evaluate('Title: Backend Developer\n## Requirements\n- Python experience; CAD experience').signals.requirements.evidence, /1 of 2 must-have/);
});

for (const cadence of ['al mes', 'por mes', 'mensual', 'par mois', 'mensuel', 'pro Monat', 'monatlich', '/mes', '/mois', '/Monat']) {
  test('localized non-annual salary is not compared as annual: ' + cadence, () => {
    assert.equal(compScore('Salario: 40 000 EUR ' + cadence, 'EUR').unknown, true);
    assert.equal(compScore('Salario: 40 000 EUR al año', 'EUR').score, 1);
  });
}

test('bounded compensation context preserves repeated figures and line boundaries', () => {
  const values = extractJdComp('Salary: $105k; '.repeat(2000)).annual;
  assert.equal(values.length, 2000);
  assert.ok(values.every((value) => value.currency === 'USD' && value.max === 105000 && !value.open));
  for (const suffix of ['\n+ Duties', '\nCAD experience preferred']) {
    assert.equal(compScore('Salary: $105k' + suffix).score, 1);
  }
});

test('LPA lower bounds stay open, closed LPA ranges stay comparable', () => {
  for (const salary of ['CTC 12 LPA+', 'CTC from 12 LPA', 'CTC at least 12 LPA']) {
    assert.equal(compScore(salary, 'INR', '18 LPA').unknown, true, salary);
  }
  assert.equal(compScore('CTC 10-12 LPA', 'INR', '18 LPA').score, 1);
  assert.equal(compScore('CTC 20 LPA+', 'INR', '18 LPA').score, 5);
});

for (const uncertain of ['Location A: $90k+', 'Location A: $10k+', 'Location A: CAD $105k', 'Location A: $40k per month']) {
  test('a second closed band cannot turn an incomparable alternative into a maximum: ' + uncertain, () => {
    assert.equal(compScore(uncertain + '\nLocation B: $105k').unknown, true);
    assert.equal(compScore(uncertain + '\nLocation B: $150k').score, 5);
    assert.equal(compScore('Location A: $90k\nLocation B: $105k').score, 1);
  });
}

test('API threshold bounds match the configured contract and warn on invalid overrides', () => {
  for (const threshold of [-1, 6, Infinity, NaN]) {
    const result = evaluate('Title: Backend Developer\n' + required, profile, threshold);
    assert.equal(result.threshold, DEFAULT_THRESHOLD);
    assert.match(result.warnings.join(' '), /threshold/);
  }
  assert.equal(resolveThreshold(profile, 0), 0);
  assert.equal(resolveThreshold(profile, 5), 5);
  assert.equal(resolveThreshold({ pipeline: { prescore: { gate_threshold: 4 } } }, 6), 4);
});

test('signal exceptions force proceed even when other signals would skip', () => {
  const jd = 'Title: Registered Nurse\n' + required;
  const malformed = { ...profile, compensation: { currency: 'USD', minimum: { toString: 'not callable' } } };
  const result = evaluate(jd, malformed);
  assert.equal(result.verdict, 'proceed');
  assert.equal(result.override, 'signal-failed');
  assert.equal(result.signals.comp.unknown, true);
  assert.match(result.warnings.join(' '), /comp/);
  assert.equal(evaluate(jd, { ...profile, compensation: {} }).verdict, 'skip');
});

test('discard rows preserve URL identity while retaining exactly three fields', () => {
  const url = 'https://example.invalid/jobs/a—b?role=c–d';
  assert.equal(discardLogLine('now', url, 'reason — detail').split('\t')[1], url);
  const row = discardLogLine('now', url + '\t\nextra', 'reason\t\nmore');
  assert.equal(row.trimEnd().split('\t').length, 3);
  assert.equal(row.trimEnd().split('\n').length, 1);
});

test('CLI fail-open leaves an existing discard log byte-for-byte unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'prescore-signal-failure-'));
  const selected = join(root, 'config/profile.yml');
  const log = join(root, 'data/discard.log');
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'cv.md'), 'Python\n');
  const original = Buffer.from('2026-01-01\thttps://example.invalid/prior\tprior reason\n');
  writeFileSync(log, original);
  const cli = (settings, jd) => {
    writeFileSync(selected, JSON.stringify(settings));
    return spawnSync(process.execPath, [fileURLToPath(new URL('../prescore.mjs', import.meta.url)), '-', '--log'], {
      input: jd, encoding: 'utf8', timeout: 10000, windowsHide: true,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: selected },
    });
  };
  try {
    const jd = 'URL: https://example.invalid/jobs/a—b\nTitle: Registered Nurse\n' + required;
    const failed = cli({ ...profile, compensation: { minimum: { toString: 'not callable' } } }, jd);
    assert.equal(failed.status, 0, failed.stderr);
    const result = JSON.parse(failed.stdout);
    assert.equal(result.verdict, 'proceed');
    assert.equal(result.discardLogged, false);
    assert.match(failed.stderr, /comp.*Proceeding/);
    assert.deepEqual(readFileSync(log), original);
    const cadence = cli(profile, 'Title: Backend Engineer\n' + required + '\n## Compensation\nSalary: $40k (depending on experience and location) per month');
    assert.equal(cadence.status, 0, cadence.stderr);
    assert.equal(JSON.parse(cadence.stdout).verdict, 'proceed');
    assert.equal(JSON.parse(cadence.stdout).discardLogged, false);
    assert.deepEqual(readFileSync(log), original);
    const alternative = cli(profile, 'Title: Backend Engineer\n' + required + '\n## Compensation\nLocation A: $10k+\nLocation B: $105k');
    assert.equal(alternative.status, 0, alternative.stderr);
    assert.equal(JSON.parse(alternative.stdout).verdict, 'proceed');
    assert.equal(JSON.parse(alternative.stdout).discardLogged, false);
    assert.deepEqual(readFileSync(log), original);
    const skipped = cli(profile, jd);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.equal(JSON.parse(skipped.stdout).verdict, 'skip');
    assert.equal(readFileSync(log, 'utf8').trimEnd().split('\n').length, 2);
    assert.equal(readFileSync(log, 'utf8').trimEnd().split('\n')[1].split('\t')[1], 'https://example.invalid/jobs/a—b');
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

for (const cadence of ['per month', 'per hour', 'per week', 'al mes', 'par mois', 'pro Monat']) {
  test('salary cadence survives an intervening parenthetical: ' + cadence, () => {
    const salary = '$40k (depending on experience and location) ' + cadence;
    assert.equal(compScore('Salary: ' + salary).unknown, true);
    const jd = 'Title: Backend Engineer\n' + required + '\n## Compensation\nSalary: ' + salary;
    assert.equal(evaluate(jd).verdict, 'proceed');
    assert.equal(evaluate(jd.replace(cadence, 'per year')).verdict, 'skip');
  });
}

test('cadence lookup respects line and clause boundaries without truncating parentheses', () => {
  assert.equal(compScore('Salary: $40k (depending on experience; location and other factors) per month').unknown, true);
  assert.equal(compScore('Salary: $40k (depending on experience and location) per year; monthly team meeting').score, 1);
  assert.equal(compScore('Salary: $40k (depending on experience and location)\nMonthly team meeting').score, 1);
  const result = extractJdComp('Salary: $105k; '.repeat(2000) + 'Salary: $40k (' + 'details '.repeat(200) + ') per month');
  assert.equal(result.annual.length, 2000);
  assert.ok(result.nonAnnual);
});

for (const allowanceLine of ['housing allowance EUR 500', '- Python experience; housing allowance EUR 500']) {
  test('housing allowance stays out of must-have coverage: ' + allowanceLine, () => {
    const jd = 'Title: Backend Developer\n## Requirements\n- Python experience\n' + allowanceLine + '\n- CAD experience\n';
    const result = prescore({ jdText: jd, cvText: 'Python CAD', profile, threshold: 4.5 });
    assert.match(result.signals.requirements.evidence, /2 of 2 must-have/);
    assert.equal(result.signals.requirements.score, 5);
    assert.equal(result.verdict, 'proceed');
    const withoutCad = prescore({ jdText: jd, cvText: 'Python', profile, threshold: 4.5 });
    assert.match(withoutCad.signals.requirements.evidence, /1 of 2 must-have/);
  });
}

test('preferred technical heading keeps optional skills out of the prescore gate', () => {
  for (const newline of ['\n', '\r\n']) {
    const jd = ['Title: Backend Developer', '## Requirements', '- Python', '## Preferred technical skills:', '- Rust', '- Docker'].join(newline);
    const result = evaluate(jd, profile, 4.5);
    assert.equal(result.score, 4.8);
    assert.equal(result.verdict, 'proceed');
    assert.match(result.signals.requirements.evidence, /1 of 1 must-have/);
    assert.equal(DEFAULT_THRESHOLD, 3.0);
  }
});

test('CLI preferred technical heading proceeds at the requested threshold', () => {
  const root = mkdtempSync(join(tmpdir(), 'prescore-heading-'));
  const selected = join(root, 'config/profile.yml');
  mkdirSync(join(root, 'config'));
  writeFileSync(selected, JSON.stringify(profile));
  writeFileSync(join(root, 'cv.md'), 'Python\n');
  try {
    for (const newline of ['\n', '\r\n']) {
      const input = ['Title: Backend Developer', '## Requirements', '- Python', '## Preferred technical skills:', '- Rust', '- Docker'].join(newline);
      const child = spawnSync(process.execPath, [fileURLToPath(new URL('../prescore.mjs', import.meta.url)), '-', '--threshold', '4.5'], {
        input, encoding: 'utf8', timeout: 10000, windowsHide: true,
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: selected },
      });
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.score, 4.8);
      assert.equal(result.verdict, 'proceed');
      assert.equal(result.threshold, 4.5);
      assert.match(result.signals.requirements.evidence, /1 of 1 must-have/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
