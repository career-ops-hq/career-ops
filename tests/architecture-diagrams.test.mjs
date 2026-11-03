// tests/architecture-diagrams.test.mjs — the architecture diagrams.
//
// Each diagram is an SVG pair rendered by .github/scripts/architecture-diagrams.mjs
// and embedded in ARCHITECTURE.md or docs/ARCHITECTURE.md. Two things can
// drift: an SVG edited by hand (the next --write would undo it), and a doc
// pointing at the wrong pair, at a path that does not resolve from the doc's
// own directory, or carrying alt text that no longer says what the image says.
// Both are pinned here.

import { readFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { spawnSync } from 'child_process';
import { pass, fail, ROOT } from './helpers.mjs';
import { DIAGRAMS, ALT, svgPath } from '../.github/scripts/architecture-diagrams.mjs';

console.log('\nArchitecture diagrams — SVGs and their embeds');

{
  const r = spawnSync(process.execPath, [join(ROOT, '.github', 'scripts', 'architecture-diagrams.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) pass('every architecture SVG matches what the script renders');
  else fail(`architecture SVGs drifted: ${String(r.stderr || r.stdout).trim().split('\n')[0]}`);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

for (const [name, [, doc]] of Object.entries(DIAGRAMS)) {
  // Paths in a doc resolve from that doc's directory, so docs/ARCHITECTURE.md
  // names its pair without the docs/ prefix.
  const rel = (theme) => relative(dirname(doc), svgPath(name, theme)).split('\\').join('/');
  const expected = `<picture><source media="(prefers-color-scheme: dark)" srcset="${rel('dark')}">`
    + `<img src="${rel('light')}" alt="${esc(ALT[name])}" width="760"></picture>`;
  const text = readFileSync(join(ROOT, doc), 'utf8');
  if (text.includes(expected)) pass(`${doc} embeds the ${name} diagram with matching alt text`);
  else fail(`${doc}: ${name} <picture> missing, pointing at the wrong pair, or alt text out of date`);
}
