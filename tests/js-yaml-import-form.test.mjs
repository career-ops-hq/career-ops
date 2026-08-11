// tests/js-yaml-import-form.test.mjs — no source file may import js-yaml's default
// export.
//
// js-yaml 5 ships a native ESM build with NO default export, so
// `import yaml from 'js-yaml'` fails to LINK on 5.x — the module never evaluates
// and the process dies before any of its code runs. The dynamic form is worse:
// `(await import('js-yaml')).default` is `undefined` rather than an error, so the
// first `yaml.load(...)` throws inside whatever try/catch surrounds it. In
// plugins/_engine.mjs that catch fails open by design, which turned an unreadable
// plugin config into a silent empty config.
//
// The repo was converted to `import * as yaml` wholesale, but a conversion only
// holds until the next file. rejection-latency.mjs landed with the default form
// while that conversion sat in review — which is exactly why the rule needs a
// guard rather than a one-time sweep.
//
// Scoped to source: node_modules is third-party and free to import however it
// likes, and a string LITERAL containing the pattern (test-all.mjs uses one as an
// import-parser fixture) is not an import.

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

console.log('\njs-yaml must never be imported via its (nonexistent) default export');

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'out']);
const EXTS = ['.mjs', '.js', '.ts', '.tsx'];

/** @returns {string[]} every source file under `dir`, recursively. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) found.push(...walk(full));
    else if (EXTS.some((e) => entry.endsWith(e))) found.push(full);
  }
  return found;
}

// Anchored at a statement start (allowing indentation) so the fixture STRING in
// test-all.mjs — `"import yaml from 'js-yaml';"`, quoted mid-line — does not match.
const STATIC_DEFAULT = /^\s*import\s+[A-Za-z_$][\w$]*\s*(?:,|from)\s*['"]js-yaml['"]/m;
const DYNAMIC_DEFAULT = /import\(\s*['"]js-yaml['"]\s*\)\s*\)?\s*\.default/;

const offenders = [];
// This file is exempt from its own sweep: it necessarily CONTAINS both offending
// forms, as the literals the detector self-check below is built from. Exempting
// it by exact path (not by a name pattern) keeps the exemption from widening to
// any other file that happens to look similar.
const SELF = join(ROOT, 'tests', 'js-yaml-import-form.test.mjs');

for (const file of walk(ROOT)) {
  if (file === SELF) continue;
  let text;
  try { text = readFileSync(file, 'utf-8'); } catch { continue; }
  if (!text.includes('js-yaml')) continue;
  if (STATIC_DEFAULT.test(text)) offenders.push(`${relative(ROOT, file)} (static default import)`);
  else if (DYNAMIC_DEFAULT.test(text)) offenders.push(`${relative(ROOT, file)} (dynamic .default)`);
}

if (offenders.length === 0) {
  pass('every js-yaml import uses the namespace form, which works on 4.x and 5.x');
} else {
  fail(`js-yaml default import(s) — these break on js-yaml 5, use \`import * as yaml\`: ${offenders.join(', ')}`);
}

// Guard the guard: a regex that stopped matching would report a clean sweep
// forever. Prove both patterns still fire, and that the quoted-fixture case
// stays exempt.
const fires = STATIC_DEFAULT.test("import yaml from 'js-yaml';")
  && STATIC_DEFAULT.test('  import yaml from "js-yaml";')
  && DYNAMIC_DEFAULT.test("const yaml = (await import('js-yaml')).default;");
const exempt = !STATIC_DEFAULT.test(`      "import yaml from 'js-yaml';",`);
if (fires && exempt) {
  pass('the detector still matches both offending forms and ignores a quoted fixture');
} else {
  fail(`detector broken: fires=${fires} exempt=${exempt} — it would report a clean sweep regardless of the tree`);
}
