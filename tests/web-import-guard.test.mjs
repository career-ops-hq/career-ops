// tests/web-import-guard.test.mjs — a module under tests/ that loads code from
// web/ checks that web/ exists before it does.
//
// update-system.mjs ships tests/ but never web/ (#3269), so everything here
// also runs on installs with no web/. CI cannot see the difference: it runs on
// a full checkout, where every import from web/ resolves. So each unguarded
// import was found on a user's install, one suite at a time: tracker-columns
// (#1675), profile-keywords-parity (#3166), title-fit. This asserts the
// property for every module under tests/ instead.
//
// It reads source, because no run on a full checkout can show what a checkout
// without web/ would do. It covers module loads, the shape all three took; a
// suite that READS a web/ file (#4165) is not checked here.
import { pass, fail, ROOT, walkFiles } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join, relative, sep } from 'path';

console.log('\nweb/ import guard — modules under tests/ check web/ exists before loading from it');

// A path into web/: join() or resolve() with a 'web' segment, or a string that
// starts at web/ or ../web/.
const WEB_PATH = /\b(?:join|resolve)\s*\([^)]*['"]web['"]|['"`](?:\.\.\/)*web\//;

// An import statement links before the module's first line runs, so no check
// can skip it.
const STATIC_IMPORT = /^[ \t]*(?:import|export|\})[^'"\n]*['"](?:\.\.\/)+web\//m;

/** Argument text of the call whose `(` is at `open`. */
function argAt(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return code.slice(open + 1, i);
  }
  return code.slice(open + 1);
}

/**
 * Does `src` load a module from web/, and is every such load preceded by an
 * existence check on a web/ path whose answer is used?
 *
 * Source order, not control flow: a check anywhere above the import counts.
 *
 * @param {string} src - Module source.
 * @returns {{loads: boolean, problem: string|null}}
 */
function inspectWebImports(src) {
  // Whole-line comments go, so prose quoting an import is not read as one.
  const code = src.split('\n').filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join('\n');
  if (STATIC_IMPORT.test(code)) {
    return { loads: true, problem: 'static import from web/, which no check can skip: load it with import() instead' };
  }

  // Names bound to a web/ path, followed through `const b = join(a, ...)`.
  const names = new Set();
  const isWeb = (expr) => WEB_PATH.test(expr) || [...names].some((n) => new RegExp(`\\b${n}\\b`).test(expr));
  const bindings = [...code.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*([^;\n]+)/g)]
    .filter(([, , rhs]) => /^(?:(?:join|resolve|pathToFileURL|new\s+URL)\s*\(|['"`])/.test(rhs));
  for (let grew = true; grew;) {
    grew = false;
    for (const [, name, rhs] of bindings) {
      if (!names.has(name) && isWeb(rhs)) { names.add(name); grew = true; }
    }
  }

  const calls = (re) => [...code.matchAll(re)].map((m) => ({ at: m.index, arg: argAt(code, m.index + m[0].length - 1) }));
  // A bare `existsSync(x);` statement computes the answer and drops it.
  const checks = calls(/\b(?:existsSync|fileExists)\s*\(/g)
    .filter((c) => isWeb(c.arg) && !/(?:^|[;{}])$/.test(code.slice(0, c.at).trimEnd()));
  const loads = calls(/\bimport\s*\(/g).filter((c) => isWeb(c.arg));
  const unchecked = loads.find((l) => !checks.some((c) => c.at < l.at));
  return {
    loads: loads.length > 0,
    problem: unchecked ? `import(${unchecked.arg.trim()}) with no existence check on web/ before it` : null,
  };
}

// The detector's limits must fail here rather than pass silently against the
// tree. The first three are the shapes that reached users.
const SHAPES = [
  // [shape, loads from web/, flagged, source]
  ['title-fit before this fix', true, true,
    "try { const m = await import(pathToFileURL(join(ROOT, 'web', 'src', 'lib', 'title-fit.mjs')).href); } catch (e) { fail(e.message); }"],
  ['a static import, as before #3166', true, true,
    "import { profileTargetKeywords as web } from '../web/src/lib/profile-keywords.mjs';"],
  ['a relative import(), as before #1677', true, true,
    "const { loadHeaderAliases } = await import('../web/src/lib/tracker-table.mjs');"],
  ['the house shape, through a chain of names', true, false, [
    "const WEB = join(ROOT, 'web');",
    "const MOD = join(WEB, 'src', 'lib', 'x.mjs');",
    "if (!existsSync(join(WEB, 'src'))) warn('skip');",
    "else if (!existsSync(MOD)) fail('moved?');",
    'else await import(pathToFileURL(MOD).href);',
  ].join('\n')],
  ["page-format's node:test skip", true, false, [
    "const webOwner = join(ROOT, 'web', 'src', 'lib', 'page-formats.mjs');",
    "if (!existsSync(webOwner)) return t.skip('no web/');",
    'const web = await import(pathToFileURL(webOwner).href);',
  ].join('\n')],
  ['a check after the import', true, true, [
    "const m = await import(pathToFileURL(join(ROOT, 'web', 'x.mjs')).href);",
    "if (!existsSync(join(ROOT, 'web'))) warn('skip');",
  ].join('\n')],
  ['a check on another path', true, true,
    "if (existsSync(join(ROOT, 'cv.md'))) await import(pathToFileURL(join(ROOT, 'web', 'x.mjs')).href);"],
  ['a check whose answer is dropped', true, true, [
    "existsSync(join(ROOT, 'web'));",
    "await import(pathToFileURL(join(ROOT, 'web', 'x.mjs')).href);",
  ].join('\n')],
  ['an import quoted in a comment', false, false, [
    "// await import(pathToFileURL(join(ROOT, 'web', 'x.mjs')).href) crashed here once",
    'const ok = true;',
  ].join('\n')],
  ['a core module', false, false,
    "const { scan } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);"],
];
const misread = SHAPES.filter(([, loads, flagged, src]) => {
  const got = inspectWebImports(src);
  return got.loads !== loads || Boolean(got.problem) !== flagged;
}).map(([shape]) => shape);
if (misread.length === 0) pass(`the detector reads all ${SHAPES.length} fixture shapes correctly`);
else fail(`the detector misreads: ${misread.join('; ')}`);

// Every module, not only suites: a helper that imports from web/ takes down
// every suite that imports it.
const SELF = 'tests/web-import-guard.test.mjs';
const loaders = [];
const problems = [];
for (const file of walkFiles(join(ROOT, 'tests'), /\.mjs$/)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (rel === SELF) continue;   // its fixtures are the shapes it flags
  const { loads, problem } = inspectWebImports(readFileSync(file, 'utf-8'));
  if (loads) loaders.push(rel);
  if (problem) problems.push(`${rel}: ${problem}`);
}
if (loaders.length === 0) {
  // None found means the detector stopped matching, which must not read as
  // "all guarded". If the imports from web/ really are gone, so is the need
  // for this file.
  fail('found no module under tests/ that loads from web/ — the detector stopped matching');
} else if (problems.length === 0) {
  pass(`all ${loaders.length} modules under tests/ that load from web/ check it exists first (${loaders.join(', ')})`);
} else {
  for (const p of problems) {
    fail(`${p} — a checkout without web/ crashes here (#3269); guard it with existsSync(join(ROOT, 'web', 'src')) as tests/profile-keywords-parity.test.mjs does`);
  }
}
