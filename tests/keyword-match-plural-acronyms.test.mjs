// tests/keyword-match-plural-acronyms.test.mjs — keyword-match.mjs has to treat
// a keyword and its plural as one keyword, acronyms included.
//
// Two gaps, both in the acronyms a CV pluralizes most. variantForms() gave a
// token of three characters or fewer no variant at all, so the JD keyword `LLM`
// (or `API`, `GPU`, `KPI`) came back missing against a CV that says `LLMs`. And
// expandTerms() tested synonym-group membership with the keyword as written, so
// `LLMs` never reached the group `LLM` is in and came back missing against
// `large language models`, which `LLM` matches.
//
// The guards below are the other half: they pass before and after the fix, and
// fail if the plural rule is widened to two-letter tokens or to stripping.
import assert from 'node:assert/strict';
import { analyzeCoverage, expandTerms, variantForms } from '../keyword-match.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nkeyword-match: plural acronyms and synonym groups');

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

/** Whether keyword-match counts `keyword` as present in `cv`. */
const found = (keyword, cv) => analyzeCoverage([keyword], cv).present.includes(keyword);

check('a three-letter acronym matches its plural in the CV', () => {
  for (const [keyword, cv] of [
    ['LLM', 'Built agents with LLMs.'],
    ['API', 'Designed REST APIs.'],
    ['GPU', 'Trained models on GPUs.'],
    ['KPI', 'Owned the team KPIs.'],
  ]) {
    assert.ok(found(keyword, cv), `${keyword} in "${cv}"`);
  }
});

check('a plural or singular keyword reaches its synonym group', () => {
  assert.ok(found('LLMs', 'Built RAG on large language models.'), 'LLMs -> large language models');
  assert.ok(found('Large Language Models', 'Built agents with LLMs.'), 'Large Language Models -> LLMs');
  assert.ok(found('Amazon Web Service', 'Deployed everything on AWS.'), 'Amazon Web Service -> AWS');
  assert.ok(expandTerms('LLMs').includes('large language model'), 'expandTerms(LLMs)');
});

check('a two-letter token still gets no plural, so IT never matches "its"', () => {
  assert.deepEqual(variantForms('it'), ['it']);
  assert.ok(!found('IT', 'The team ships its own tools.'), 'IT in "its"');
  assert.ok(!found('HR', 'Worked 40 hrs a week.'), 'HR in "hrs"');
});

check('a token of three characters ending in s is still never stripped', () => {
  assert.deepEqual(variantForms('aws'), ['aws']);
  assert.deepEqual(variantForms('k8s'), ['k8s']);
});

check('a shared prefix is not a plural: MLOps does not reach the machine learning group', () => {
  assert.ok(!found('MLOps', 'Strong machine learning background.'));
});
