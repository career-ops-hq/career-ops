// Re-import must not attach one job's facts to another job's approved identity.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
import { loadYaml } from '../lib/yaml-document.mjs';

const initial = '# Candidate\n## Experience\n### Example Co — Analyst\n- Built alpha pipelines.\n### Example Co — Analyst\n- Built beta reports.\n';
const expanded = '# Candidate\n## Experience\n### Example Co — Analyst\n- Built alpha pipelines.\n- Validated alpha results.\n### Example Co — Analyst\n- Automated beta releases.\n- Built beta reports.\n';
function scenario(name, run) {
  const dir = mkdtempSync(join(tmpdir(), 'career-profile-identity-'));
  mkdirSync(join(dir, 'data'));
  const file = join(dir, 'data', 'career-profile.yml');
  function importCv(cv, answers) {
    writeFileSync(join(dir, 'cv.md'), cv);
    const result = spawnSync(process.execPath, [join(ROOT, 'career-profile.mjs'), 'import', 'cv.md', '--review'], {
      cwd: ROOT, env: { ...process.env, CAREER_OPS_ROOT: dir }, encoding: 'utf8', input: answers, timeout: 10_000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    return result;
  }
  try { run({ importCv, file, profile: () => loadYaml(readFileSync(file, 'utf8')) }); pass(name); }
  catch (err) { fail(`${name}: ${err.message}`); process.exitCode = 1; }
  finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
}

scenario('added facts preserve each same-heading job and its approved edits', ({ importCv, profile }) => {
  const first = importCv(initial, 'e\nExample Co — Approved Alpha\ne\nApproved alpha result.\ny\ny\n');
  assert.equal(first.status, 0, first.stderr);
  const again = importCv(expanded, 'y\ny\ny\ny\ny\ny\n');
  assert.equal(again.status, 0, again.stderr);
  const entries = profile().experiences;
  assert.equal(entries.length, 2, 're-import duplicated an existing job');
  const alpha = entries.find(entry => entry.label === 'Example Co — Approved Alpha');
  assert.ok(alpha, 'approved label was lost');
  assert.deepEqual(alpha.facts.map(fact => fact.text).sort(), ['Approved alpha result.', 'Validated alpha results.']);
  const beta = entries.find(entry => entry !== alpha);
  assert.deepEqual(beta.facts.map(fact => fact.text).sort(), ['Automated beta releases.', 'Built beta reports.']);
  assert.equal(alpha.evidence.line, 3);
  assert.equal(beta.evidence.line, 6);
});

scenario('shared evidence cannot choose between two approved jobs', ({ importCv, file }) => {
  const cv = initial.replace('- Built alpha pipelines.', '- Shared result.\n- Built alpha pipelines.')
    .replace('- Built beta reports.', '- Shared result.\n- Built beta reports.');
  assert.equal(importCv(cv, 'y\ny\ny\ny\ny\ny\n').status, 0);
  const before = readFileSync(file, 'utf8');
  const result = importCv('# Candidate\n## Experience\n### Example Co — Analyst\n- Shared result.\n- New result.\n', 'y\ny\ny\n');
  assert.equal(result.status, 1, 'ambiguous import must fail before saving');
  assert.match(result.stderr, /ambiguous.*identity/i);
  assert.equal(readFileSync(file, 'utf8'), before, 'ambiguous import changed verified data');
});

scenario('an unrelated same-heading entry cannot inherit a reused parser ID', ({ importCv, file }) => {
  assert.equal(importCv(initial, 'y\ny\ny\ny\n').status, 0);
  const before = readFileSync(file, 'utf8');
  const result = importCv('# Candidate\n## Experience\n### Example Co — Analyst\n- Unrelated new job.\n', 'y\ny\n');
  assert.equal(result.status, 1, 'a reused ID is not evidence that this is the same job');
  assert.match(result.stderr, /ambiguous.*identity/i);
  assert.equal(readFileSync(file, 'utf8'), before);
});

scenario('a unique heading can still accumulate newly approved facts', ({ importCv, profile }) => {
  const cv = '# Candidate\n## Experience\n### Distinct Example Co — Analyst\n- First result.\n';
  assert.equal(importCv(cv, 'y\ny\n').status, 0);
  assert.equal(importCv(cv.replace('First result.', 'Second result.'), 'y\ny\n').status, 0);
  assert.equal(profile().experiences.length, 1);
  assert.deepEqual(profile().experiences[0].facts.map(fact => fact.text).sort(), ['First result.', 'Second result.']);
});

scenario('importing only the second same-heading job preserves both approved identities', ({ importCv, profile }) => {
  assert.equal(importCv(initial, 'y\ny\ny\ny\n').status, 0);
  const before = profile().experiences;
  const result = importCv('# Candidate\n## Experience\n### Example Co — Analyst\n- Built beta reports.\n- Validated beta reports.\n', 'y\ny\ny\n');
  assert.equal(result.status, 0, result.stderr);
  const after = profile().experiences;
  assert.equal(after.length, 2, 'a partial re-import deleted the unrelated job');
  for (const prior of before) {
    const current = after.find(entry => entry.id === prior.id);
    assert.ok(current, 'approved job identity was replaced');
    for (const fact of prior.facts) assert.ok(current.facts.some(item => item.text === fact.text));
  }
  const beta = after.find(entry => entry.facts.some(fact => fact.text === 'Built beta reports.'));
  assert.ok(beta.facts.some(fact => fact.text === 'Validated beta reports.'));
});
