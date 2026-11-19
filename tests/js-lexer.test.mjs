// tests/js-lexer.test.mjs — the one-pass JavaScript lexer behind plugin-audit.
//
// The audit decides what a plugin loads from tokens, so what a token says has
// to be what Node reads: cooked string and identifier values, comments that
// are comments and strings that are strings, and a regex literal told from a
// division by the token before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lexJs, MAX_RUNS } from '../lib/js-lexer.mjs';

const toks = (src) => lexJs(src).tokens;
const kinds = (src) => toks(src).map((t) => `${t.t}:${t.v}`);
const one = (src) => {
  const t = toks(src);
  assert.equal(t.length, 1, `expected one token for ${JSON.stringify(src)}, got ${JSON.stringify(t)}`);
  return t[0];
};

test('strings are cooked to the value Node reads', () => {
  const cases = [
    [String.raw`'a\x41B\u{43}'`, 'aABC'],
    [String.raw`"\n\t\r\b\f\v"`, '\n\t\r\b\f\v'],
    [String.raw`'\101\0\7'`, 'A\0\x07'],
    [String.raw`'\8\9\q'`, '89q'],
    [String.raw`'\u{1F600}'`, '\u{1F600}'],
    ["'a\\\nb'", 'ab'],
    ["'a\\\r\nb'", 'ab'],
    ["'a\\\rb'", 'ab'],
    ["'a\\ b'", 'ab'],
    [String.raw`'it\'s'`, "it's"],
    [String.raw`"say \"hi\""`, 'say "hi"'],
    ["' '", ' '],
    [String.raw`'\xZZ'`, 'xZZ'],
  ];
  for (const [src, want] of cases) {
    const t = one(src);
    assert.equal(t.t, 'string', src);
    assert.equal(t.v, want, `${src} cooked to ${JSON.stringify(t.v)}`);
  }
});

test('an unterminated string ends at the line break and lexing carries on', () => {
  assert.deepEqual(kinds("'abc\nfoo"), ['string:abc', 'ident:foo']);
  assert.deepEqual(kinds('"abc'), ['string:abc']);
});

test('comments are dropped and never reach into the next line or token', () => {
  assert.deepEqual(kinds('/* a */ x // y\n z /**/ w'), ['ident:x', 'ident:z', 'ident:w']);
  assert.deepEqual(kinds('a /* \n * / */ b'), ['ident:a', 'ident:b']);
  assert.deepEqual(kinds('// import /*\nimport x // */'), ['ident:import', 'ident:x']);
  assert.deepEqual(kinds('x /* never closed'), ['ident:x']);
  assert.deepEqual(kinds('#!/usr/bin/env node\nx'), ['ident:x']);
});

test('a decoy comment opener inside a string or template is text', () => {
  assert.deepEqual(kinds("'import /*' + x + '*/'"), ['string:import /*', 'punct:+', 'ident:x', 'punct:+', 'string:*/']);
  assert.deepEqual(kinds('`/*` x `*/`'), ['string:/*', 'ident:x', 'string:*/']);
});

test('identifiers are cooked and unicode-aware', () => {
  assert.equal(one(String.raw`require`).v, 'require');
  assert.equal(one(String.raw`r\u{65}quire`).v, 'require');
  assert.equal(one('naïve$_1').v, 'naïve$_1');
  assert.equal(one('\u{1d4d0}b').t, 'ident');
});

test('numbers do not split into identifiers', () => {
  for (const n of ['1_000', '0x1F', '0b101', '0o17', '.5', '1.5e+3', '10n', '1.']) assert.equal(one(n).t, 'num', n);
  assert.deepEqual(kinds('1 / 2 / 3').map((k) => k.split(':')[0]), ['num', 'punct', 'num', 'punct', 'num']);
});

test('template literals nest and a plain one is a string', () => {
  assert.deepEqual(kinds('`a`'), ['string:a']);
  assert.deepEqual(kinds('`a${x}b${y}c`').map((k) => k.replace(/:.*/, '')), ['tpl', 'ident', 'tpl', 'ident', 'tpl']);
  const nested = toks('`a${ `b${c}d` + \'}\' }e`');
  assert.deepEqual(nested.map((t) => t.t), ['tpl', 'tpl', 'ident', 'tpl', 'punct', 'string', 'tpl']);
  assert.equal(nested.at(-1).v, 'e');
  assert.equal(nested.at(-1).open, false);
  assert.deepEqual(kinds('`${ {a: 1}.a }`').slice(1, -1), ['punct:{', 'ident:a', 'punct::', 'num:1', 'punct:}', 'punct:.', 'ident:a']);
  assert.equal(one('`\\u0061\\n`').v, 'a\n');
});

