// Headless Chromium embeds Helvetica Neue for the Latin stack and does not
// embed Hiragino, PingFang, or Noto when those are only named. 山 (U+5C71)
// and 田 (U+7530) then come back as the Kangxi radicals U+2F2D and U+2F65.
// Arial Unicode MS is the face this renderer actually embeds. It has to sit
// after the Latin faces and before the generic family.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { deflateSync, inflateSync } from 'zlib';
import { listTree } from '../lib/walk-tree.mjs';
import { pass, fail, warn, ROOT, toolUnavailable } from './helpers.mjs';

console.log('\nCV templates — Han text stays Han in the PDF');

const FONT_FILES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode MS.ttf',
];

// Read the text a PDF viewer would show: walk the page content stream, track
// the selected font, and map each glyph code through that font's /ToUnicode
// CMap. Only glyphs the page draws count, so an unused CMap entry can't pass.
function pdfObjects(pdf) {
  const objects = new Map();
  const src = pdf.toString('latin1');
  for (const m of src.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
    const body = m[2];
    const at = body.indexOf('stream');
    const dict = at >= 0 ? body.slice(0, at) : body;
    let stream = null;
    if (at >= 0 && dict.includes('/FlateDecode')) {
      let start = m.index + m[0].indexOf(body) + at + 6;
      if (pdf[start] === 0x0d && pdf[start + 1] === 0x0a) start += 2;
      else if (pdf[start] === 0x0a || pdf[start] === 0x0d) start++;
      const length = Number(dict.match(/\/Length\s+(\d+)/)?.[1]);
      const data = Number.isInteger(length) ? pdf.subarray(start, start + length) : pdf.subarray(start, pdf.indexOf('endstream', start));
      stream = inflateSync(data).toString('latin1');
    }
    objects.set(m[1], { dict, stream });
  }
  return objects;
}

function toUnicodeMap(cmap) {
  const map = new Map();
  const hex = (h) => String.fromCodePoint(...h.match(/.{4}/g).map((c) => parseInt(c, 16)));
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, uni] of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(code, 16), hex(uni));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, uni] of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const base = parseInt(uni, 16);
      for (let c = parseInt(lo, 16); c <= parseInt(hi, 16); c++) map.set(c, String.fromCodePoint(base + c - parseInt(lo, 16)));
    }
  }
  return map;
}

function pdfText(pdf) {
  const objects = pdfObjects(pdf);
  let out = '';
  for (const { dict } of objects.values()) {
    if (!/\/Type \/Page\b/.test(dict)) continue;
    const fonts = new Map();
    const fontDict = dict.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? '';
    for (const [, name, ref] of fontDict.matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
      const cmapRef = objects.get(ref)?.dict.match(/\/ToUnicode (\d+) 0 R/)?.[1];
      fonts.set(name, toUnicodeMap(objects.get(cmapRef)?.stream ?? ''));
    }
    const content = objects.get(dict.match(/\/Contents (\d+) 0 R/)?.[1])?.stream ?? '';
    let font = new Map();
    for (const [, name, glyphs] of content.matchAll(/\/(\w+) [\d.]+ Tf|<([0-9A-Fa-f]+)> ?Tj/g)) {
      if (name) font = fonts.get(name) ?? new Map();
      else for (const code of glyphs.match(glyphs.length % 4 ? /.{2}/g : /.{4}/g) ?? []) out += font.get(parseInt(code, 16)) ?? '\uFFFD';
    }
  }
  return out;
}

function hanFallbackLast(decl) {
  const faces = decl.split(',').map((s) => s.trim());
  const generic = faces.at(-1);
  const han = faces.at(-2);
  const first = faces[0];
  return (generic === 'sans-serif' || generic === 'serif')
    && (han === "'Arial Unicode MS'" || han === '"Arial Unicode MS"')
    && (first.includes('Liberation') || first === '"Helvetica"');
}

const templates = listTree(join(ROOT, 'templates'), { match: /\.html$/ });
let stacks = 0;
for (const file of templates) {
  const rel = file.slice(ROOT.length + 1);
  const decls = [...readFileSync(file, 'utf8').matchAll(/--font-family:\s*([^;]+);/g)].map((m) => m[1].trim());
  for (const decl of decls) {
    stacks++;
    if (hanFallbackLast(decl)) pass(`${rel} lists Arial Unicode MS after the Latin faces`);
    else fail(`${rel} --font-family must keep a Latin face first and Arial Unicode MS last: ${decl}`);
  }
}
if (stacks >= 8) pass(`checked ${stacks} template font stacks`);
else fail(`expected at least 8 --font-family lines, found ${stacks}`);

// The count above only sees --font-family. The locale rules (lang="ja",
// lang="zh-CN", and so on) set font-family directly, and zh-minimal has no
// --font-family at all, so check those stacks by name. A rule that leads with
// a bare var(--font-family) inherits Arial Unicode MS from the token above.
const LOCALE_STACK_FILES = [
  'templates/ats/cv-template.ats.html',
  'templates/cv-template.compact.html',
  'templates/cv-template.executive.html',
  'templates/cv-template.html',
  'templates/cv-template.jake.html',
  'templates/cv-template.leadership.html',
  'templates/cv-template.modern.html',
  'templates/cv-template.zh-minimal.html',
];
const CJK_FACE = /Hiragino|PingFang|Noto (?:Sans|Serif) CJK|YaHei|JhengHei|Yu Gothic|Yu Mincho|Source Han|Malgun|Apple SD Gothic/;

