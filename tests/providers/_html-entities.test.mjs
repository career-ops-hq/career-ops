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
} catch (e) {
  fail(`_html-entities tests crashed: ${e.message}`);
}
