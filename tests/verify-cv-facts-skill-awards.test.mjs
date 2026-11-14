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

test('a plain Title Case phrase with a trailing period warns', () => {
  const result = verifyFacts(skillLine('Distributed Systems.'), options);
  assert.equal(result.verdict, 'warn', JSON.stringify(result.unsupportedFacts));
  assert.equal(result.unsupportedFacts.some((fact) => fact.kind === 'tool'), false);
  assert.equal(result.advisoryFacts.some((fact) => fact.kind === 'tool' && fact.value === 'distributed systems'), true);
});

test('a Title Case phrase of plain words warns', () => {
  const result = verifyFacts(skillLine('status notes, Distributed Systems'), options);
  assert.equal(result.verdict, 'warn', JSON.stringify(result));
  assert.deepEqual(result.unsupportedFacts, []);
  assert.equal(result.advisoryFacts.some((fact) => fact.kind === 'tool' && fact.value === 'distributed systems'), true);
});

test('the same Title Case phrase passes when the source names it', () => {
  const backed = join(tmp, 'cv-phrase.md');
  writeFileSync(backed, `${readSource()}\nDistributed Systems\n`);
  const named = verifyFacts(skillLine('Distributed Systems'), { ...options, sourcePaths: [backed] });
  assert.equal(named.verdict, 'pass', JSON.stringify(named));
  const mixed = verifyFacts(skillLine('Distributed Systems, Latency Tuning'), { ...options, sourcePaths: [backed] });
  assert.equal(mixed.verdict, 'warn', JSON.stringify(mixed.unsupportedFacts));
  assert.equal(mixed.advisoryFacts.some((fact) => fact.value === 'distributed systems'), false);
  assert.equal(mixed.advisoryFacts.some((fact) => fact.value === 'latency tuning'), true);
});

test('a competency tag that is a plain Title Case phrase warns', () => {
  const result = verifyFacts('<span class="competency-tag">Distributed Systems</span>', options);
  assert.equal(result.verdict, 'warn');
  assert.equal(result.unsupportedFacts.length, 0);
  assert.equal(result.advisoryFacts.some((fact) => fact.kind === 'tool' && fact.value === 'distributed systems'), true);
});

test('a digit or a product mark on the skills line still blocks', () => {
  const versioned = verifyFacts(skillLine('GPT-4'), options);
  assert.equal(versioned.verdict, 'block');
  assert.equal(versioned.unsupportedFacts.some((fact) => fact.kind === 'tool' && fact.value === 'gpt-4'), true);
  const dotted = verifyFacts(skillLine('Node.js'), options);
  assert.equal(dotted.verdict, 'block');
  assert.equal(dotted.unsupportedFacts.some((fact) => fact.kind === 'tool' && fact.value === 'node.js'), true);
  const dottedPeriod = verifyFacts(skillLine('Node.js.'), options);
  assert.equal(dottedPeriod.verdict, 'block');
  assert.equal(dottedPeriod.unsupportedFacts.some((fact) => fact.kind === 'tool' && fact.value === 'node.js'), true);
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

test('and before a tool-shaped skill still blocks that tool', () => {
  const result = verifyFacts(skillLine('status notes and Kubernetes'), options);
  assert.equal(result.verdict, 'block');
  assert.deepEqual(result.unsupportedFacts.map((fact) => `${fact.kind}=${fact.value}`), ['tool=kubernetes']);
  const comma = verifyFacts(skillLine('status notes, and Kubernetes'), options);
  assert.equal(comma.unsupportedFacts.some((fact) => fact.kind === 'tool' && fact.value === 'kubernetes'), true);
});

test('a formatted tool name on a LaTeX skills row still blocks', () => {
  const tex = [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\textbf{Writing}{: }{\\textit{Kubernetes}} \\\\',
    '\\end{document}',
  ].join('\n');
  const result = verifyFacts(tex, options);
  assert.equal(result.verdict, 'block');
  assert.equal(result.unsupportedFacts.some((fact) => fact.kind === 'tool' && fact.value === 'kubernetes'), true);
});

test('an unsourced tool on a LaTeX skills line blocks', () => {
  const tex = [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\textbf{Writing}{: }{status notes and Kubernetes} \\\\',
    '\\end{document}',
  ].join('\n');
  const result = verifyFacts(tex, options);
  assert.equal(result.verdict, 'block');
  assert.equal(result.unsupportedFacts.some((fact) => fact.kind === 'tool' && fact.value === 'kubernetes'), true);
});

test('a sentence verb is not part of the award name', () => {
  const backed = join(tmp, 'cv-award-verb.md');
  writeFileSync(backed, `${readSource()}\nExample Industry Award\nNobel Prize\n`);
  const opts = { ...options, sourcePaths: [backed] };
  const won = verifyFacts('<p>Won Example Industry Award in 2024.</p>', opts);
  assert.equal(won.verdict, 'pass', JSON.stringify(won.unsupportedFacts));
  const received = verifyFacts('<p>Received Nobel Prize in 2024.</p>', opts);
  assert.equal(received.verdict, 'pass', JSON.stringify(received.unsupportedFacts));
});

test('an unsourced award still blocks after the sentence verb is dropped', () => {
  const result = verifyFacts('<p>Won Example Industry Award in 2024.</p>', options);
  assert.equal(result.verdict, 'block');
  assert.equal(result.unsupportedFacts.some((fact) => fact.kind === 'award' && fact.value === 'example industry award'), true);
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
