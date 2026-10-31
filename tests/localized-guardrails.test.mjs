// Every localized shared context must carry the safety rules that protect
// authorship, factual sourcing, and human approval. English fallback alone is
// insufficient: a localized mode can be loaded without reading modes/_shared.md.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nlocalized shared-context guardrails');

const requiredGuardrails = [
  '<!-- guardrail:authorship -->',
  '<!-- guardrail:no-fabrication -->',
  '<!-- guardrail:source-exclusivity -->',
  '<!-- guardrail:human-approval -->',
  '<!-- guardrail:agency-confirmation -->',
];
// The market sets known when this list was last touched: a floor, not the
// census. A set on this list that disappears fails below, but the sets graded
// are every modes/<dir>/ that ships a _shared.md, so a new market is graded the
// day it lands. This hand-kept list used to BE the census, and it had already
// drifted: modes/vi (#4727) shipped a _shared.md this file never opened.
const expectedLocalizedModes = [
  'ar', 'da', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja',
  'ko', 'nl', 'pl', 'pt', 'ru', 'sg', 'tr', 'ua', 'vi', 'zh-TW', 'zh',
];

const modeDirs = readdirSync(join(ROOT, 'modes'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const shippedLocalizedModes = modeDirs.filter((mode) => existsSync(join(ROOT, 'modes', mode, '_shared.md')));
const missingLocalizedModes = expectedLocalizedModes.filter((mode) => !modeDirs.includes(mode));
const gradedModes = [...new Set([...expectedLocalizedModes, ...shippedLocalizedModes])].sort();
const missingFiles = [];
const missingRules = [];

for (const mode of gradedModes) {
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

// Guard on the guard: a directory read that found nothing would grade nothing.
if (shippedLocalizedModes.length >= expectedLocalizedModes.length) {
  pass(`found ${shippedLocalizedModes.length} localized mode sets with a _shared.md`);
} else {
  fail(`found only ${shippedLocalizedModes.length} localized mode sets with a _shared.md, expected at least ${expectedLocalizedModes.length}`);
}

if (missingLocalizedModes.length === 0 && missingFiles.length === 0) {
  pass(`all ${gradedModes.length} localized _shared.md files exist`);
} else {
  fail(`localized _shared.md files missing: ${[...missingLocalizedModes, ...missingFiles].join(', ')}`);
}

if (missingRules.length === 0) {
  pass(`all ${gradedModes.length} localized _shared.md files keep each guardrail immediately followed by a RULE line`);
} else {
  fail(`localized guardrail rules missing or displaced: ${missingRules.join(', ')}`);
}
