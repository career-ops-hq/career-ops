// tests/triage-weights.test.mjs — the triage first-pass weights are documented
// twice in modes/triage.md: once as prose (`**Name (weight N%)**`) and once as
// coefficients in the `**Global score**` formula. Nothing tied the two together,
// so they could drift from each other and from 1.00 — and they did: the shipped
// set summed to 0.95, compressing every triage score by 5% against a scale the
// mode documents as 5-point (#3738).
//
// This test does not care WHICH weights the maintainer picks. It asserts only
// that the two statements of them agree and that they sum to 1.00, so any future
// redistribution stays internally consistent.

import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntriage dimension weights (#3738)');

const TRIAGE_PATH = 'modes/triage.md';
const source = readFileSync(join(ROOT, TRIAGE_PATH), 'utf8');

// Prose: `**Archetype fit (weight 35%):** Does this map to ...`
const PROSE_RE = /^\*\*(.+?)\s*\(weight\s+(\d+(?:\.\d+)?)%\)/gm;
const prose = [...source.matchAll(PROSE_RE)].map((m) => ({
  name: m[1],
  weight: Number(m[2]) / 100,
}));

// Formula: `**Global score** = (archetype × 0.35) + (comp × 0.25) + ...`,
// which wraps across lines, so take the paragraph and pull every `(term × N)`.
// `red_flag_adjustment` carries no coefficient and is deliberately not matched.
const formulaBlock = source.split(/\n\s*\n/).find((para) => para.includes('**Global score**')) ?? '';
const FORMULA_RE = /\(\s*([A-Za-z][A-Za-z_ ]*?)\s*×\s*(\d*\.\d+)\s*\)/g;
const formula = [...formulaBlock.matchAll(FORMULA_RE)].map((m) => ({
  name: m[1],
  weight: Number(m[2]),
}));

/** Lowercase word tokens, so `CV match estimate` and `cv_match` are comparable. */
const tokens = (name) => name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const isPrefixOf = (short, long) => short.every((tok, i) => long[i] === tok);

if (prose.length === 4 && formula.length === 4) {
  pass(`${TRIAGE_PATH} declares 4 weighted dimensions in prose and 4 in the Global score formula`);
} else {
  fail(`${TRIAGE_PATH} declares ${prose.length} prose weights and ${formula.length} formula weights, expected 4 of each`
    + ` (prose: ${prose.map((d) => d.name).join(', ') || 'none'};`
    + ` formula: ${formula.map((d) => d.name).join(', ') || 'none'})`);
}

// Pair each formula term with the prose dimension whose name it abbreviates
// (`cv_match` → `CV match estimate`). An unmatched or ambiguous term means one
// of the two lists was renamed without the other.
const mismatches = [];
const pairedProse = new Set();
for (const term of formula) {
  const candidates = prose.filter((dim) => isPrefixOf(tokens(term.name), tokens(dim.name)));
  if (candidates.length !== 1) {
    mismatches.push(`formula term "${term.name}" matches ${candidates.length} prose dimensions`);
    continue;
  }
  const [dim] = candidates;
  pairedProse.add(dim.name);
  if (Math.abs(dim.weight - term.weight) > 1e-9) {
    mismatches.push(`"${dim.name}" is ${dim.weight * 100}% in prose but × ${term.weight} in the formula`);
  }
}
for (const dim of prose) {
  if (!pairedProse.has(dim.name)) mismatches.push(`prose dimension "${dim.name}" has no term in the Global score formula`);
}

if (mismatches.length === 0) {
  pass(`each prose weight in ${TRIAGE_PATH} equals its coefficient in the Global score formula`);
} else {
  fail(`prose and formula weights disagree in ${TRIAGE_PATH}: ${mismatches.join('; ')}`);
}

const formulaSum = formula.reduce((total, term) => total + term.weight, 0);
if (formula.length > 0 && Math.abs(formulaSum - 1) <= 1e-9) {
  pass(`the Global score formula weights in ${TRIAGE_PATH} sum to 1.00`);
} else {
  fail(`the Global score formula weights in ${TRIAGE_PATH} sum to ${formulaSum.toFixed(4)}, not 1.00`
    + ` — every triage score is scaled by that factor against a 5-point scale`);
}

const proseSum = prose.reduce((total, dim) => total + dim.weight, 0);
if (prose.length > 0 && Math.abs(proseSum - 1) <= 1e-9) {
  pass(`the prose dimension weights in ${TRIAGE_PATH} sum to 1.00`);
} else {
  fail(`the prose dimension weights in ${TRIAGE_PATH} sum to ${proseSum.toFixed(4)}, not 1.00`);
}
