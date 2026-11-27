import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prescore, configuredThreshold, extractJdComp, scoreComp, profileFloor } from '../prescore.mjs';
import { extractJdSkillsByClass, extractJdSkills } from '../jd-skill-gap.mjs';

const profile = {
  target_roles: { primary: ['Backend Developer'] },
  pipeline: { prescore: { enabled: true } },
  compensation: { currency: 'USD', minimum: '$120k' },
};
const preamble = 'URL: https://example.invalid/opening\nCompany: Acme\nTitle: Backend Engineer\n\n';
const required = '## Requirements\n- Python\n- Docker\n- Kubernetes\n';
const evaluate = (jdText, selected = profile) => prescore({ jdText, cvText: 'Python', profile: selected });

for (const heading of ['Desired Qualifications', 'Desirable Qualifications']) {
  test(heading + ' contributes only preferred skills', () => {
    const jd = preamble + '## Requirements\n- Python\n\n## ' + heading + '\n- Redis\n- Docker\n- Kubernetes\n- Terraform\n- Ruby\n- PHP\n- Scala\n';
    const split = extractJdSkillsByClass(jd);
    assert.deepEqual(split.required, ['Python']);
    assert.equal(split.preferred.length, 7);
    assert.equal(extractJdSkills(jd).length, 8);
    assert.equal(evaluate(jd).verdict, 'proceed');
    assert.equal(evaluate(jd.replace(heading, 'Minimum Qualifications')).verdict, 'skip');
  });
}

for (const bullet of ['Rust is a plus', 'Rust preferred', 'Rust would be nice to have']) {
  test('suffix optionality applies to its own line: ' + bullet, () => {
    const jd = '## Requirements\n- Python\n- ' + bullet + '\n- Docker\n';
    assert.deepEqual(extractJdSkillsByClass(jd).required, ['Python', 'Docker']);
    assert.deepEqual(extractJdSkillsByClass(jd).preferred, ['Rust']);
    const bare = jd.replaceAll('- ', '');
    assert.deepEqual(extractJdSkillsByClass(bare).required, ['Python', 'Docker']);
    assert.deepEqual(extractJdSkillsByClass(bare).preferred, ['Rust']);
  });
}

test('negated optionality and explicit must-haves are not downgraded', () => {
  for (const line of ['Rust is not preferred', 'Rust is required, not just a plus', 'Rust is mandatory']) {
    const split = extractJdSkillsByClass('## Requirements\n- ' + line);
    assert.deepEqual(split.required, ['Rust']);
    assert.deepEqual(split.preferred, []);
  }
});

for (const salary of ['CAD $105k', '$105k CAD', 'AUD $105k', '$105k AUD', '$40k /mo', '$40k /month', '$40k /hr', 'from $105k', 'starting at $105k', 'at least $105k']) {
  test('uncertain annual USD maximum cannot suppress evaluation: ' + salary, () => {
    const result = evaluate(preamble + required + '\nSalary: ' + salary);
    assert.equal(result.signals.comp.unknown, true);
    assert.equal(result.verdict, 'proceed');
  });
}

test('a real closed USD band still supplies negative evidence', () => {
  for (const salary of ['USD 105k', '$105k USD', 'from $90k to $105k']) {
    const result = evaluate(preamble + required + '\nSalary: ' + salary);
    assert.equal(result.signals.comp.unknown, false);
    assert.equal(result.verdict, 'skip');
  }
  const cadFloor = profileFloor({ compensation: { currency: 'CAD', minimum: '120000' } });
  assert.equal(scoreComp(extractJdComp('Salary: CAD $105k'), cadFloor).score, 1);
});

for (const threshold of [[4.9], [], { toString: 'not callable' }, true]) {
  test('threshold rejects non-scalar numeric types: ' + JSON.stringify(threshold), () => {
    const selected = { ...profile, pipeline: { prescore: { enabled: true, gate_threshold: threshold } } };
    assert.equal(configuredThreshold(selected).valid, false);
    assert.equal(evaluate(preamble + required, selected).threshold, 3);
    assert.equal(evaluate(preamble + required, selected).verdict, 'proceed');
  });
}

test('a footer occupation is not reliable title evidence', () => {
  const jd = 'URL: https://example.invalid/opening\nCompany: Acme\n\n# Acme\n\n## Ingeniero Backend\n\n## Requisitos\n- Python\n- Docker\n- Kubernetes\n\n## Otras vacantes\n### Registered Nurse\n';
  const result = evaluate(jd);
  assert.equal(result.signals.title.unknown, true);
  assert.equal(result.signals.domain.unknown, true);
  assert.equal(result.verdict, 'proceed');
  const explicit = evaluate('Title: Registered Nurse\n' + jd);
  assert.equal(explicit.verdict, 'skip');
});

