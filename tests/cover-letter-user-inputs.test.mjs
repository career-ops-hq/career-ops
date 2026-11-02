// The cover-letter fact gate used to read only cv.md and article-digest.md.
// A plan the candidate typed for this letter, such as reading the last 6
// months of incident reviews, was reported as an invented metric, and the
// error told them to paste that plan into cv.md. "first 90 days" already
// passes, because it is a plan horizon, not a past claim.
//
// Run:  node --test tests/cover-letter-user-inputs.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHtml } from '../generate-cover-letter.mjs';
import { assertFacts, verifyFacts } from '../verify-cv-facts.mjs';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const COVER_PDF_REGISTER = pathToFileURL(join(ROOT, 'tests', 'fixtures', 'cover-pdf-register.mjs')).href;
const PLAN = 'On day one I will read the last 6 months of incident reviews.';
const HORIZON = 'In my first 90 days I will map every payout retry path.';
const INVENTED = 'On day one I will read the last 9 months of incident reviews.';
const CONFIG = '/nonexistent/cv-facts.json';

function letter(opening) {
  return buildHtml({
    candidate: { name: 'Avery Quinn', email: 'avery.quinn@example.com' },
    letter: {
      role_title: 'Engineer',
      opening,
      profile_intro: 'I build ledger services.',
    },
  });
}

function check(html, planTexts = []) {
  return verifyFacts(html, { sourcePaths: [], planTexts, configPath: CONFIG });
}

test('a plan the candidate typed is supported when it is passed as a source', () => {
  const html = letter(PLAN);
  assert.deepEqual(check(html).invented, ['6 months']);
  assert.deepEqual(check(html, [PLAN]).invented, []);
  assert.equal(check(html, [PLAN]).verdict, 'pass');
});

test('a number in neither the career files nor the candidate inputs still blocks', () => {
  const html = letter(INVENTED);
  const result = check(html, [PLAN]);
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.invented, ['9 months']);
});

test('a plan-horizon number in the answers still supports the letter restating it', () => {
  const plan = 'In my first 6 months, I will audit the service.';
  for (const opening of [
    'Over 6 months, I will audit the service.',
    'In my first 6 months, I will audit the service.',
  ]) {
    const result = check(letter(opening), [plan]);
    assert.equal(result.verdict, 'pass', result);
    assert.deepEqual(result.invented, []);
  }
});

test('a sentence-level plan marker does not support a past headcount', () => {
  const result = check(
    letter('I managed 12 engineers, and I will do the same here.'),
    ['I will manage 12 engineers.'],
  );
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.invented, ['12 engineers']);
});

test('a plan answer does not support a past percentage the letter repeats', () => {
  const result = check(
    letter('I grew revenue 40% and will repeat it.'),
    ['I will grow revenue 40%.'],
  );
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.invented, ['40%']);
});

test('a later percentage in the same sentence can still be the plan', () => {
  const result = check(
    letter('I grew revenue 40% and will grow it 50%.'),
    ['I will grow revenue 50%.'],
  );
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.invented, ['40%']);
});

test('a later percentage stays the plan when the earlier past verb has no percentage', () => {
  const result = check(
    letter('I grew the team and will grow revenue 50%.'),
    ['I will grow revenue 50%.'],
  );
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(result.invented, []);
});

test('a forward marker later in the same clause does not admit a past-experience metric', () => {
  const result = check(
    letter('I have 6 months of experience and will review incidents.'),
    ['I will review incidents over 6 months.'],
  );
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.invented, ['6 months']);
});

test('a past-experience metric after a forward marker in the same clause stays unsupported', () => {
  const plan = 'I will lead for 6 years.';
  for (const opening of [
    'Next I will lead, as I have 6 years of experience.',
    'Next I will lead as I have 6 years of experience.',
    'I will lead, and I have 6 years of experience.',
  ]) {
    const result = check(letter(opening), [plan]);
    assert.equal(result.verdict, 'block', opening);
    assert.deepEqual(result.invented, ['6 years'], opening);
  }
});

test('a plan answer does not support a past-experience claim with the same number', () => {
  const result = check(letter('I have 6 months of incident-response experience.'), ['I plan to review the last 6 months of incidents.']);
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.invented, ['6 months']);
});

test('a number used once as a plan and once as a past claim still needs career evidence', () => {
  const result = check(letter(`I have 6 months of incident-response experience. ${PLAN}`), [PLAN]);
  assert.deepEqual(result.invented, ['6 months']);
});

test('an answer does not support an employer or a title', () => {
  const claim = 'I worked at Globex Corporation as a Principal Engineer.';
  const result = check(letter(claim), [claim]);
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.unsupportedFacts.map((f) => f.kind).sort(), ['employer', 'title']);
});

