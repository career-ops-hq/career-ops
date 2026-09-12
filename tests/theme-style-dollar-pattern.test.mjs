// tests/theme-style-dollar-pattern.test.mjs — the same $-pattern class #2588
// fixed in the CV builders, in the two <head>-injection sites it did not reach.
//
// injectThemeStyle() splices a <style> block carrying values straight from the
// user's config/profile.yml `style:` section, and did so with a STRING
// replacement argument. JS scans that argument for $&, $', $` and $$, so a
// style value containing one of them was interpreted as a replacement pattern
// rather than inserted literally.
//
// The sharp case is $': it means "everything after the match", so the entire
// document BODY was spliced into the <head>, inside the style element — with
// no error and a valid-looking exit 0. buildThemeStyleBlock drops `; { } < >`
// but has no reason to drop `$`, which is a legal character in a CSS value.
import { pass, fail } from './helpers.mjs';
import { injectThemeStyle, styleTokensFrom } from '../theme-style.mjs';
import { injectPrintPageCss } from '../generate-pdf.mjs';

console.log('\ntheme-style / generate-pdf — $-pattern head injection');

const HTML = '<html><head><title>CV</title></head><body>BODY-SENTINEL</body></html>';

// Every $-pattern must land in the CSS value verbatim, and none may drag
// document content into the head.
for (const [label, value] of [
  ["$' (everything after the match)", "Fira$'Sans"],
  ['$& (the matched text)', 'Fira$&Sans'],
  ['$` (everything before the match)', 'Fira$`Sans'],
  ['$$ (an escaped dollar)', 'Fira$$Sans'],
]) {
  const out = injectThemeStyle(HTML, styleTokensFrom({ font_family: value }));
  const head = out.split('</head>')[0];
  const declared = (head.match(/--font-family:\s*([^;]*)/) || [])[1];

  if (!/BODY-SENTINEL/.test(head)) {
    pass(`${label} does not splice document content into <head>`);
  } else {
    fail(`${label} spliced the body into <head>: ${JSON.stringify(head.slice(-120))}`);
  }
  if (declared === value) {
    pass(`${label} is inserted literally into the CSS value`);
  } else {
    fail(`${label} was interpreted: declared ${JSON.stringify(declared)}, expected ${JSON.stringify(value)}`);
  }
}

// A style block with no $-patterns must be byte-identical to before.
{
  const out = injectThemeStyle(HTML, styleTokensFrom({ accent_color: '#2563eb' }));
  if (out.includes('--accent-color: #2563eb;') && out.includes('BODY-SENTINEL') && out.split('BODY-SENTINEL').length === 2) {
    pass('an ordinary style block is injected exactly once, unchanged');
  } else {
    fail(`ordinary injection regressed: ${out}`);
  }
}

// generate-pdf's <head> branch interpolates only internal constants today, so
// this pins the safe spelling rather than a live bug — and keeps it consistent
// with the <html> branch beside it, which already used a replacer function.
{
  const out = injectPrintPageCss(HTML, 'a4');
  const head = out.split('</head>')[0];
  if (!/BODY-SENTINEL/.test(head) && /@page/.test(head) && out.split('BODY-SENTINEL').length === 2) {
    pass('injectPrintPageCss injects the page setup without disturbing the body');
  } else {
    fail(`injectPrintPageCss output looks wrong: ${JSON.stringify(head.slice(-140))}`);
  }
}
