// tests/providers/_html-entities.test.mjs — direct coverage for the shared
// entity decoder (providers/_html-entities.mjs), extracted out of
// deutschebahn.mjs / hecklerkoch.mjs so the numeric-entity guard can't drift
// out of sync between copies again (#1555). CodeRabbit asked for this as a
// dedicated, provider-independent test for a "safety-critical" shared module.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — _html-entities (shared HTML entity decoder)');
try {
  const { decodeEntities } = await import(pathToFileURL(join(ROOT, 'providers/_html-entities.mjs')).href);

  if (decodeEntities('Program &amp; Release') === 'Program & Release') pass('decodeEntities decodes named entities (&amp;)');
  else fail(`named entity wrong: ${JSON.stringify(decodeEntities('Program &amp; Release'))}`);

  if (decodeEntities('f&#252;r Z&#xfc;rich') === 'für Zürich') pass('decodeEntities decodes decimal and hex numeric entities');
  else fail(`numeric entity wrong: ${JSON.stringify(decodeEntities('f&#252;r Z&#xfc;rich'))}`);

  if (decodeEntities('Z&#Xfc;rich') === 'Zürich') pass('decodeEntities decodes an uppercase hex marker (&#X..;)');
  else fail(`uppercase hex entity wrong: ${JSON.stringify(decodeEntities('Z&#Xfc;rich'))}`);

  // A numeric entity above 0x10FFFF is the one that actually throws
  // RangeError out of String.fromCodePoint; a lone surrogate half
  // (0xD800-0xDFFF) does not throw by itself but is rejected defensively
  // since it isn't a valid Unicode scalar value. Both must degrade to the
  // literal source text rather than crash.
  if (decodeEntities('Huge&#x110000;Entity') === 'Huge&#x110000;Entity') pass('decodeEntities degrades an out-of-range numeric entity (no RangeError crash)');
  else fail(`out-of-range entity wrong: ${JSON.stringify(decodeEntities('Huge&#x110000;Entity'))}`);

  if (decodeEntities('Bad&#xD800;Entity') === 'Bad&#xD800;Entity') pass('decodeEntities degrades a lone surrogate half');
  else fail(`surrogate entity wrong: ${JSON.stringify(decodeEntities('Bad&#xD800;Entity'))}`);

  if (decodeEntities('Negative&#-1;Entity') === 'Negative&#-1;Entity') pass('decodeEntities leaves a non-matching negative entity untouched');
  else fail(`negative entity wrong: ${JSON.stringify(decodeEntities('Negative&#-1;Entity'))}`);

  // Regression: the hex-charset alternative used to match decimal-looking
  // bodies too ("#x?[0-9a-fA-F]+"), so parseInt(…, 10) silently stopped at
  // the first hex letter and dropped the rest — "&#1a2;" decoded to "\x01"
  // and swallowed "a2" instead of passing the malformed entity through.
  if (decodeEntities('X&#1a2;Y') === 'X&#1a2;Y') pass('decodeEntities does not let hex letters leak into the decimal branch');
  else fail(`decimal/hex leak regression: ${JSON.stringify(decodeEntities('X&#1a2;Y'))}`);

  // ── XML 1.0 §2.2 Char: legal to construct, not legal to emit ──────
  // Upstreamed from providers/jobvite.mjs (#2623), whose private copy of this
  // decoder had grown stricter than the shared one. Everything below used to
  // decode into a job title, and from there into the tracker and every
  // generated document.
  const eq = (label, actual, expected) => {
    if (actual === expected) pass(label);
    else fail(`${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  };

  eq('decodeEntities refuses NUL (&#0;)', decodeEntities('Sr&#0;Manager'), 'Sr&#0;Manager');
  eq('decodeEntities refuses a hex NUL (&#x00;)', decodeEntities('Sr&#x00;Manager'), 'Sr&#x00;Manager');
  eq('decodeEntities refuses a C0 control (&#8;)', decodeEntities('A&#8;B'), 'A&#8;B');
  eq('decodeEntities refuses a C0 control (&#x1F;)', decodeEntities('A&#x1F;B'), 'A&#x1F;B');
  eq('decodeEntities refuses the U+FFFE noncharacter', decodeEntities('A&#xFFFE;B'), 'A&#xFFFE;B');
  eq('decodeEntities refuses the U+FFFF noncharacter', decodeEntities('A&#xFFFF;B'), 'A&#xFFFF;B');

  // The three C0 characters §2.2 does permit. These appear in real postings and
  // callers already normalize whitespace, so rejecting them would be a
  // regression, not extra safety.
  eq('decodeEntities still decodes tab (&#9;)', decodeEntities('A&#9;B'), 'A\tB');
  eq('decodeEntities still decodes LF (&#10;)', decodeEntities('A&#10;B'), 'A\nB');
  eq('decodeEntities still decodes CR (&#13;)', decodeEntities('A&#13;B'), 'A\rB');

  // Boundary pairs either side of each excluded range — the off-by-one a hand
  // written range check gets wrong.
  eq('decodeEntities decodes U+0020, the first printable', decodeEntities('A&#32;B'), 'A B');
  eq('decodeEntities decodes U+D7FF, last before the surrogates', decodeEntities('A&#xD7FF;B'), 'A퟿B');
  eq('decodeEntities refuses U+DFFF, last surrogate', decodeEntities('A&#xDFFF;B'), 'A&#xDFFF;B');
  eq('decodeEntities decodes U+E000, first after the surrogates', decodeEntities('A&#xE000;B'), 'AB');
  eq('decodeEntities decodes U+FFFD, the replacement char', decodeEntities('A&#xFFFD;B'), 'A�B');
  eq('decodeEntities decodes U+10000, first astral', decodeEntities('A&#x10000;B'), 'A\u{10000}B');
  eq('decodeEntities decodes U+10FFFF, the last code point', decodeEntities('A&#x10FFFF;B'), 'A\u{10FFFF}B');

  // C1 controls stay legal per §2.2 and are deliberately unchanged — this pins
  // the documented non-goal so a future HTML5 windows-1252 remap is a conscious
  // decision rather than an accident.
  eq('decodeEntities still decodes a C1 reference unchanged (&#146;)', decodeEntities('A&#146;B'), 'AB');

  // No entity survives as a half-decoded fragment: a rejected reference must
  // come back byte-identical, including its terminating semicolon.
  eq('a rejected entity keeps its exact source text',
    decodeEntities('&#0;&#xD800;&#x110000;&#xFFFF;'), '&#0;&#xD800;&#x110000;&#xFFFF;');
} catch (e) {
  fail(`_html-entities tests crashed: ${e.message}`);
}
