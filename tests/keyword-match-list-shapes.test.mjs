// tests/keyword-match-list-shapes.test.mjs — extractKeywords() reads the list
// shapes an evaluation report actually arrives in, not only the ASCII comma one.
//
// No evaluation mode fixes the format of the keyword block. Every placeholder
// says just "list of 15-20 keywords", so the agent that wrote the report picks
// the shape, and extractKeywords() read one. Measured by the reporter on their
// own 503 local reports, 236 (47%) hit at least one shape it could not parse,
// and 43 of those reported 0% coverage against a CV that plainly contained the
// keywords. The figure is copied into the report and into step 22 of pdf mode,
// so one line of separator is a coverage score that reads as a clean miss.
//
// Each case below is a shape that shipped. The guards are the other half: they
// pass before and after, and fail if the separator set is widened carelessly —
// a bare U+00B7 would cut Catalan `col·laboració` and the vowel-length marks
// Unicode's NamesList records across much of Amerindian orthography in half.
import assert from 'node:assert/strict';
import { analyzeCoverage, extractKeywords } from '../keyword-match.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nkeyword-match: keyword list shapes');

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

// The keyword block as a report carries it, with the level-2 heading that ends it.
const block = (body) => `## Keywords extracted\n\n${body}\n\n## Next\n`;

// U+00B7 MIDDLE DOT, U+3001 IDEOGRAPHIC COMMA, U+FF0C FULLWIDTH COMMA,
// U+060C ARABIC COMMA, U+3002/U+FF0E sentence enders, U+0964 DEVANAGARI DANDA.
const MIDDOT = '\u00B7';
const IDEO_COMMA = '\u3001';
const FULLWIDTH_COMMA = '\uFF0C';
const ARABIC_COMMA = '\u060C';
const IDEO_STOP = '\u3002';
const FW_STOP = '\uFF0E';
const DANDA = '\u0964';

check('the reporter\'s repro: a middle-dot list now reads as three keywords', () => {
  const report = block(`SQL ${MIDDOT} Tableau ${MIDDOT} forecasting`);
  assert.deepEqual(extractKeywords(report), ['SQL', 'Tableau', 'forecasting']);

  // The number that reaches the report, end to end.
  const r = analyzeCoverage(extractKeywords(report), 'Built Tableau dashboards on SQL.');
  assert.equal(r.total, 3);
  assert.equal(r.coveragePct, 67);
  assert.deepEqual(r.missing, ['forecasting']);
});

check('every separator shape in the report splits into its keywords', () => {
  const table = [
    ['spaced middle dot', `SQL ${MIDDOT} Tableau ${MIDDOT} forecasting`, ['SQL', 'Tableau', 'forecasting']],
    ['ideographic comma', `Python${IDEO_COMMA}SQL`, ['Python', 'SQL']],
    ['fullwidth comma', `Python${FULLWIDTH_COMMA}SQL`, ['Python', 'SQL']],
    ['arabic comma', `Python${ARABIC_COMMA} SQL`, ['Python', 'SQL']],
    ['ascii comma', 'Python, SQL', ['Python', 'SQL']],
    ['plus bullet', '+ SQL\n+ Tableau', ['SQL', 'Tableau']],
    ['dash bullet', '- SQL\n- Tableau', ['SQL', 'Tableau']],
    ['star bullet', '* SQL\n* Tableau', ['SQL', 'Tableau']],
    ['ordered markers', '1. SQL\n2. Tableau', ['SQL', 'Tableau']],
    ['ordered paren markers', '1) SQL\n2) Tableau', ['SQL', 'Tableau']],
    ['cjk numbering', `1${IDEO_COMMA}SQL`, ['SQL']],
    ['cjk numeral numbering', `\u4e00${IDEO_COMMA}SQL`, ['SQL']],
    ['trailing ideographic stop', `SQL${IDEO_STOP}`, ['SQL']],
    ['trailing fullwidth stop', `SQL${FW_STOP}`, ['SQL']],
    ['trailing danda', `SQL${DANDA}`, ['SQL']],
    ['trailing ascii period', 'SQL.', ['SQL']],
  ];
  for (const [label, body, expected] of table) {
    assert.deepEqual(extractKeywords(block(body)), expected, label);
  }
});

check('a fenced keyword block is content, and its delimiters are not keywords', () => {
  // The biggest single shape in the report: 186 of 503 sections. A fence that
  // leaked its delimiter produced a keyword no CV can ever contain.
  const report = `## Keywords extracted\n\n\`\`\`\nSQL, Tableau\n\`\`\`\n\n## Next\n`;
  assert.deepEqual(extractKeywords(report), ['SQL', 'Tableau']);

  // A tilde fence, and a closing fence of a different length than the opener.
  const tilde = `## Keywords extracted\n\n~~~~\nSQL\n~~~~~\n\n## Next\n`;
  assert.deepEqual(extractKeywords(tilde), ['SQL']);

  // A "## " line inside the fence cannot close the section early.
  const inner = `## Keywords extracted\n\n\`\`\`\nSQL, Tableau\n## not a heading\n\`\`\`\n\n## Next\n`;
  assert.deepEqual(extractKeywords(inner), ['SQL', 'Tableau', '## not a heading']);

  // A fence the report never closes must not swallow every section after it.
  // With no closer the opener stays an ordinary line, so the section ends at the
  // next heading and the keywords after the opener are still read — exactly what
  // this did before the fix.
  const unclosed = '## Keywords extracted\n\n```\nSQL, Tableau\n\n## Verdict\n\nstrong fit\n';
  assert.deepEqual(extractKeywords(unclosed), ['```', 'SQL', 'Tableau']);
});

