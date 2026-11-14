// Random start tags for differential testing of the HTML tag tokenizer in cv-templates.mjs
// (scanHtml / tagAttributes) against Chromium's parser. Seeded, so the same seed always
// yields the same inputs. Each input is one tag followed by a marker element, `<i id="z">`,
// so a test can tell whether the tag ended where the parser says it did.
//
// The grammar mixes the shapes that break regex tokenizers: quotes inside unquoted values and
// attribute names, `=` and `<` in names and values, missing values, `>` inside quotes, NBSP and
// the other whitespace, character references with and without semicolons, duplicate attributes,
// unterminated quotes, and `/` in every position.
//
// Not generated: CR and CRLF as separators. Chromium swallows an LF that follows a single space
// and a CR(LF) inside a tag (`<a \r\n"\n-x>` becomes one attribute `"-x`), which the HTML
// Standard does not do, so it is not behaviour to copy. CR still appears inside values.
export const MARKER = '<i id="z"></i>';

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const NAMES = ['x', 'X', 'img', 'IMG', 'a', 'x-y', 'x ', 'x1'];
const SEPARATORS = [' ', ' ', ' ', '\t', '\n', '\f', ' ', '', '/', ' / ', '//'];
const NAME_CHARS = ['a', 'b', 'S', 'r', 'c', '=', '"', "'", '<', '/', '`', ' ', '-', '&', 'ON', '\u0000'];
const VALUE_PIECES = ['a', 'b', 'A1', ' ', '=', '"', "'", '<', '>', '/', '&amp;', '&#58;', '&colon;', '&sol;', '&Tab;', '&NewLine;', '&#0;', '&#x41', '&#65', '&amp', '&lt', '&gt;', '&quot;', '&apos;', '&#1;', '&nbsp;', ' ', '`', '\n', '\t', '--', '!', 'https://e.test/a.png', '\u0000', '&', '&;', '&#;', '&#x;', '&AMP', '&ampx', '&amp=', '&#128;', '&#x9F;', '&#X41;', '&#xD800;', '&#x110000;', '&Amp;', '&amp;amp;', '&ampamp;', '&colon', '&sol', '&#x0;', '&#10;', '&#13;', '\r\n', '\r'];

// Hand-picked tags, led by the case that mis-tokenised before: a quote opens a value only right
// after `=`, so `alt=Jane's` is one unquoted value. Recorded with the generated ones.
export const EXPLICIT_TAGS = [
  ['an apostrophe inside an unquoted value is a value character (the reviewer case)', "<img alt=Jane's src=https://x/a.png>"],
  ['a double quote inside an unquoted value', '<img alt=say"hi src=https://x/a.png>'],
  ['the quote opens a value only right after =', '<a href=x"y z>'],
  ['> inside a double-quoted value', '<img alt="a>b" src=x>'],
  ['a double quote inside a single-quoted value', "<a href='x\"y'>"],
  ['no space between two quoted attributes', '<a b="c"d="e">'],
  ['a missing value at >', '<a b=>'],
  ['a missing value before the next attribute', '<a b= c=d>'],
  ['= starts an attribute name', '<a =b c>'],
  ['quote, apostrophe, < and ` inside names', '<a "b=c \'d=e f<g=h i`j=k>'],
  ['a slash inside a name and after an unquoted value', '<a b/c d=e/>'],
  ['an unquoted value keeps its trailing slash', '<a href=x/>'],
  ['a slash before the closing >', '<a b=c />'],
  ['the first of two equal names wins', '<a b="c" b="d" B=e>'],
  ['an unterminated double quote swallows the marker', '<a b="c>'],
  ['an unterminated single quote swallows the marker', "<a b='c>"],
  ['a NBSP is part of a tag name', '<a b=c>'],
  ['a NBSP is part of an unquoted value', '<a b=c d>'],
  ['a NUL becomes U+FFFD in a name and a value', '<a\u0000b c\u0000d=e\u0000f>'],
  ['references: numeric without a semicolon, names with one', '<a b=&amp;&#58;&#x3a&colon;&sol;&Tab;&NewLine;>'],
  ['legacy names decode with no semicolon unless an alphanumeric or = follows', '<a b=&amp&ampx&amp=1&lt&gt&quot&nbsp>'],
  ['a C1 reference maps through windows-1252', '<a b=&#128;&#x9F;&#129;>'],
  ['a leading control character stays in the value', '<a b=&#1;javascript:x>'],
  ['uppercase names and values', '<IMG SRC=A.PNG ALT="X">'],
  ['whitespace of every kind between attributes', '<a\tb=c\nd=e\ff=g>'],
  ['a slash directly after the tag name', '<img/src=x/alt=y>'],
].map(([note, html]) => ({ note, html: html + MARKER }));

export function generateTags(count, seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const attrName = () => {
    let s = '';
    for (let i = int(0, 4); i > 0; i--) s += pick(NAME_CHARS);
    return s || pick(['src', 'href', 'alt', 'on', 'SRC']);
  };
  const value = (quote) => {
    let s = '';
    for (let i = int(0, 5); i > 0; i--) {
      let p = pick(VALUE_PIECES);
      if (quote === '"' && p === '"' && r() < 0.8) p = 'a';
      if (quote === "'" && p === "'" && r() < 0.8) p = 'b';
      if (!quote && /[\s>]/.test(p) && r() < 0.7) p = 'c';
      s += p;
    }
    return s;
  };
  const out = [];
  const used = [];
  for (let k = 0; k < count; k++) {
    let tag = '<' + pick(NAMES);
    for (let i = int(0, 4); i > 0; i--) {
      tag += pick(SEPARATORS);
      const name = used.length && r() < 0.2 ? pick(used) : attrName();
      used.push(name);
      if (used.length > 6) used.shift();
      tag += name;
      const form = r();
      if (form < 0.25) continue;
      tag += pick(['=', '=', ' =', '= ', ' = ']);
      if (form < 0.45) tag += '"' + value('"') + (r() < 0.9 ? '"' : '');
      else if (form < 0.65) tag += "'" + value("'") + (r() < 0.9 ? "'" : '');
      else if (form < 0.9) tag += value('');
    }
    tag += pick(['>', '>', '>', '/>', ' />', '', ' ']);
    out.push(tag + MARKER);
  }
  return out;
}
