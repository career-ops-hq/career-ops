// tests/cv-optional-sections.test.mjs — the optional CV sections
// (competencies, projects, education, certifications, awards, skills) must
// vanish entirely when they have no entries, rather than rendering a bare
// section header with nothing under it.
//
// #1879 fixed this for projects; education is the same bug (not every
// candidate has a degree). Certifications was fixed once directly in
// build-cv-html.mjs, then lost when that logic was generalized into this
// shared module (only projects/education made the cut) — the v1.22.0
// auto-update shipped that regression. Awards (#2220) is optional by
// construction: most candidates have none, so it ships hidden-when-empty from
// the start rather than being retrofitted. Core competencies is optional the
// same way: the tag row is often redundant with the summary and experience
// bullets, so payloads legitimately omit it — and like certifications it has
// no LaTeX marker, so it is html-only. Skills (#2515) is optional for the
// plainest reason of all: plenty of candidates simply have no skills section.
// All six are delimited by marker matching rather than parsed, so the
// boundary pattern is the whole correctness story — see the header comment in
// cv-sections-core.mjs for the failure modes exercised here.
//
// Skills carries one extra burden the other five do not. It is the LAST
// section in every shipped template, so it may have no following section marker
// to stop at; with the shared `…|$` boundary, stripping it would run to
// end-of-file and swallow the closing document skeleton. Its patterns therefore
// use the same marker shapes with NO end-of-input alternative — stopping at the
// `<!-- END -->` / `%%%% END %%%%` sentinel when Skills is last, and at the next
// section's marker when a custom template puts Skills higher up. That produces
// two behaviours this suite pins down:
//
//   - with the sentinel: the section is stripped and the closing skeleton
//     survives ("keeps the closing document skeleton" checks);
//   - without the sentinel: the strip is a NO-OP and the template comes out
//     byte-identical ("fail-safe" checks). A third-party template pack is
//     valid without the sentinel — cv-templates.mjs requires only
//     NAME/EXPERIENCE/EDUCATION — so this case must degrade to the cosmetic
//     bare-header bug, never to a truncated CV.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { stripEmptySections } from '../cv-sections-core.mjs';

console.log('\ncv-sections-core.mjs — optional sections leave no bare header');

const EMPTY = { competencies: [], projects: [], education: [], certifications: [], awards: [], skills: [] };
const FULL = {
  competencies: ['Tag'],
  projects: [{ name: 'P' }],
  education: [{ degree: 'D' }],
  certifications: [{ title: 'C' }],
  awards: [{ title: 'A' }],
  skills: [{ category: 'S', items: 'x' }],
};

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- Real templates: the sections must actually disappear ------------------
// Assert against the shipped templates so a template edit that renames or
// reorders a marker fails here instead of silently reviving the bare header.
// `after` is the trailing sentinel that must survive no matter which sections
// are empty — the `<!-- END -->` / `%%%% END %%%%` marker itself, never the
// (now-strippable) SKILLS marker or its content.
const TEMPLATES = [
  { file: 'templates/cv-template.html', format: 'html', after: '<!-- END -->', hasCertifications: true, hasCompetencies: true },
  { file: 'templates/resume-template.html', format: 'html', after: '<!-- END -->', hasCertifications: false, hasCompetencies: true },
  { file: 'templates/cv-template.tex', format: 'tex', after: '%%%%  END  %%%%', hasCertifications: false, hasCompetencies: false },
];

