// Random small documents for differential testing of the HTML scanner in cv-templates.mjs
// (scanHtml) against Chromium's tree builder. Seeded, so the same seed always yields the
// same documents. Every start tag carries `data-n="<k>"`, a number unique in its document, so a
// test can ask which tags the parser turned into elements and in which namespace.
//
// The pool mixes the elements that change how the rest of the input is read: the raw-text and
// RCDATA elements (style, script, textarea, title, xmp, iframe, noembed, noframes, plaintext),
// noscript and template, svg and math, the HTML integration points inside them (foreignObject,
// desc, title, annotation-xml with and without an html encoding), the MathML text integration
// points (mi, mo, mn, ms, mtext) with mglyph and malignmark, the tags that break out of foreign
// content (div, p, img, font with color), self-closing forms, and end tags for open, unopened
// and mismatched names. Text between tags includes `<`, comments and CDATA, and an element that
// holds raw text often holds a tag too, to show whether it was read as markup.
import { ENTITIES } from '../providers/_html-entity-table.mjs';

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const POOL = [
  'div', 'div', 'p', 'span', 'b', 'a', 'img', 'br', 'font', 'table', 'template', 'noscript', 'select', 'option', 'tr', 'td', 'caption', 'li', 'ul', 'dd', 'h1', 'button', 'form', 'video', 'source', 'picture',
  'style', 'style', 'script', 'script', 'textarea', 'title', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext',
  'svg', 'svg', 'svg', 'math', 'math', 'math', 'g', 'circle', 'image', 'foreignObject', 'foreignObject', 'desc', 'title',
  'annotation-xml', 'annotation-xml', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mglyph', 'malignmark', 'style', 'script',
];
const EXTRA = {
  font: [' color="red"', ' face="x"', ' size="3"', ' id="f"'],
  'annotation-xml': [' encoding="text/html"', ' encoding="application/xhtml+xml"', ' encoding="TEXT/HTML"', ' encoding="x"', ''],
};
const TEXT = ['x', ' ', 'a < b', '<', '<<', '&lt;', '<!--c-->', '<!-->', '<!--a--!>', '<!x>', '<?p>', '</>', '</ >', '</3>'];


// Hand-picked documents, one per rule the generator can only reach by chance. Each tag carries its data-n.
const IMG = (n) => `<img data-n="${n}" src="https://example.com/a.png">`;
export const EXPLICIT_DOCS = [
  ['an svg <style> holds markup: an img in it leaves svg and is requested', `<svg data-n="0"><style data-n="1">${IMG(2)}</style></svg>`],
  ['a self-closing svg <style> opens nothing', `<svg data-n="0"><style data-n="1"/>${IMG(2)}</svg>`],
  ['a self-closing math <style> opens nothing', `<math data-n="0"><style data-n="1"/>${IMG(2)}</math>`],
  ['a math <style> holds markup too', `<math data-n="0"><style data-n="1">${IMG(2)}</style></math>`],
  ['a self-closing svg <script> opens nothing', `<svg data-n="0"><script data-n="1"/>${IMG(2)}</svg>`],
  ['an svg <script> is markup, not script data', `<svg data-n="0"><script data-n="1">${IMG(2)}</script></svg>`],
  ['textarea, xmp, iframe, noembed, noframes, plaintext and title are markup in svg', `<svg data-n="0"><textarea data-n="1">${IMG(2)}</textarea><xmp data-n="3">${IMG(4)}</xmp><iframe data-n="5">${IMG(6)}</iframe><noembed data-n="7">${IMG(8)}</noembed><noframes data-n="9">${IMG(10)}</noframes><title data-n="11">${IMG(12)}</title></svg>`],
  ['plaintext in svg is markup', `<svg data-n="0"><plaintext data-n="1">${IMG(2)}</svg>`],
  ['the same elements are raw text in HTML', `<textarea data-n="0">${IMG(1)}</textarea><xmp data-n="2">${IMG(3)}</xmp><iframe data-n="4">${IMG(5)}</iframe><noembed data-n="6">${IMG(7)}</noembed><noframes data-n="8">${IMG(9)}</noframes><title data-n="10">${IMG(11)}</title><style data-n="12">${IMG(13)}</style><script data-n="14">${IMG(15)}</script>`],
  ['plaintext in HTML swallows the rest', `<plaintext data-n="0">${IMG(1)}`],
  ['foreignObject, desc and title in svg read HTML rules again', `<svg data-n="0"><foreignObject data-n="1"><style data-n="2">${IMG(3)}</style></foreignObject><desc data-n="4"><textarea data-n="5">${IMG(6)}</textarea></desc><title data-n="7"><script data-n="8">${IMG(9)}</script></title></svg>`],
  ['mi, mo, mn, ms and mtext in math read HTML rules', `<math data-n="0"><mi data-n="1"><style data-n="2">${IMG(3)}</style></mi><mtext data-n="4"><textarea data-n="5">${IMG(6)}</textarea></mtext></math>`],
  ['mglyph and malignmark at a text integration point stay math', `<math data-n="0"><mi data-n="1"><mglyph data-n="2"><style data-n="3">${IMG(4)}</style></mglyph></mi></math>`],
  ['annotation-xml with a text/html or xhtml encoding reads HTML rules; without one it does not', `<math data-n="0"><annotation-xml data-n="1" encoding="text/html"><style data-n="2">${IMG(3)}</style></annotation-xml><annotation-xml data-n="4"><style data-n="5">${IMG(6)}</style></annotation-xml><annotation-xml data-n="7" encoding="application/xhtml+xml"><textarea data-n="8">${IMG(9)}</textarea></annotation-xml></math>`],
  ['an svg element inside annotation-xml is svg', `<math data-n="0"><annotation-xml data-n="1"><svg data-n="2"><style data-n="3">${IMG(4)}</style></svg></annotation-xml></math>`],
  ['math in svg and svg in math take the parent namespace', `<svg data-n="0"><math data-n="1"><style data-n="2">${IMG(3)}</style></math></svg><math data-n="4"><svg data-n="5"><style data-n="6">${IMG(7)}</style></svg></math>`],
  ['CDATA is text in svg and math, but a bogus comment in an integration point or in HTML', `<svg data-n="0"><![CDATA[${IMG(1)}]]><foreignObject data-n="2"><![CDATA[${IMG(3)}]]></foreignObject></svg><![CDATA[${IMG(4)}]]>`],
  ['a breakout tag leaves foreign content, and font only with color, face or size', `<svg data-n="0"><g data-n="1"><font data-n="2"><div data-n="3"></div></font></g><font data-n="4" color="red"><circle data-n="5"/></font></svg>`],
  ['an HTML <image> is an <img>; in svg and math it keeps its name', `<image data-n="0" src="https://example.com/a.png"><svg data-n="1"><image data-n="2" href="https://example.com/b.png"></svg><math data-n="3"><image data-n="4"></math>`],
  ['</p> and </br> leave foreign content', `<svg data-n="0"><g data-n="1"></p><circle data-n="2"></svg>`],
  ['an end tag closes the nearest open element of that name, and svg camelCase names never close an HTML element', `<svg data-n="0"><g data-n="1"><svg data-n="2"></svg><circle data-n="3"></g><rect data-n="4"></svg><ellipse data-n="5">`],
  ['an end tag for an HTML ancestor closes the svg it holds', `<div data-n="0"><svg data-n="1"><g data-n="2"></div><circle data-n="3">`],
  ['a formatting end tag closes an svg opened inside it', `<b data-n="0"><div data-n="1"><svg data-n="2"></b><script data-n="3">${IMG(4)}</script>`],
  ['</form> takes the form off the stack and leaves the svg inside it open', `<form data-n="0"><svg data-n="1"></form><circle data-n="2">`],
  ['a <p> closes at the next block, and takes an svg with it', `<p data-n="0"><svg data-n="1"><g data-n="2"><div data-n="3"><circle data-n="4">`],
  ['script data escapes: </script> inside <!-- <script> does not end the script', `<script data-n="0"><!--<script></script>${IMG(1)}</script>${IMG(2)}`],
  ['script data escapes: --> leaves the escape, so the next </script> ends the script', `<script data-n="0"><!--<script></script>--></script>${IMG(1)}`],
  ['script data escapes: <!--> and <!---> are not an escape', `<script data-n="0"><!--></script>${IMG(1)}<script data-n="2"><!---></script>${IMG(3)}`],
  ['script data escapes: an escaped script ends at </script>', `<script data-n="0"><!-- x </script>${IMG(1)}`],
  ['a template holds no elements of the document, noscript is markup, and table parts outside a table are dropped', `<template data-n="0">${IMG(1)}</template><noscript data-n="2">${IMG(3)}</noscript><td data-n="4"></td><tr data-n="5"></tr>`],
];

