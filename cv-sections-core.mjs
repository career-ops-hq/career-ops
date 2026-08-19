// Shared optional-section stripping for the CV builders (build-cv-html.mjs,
// build-cv-latex.mjs).
//
// Core competencies, projects, education, certifications, awards, and skills
// are the genuinely optional CV sections: a competency tag row is often
// redundant with the summary and experience bullets that prove the same
// claims, a candidate's projects are often already covered under Work
// Experience, not every candidate has a degree, not every application carries
// a certification worth listing, most candidates have no award to name, and
// plenty of candidates list no skills section at all. The templates wrap all
// six unconditionally, so a payload with no entries renders a bare section
// header with nothing under it. The builders' buildCompetencies()/
// buildProjects()/buildEducation()/buildCertifications()/buildAwards()/
// buildSkills() correctly return '' — nothing removes the surrounding
// wrapper, which is what this module does.
//
// Certifications has no marker in the LaTeX template (cv-template.tex has no
// Certifications section at all), so PATTERNS.tex has no `certifications` key
// — stripEmptySections skips a section silently when the active format has no
// pattern for it, rather than trying to match against `undefined`. Awards, by
// contrast, is defined for both formats.
//
// ── The Skills sentinel: part of the template contract ───────────────────────
//
// Skills is the LAST section in every shipped template, which makes it the one
// optional section that may have no following section marker to stop at. Given
// the shared `…|$` boundary the others use, stripping an empty trailing Skills
// section falls through to true end-of-file and takes the closing
// `</div></body></html>` (`\end{document}` in LaTeX) with it — a truncated,
// unopenable document, which is far worse than the bare header this module
// exists to remove.
//
// So the Skills patterns below deliberately do NOT use the shared boundary.
// They use the same marker shapes with the `|$` branch removed, so they stop at
// the next marker and never at end-of-input. Because `END` is itself a marker,
// that is the `<!-- END -->` (`%%%% END %%%%` in LaTeX) sentinel when Skills is
// last, and the following section's marker when a custom template puts Skills
// somewhere else. Matching the sentinel *only* would be wrong for that second
// case: the lazy body would run past every section between Skills and the
// sentinel and delete them along with the empty header, which is silent data
// loss in a populated CV. Two consequences, both intentional:
//
//   1. **The sentinel is part of the template contract.** A template that ends
//      on its Skills section must place `<!-- END -->` / `%%%% END %%%%`
//      immediately after it. All four shipped templates do; do not remove it
//      when editing a template's tail. This is documented for custom-template
//      authors in templates/README.md.
//   2. **A template with no marker after Skills FAILS SAFE.** The pattern
//      simply does not match, `String.replace` is a no-op, and the template
//      comes out untouched — the Skills section renders as a bare header. That is
//      the original cosmetic bug, and it is the deliberate choice: a bare
//      header beats a truncated CV by a wide margin, and the person it lands
//      on (a third-party template pack with no sentinel and no skills listed)
//      did nothing wrong. cv-templates.mjs validates custom templates against
//      `required: ['NAME', 'EXPERIENCE', 'EDUCATION']` and does not — and
//      need not — require the sentinel, precisely because its absence is
//      survivable. Never "fix" this by giving the Skills patterns an `|$`
//      fallback; that trades a cosmetic bug for a destructive one.
//
// The section body is delimited by markers rather than parsed, so the boundary
// pattern carries the whole correctness burden and is easy to get subtly wrong:
//
//   - Stopping at any capitalized comment would also stop at an ordinary
//     comment inside a section body, truncating the strip and leaving markup
//     behind. Markers are therefore matched as all-caps only.
//   - Omitting the end-of-input branch would silently keep a section that
//     happens to be last in the template. (Skills is the deliberate exception
//     above — for it, keeping the section is the desired fail-safe.)
//   - Naming the expected successor ("projects is followed by education")
//     couples the two strips to each other and to template ordering: once an
//     empty education block is removed, a named lookahead for it stops matching
//     and the projects header survives.
//
// Each of those failure modes reintroduces the bare header this module exists
// to remove, and does it silently, so they are covered in
// tests/cv-optional-sections.test.mjs.