for (const { file, format, after, hasCertifications, hasCompetencies } of TEMPLATES) {
  const template = readFileSync(join(ROOT, file), 'utf-8');
  const name = file.split('/').pop();
  const closingSkeleton = format === 'html' ? '</body>\n</html>' : '\\end{document}';

  const stripped = stripEmptySections(template, EMPTY, format);
  const projectsMarker = format === 'html' ? '<!-- PROJECTS -->' : 'PROJECTS  %';
  const educationMarker = format === 'html' ? '<!-- EDUCATION -->' : 'Education  %';
  const certificationsMarker = '<!-- CERTIFICATIONS -->'; // html-only; no LaTeX Certifications section exists
  const competenciesMarker = '<!-- CORE COMPETENCIES -->'; // html-only; no LaTeX Competencies section exists
  const awardsMarker = format === 'html' ? '<!-- AWARDS -->' : 'AWARDS  %';
  const skillsMarker = format === 'html' ? '<!-- SKILLS -->' : 'Technical Skills  %';

  check(`${name}: empty payload removes the projects block`, stripped.includes(projectsMarker), false);
  check(`${name}: empty payload removes the education block`, stripped.includes(educationMarker), false);
  if (hasCertifications) {
    check(`${name}: empty payload removes the certifications block`, stripped.includes(certificationsMarker), false);
  }
  if (hasCompetencies) {
    check(`${name}: empty payload removes the competencies block`, stripped.includes(competenciesMarker), false);
  }
  check(`${name}: empty payload removes the awards block`, stripped.includes(awardsMarker), false);
  check(`${name}: empty payload removes the skills block`, stripped.includes(skillsMarker), false);
  check(`${name}: the trailing sentinel survives`, stripped.includes(after), true);
  check(`${name}: the closing document skeleton survives`, stripped.trimEnd().endsWith(closingSkeleton), true);
  check(`${name}: {{EXPERIENCE}} is untouched`, stripped.includes('{{EXPERIENCE}}'), true);

  // Populated payload must be a no-op — the strip only ever removes.
  check(`${name}: populated payload leaves the template unchanged`,
    stripEmptySections(template, FULL, format) === template, true);

  // One empty, one populated: only the empty one goes.
  const onlyEdu = stripEmptySections(template, { ...FULL, education: [] }, format);
  check(`${name}: empty education alone keeps projects`, onlyEdu.includes(projectsMarker), true);
  check(`${name}: empty education alone drops education`, onlyEdu.includes(educationMarker), false);
  check(`${name}: empty education alone keeps awards`, onlyEdu.includes(awardsMarker), true);
  check(`${name}: empty education alone keeps skills`, onlyEdu.includes(skillsMarker), true);
  if (hasCompetencies) {
    check(`${name}: empty education alone keeps competencies`, onlyEdu.includes(competenciesMarker), true);
  }
  if (hasCertifications) {
    check(`${name}: empty education alone keeps certifications`, onlyEdu.includes(certificationsMarker), true);

    // Certifications empty on its own: projects/education (both populated) survive, only certifications goes.
    const onlyCert = stripEmptySections(template, { ...FULL, certifications: [] }, format);
    check(`${name}: empty certifications alone keeps projects`, onlyCert.includes(projectsMarker), true);
    check(`${name}: empty certifications alone keeps education`, onlyCert.includes(educationMarker), true);
    check(`${name}: empty certifications alone drops certifications`, onlyCert.includes(certificationsMarker), false);
    check(`${name}: empty certifications alone keeps awards`, onlyCert.includes(awardsMarker), true);
    check(`${name}: empty certifications alone keeps skills`, onlyCert.includes(skillsMarker), true);
  }

  // Awards empty on its own: everything else populated survives, only awards goes.
  const onlyAwards = stripEmptySections(template, { ...FULL, awards: [] }, format);
  check(`${name}: empty awards alone keeps projects`, onlyAwards.includes(projectsMarker), true);
  check(`${name}: empty awards alone keeps education`, onlyAwards.includes(educationMarker), true);
  check(`${name}: empty awards alone drops awards`, onlyAwards.includes(awardsMarker), false);
  check(`${name}: empty awards alone keeps the section after it`, onlyAwards.includes(after), true);
  check(`${name}: empty awards alone keeps skills`, onlyAwards.includes(skillsMarker), true);
  if (hasCertifications) {
    check(`${name}: empty awards alone keeps certifications`, onlyAwards.includes(certificationsMarker), true);
  }

  // Competencies empty on its own: it is first among the optional sections,
  // sitting between Professional Summary and Work Experience, so a boundary
  // slip here would swallow the entire experience section rather than a
  // trailing one.
  if (hasCompetencies) {
    const onlyComp = stripEmptySections(template, { ...FULL, competencies: [] }, format);
    check(`${name}: empty competencies alone drops competencies`, onlyComp.includes(competenciesMarker), false);
    check(`${name}: empty competencies alone keeps the work-experience marker`, onlyComp.includes('<!-- WORK EXPERIENCE -->'), true);
    check(`${name}: empty competencies alone keeps {{EXPERIENCE}}`, onlyComp.includes('{{EXPERIENCE}}'), true);
    check(`${name}: empty competencies alone keeps projects`, onlyComp.includes(projectsMarker), true);
    check(`${name}: empty competencies alone keeps awards`, onlyComp.includes(awardsMarker), true);
    check(`${name}: empty competencies alone keeps skills`, onlyComp.includes(skillsMarker), true);
  }

  // Skills empty on its own: every other populated section survives, and the
  // closing document skeleton is not swallowed with it — Skills is last, so
  // this is the case the sentinel exists for.
  const onlySkills = stripEmptySections(template, { ...FULL, skills: [] }, format);
  check(`${name}: empty skills alone keeps projects`, onlySkills.includes(projectsMarker), true);
  check(`${name}: empty skills alone keeps education`, onlySkills.includes(educationMarker), true);
  check(`${name}: empty skills alone keeps awards`, onlySkills.includes(awardsMarker), true);
  check(`${name}: empty skills alone drops skills`, onlySkills.includes(skillsMarker), false);
  check(`${name}: empty skills alone keeps the closing document skeleton`,
    onlySkills.trimEnd().endsWith(closingSkeleton), true);
  if (hasCompetencies) {
    check(`${name}: empty skills alone keeps competencies`, onlySkills.includes(competenciesMarker), true);
  }
  if (hasCertifications) {
    check(`${name}: empty skills alone keeps certifications`, onlySkills.includes(certificationsMarker), true);
  }

  // An omitted `skills` key must behave identically to an explicit empty
  // array — isEmptySection() treats both as empty, but #2515 covered both a
  // retitled-and-unpopulated section and a genuinely-omitted one, so the
  // omitted case gets its own assertion against the real templates.
  const withoutSkills = { ...FULL };
  delete withoutSkills.skills;
  const omittedSkills = stripEmptySections(template, withoutSkills, format);
  check(`${name}: omitted skills key removes the skills block`, omittedSkills.includes(skillsMarker), false);
  check(`${name}: omitted skills key keeps the closing document skeleton`,
    omittedSkills.trimEnd().endsWith(closingSkeleton), true);

  // FAIL-SAFE: a template pack whose Skills section carries no sentinel is
  // valid (cv-templates.mjs requires only NAME/EXPERIENCE/EDUCATION). Strip
  // the sentinel from a real shipped template and the empty-skills strip must
  // become a NO-OP — bare header, intact document — never a truncated tail.
  // `after` IS the sentinel literal — reuse it rather than restating it here,
  // so the two can never drift into a weaker substring of each other.
  const noSentinel = template.replace(after, '');
  check(`${name}: fixture actually dropped the sentinel`, noSentinel.includes(after), false);
  const strippedNoSentinel = stripEmptySections(noSentinel, { ...FULL, skills: [] }, format);
  check(`${name}: no sentinel + empty skills leaves the template untouched (fail-safe)`,
    strippedNoSentinel === noSentinel, true);
  check(`${name}: no sentinel + empty skills keeps the closing document skeleton`,
    strippedNoSentinel.trimEnd().endsWith(closingSkeleton), true);
  check(`${name}: no sentinel + empty skills keeps {{EXPERIENCE}}`,
    strippedNoSentinel.includes('{{EXPERIENCE}}'), true);
}

