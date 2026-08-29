// Direct, provider-independent coverage for providers/_safe-url.mjs. The
// cross-provider behaviour — each JSON provider dropping one bad posting rather
// than aborting the page — is in url-encoding-surrogate.test.mjs.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — _safe-url (encodeURIComponent that never throws)');

try {
  const { safeEncodeURIComponent } = await import(pathToFileURL(join(ROOT, 'providers/_safe-url.mjs')).href);

  const eq = (label, actual, expected) => {
    if (actual === expected) pass(label);
    else fail(`${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  };

  // ── A lone surrogate yields null, not a URIError ──
  // encodeURIComponent throws URIError on any UTF-16 code unit in 0xD800-0xDFFF
  // that is not part of a valid pair. A JSON string can hold one
  // (JSON.parse('"\\uD800x"') keeps it), which is how it reaches a provider.
  eq('a lone high surrogate → null', safeEncodeURIComponent('\uD800'), null);
  eq('a lone low surrogate → null', safeEncodeURIComponent('\uDFFF'), null);
  eq('a lone surrogate mid-string → null', safeEncodeURIComponent(`req-\uD834-42`), null);
  // A high surrogate NOT followed by a low one (here followed by 'A').
  eq('an unpaired high surrogate before a BMP char → null', safeEncodeURIComponent('\uD800A'), null);

  // ── Otherwise identical to encodeURIComponent ──
  eq('an ordinary string encodes exactly as encodeURIComponent',
    safeEncodeURIComponent('a b/c?d=e'), encodeURIComponent('a b/c?d=e'));
  eq('an empty string → ""', safeEncodeURIComponent(''), '');
  eq('reserved chars are percent-encoded', safeEncodeURIComponent('#&+ /'), '%23%26%2B%20%2F');

  // A valid surrogate PAIR (😀 = U+D83D U+DE00) is well-formed UTF-16 and must
  // survive — the null path is for LONE surrogates only.
  eq('a valid surrogate pair (emoji) is preserved',
    safeEncodeURIComponent('r\u{1F600}le'), encodeURIComponent('r\u{1F600}le'));

  // Non-strings are coerced with String(), same as encodeURIComponent does.
  eq('a number is String()-coerced', safeEncodeURIComponent(42), '42');
  eq('null is String()-coerced (not treated as the failure signal)',
    safeEncodeURIComponent(null), 'null');
} catch (e) {
  fail(`_safe-url tests crashed: ${e.message}`);
}
