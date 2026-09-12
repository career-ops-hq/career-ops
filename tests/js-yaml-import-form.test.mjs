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
// Scoped to TRACKED source, enumerated with `git ls-files`. A recursive walk with
// a skip-list cannot work here: it also reads whatever untracked scratch the tree
// happens to be carrying — a killed test-all.mjs run leaves a `.tmp-script-test-*`
// copy of the whole repo behind, and every pre-conversion file in it reports as an
// offender. Those paths are gitignored and ship to nobody, so the rule does not
// apply to them. `git ls-files` is exactly the set that ships; it needs no
// skip-list to maintain, never descends a symlinked directory, and cannot wander
// outside the repo.
//
// A string LITERAL containing the pattern (test-all.mjs uses one as an
// import-parser fixture) is not an import and must not match.

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, relative } from 'path';

console.log('\njs-yaml must never be imported via its (nonexistent) default export');

const EXTS = ['.mjs', '.js', '.ts', '.tsx'];

/** @returns {string[]} every tracked source file in the repo. */
function sourceFiles() {
  // -z: NUL-separated, so a path containing a newline or quote cannot split a
  // record and silently drop a file from the sweep.
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter((p) => p && EXTS.some((e) => p.endsWith(e)))
    .map((p) => join(ROOT, p));
}

// Every way to bind js-yaml's nonexistent default export:
//   import yaml from 'js-yaml'                    — the plain form
//   import yaml, { load } from 'js-yaml'          — default plus a named clause
//   import yaml, * as ns from 'js-yaml'           — default plus a namespace
//   import { default as yaml } from 'js-yaml'     — the same binding, written long
// All four fail to link on 5.x identically. `import * as yaml` and a bare named
// import (`{ load, dump }`) are the legal forms and must NOT match.
//
// Anchored at a statement start (allowing indentation) so the fixture STRING in
// test-all.mjs — `"import yaml from 'js-yaml';"`, quoted mid-line — does not match.
// Token separator: whitespace, or a block comment, or both. `import /* c */ yaml
// from 'js-yaml'` is a legal default import, and a plain `\s+` would step over it
// and report the file clean — the one failure direction that is silent.
const SEP = String.raw`(?:\s|/\*[\s\S]*?\*/)+`;
const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const DEFAULT_BINDING = String.raw`${IDENT}(?:\s*,\s*(?:\{[^}]*\}|\*${SEP}as${SEP}${IDENT}))?${SEP}from`;
const NAMED_DEFAULT = String.raw`\{[^}]*\bdefault\b[^}]*\}\s*from`;
const STATIC_DEFAULT = new RegExp(
  String.raw`^[^\S\n]*import${SEP}(?:${DEFAULT_BINDING}|${NAMED_DEFAULT})\s*['"]js-yaml['"]`,
  'm',
);

// KNOWN LIMIT — this is a text scan, not a parse. A line inside a template
// literal or a block comment that happens to *look* like a default import is
// reported as an offender (test-all.mjs's quoted single-line fixture is already
// handled; a multi-line one would not be). That direction is loud and
// self-correcting: CI goes red, a human reads the path, and the fixture gets an
// exemption. The dangerous direction is the silent one — a real import the sweep
// walks past — and that is what SEP above and the fail-closed branches below
// exist to prevent. Making this syntax-aware would mean parsing 138 .ts/.tsx
// files, so a TypeScript parser as a root dependency for one guard; every other
// source scan in test-all.mjs is text-based too. Not worth it unless a real
// fixture actually trips it.
const DYNAMIC_DEFAULT = /import\(\s*['"]js-yaml['"]\s*\)\s*\)?\s*\.default/;

const offenders = [];
// A file that cannot be read is not a file that passes. Anything unreadable is
// reported as its own failure rather than skipped, so the sweep cannot go green
// while silently covering less of the tree than it claims.
const unreadable = [];
// This file is exempt from its own sweep: it necessarily CONTAINS both offending
// forms, as the literals the detector self-check below is built from. Exempting
// it by exact path (not by a name pattern) keeps the exemption from widening to
// any other file that happens to look similar.
const SELF = join(ROOT, 'tests', 'js-yaml-import-form.test.mjs');

const scanned = sourceFiles();
for (const file of scanned) {
  if (file === SELF) continue;
  let text;
  try {
    text = readFileSync(file, 'utf-8');
  } catch (err) {
    unreadable.push(`${relative(ROOT, file)} (${err.code || err.message})`);
    continue;
  }
  if (!text.includes('js-yaml')) continue;
  if (STATIC_DEFAULT.test(text)) offenders.push(`${relative(ROOT, file)} (static default import)`);
  else if (DYNAMIC_DEFAULT.test(text)) offenders.push(`${relative(ROOT, file)} (dynamic .default)`);
}

// An empty file list means `git ls-files` returned nothing usable — a clean sweep
// over zero files is the failure mode this whole test exists to prevent.
if (scanned.length === 0) {
  fail('git ls-files produced no source files — the js-yaml sweep scanned nothing');
} else if (unreadable.length > 0) {
  fail(`could not read ${unreadable.length} tracked source file(s), so the js-yaml sweep is incomplete: ${unreadable.join(', ')}`);
} else if (offenders.length === 0) {
  pass(`every js-yaml import in ${scanned.length} tracked source files uses the namespace form, which works on 4.x and 5.x`);
} else {
  fail(`js-yaml default import(s) — these break on js-yaml 5, use \`import * as yaml\`: ${offenders.join(', ')}`);
}

// Guard the guard: a regex that stopped matching would report a clean sweep
// forever. Prove both patterns still fire, and that the quoted-fixture case
// stays exempt.
const fires = STATIC_DEFAULT.test("import yaml from 'js-yaml';")
  && STATIC_DEFAULT.test('  import yaml from "js-yaml";')
  && STATIC_DEFAULT.test("import yaml, { load } from 'js-yaml';")
  && STATIC_DEFAULT.test("import yaml, * as ns from 'js-yaml';")
  && STATIC_DEFAULT.test("import { default as yaml } from 'js-yaml';")
  && STATIC_DEFAULT.test('import { default as yaml, load } from "js-yaml";')
  && STATIC_DEFAULT.test("import /* keep 4.x */ yaml from 'js-yaml';")
  && STATIC_DEFAULT.test("import yaml /* the default */ from 'js-yaml';")
  && DYNAMIC_DEFAULT.test("const yaml = (await import('js-yaml')).default;");
// The namespace form and a plain named import are the two legal shapes; if either
// started matching, the sweep would fail on a correctly-written file.
const exempt = !STATIC_DEFAULT.test(`      "import yaml from 'js-yaml';",`)
  && !STATIC_DEFAULT.test("import * as yaml from 'js-yaml';")
  && !STATIC_DEFAULT.test("import { load, dump } from 'js-yaml';");
if (fires && exempt) {
  pass('the detector matches every default-import form and ignores the namespace, named, and quoted-fixture forms');
} else {
  fail(`detector broken: fires=${fires} exempt=${exempt} — it would report a clean sweep regardless of the tree`);
}
