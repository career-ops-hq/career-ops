// tests/story-provenance-grouped-numbers.test.mjs — a figure written with
// thousands separators ("1,200") is one number on both sides of the check.
//
// story-provenance-check.mjs scanned cv.md with /\d+(?:\.\d+)?/, which reads
// "1,200 employees" as 1 and "200 employees". A story claiming "200 employees"
// was then sorted `existing`, as if cv.md backed it: the unbounded match
// negotiation-roi.mjs closed for its own gate in #7773. The claim side had the
// mirror defect: "1,200 employees" in a story was the claim "200 employees".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'story-provenance-grouped-'));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));

const cvWith = (line) => ['# CV', '', '## Experience', '', '### Acme — Remote', '**HR Lead**', '2021 - 2024', '', `- ${line}`, ''].join('\n');
const storyWith = (result) => ['# Story Bank', '', '## Stories', '', '### [Scale] Onboarding',
  '**Source:** Report #001 — Beta — HR', '**S (Situation):** Onboarding was manual.', '**T (Task):** Fix it.',
  '**A (Action):** Built a checklist.', `**R (Result):** ${result}`, '**Reflection:** Checklists scale.',
  '**Best for questions about:** scale', ''].join('\n');

let n = 0;
function check(cvLine, result) {
  n += 1;
  const cv = join(dir, `cv-${n}.md`);
  const bank = join(dir, `bank-${n}.md`);
  writeFileSync(cv, cvWith(cvLine));
  writeFileSync(bank, storyWith(result));
  const r = spawnSync(process.execPath, [join(ROOT, 'story-provenance-check.mjs'), '--story-bank', bank, '--cv', cv],
    { cwd: dir, encoding: 'utf-8', timeout: 60_000 });
  assert.equal(r.error, undefined, describeSpawn(r));
  assert.equal(r.status, 0, describeSpawn(r));
  return JSON.parse(r.stdout);
}
const claims = (out, bucket) => out[bucket].map((e) => e.claim);

test('a smaller figure is not traced to the tail of a grouped one in cv.md', () => {
  const out = check('Ran onboarding for 1,200 employees across EMEA.', 'Ran onboarding for 200 employees across EMEA.');
  assert.deepEqual(claims(out, 'existing'), []);
  // cv.md supports the fact (onboarding, employees, EMEA), not the number.
  assert.deepEqual(claims(out, 'supportedByResume'), ['200 employees']);
});

test('a grouped figure in a story is the whole number, and matches the same figure in cv.md', () => {
  const out = check('Ran onboarding for 1,200 employees across EMEA.', 'Ran onboarding for 1,200 employees across EMEA.');
  assert.deepEqual(claims(out, 'existing'), ['1,200 employees']);
});

test('a grouped figure in a story is not traced to its own tail in cv.md', () => {
  const out = check('Ran onboarding for 200 employees across EMEA.', 'Ran onboarding for 1,200 employees across EMEA.');
  assert.deepEqual(claims(out, 'existing'), []);
  assert.deepEqual(claims(out, 'supportedByResume'), ['1,200 employees']);
});

test('control: the same plain figure on both sides is existing, as before', () => {
  const out = check('Ran onboarding for 200 employees across EMEA.', 'Ran onboarding for 200 employees across EMEA.');
  assert.deepEqual(claims(out, 'existing'), ['200 employees']);
});
