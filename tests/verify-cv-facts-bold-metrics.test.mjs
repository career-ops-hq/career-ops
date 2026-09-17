import { pass, fail } from './helpers.mjs';
import { metricClaims, stripMarkup } from '../verify-cv-facts.mjs';

console.log('\nBolded metrics are not invisible to the fact gate (#4085)');

// House style bolds nearly every metric in cv.md/article-digest.md. stripMarkup
// removed HTML tags and LaTeX commands but left markdown emphasis markers
// (`**`/`__`) touching the digits, which severed the number-noun adjacency
// metricClaims requires — so a bolded metric quoted verbatim from the source
// was reported as "invented".
const cases = [
  ['double-star bold count', 'Layer A **2,044** tests', '2044 tests'],
  ['double-star bold count, no comma', '**194** automated tests', '194 tests'],
  ['double-star bold headcount', 'Managed **35** people', '35 people'],
  ['double-underscore bold count', '__2,842__ commits', '2842 commits'],
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
