// tests/prompt-parity.test.mjs — guards the self-contained batch evaluation
// prompt against drift from the canonical interactive Block A / Block G markers.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nprompt parity (interactive ↔ batch)');

const assert = (condition, message) => condition ? pass(message) : fail(message);

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = text.indexOf(endMarker, start + startMarker.length);
  return text.slice(start, end === -1 ? text.length : end);
}

try {
  const oferta = readFileSync(join(ROOT, 'modes', 'oferta.md'), 'utf8');
  const batch = readFileSync(join(ROOT, 'batch', 'batch-prompt.md'), 'utf8');
  const shared = readFileSync(join(ROOT, 'modes', '_shared.md'), 'utf8');

  const trackerInstruction = section(oferta, '- Score: copy the already-decided', '\n- Status:');
  const batchScoreInstruction = section(batch, '#### Global Score', '#### Machine Summary');
  assert(
    shared.includes('A–H are report sections, not numeric inputs to average')
      && trackerInstruction.includes('A–H are report sections, not scores to average')
      && batchScoreInstruction.includes('Do not average report blocks A–H'),
    'all evaluation paths keep report blocks separate from scoring dimensions',
  );
  assert(
    shared.includes('report header, Machine Summary `score`, and application tracker must record that same value')
      && trackerInstruction.includes('copy the already-decided 1–5 Global Score')
      && batchScoreInstruction.includes('Copy the same value into the report header, Machine Summary `score`, and tracker addition'),
    'interactive and batch paths copy one Global Score into every output',
  );

  const ofertaBlockA = section(oferta, '## Block A — Role Summary', '## Block B — Match with CV');
  const batchBlockA = section(batch, '#### Block A — Role Summary', '#### Block B — CV Match');
  const tierPattern = /^- (?:✅|➖|⚠️|⛔) \*\*([^*]+)\*\*\s+—/gm;
  const ofertaTiers = [...ofertaBlockA.matchAll(tierPattern)].map((match) => match[1]);
  const batchTiers = [...batchBlockA.matchAll(tierPattern)].map((match) => match[1]);

  assert(
    batchBlockA.includes('Work-authorization classification (required)'),
    'batch Block A contains a required work-authorization instruction',
  );
  assert(
    ofertaTiers.length === 4,
    'canonical Block A exposes exactly four work-authorization tiers',
  );
  assert(
    JSON.stringify(batchTiers) === JSON.stringify(ofertaTiers),
    'batch Block A uses the canonical four tier names in canonical order',
  );

  const ofertaBlockG = section(oferta, '## Block G — Posting Legitimacy', '### Output format:');
  const batchBlockG = section(batch, '#### Block G — Posting Legitimacy', '#### Risk Summary (after Block G)');
  const signalPattern = /^\*\*(\d+)\.\s+(.+?)\*\*/gm;
  const canonicalMatches = [...ofertaBlockG.matchAll(signalPattern)]
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const canonicalSignals = canonicalMatches.map((match) => match[2]);

  // The count is DERIVED from modes/oferta.md, never restated here. A literal
  // number would be a second copy of the canon — the exact drift this suite
  // exists to prevent — and it would go red every time a signal lands. What is
  // asserted instead is the invariant that survives growth: the canon numbers
  // its signals 1..N with no gap, so the list below can be trusted as ordered.
  assert(
    canonicalSignals.length > 0
      && canonicalMatches.every((match, index) => Number(match[1]) === index + 1),
    `canonical Block G exposes ${canonicalSignals.length} signals numbered 1..${canonicalSignals.length}`,
  );

  const batchSignalPositions = canonicalSignals.map((name) => batchBlockG.indexOf(`**${name}**`));
  for (const [index, name] of canonicalSignals.entries()) {
    assert(
      ofertaBlockG.includes(`**${index + 1}. ${name}**`) && batchSignalPositions[index] !== -1,
      `Block G signal ${index + 1} appears in both prompts: ${name}`,
    );
  }
  assert(
    batchSignalPositions.every((position, index) =>
      position !== -1 && (index === 0 || position > batchSignalPositions[index - 1])),
    'batch Block G preserves the canonical signal order',
  );

  const machineSummary = section(batch, '#### Machine Summary', 'Rules:');
  assert(
    batchBlockA.includes('`work_auth`'),
    'batch Block A explicitly produces work_auth',
  );
  assert(
    /^work_auth:/m.test(machineSummary),
    'batch Machine Summary YAML schema contains work_auth',
  );
} catch (error) {
  fail(`prompt parity tests crashed: ${error.message}`);
}
