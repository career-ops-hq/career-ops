// tests/keyword-match-list-shapes.test.mjs — keyword-match.mjs has to read the
// keyword section in the list shapes agents write, not only `a, b, c`.
//
// No evaluation mode fixes the list's format: each says only "list of 15-20
// keywords", so the agent picks one. extractKeywords() split on the ASCII comma
// and stripped `-`/`*` bullets, and every other shape skewed the coverage it
// reports:
// - a ` · ` list came back as ONE keyword, so coverage read 0%;
// - a numbered list kept its `1. ` marker, so no keyword could ever match;
// - a code fence wrapping the list, or a `---` under it, became a keyword of its
//   own that no CV contains, which lowered every coverage figure;
// - Chinese and Japanese separate list items with `、`, Arabic with `،`, so those
//   modes' lists came back as one keyword too. Splitting on `、` brings two more
//   cases along: Chinese numbering (`1、`, `一、`) must not leave a bare numeral
//   keyword, and a closing `。` must not stick to the last keyword.
//
// The guards are the other half: they pass before and after the fix, and fail
// if the separator rule is widened to split a word (a middle dot with no spaces
// round it) or the marker rule to eat a keyword that starts with a digit.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractKeywords } from '../keyword-match.mjs';
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';

console.log('\nkeyword-match: keyword list shapes');

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

/** A report whose keyword section holds `body`, followed by another section. */
const report = (body) => `# Evaluation\n\n## Keywords extracted\n\n${body}\n\n## Job Description (archived verbatim)\n\nIgnored.`;
const kws = (body) => extractKeywords(report(body));

check('a list separated by spaced middle dots yields one keyword per item', () => {
  assert.deepEqual(kws('SQL · Tableau · user growth · forecasting'),
    ['SQL', 'Tableau', 'user growth', 'forecasting']);
});

check('a numbered list loses its markers, with . or ) after the number', () => {
  assert.deepEqual(kws('1. SQL\n2. Tableau\n10) user growth'), ['SQL', 'Tableau', 'user growth']);
});

check('a code fence round the list is not itself a keyword', () => {
  assert.deepEqual(kws('```\nSQL, Tableau\n```'), ['SQL', 'Tableau']);
  assert.deepEqual(kws('```text\nSQL, Tableau\n```'), ['SQL', 'Tableau']);
  assert.deepEqual(kws('~~~\nSQL, Tableau\n~~~'), ['SQL', 'Tableau']);
});

check('a thematic break under the list is not a keyword', () => {
  for (const rule of ['---', '***', '___', '* * *', '- - -']) {
    assert.deepEqual(kws(`SQL, Tableau\n\n${rule}`), ['SQL', 'Tableau'], rule);
  }
});

check('the list separators of the Chinese, Japanese and Arabic modes split items', () => {
  assert.deepEqual(kws('Python、SQL、数据分析'), ['Python', 'SQL', '数据分析']);
  assert.deepEqual(kws('Python，SQL，Tableau'), ['Python', 'SQL', 'Tableau']);
  assert.deepEqual(kws('Python، SQL، Tableau'), ['Python', 'SQL', 'Tableau']);
});

check('a Chinese ordinal marker is stripped, not left behind as a numeral keyword', () => {
  // `、` now splits items, so without this a bare `1` survives as a keyword and
  // matches any standalone number in the CV, inflating coverage.
  assert.deepEqual(kws('1、Python\n2、SQL\n10、Docker'), ['Python', 'SQL', 'Docker']);
  assert.deepEqual(kws('一、Python\n十二、SQL'), ['Python', 'SQL']);
  assert.deepEqual(kws('1．Python\n2）SQL'), ['Python', 'SQL']);
});

check('a CJK or Devanagari full stop does not stick to the last keyword', () => {
  assert.deepEqual(kws('Python、SQL、Docker。'), ['Python', 'SQL', 'Docker']);
  assert.deepEqual(kws('数据分析，财务建模．'), ['数据分析', '财务建模']);
  assert.deepEqual(kws('Python, SQL, Docker।'), ['Python', 'SQL', 'Docker']);
  assert.deepEqual(kws('Node.js, ASP.NET.'), ['Node.js', 'ASP.NET']);
});

check('a middle dot inside a word does not split it', () => {
  assert.deepEqual(kws('col·laboració, SQL'), ['col·laboració', 'SQL']);
  assert.deepEqual(kws('SQL·Tableau'), ['SQL·Tableau']);
});

check('a keyword that starts with a digit keeps it', () => {
  assert.deepEqual(kws('3D modeling, 401(k) plans, 5G'), ['3D modeling', '401(k) plans', '5G']);
  assert.deepEqual(kws('2.5D packaging'), ['2.5D packaging']);
});

check('a + bullet loses its marker like - and * do', () => {
  assert.deepEqual(kws('+ CI/CD\n+ C++'), ['CI/CD', 'C++']);
});

check('the shapes that already worked still do', () => {
  assert.deepEqual(kws('- Python\n- FastAPI, gRPC\n* C++, C#'),
    ['Python', 'FastAPI', 'gRPC', 'C++', 'C#']);
  assert.deepEqual(kws('(list of 15-20 keywords from the JD for ATS optimization)'), []);
});

check('the CLI scores a fenced, numbered, middle-dot report the way pdf mode calls it', () => {
  // Every shape in one report, run through the same command line modes/pdf.md
  // step 22 uses, so a regression shows up as the coverage figure the user sees.
  const work = mkdtempSync(join(tmpdir(), 'keyword-match-shapes-'));
  try {
    const reportPath = join(work, '042-acme-2026-10-07.md');
    const cvPath = join(work, 'cv-acme.html');
    writeFileSync(reportPath, report('```\n1. SQL\n2. Tableau · forecasting\n```\n\n---'));
    writeFileSync(cvPath, '<html><body><p>Built Tableau dashboards on SQL.</p></body></html>');
    const out = execFileSync(NODE, [join(ROOT, 'keyword-match.mjs'), reportPath, '--cv', cvPath, '--json'], {
      encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = JSON.parse(out);
    assert.equal(result.total, 3);
    assert.equal(result.coveragePct, 67);
    assert.deepEqual(result.missing, ['forecasting']);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
