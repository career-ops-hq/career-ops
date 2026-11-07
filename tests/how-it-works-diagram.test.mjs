// tests/how-it-works-diagram.test.mjs — the README "How It Works" diagram.
//
// The diagram is an SVG pair rendered by .github/scripts/how-it-works.mjs. Two
// things can drift: an SVG edited by hand (the next --write would undo it), and
// a README pointing at the wrong language's pair or carrying alt text that no
// longer says what the image says. Both are pinned here.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { pass, fail, ROOT } from './helpers.mjs';
import { LOCALES, svgPath, altText } from '../.github/scripts/how-it-works.mjs';

console.log('\nREADME How It Works diagram — SVGs and their embeds');

{
  const r = spawnSync(process.execPath, [join(ROOT, '.github', 'scripts', 'how-it-works.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) pass('every How It Works SVG matches what the script renders');
  else fail(`How It Works SVGs drifted: ${String(r.stderr || r.stdout).trim().split('\n')[0]}`);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const readmes = readdirSync(ROOT).filter((f) => /^README(\.[\w-]+)?\.md$/.test(f));
for (const file of readmes) {
  const suffix = file.slice('README.'.length, -'.md'.length);
  const lang = suffix in LOCALES ? suffix : '';
  const expected = `<picture><source media="(prefers-color-scheme: dark)" srcset="${svgPath(lang, 'dark')}">`
    + `<img src="${svgPath(lang, 'light')}" alt="${esc(altText(lang))}" width="760"></picture>`;
  const text = readFileSync(join(ROOT, file), 'utf8');
  if (text.includes(expected)) pass(`${file} embeds the ${lang || 'English'} diagram with matching alt text`);
  else fail(`${file}: How It Works <picture> missing, pointing at the wrong pair, or alt text out of date`);
}
