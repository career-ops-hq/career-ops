// tests/cv-optional-sections.test.mjs — the optional CV sections
// (competencies, experience, projects, education, certifications, awards,
// skills) must vanish entirely when they have no entries, rather than
// rendering a bare section header with nothing under it.
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
// Work experience (#2504) is the last of the seven and the one that sounds
// wrong until you name the people it is for: students, new graduates, and
// career changers with no professional history to list, who lead with
// projects or education instead and would otherwise ship a CV with an empty
// "Work Experience" title on it. All seven are delimited by marker matching
// rather than parsed, so the boundary pattern is the whole correctness story
// — see the header comment in cv-sections-core.mjs for the failure modes
// exercised here.
//
// Skills carries one extra burden the other six do not. It is the LAST
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
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { stripEmptySections } from '../cv-sections-core.mjs';

console.log('\ncv-sections-core.mjs — optional sections leave no bare header');

const EMPTY = { competencies: [], experience: [], projects: [], education: [], certifications: [], awards: [], interests: [], skills: [] };
const FULL = {
  competencies: ['Tag'],
  experience: [{ company: 'E' }],
  projects: [{ name: 'P' }],
  education: [{ degree: 'D' }],
  certifications: [{ title: 'C' }],
  awards: [{ title: 'A' }],
  interests: ['Chess'],
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
  { file: 'templates/cv-template.html', format: 'html', after: '<!-- END -->', hasCertifications: true, hasCompetencies: true, hasInterests: true },
  { file: 'templates/resume-template.html', format: 'html', after: '<!-- END -->', hasCertifications: false, hasCompetencies: true, hasInterests: false },
  { file: 'templates/cv-template.zh-minimal.html', format: 'html', after: '<!-- END -->', hasCertifications: true, hasCompetencies: true, hasInterests: false },
  { file: 'templates/cv-template.compact.html', format: 'html', after: '<!-- END -->', hasCertifications: true, hasCompetencies: true, hasInterests: false },
  { file: 'templates/cv-template.executive.html', format: 'html', after: '<!-- END -->', hasCertifications: true, hasCompetencies: true, hasInterests: false },
  { file: 'templates/cv-template.jake.html', format: 'html', after: '<!-- END -->', hasCertifications: true, hasCompetencies: true, hasInterests: false },
  { file: 'templates/cv-template.leadership.html', format: 'html', after: '<!-- END -->', hasCertifications: true, hasCompetencies: true, hasInterests: false },
  { file: 'templates/cv-template.modern.html', format: 'html', after: '<!-- END -->', hasCertifications: true, hasCompetencies: true, hasInterests: false },
  { file: 'templates/cv-template.tex', format: 'tex', after: '%%%%  END  %%%%', hasCertifications: false, hasCompetencies: false, hasInterests: false },
];

// --- Coverage guard: no shipped CV template may sit outside the matrix ------
// The matrix above is hand-written, which is what makes it worth trusting —
// `hasCertifications: false` is a claim about resume-template.html, not an
// observation of it, so a template that loses its `<!-- CERTIFICATIONS -->`
// marker fails instead of being quietly reclassified. The cost of a hand-
// written list is that it silently goes stale: `cv-template.zh-minimal.html`
// shipped a full marker set and was never covered here, and #2954 then added
// five named templates at once. Neither omission could fail a test, because an
// uncovered template runs no assertions at all.
//
// So the list of templates is declared, and membership is checked against
// disk. A CV template is identified by the `{{EXPERIENCE}}` placeholder that
// cv-templates.mjs requires of every one (see `required` there), which is why
// cover-letter-template.html is correctly not swept up. Adding a template
// without adding it here fails loudly, right here, naming the file.
const shippedCvTemplates = readdirSync(join(ROOT, 'templates'))
  .filter((f) => /\.(html|tex)$/.test(f))
  .filter((f) => readFileSync(join(ROOT, 'templates', f), 'utf-8').includes('{{EXPERIENCE}}'))
  .map((f) => `templates/${f}`)
  .sort();
const covered = new Set(TEMPLATES.map((t) => t.file));
const uncovered = shippedCvTemplates.filter((f) => !covered.has(f));
const phantom = [...covered].filter((f) => !shippedCvTemplates.includes(f));

if (uncovered.length === 0) pass(`every shipped CV template is in the matrix (${shippedCvTemplates.length} on disk)`);
else fail(`shipped CV templates missing from TEMPLATES — they run zero assertions: ${uncovered.join(', ')}`);