// HTML: `<!-- SECTION NAME -->`, all-caps. LaTeX: `%%%%  Name  %%%%` banners.
const HTML_BOUNDARY = String.raw`(?=<!--\s+[A-Z][A-Z ]*-->|$)`;
const TEX_BOUNDARY = String.raw`(?=%{4,}\s|$)`;

// Marker-only boundaries for Skills — the same marker shapes as the shared
// boundaries above, but with NO end-of-input alternative, so a template lacking
// any following marker is left untouched rather than truncated. `END` is itself
// a marker, so these stop at the `<!-- END -->` / `%%%% END %%%%` sentinel when
// Skills is last and at the next section's marker when it is not. See "The
// Skills sentinel" above before changing these, and never add an `|$` branch.
//
// The LaTeX one anchors the banner to the start of a line (hence the `m` flag on
// the pattern that uses it). Without `^`, dropping the `|$` branch lets the
// engine backtrack the opening banner's own greedy trailing `%{4,}`: with no
// following banner to stop at it gives back `%` until the leftovers themselves
// satisfy the lookahead, matching half the banner and leaving a stray `%%%%`
// behind instead of no-opping. Only banners wider than 8 `%` can backtrack that
// far, so a narrow fixture will not catch a regression here — the fixtures in
// tests/cv-optional-sections.test.mjs use the shipped 28-wide banner on purpose.
const HTML_END_SENTINEL = String.raw`(?=<!--\s+[A-Z][A-Z ]*-->)`;
const TEX_END_SENTINEL = String.raw`(?=^%{4,}\s)`;

const PATTERNS = {
  html: {
    competencies: new RegExp(String.raw`<!--\s+CORE COMPETENCIES\s+-->[\s\S]*?` + HTML_BOUNDARY),
    projects: new RegExp(String.raw`<!--\s+PROJECTS\s+-->[\s\S]*?` + HTML_BOUNDARY),
    education: new RegExp(String.raw`<!--\s+EDUCATION\s+-->[\s\S]*?` + HTML_BOUNDARY),
    certifications: new RegExp(String.raw`<!--\s+CERTIFICATIONS\s+-->[\s\S]*?` + HTML_BOUNDARY),
    awards: new RegExp(String.raw`<!--\s+AWARDS\s+-->[\s\S]*?` + HTML_BOUNDARY),
    skills: new RegExp(String.raw`<!--\s+SKILLS\s+-->[\s\S]*?` + HTML_END_SENTINEL),
  },
  tex: {
    projects: new RegExp(String.raw`%{4,}\s+PROJECTS\s+%{4,}[\s\S]*?` + TEX_BOUNDARY),
    education: new RegExp(String.raw`%{4,}\s+Education\s+%{4,}[\s\S]*?` + TEX_BOUNDARY),
    awards: new RegExp(String.raw`%{4,}\s+AWARDS\s+%{4,}[\s\S]*?` + TEX_BOUNDARY),
    skills: new RegExp(String.raw`%{4,}\s+Technical Skills\s+%{4,}[\s\S]*?` + TEX_END_SENTINEL, 'm'),
  },
};

export const OPTIONAL_SECTIONS = ['competencies', 'projects', 'education', 'certifications', 'awards', 'skills'];

export function isEmptySection(payload, section) {
  const entries = payload?.[section];
  return !Array.isArray(entries) || entries.length === 0;
}

// Remove every optional section that has no entries in `payload`. Returns the
// template unchanged when both are populated.
export function stripEmptySections(template, payload, format) {
  const patterns = PATTERNS[format];
  if (!patterns) throw new Error(`Unknown template format: ${format}`);

  let out = template;
  for (const section of OPTIONAL_SECTIONS) {
    const pattern = patterns[section];
    if (!pattern) continue; // this format's template has no marker for this section
    if (isEmptySection(payload, section)) {
      // A non-matching pattern is a no-op here by design — see the Skills
      // sentinel note above: no sentinel means no strip, never a fallback to
      // a looser boundary.
      out = out.replace(pattern, '');
    }
  }
  return out;
}
