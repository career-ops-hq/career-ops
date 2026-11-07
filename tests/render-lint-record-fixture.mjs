#!/usr/bin/env node
// Records what Chromium makes of the markup renderLint reads, so the tokenizer suites stay offline.
// Not a test: it is not named *.test.mjs, so test-all.mjs never discovers it, and it needs a
// Chromium (Playwright's, with JavaScript off, as generate-pdf.mjs renders).
//
//   node tests/render-lint-record-fixture.mjs [tags|docs|values|entities|all]
//       tags      tests/fixtures/render-lint-tags.json      each start tag: name, attributes, whether it ended where the parser says
//       docs      tests/fixtures/render-lint-docs.json      each small document: the elements the tree builder made, with namespace
//       values    tests/fixtures/render-lint-entities.json  each attribute value of character references: what the parser decodes it to
//       entities  providers/_html-entity-table.mjs          the WHATWG named character reference table, fetched from
//                                                           https://html.spec.whatwg.org/entities.json and checked against Chromium
//   node tests/render-lint-record-fixture.mjs fuzz <tags|docs|values> <count> <seed> [--show N]
//       compares scanHtml (or the attribute decoder) with Chromium on fresh seeded input and prints the mismatches
//
// The inputs come from the seeded grammars (render-lint-tag-grammar.mjs, render-lint-doc-grammar.mjs), so
// a fixture is stale when its grammar changes: the suites check that, and re-recording is this command.
// A recorded fixture that scanHtml disagrees with is reported, and a mismatch is the signal to fix the
// scanner or to choose another seed or count, not to edit the fixture by hand.
import { chromium } from 'playwright';
import { isMainModule } from '../lib/is-main-module.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateTags, EXPLICIT_TAGS } from './render-lint-tag-grammar.mjs';
import { generateDocs, generateEntityValues, EXPLICIT_DOCS } from './render-lint-doc-grammar.mjs';
import { scanHtml, tagAttributes } from '../cv-templates.mjs';
import { decodeEntities } from '../providers/_html-entities.mjs';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(import.meta.dirname, 'fixtures');
export const TAGS = { seed: 7, count: 240, file: 'render-lint-tags.json' };
export const DOCS = { seed: 3, count: 500, file: 'render-lint-docs.json' };
export const VALUES = { seed: 5, count: 1500, file: 'render-lint-entities.json' };

const browser = async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ javaScriptEnabled: false })).newPage();
  await page.setContent('<!doctype html><body></body>');
  return { b, page };
};
const chunks = async (page, fn, list, size) => {
  const out = [];
  for (let k = 0; k < list.length; k += size) out.push(...await page.evaluate(fn, list.slice(k, k + size)));
  return out;
};

// ---- Chromium's side ----
const tagsInChromium = (page, list) => chunks(page, (items) => items.map((html) => {
  const t = document.createElement('template'); t.innerHTML = html;
  const el = t.content.firstElementChild;
  const first = el && !(el.localName === 'i' && el.id === 'z') ? el : null;
  return { name: first ? first.localName : null, attrs: first ? [...first.attributes].map((a) => [a.name, a.value]) : [], ended: !!t.content.querySelector('i#z') };
}), list, 500);

// The elements that carry data-n, as the parser built them, from a document written into an iframe.
const docsInChromium = (page, list) => chunks(page, (items) => items.map((html) => {
  const f = document.createElement('iframe'); document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(`<!doctype html><html><body>${html}`); f.contentDocument.close();
  const out = {};
  for (const el of f.contentDocument.querySelectorAll('[data-n]')) {
    const n = el.getAttribute('data-n');
    if (n in out) continue; // the adoption agency clones elements
    out[n] = [el.localName, el.namespaceURI.endsWith('svg') ? 'svg' : el.namespaceURI.endsWith('MathML') ? 'math' : 'html'];
  }
  f.remove();
  return out;
}), list, 200);

const valuesInChromium = (page, list) => chunks(page, (items) => items.map((v) => {
  const t = document.createElement('template'); t.innerHTML = `<a title="${v}">`;
  return t.content.firstElementChild.getAttribute('title');
}), list, 500);

