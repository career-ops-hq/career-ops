// A tool on the skills line, and a prize named in a sentence, used to pass
// the fact gate. The same tool after "using", and the same prize in an
// award field, already blocked.
//
// Run: node --test tests/verify-cv-facts-skill-awards.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyFacts } from '../verify-cv-facts.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'cv-skill-award-facts-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const source = join(tmp, 'cv.md');
writeFileSync(source, `# Fixture Person

## Experience

### Fixture Co — Springfield, IL
**Coordinator**
2019 – 2024

- Kept a Tuesday review for 12 people.

## Skills
status notes, agendas, spreadsheets
`);
const options = { sourcePaths: [source], configPath: join(tmp, 'absent.json') };

const skillLine = (items) => `<div class="skill-item"><span class="skill-category">Writing: </span>${items}</div>`;

test('lowercase skills that reword the source pass', () => {
  const result = verifyFacts(skillLine('status notes, agendas, spreadsheets'), options);
  assert.equal(result.verdict, 'pass', JSON.stringify(result.unsupportedFacts));
});

test('a tool-shaped skill the source never names blocks', () => {
  const result = verifyFacts(skillLine('status notes, agendas, spreadsheets, Kubernetes'), options);
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.unsupportedFacts.map((fact) => `${fact.kind}=${fact.value}`), ['tool=kubernetes']);
});

test('a sourced tool on the skills line passes', () => {
  const backed = join(tmp, 'cv-backed.md');
  writeFileSync(backed, `${readSource()}\nKubernetes\n`);
  const result = verifyFacts(skillLine('status notes, Kubernetes'), { ...options, sourcePaths: [backed] });
  assert.equal(result.verdict, 'pass', JSON.stringify(result.unsupportedFacts));
});

test('a competency tag the source never names blocks', () => {
  const result = verifyFacts('<span class="competency-tag">Kubernetes</span>', options);
  assert.equal(result.verdict, 'block');
  assert.equal(result.unsupportedFacts.some((fact) => fact.kind === 'tool' && fact.value === 'kubernetes'), true);
});

test('a prize named in a sentence blocks when the source never names it', () => {
  const html = '<div class="summary-text">Coordinator who keeps a Tuesday review for 12 people and a Nobel Prize in 2024.</div>';
  const result = verifyFacts(html, options);
  assert.equal(result.verdict, 'block');
  assert.equal(result.unsupportedFacts.some((fact) => fact.kind === 'award' && fact.value === 'nobel prize'), true);
});

test('a prize named in a sentence passes when the source names it', () => {
  const backed = join(tmp, 'cv-prize.md');
  writeFileSync(backed, `${readSource()}\nNobel Prize\n`);
  const html = '<div class="summary-text">Coordinator who keeps a Tuesday review for 12 people and a Nobel Prize in 2024.</div>';
  const result = verifyFacts(html, { ...options, sourcePaths: [backed] });
  assert.equal(result.verdict, 'pass', JSON.stringify(result.unsupportedFacts));
});

function readSource() {
  return `# Fixture Person

## Experience

### Fixture Co — Springfield, IL
**Coordinator**
2019 – 2024

- Kept a Tuesday review for 12 people.

## Skills
status notes, agendas, spreadsheets
`;
}
