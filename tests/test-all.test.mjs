// tests/test-all.test.mjs — pins the comment handling of the two
// discovered-suite guards in test-all.mjs (PR #4180).
//
// THE BUG THIS PINS
//
// runDiscovered() refuses to import a suite whose source mentions either of
// the two calls that would end the whole run with a forged verdict (the
// process exit and the global-summary finisher). Both guards grepped the RAW source, so a suite whose
// comment explained why it makes neither call was failed as if it did.
// stripCommentLines() now removes comments first. The invariant it must keep:
// a comment can hide a mention, never a call. Code that shares a line with a
// comment, on either side of it, is still scanned.
//
// The test extracts the real stripCommentLines() out of test-all.mjs and runs
// it, so the test and the implementation cannot drift apart. The fixtures
// spell the forbidden calls in pieces: this file is itself a discovered suite
// and the guards read it.
import { pass, fail } from './helpers.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\ntest-all.mjs — discovered-suite guards ignore comments (PR #4180)');

const EXIT = 'process.' + 'exit(1)';
const FINISH = 'fin' + 'ish()';
const EXIT_RE = /\bprocess\.exit\s*\(/;
const FINISH_RE = /\bfinish\s*\(\s*\)/;

const strip = (() => {
  const m = SRC.match(/\nfunction stripCommentLines\(src\) \{\n[\s\S]*?\n\}\n/);
  if (!m) return null;
  try {
    return new Function(`${m[0]}\nreturn stripCommentLines;`)();
  } catch {
    return null;
  }
})();

if (typeof strip !== 'function') {
  fail('could not extract stripCommentLines() from test-all.mjs — this test needs updating');
} else {
  pass('extracted stripCommentLines() from test-all.mjs');

  const guarded = (SRC.match(/\.test\(stripCommentLines\(src\)\)/g) ?? []).length;
  if (guarded >= 2) pass(`both guards grep the stripped source (${guarded} call sites)`);
  else fail(`expected both guards to call stripCommentLines(src); found ${guarded}`);

  // A fixture is a small suite body; `hit` says whether a guard would fire.
  const cases = [
    // Mentions only: must NOT be flagged.
    { name: 'whole-line // comment', hit: false, src: `import x from './helpers.mjs';\n// never calls ${FINISH} — test-all owns the summary\n// nor ${EXIT}\nx();\n` },
    { name: 'starred block comment', hit: false, src: `/**\n * never calls ${EXIT}\n */\nx();\n` },
    { name: 'unstarred block-comment interior line', hit: false, src: `/*\n${EXIT} is never called here\n${FINISH} neither\n*/\nx();\n` },
    { name: 'block comment closing mid-line, mention before the close', hit: false, src: `/* ${EXIT}\n   still a comment */\nx();\n` },
    { name: 'two block comments on one line, no code', hit: false, src: `/* a */ /* ${FINISH} */\nx();\n` },
    { name: 'indented // comment', hit: false, src: `function f() {\n    // ${EXIT} would forge the verdict\n}\n` },
    // Real calls: MUST be flagged, however they share a line with a comment.
    { name: 'call after a same-line block comment', hit: true, src: `function f() {\n  /* documented */ ${EXIT};\n}\n` },
    { name: 'call after a block comment closes mid-line', hit: true, src: `/* reason\n   ends here */ ${EXIT};\n` },
    { name: 'call after two block comments on one line', hit: true, src: `/* a */ /* b */ ${FINISH};\n` },
    { name: 'generator method: line starts with *', hit: true, src: `class P {\n  *gen() { ${FINISH}; }\n}\n` },
    { name: 'call with a trailing // comment (loud, by design)', hit: true, src: `${EXIT}; // never reached\n` },
    { name: 'plain call', hit: true, src: `x();\n${EXIT};\n` },
    { name: 'unclosed block opener: raw source is scanned (loud, by design)', hit: true, src: `const fixture = \`\n/* header\n\`;\n${EXIT};\n` },
    // Template literals: comment-looking text inside one is text, and an
    // interpolation there is executable. Nothing may be stripped inside.
    { name: 'interpolated call between /* and */ lines inside a template literal', hit: true, src: `const t = \`\n/* header\n\${${EXIT}}\n*/\n\`;\nx();\n` },
    { name: 'interpolated call on a //-looking line inside a template literal', hit: true, src: `const t = \`\n// \${${EXIT}}\n\`;\nx();\n` },
    { name: 'starred line inside a template literal is kept', hit: true, src: `const t = \`\n * \${${FINISH}}\n\`;\nx();\n` },
    { name: 'comment-only mention after a template literal closes', hit: false, src: `const t = \`\n/* text\n*/\n\`;\n// ${EXIT} is never called\nx();\n` },
    { name: 'backtick inside a quoted string does not open a template', hit: false, src: `const tick = '\`';\n// ${EXIT} is never called\nx();\n` },
    { name: 'backtick in a trailing // comment does not open a template', hit: false, src: `x(); // the \` char\n// ${FINISH} is never called\n` },
    { name: 'single-line template with a comment-looking body, then a comment-only mention', hit: false, src: `const t = \`/* not a comment */\`;\n// ${EXIT} is never called\nx();\n` },
  ];

  for (const c of cases) {
    const out = strip(c.src);
    const hit = EXIT_RE.test(out) || FINISH_RE.test(out);
    if (hit === c.hit) pass(`${c.hit ? 'flags' : 'ignores'}: ${c.name}`);
    else fail(`${c.name}: expected the guard to ${c.hit ? 'fire' : 'stay quiet'}, got ${hit ? 'fired' : 'quiet'}`);
  }

  // The stripper only ever removes comments: every code line of a
  // comment-free source survives, in order.
  const clean = `import { pass } from './helpers.mjs';\n\npass('ok');\nexport const n = 1;\n`;
  const lines = (t) => t.split('\n').filter((l) => l.trim() !== '');
  if (lines(strip(clean)).join('\n') === lines(clean).join('\n')) pass('comment-free source keeps every code line');
  else fail('stripCommentLines() dropped or reordered code lines of a comment-free source');
}
