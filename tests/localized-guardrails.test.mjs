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
  'ar', 'at', 'da', 'de', 'es', 'fr', 'hi', 'id', 'in', 'it', 'ja',
  'ko', 'nb', 'nl', 'pl', 'pt', 'ru', 'sg', 'tr', 'ua', 'vi', 'zh-TW', 'zh',
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

// #2395: "the ONLY sources" bounds nothing unless it says which files those
// are, and most localized tables list three of the eight. The names come from
// the English table, so a source added there must reach every locale's rule.
// File names stay in English in every translation, so this survives one.
const englishShared = readFileSync(join(ROOT, 'modes', '_shared.md'), 'utf8').replace(/\r\n/g, '\n');
const sourcesTable = englishShared.match(/## Sources of Truth \(EXCLUSIVE\)\n[\s\S]*?\n(\| File \|[\s\S]*?)\n\n/)?.[1] ?? '';
const sourceNames = sourcesTable.split('\n').slice(2).map((row) => row.split('|')[1]?.trim()).filter(Boolean);
const unnamedSources = [];
for (const mode of gradedModes) {
  let lines;
  try {
    lines = readFileSync(join(ROOT, 'modes', mode, '_shared.md'), 'utf8').split(/\r?\n/);
  } catch {
    continue;
  }
  const markerIndex = lines.indexOf('<!-- guardrail:source-exclusivity -->');
  if (markerIndex === -1) continue;
  const rule = lines[markerIndex + 1] ?? '';
  const missing = sourceNames.filter((name) => !rule.includes(name));
  if (missing.length) unnamedSources.push(`modes/${mode}/_shared.md (${missing.join(', ')})`);
}
if (sourceNames.length < 6) {
  fail(`could not read the Sources of Truth table in modes/_shared.md (found ${sourceNames.length} rows)`);
} else if (unnamedSources.length === 0) {
  pass(`every localized source-exclusivity rule names all ${sourceNames.length} sources in the English table`);
} else {
  fail(`localized source-exclusivity rules leave sources unnamed: ${unnamedSources.join('; ')}`);
}

// #2395/#6627: most market sets ship no cover.md, email.md or contacto.md, and
// even the modes they do ship only carry the rules a translator copied. A
// scalar modes_dir must therefore layer the market files on the English canon,
// not swap them in: the router always reads the English modes/_shared.md and
// modes/{mode}.md first, or every uncopied rule silently disappears.
const router = readFileSync(join(ROOT, '.agents', 'skills', 'career-ops', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const layersCanon = /always read the English version first \(the English `modes\/_shared\.md` and the English `modes\/\{mode\}\.md`/.test(router);
const englishWins = /the English rule wins/.test(router);
const keepsTriageLean = /never adds a file the mode's section does not load/.test(router);
const listRespectsModes = /A mode whose section loads no `_shared\.md` \(such as `triage`\) still loads only its mode file/.test(router);
const workerPrecedence = /when a localized file contradicts an English workflow rule, follow the English rule/.test(router);
const dedupesBaseline = /already covered by the English read, so never read it twice/.test(router);
const workerListModes = /each declared modes_dir directory's version of that mode file, skipping a declared entry that resolves to the English modes directory already read/.test(router);
const workerSkipsBaselineTwice = (router.match(/skipping a declared entry that resolves to the English modes directory already read/g) || []).length === 2;
const evalFirstRouter = /use only the FIRST entry's evaluation-mode file for Blocks A-F/.test(router);
const evalFirstWorker = /only the FIRST entry's evaluation-mode file, later entries contribute context/.test(router);
if (layersCanon && englishWins && keepsTriageLean && listRespectsModes && workerPrecedence && dedupesBaseline && workerListModes && workerSkipsBaselineTwice && evalFirstRouter && evalFirstWorker) {
  pass('router layers localized files on the English canon for a scalar modes_dir, with English precedence, no extra files, list dedupe, and the precedence rule carried into worker prompts');
} else {
  fail('router layering contract regressed: canon-first=' + layersCanon + ' english-precedence=' + englishWins + ' no-extra-files=' + keepsTriageLean + ' list-respects-modes=' + listRespectsModes + ' worker-precedence=' + workerPrecedence + ' dedupes-baseline=' + dedupesBaseline + ' worker-list-modes=' + workerListModes + ' worker-skips-baseline-both-segments=' + workerSkipsBaselineTwice + ' eval-first-router=' + evalFirstRouter + ' eval-first-worker=' + evalFirstWorker);
}
