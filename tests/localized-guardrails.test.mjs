// Every localized shared context must carry the safety rules that protect
// authorship, factual sourcing, and human approval. English fallback alone is
// insufficient: a localized mode can be loaded without reading modes/_shared.md.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nlocalized shared-context guardrails');

const requiredGuardrails = [
  '<!-- guardrail:authorship -->',
  '<!-- guardrail:no-fabrication -->',
  '<!-- guardrail:source-exclusivity -->',
  '<!-- guardrail:human-approval -->',
];
const expectedLocalizedModes = [
  'ar', 'da', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja',
  'ko', 'nl', 'pl', 'pt', 'ru', 'tr', 'ua', 'zh-TW', 'zh',
];

const localizedModeNames = readdirSync(join(ROOT, 'modes'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && expectedLocalizedModes.includes(entry.name))
  .map((entry) => entry.name);
const missingLocalizedModes = expectedLocalizedModes.filter((mode) => !localizedModeNames.includes(mode));
const missingFiles = [];
const missingRules = [];

for (const mode of expectedLocalizedModes) {
  const file = join(ROOT, 'modes', mode, '_shared.md');
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    missingFiles.push(`modes/${mode}/_shared.md`);
    continue;
  }

  const lines = source.split(/\r?\n/);
  for (const marker of requiredGuardrails) {
    const markerIndex = lines.indexOf(marker);
    const followingLine = markerIndex === -1 ? '' : lines[markerIndex + 1] ?? '';
    if (markerIndex === -1 || !/^\*\*RULE\s*[:/]\s*\S.*\*\*/.test(followingLine)) {
      missingRules.push(`modes/${mode}/_shared.md: ${marker}`);
    }
  }
}

if (missingLocalizedModes.length === 0 && missingFiles.length === 0) {
  pass(`all ${expectedLocalizedModes.length} localized _shared.md files exist`);
} else {
  fail(`localized _shared.md files missing: ${[...missingLocalizedModes, ...missingFiles].join(', ')}`);
}

if (missingRules.length === 0) {
  pass(`all ${expectedLocalizedModes.length} localized _shared.md files keep each guardrail immediately followed by a RULE line`);
} else {
  fail(`localized guardrail rules missing or displaced: ${missingRules.join(', ')}`);
}