// --- Boundary edge cases ---------------------------------------------------
// Each of these silently reintroduces the bare header if the boundary pattern
// is written loosely.

// A non-marker comment inside a section body is not a boundary. A lookahead of
// `(?=<!-- [A-Z])` stops here and strands the rest of the block.
const internalComment = [
  '<!-- PROJECTS -->',
  '<div class="section">',
  '  <!-- Main block -->',
  '  <div class="section-title">Projects</div>',
  '</div>',
  '<!-- EDUCATION -->',
  'keep me',
].join('\n');
// Only projects is empty here: with EMPTY, education would also be stripped to
// end of input and the fixture could not distinguish a correct strip from an
// over-broad one.
check('an ordinary comment inside the body is not treated as a boundary',
  stripEmptySections(internalComment, { projects: [], education: [{ degree: 'D' }] }, 'html'),
  '<!-- EDUCATION -->\nkeep me');

// A section that is last in the template still gets removed. Without an
// end-of-input branch there is no boundary to stop at and the strip no-ops.
// (Skills is the deliberate exception — see the fail-safe checks below.)
check('html: a trailing optional section is removed at end of template',
  stripEmptySections('<!-- HEADER -->\nkeep\n<!-- PROJECTS -->\n<div>drop</div>\n', EMPTY, 'html').trim(),
  '<!-- HEADER -->\nkeep');

