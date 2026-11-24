import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyFacts } from '../verify-cv-facts.mjs';
import { buildHtml } from '../generate-cover-letter.mjs';

const CV = `## Experience

### Acme Corp — Remote
**Engineer**
2020 – Present

- Cut duplicate records 92%.
- Cut claim-form rendering 40%.

### Globex — Remote
**Engineer**
2018 – 2020

- Cut cloud spend 92%.
`;

function check(sentence, { sourceText = CV, config = {}, html = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cover-metric-context-'));
  try {
    const source = join(dir, 'cv.md'), configPath = join(dir, 'facts.json');
    writeFileSync(source, sourceText);
    writeFileSync(configPath, JSON.stringify(config));
    const target = html ? buildHtml({
      candidate: { name: 'Example Candidate' },
      letter: { role_title: 'Engineer', company: 'Initech',
        opening: 'I am applying for the Engineer role.', profile_intro: sentence },
    }) : sentence;
    return verifyFacts(target, { sourcePaths: [source], configPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const contexts = result => result.advisoryFacts.filter(f => f.kind === 'metric-context');

test('a rendered cover letter warns on a percentage borrowed from a different outcome', () => {
  const result = check('At Acme Corp, I cut claim-form rendering 92%.');
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.equal(contexts(result).length, 1);
  assert.match(contexts(result)[0].value, /92%/);
  assert.deepEqual(result.invented, []);
  assert.deepEqual(result.unsupportedFacts, []);
});

test('a metric supported only by another employer warns, even with identical outcome words', () => {
  const result = check('At Acme Corp, I cut cloud spend 92%.');
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.equal(contexts(result).length, 1);
});

test('source-backed cover prose still passes', () => {
  assert.equal(check('At Acme Corp, I cut duplicate records 92%.').verdict, 'pass');
  assert.equal(check('At Acme Corp, I cut claim-form rendering 40%.').verdict, 'pass');
});

test('plain-text cover prose uses the same advisory check', () => {
  const result = check('At Acme Corp, I cut claim-form rendering 92%.', { html: false });
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.equal(contexts(result).length, 1);
});

test('a short backed employer name resolves to its source record', () => {
  assert.equal(contexts(check('At Acme, I cut cloud spend 92%.')).length, 1);
  assert.equal(check('At Acme, I cut duplicate records 92%.').verdict, 'pass');
});

test('soft-wrapped source bullets still support truthful metric context', () => {
  const sourceText = CV.replace('- Cut duplicate records 92%.', '- Cut duplicate\n  records 92%.');
  assert.equal(check('At Acme Corp, I cut duplicate records 92%.', { sourceText }).verdict, 'pass');
});

test('allow_metrics preserves the existing metric-context waiver', () => {
  const result = check('At Acme Corp, I cut claim-form rendering 92%.', { config: { allow_metrics: ['92%'] } });
  assert.equal(result.verdict, 'pass', JSON.stringify(result));
});

test('allow_facts can waive the advisory value without changing metric support', () => {
  const sentence = 'At Acme Corp, I cut claim-form rendering 92%.';
  const finding = contexts(check(sentence))[0];
  assert.ok(finding);
  const result = check(sentence, { config: { allow_facts: [finding.value] } });
  assert.equal(result.verdict, 'pass', JSON.stringify(result));
});

test('an unsupported metric still blocks instead of becoming an advisory', () => {
  const result = check('At Acme Corp, I cut claim-form rendering 93%.');
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.invented, ['93%']);
  assert.deepEqual(contexts(result), []);
});

test('an unsupported employer still blocks through the named-fact gate', () => {
  const result = check('At Fabrikam, I cut claim-form rendering 92%.');
  assert.equal(result.verdict, 'block');
  assert.ok(result.unsupportedFacts.some(f => f.kind === 'employer' && f.value === 'fabrikam'));
});

test('addressed-company figures and future plans are not employment claims', () => {
  for (const sentence of [
    'Your team cut claim-form rendering 92%.',
    'At Acme Corp, your team cut claim-form rendering 92%.',
    'At Acme Corp, I would cut claim-form rendering 92%.',
    'At Acme Corp, I will cut claim-form rendering 92%.',
  ]) {
    const result = check(sentence);
    assert.equal(result.verdict, 'pass', `${sentence}: ${JSON.stringify(result)}`);
    assert.deepEqual(contexts(result), []);
  }
});

test('a later employer sentence is checked on its own', () => {
  const result = check('At Globex, I cut cloud spend 92%. At Acme Corp, I cut cloud spend 92%.');
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.equal(contexts(result).length, 1);
  assert.match(contexts(result)[0].value, /acme corp/);
});

test('two employers in one statement are left ambiguous rather than assigned a role', () => {
  const result = check('At Acme Corp and Globex, I cut cloud spend 92%.');
  assert.deepEqual(contexts(result), []);
});

test('unrecognized source employment formatting does not invent an association', () => {
  const result = check('At Acme Corp, I cut cloud spend 92%.', {
    sourceText: 'Acme Corp: Cut duplicate records 92%.',
  });
  assert.deepEqual(contexts(result), []);
});

test('context mismatch is advisory even when the source cannot prove a paraphrase', () => {
  const result = check('At Acme Corp, I lowered redundant entries 92%.');
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.deepEqual(result.unsupportedFacts, []);
  assert.deepEqual(result.invented, []);
});


test('the real cover CLI prints the advisory and still reaches the renderer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cover-metric-cli-'));
  try {
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'cv.md'), CV);
    writeFileSync(join(dir, 'config', 'cv-facts.json'), '{}');
    const payload = join(dir, 'payload.json');
    writeFileSync(payload, JSON.stringify({
      candidate: { name: 'Example Candidate' },
      letter: { role_title: 'Engineer', opening: 'I am applying for the Engineer role.',
        profile_intro: 'At Acme Corp, I cut claim-form rendering 92%.' },
      output_path: 'output/cover.pdf',
    }));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('CAREER_OPS_')) delete env[key];
    env.CAREER_OPS_ROOT = dir;
    const result = spawnSync(process.execPath, [
      '--import', new URL('./fixtures/cover-pdf-register.mjs', import.meta.url).href,
      fileURLToPath(new URL('../generate-cover-letter.mjs', import.meta.url)), '--payload', payload,
    ], { cwd: dir, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /CV fact check warning: cover letter/);
    assert.match(result.stderr, /metric-context.*92%/);
    assert.match(result.stdout, /Cover letter PDF/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('truthful references to different employers keep their own metric context', () => {
  const result = check('At Acme Corp, I cut duplicate records 92%. At Globex, I cut cloud spend 92%.');
  assert.equal(result.verdict, 'pass', JSON.stringify(result));
});

test('a sentence mixing prior employment and a future plan stays outside prose association', () => {
  const result = check('At Acme Corp, I led the team, and I will cut claim-form rendering 92%.');
  assert.equal(result.verdict, 'pass', JSON.stringify(result));
});

test('a structured job is not checked a second time as cover prose', () => {
  for (const tag of ['div', 'span']) {
    const result = check(`<${tag} class="job"><div class="job-company">Acme Corp</div>
      <ul><li>At Acme Corp, I cut cloud spend 92%.</li></ul></${tag}>`, { html: false });
    assert.equal(contexts(result).length, 1, JSON.stringify(result));
  }
});


test('soft-wrapped cover statements retain their employer and metric', () => {
  for (const html of [true, false]) {
    for (const newline of ['\n', '\r\n']) {
      const result = check(`At Acme Corp, I cut claim-form${newline}rendering 92%.`, { html });
      assert.equal(result.verdict, 'warn', JSON.stringify(result));
      assert.equal(contexts(result).length, 1);
      assert.equal(check(`At Acme Corp, I cut duplicate${newline}records 92%.`, { html }).verdict, 'pass');
    }
  }
});

test('an exact employer takes precedence over a longer employer sharing its name', () => {
  const sourceText = CV.replace('### Acme Corp', '### Acme').replace('### Globex', '### Acme Labs');
  assert.equal(check('At Acme, I cut duplicate records 92%.', { sourceText }).verdict, 'pass');
  const result = check('At Acme, I cut cloud spend 92%.', { sourceText });
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.equal(contexts(result).length, 1);
});

test('a shortened employer shared by multiple jobs is left ambiguous', () => {
  const sourceText = CV.replace('### Globex', '### Acme Labs');
  assert.deepEqual(contexts(check('At Acme, I cut claim-form rendering 92%.', { sourceText })), []);
});

const BOLD_CV = `## Experience

**Acme Corp** - Engineer
2020 - Present

- Cut duplicate records 92%.
- Cut claim-form rendering 40%.
`;
const NO_BLOCK = /no job entry in the source/;

test('an employer named only in a bold line is reported as not checked (#7577)', () => {
  for (const html of [true, false]) {
    const result = check('At Acme Corp, I cut claim-form rendering 92%.', { sourceText: BOLD_CV, html });
    assert.equal(result.verdict, 'warn', JSON.stringify(result));
    assert.match(result.coverage.message, NO_BLOCK);
    assert.deepEqual(contexts(result), []);
  }
});

test('a #### heading or an unrecognized section is reported the same way', () => {
  for (const sourceText of [CV.replace(/### /g, '#### '), CV.replace('## Experience', '## Career')]) {
    for (const html of [true, false]) {
      const result = check('At Acme Corp, I cut claim-form rendering 92%.', { sourceText, html });
      assert.equal(result.verdict, 'warn', JSON.stringify(result));
      assert.match(result.coverage.message, NO_BLOCK);
      assert.deepEqual(contexts(result), []);
    }
  }
});

test('no gap when the metric-context comparison would not have run', () => {
  const noMetric = check('At Acme Corp, I led the claims team.', { sourceText: BOLD_CV });
  assert.equal(noMetric.verdict, 'pass', JSON.stringify(noMetric));
  assert.equal(noMetric.coverage, null, JSON.stringify(noMetric));
  for (const config of [{ allow_metrics: ['92%'] }, { allow_facts: ['Acme Corp'] }]) {
    const result = check('At Acme Corp, I cut claim-form rendering 92%.', { sourceText: BOLD_CV, config });
    assert.ok(!result.coverage || !NO_BLOCK.test(result.coverage.message), JSON.stringify(result));
  }
});

test('a job block under ### still gets metric-context, not the gap', () => {
  const result = check('At Acme Corp, I cut claim-form rendering 92%.');
  assert.equal(contexts(result).length, 1);
  assert.ok(!(result.coverage && NO_BLOCK.test(result.coverage.message)), JSON.stringify(result));
});

test('the CLI prints the not-checked note for the issue\'s repro', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cover-metric-noblock-'));
  try {
    const cv = join(dir, 'cv.md'), cover = join(dir, 'cover.md'), facts = join(dir, 'facts.json');
    writeFileSync(cv, BOLD_CV);
    writeFileSync(cover, 'At Acme Corp, I cut claim-form rendering 92%.\n');
    writeFileSync(facts, '{}');
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../verify-cv-facts.mjs', import.meta.url)), cover, '--source', cv, '--config', facts,
    ], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /not checked:.*no job entry in the source/s);
    assert.doesNotMatch(result.stdout, /CV fact check passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a name the source mentions only inside another job\'s bullet gets the note, not a pass', () => {
  const sourceText = CV.replace('- Cut cloud spend 92%.', '- Cut cloud spend 92%.\n- Migrated Google Cloud workloads.');
  const result = check('At Google, I cut claim-form rendering 92%.', { sourceText });
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.match(result.coverage.message, NO_BLOCK);
  assert.deepEqual(result.invented, []);
  assert.deepEqual(result.unsupportedFacts, []);
});
