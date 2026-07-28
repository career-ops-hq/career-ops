#!/usr/bin/env node

/**
 * patch-latex-content.mjs — Apply prose patches to a user-owned LaTeX CV in place.
 *
 * Usage:
 *   node patch-latex-content.mjs <source.tex> <patches.json> <output.tex>
 *
 * patches.json:
 *   { "patches": [ { "id": "bullet-0", "text": "Tailored bullet text" } ] }
 *
 * Optional manifest fields in patches.json (from extract-latex-content.mjs):
 *   { "slots": [...], "patches": [...] }
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { pathToFileURL } from 'url';
import { applyPatches } from './lib/latex-content.mjs';

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--help');
  const [sourcePath, patchesPath, outputPath] = args;

  if (!sourcePath || !patchesPath || !outputPath) {
    console.error('Usage: node patch-latex-content.mjs <source.tex> <patches.json> <output.tex>');
    process.exit(1);
  }

  const absSource = resolve(sourcePath);
  const absPatches = resolve(patchesPath);
  const absOutput = resolve(outputPath);

  if (!existsSync(absSource)) {
    console.error(`Source not found: ${absSource}`);
    process.exit(1);
  }
  if (!existsSync(absPatches)) {
    console.error(`Patches file not found: ${absPatches}`);
    process.exit(1);
  }

  let tex;
  let payload;
  try {
    tex = await readFile(absSource, 'utf-8');
    payload = JSON.parse(await readFile(absPatches, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read input: ${err.message}`);
    process.exit(1);
  }

  const patches = Array.isArray(payload.patches) ? payload.patches : [];
  const slots = Array.isArray(payload.slots) ? payload.slots : [];

  if (slots.length === 0) {
    console.error('patches.json must include a slots array from extract-latex-content.mjs');
    process.exit(1);
  }

  const missing = patches.filter(p => !slots.some(s => s.id === p.id));
  if (missing.length > 0) {
    console.error(`Unknown patch ids: ${missing.map(p => p.id).join(', ')}`);
    process.exit(1);
  }

  const patched = applyPatches(tex, patches, slots);
  const outDir = dirname(absOutput);
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }
  await writeFile(absOutput, patched, 'utf-8');

  const report = {
    source: absSource,
    output: absOutput,
    patched: patches.length,
    valid: true,
  };
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
