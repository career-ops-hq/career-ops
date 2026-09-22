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

  // ── Guard (b) scoping: bridge noun present but NO trailing senior noun → stays at level marker ──
  // These cases prove the guard does not overreach. Removing the trailing-noun
  // requirement at classify-tier.mjs:119 would flip all three to 'senior' and
  // a junior candidate would silently lose intern-programme roles.
  check('Intern Program Coordinator', 'intern');
  check('Graduate Scheme Analyst', 'intern');
  check('Trainee Program Engineer', 'intern');

  // ── Guard (a): `associate` names a RANK, not a junior variant (#3178) ──
  // These fell through the closed noun list to the `associate` matcher at
  // classify-tier.mjs:72 and classified `entry`. scan.mjs drops a posting whose
  // tier is in `skip_tiers` and never names it (it prints a "Filtered by tier: N
  // removed" count, not the title), so an academic candidate running the
  // documented example config — templates/portals.example.yml suggests
  // `skip_tiers: [intern, entry]` and ships a HigherEdJobs board, both commented
  // out — lost every Associate Professor posting without seeing which.
  check('Associate Professor', 'senior');
  check('Associate Research Professor', 'senior');
  check('Associate Dean', 'senior');
  check('Associate Dean of Students', 'senior');
  check('Associate Provost', 'senior');
  check('Associate Chancellor', 'senior');
  check('Associate Vice Chancellor', 'senior');
  check('Associate Superintendent', 'senior');
  // Legal: the COMPOUND is on the list, the bare noun deliberately is not.
  check('Associate General Counsel', 'senior');
  // Pinned because the widened list must keep them (both new to this file).
  check('Associate Vice President', 'senior');
  check('Associate Partner', 'senior');

  // ── The counterexamples that keep the noun list closed ──
  // In these fields `associate` really is the junior variant, so guard (a)
  // cannot become a generic "associate never demotes" rule. `Associate Rector`
  // (a parish curate) and `Associate Registrar` (an office-level deputy) are why
  // the criterion is "institution-level head", not "sounds academic".
  check('Associate Counsel', 'entry');
  check('Associate Attorney', 'entry');
  check('Associate Editor', 'entry');
  check('Associate Producer', 'entry');
  check('Associate Manager', 'entry');
  check('Associate Consultant', 'entry');
  check('Associate Rector', 'entry');
  check('Associate Registrar', 'entry');

  // ── Guard (a) is skipped when a junior marker LEADS the title ──
  // Same doctrine as the position loop: "Summer Intern, Director of Product" is
  // an internship. Without this, guard (a) returns early and inverts #3178's own
  // harm on the same board — a junior candidate skipping `senior` would lose the
  // dean's-office internships they were scanning for.
  check('Intern, Associate Dean of Student Life', 'intern');
  check('Student Intern, Office of the Associate Provost', 'intern');
  check('Summer Intern, Associate Professor Research Group', 'intern');
  check('Graduate Trainee, Office of the Associate Dean', 'intern');
  check('Entry-Level Associate, Dean of Admissions Office', 'entry');
  check('Junior Associate Professor Support Specialist', 'entry');

  // ── Guard (a)'s window is whitespace-only and at most two words ──
  // A comma or dash after `associate` means `associate` is the ROLE and what
  // follows is a separate clause; an unbounded search to end-of-string reads all
  // of these as senior. The two-word cap additionally stops "Office of the X"
  // and employers named for a noun on the list — Dean & Company, whose entry
  // title is literally "Associate Consultant", plus Dean Foods, Dean Witter and
  // Provost Umphrey. The counsel pair is the sharpest: identical junior in-house
  // lawyer, tier decided by the department name.
  check('Administrative Associate, Office of the Dean', 'entry');
  check('Program Associate, Office of the Provost', 'entry');
  check('Research Associate - Professor Smith Laboratory', 'entry');
  check('Postdoctoral Research Associate, Lab of Professor Jane Doe', 'entry');
  check('Associate Consultant - Dean & Company', 'entry');
  check('Associate Attorney - Provost Umphrey Law Firm', 'entry');
  check('Associate Manager, Dean Foods', 'entry');
  check('Junior Associate, Dean Witter', 'entry');
  check('Associate Counsel, Office of the General Counsel', 'entry');
  check('Associate Counsel - Office of General Counsel', 'entry');

} catch (error) {
  fail(`classify-tier.mjs tests could not run: ${error.message}`);
}