if (phantom.length === 0) pass('every template in the matrix exists on disk');
else fail(`TEMPLATES names templates that are not on disk: ${phantom.join(', ')}`);

for (const { file, format, after, hasCertifications, hasCompetencies, hasInterests } of TEMPLATES) {
  const template = readFileSync(join(ROOT, file), 'utf-8');
  const name = file.split('/').pop();
  const closingSkeleton = format === 'html' ? '</body>\n</html>' : '\\end{document}';

  const stripped = stripEmptySections(template, EMPTY, format);
  const projectsMarker = format === 'html' ? '<!-- PROJECTS -->' : 'PROJECTS  %';
  const educationMarker = format === 'html' ? '<!-- EDUCATION -->' : 'Education  %';
  const certificationsMarker = '<!-- CERTIFICATIONS -->'; // html-only; no LaTeX Certifications section exists
  const competenciesMarker = '<!-- CORE COMPETENCIES -->'; // html-only; no LaTeX Competencies section exists
  const awardsMarker = format === 'html' ? '<!-- AWARDS -->' : 'AWARDS  %';
  const interestsMarker = '<!-- INTERESTS -->'; // html-only; no LaTeX Interests section exists
  const skillsMarker = format === 'html' ? '<!-- SKILLS -->' : 'Technical Skills  %';
  // The LaTeX banner reads "Experience" while its \section reads "Work
  // Experience"; the HTML marker is "WORK EXPERIENCE". They are not the same
  // string, which is exactly the kind of drift these template-backed
  // assertions exist to catch.
  const experienceMarker = format === 'html' ? '<!-- WORK EXPERIENCE -->' : 'Experience  %';

  check(`${name}: empty payload removes the projects block`, stripped.includes(projectsMarker), false);
  check(`${name}: empty payload removes the education block`, stripped.includes(educationMarker), false);
  if (hasCertifications) {
    check(`${name}: empty payload removes the certifications block`, stripped.includes(certificationsMarker), false);
  }
  if (hasCompetencies) {
    check(`${name}: empty payload removes the competencies block`, stripped.includes(competenciesMarker), false);
  }
  check(`${name}: empty payload removes the awards block`, stripped.includes(awardsMarker), false);
  if (hasInterests) {
    check(`${name}: empty payload removes the interests block`, stripped.includes(interestsMarker), false);
  }
  check(`${name}: empty payload removes the skills block`, stripped.includes(skillsMarker), false);
  check(`${name}: empty payload removes the work-experience block`, stripped.includes(experienceMarker), false);
  check(`${name}: the trailing sentinel survives`, stripped.includes(after), true);
  check(`${name}: the closing document skeleton survives`, stripped.trimEnd().endsWith(closingSkeleton), true);
  // Removing the block takes its placeholder with it. Note this is about the
  // *payload* key being empty, not about the template: cv-templates.mjs still
  // requires `{{EXPERIENCE}}` to exist in any custom template.
  check(`${name}: empty payload removes {{EXPERIENCE}} with its block`, stripped.includes('{{EXPERIENCE}}'), false);

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
  if (hasInterests) {
    check(`${name}: empty awards alone keeps interests`, onlyAwards.includes(interestsMarker), true);
  }

  // Interests empty on its own: it sits directly between Awards and Skills
  // (the last section), so a boundary slip here is the one most likely to eat
  // into Skills or the trailing sentinel — assert both survive.
  if (hasInterests) {
    const onlyInterests = stripEmptySections(template, { ...FULL, interests: [] }, format);
    check(`${name}: empty interests alone keeps awards`, onlyInterests.includes(awardsMarker), true);
    check(`${name}: empty interests alone drops interests`, onlyInterests.includes(interestsMarker), false);
    check(`${name}: empty interests alone keeps skills`, onlyInterests.includes(skillsMarker), true);
    check(`${name}: empty interests alone keeps the closing document skeleton`,
      onlyInterests.trimEnd().endsWith(closingSkeleton), true);

    // Omitted `interests` key must behave identically to an explicit [].
    const withoutInterests = { ...FULL };
    delete withoutInterests.interests;
    const omittedInterests = stripEmptySections(template, withoutInterests, format);
    check(`${name}: omitted interests key removes the interests block`, omittedInterests.includes(interestsMarker), false);
    check(`${name}: omitted interests key keeps skills`, omittedInterests.includes(skillsMarker), true);
    check(`${name}: omitted interests key keeps the closing document skeleton`,
      omittedInterests.trimEnd().endsWith(closingSkeleton), true);
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

  // Experience empty on its own — the #2504 case. It sits mid-document with
  // populated sections on both sides, so an over-greedy boundary here does
  // not truncate a tail, it eats Projects (and in the shipped HTML templates,
  // everything after it up to the next marker it happens to reach). Assert
  // every neighbour survives, not just the immediate one.
  const onlyExp = stripEmptySections(template, { ...FULL, experience: [] }, format);
  check(`${name}: empty experience alone drops the work-experience marker`, onlyExp.includes(experienceMarker), false);
  check(`${name}: empty experience alone drops {{EXPERIENCE}}`, onlyExp.includes('{{EXPERIENCE}}'), false);
  check(`${name}: empty experience alone keeps projects`, onlyExp.includes(projectsMarker), true);
  check(`${name}: empty experience alone keeps education`, onlyExp.includes(educationMarker), true);
  check(`${name}: empty experience alone keeps awards`, onlyExp.includes(awardsMarker), true);
  check(`${name}: empty experience alone keeps skills`, onlyExp.includes(skillsMarker), true);
  check(`${name}: empty experience alone keeps the closing document skeleton`,
    onlyExp.trimEnd().endsWith(closingSkeleton), true);
  if (hasCompetencies) {
    check(`${name}: empty experience alone keeps competencies`, onlyExp.includes(competenciesMarker), true);
  }
  if (hasCertifications) {
    check(`${name}: empty experience alone keeps certifications`, onlyExp.includes(certificationsMarker), true);
  }

  // The new-graduate payload the issue is actually about: no experience AND
  // no competencies, i.e. two adjacent empty sections. Stripping the first
  // removes the marker the second's boundary would otherwise have stopped at,
  // so this is where a boundary that names its successor breaks — and it is
  // the combination a student CV actually produces, not a synthetic one.
  if (hasCompetencies) {
    const newGrad = stripEmptySections(template, { ...FULL, competencies: [], experience: [] }, format);
    check(`${name}: new-grad payload drops competencies`, newGrad.includes(competenciesMarker), false);
    check(`${name}: new-grad payload drops work experience`, newGrad.includes(experienceMarker), false);
    check(`${name}: new-grad payload keeps projects`, newGrad.includes(projectsMarker), true);
    check(`${name}: new-grad payload keeps education`, newGrad.includes(educationMarker), true);
    check(`${name}: new-grad payload keeps skills`, newGrad.includes(skillsMarker), true);
    check(`${name}: new-grad payload keeps the closing document skeleton`,
      newGrad.trimEnd().endsWith(closingSkeleton), true);
  }

  // An omitted `experience` key must behave identically to an explicit empty
  // array — a payload built for a candidate with no history is far more
  // likely to omit the key than to pass [].
  const withoutExperience = { ...FULL };
  delete withoutExperience.experience;
  const omittedExperience = stripEmptySections(template, withoutExperience, format);
  check(`${name}: omitted experience key removes the work-experience block`,
    omittedExperience.includes(experienceMarker), false);
  check(`${name}: omitted experience key keeps projects`, omittedExperience.includes(projectsMarker), true);
  check(`${name}: omitted experience key keeps the closing document skeleton`,
    omittedExperience.trimEnd().endsWith(closingSkeleton), true);

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
  if (hasInterests) {
    check(`${name}: empty skills alone keeps interests`, onlySkills.includes(interestsMarker), true);

    // Both empty: interests is now the section immediately before the
    // now-empty (and last) Skills section — the adjacent-empty-sections case
    // that matters most, since Skills' own boundary is the sentinel-only one.
    const bothEmpty = stripEmptySections(template, { ...FULL, interests: [], skills: [] }, format);
    check(`${name}: empty interests+skills drops interests`, bothEmpty.includes(interestsMarker), false);
    check(`${name}: empty interests+skills drops skills`, bothEmpty.includes(skillsMarker), false);
    check(`${name}: empty interests+skills keeps awards`, bothEmpty.includes(awardsMarker), true);
    check(`${name}: empty interests+skills keeps the closing document skeleton`,
      bothEmpty.trimEnd().endsWith(closingSkeleton), true);
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
