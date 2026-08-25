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

  // Certifications: recognized, but 'SAFe' must never be reachable from the
  // everyday word "safe" — through extractSkills OR through the exported
  // canonicalize(). SAFe is deliberately absent from SKILL_TOKENS and from
  // CANONICAL, and is matched only by the case-sensitive SAFE_CERT_PATTERN.
  // Table-driven over EVERY certification token, asserting both halves: the
  // token is recognized from lowercase prose, AND it canonicalizes to its
  // display form. The second half is the one that matters — a token added to
  // SKILL_TOKENS without a matching CANONICAL entry falls through to DISPLAY,
  // which title-cases it ("pmp" -> "Pmp"), missing the known-skills set. That
  // is the #1851 drift class this module exists to prevent, and it is silent.
  const certificationCases = [
    ['pmp', 'PMP'],
    ['pmi-acp', 'PMI-ACP'],
    ['pgmp', 'PgMP'],
    ['capm', 'CAPM'],
    ['pmbok', 'PMBOK'],
    ['prince2', 'PRINCE2'],
    ['certified scrummaster', 'Certified ScrumMaster'],
    ['cspo', 'CSPO'],
    ['itil', 'ITIL'],
    ['cobit', 'COBIT'],
    ['togaf', 'TOGAF'],
    ['lean six sigma', 'Lean Six Sigma'],
    ['six sigma', 'Six Sigma'],
    ['cissp', 'CISSP'],
    ['cism', 'CISM'],
    ['cipp', 'CIPP'],
    // Alternate spellings of credentials already above, each expected to land
    // on the SAME display string. This is the pairing that stops the tool
    // telling someone to earn a certification their CV already lists: the
    // known-skills set is built from the CV's spelling and the gap map from the
    // JD's, so the two only cancel if both collapse to one form. Written next to
    // their fused siblings on purpose — a future edit that changes one display
    // string and not the other fails here rather than in a user's gap map.
    ['certified scrum master', 'Certified ScrumMaster'],
    ['certified scrum product owner', 'CSPO'],
    ['pmi acp', 'PMI-ACP'],
    ['prince 2', 'PRINCE2'],
    ['lean six-sigma', 'Lean Six Sigma'],
    ['six-sigma', 'Six Sigma'],
  ];
  const certFailures = [];
  for (const [raw, display] of certificationCases) {
    const found = extractSkills(`Requires ${raw} certification.`);
    if (!found.has(display)) certFailures.push(`extract "${raw}" => ${[...found].join(',') || '(none)'}`);
    if (canonicalize(raw) !== display) certFailures.push(`canonicalize("${raw}") => ${canonicalize(raw)}`);
  }
  if (certFailures.length === 0) {
    pass(`extractSkills + canonicalize cover all ${certificationCases.length} certification tokens`);
  } else {
    fail(`certification coverage => ${certFailures.join(' | ')}`);
  }

  // 'Lean Six Sigma' must win over 'Six Sigma' — longest-first alternation,
  // same convention as 'React Native' before 'React'.
  const lss = extractSkills('Lean Six Sigma Black Belt preferred.');
  if (lss.has('Lean Six Sigma') && !lss.has('Six Sigma')) pass('extractSkills prefers "Lean Six Sigma" over the shorter "Six Sigma"');
  else fail(`extractSkills Lean Six Sigma precedence => ${[...lss].join(',')}`);

  // SAFe is handled separately (case-sensitive pattern, absent from SKILL_TOKENS
  // and CANONICAL), so it is asserted here rather than in the table above.
  const certs = extractSkills('PMP and PMI-ACP required; ITIL and CISSP preferred; SAFe a plus.');
  if (certs.has('PMP') && certs.has('PMI-ACP') && certs.has('ITIL') && certs.has('CISSP') && certs.has('SAFe')) {
    pass('extractSkills recognizes certifications alongside the case-sensitive SAFe match');
  } else {
    fail(`extractSkills certifications => ${[...certs].join(',')}`);
  }

  const prose = extractSkills('Maintain a safe working environment; safety is our priority.');
  if (!prose.has('SAFe')) pass('extractSkills does not read the word "safe" in prose as the SAFe certification');
  else fail(`extractSkills prose-safe boundary => ${[...prose].join(',')}`);

  // The case above is rejected on CASE alone, so it holds the `(?<!\w)` half of
  // SAFE_CERT_PATTERN and nothing else. 'SAFety' is the one that needs the
  // TRAILING `(?!\w)`: it is capitalized exactly like the certification and
  // differs only by what follows. Verified as a real hole rather than a
  // hypothetical — dropping `(?!\w)` makes extractSkills('SAFety training
  // programs') return SAFe, and without this line the suite stays green while
  // it does. The 'SAFe 6' positive is its pair: the boundary must reject a
  // trailing letter without also rejecting a trailing space and digit, which is
  // how the framework's own versioned name is written.
  const safetyProse = extractSkills('SAFety training programs run quarterly.');
  if (!safetyProse.has('SAFe')) pass('extractSkills does not read "SAFety" as the SAFe certification (trailing word boundary)');
  else fail(`extractSkills SAFety boundary => ${[...safetyProse].join(',')}`);

  const safeVersioned = extractSkills('SAFe 6 rollout experience required.');
  if (safeVersioned.has('SAFe')) pass('extractSkills still matches the versioned "SAFe 6" form');
  else fail(`extractSkills SAFe 6 => ${[...safeVersioned].join(',') || '(none)'}`);

  if (canonicalize('safe') === 'safe' && canonicalize('SAFe') === 'SAFe') {
    pass('canonicalize leaves "safe" unchanged and does not fold it into "SAFe"');
  } else {
    fail(`canonicalize safe-boundary => safe=${canonicalize('safe')} SAFe=${canonicalize('SAFe')}`);
  }

  // 'CSM' is deliberately NOT a token: in job-posting text it far more often
  // means Customer Success Manager than Certified ScrumMaster.
  //
  // Two assertions, because the exclusion has two halves and each one alone
  // leaves a hole the other closes:
  //
  //   - CONTEXTUAL: the collision sentence must not yield the credential.
  //     Asserted against that one value rather than `size === 0`, which would
  //     also assert nothing ELSE in the sentence is a skill — a token added
  //     later that legitimately matches "Manager" or "AE" would then fail this
  //     test for a reason it was never about.
  //   - STANDALONE: 'CSM' must not become a skill under ANY name. Narrowing to
  //     the credential above lost this: admitting 'CSM' as its own token makes
  //     extractSkills('CSM required.') return ['CSM'], and the contextual check
  //     still passes because the value it looks for is absent. Verified by
  //     temporarily adding the token — the contextual assertion stayed green.
  const csm = extractSkills('This role is part Customer Success Manager (CSM), partnered with an AE.');
  if (!csm.has('Certified ScrumMaster')) pass('extractSkills does not treat "CSM" as a certification (Customer Success Manager collision)');
  else fail(`extractSkills CSM collision => ${[...csm].join(',')}`);

  const csmAlone = extractSkills('CSM required.');
  if (!csmAlone.has('CSM') && !csmAlone.has('Certified ScrumMaster')) {
    pass('extractSkills does not admit a standalone "CSM" as a skill under any name');
  } else {
    fail(`extractSkills standalone CSM => ${[...csmAlone].join(',')}`);
  }

  // empty / falsy input
  if (extractSkills('').size === 0 && extractSkills(null).size === 0) pass('extractSkills returns an empty set for empty/null input');
  else fail('extractSkills should return {} for empty/null');
} catch (e) {
  fail(`skill-extract tests crashed: ${e.message}`);
}
