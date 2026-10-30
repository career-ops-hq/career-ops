// tests/ats-normalization-fixture.test.mjs — examples/ats-normalization-test.md
// is the documented list of what normalizeTextForATS (generate-pdf.mjs)
// replaces. It sat unchecked and drifted: an editor turned its curly quotes and
// non-breaking space into ASCII, so two rows no longer held the character they
// named, and ten of the normalizer's seventeen rules had no row at all. This
// reads the table and holds it to the code.
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nATS normalization fixture — examples/ats-normalization-test.md');

try {
  const { normalizeTextForATS } = await import(pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href);
  const fixture = readFileSync(join(ROOT, 'examples/ats-normalization-test.md'), 'utf8');
  const source = readFileSync(join(ROOT, 'generate-pdf.mjs'), 'utf8');

  // Table rows under "What the normalizer converts". A `\|` in a cell is a
  // literal pipe, escaped for the markdown table.
  const section = fixture.split('## What the normalizer converts')[1]?.split('\n## ')[0] ?? '';
  const rows = section.split('\n')
    .filter((l) => l.startsWith('| ') && !/^\|\s*(Name|-)/.test(l))
    .map((l) => l.replace(/\\\|/g, '\u0000').split('|').slice(1, -1)
      .map((c) => c.replace(/\u0000/g, '|').trim()));

  if (rows.length >= 17) pass(`fixture table has ${rows.length} rows`);
  else fail(`fixture table has ${rows.length} rows; expected one per normalizer rule (17)`);

  const seenKeys = new Set();
  for (const [name, codepoints, sample, expected, keyCell] of rows) {
    const key = keyCell.replace(/`/g, '');
    seenKeys.add(key);

    // The sample has to carry the character the row names. Only the first
    // codepoint list counts; "(also ...)" names variants the row doesn't show.
    const named = [...codepoints.split('(')[0].matchAll(/U\+([0-9A-F]{4,6})/g)].map((m) => String.fromCodePoint(parseInt(m[1], 16)));
    if (named.length && !named.some((ch) => sample.includes(ch))) {
      fail(`${name}: the sample line no longer contains ${codepoints.split('(')[0].trim()} — an editor replaced it`);
      continue;
    }

    const { html, replacements } = normalizeTextForATS(`<p>${sample}</p>`);
    const got = html.replace(/^<p>|<\/p>$/g, '');
    if (got === expected && replacements[key] > 0) {
      pass(`${name}: converts as documented (${key})`);
    } else {
      fail(`${name}: got ${JSON.stringify(got)} with ${JSON.stringify(replacements)}; the fixture says ${JSON.stringify(expected)} via ${key}`);
    }
  }

  // Every key the normalizer can report has a row, and every row names a real
  // key, so a new rule in generate-pdf.mjs can't ship undocumented.
  const codeKeys = new Set([...source.matchAll(/bump\('([a-z-]+)'/g)].map((m) => m[1]));
  const undocumented = [...codeKeys].filter((k) => !seenKeys.has(k));
  const unknown = [...seenKeys].filter((k) => !codeKeys.has(k));
  if (codeKeys.size > 0 && undocumented.length === 0 && unknown.length === 0) {
    pass(`the fixture documents all ${codeKeys.size} replacement keys in generate-pdf.mjs`);
  } else {
    fail(`fixture and generate-pdf.mjs disagree: undocumented ${JSON.stringify(undocumented)}, unknown ${JSON.stringify(unknown)}`);
  }
} catch (err) {
  fail(`ATS normalization fixture test crashed: ${err.message}`);
}
