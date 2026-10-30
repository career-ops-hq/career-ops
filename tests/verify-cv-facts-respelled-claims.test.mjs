// tests/verify-cv-facts-respelled-claims.test.mjs — one claim, however it is
// spelled (#5348).
//
// The metric patterns knew one spelling of each claim: `45%`, `$3M`, `10x`, and
// a count only with digits. The same inflated figure therefore blocked or
// passed depending on wording an LLM rewriter chooses freely: `45 percent`,
// `USD 3M`, `forty engineers`, `tenfold`. A LaTeX CV hid every percentage,
// because `\%` breaks the digit-percent adjacency the pattern needs.
//
// Run:  node --test tests/verify-cv-facts-respelled-claims.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditClaims, metricClaims, verifyFacts } from '../verify-cv-facts.mjs';

const SOURCE = 'Led a team of 4 engineers. Reduced latency by 15%. Managed a $300K budget. Grew throughput 3x.';

const claims = (text) => [...metricClaims(text)].sort();
const invented = (text, source = SOURCE) => auditClaims(text, source).invented.sort();

test('a percentage written as a word is the same claim as the symbol', () => {
  for (const text of ['45%', '45 %', '45 percent', '45 per cent', '45 Percent', '45 pct']) {
    assert.deepEqual(claims(`Reduced latency by ${text}.`), ['45%'], text);
  }
  assert.deepEqual(invented('Reduced latency by 45 percent.'), ['45%']);
  assert.deepEqual(invented('Reduced latency by 15 percent.'), [], 'a source-backed figure in words still passes');
});

test('a LaTeX-escaped percent sign is read as a percentage', () => {
  assert.deepEqual(claims(String.raw`\resumeItem{Reduced latency by 95\%.}`), ['95%']);
  assert.deepEqual(invented(String.raw`Reduced latency by 95\%.`), ['95%']);
  assert.deepEqual(invented(String.raw`Reduced latency by 15\%.`), []);
});

test('currency codes and words fold onto the symbol form', () => {
  for (const text of ['$3M', '$3 M', '$3 million', 'USD 3M', 'US$3M', '3M USD', '3 million dollars', '3 million dollar']) {
    assert.deepEqual(claims(`Managed a ${text} budget.`), ['$3m'], text);
  }
  assert.deepEqual(claims('Closed a €2.5 million deal and a EUR 4M one.'), ['€2.5m', '€4m']);
  assert.deepEqual(claims('Won a GBP 900k contract.'), ['£900k']);
  assert.deepEqual(invented('Managed a USD 3M budget.'), ['$3m']);
  assert.deepEqual(invented('Managed a 300K USD budget.'), [], 'the source says $300K');
});

test('lowercase currency codes and a bare "pounds" are not money', () => {
  assert.deepEqual(claims('Shipped 20 pounds of parts.'), []);
  assert.deepEqual(claims('Wrote 3 gbp converters.'), []);
});

test('spelled-out numbers make the same count claim as digits', () => {
  assert.deepEqual(claims('Led forty engineers.'), ['40 engineers']);
  assert.deepEqual(claims('Led Forty-Five engineers.'), ['45 engineers']);
  assert.deepEqual(claims('Served two hundred users.'), ['200 users']);
  assert.deepEqual(claims('Served forty million users.'), ['40m users']);
  assert.deepEqual(invented('Led forty engineers.'), ['40 engineers']);
  assert.deepEqual(invented('Led four engineers.'), [], 'the source says 4 engineers');
});

test('"one" on its own is not a count', () => {
  assert.deepEqual(claims('Was one of the engineers on call.'), []);
  assert.deepEqual(claims('One hundred users signed up.'), ['100 users']);
});

test('a -fold multiplier is the same claim as Nx', () => {
  for (const text of ['10x', '10 x', '10-fold', '10 fold', 'tenfold', 'ten-fold', 'Tenfold']) {
    assert.deepEqual(claims(`Improved throughput ${text}.`), ['10x'], text);
  }
  assert.deepEqual(invented('Improved throughput threefold.'), [], 'words below four are left to prose');
  assert.deepEqual(invented('Improved throughput 3-fold.'), [], 'the source says 3x');
  assert.deepEqual(claims('A twofold approach and a threefold mission.'), []);
});

test('people a candidate mentored or hired are counted', () => {
  assert.deepEqual(claims('Mentored 12 interns and 3 mentees; made 9 hires; trained 2 apprentices.'),
    ['12 interns', '2 apprentices', '3 mentees', '9 hires']);
});

test('a LaTeX preamble makes no claims of its own', () => {
  const tex = [
    String.raw`\documentclass[letterpaper,11pt]{article}`,
    String.raw`\pdfgentounicode=1`,
    '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
    String.raw`\titleformat{\section}{\vspace{-4pt}}{}{0em}{}[\titlerule \vspace{-5pt}]`,
    String.raw`\begin{document}`,
    String.raw`\resumeItem{Led a team of 4 engineers.} % 40 engineers, said no source`,
    String.raw`\end{document}`,
  ].join('\n');
  assert.deepEqual(claims(tex), ['4 engineers'], 'the "=1" above a % banner read as "1%" before');
  const result = verifyFacts(tex, { sourcePaths: [], configPath: '/nonexistent/cv-facts.json' });
  assert.equal(result.coverage, null, 'the preamble outvoted the English body in the language check');
});

test('a percent sign is still a percent sign outside LaTeX', () => {
  assert.deepEqual(claims('- Cut costs by 30% % of the time.'), ['30%']);
  assert.deepEqual(claims('Cut costs by 30\n% of the time.'), [], 'a newline does not join a number to a %');
});
