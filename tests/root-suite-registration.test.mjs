// tests/root-suite-registration.test.mjs — every root-level *.test.mjs must be
// registered in test-all.mjs, because nothing discovers them.
//
// test-all.mjs auto-discovers tests/**/*.test.mjs (#1440) and the comment on
// that function is explicit that discovery stops there: "root-level standalone
// *.test.mjs files are never picked up". Nine such suites live at the repo root
// and are named one by one in the `scripts` list instead. A list is a thing you
// can forget, and it was forgotten: jd-similarity.test.mjs was added with 20
// assertions and appeared in no runner at all — grep found it only in
// CHANGELOG.md and in the script it tests. It passed the whole time, which is
// the quiet half of this failure: an unrun suite reports nothing, so the repo
// looked exactly as green without it as with it.
//
// The same shape in the sibling `test/` directory (singular) is #3247 and is
// deliberately NOT asserted here: which mechanism should cover those five files
// is an open design question in that thread, and a guard written now would pin
// whichever answer I happened to prefer.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntest-all.mjs — root-level suite registration');

const harness = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
const rootSuites = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.test.mjs'))
  .map((e) => e.name)
  .sort();

// 1. A degenerate list would pass assertion 2 forever while guarding nothing.
if (rootSuites.length > 0) {
  pass(`${rootSuites.length} root-level suites found to check`);
} else {
  fail('no root-level *.test.mjs found — this guard can no longer detect an unregistered suite');
}

// 2. The registration itself. Deliberately NOT a parse of the `scripts` array:
//    a suite reached by any mechanism at all — that list, an inline
//    `node --test`, a future glob — names the file, and the question here is
//    "does anything run this", not "which section does".
//
//    A bare substring is too generous in the other direction, though. This file
//    names jd-similarity.test.mjs in its own header, and test-all.mjs carries
//    filenames in prose too, so a suite dropped from `scripts` while its name
//    survived in a comment would still read as registered. Two narrowings close
//    that without giving up the mechanism-agnostic part: comments do not count,
//    and the name must sit inside quotes — which every real registration does
//    and no prose mention does.
const code = harness
  .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
  .replace(/^\s*\/\/.*$/gm, ' '); // whole-line comments

const QUOTES = new Set(["'", '"', '`']);
/** True when `name` appears quoted in executable code, optionally behind a path. */
function isRegistered(name) {
  for (let i = code.indexOf(name); i !== -1; i = code.indexOf(name, i + 1)) {
    const before = code[i - 1];
    const after = code[i + name.length];
    if (QUOTES.has(after) && (QUOTES.has(before) || before === '/')) return true;
  }
  return false;
}

const unregistered = rootSuites.filter((name) => !isRegistered(name));
if (unregistered.length === 0) {
  pass('every root-level *.test.mjs is named in executable code in test-all.mjs');
} else {
  fail(
    `${unregistered.length} root-level suite(s) are never run — nothing in test-all.mjs names them:\n` +
      unregistered.map((n) => `    ${n}`).join('\n') +
      "\n  Add an entry to the `scripts` list: { name: '<file>', expectExit: 0 }",
  );
}
