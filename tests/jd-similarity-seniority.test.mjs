// tests/jd-similarity-seniority.test.mjs — the seniority gate in jd-similarity.mjs.
//
// recommendCvReuse refuses to recommend reuse when the two documents describe
// different seniority levels (`reason: 'level-mismatch'`). That gate OVERRIDES
// the similarity score, so a false positive silently turns a good reuse
// candidate into a full regeneration. The two ways it used to misfire:
//
//   1. Ordinary English that happens to contain a level word — "Principal
//      responsibilities", "you will lead", "mid-market" — was read as a job
//      level. JD boilerplate is full of these.
//   2. A document naming SEVERAL levels resolved to whichever came first in the
//      LEVELS table, not to the role's actual level. Any CV showing career
//      progression ("Junior Developer ... Senior Developer") reads as junior.
//
// The gate must stay strict about REAL level differences, so every relaxation
// below is paired with an assertion that a genuine mismatch still fires.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\njd-similarity.mjs — the seniority gate only fires on real level differences');

try {
  const { recommendCvReuse, hardMismatch, jaccardSimilarity } = await import(
    pathToFileURL(join(ROOT, 'jd-similarity.mjs')).href
  );

  const check = (label, actual, expected) => {
    if (actual === expected) pass(label);
    else fail(`${label} => ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };

  // ── 1. A real level difference must still be caught ──────────────────────
  check(
    'a genuine level difference still blocks reuse',
    recommendCvReuse('Senior Backend Engineer. Django, PostgreSQL, Redis.',
                     'Junior Backend Engineer. Django, PostgreSQL, Redis.').reason,
    'level-mismatch',
  );
  check(
    'intern vs staff still blocks reuse',
    hardMismatch('Engineering Intern, summer programme.', 'Staff Engineer, platform group.'),
    true,
  );

  // ── 2. Ordinary English is not a job level ───────────────────────────────
  // "Principal responsibilities" = "main duties"; "lead" here is a verb.
  const boilerplateJd =
    'Backend Engineer. Principal responsibilities: build payment infrastructure with ' +
    'Django, PostgreSQL and Redis, design REST APIs, improve reliability, and lead ' +
    'mentoring for teammates. Remote friendly.';
  const seniorJd =
    'Senior Backend Engineer. We build payment infrastructure with Django, PostgreSQL ' +
    'and Redis. You will design REST APIs, improve reliability and mentor teammates. ' +
    'Remote friendly.';
  check('"Principal responsibilities" / verb "lead" is not a seniority level',
    hardMismatch(seniorJd, boilerplateJd), false);
  // The gate no longer overrides the score, so the score decides. Guard the
  // fixture too: if it ever drifts below the medium threshold this assertion
  // would pass for the wrong reason.
  const boilerplateScore = jaccardSimilarity(seniorJd, boilerplateJd);
  check('the fixture stays above the medium-similarity threshold',
    boilerplateScore >= 0.45 && boilerplateScore < 0.72, true);
  check('...so the recommendation follows the score instead of regenerating',
    recommendCvReuse(seniorJd, boilerplateJd).decision, 'reuse-with-edits');

  check('"mid-market" is a segment, not a seniority level',
    hardMismatch('Backend Engineer for our mid-market segment. Django, PostgreSQL.',
                 'Senior Backend Engineer. Django, PostgreSQL.'), false);

  // A level word that DOES qualify the role must keep working, including the
  // titles built from the very words excluded above.
  check('"Lead Engineer" is still a level', hardMismatch('Lead Engineer, platform.', 'Junior Engineer, platform.'), true);
  check('"Principal Engineer" is still a level',
    hardMismatch('Principal Engineer, platform.', 'Junior Engineer, platform.'), true);
  check('"Mid-level Engineer" is still a level',
    hardMismatch('Mid-level Engineer, platform.', 'Intern Engineer, platform.'), true);

  // ── 3. Several levels in one document = ambiguous, never a hard mismatch ──
  const progressionCv =
    'Experience: Junior Developer 2019-2021. Senior Developer 2021-2026. ' +
    'Django, PostgreSQL, React.';
  check('a CV naming several levels does not resolve to the first one',
    hardMismatch('Senior Developer. Django, PostgreSQL, React.', progressionCv), false);
  const cvScore = jaccardSimilarity('Senior Developer. Django, PostgreSQL, React.', progressionCv);
  check('the CV fixture stays above the medium-similarity threshold', cvScore >= 0.45, true);
  check('...so a progression CV is recommended for reuse, not regeneration',
    recommendCvReuse('Senior Developer. Django, PostgreSQL, React.', progressionCv).decision,
    'reuse-with-edits');

  // Ambiguity on EITHER side is enough to stand down.
  check('an ambiguous new JD also stands the gate down',
    hardMismatch(progressionCv, 'Intern Developer. Django.'), false);
} catch (error) {
  fail(`jd-similarity.mjs seniority tests could not run: ${error.message}`);
}