function arialPrecedesCjk(decl) {
  const faces = decl.split(',').map((s) => s.trim());
  const cjkAt = faces.findIndex((face) => CJK_FACE.test(face));
  if (cjkAt === -1) return false;
  const arialAt = faces.findIndex((face) => face.includes('Arial Unicode MS') || face.startsWith('var(--font-family)'));
  return arialAt !== -1 && arialAt < cjkAt;
}

if (arialPrecedesCjk("'PingFang SC', 'Arial Unicode MS', sans-serif")) {
  fail('a CJK face listed before Arial Unicode MS must fail the order check');
} else {
  pass('a CJK face listed before Arial Unicode MS fails the order check');
}

for (const rel of LOCALE_STACK_FILES) {
  const css = readFileSync(join(ROOT, rel), 'utf8');
  const localeStacks = [...css.matchAll(/[^-]font-family:\s*([^;{}]+);/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim())
    .filter((decl) => CJK_FACE.test(decl));
  const missing = localeStacks.filter((decl) => !arialPrecedesCjk(decl));
  if (localeStacks.length === 0) fail(`${rel} has no CJK locale font-family rules to check`);
  else if (missing.length === 0) pass(`${rel} lists Arial Unicode MS before the CJK face in its ${localeStacks.length} locale stacks`);
  else fail(`${rel} CJK locale stacks where Arial Unicode MS does not come first: ${missing.join(' | ')}`);
}
const zhBody = readFileSync(join(ROOT, 'templates/cv-template.zh-minimal.html'), 'utf8')
  .match(/html\[lang="zh"\][^{]*\{[^}]*?font-family:\s*([^;]+);/)?.[1].replace(/\s+/g, ' ') ?? '';
if (zhBody.startsWith("var(--font-family, 'Arial Unicode MS'), 'Arial Unicode MS', 'PingFang SC'")) {
  pass('zh-minimal leads its Simplified Chinese stack with Arial Unicode MS, then PingFang SC');
} else {
  fail(`zh-minimal Simplified Chinese stack should lead with Arial Unicode MS: ${zhBody || '(not found)'}`);
}

// A compressed stream may end in 0x0a or 0x0d. /Length is that byte count.
// Trimming every trailing newline cuts the stream and inflateSync throws.
let flateSample = null;
for (let i = 0; i < 4000; i++) {
  const payload = Buffer.from(`Jane Doe line ${i}\n`);
  const compressed = deflateSync(payload);
  const last = compressed[compressed.length - 1];
  if (last === 0x0a || last === 0x0d) {
    flateSample = { payload, compressed };
    break;
  }
}
if (!flateSample) fail('could not build a Flate stream that ends in a newline');
else {
  const header = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${flateSample.compressed.length} /Filter /FlateDecode >>\nstream\n`);
  const pdf = Buffer.concat([header, flateSample.compressed, Buffer.from('\nendstream\nendobj\n')]);
  try {
    const got = Buffer.from(pdfObjects(pdf).get('1').stream, 'latin1');
    if (got.equals(flateSample.payload)) pass('a Flate stream that ends in a newline keeps its last byte');
    else fail('a Flate stream that ends in a newline lost bytes');
  } catch (err) {
    fail(`a Flate stream that ends in a newline did not inflate: ${err.message}`);
  }
}

const fontFile = FONT_FILES.find((p) => existsSync(p));
if (!fontFile) {
  warn('Arial Unicode MS is not installed, so the PDF glyph check did not run');
} else {
  const decl = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf8').match(/--font-family:\s*([^;]+);/)[1].trim();
  let browser;
  try {
    const { chromium } = await import('playwright');
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      toolUnavailable('browser', `Han PDF check skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
    }
    if (browser) {
      const page = await browser.newPage();
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>body{font-family:${decl};font-size:11px}</style></head><body><p>Jane Doe worked with 山田.</p></body></html>`;
      await page.setContent(html);
      const pdf = Buffer.from(await page.pdf({ format: 'Letter', printBackground: true }));
      const raw = pdf.toString('latin1');
      const text = pdfText(pdf);
      const flags = {
        arialUnicode: raw.includes('ArialUnicode'),
        // Any Latin face from the stack will do: Helvetica Neue on macOS,
        // Liberation Sans or Arial elsewhere.
        latinFace: /\/BaseFont \/[A-Z]{6}\+(?:Helvetica|LiberationSans|Arial(?!Unicode)|DejaVuSans)/.test(raw),
      };
      if (text === 'Jane Doe worked with 山田.' && flags.arialUnicode && flags.latinFace) {
        pass('the PDF text reads "Jane Doe worked with 山田." and still embeds a Latin face');
      } else {
        fail(`PDF text layer: ${JSON.stringify({ text, ...flags })}`);
      }
    }
  } finally {
    await browser?.close();
  }
}
