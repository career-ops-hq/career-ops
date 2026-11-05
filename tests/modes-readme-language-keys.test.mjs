// tests/modes-readme-language-keys.test.mjs — the `language:` snippet each
// localized mode README tells the user to paste into config/profile.yml uses
// keys career-ops reads.
//
// Seventeen READMEs said `primary: {lang}`. Nothing reads language.primary:
// every reader takes language.output (profile-language.mjs), so a user who
// followed the README to get reports in their language still got English, with
// no warning. The language block of config/profile.example.yml is the list of
// real keys.
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nMode READMEs — the language: snippet uses real profile keys');

// Keys under `language:` in the shipped example, commented-out ones included
// (modes_dir is optional there, so it is a comment).
const example = readFileSync(join(ROOT, 'config/profile.example.yml'), 'utf8');
const block = example.split(/^language:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
const known = new Set([...block.matchAll(/^\s{2}#?\s?([a-z_]+):/gm)].map((m) => m[1]));
if (known.has('output') && known.has('modes_dir')) pass(`profile.example.yml language keys: ${[...known].join(', ')}`);
else fail(`could not read output and modes_dir from config/profile.example.yml's language block (got ${JSON.stringify([...known])})`);

const readmes = readdirSync(join(ROOT, 'modes'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'modes', d.name, 'README.md')))
  .map((d) => `modes/${d.name}/README.md`)
  .sort();

let snippets = 0;
for (const rel of readmes) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  for (const [, body] of text.matchAll(/```ya?ml\n([\s\S]*?)```/g)) {
    const lang = body.split(/^language:\s*$/m)[1];
    if (lang === undefined) continue;
    snippets++;
    const keys = [...lang.split(/^\S/m)[0].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) fail(`${rel}: the language: snippet sets ${unknown.join(', ')}, which career-ops never reads (use output:)`);
    else if (!keys.includes('output')) fail(`${rel}: the language: snippet sets no output: key, so reports stay in English`);
    else pass(`${rel}: the language: snippet sets output:`);
  }
}
if (snippets >= 15) pass(`checked ${snippets} language: snippets`);
else fail(`found only ${snippets} language: snippets in modes/*/README.md — the scan is matching less than it should`);