check('a thematic break inside a fenced list is skipped too', () => {
  // Found by CodeRabbit review. Fenced lines went straight to collect(), which
  // is where the thematic-break test used to live — so a `---` written inside
  // the fence became a keyword and moved the coverage total.
  const fenced = '## Keywords extracted\n\n```\nSQL\n---\nTableau\n```\n\n## Next\n';
  assert.deepEqual(extractKeywords(fenced), ['SQL', 'Tableau']);

  const spaced = '## Keywords extracted\n\n```\nSQL\n- - -\nTableau\n```\n\n## Next\n';
  assert.deepEqual(extractKeywords(spaced), ['SQL', 'Tableau']);
});

check('a shorter run of the same fence character does not close the fence', () => {
  // Also found by CodeRabbit review. CommonMark 0.31.2 §4.5: the closer is the
  // same character AND at least as long as the opener. Matching on the character
  // alone let a 3-backtick line close a 4-backtick fence, and every line after it
  // became ordinary content — which is how the rest of a report can leak into the
  // keyword list. The discriminating marker is the "## " line below: inside the
  // fence it is content, outside it would end the section.
  const quoted = '## Keywords extracted\n\n````\nSQL\n```\n## not a heading\n````\n\n## Next\n';
  assert.deepEqual(extractKeywords(quoted), ['SQL', '```', '## not a heading']);

  // A longer closer still closes it, which is the CommonMark direction.
  const longer = '## Keywords extracted\n\n```\nSQL, Tableau\n`````\n\n## Next\n';
  assert.deepEqual(extractKeywords(longer), ['SQL', 'Tableau']);
});

check('fence indentation decides what a delimiter is', () => {
  // Also found by CodeRabbit review, on #5362. FENCE_RE's `^ {0,3}` is what
  // separates a fence from an indented code block (§4.9), but both the opener
  // and the closer were matched on a TRIMMED line, so no line ever carried an
  // indent into the test. An indented run of the same character could
  // therefore close a real fence, and a `## ` heading after it left the keyword
  // list with nothing to show for the loss.
  const B = '```';
  const B4 = '````';

  // A real fence (0-3 spaces) is not closed by a four-space indented run. The
  // heading is the witness: inside the fence it is a keyword, outside it would
  // have ended the section. The indented run is longer than the opener, so the
  // length rule ACCEPTS it and indentation is the only thing that can reject it
  // — which is what makes this case isolate the indent bug.
  const indentedNoClose = `## Keywords extracted\n\n${B}\nSQL\n    ${B4}\n## not a heading\n${B}\n\n## Next\n`;
  assert.deepEqual(extractKeywords(indentedNoClose), ['SQL', B4, '## not a heading']);

  // The other half, and the reason this needed more than a one-line change: an
  // indented code block's own closer is indented too. Reading those delimiters
  // as fences is what lets the contents through instead of leaking ``` as
  // keywords, so the stricter rule must not be applied to them.
  const indentedBlock = `## Keywords extracted\n\n    ${B}\n    SQL, Tableau\n    ${B}\n\n## Next\n`;
  assert.deepEqual(extractKeywords(indentedBlock), ['SQL', 'Tableau']);

  // Up to three spaces is still inside the fence's own range, so it closes.
  const threeSpaces = `## Keywords extracted\n\n${B}\nSQL\n   ${B}\n\n## Next\n`;
  assert.deepEqual(extractKeywords(threeSpaces), ['SQL']);
});

check('a thematic break under the list is skipped, not read as keywords', () => {
  for (const rule of ['---', '***', '___', '- - -', '*****']) {
    assert.deepEqual(extractKeywords(block(`SQL, Tableau\n${rule}`)), ['SQL', 'Tableau'], rule);
  }
});

check('a bare middle dot inside a word stays one keyword', () => {
  // Unicode's NamesList records U+00B7 inside words, not only between items, so
  // the split requires whitespace on both sides. These are real spellings.
  assert.deepEqual(extractKeywords(block(`col${MIDDOT}laboració`)), [`col${MIDDOT}laboració`]);
  assert.deepEqual(extractKeywords(block(`k${MIDDOT}am`)), [`k${MIDDOT}am`]);
  // ...while the spaced form still splits.
  assert.deepEqual(extractKeywords(block(`col ${MIDDOT} lab`)), ['col', 'lab']);
});

check('a keyword starting with digits or a dot keeps its head', () => {
  // The ordered-list marker needs digits AND punctuation AND a space, so a
  // leading number that is part of the term is untouched.
  const table = ['3D modeling', 'C# 12', 'Node.js tooling', 'k8s orchestration', 'S3 buckets', '.NET 6'];
  for (const kw of table) {
    assert.deepEqual(extractKeywords(block(kw)), [kw], kw);
  }
});

check('the plain comma list is byte-identical to before', () => {
  // The shape every existing report and every mode uses. The change must be
  // invisible here or it is a regression, not a fix.
  assert.deepEqual(extractKeywords(block('- SQL, Tableau, forecasting')), ['SQL', 'Tableau', 'forecasting']);
  assert.deepEqual(extractKeywords(block('SQL')), ['SQL']);
  assert.deepEqual(extractKeywords(block('one keyword per line\nsecond\nthird')), [
    'one keyword per line', 'second', 'third',
  ]);
});

check('a parenthetical placeholder is still skipped and a missing block is still empty', () => {
  assert.deepEqual(extractKeywords(block('(the agent writes 15-20 here)')), []);
  assert.deepEqual(extractKeywords('## Something else\n\nSQL, Tableau\n'), []);
  assert.deepEqual(extractKeywords(''), []);
});