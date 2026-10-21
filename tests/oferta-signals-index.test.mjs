import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

function check(label, ok, detail) {
  if (ok) pass(label);
  else fail(`${label}: ${detail}`);
}

const oferta = readFileSync(join(ROOT, 'modes', 'oferta.md'), 'utf8');
const dir = join(ROOT, 'modes', 'oferta-signals');
const files = existsSync(dir) ? readdirSync(dir).sort() : [];
const indexed = [...oferta.matchAll(/^\*\*(\d+)\. .+?\*\*\. Read `modes\/oferta-signals\/([^`]+)` when .+\.$/gm)];

check('oferta indexes conditional signals 8 to 17 in order',
  JSON.stringify(indexed.map((m) => Number(m[1]))) === JSON.stringify([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
  `got ${JSON.stringify(indexed.map((m) => m[1]))}`);
check('every indexed signal file exists and every signal file is indexed',
  files.length > 0 && JSON.stringify(indexed.map((m) => m[2]).sort()) === JSON.stringify(files),
  `index ${JSON.stringify(indexed.map((m) => m[2]))} vs files ${JSON.stringify(files)}`);
for (const [, n, file] of indexed) {
  const body = existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8') : '';
  check(`signal ${n} file opens with its own heading`, body.startsWith(`**${n}. `), `${file} starts with ${JSON.stringify(body.slice(0, 20))}`);
}