check('tex: a trailing optional section is removed at end of document',
  stripEmptySections('%%%%  Heading  %%%%\nkeep\n%%%%  PROJECTS  %%%%\ndrop\n', EMPTY, 'tex').trim(),
  '%%%%  Heading  %%%%\nkeep');

// --- The Skills sentinel contract ------------------------------------------
// Reproduces the exact shape reviewed on #2516: a minimal third-party-style
// template with and without the sentinel. Without it the strip must not run.

const SKILLS_WITH_SENTINEL = '<html><body><div>\n  <!-- SKILLS -->\n  <div>skills</div>\n  <!-- END -->\n</div></body></html>';
const SKILLS_NO_SENTINEL = '<html><body><div>\n  <!-- SKILLS -->\n  <div>skills</div>\n</div></body></html>';

const withSentinel = stripEmptySections(SKILLS_WITH_SENTINEL, EMPTY, 'html');
check('html: with the sentinel, empty skills is stripped', withSentinel.includes('<!-- SKILLS -->'), false);
check('html: with the sentinel, the closing skeleton survives', withSentinel.includes('</body></html>'), true);

const withoutSentinel = stripEmptySections(SKILLS_NO_SENTINEL, EMPTY, 'html');
check('html: with no sentinel, empty skills is a no-op (fail-safe, bare header beats truncation)',
  withoutSentinel, SKILLS_NO_SENTINEL);
check('html: with no sentinel, the closing skeleton survives', withoutSentinel.includes('</body></html>'), true);

// Banners are the shipped 28-wide, NOT a minimal `%%%%`. Width matters: the
// Skills lookahead has no end-of-input branch, so on a template with no
// following banner the engine backtracks the opening banner's own greedy
// trailing `%{4,}`. It can only give back enough `%` to fake a boundary when the
// banner is wider than 8, so a narrow fixture passes while the real template
// gets a stray `%%%%` left behind. See TEX_END_SENTINEL in cv-sections-core.mjs.
const TEX_BANNER = '%'.repeat(28);
const TEX_WITH_SENTINEL = `${TEX_BANNER}  Technical Skills  ${TEX_BANNER}\nskills\n${TEX_BANNER}  END  ${TEX_BANNER}\n\\end{document}`;
const TEX_NO_SENTINEL = `${TEX_BANNER}  Technical Skills  ${TEX_BANNER}\nskills\n\\end{document}`;

const texWith = stripEmptySections(TEX_WITH_SENTINEL, EMPTY, 'tex');
check('tex: with the sentinel, empty skills is stripped', texWith.includes('Technical Skills'), false);
check('tex: with the sentinel, \\end{document} survives', texWith.includes('\\end{document}'), true);

