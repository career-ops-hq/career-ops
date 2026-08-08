// tests/skill-extract.test.mjs — the shared skill vocabulary + canonical
// extractor (#1896). These fixtures moved here verbatim from upskill.mjs's
// self-test when the tokenizer was relocated (PR 1, pure relocation) — behavior
// must stay byte-identical, so the same assertions now guard the shared module.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nskill-extract.mjs (shared skill tokenizer, #1896)');

try {
  const { extractSkills, canonicalize } = await import(pathToFileURL(join(ROOT, 'skill-extract.mjs')).href);

  // canonicalization: aliases + display casing, unknown tokens pass through
  const s1 = extractSkills('Needs k8s, golang and Postgres experience; NodeJS a plus');
  for (const expected of ['Kubernetes', 'Go', 'PostgreSQL', 'Node.js']) {
    if (!s1.has(expected)) fail(`extractSkills missing canonical ${expected} (got ${[...s1].join(',')})`);
  }
  if ([...s1].every(x => x !== 'k8s' && x !== 'Postgres')) pass('extractSkills canonicalizes k8s→Kubernetes, golang→Go, Postgres→PostgreSQL, NodeJS→Node.js');
  else fail(`extractSkills left a raw alias in the set: ${[...s1].join(',')}`);

  // symbol-terminated skills: \b-style boundaries would drop all four
  const s1b = extractSkills('Requires C++ and C# on .NET, plus SQL.');
  if (['C++', 'C#', '.NET', 'SQL'].every(x => s1b.has(x))) pass('extractSkills matches symbol-edge skills C++/C#/.NET/SQL');
  else fail(`extractSkills symbol skills => ${[...s1b].join(',')}`);

  // standalone "Go" is case-SENSITIVE: a capitalized token counts; prose does not
  const s1d = extractSkills('Skills: Go, Rust, TypeScript');
  const s1e = extractSkills('willing to go the extra mile; ready to GO live');
  const s1f = extractSkills('Own the Go-to-market strategy and Go-live support');
  const s1g = extractSkills('Backend in Go/Rust (Go preferred). We ship Go.');
  if (s1d.has('Go') && !s1e.has('Go') && !s1f.has('Go') && s1g.has('Go')) {
    pass('extractSkills Go pass: capitalized/punctuation-adjacent count; prose "go"/"GO" and Go-to-market/Go-live do not');
  } else {
    fail(`extractSkills Go handling => list=${s1d.has('Go')} prose=${s1e.has('Go')} hyphen=${s1f.has('Go')} punct=${s1g.has('Go')}`);
  }

  // lowercase mentions of mixed-case skills resolve to canonical casing
  const s1c = extractSkills('familiar with graphql, pytorch and postgresql');
  if (['GraphQL', 'PyTorch', 'PostgreSQL'].every(x => s1c.has(x))) pass('extractSkills lowercase mentions resolve to canonical casing');
  else fail(`extractSkills lowercase canonical => ${[...s1c].join(',')}`);

  // over-suppression boundary: cv "Java" must NOT match "JavaScript"
  const cv = extractSkills('Expert in Java and AWS.');
  if (!cv.has('JavaScript') && cv.has('Java') && cv.has('AWS')) pass('extractSkills does not let "Java" swallow "JavaScript"');
  else fail(`extractSkills Java/JavaScript boundary => ${[...cv].join(',')}`);

  // canonicalize direct: alias, display casing, unknown pass-through
  if (canonicalize('k8s') === 'Kubernetes' && canonicalize('graphql') === 'GraphQL' && canonicalize('SomeNicheFramework') === 'SomeNicheFramework') {
    pass('canonicalize maps aliases + display casing and passes unknown tokens through unchanged');
  } else {
    fail(`canonicalize => k8s=${canonicalize('k8s')} graphql=${canonicalize('graphql')} unknown=${canonicalize('SomeNicheFramework')}`);
  }

  // empty / falsy input
  if (extractSkills('').size === 0 && extractSkills(null).size === 0) pass('extractSkills returns an empty set for empty/null input');
  else fail('extractSkills should return {} for empty/null');
} catch (e) {
  fail(`skill-extract tests crashed: ${e.message}`);
}
