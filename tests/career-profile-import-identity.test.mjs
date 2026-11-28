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

scenario('a partial approval still matches the complete extracted occurrence', ({ importCv, profile }) => {
  const cv = initial.replace('- Built alpha pipelines.', '- Shared result.')
    .replace('- Built beta reports.', '- Shared result.\n- Built beta reports.');
  assert.equal(importCv(cv, 'y\ny\ny\ny\ny\n').status, 0);
  const before = profile().experiences;
  const first = before.find((entry) => entry.facts.length === 1);
  const second = before.find((entry) => entry !== first);
  const result = importCv('# Candidate\n## Experience\n### Example Co — Analyst\n- Shared result.\n- Built beta reports.\n', 'y\ne\nApproved beta wording.\nn\n');
  assert.equal(result.status, 0, result.stderr);
  const after = profile().experiences;
  assert.deepEqual(after.find((entry) => entry.id === first.id), first);
  const updated = after.find((entry) => entry.id === second.id);
  const shared = second.facts.find((fact) => fact.text === 'Shared result.');
  assert.equal(updated.facts.find((fact) => fact.id === shared.id)?.text, 'Approved beta wording.');
  assert.ok(updated.facts.some((fact) => fact.text === 'Built beta reports.'));
});

scenario('a new fact cannot take the ID of another job’s fact', ({ importCv, profile }) => {
  const cv = initial.replace('- Built alpha pipelines.', '- Archived shared result.');
  assert.equal(importCv(cv, 'y\ny\ny\ny\n').status, 0);
  const before = profile().experiences;
  const priorSharedId = before.find((entry) => entry.facts.some((fact) => fact.text === 'Archived shared result.')).facts[0].id;
  const partial = '# Candidate\n## Experience\n### Example Co — Analyst\n- Built beta reports.\n* Archived shared result.\n';
  const result = importCv(partial, 'y\ny\ny\n');
  assert.equal(result.status, 0, result.stderr);
  const beta = profile().experiences.find((entry) => entry.facts.some((fact) => fact.text === 'Built beta reports.'));
  const newId = beta.facts.find((fact) => fact.text === 'Archived shared result.').id;
  assert.notEqual(newId, priorSharedId);
  assert.equal(importCv(partial, 'y\ny\ny\n').status, 0);
  assert.equal(profile().experiences.find((entry) => entry.id === beta.id).facts.find((fact) => fact.text === 'Archived shared result.').id, newId);
});

scenario('identical approved evidence does not select the first same-heading job', ({ importCv, file }) => {
  const cv = initial.replace('- Built alpha pipelines.', '- Shared result.\n- Built alpha pipelines.')
    .replace('- Built beta reports.', '- Shared result.\n- Built beta reports.');
  assert.equal(importCv(cv, 'y\ny\nn\ny\ny\nn\n').status, 0);
  const before = readFileSync(file, 'utf8');
  const result = importCv('# Candidate\n## Experience\n### Example Co — Analyst\n- Shared result.\n', 'y\ne\nEdited belonging unknown.\n');
  assert.equal(result.status, 1, 'both previously approved jobs match exactly');
  assert.match(result.stderr, /ambiguous.*identity/i);
  assert.equal(readFileSync(file, 'utf8'), before);
});

scenario('skipping a duplicate heading cannot assign another job its content-derived ID', ({ importCv, file }) => {
  const betaOnly = '# Candidate\n## Experience\n### Example Co — Analyst\n- Built beta reports.\n';
  assert.equal(importCv(betaOnly, 'y\ny\n').status, 0);
  const before = readFileSync(file, 'utf8');
  const result = importCv(initial, 'y\ny\nn\n');
  assert.equal(result.status, 1, 'the two extracted jobs make an ID-only match ambiguous');
  assert.match(result.stderr, /ambiguous.*identity/i);
  assert.equal(readFileSync(file, 'utf8'), before);
});

scenario('an approved job cannot absorb a stored job claimed by a skipped occurrence', ({ importCv, file }) => {
  const stored = '# Candidate\n## Experience\n### Example Co — Analyst\n- Shared result.\n- Built beta reports.\n';
  assert.equal(importCv(stored, 'y\ny\ny\n').status, 0);
  const before = readFileSync(file, 'utf8');
  const alpha = stored.replace('Built beta reports.', 'Built alpha pipelines.');
  const skipped = '### Example Co — Analyst\n- Shared result.\n- Built beta reports.\n';
  for (const other of [skipped, skipped + '- Verified another beta report.\n']) {
    const result = importCv(alpha + other, 'y\ny\ny\nn\n');
    assert.equal(result.status, 1, 'the skipped occurrence competes for the stored job');
    assert.match(result.stderr, /ambiguous.*identity/i);
    assert.equal(readFileSync(file, 'utf8'), before, 'ambiguous import changed the profile');
  }
});

scenario('changing the heading level preserves the matching job and its approved label', ({ importCv, profile }) => {
  const first = importCv(initial, 'e\nExample Co — Approved Alpha\ny\ne\nExample Co — Approved Beta\ny\n');
  assert.equal(first.status, 0, first.stderr);
  const before = profile().experiences;
  const result = importCv('# Candidate\n## Experience\n#### Example Co — Analyst ####\n- Built beta reports.\n- Validated beta reports.\n', 'y\ny\ny\n');
  assert.equal(result.status, 0, result.stderr);
  const after = profile().experiences;
  const alpha = before.find((entry) => entry.label.endsWith('Approved Alpha'));
  assert.deepEqual(after.find((entry) => entry.id === alpha.id), alpha, 'the other job must stay intact');
  const beta = after.find((entry) => entry.label.endsWith('Approved Beta'));
  assert.deepEqual(beta.facts.map((fact) => fact.text).sort(), ['Built beta reports.', 'Validated beta reports.']);
});