// ---- scanHtml's side ----
export function tagInOurs(html) {
  const { tags } = scanHtml(html);
  const isMarker = (t) => t.name === 'i' && tagAttributes(t.raw).find(([k]) => k === 'id')?.[1] === 'z';
  const first = tags[0] && !isMarker(tags[0]) ? tags[0] : null;
  return { name: first ? first.name : null, attrs: first ? tagAttributes(first.raw) : [], ended: tags.some(isMarker) };
}
export function docInOurs(html) {
  const out = {};
  for (const t of scanHtml(html).tags) {
    const n = tagAttributes(t.raw).find(([k]) => k === 'data-n')?.[1];
    if (n === undefined || n in out) continue;
    out[n] = [t.name, t.ns];
  }
  return out;
}
// Chromium names an svg element in camelCase (foreignObject); scanHtml lower-cases every name.
export function sameElements(ours, theirs) {
  const why = new Set();
  for (const n of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    if (!(n in ours)) why.add('missed');
    else if (!(n in theirs)) why.add('phantom');
    else {
      if (ours[n][0] !== theirs[n][0].toLowerCase()) why.add('name');
      if (ours[n][1] !== theirs[n][1]) why.add('ns');
    }
  }
  return [...why];
}

// ---- recording ----
const write = (file, data) => writeFileSync(join(FIXTURES, file), JSON.stringify(data).replace(/\},\{/g, '},\n{').replace(/"(generated|explicit)":\[/g, '"$1":[\n') + '\n');

async function recordTags(page) {
  const generated = generateTags(TAGS.count, TAGS.seed);
  const ref = await tagsInChromium(page, generated.concat(EXPLICIT_TAGS.map((e) => e.html)));
  write(TAGS.file, {
    about: 'Chromium parse (JavaScript off, template.innerHTML) of each tag: element name, attributes in order, and whether the marker <i id="z"> after it was reached. generated = generateTags(count, seed) from tests/render-lint-tag-grammar.mjs; explicit = EXPLICIT_TAGS there. Re-record: node tests/render-lint-record-fixture.mjs tags',
    seed: TAGS.seed,
    count: TAGS.count,
    generated: generated.map((html, i) => ({ html, ...ref[i] })),
    explicit: EXPLICIT_TAGS.map((e, i) => ({ note: e.note, html: e.html, ...ref[TAGS.count + i] })),
  });
  return generated.concat(EXPLICIT_TAGS.map((e) => e.html)).filter((html, i) => JSON.stringify(tagInOurs(html)) !== JSON.stringify(ref[i]));
}

async function recordDocs(page) {
  const generated = generateDocs(DOCS.count, DOCS.seed);
  const all = generated.concat(EXPLICIT_DOCS.map(([, html]) => html));
  const ref = await docsInChromium(page, all);
  write(DOCS.file, {
    about: 'The elements Chromium\'s tree builder made (JavaScript off) from each document, by data-n: [local name, namespace]. generated = generateDocs(count, seed) from tests/render-lint-doc-grammar.mjs; explicit = EXPLICIT_DOCS there. Re-record: node tests/render-lint-record-fixture.mjs docs',
    seed: DOCS.seed,
    count: DOCS.count,
    generated: generated.map((html, i) => ({ html, elements: ref[i] })),
    explicit: EXPLICIT_DOCS.map(([note, html], i) => ({ note, html, elements: ref[DOCS.count + i] })),
  });
  return all.filter((html, i) => sameElements(docInOurs(html), ref[i]).length);
}

async function recordValues(page) {
  const values = generateEntityValues(VALUES.count, VALUES.seed);
  const ref = await valuesInChromium(page, values);
  write(VALUES.file, {
    about: 'The value Chromium decodes each string to as a double-quoted attribute value (JavaScript off). generated = generateEntityValues(count, seed) from tests/render-lint-doc-grammar.mjs. Re-record: node tests/render-lint-record-fixture.mjs values',
    seed: VALUES.seed,
    count: VALUES.count,
    generated: values.map((value, i) => ({ value, decoded: ref[i] })),
    explicit: [],
  });
  return values.filter((v, i) => decodeEntities(v, { bareNumeric: true }) !== ref[i]);
}

// The table module is written from the spec's JSON, then every name in it is decoded by Chromium.
async function recordEntities(page) {
  const spec = await (await fetch('https://html.spec.whatwg.org/entities.json')).json();
  const esc = (s) => [...s].map((c) => { const n = c.codePointAt(0); return n < 0x7f && n >= 0x20 && c !== "'" && c !== '\\' ? c : n > 0xffff ? `\\u{${n.toString(16)}}` : `\\u${n.toString(16).padStart(4, '0')}`; }).join('');
  const names = Object.keys(spec).filter((k) => k.endsWith(';')).map((k) => k.slice(1, -1)).sort();
  const legacy = Object.keys(spec).filter((k) => !k.endsWith(';')).map((k) => k.slice(1)).sort();
  let out = `// @ts-check
// The WHATWG named character reference table (https://html.spec.whatwg.org/entities.json): every
// name that ends in a semicolon, mapped to its characters, and the legacy names that also decode
// with no semicolon. Data only; providers/_html-entities.mjs reads it in attribute mode.
// Recorded by: node tests/render-lint-record-fixture.mjs entities
export const ENTITIES = Object.assign(Object.create(null), {
`;
  for (const n of names) out += `  ${n}: '${esc(spec['&' + n + ';'].characters)}',\n`;
  out += `});\n\nexport const LEGACY_NAMES = new Set([\n`;
  out += legacy.map((n) => `'${n}'`).join(', ').replace(/(.{1,110})(, |$)/g, '  $1,\n').trimEnd() + `\n]);\n`;
  writeFileSync(join(ROOT, 'providers', '_html-entity-table.mjs'), out);
  // Chromium's own answer for each name in the spec file: the name with its semicolon, and a legacy name
  // with none before a space (decoded) and before a letter or `=` (left as written).
  const probes = [];
  const expected = [];
  for (const n of names) { probes.push(`&${n};`); expected.push(spec[`&${n};`].characters); }
  for (const n of legacy) {
    probes.push(`&${n} `, `&${n}x`, `&${n}=`);
    expected.push(spec[`&${n}`].characters + ' ', `&${n}x`, `&${n}=`);
  }
  const ref = await valuesInChromium(page, probes);
  return probes.filter((v, i) => ref[i] !== expected[i]);
}

// ---- fuzzing ----
async function fuzz(page, kind, count, seed, show) {
  let inputs, theirs, ours, same;
  if (kind === 'tags') {
    inputs = generateTags(count, seed); theirs = await tagsInChromium(page, inputs);
    ours = inputs.map(tagInOurs); same = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? [] : ['differs']);
  } else if (kind === 'docs') {
    inputs = generateDocs(count, seed); theirs = await docsInChromium(page, inputs);
    ours = inputs.map(docInOurs); same = sameElements;
  } else {
    inputs = generateEntityValues(count, seed); theirs = await valuesInChromium(page, inputs);
    ours = inputs.map((v) => decodeEntities(v, { bareNumeric: true })); same = (a, b) => (a === b ? [] : ['differs']);
  }
  const classes = {};
  const bad = [];
  inputs.forEach((input, i) => {
    const why = same(ours[i], theirs[i]);
    for (const w of why) classes[w] = (classes[w] || 0) + 1;
    if (why.length) bad.push({ input, why: why.join('+'), ours: ours[i], chromium: theirs[i] });
  });
  console.log(`${kind}: inputs=${count} seed=${seed} mismatching=${bad.length}`, JSON.stringify(classes));
  for (const m of bad.slice(0, show)) console.log(JSON.stringify(m.input).slice(0, 220), m.why, '\n   ours    ', JSON.stringify(m.ours), '\n   chromium', JSON.stringify(m.chromium));
}

if (isMainModule(import.meta.url)) {
  const [mode = 'all', kind, countArg, seedArg] = process.argv.slice(2);
  const showAt = process.argv.indexOf('--show');
  const { b, page } = await browser();
  try {
    if (mode === 'fuzz') {
      await fuzz(page, kind, +countArg, +seedArg, showAt > 0 ? +process.argv[showAt + 1] : 0);
    } else {
      const jobs = { tags: recordTags, docs: recordDocs, values: recordValues, entities: recordEntities };
      let disagreed = 0;
      for (const name of mode === 'all' ? Object.keys(jobs) : [mode]) {
        if (!jobs[name]) throw new Error(`unknown mode ${mode}: use tags, docs, values, entities, all or fuzz`);
        const bad = await jobs[name](page);
        disagreed += bad.length;
        console.log(`${name}: recorded; scanHtml/decoder disagrees on ${bad.length}`);
        for (const v of bad.slice(0, 5)) console.log('   ', JSON.stringify(v).slice(0, 200));
      }
      process.exitCode = disagreed ? 1 : 0;
    }
  } finally {
    await b.close();
  }
}
