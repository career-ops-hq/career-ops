// tests/role-matcher-level-tokens.test.mjs — a level stated on both sides of
// a title comparison must agree.
//
// `roleTokens` drops every word of three characters or fewer, which is right
// for prepositions and wrong for exactly one kind of word: a level. Every
// roman numeral up to VIII and every single digit falls under the filter, so
// "Insurance Specialist I" and "Insurance Specialist II" tokenized identically
// and scored a perfect Jaccard ratio. merge-tracker then folded the second
// requisition into the first, kept the first's title, and the second stopped
// existing — invisible to dedup, to the tracker, and to anything that reads it.
//
// Measured on a real 316-posting corpus: 15 titles carried a level, and none
// of those postings stated a requisition number that the Notes-column guard
// (#1524) could have caught instead. The title is the only signal.
//
// The rule mirrors the seniority rule that already exists: stated on BOTH
// sides, the levels must overlap; stated on one side alone, it is a loose
// rewrite of one opening ("Engineer" vs "Senior Engineer"), not evidence of
// two. Roman and arabic forms fold onto one number. Nothing about the
// tokenizer changes, so every existing behaviour is asserted unchanged below.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nrole-matcher.mjs — a level stated on both sides must agree');

try {
  const { roleFuzzyMatch, extractLevels } = await import(
    pathToFileURL(join(ROOT, 'role-matcher.mjs')).href
  );

  const same = (label, a, b) => {
    if (roleFuzzyMatch(a, b) && roleFuzzyMatch(b, a)) pass(label);
    else fail(`${label}: "${a}" vs "${b}" should match (both orders)`);
  };
  const distinct = (label, a, b) => {
    if (!roleFuzzyMatch(a, b) && !roleFuzzyMatch(b, a)) pass(label);
    else fail(`${label}: "${a}" vs "${b}" should NOT match (both orders)`);
  };

  // ── 1. The defect: two levels of one title are two openings ──
  distinct('roman numerals keep two levels of one title apart',
    'Insurance Specialist I', 'Insurance Specialist II');
  distinct('three levels apart is still apart',
    'Clinical Research Coordinator II', 'Clinical Research Coordinator III');
  distinct('arabic levels keep two levels apart',
    'Registered Nurse 2', 'Registered Nurse 3');
  distinct('a "Level N" phrasing is a level too',
    'Data Engineer Level 2', 'Data Engineer Level 3');
  distinct('a level followed by a suffix is still read',
    'Insurance Specialist I (Remote)', 'Insurance Specialist II');
  distinct('a level followed by a comma is still read',
    'Insurance Specialist I, Days', 'Insurance Specialist II, Days');

  // ── 2. The same level on both sides is the same opening ──
  same('the same roman level still matches',
    'Insurance Specialist II', 'Insurance Specialist II (Remote)');
  same('roman and arabic spellings of one level are one statement',
    'Registered Nurse II', 'Registered Nurse 2');
  same('"Level II" and "Level 2" are one statement',
    'Data Engineer Level II', 'Data Engineer Level 2');

  // ── 3. A level on ONE side alone is a loose rewrite, as seniority is ──
  same('a level stated on one side only does not split a repost',
    'Insurance Specialist', 'Insurance Specialist II');
  same('nor in the other order',
    'Registered Nurse 3', 'Registered Nurse');

  // ── 4. What is NOT a level ──
  same('a digit glued to a letter is not a level (5G)',
    'Senior Engineer, 5G Networks', 'Senior Engineer, 5G Networks Team');
  same('a digit before a point is not a level (3.0)',
    'Web 3.0 Marketing Analyst, Growth', 'Web 3.0 Marketing Analyst, Growth Team');
  same('a four-digit number is not a level',
    'Program Manager, FY2026 Initiatives', 'Program Manager, FY2026 Initiatives Team');

  // ── 5. extractLevels reads what the gate reads ──
  const levels = (t) => [...extractLevels(t)].sort().join(',');
  const checkLevels = (label, title, expected) => {
    const got = levels(title);
    if (got === expected) pass(label);
    else fail(`${label}: extractLevels("${title}") => [${got}], expected [${expected}]`);
  };
  checkLevels('trailing roman numeral', 'Insurance Specialist II', '2');
  checkLevels('trailing arabic digit', 'Registered Nurse 3', '3');
  checkLevels('"Level N" phrasing', 'Data Engineer Level 4', '4');
  checkLevels('a slashed pair states both levels', 'Software Engineer II/III', '2,3');
  checkLevels('no level stated', 'Senior Data Engineer', '');
  checkLevels('glued digits are not levels', 'Senior Engineer, 5G Networks', '');
  checkLevels('a digit before a point is not a level', 'Web 3.0 Developer', '');

  // ── 6. Existing behaviour, unchanged: the tokenizer is untouched ──
  same('seniority on one side alone still matches (existing rule)',
    'Data Engineer', 'Senior Data Engineer');
  distinct('a sub-baseline qualifier on one side still splits (#2009)',
    'Associate Product Manager, TeamName', 'Product Manager, TeamName');
  distinct('sibling specialties still stay distinct (#947)',
    'Full Stack Engineer, Foundation', 'Full Stack Engineer, Guarded Releases');
  same('an exact-title repost still matches',
    'Senior Analytics Engineer', 'Senior Analytics Engineer');
} catch (error) {
  fail(`role-matcher level tests could not run: ${error.message}`);
}
