// tests/jsonc-parse.test.mjs — the JSONC tolerance used for OpenCode configs
// (#2252). doctor.mjs's end-to-end detection lives in
// tests/playwright-mcp-detection.test.mjs; this file owns the parser itself,
// where the interesting cases are the ones a naive regex stripper corrupts:
// "//" inside a string, an escaped quote, a comma inside a string value.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\njsonc-parse.mjs — comment and trailing-comma tolerance');

try {
  const { parseJsonc, parseConfigByExtension } = await import(
    pathToFileURL(join(ROOT, 'jsonc-parse.mjs')).href
  );

  const check = (label, actual, expected) => {
    const got = JSON.stringify(actual);
    const want = JSON.stringify(expected);
    if (got === want) pass(label);
    else fail(`${label} => ${got}, expected ${want}`);
  };

  // Plain JSON must survive untouched — the tolerance is additive.
  check('plain JSON is unchanged', parseJsonc('{"a":1,"b":[2,3]}'), { a: 1, b: [2, 3] });

  check('line comments are dropped', parseJsonc('{\n // why\n "a": 1 // trailing\n}'), { a: 1 });
  check('block comments are dropped', parseJsonc('{ /* why */ "a": /* mid */ 1 }'), { a: 1 });
  check('a block comment spanning lines is dropped', parseJsonc('{\n/*\n multi\n*/\n"a": 1}'), { a: 1 });

  check('a trailing comma before } is dropped', parseJsonc('{"a": 1,}'), { a: 1 });
  check('a trailing comma before ] is dropped', parseJsonc('{"a": [1, 2,]}'), { a: [1, 2] });
  check('nested trailing commas are dropped', parseJsonc('{"a": {"b": [1,],},}'), { a: { b: [1] } });
  check('a trailing comma with whitespace and a comment', parseJsonc('{"a": 1, // note\n}'), { a: 1 });

  // The cases a regex-based stripper gets wrong.
  check('// inside a string is content, not a comment',
    parseJsonc('{"url": "https://example.com/a"}'), { url: 'https://example.com/a' });
  check('/* inside a string is content',
    parseJsonc('{"glob": "src/*/index.mjs"}'), { glob: 'src/*/index.mjs' });
  check('an escaped quote does not end the string',
    parseJsonc('{"say": "a \\" // b"}'), { say: 'a " // b' });
  check('a backslash-heavy Windows path survives',
    parseJsonc('{"path": "C:\\\\tmp\\\\a"}'), { path: 'C:\\tmp\\a' });
  check('a comma before } inside a string is not touched',
    parseJsonc('{"a": "x, }"}'), { a: 'x, }' });
  check('a brace inside a string does not trigger comma removal',
    parseJsonc('{"a": "}", "b": 1,}'), { a: '}', b: 1 });

  // Realistic OpenCode config: comments, trailing commas, and a URL.
  check('an OpenCode-shaped JSONC config parses',
    parseJsonc([
      '{',
      '  // MCP servers',
      '  "mcp": {',
      '    "playwright": {',
      '      "type": "local",',
      '      "command": ["npx", "@playwright/mcp"], /* headless by default */',
      '      "docs": "https://example.com//mcp",',
      '    },',
      '  },',
      '}',
    ].join('\n')),
    { mcp: { playwright: { type: 'local', command: ['npx', '@playwright/mcp'], docs: 'https://example.com//mcp' } } });

  // Malformed beyond the two tolerated extensions still throws.
  let threw = false;
  try { parseJsonc('{ "a": [ }'); } catch { threw = true; }
  if (threw) pass('a genuinely malformed document still throws');
  else fail('malformed JSONC should throw, not silently parse');

  // Extension routing: .jsonc tolerates, everything else stays strict.
  check('.jsonc is parsed tolerantly',
    parseConfigByExtension('opencode.jsonc', '{"a": 1,}'), { a: 1 });
  check('.JSONC is matched case-insensitively',
    parseConfigByExtension('/tmp/OPENCODE.JSONC', '{"a": 1,}'), { a: 1 });

  let strictThrew = false;
  try { parseConfigByExtension('opencode.json', '{"a": 1,}'); } catch { strictThrew = true; }
  if (strictThrew) pass('.json keeps strict parsing — a trailing comma still throws');
  else fail('.json must not gain JSONC tolerance');
} catch (e) {
  fail(`jsonc-parse tests crashed: ${e.message}`);
}
