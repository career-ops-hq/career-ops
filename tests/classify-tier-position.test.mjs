// tests/classify-tier-position.test.mjs — which level marker wins when a title
// carries more than one.
//
// classifyTier resolved conflicts by SENIORITY RANK: senior(4) > mid(3) >
// entry(2) > intern(1), highest wins. Real titles break that, because the
// senior-sounding word is usually naming the team, office or person the role
// sits next to, not the role's own level — "Summer Intern, Director of
// Product" is an internship, not a directorship. Every such title classified
// `senior`.
//
// It matters because scan.mjs:2396 drops a posting outright when its tier is in
// `skip_tiers`, with no log line naming it. A junior candidate skipping
// `senior` therefore lost exactly the internships they were scanning for.
//
// The rule under test is POSITION: English job titles put the level first, so
// the LEFTMOST marker is the role's own. That also keeps "Senior Intern
// Coordinator" senior — a role that manages interns, where `senior` genuinely
// leads the title.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nclassify-tier.mjs — the leftmost level marker is the role\'s own');

try {
  const { classifyTier } = await import(pathToFileURL(join(ROOT, 'classify-tier.mjs')).href);

  const check = (title, expected) => {
    const got = classifyTier(title);
    if (got === expected) pass(`"${title}" → ${expected}`);
    else fail(`"${title}" → ${got}, expected ${expected}`);
  };

  // ── An incidental senior word must not outrank an explicit programme marker ──
  check('Intern - Office of the Chief Technology Officer', 'intern');
  check('Software Engineering Intern, Lead Generation Platform', 'intern');
  check('Marketing Intern - Senior Living Community', 'intern');
  check('Summer Intern, Director of Product', 'intern');
  check('Graduate Trainee - Head of Retail Division', 'intern');

  // ── Same for an explicit junior marker ──
  check('Junior Developer - Team Lead Support', 'entry');
  // Adjacent, no separator: "Staff Accountant" is the role, "Junior" the level.
  check('Junior Staff Accountant', 'entry');

  // ── The guard: a senior word that genuinely LEADS the title still wins ──
  // A role that manages interns. This is the case seniority-rank ordering got
  // right, and the position rule must not lose it.
  check('Senior Intern Coordinator', 'senior');
  check('Lead Software Engineer', 'senior');
  check('VP of Engineering', 'senior');
  check('Director of Engineering, Junior Talent', 'senior');

  // ── Unambiguous titles are untouched ──
  check('Software Engineer Intern', 'intern');
  check('Junior Software Engineer', 'entry');
  check('Senior Software Engineer', 'senior');
  check('Software Engineer I', 'entry');
  check('Software Engineer II', 'mid');
  check('Software Engineer', 'mid');
  // A numbered level still loses to a level word that leads the title.
  check('Senior Software Engineer III', 'senior');
  // ...and wins over one that trails it.
  check('Engineer II - Senior Platform Group', 'mid');

  // ── The acronym preprocessing must survive the change ──
  check('A.I. Researcher', 'mid');
  check('I.T. Specialist II', 'mid');
  check('Graduate Engineer', 'mid');
  check('Graduate Engineer Program', 'intern');

  // Non-string input keeps its documented fallback.
  check(null, 'mid');

  // ── Guard (a): associate + senior-role noun → senior ──
  // The `associate` prefix qualifies the seniority band; it does not make the
  // role entry-level. Direct compound and broad compound (adjective between
  // associate and the noun) must both resolve to senior.
  check('Associate Director, Data Science', 'senior');
  check('Associate Creative Director', 'senior');
  check('Associate Vice President, Technology', 'senior');
  check('Associate Principal Scientist', 'senior');
  check('Associate Chief Nursing Officer', 'senior');
  check('Associate Head of Product', 'senior');
  check('Associate Director', 'senior');
  // Guard: associate without a senior-role noun keeps its entry classification.
  check('Associate Software Engineer', 'entry');
  check('Associate Developer', 'entry');

  // ── Guard (b): [level marker] + [programme bridge] + [senior noun] → senior ──
  // "Intern Program Director" manages an intern programme; it is not an
  // internship. Guard is scoped to a closed bridge-noun set so that
  // "Junior Staff Accountant" (staff is a senior matcher, not a bridge) is
  // unaffected — already pinned above.
  check('Intern Program Director', 'senior');
  check('Internship Program Director', 'senior');
  check('Graduate Program Director', 'senior');
  check('Graduate Scheme Lead', 'senior');
  check('Trainee Program Director', 'senior');
  check('Junior Talent Director', 'senior');
  check('Junior Talent Lead', 'senior');
  check('Entry-Level Program Director', 'senior');
} catch (error) {
  fail(`classify-tier.mjs tests could not run: ${error.message}`);
}
