// #6782 problems 1 and 2: `career-profile.mjs import` must group the CV layout
// AGENTS.md recommends (examples/cv-example.md) into one entry per job, project
// and degree. Every case imports the example CV with every item approved and
// reads the structure back from the saved profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'career-profile.mjs');
const EXAMPLE_CV = join(ROOT, 'examples', 'cv-example.md');

function importAll(cv) {
  const root = mkdtempSync(join(tmpdir(), 'career-profile-grouping-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    if (cv === undefined) copyFileSync(EXAMPLE_CV, join(root, 'cv.md'));
    else writeFileSync(join(root, 'cv.md'), cv);
    const result = spawnSync(process.execPath, [CLI, 'import', 'cv.md', '--review'], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_ROOT: root },
      encoding: 'utf8', input: 'y\n'.repeat(200), timeout: 10000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, describeSpawn(result));
    return yaml.load(readFileSync(join(root, 'data', 'career-profile.yml'), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const shape = (entries) => entries.map((entry) => ({ label: entry.label, facts: entry.facts.map((fact) => fact.text) }));

test('problem 1: a ### job keeps its title, dates and bullets as facts of one entry', () => {
  const profile = importAll();
  const jobs = shape(profile.experiences);
  assert.deepEqual(jobs.map((job) => job.label), ['TechFin Corp -- Austin, TX', 'DataStartup Inc -- Remote']);
  assert.deepEqual(jobs[0].facts.slice(0, 2), ['Senior ML Engineer / ML Platform Lead', '2020-2024']);
  assert.equal(jobs[0].facts.length, 7);
  assert.match(jobs[0].facts[2], /^Led ML platform team/);
  assert.deepEqual(jobs[1].facts.slice(0, 2), ['ML Engineer', '2018-2020']);
  assert.equal(jobs[1].facts.length, 5);
});

test('problem 1: a whole-line bold title keeps no trailing colon, a bold label still reads as label: value', () => {
  const profile = importAll('## Experience\n### Acme -- Remote\n**Analyst**\n**Team**: Data\n- Built dashboards.\n');
  assert.deepEqual(shape(profile.experiences), [
    { label: 'Acme -- Remote', facts: ['Analyst', 'Team: Data', 'Built dashboards.'] },
  ]);
});

test('problem 2: in a section with no entry headings, each bullet is its own entry', () => {
  const profile = importAll();
  assert.deepEqual(shape(profile.education), [
    { label: 'MS Computer Science, UT Austin (2018)', facts: [] },
    { label: 'BS Computer Science, UC Berkeley (2016)', facts: [] },
  ]);
  assert.equal(profile.projects.length, 2);
  assert.match(profile.projects[0].label, /^FraudShield/);
  assert.match(profile.projects[1].label, /^LLM Eval Toolkit/);
  assert.ok(profile.projects.every((project) => project.facts.length === 0));
});

test('a non-bullet line with no heading above it still opens an entry that owns its bullets', () => {
  const profile = importAll('## Projects\n**FraudShield**\n- Kafka Streams.\n- 500+ stars.\n**Eval Toolkit**\n- CI integration.\n');
  assert.deepEqual(shape(profile.projects), [
    { label: 'FraudShield', facts: ['Kafka Streams.', '500+ stars.'] },
    { label: 'Eval Toolkit', facts: ['CI integration.'] },
  ]);
});

test('a line with more than one bold span keeps the label: value rewrite instead of the whole-bold title branch', () => {
  const profile = importAll('## Projects\n- **FraudShield** - real-time **fraud detection**\n- **Team**: **Data**\n');
  assert.deepEqual(profile.projects.map((project) => project.label), [
    'FraudShield: - real-time **fraud detection**',
    'Team: **Data**',
  ]);
});

test('problem 2: an indented sub-bullet stays a fact of the bullet entry above it', () => {
  const profile = importAll([
    '## Projects',
    '- **FraudShield** - fraud detection framework',
    '  - 1.2k GitHub stars',
    '## Education',
    '- MS Computer Science, Example University (2018)',
    '  - Thesis: graph anomaly detection',
    '- BS Computer Science, Example College (2016)',
    '',
  ].join('\n'));
  assert.deepEqual(shape(profile.projects), [
    { label: 'FraudShield: - fraud detection framework', facts: ['1.2k GitHub stars'] },
  ]);
  assert.deepEqual(shape(profile.education), [
    { label: 'MS Computer Science, Example University (2018)', facts: ['Thesis: graph anomaly detection'] },
    { label: 'BS Computer Science, Example College (2016)', facts: [] },
  ]);
});

test('problem 2: a tab-indented sub-bullet counts as deeper than a two-space bullet', () => {
  const profile = importAll('## Projects\n  - Project A\n\t- Detail\n  - Project B\n');
  assert.deepEqual(shape(profile.projects), [
    { label: 'Project A', facts: ['Detail'] },
    { label: 'Project B', facts: [] },
  ]);
});
