// Shared optional-section stripping for the CV builders (build-cv-html.mjs,
// build-cv-latex.mjs).
//
// Projects, education, and certifications are optional CV sections: projects
// may already be covered under Work Experience, and not every candidate has a
// degree or certification. The templates wrap them unconditionally, so an
// empty payload otherwise renders a bare section header.
//
// The section body is delimited by markers rather than parsed, so the boundary
// pattern carries the whole correctness burden and is easy to get subtly wrong:
//
//   - Stopping at any capitalized comment would also stop at an ordinary
//     comment inside a section body, truncating the strip and leaving markup
//     behind. Markers are therefore matched as all-caps only.
//   - Omitting the end-of-input branch would silently keep a section that
//     happens to be last in the template.
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

const PATTERNS = {
  html: {
    projects: new RegExp(String.raw`<!--\s+PROJECTS\s+-->[\s\S]*?` + HTML_BOUNDARY),
    education: new RegExp(String.raw`<!--\s+EDUCATION\s+-->[\s\S]*?` + HTML_BOUNDARY),
    certifications: new RegExp(String.raw`<!--\s+CERTIFICATIONS\s+-->[\s\S]*?` + HTML_BOUNDARY),
  },
  tex: {
    projects: new RegExp(String.raw`%{4,}\s+PROJECTS\s+%{4,}[\s\S]*?` + TEX_BOUNDARY),
    education: new RegExp(String.raw`%{4,}\s+Education\s+%{4,}[\s\S]*?` + TEX_BOUNDARY),
  },
};

export const OPTIONAL_SECTIONS = ['projects', 'education', 'certifications'];
const OPTIONAL_SECTIONS_BY_FORMAT = {
  html: OPTIONAL_SECTIONS,
  tex: ['projects', 'education'],
};

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
  for (const section of OPTIONAL_SECTIONS_BY_FORMAT[format]) {
    if (isEmptySection(payload, section)) {
      out = out.replace(patterns[section], '');
    }
  }
  return out;
}