test('CLI leaves an audit row only for a real skip and warns on malformed thresholds', () => {
  const root = mkdtempSync(join(tmpdir(), 'prescore-input-contracts-'));
  const selected = join(root, 'config/profile.yml');
  const log = join(root, 'data/discard.log');
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'cv.md'), 'Python\n');
  const cli = (jdText, settings = profile) => {
    writeFileSync(selected, JSON.stringify(settings));
    return spawnSync(process.execPath, [fileURLToPath(new URL('../prescore.mjs', import.meta.url)), '-', '--log'], {
      input: jdText, encoding: 'utf8', timeout: 10000, windowsHide: true,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: selected },
    });
  };
  try {
    for (const salary of ['CAD $105k', '$105k CAD', 'from $105k', '$40k /mo']) {
      const r = cli(preamble + required + '\nSalary: ' + salary);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).verdict, 'proceed');
      assert.equal(existsSync(log), false);
    }
    for (const threshold of [[4.9], { toString: 'not callable' }]) {
      const r = cli(preamble + required, { ...profile, pipeline: { prescore: { enabled: true, gate_threshold: threshold } } });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).verdict, 'proceed');
      assert.match(r.stderr, /gate_threshold.*default 3/);
      assert.equal(existsSync(log), false);
    }
    const genuine = cli(preamble + required + '\nSalary: USD 105k');
    assert.equal(genuine.status, 0, genuine.stderr);
    assert.equal(JSON.parse(genuine.stdout).verdict, 'skip');
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});


for (const heading of ['Additional Desired Qualifications', 'Additional Desirable Qualifications']) {
  test('qualified optional heading: ' + heading, () => {
    const jd = preamble + '## Requirements\n- Python\n## ' + heading + '\n- Redis\n- Docker\n- Kubernetes\n- Terraform\n- Ruby\n- PHP\n- Scala\n';
    assert.deepEqual(extractJdSkillsByClass(jd).required, ['Python']);
    assert.equal(evaluate(jd).verdict, 'proceed');
    assert.equal(evaluate(jd.replace(heading, 'Additional Mandatory Qualifications')).verdict, 'skip');
  });
}

test('mixed desired and required heading is not promoted to a preferred section', () => {
  const jd = '## Requirements\n- Python\n## Desired and Required Qualifications\n- Rust\n';
  assert.deepEqual(extractJdSkillsByClass(jd).preferred, []);
});

for (const jd of [
  'Company: Acme\n\nIngeniero Backend\n\nRequirements: Python; Docker; Kubernetes\n\nRelated jobs:\nRegistered Nurse\n',
  'Company: Acme\n# Acme\n## Ingeniero Backend\n## Related jobs\n### Registered Nurse\n\n## Requirements\n- Python\n- Docker\n- Kubernetes\n',
]) {
  test('related occupation never supplies title evidence: ' + (jd.includes('#') ? 'markdown' : 'plain'), () => {
    assert.equal(evaluate(jd).signals.title.unknown, true);
    assert.equal(evaluate(jd).verdict, 'proceed');
    assert.equal(evaluate('Company: Acme\n# Acme\n## Registered Nurse\n' + required).verdict, 'skip');
  });
}

test('explicit alternatives cannot be scored as independent must-haves', () => {
  const jd = preamble + '## Requirements\n- Experience with one of Python, JavaScript, TypeScript, Java, Kotlin, Rust, or Scala.\n';
  assert.equal(extractJdSkills(jd).length, 7);
  assert.equal(evaluate(jd).signals.requirements.unknown, true);
  assert.equal(evaluate(jd).verdict, 'proceed');
  assert.equal(evaluate(jd.replace('one of', 'all of').replace(', or Scala', ', and Scala')).verdict, 'skip');
  const preferred = jd.replace('## Requirements', '## Preferred');
  assert.equal(extractJdSkillsByClass(preferred).hasAlternativeRequirements, false);
});

for (const suffix of ['\n+ Duties', '\nCAD experience preferred']) {
  test('salary context stays on the same line: ' + suffix.trim(), () => {
    const result = evaluate(preamble + required + '\nSalary: $105k' + suffix);
    assert.equal(result.signals.comp.unknown, false);
    assert.equal(result.verdict, 'skip');
  });
}