test('a first-90-days horizon is still not a claim', () => {
  assert.deepEqual(check(letter(HORIZON)).invented, []);
});

test('the block message names letter answers and does not send a plan to cv.md', () => {
  assert.throws(
    () => assertFacts(letter(PLAN), { sourcePaths: [], planTexts: [], configPath: CONFIG, label: 'cover letter' }),
    (err) => {
      assert.match(err.message, /6 months/);
      assert.match(err.message, /answers and inputs supplied for this letter/);
      assert.match(err.message, /Do not copy that plan into cv\.md/);
      assert.doesNotMatch(err.message, /Add real evidence to cv\.md/);
      return true;
    },
  );
});

test('the fact-check CLI names only the files it read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-cover-advice-'));
  try {
    const probe = join(dir, 'probe.html');
    writeFileSync(probe, `<p>${PLAN}</p>`);
    writeFileSync(join(dir, 'cv.md'), 'Avery Quinn builds ledger services.\n');
    const result = spawnSync(process.execPath, [join(ROOT, 'verify-cv-facts.mjs'), probe, '--config', CONFIG], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.status, 1, describeSpawn(result, text));
    assert.match(text, /6 months/);
    assert.match(text, /cv\.md and article-digest\.md/);
    assert.doesNotMatch(text, /answers|this letter/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runCover(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-cover-inputs-'));
  mkdirSync(join(dir, 'output'));
  writeFileSync(join(dir, 'cv.md'), 'Avery Quinn builds ledger services.\n');
  const payloadPath = join(dir, 'payload.json');
  writeFileSync(payloadPath, JSON.stringify({ ...payload, output_path: 'output/letter.pdf' }));
  const result = spawnSync(process.execPath, [
    '--import', COVER_PDF_REGISTER,
    join(ROOT, 'generate-cover-letter.mjs'),
    '--payload', payloadPath,
  ], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
  });
  rmSync(dir, { recursive: true, force: true });
  return { ...result, text: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function coverPayload(opening, extra = {}) {
  return {
    candidate: { name: 'Avery Quinn', email: 'avery.quinn@example.com' },
    letter: {
      role_title: 'Engineer',
      opening,
      profile_intro: 'I build ledger services.',
    },
    ...extra,
  };
}

test('generate-cover-letter counts user_inputs as a source for this letter', () => {
  const blocked = runCover(coverPayload(PLAN));
  assert.match(blocked.text, /6 months/, blocked.text);
  assert.ok(exitedNonZero(blocked), describeSpawn(blocked, 'expected a non-zero exit'));

  const passed = runCover(coverPayload(PLAN, { user_inputs: [PLAN] }));
  assert.equal(passed.status, 0, describeSpawn(passed));
  assert.doesNotMatch(passed.text, /Fact check failed/, passed.text);
  assert.doesNotMatch(passed.text, /6 months/, passed.text);
});

test('generate-cover-letter counts an answers object as a source', () => {
  const passed = runCover(coverPayload(PLAN, { answers: { approach: PLAN, tone: 'direct' } }));
  assert.equal(passed.status, 0, describeSpawn(passed));
  assert.doesNotMatch(passed.text, /Fact check failed/, passed.text);
  assert.doesNotMatch(passed.text, /6 months/, passed.text);
});

test('generate-cover-letter still blocks a number the candidate did not supply', () => {
  const blocked = runCover(coverPayload(INVENTED, { user_inputs: [PLAN], answers: { approach: PLAN } }));
  assert.match(blocked.text, /9 months/, blocked.text);
  assert.ok(exitedNonZero(blocked), describeSpawn(blocked, 'expected a non-zero exit'));
});

test('the letter body is not a source for itself', () => {
  const blocked = runCover(coverPayload(PLAN, { user_inputs: ['I will start by reading the incident reviews.'] }));
  assert.match(blocked.text, /6 months/, blocked.text);
  assert.ok(exitedNonZero(blocked), describeSpawn(blocked, 'expected a non-zero exit'));
});

test('cover mode tells the agent to pass those answers through as sources', () => {
  const english = readFileSync(join(ROOT, 'modes/cover.md'), 'utf-8');
  const turkish = readFileSync(join(ROOT, 'modes/tr/cover.md'), 'utf-8');
  assert.match(english, /user_inputs/);
  assert.match(turkish, /user_inputs/);
  assert.match(english, /verbatim/);
  assert.match(english, /do not\s+add\s+(?:a\s+|that\s+)?plan\s+to\s+cv\.md/i);
  assert.match(english, /Step 6 answer D, verbatim/);
  assert.match(turkish, /Adım 6 D yanıtı, olduğu gibi/);
});