test('a regex literal is told from a division by the token before it', () => {
  const regexes = [
    'x = /ab+c/g', 'if (x) /\'/.test(y)', 'while (x) /a/.exec(s)', 'for (;;) /a/.test(s)', 'return /x/', 'typeof /x/',
    'a, /x/', 'a = [/x/]', '(/x/)', 'a ? /x/ : /y/', '!/x/.test(s)', 'a && /x/.test(s)', 'case /x/:', '{} /x/.test(s)',
    'function f() {} /x/.test(s)', 'x = /[/]/', 'x = /\\//', 'x = /[\\]/]/u', 'void /x/', 'yield /x/',
  ];
  // `{}`, `yield` and the like may or may not be followed by a regex, so one run reads it as one.
  const anyRun = (src) => lexJs(src).runs.some((r) => r.tokens.some((t) => t.t === 'regex'));
  for (const src of regexes) assert.ok(anyRun(src), `${src} should contain a regex: ${kinds(src)}`);
  const divisions = [
    'a = b / c / d', '(a) / 2', 'a[0] / 2', 'a++ / 2', 'x = {} / 2', 'this / 2', 'x = 1 / 2', 'a.b / c', 'f(x) / 2',
    "'s' / 2", 'x = (1) / 2 / 3', 'null / 2', 'a = { b: 1 } / 2', 'a.in / 2 / b', 'a?.return / 2 / b', 'x.typeof / 2 / y',
  ];
  for (const src of divisions) assert.ok(!toks(src).some((t) => t.t === 'regex'), `${src} has no regex: ${kinds(src)}`);
  assert.equal(toks('x = /[/]/g').find((t) => t.t === 'regex').v, '/[/]/g');
  assert.equal(toks('x = /a\\/b/').find((t) => t.t === 'regex').v, '/a\\/b/');
});

test('a regex guess with no closing slash on the line falls back to division', () => {
  assert.deepEqual(kinds('if (x) / 2'), ['ident:if', 'punct:(', 'ident:x', 'punct:)', 'punct:/', 'num:2']);
});

test('a quote inside a regex or a division does not start a string', () => {
  assert.deepEqual(kinds("x = /'/; y"), ['ident:x', 'punct:=', "regex:/'/", 'punct:;', 'ident:y']);
  assert.ok(!toks("a = (b) / 2; c = 'x'").some((t) => t.t === 'regex'));
});

test('punctuators are read longest-first and HTML-like comments are not comments', () => {
  assert.deepEqual(kinds('a?.b ?? c ... d => e'), ['ident:a', 'punct:?.', 'ident:b', 'punct:??', 'ident:c', 'punct:...', 'ident:d', 'punct:=>', 'ident:e']);
  assert.deepEqual(kinds('a?.5:1'), ['ident:a', 'punct:?', 'num:.5', 'punct::', 'num:1']);
  assert.deepEqual(kinds('a <!-- b'), ['ident:a', 'punct:<', 'punct:!', 'punct:--', 'ident:b']);
});

test('lineOf counts CRLF once and counts breaks inside comments and strings', () => {
  const src = 'a\r\nb\rc\n/* x\ny */ d e \'f\\\ng\' h';
  const { tokens, lineOf } = lexJs(src);
  const line = (v) => lineOf(tokens.find((t) => t.v === v).pos);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'h'].map(line), [1, 2, 3, 5, 6, 7]);
});

test('tokens that cannot be classified do not stop the pass', () => {
  assert.deepEqual(kinds('a \\ b # c @'), ['ident:a', 'punct:\\', 'ident:b', 'punct:#', 'ident:c', 'punct:@']);
});

test('a regex after the header of for await is a regex', () => {
  assert.ok(toks("for await (const x of y) /'/.test(x)").some((t) => t.t === 'regex'));
});

// Where a `/` could be either, the lexer reads it both ways and returns every
// reading as a run. A run is one complete choice for every ambiguous site.
const runKinds = (src, opts) => lexJs(src, opts).runs.map((r) => r.tokens.map((t) => `${t.t}:${t.v}`).join(' '));

test('a slash after a word that may be an identifier is read both ways', () => {
  for (const src of ['of / 2 / 3', 'await / 2 / 3', 'yield / 2 / 3', 'k++ / 2 / 3', '{} / 2 / 3', 'class {} / 2 / 3']) {
    const { runs } = lexJs(src);
    assert.equal(runs.length, 2, `${src}: ${runKinds(src)}`);
    assert.ok(runs.some((r) => r.tokens.some((t) => t.t === 'regex')), src);
    assert.ok(runs.some((r) => !r.tokens.some((t) => t.t === 'regex')), src);
  }
});

