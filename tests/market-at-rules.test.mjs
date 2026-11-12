// tests/market-at-rules.test.mjs — the Austria market layer (modes/at/) keeps
// the rules that make it different from modes/de/.
//
// Each assertion pins a rule whose loss would silently produce a wrong
// evaluation for an Austrian posting:
//
//   - Austrian pay is quoted monthly and paid 14 times; scoring a monthly
//     figure on a 12- or 13-salary basis understates every offer.
//   - The minimum pay an Austrian posting states (§ 9 (2) GlBG) is a floor.
//     Read as a band, it makes a market-rate role look underpaid.
//   - The layer runs on top of modes/_shared.md and changes no workflow rule.
//     The router layers market files on the English canon (#6728); the rule
//     covers entry points that load a market file on its own.
//   - Thresholds and rates change, so no euro amount or percentage rate is
//     written into the mode files: the agent verifies figures at runtime.
//
// Run:  node --test tests/market-at-rules.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const AT = join(ROOT, 'modes', 'at');
const read = (name) => readFileSync(join(AT, name), 'utf-8').replace(/\r\n/g, '\n');
const shared = read('_shared.md');

test('modes/at/_shared.md layers on modes/_shared.md and defers on workflow', () => {
  assert.match(shared, /\*\*RULE: `modes\/_shared\.md` is read in full before this file\.\*\*/);
  assert.match(shared, /when it seems to contradict one, the English rule wins/);
});

test('monthly pay is annualised on 14 salaries', () => {
  assert.match(shared, /annual gross = monthly × 14/);
  assert.match(shared, /Never multiply an annual figure/);
});

test('the posting\'s minimum pay is a floor, not a band', () => {
  assert.match(shared, /The salary statement is a floor, not a band/);
  assert.match(shared, /Never treat the minimum as the offer/);
});

test('a missing salary statement is an observation, never a violation', () => {
  assert.match(shared, /Never call it illegal or a violation/);
});

test('the market is decided by the hiring entity, not the posting language', () => {
  assert.match(shared, /Decide by the hiring entity, never by the language of the posting/);
});

test('the evaluation layer runs the canonical oferta.md and adds the Austrian header', () => {
  const offer = read('offer.md');
  assert.match(offer.split('\n', 1)[0], /A[-‐-―]H/, 'title line must name A-H so the web resolver finds it');
  assert.match(offer, /run the canonical A-H evaluation from `modes\/oferta\.md`/);
  assert.match(offer, /\*\*Market:\*\* Austria/);
  assert.match(offer, /\*\*Salary statement:\*\*/);
});

test('no euro amounts or percentage rates are hardcoded in the Austrian mode files', () => {
  // A literal amount or rate here would go stale with the next KV round,
  // threshold update or contribution change. Placeholders like € {amount} are fine.
  for (const name of readdirSync(AT).filter((f) => f.endsWith('.md'))) {
    const hits = read(name).match(/€\s?\d|\d[\d.,]*\s?(?:€|EUR\b|%|percent\b|Prozent\b)/g) ?? [];
    assert.deepEqual(hits, [], `modes/at/${name} hardcodes an amount or rate: ${hits.join(', ')}`);
  }
});
