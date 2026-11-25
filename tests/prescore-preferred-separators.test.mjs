import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as skillGap from '../jd-skill-gap.mjs';
const { extractJdSkills, extractJdSkillsByClass, diagnoseCoverage } = skillGap;
import { prescore, scoreRequirements } from '../prescore.mjs';

for (const separator of ['Bonus points:', '**Bonus points:**', '## Bonus points', 'Plus:', 'Nice to have:', '加分项', '【加分项】', '【加分條件】']) {
  test('preferred separator keeps optional skills out of coverage: ' + separator, () => {
    const jd = '## Requirements\n- Python\n\n' + separator + '\n- Rust\n- Scala\n\nBenefits:\n- Docker\n';
    const split = extractJdSkillsByClass(jd);
    assert.deepEqual(split.required, ['Python']);
    assert.deepEqual(split.preferred, ['Rust', 'Scala']);
    assert.equal(split.sawRequired, true);
    assert.equal(split.sawPreferred, true);
    assert.equal(scoreRequirements(jd, 'Python').score, 5);
    const result = prescore({ jdText: jd, cvText: 'Python', profile: {
      target_roles: { primary: ['Software Engineer'] },
      pipeline: { prescore: { enabled: true, gate_threshold: 4 } },
    } });
    assert.equal(result.verdict, 'proceed');
  });
}

test('inline preferred bullet does not reclassify the next required bullet', () => {
  const split = extractJdSkillsByClass('## Requirements\n- Nice to have: Rust\n- Python\n');
  assert.deepEqual(split.required, ['Python']);
  assert.deepEqual(split.preferred, ['Rust']);
});

test('a new requirements heading restores required classification, including overlap', () => {
  const split = extractJdSkillsByClass('## Requirements\n- Python\nBonus points:\n- Rust\n## Requirements\n- Rust\n');
  assert.deepEqual(split.required, ['Python', 'Rust']);
  assert.deepEqual(split.preferred, ['Rust']);
});

test('current inline and bare requirement extraction also populates classes', () => {
  const jd = 'Basic Qualifications (Python and Kubernetes)\nExperience with Terraform\nPreferred: Rust; Scala\nDocker\n';
  const split = extractJdSkillsByClass(jd);
  assert.deepEqual(split.required, ['Python', 'Kubernetes', 'Terraform']);
  assert.deepEqual(split.preferred, ['Rust', 'Scala', 'Docker']);
  assert.deepEqual(extractJdSkills(jd), [...split.required, ...split.preferred]);
});

test('preferred classification retains multi-word extraction and coverage diagnostics', () => {
  const jd = '## Requirements\n- Large Language Models\n- 熟悉奇異技術要求\nPreferred\n- Python\n';
  assert.deepEqual(extractJdSkillsByClass(jd).required, ['Large Language Models']);
  assert.ok(diagnoseCoverage(jd)?.unreadLines?.length > 0);
});


test('non-salary metadata cannot dilute coverage or change bare-line boundaries', () => {
  for (const line of ['Relocation bonus: 15.000 EUR', '15000 EUR signing bonus', 'Training budget: EUR 15000', 'Stipend: EUR 15000']) {
    assert.equal(scoreRequirements('## Requirements\n- Python\n- Docker\n- Kubernetes\n' + line, 'Python').score, 3);
    assert.equal(scoreRequirements('## Requirements\n\nPython\n' + line + '\nRust\n', 'Python').score, 4);
  }
});

test('currency-like skills remain requirements while allowance clauses are ignored by scoring', () => {
  const jd = '## Requirements\n- CAD experience\n- Working with AMD GPUs\n- Python experience; training budget EUR 15000\n';
  assert.deepEqual(extractJdSkillsByClass(jd).required, ['CAD', 'AMD', 'GPUs', 'Python', 'EUR']);
  const result = scoreRequirements(jd, 'Python');
  assert.equal(result.unknown, false);
  assert.match(result.evidence, /1 of 4 must-have/);
});

test('inline bonus skills remain preferred', () => {
  const split = extractJdSkillsByClass('## Requirements\n- Python\nBonus points: Rust, Scala\n');
  assert.deepEqual(split.required, ['Python']);
  assert.deepEqual(split.preferred, ['Rust', 'Scala']);
});


test('CLI honors CAREER_OPS_PROFILE and fails open on comment-only YAML', () => {
  const root = mkdtempSync(join(tmpdir(), 'prescore-profile-'));
  try {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config/profile.yml'), 'pipeline: {prescore: {enabled: false}}\n');
    writeFileSync(join(root, 'cv.md'), 'Python\n');
    writeFileSync(join(root, 'jd.md'), 'Title: Registered Nurse\n## Requirements\n- Nursing\n');
    const profile = join(root, 'selected.yml');
    const cli = () => spawnSync(process.execPath, [fileURLToPath(new URL('../prescore.mjs', import.meta.url)), join(root, 'jd.md')], {
      windowsHide: true, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: profile },
    });
    writeFileSync(profile, 'target_roles: {primary: [Software Engineer]}\npipeline: {prescore: {enabled: true}}\n');
    const enabled = cli();
    assert.equal(enabled.status, 0, enabled.stderr);
    assert.equal(JSON.parse(enabled.stdout).verdict, 'skip');
    writeFileSync(profile, '# No targeting configured yet\n');
    const empty = cli();
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(JSON.parse(empty.stdout).verdict, 'proceed');
    assert.equal(JSON.parse(empty.stdout).override, 'not-configured');
    assert.doesNotMatch(empty.stderr, /expected a document/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