export function generateDocs(count, seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const docs = [];
  for (let k = 0; k < count; k++) {
    let n = 0;
    const open = [];
    const start = (name, selfClosing = r() < 0.12) => {
      if (name === 'font' || name === 'annotation-xml') name += pick(EXTRA[name] ?? ['']);
      const bare = name.split(' ')[0];
      open.push(bare);
      return `<${name} data-n="${n++}"${selfClosing ? '/' : ''}>`;
    };
    let doc = '';
    for (let i = int(3, 10); i > 0; i--) {
      const x = r();
      if (x < 0.55) {
        const name = pick(POOL);
        doc += start(name);
        // A raw-text, RCDATA or foreign element often holds a tag, to show how its body is read.
        if (r() < 0.45) doc += pick(['', '', 'x']) + start(pick(['img', 'img', 'b', 'svg', 'style', 'div', 'p']), false);
        if (r() < 0.2) doc += pick(['<![CDATA[', '<![CDATA[x']) + start('img', false) + pick([']]>', '', ']]>']);
      } else if (x < 0.85) {
        const name = open.length && r() < 0.75 ? pick(open) : pick(POOL);
        doc += `</${r() < 0.1 ? name.toUpperCase() : name}${pick(['', '', ' ', '/'])}>`;
      } else {
        doc += pick(TEXT);
      }
    }
    docs.push(doc);
  }
  return docs;
}

// Attribute values built from character references, for differential testing of the attribute
// decoder in providers/_html-entities.mjs against Chromium: table names with and without the
// semicolon, truncated and extended names, and every kind of character that can follow.
export function generateEntityValues(count, seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const names = Object.keys(ENTITIES);
  const AFTER = ['', ' ', 'X', '9', '=', ';', '&', '#', '-', 'a;', '=1', '&amp;'];
  const out = [];
  for (let k = 0; k < count; k++) {
    let v = '';
    for (let i = 1 + Math.floor(r() * 3); i > 0; i--) {
      let name = pick(names);
      const form = r();
      if (form < 0.25) name = name.slice(0, Math.max(1, name.length - 1 - Math.floor(r() * 3)));
      else if (form < 0.4) name += pick(['x', 'Z', '9', 'amp', 'lt']);
      v += '&' + name + (r() < 0.6 ? ';' : '') + pick(AFTER);
    }
    out.push(v);
  }
  return out;
}