test('a slash whose meaning is fixed by the tokens before it has one reading', () => {
  for (const src of ['a / 2 / 3', '(a) / 2 / 3', 'a[0] / 2 / 3', 'x.of / 2 / 3', 'this.#of / 2 / 3', 'a.if(1) / 2 / 3', 'return /x/', 'x = /x/', 'if (x) /y/.test(s)', '`${a}` / 2 / 3', '1 / 2 / 3']) {
    assert.equal(lexJs(src).runs.length, 1, `${src}: ${runKinds(src)}`);
  }
});

test('a regex reading with no closing slash on its line is not a reading', () => {
  assert.equal(lexJs('of / 2').runs.length, 1);
  assert.equal(lexJs('{}\n/ 2').runs.length, 1);
});

test('independent ambiguous slashes multiply the readings, and the first reading is the division', () => {
  const src = 'of / 1 / 2;\n{} / 3 / 4;';
  const { runs, tokens } = lexJs(src);
  assert.equal(runs.length, 4);
  assert.equal(tokens, runs[0].tokens);
  assert.ok(!tokens.some((t) => t.t === 'regex'));
});

test('too many ambiguous slashes stop at a cap', () => {
  const { runs, capped } = lexJs('x = {} / 1 / 2;\n'.repeat(200));
  assert.equal(capped, true);
  assert.ok(runs.length <= MAX_RUNS, `${runs.length} runs`);
  assert.equal(lexJs('x = {} / 1 / 2;\n').capped, false);
});

test('a run that ends inside a template or a block comment is incomplete', () => {
  for (const src of ['`abc', '/* abc', '`a${ b', '`a${`b${c}`']) {
    const { runs } = lexJs(src);
    assert.ok(runs.every((r) => r.incomplete), `${JSON.stringify(src)} should be incomplete`);
  }
  for (const src of ['`abc`', '/* abc */', '`a${b}c`', "'abc", '/abc']) {
    assert.ok(lexJs(src).runs.every((r) => !r.incomplete), `${JSON.stringify(src)} should be complete`);
  }
});

test('a misread run that swallows the rest of the file is incomplete and the true run is not', () => {
  const { runs } = lexJs("let of = 1, v = of / 2 + '/`'.length;\nimport 'x';\n");
  assert.equal(runs.length, 2);
  // Read as a regex, `/ 2 + '/` is followed by a backtick that never closes.
  assert.deepEqual(runs.map((r) => r.incomplete), [false, true]);
  const swallowed = lexJs('L: {}\n/`/.test(a);\nimport "x";\n');
  assert.ok(swallowed.runs.some((r) => r.incomplete));
  assert.ok(swallowed.runs.some((r) => !r.incomplete && r.tokens.some((t) => t.v === 'import')));
});

test('HTML-like comments are read both ways outside an ES module', () => {
  const html = { html: true };
  assert.deepEqual(runKinds('a = 1; <!-- b\nc', html), ['ident:a punct:= num:1 punct:; punct:< punct:! punct:-- ident:b ident:c', 'ident:a punct:= num:1 punct:; ident:c']);
  assert.equal(lexJs('a <!-- b', { html: false }).runs.length, 1);
  assert.equal(lexJs('a <!-- b').runs.length, 1);
  assert.equal(lexJs('x\n  --> y', html).runs.length, 2);
  assert.equal(lexJs('--> y', html).runs.length, 2);
  assert.equal(lexJs('/* a\n b */ --> y', html).runs.length, 2);
  assert.equal(lexJs('x --> y', html).runs.length, 1);
  assert.equal(lexJs('x /* a */ --> y', html).runs.length, 1);
  assert.equal(lexJs('/* a */ --> y', html).runs.length, 2);
});

test('a regex scan that fails on a long line takes time linear in its length', () => {
  const started = Date.now();
  lexJs('z = 1' + ' /['.repeat(100000));
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started}ms`);
});

test('an unclosed \\u{ escape does not search the rest of the file', () => {
  const started = Date.now();
  const { tokens } = lexJs("'" + '\\u{'.repeat(300000) + "'");
  assert.equal(tokens.length, 1);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started}ms`);
  assert.equal(lexJs(String.raw`'\u{0000000041}'`).tokens[0].v, 'A');
  assert.equal(lexJs(String.raw`'\u{110000}'`).tokens[0].v, 'u{110000}');
});