const texWithout = stripEmptySections(TEX_NO_SENTINEL, EMPTY, 'tex');
check('tex: with no sentinel, empty skills is a no-op (fail-safe)', texWithout, TEX_NO_SENTINEL);
check('tex: with no sentinel, \\end{document} survives', texWithout.includes('\\end{document}'), true);
// The two checks above are narrowing diagnostics under the exact-equality check
// on the previous line, not independent coverage: that one already pins the
// whole template byte for byte, so anything these catch it catches too. They
// earn their place by naming WHICH half of the fail-safe broke, so a regression
// reports "half-eaten banner" instead of only a full-template diff.
// The substring is the right probe for that: when the boundary loses its `^`
// anchor the engine backtracks the opening banner's own greedy trailing `%{4,}`
// and consumes the heading with it, leaving `%%%%\nskills\n\end{document}`. The
// heading text is gone in that state, so this assertion goes red.
check('tex: with no sentinel, no half-eaten banner is left behind',
  texWithout.includes('Technical Skills'), true);

// --- Skills is not always the last section ---------------------------------
// A custom template may put Skills above Education. The Skills boundary must
// then stop at the NEXT section's marker, not run all the way to the trailing
// sentinel: matching the sentinel only would delete every populated section in
// between along with the empty Skills header — silent data loss in a CV that
// still has an education block to show. Both formats, because both boundaries
// have the same shape.

const SKILLS_NOT_LAST_HTML = [
  '<html><body><div>',
  '<!-- SKILLS -->',
  '<div>{{SKILLS}}</div>',
  '<!-- EDUCATION -->',
  '<div>keep my degree</div>',
  '<!-- END -->',
  '</div></body></html>',
].join('\n');

const skillsNotLast = stripEmptySections(
  SKILLS_NOT_LAST_HTML, { ...FULL, skills: [] }, 'html');
check('html: skills above education — the empty skills block goes',
  skillsNotLast.includes('<!-- SKILLS -->'), false);
check('html: skills above education — the populated education block survives',
  skillsNotLast.includes('keep my degree'), true);
check('html: skills above education — the sentinel survives',
  skillsNotLast.includes('<!-- END -->'), true);
check('html: skills above education — the closing skeleton survives',
  skillsNotLast.trimEnd().endsWith('</div></body></html>'), true);

const SKILLS_NOT_LAST_TEX = [
  `${TEX_BANNER}  Technical Skills  ${TEX_BANNER}`,
  '{{SKILLS}}',
  `${TEX_BANNER}  Education  ${TEX_BANNER}`,
  'keep my degree',
  `${TEX_BANNER}  END  ${TEX_BANNER}`,
  '\\end{document}',
].join('\n');

const texSkillsNotLast = stripEmptySections(
  SKILLS_NOT_LAST_TEX, { ...FULL, skills: [] }, 'tex');
check('tex: skills above education — the empty skills block goes',
  texSkillsNotLast.includes('Technical Skills'), false);
check('tex: skills above education — the populated education block survives',
  texSkillsNotLast.includes('keep my degree'), true);
check('tex: skills above education — \\end{document} survives',
  texSkillsNotLast.includes('\\end{document}'), true);

// Stripping one section must not depend on the other still being present: a
// lookahead naming `<!-- EDUCATION -->` breaks once education is removed.
const bothEmpty = [
  '<!-- PROJECTS -->',
  '<div>projects body</div>',
  '<!-- EDUCATION -->',
  '<div>education body</div>',
  '<!-- SKILLS -->',
  'skills',
  '<!-- END -->',
].join('\n');
check('both projects and education empty: neither body survives, skills and the sentinel do',
  stripEmptySections(bothEmpty, { projects: [], education: [], skills: [{ category: 'S', items: 'x' }] }, 'html'),
  '<!-- SKILLS -->\nskills\n<!-- END -->');

// All three of projects/education/skills empty: only the trailing sentinel remains.
check('projects, education, and skills all empty: only the sentinel survives',
  stripEmptySections(bothEmpty, EMPTY, 'html'),
  '<!-- END -->');

// A missing key is as empty as an empty array — payloads routinely omit these.
check('an absent projects key is treated as empty',
  stripEmptySections(bothEmpty, {}, 'html'),
  '<!-- END -->');

// An unknown format is a programming error, not a silent pass-through.
let threw = false;
try { stripEmptySections('x', EMPTY, 'pdf'); } catch { threw = true; }
check('an unknown template format throws', threw, true);
