import { pass, fail } from './helpers.mjs';
import { metricClaims, stripMarkup } from '../verify-cv-facts.mjs';

console.log('\nBolded metrics are not invisible to the fact gate (#4085)');

// House style bolds nearly every metric in cv.md/article-digest.md. stripMarkup
// removed HTML tags and LaTeX commands but left markdown emphasis markers
// (`**`/`__`/`*`) touching the digits, which severed the number-noun adjacency
// metricClaims requires — so a bolded metric quoted verbatim from the source
// was reported as "invented".
const cases = [
  ['double-star bold count', 'Layer A **2,044** tests', '2044 tests'],
  ['double-star bold count, no comma', '**194** automated tests', '194 tests'],
  ['double-star bold headcount', 'Managed **35** people', '35 people'],
  ['double-underscore bold count', '__2,842__ commits', '2842 commits'],
  ['single-asterisk italic count', 'Managed *35* people', '35 people'],
];

for (const [label, text, expectedClaim] of cases) {
  const claims = metricClaims(text);
  if (claims.has(expectedClaim)) {
    pass(`metricClaims extracts a bolded metric: ${label}`);
  } else {
    fail(`metricClaims missed a bolded metric (${label}): expected "${expectedClaim}" in ${JSON.stringify([...claims])}`);
  }
}

// stripMarkup must remove the emphasis markers while keeping the text they wrap.
const stripped = stripMarkup('Layer A **2,044** tests and __194__ commits');
if (!stripped.includes('*') && !stripped.includes('_') && stripped.includes('2,044') && stripped.includes('194')) {
  pass('stripMarkup removes emphasis markers but keeps the wrapped text');
} else {
  fail(`stripMarkup left emphasis markers or dropped text: ${JSON.stringify(stripped)}`);
}

// A lone, unpaired asterisk (e.g. a footnote marker) must not be treated as
// emphasis and swallow unrelated text.
const footnote = metricClaims('Cut latency by 40%* see appendix');
if (footnote.has('40%')) {
  pass('a lone unpaired asterisk does not block an adjacent percentage claim');
} else {
  fail(`a lone unpaired asterisk broke an adjacent claim: ${JSON.stringify([...footnote])}`);
}

// Two separate lone footnote markers on one line must not pair with each
// other into a false emphasis span that swallows the text between them.
const twoFootnotes = stripMarkup('shipped 2* tests 3* commits');
if (twoFootnotes === 'shipped 2* tests 3* commits') {
  pass('two lone footnote asterisks on one line do not pair with each other');
} else {
  fail(`lone footnote asterisks were mistaken for a pair: ${JSON.stringify(twoFootnotes)}`);
}

// Single underscores are load-bearing in these sources (snake_case identifiers,
// file paths like env_keys.json) and must never be touched, even though a
// DOUBLED underscore is still stripped as bold.
const identifier = stripMarkup('shipped __738__ commits to env_keys.json');
if (identifier === 'shipped 738 commits to env_keys.json') {
  pass('a doubled-underscore bold metric is stripped while a single-underscore identifier is left alone');
} else {
  fail(`stripMarkup mishandled underscores: ${JSON.stringify(identifier)}`);
}

// Emphasis markers can wrap a line break (the sources sometimes bold a metric
// across a wrapped line); the content must survive with the markers gone.
const multiline = stripMarkup('**2,044\nverified** tests', { keepLineBreaks: true });
if (!multiline.includes('*') && multiline.includes('2,044') && multiline.includes('verified')) {
  pass('stripMarkup removes bold markers that wrap a line break');
} else {
  fail(`stripMarkup mishandled multiline bold: ${JSON.stringify(multiline)}`);
}

// A LaTeX star-variant command (`\section*{...}`) must not be mistaken for an
// italic emphasis delimiter by a later, unrelated `*...*` span on the same
// line — the LaTeX pass must consume the command's own star first.
const latexStarCommand = stripMarkup(String.raw`\section*{Foo}and*emphasis*done`);
if (latexStarCommand === 'Foo and emphasis done') {
  pass('a LaTeX star-variant command does not collide with a later italic span');
} else {
  fail(`a LaTeX star command collided with markdown italic stripping: ${JSON.stringify(latexStarCommand)}`);
}
