// tests/market-in-rules.test.mjs — the India market layer (modes/in/) keeps
// the rules that make it different from the English defaults.
//
// Each assertion pins a rule whose loss would silently produce a wrong
// evaluation for an Indian posting:
//
//   - Indian postings quote CTC. Read as take-home pay, it overstates every
//     offer and makes a cross-market comparison wrong.
//   - Fresher postings name eligible batches. A batch outside a required list
//     is a critical Block B row with an HR question; whether it is a hard stop
//     stays with the canonical rules in modes/oferta.md.
//   - The layer runs on top of modes/_shared.md and changes no workflow rule.
//     The router layers market files on the English canon (#6728); the rule
//     covers entry points that load a market file on its own.
//   - The market is decided by the hiring entity, not the posting language.
//   - Rates, ceilings and tax figures change, so no rupee amount or percentage
//     rate is written into the mode files: the agent verifies them at runtime.
//
// Run:  node --test tests/market-in-rules.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IN = join(ROOT, 'modes', 'in');
const read = (name) => readFileSync(join(IN, name), 'utf-8').replace(/\r\n/g, '\n');
const shared = read('_shared.md');

test('modes/in/_shared.md layers on modes/_shared.md and defers on workflow', () => {
  assert.match(shared, /\*\*RULE: `modes\/_shared\.md` is read in full before this file\.\*\*/);
  assert.match(shared, /when it seems to contradict one, the English rule wins/);
});

test('CTC is never presented as take-home pay', () => {
  assert.match(shared, /\*\*Never present CTC as take-home pay\*\*/);
  assert.match(shared, /Never estimate in-hand pay from memory/);
});

test('a batch outside the posting\'s required list is a critical Block B row with an HR question', () => {
  assert.match(shared, /A year outside a list the posting makes a requirement \("only", "eligible batches"\) is a `critical` row in Block B/);
  assert.match(shared, /Whether it is a hard stop follows the canonical rules in `modes\/oferta\.md`, not this file/);
  assert.match(shared, /Is the \{year\} batch eligible for this role\?/);
});

test('the candidate\'s stage is decided before Block A', () => {
  assert.match(shared, /### Which stage rules apply/);
  assert.match(shared, /less than 12 months of full-time work after graduation/);
});

test('the market is decided by the hiring entity, not the posting language', () => {
  assert.match(shared, /Decide by the hiring entity, never by the language of the posting/);
});

test('identity numbers are never asked for or written', () => {
  assert.match(shared, /never ask for, store or write Aadhaar, PAN, bank, passport or UAN numbers/);
});

test('the evaluation layer runs the canonical oferta.md and adds the Indian header', () => {
  const offer = read('offer.md');
  assert.match(offer.split('\n', 1)[0], /A[-‐-―]H/, 'title line must name A-H so the web resolver finds it');
  assert.match(offer, /run the canonical A-H evaluation from `modes\/oferta\.md`/);
  assert.match(offer, /\*\*Market:\*\* India/);
  assert.match(offer, /\*\*Career stage:\*\*/);
  assert.match(offer, /\*\*CTC \(INR\):\*\*/);
});

test('no rupee amounts or percentage rates are hardcoded in the Indian mode files', () => {
  // A literal amount or rate here would go stale with the next budget, EPFO
  // notification or labour-code rule. Placeholders like ₹ {amount} are fine.
  for (const name of readdirSync(IN).filter((f) => f.endsWith('.md'))) {
    const hits = read(name).match(/₹\s?\d|\b(?:Rs\.?|INR)\s?\d|\d[\d.,]*\s?(?:₹|INR\b|%|percent\b|lakhs?\b|crores?\b|LPA\b)/gi) ?? [];
    assert.deepEqual(hits, [], `modes/in/${name} hardcodes an amount or rate: ${hits.join(', ')}`);
  }
});
